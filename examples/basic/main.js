const path = require('path');
const { app, BrowserWindow } = require('electron');
const wt = require('@watchtowerobservability/electron');

wt.init({ publishableKey: process.env.WT_PUBLISHABLE_KEY, service: 'example' });
app.whenReady().then(() => {
  new BrowserWindow({ webPreferences: { preload: path.join(__dirname, 'preload.js') } }).loadFile('index.html');
});
