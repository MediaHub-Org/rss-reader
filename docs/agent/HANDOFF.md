# Handoff — RSS Reader

Updated: 2026-11-19. History in [`JOURNAL.md`](JOURNAL.md), conventions in
[`AGENTS.md`](../../AGENTS.md).

## State

- **0.13.20** is the current release; `main` is the working branch.
- **Reader overlay in every view.** Card, list, magazine and compact all open the
  article as a popup over a blurred dashboard (`ArticleOverlay`), with
  previous/next arrows and close-on-backdrop. Committed as `c7ecd10`; the README
  and `scripts/e2e.mjs` were updated with it.
- **Keyboard.** `j`/`k` or `↓`/`↑` move through articles, `←`/`→` previous/next,
  `Enter`/`o` open, `m` read/unread, `s` star, `r` refresh, `/` search, `a` add
  source, `1`–`4` card/compact/list/magazine, `?` opens the shortcut reference
  (Settings → About), `Esc` closes. The reference list in
  `settings/AboutPanel.tsx` is the single source of truth for the labels.
- **Accessibility.** The overlay announces `Article N of M: title` through a
  `role="status"` live region and the arrows expose `aria-keyshortcuts`; focus
  stays trapped in the dialog (backdrop arrows included).
- **Dead split pane removed.** `content-area--split` and `content-area__detail`
  no longer exist in `App.tsx` or `app.css`; the content area is one scroller.
- **Dependencies.** Dependabot PRs 13, 14 and 16–22 are squash-merged (npm:
  `@types/node`, `vitest`, `playwright`, `@vitejs/plugin-react`,
  `@tauri-apps/plugin-notification`; cargo: `flate2`, `rfd` 0.18,
  `tauri-plugin-opener`, `tauri-plugin-notification`). Run `npm ci` after
  pulling; Playwright 1.65 needs `npx playwright install chromium` once.

## Checks

Last verified on 2026-11-19, before the docs commit:

- `npm run typecheck` OK.
- `npm run test:unit`: 97 passed (21 files).
- `npm run test:e2e`: 173 passed against `http://127.0.0.1:5173`.
- `npm run build` OK.
- `npm run check:desktop`: fmt, clippy (`-D warnings`) and 13 Rust tests OK.

## Next

- Nothing is uncommitted or half-done.
- The owner has not chosen the next improvement yet. Candidates discussed:
  per-article reading position, real two-way sync with a provider (the Services
  selector exists but sync is not implemented), PWA refresh through the proxy.
- Release only when asked: bump `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` and the `rss-reader` entry in `src-tauri/Cargo.lock`,
  then tag `vX.Y.Z` (see `docs/RELEASING.md`).
