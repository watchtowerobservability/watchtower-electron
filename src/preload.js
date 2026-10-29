'use strict';
// Add `require('@watchtowerobservability/electron/preload')` to your preload script (or use it as one).
const { contextBridge, ipcRenderer } = require('electron');
const { install } = require('./renderer');

const capture = install(window, (p) => ipcRenderer.send('wt:error', p));
contextBridge.exposeInMainWorld('watchtower', { captureException: capture });
