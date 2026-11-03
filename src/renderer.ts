// Renderer side: forward window errors to the main process over IPC. Pure so it is testable without Electron.
export type RendererPayload = { name: string; message: string; stack: string | undefined; mechanism: string };
type Win = { addEventListener(type: string, fn: (ev: { error?: unknown; message?: unknown; reason?: unknown }) => void): void };

export function install(win: Win, send: (p: RendererPayload) => void): (err: unknown) => void {
  const post = (err: unknown, mechanism: string) => {
    try {
      const e = err instanceof Error ? err : new Error(String(err));
      send({ name: e.name, message: e.message, stack: e.stack, mechanism });
    } catch { /* never throw into the page */ }
  };
  win.addEventListener('error', (ev) => post(ev.error || ev.message, 'onerror'));
  win.addEventListener('unhandledrejection', (ev) => post(ev.reason, 'unhandledrejection'));
  return (err) => post(err, 'generic');
}
