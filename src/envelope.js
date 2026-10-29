'use strict';
// Sentry-compatible envelope framing, the wire format the Watchtower edge accepts at /api/<k>/envelope/.
const crypto = require('node:crypto');

const MAX = 2048;

/** wt.* is reserved: the gateway deletes it, so drop it here instead of losing it silently. */
function safeMap(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    if (k.startsWith('wt.') || k.length > 128) continue;
    out[k] = typeof v === 'string' ? v.slice(0, MAX) : v;
  }
  return out;
}

/** V8 stack text to Sentry frames (oldest call first, as the edge expects). */
function parseStack(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n')) {
    const m = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/.exec(line);
    if (m) frames.push({ function: m[1] || '?', filename: m[2], lineno: +m[3], colno: +m[4] });
  }
  return frames.reverse();
}

function base(o, platform, level) {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform,
    level,
    release: o.release,
    environment: o.environment,
    sdk: { name: 'watchtower.electron', version: o.sdkVersion },
  };
}

function errorEvent(err, o) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  return {
    ...base(o, 'node', o.level || 'error'),
    tags: safeMap({ process: o.process || 'main', ...o.tags }),
    exception: {
      values: [{
        type: String(e.name || 'Error').slice(0, 200),
        value: String(e.message || '').slice(0, MAX),
        stacktrace: { frames: parseStack(e.stack) },
        mechanism: { type: o.mechanism || 'generic', handled: o.handled !== false },
      }],
    },
  };
}

function crashEvent(o) {
  return {
    ...base(o, 'native', 'fatal'),
    tags: safeMap({ process: 'native', ...o.tags }),
    exception: { values: [{ type: 'NativeCrash', value: 'Electron native crash (minidump attached)', mechanism: { type: 'minidump', handled: false } }] },
  };
}

function item(header, payload) {
  return Buffer.concat([Buffer.from(`${JSON.stringify({ ...header, length: payload.length })}\n`), payload, Buffer.from('\n')]);
}

/** One envelope: the event, plus an optional minidump attachment (`event.minidump`). */
function envelope(event, minidump) {
  const parts = [Buffer.from(`${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n`)];
  parts.push(item({ type: 'event' }, Buffer.from(JSON.stringify(event))));
  if (minidump) {
    parts.push(item({ type: 'attachment', filename: 'minidump.dmp', attachment_type: 'event.minidump' }, minidump));
  }
  return Buffer.concat(parts);
}

module.exports = { envelope, errorEvent, crashEvent, parseStack, safeMap };
