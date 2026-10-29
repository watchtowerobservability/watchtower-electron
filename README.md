# @watchtowerobservability/electron

Errors, native crash minidumps and an offline queue for Electron. Plain JavaScript with hand-written `.d.ts`,
no runtime dependencies (`electron` is a peer).

## Install

```sh
echo '@watchtowerobservability:registry=https://npm.pkg.github.com' >> .npmrc
npm install @watchtowerobservability/electron
```

## Quick start

```js
// main.js, first thing, before app.whenReady()
const wt = require('@watchtowerobservability/electron');
wt.init({ publishableKey: process.env.WT_PUBLISHABLE_KEY, service: 'my-app', release: '1.2.3' });
// preload.js
require('@watchtowerobservability/electron/preload');
```

The renderer reports `error` / `unhandledrejection` automatically; `window.watchtower.captureException(err)` is
exposed for manual capture (needs `contextIsolation: true`).

## Integrations

| Feature | How |
|---|---|
| Main process errors | `uncaughtExceptionMonitor`, `unhandledRejection`, `captureException` |
| Renderer errors | preload + IPC channel `wt:error` (payload bounded and sanitised in main) |
| Native crashes | Crashpad via `crashReporter` (local only); dumps are sent as `event.minidump` on the next start |
| Offline | envelopes queue on disk (`userData/watchtower-queue`, 5 MB cap, oldest dropped) and are retried |

## Configuration

| Option | Env | Default |
|---|---|---|
| `publishableKey` | `WT_PUBLISHABLE_KEY` | required; sent as `Authorization: Bearer`, masked in any output |
| `endpoint` | `WT_OTLP_ENDPOINT` | `http://localhost:4318` |
| `service` | `WT_SERVICE` | `app` |
| `environment` | `WT_ENVIRONMENT` | none |
| `release` | `WT_RELEASE` | none |
| `beforeSend` | | redaction hook, return `null` to drop |
| `crashReporter`, `captureUncaught` | | `true` |

`wt.*` tag keys are dropped (reserved namespace). Delivery is at-least-once.

## Provenance

`gh attestation verify <file> --repo watchtowerobservability/watchtower-electron`

## License

Apache-2.0
