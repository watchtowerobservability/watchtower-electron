// Sentry-compatible envelope framing, the wire format the Watchtower edge accepts at /api/<k>/envelope/.
import { randomUUID } from 'node:crypto';

const MAX = 2048;

export type Frame = { function: string; filename: string; lineno: number; colno: number };
export type WtEvent = Record<string, unknown> & { event_id: string };
export type EventOptions = {
  release?: string | undefined;
  environment?: string | undefined;
  sdkVersion: string;
  tags?: Record<string, string> | undefined;
  level?: string | undefined;
  process?: string | undefined;
  mechanism?: string | undefined;
  handled?: boolean | undefined;
};

/** wt.* is reserved: the gateway deletes it, so drop it here instead of losing it silently. */
export function safeMap(m: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (k.startsWith('wt.') || k.length > 128) continue;
    out[k] = typeof v === 'string' ? v.slice(0, MAX) : v;
  }
  return out;
}

/** V8 stack text to Sentry frames (oldest call first, as the edge expects). */
export function parseStack(stack: unknown): Frame[] {
  const frames: Frame[] = [];
  for (const line of String(stack ?? '').split('\n')) {
    const m = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/.exec(line);
    if (m) frames.push({ function: m[1] || '?', filename: m[2] ?? '', lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

function base(o: EventOptions, platform: string, level: string) {
  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform,
    level,
    release: o.release,
    environment: o.environment,
    sdk: { name: 'watchtower.electron', version: o.sdkVersion },
  };
}

export function errorEvent(err: unknown, o: EventOptions): WtEvent {
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

export function crashEvent(o: EventOptions): WtEvent {
  return {
    ...base(o, 'native', 'fatal'),
    tags: safeMap({ process: 'native', ...o.tags }),
    exception: { values: [{ type: 'NativeCrash', value: 'Electron native crash (minidump attached)', mechanism: { type: 'minidump', handled: false } }] },
  };
}

function item(header: Record<string, unknown>, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${JSON.stringify({ ...header, length: payload.length })}\n`), payload, Buffer.from('\n')]);
}

/** One envelope: the event, plus an optional minidump attachment (`event.minidump`). */
export function envelope(event: WtEvent, minidump?: Buffer): Buffer {
  const parts = [Buffer.from(`${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n`)];
  parts.push(item({ type: 'event' }, Buffer.from(JSON.stringify(event))));
  if (minidump) {
    parts.push(item({ type: 'attachment', filename: 'minidump.dmp', attachment_type: 'event.minidump' }, minidump));
  }
  return Buffer.concat(parts);
}
