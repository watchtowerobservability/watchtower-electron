// Add `require('@watchtowerobservability/electron/preload')` to your preload script (or use it as one).
import { contextBridge, ipcRenderer } from 'electron';
import { install } from './renderer';

declare const window: Parameters<typeof install>[0];

const capture = install(window, (p) => ipcRenderer.send('wt:error', p));
contextBridge.exposeInMainWorld('watchtower', { captureException: capture });
