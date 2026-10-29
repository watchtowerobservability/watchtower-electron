'use strict';
// Renderer side: forward window errors to the main process over IPC. Pure so it is testable without Electron.
function install(win, send) {
  const post = (err, mechanism) => {
    try {
      const e = err instanceof Error ? err : new Error(String(err));
      send({ name: e.name, message: e.message, stack: e.stack, mechanism });
    } catch { /* never throw into the page */ }
  };
  win.addEventListener('error', (ev) => post(ev.error || ev.message, 'onerror'));
  win.addEventListener('unhandledrejection', (ev) => post(ev.reason, 'unhandledrejection'));
  return (err) => post(err, 'generic');
}
module.exports = { install };
