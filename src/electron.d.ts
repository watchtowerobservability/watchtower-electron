// The slice of Electron's API this SDK uses. `electron` is a peer dependency and is not installed to build.
declare module 'electron' {
  export const app: { getPath(name: string): string };
  export const crashReporter: {
    start(o: { submitURL: string; uploadToServer: boolean; compress?: boolean }): void;
    getCrashesDirectory(): string;
  };
  export const ipcMain: { on(channel: string, fn: (event: unknown, payload: unknown) => void): void };
  export const ipcRenderer: { send(channel: string, payload: unknown): void };
  export const contextBridge: { exposeInMainWorld(key: string, api: Record<string, unknown>): void };
}
