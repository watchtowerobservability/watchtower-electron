'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { envelope, errorEvent, crashEvent } = require('./envelope');
const { Queue } = require('./queue');

const SDK_VERSION = '0.1.0';
const DEFAULT_ENDPOINT = 'http://localhost:4318';
const MAX_FIELD = 4096;

class Client {
  constructor(opts, electron, deps) {
    const o = opts || {};
    const env = process.env;
    const key = o.publishableKey || env.WT_PUBLISHABLE_KEY;
    if (!key) throw new Error('publishableKey is required');
    Object.defineProperty(this, 'key', { value: key, enumerable: false });
    this.endpoint = (o.endpoint || env.WT_OTLP_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.beforeSend = o.beforeSend;
    this.fetch = (deps && deps.fetch) || globalThis.fetch;
    this.electron = electron;
    const service = o.service || env.WT_SERVICE || 'app';
    this.opts = {
      release: o.release || env.WT_RELEASE,
      environment: o.environment || env.WT_ENVIRONMENT,
      tags: { service, ...o.tags },
      sdkVersion: SDK_VERSION,
    };
    const dir = o.queueDir || path.join(electron.app.getPath('userData'), 'watchtower-queue');
    this.queue = new Queue(dir, o.queueMaxBytes);

    if (o.crashReporter !== false) {
      // Crashpad writes dumps locally only; we upload them ourselves through the edge envelope path.
      electron.crashReporter.start({ submitURL: '', uploadToServer: false, compress: true });
      this._collectDumps();
    }
    if (o.captureUncaught !== false) {
      process.on('uncaughtExceptionMonitor', (e) => this.captureException(e, { mechanism: 'uncaughtException', handled: false }));
      process.on('unhandledRejection', (r) => this.captureException(r, { mechanism: 'unhandledRejection', handled: false }));
    }
    // IPC transport from renderers (see preload.js); the payload is untrusted, so only bounded strings are used.
    electron.ipcMain.on('wt:error', (_e, p) => {
      const x = p && typeof p === 'object' ? p : {};
      const err = new Error(String(x.message || '').slice(0, MAX_FIELD));
      err.name = String(x.name || 'Error').slice(0, 200);
      err.stack = String(x.stack || '').slice(0, 16384);
      this.captureException(err, { process: 'renderer', mechanism: x.mechanism === 'unhandledrejection' ? 'unhandledrejection' : 'onerror', handled: false });
    });
    void this.flush();
  }

  /** Dumps left by a previous run become queued envelopes; the dump is deleted once queued. */
  _collectDumps() {
    const base = this.electron.crashReporter.getCrashesDirectory();
    for (const d of [base, path.join(base, 'pending'), path.join(base, 'completed')]) {
      let names = [];
      try { names = fs.readdirSync(d).filter((n) => n.endsWith('.dmp')); } catch { continue; }
      for (const n of names) {
        const f = path.join(d, n);
        try {
          this.queue.add(envelope(crashEvent(this.opts), fs.readFileSync(f)));
          fs.unlinkSync(f);
        } catch { /* leave the dump for the next start */ }
      }
    }
  }

  captureException(err, o) {
    try {
      let ev = errorEvent(err, { ...this.opts, ...o, tags: { ...this.opts.tags, ...(o && o.tags) } });
      if (this.beforeSend) ev = this.beforeSend(ev);
      if (!ev) return;
      this.queue.add(envelope(ev));
      void this.flush();
    } catch { /* never throw into the host app */ }
  }

  _send(body) {
    return this.fetch(`${this.endpoint}/api/default/envelope/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/x-sentry-envelope' },
      body,
    }).then((r) => r.status);
  }

  flush() {
    // one drain at a time so a burst of errors does not send a file twice
    this._draining = (this._draining || Promise.resolve()).then(() => this.queue.drain((b) => this._send(b))).catch(() => {});
    return this._draining;
  }

  toString() { return `WatchtowerElectron(${this.endpoint}, key=****)`; }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.toString(); }
}

let client;
/** Call once, first thing in the main process, before `app.whenReady()`. */
function init(opts, electron, deps) {
  if (!client) client = new Client(opts, electron || require('electron'), deps);
  return client;
}
const captureException = (e, o) => { if (client) client.captureException(e, o); };
const flush = () => (client ? client.flush() : Promise.resolve());

module.exports = { init, captureException, flush, Client, _reset: () => { client = undefined; } };
