'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const main = require('../src/main');
const { parseStack, safeMap, envelope, errorEvent } = require('../src/envelope');
const { Queue } = require('../src/queue');
const { install } = require('../src/renderer');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wt-el-'));

function fakeElectron(dir) {
  const handlers = {};
  return {
    handlers,
    app: { getPath: () => dir },
    crashReporter: { start(o) { this.started = o; }, getCrashesDirectory: () => path.join(dir, 'Crashpad') },
    ipcMain: { on: (c, f) => { handlers[c] = f; } },
  };
}

test('parseStack reads V8 frames, oldest first', () => {
  const f = parseStack('Error: x\n    at foo (/a/b.js:10:5)\n    at /a/c.js:3:1');
  assert.deepStrictEqual(f[0], { function: '?', filename: '/a/c.js', lineno: 3, colno: 1 });
  assert.strictEqual(f[1].function, 'foo');
});

test('safeMap drops wt.* keys', () => {
  assert.deepStrictEqual(safeMap({ 'wt.tenant': 'x', a: 'b' }), { a: 'b' });
});

test('envelope frames event and minidump attachment', () => {
  const buf = envelope(errorEvent(new Error('boom'), { sdkVersion: '0' }), Buffer.from('MDMP1234'));
  const text = buf.toString('latin1');
  assert.match(text, /"attachment_type":"event.minidump"/);
  assert.match(text, /"length":8\}\nMDMP1234\n$/);
});

test('queue drains oldest first, keeps on 503, drops on 400', async () => {
  const q = new Queue(tmp());
  q.add(Buffer.from('a')); q.add(Buffer.from('b')); q.add(Buffer.from('c'));
  const seen = [];
  await q.drain(async (b) => { seen.push(b.toString()); return b.toString() === 'a' ? 400 : 503; });
  assert.deepStrictEqual(seen, ['a', 'b']);
  assert.strictEqual(q.list().length, 2);
});

test('queue trims oldest past the byte cap', () => {
  const q = new Queue(tmp(), 10);
  q.add(Buffer.alloc(8)); q.add(Buffer.alloc(8)); q.add(Buffer.alloc(8));
  assert.strictEqual(q.list().length, 1);
});

test('init: bearer key, masked output, renderer error over IPC, offline then flush', async () => {
  main._reset();
  const el = fakeElectron(tmp());
  const calls = [];
  let online = false;
  const fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    return { status: online ? 200 : 503 };
  };
  const c = main.init({ publishableKey: 'pk_secret_value', endpoint: 'http://e:1/', captureUncaught: false }, el, { fetch });
  assert.strictEqual(el.crashReporter.started.uploadToServer, false);
  assert.ok(!String(c).includes('pk_secret_value'));
  assert.ok(!JSON.stringify(c).includes('pk_secret_value'));
  el.handlers['wt:error']({}, { name: 'TypeError', message: 'bad', stack: 'TypeError: bad\n    at f (/x.js:1:2)' });
  await c.flush();
  assert.strictEqual(calls[0].url, 'http://e:1/api/default/envelope/');
  assert.strictEqual(calls[0].auth, 'Bearer pk_secret_value');
  assert.strictEqual(c.queue.list().length, 1);
  online = true;
  await c.flush();
  assert.strictEqual(c.queue.list().length, 0);
});

test('beforeSend can drop an event', async () => {
  main._reset();
  const c = main.init({ publishableKey: 'k', captureUncaught: false, beforeSend: () => null }, fakeElectron(tmp()), { fetch: async () => ({ status: 503 }) });
  c.captureException(new Error('x'));
  assert.strictEqual(c.queue.list().length, 0);
});

test('init queues leftover minidumps and deletes them', () => {
  main._reset();
  const dir = tmp();
  const pending = path.join(dir, 'Crashpad', 'pending');
  fs.mkdirSync(pending, { recursive: true });
  fs.writeFileSync(path.join(pending, 'a.dmp'), 'MDMP');
  const c = main.init({ publishableKey: 'k', captureUncaught: false }, fakeElectron(dir), { fetch: async () => ({ status: 503 }) });
  assert.strictEqual(fs.readdirSync(pending).length, 0);
  assert.match(fs.readFileSync(path.join(c.queue.dir, c.queue.list()[0]), 'latin1'), /event\.minidump/);
});

test('init requires a key', () => {
  main._reset();
  delete process.env.WT_PUBLISHABLE_KEY;
  assert.throws(() => main.init({}, fakeElectron(tmp())), /publishableKey/);
});

test('renderer forwards window errors', () => {
  const l = {};
  const sent = [];
  const cap = install({ addEventListener: (n, f) => { l[n] = f; } }, (p) => sent.push(p));
  l.error({ error: new TypeError('x') });
  l.unhandledrejection({ reason: 'nope' });
  cap(new Error('manual'));
  assert.deepStrictEqual(sent.map((s) => s.mechanism), ['onerror', 'unhandledrejection', 'generic']);
  assert.strictEqual(sent[0].name, 'TypeError');
});
