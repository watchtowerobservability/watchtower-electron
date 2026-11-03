# Changelog

## 0.2.0

- Ported to TypeScript (owner rule 2026-10-30): sources in `src/*.ts`, compiled to `dist/` with generated `.d.ts`; public API unchanged.

## 0.1.0

- Main-process error capture (uncaughtException, unhandledRejection, `captureException`).
- Renderer errors over IPC (`preload`).
- Native crashes: Crashpad minidumps uploaded to the edge as `event.minidump`.
- Disk offline queue.
