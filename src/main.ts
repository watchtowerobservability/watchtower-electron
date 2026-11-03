import * as fs from 'node:fs';
import * as path from 'node:path';
import { crashEvent, envelope, errorEvent, type EventOptions, type WtEvent } from './envelope';
import { Queue } from './queue';

const SDK_VERSION = '0.2.0';
const DEFAULT_ENDPOINT = 'http://localhost:4318';
const MAX_FIELD = 4096;

export interface Options {
  /** Publishable ingest key (or env WT_PUBLISHABLE_KEY). Sent as `Authorization: Bearer`, never logged. */
  publishableKey?: string | undefined;
  /** Default env WT_OTLP_ENDPOINT, else http://localhost:4318. */
  endpoint?: string | undefined;
  service?: string | undefined;
  release?: string | undefined;
  environment?: string | undefined;
  tags?: Record<string, string> | undefined;
  /** Redaction hook: edit, or return null to drop. */
  beforeSend?: ((event: WtEvent) => WtEvent | null) | undefined;
  /** Native crash capture through Crashpad (default true). */
  crashReporter?: boolean | undefined;
  /** uncaughtException / unhandledRejection hooks (default true). */
  captureUncaught?: boolean | undefined;
  queueDir?: string | undefined;
  queueMaxBytes?: number | undefined;
}

export interface CaptureOptions {
  level?: string;
  handled?: boolean;
  process?: string;
  mechanism?: string;
  tags?: Record<string, string>;
}

/** The parts of the `electron` module the main process uses (injectable for tests). */
export interface ElectronMain {
  app: { getPath(name: string): string };
  crashReporter: { start(o: { submitURL: string; uploadToServer: boolean; compress?: boolean }): void; getCrashesDirectory(): string };
  ipcMain: { on(channel: string, fn: (event: unknown, payload: unknown) => void): void };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>;

export class Client {
  // A private field: never enumerable, never in JSON or inspect output.
  readonly #key: string;
  readonly endpoint: string;
  readonly queue: Queue;
  private readonly beforeSend: Options['beforeSend'];
  private readonly fetch: Fetch;
  private readonly electron: ElectronMain;
  private readonly opts: EventOptions & { tags: Record<string, string> };
  private draining: Promise<void> = Promise.resolve();

  constructor(opts: Options | undefined, electron: ElectronMain, deps?: { fetch?: Fetch }) {
    const o = opts ?? {};
    const env = process.env;
    const key = o.publishableKey || env.WT_PUBLISHABLE_KEY;
    if (!key) throw new Error('publishableKey is required');
    this.#key = key;
    this.endpoint = (o.endpoint || env.WT_OTLP_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.beforeSend = o.beforeSend;
    this.fetch = deps?.fetch ?? (globalThis.fetch as unknown as Fetch);
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
      this.collectDumps();
    }
    if (o.captureUncaught !== false) {
      process.on('uncaughtExceptionMonitor', (e) => this.captureException(e, { mechanism: 'uncaughtException', handled: false }));
      process.on('unhandledRejection', (r) => this.captureException(r, { mechanism: 'unhandledRejection', handled: false }));
    }
    // IPC transport from renderers (see preload.ts); the payload is untrusted, so only bounded strings are used.
    electron.ipcMain.on('wt:error', (_e, p) => {
      const x = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const err = new Error(String(x.message ?? '').slice(0, MAX_FIELD));
      err.name = String(x.name ?? 'Error').slice(0, 200);
      err.stack = String(x.stack ?? '').slice(0, 16384);
      this.captureException(err, { process: 'renderer', mechanism: x.mechanism === 'unhandledrejection' ? 'unhandledrejection' : 'onerror', handled: false });
    });
    void this.flush();
  }

  /** Dumps left by a previous run become queued envelopes; the dump is deleted once queued. */
  private collectDumps(): void {
    const root = this.electron.crashReporter.getCrashesDirectory();
    for (const d of [root, path.join(root, 'pending'), path.join(root, 'completed')]) {
      let names: string[];
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

  captureException(err: unknown, o?: CaptureOptions): void {
    try {
      let ev: WtEvent | null = errorEvent(err, { ...this.opts, ...o, tags: { ...this.opts.tags, ...o?.tags } });
      if (this.beforeSend) ev = this.beforeSend(ev);
      if (!ev) return;
      this.queue.add(envelope(ev));
      void this.flush();
    } catch { /* never throw into the host app */ }
  }

  private send(body: Buffer): Promise<number> {
    return this.fetch(`${this.endpoint}/api/default/envelope/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/x-sentry-envelope' },
      body,
    }).then((r) => r.status);
  }

  flush(): Promise<void> {
    // one drain at a time so a burst of errors does not send a file twice
    this.draining = this.draining.then(() => this.queue.drain((b) => this.send(b))).catch(() => {});
    return this.draining;
  }

  toString(): string { return `WatchtowerElectron(${this.endpoint}, key=****)`; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return this.toString(); }
}

let client: Client | undefined;

/** Call once, first thing in the main process, before `app.whenReady()`. */
export function init(opts?: Options, electron?: ElectronMain, deps?: { fetch?: Fetch }): Client {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a peer, loaded only when not injected
  client ??= new Client(opts, electron ?? (require('electron') as ElectronMain), deps);
  return client;
}
export const captureException = (e: unknown, o?: CaptureOptions): void => { client?.captureException(e, o); };
export const flush = (): Promise<void> => (client ? client.flush() : Promise.resolve());
/** Test hook: forget the singleton. */
export const _reset = (): void => { client = undefined; };
