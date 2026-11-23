# Agent notes for RSS Reader

Local-first RSS/Atom reader: React + TypeScript + Vite, packaged with Tauri for
Windows, macOS, Linux and Android, and installable as a PWA. There is no account,
backend or telemetry; subscriptions, read/starred state, rules, preferences and
cached articles stay in `localStorage`/IndexedDB on the device.

## Commands

- `npm run typecheck` and `npm run test:unit` (Vitest, jsdom) run anywhere.
- `npm run test:e2e` needs the dev server on `:5173` (`BASE_URL` overrides).
- `npm run test:pwa` needs `npm run serve` (the local app server) on `:4173`.
- The installed PWA is served by `server/app-server.mjs` (loopback only, same
  origin as `/proxy`). The web build has no third-party proxy; do not add one.
- `npm run check` = typecheck + unit + `check:desktop` (Rust fmt, clippy, tests).
- `npm run build` writes `dist/`; the folder is generated, never edit it by hand.
- Desktop: `npm run desktop:dev`, `desktop:build`; Android: `npm run tauri --
  android build --apk`.

## Conventions

- Every user-visible string goes through `t()` in `src/lib/i18n.ts`. Add the
  Spanish entry next to the English key; a missing entry falls back to English,
  so new text never blocks a release.
- UI changes need an assertion in `scripts/e2e.mjs` (and a unit test when the
  logic is not DOM). Keep the suite hermetic: feeds come from `public/fixtures/`.
- The reader is always an overlay over the blurred dashboard in every view.
  There is no width-based split pane; do not reintroduce one.
- Commits are one line, imperative, lowercase after the type (`fix: ...`,
  `feat: ...`, `chore: release 0.13.x`). Releases: bump the version in the four
  files listed in [`docs/RELEASING.md`](docs/RELEASING.md), tag `vX.Y.Z` and push
  the tag; CI builds the installers and publishes the release.

## Security

- Secrets (tokens, keystores, API keys) never enter a commit, log or prompt. The
  optional YouTube API key is session-only and excluded from backups.
- Article HTML is sanitized with DOMPurify; feed URLs go through `src/lib/url.ts`
  in the web build and `src-tauri/src/url_policy.rs` in the desktop build.
- Backups and import files are untrusted input: they are validated before they
  replace local data.

## State

Current work, uncommitted changes and the exact next step live in
[`docs/agent/HANDOFF.md`](docs/agent/HANDOFF.md). Append history to
[`docs/agent/JOURNAL.md`](docs/agent/JOURNAL.md); newest entry first.
