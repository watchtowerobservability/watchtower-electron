# Changelog

## 0.1.0

- Main-process error capture (uncaughtException, unhandledRejection, `captureException`).
- Renderer errors over IPC (`preload`).
- Native crashes: Crashpad minidumps uploaded to the edge as `event.minidump`.
- Disk offline queue.
