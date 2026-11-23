# Handoff — RSS Reader

Updated: 2026-11-23. History in [`JOURNAL.md`](JOURNAL.md), conventions in
[`AGENTS.md`](../../AGENTS.md).

## State

- **PWA local server — merged into local `main` (`3f88fa5`, not pushed); login
  task "RSS Reader app server" installed and running on this machine
  (2026-11-23, node `C:\nvm4w\nodejs\node.exe`).**
  The installed PWA refreshes through `server/app-server.mjs` (`npm run serve`,
  `npm start`): `dist/` + `/proxy` on `http://localhost:4173`, loopback only;
  Host allow-list (421), `/proxy` only for the app itself (403 for foreign/opaque
  origins, cross/same-site loads and navigations), proxied HTML/SVG served as
  text with nosniff + sandbox CSP, 503 instead of a crash while `dist/` is being
  rebuilt. The public proxies are gone from `src/lib/fetchFeed.ts`. Windows login
  task scripts in `scripts/windows/` (see its README). Spec and plan in
  `docs/superpowers/`. After pulling or editing, run `npm run build`: the task
  serves whatever is in `dist/`.
- **Deferred minors from the final review:** misleading "server not running"
  when the PWA is opened at `127.0.0.1` with `VITE_PROXY_URL` → `proxy.mjs`;
  `npm start` hides the child's `EADDRINUSE` behind a 30 s generic message;
  uninstall matches the server path case-sensitively; `RestartCount 3`;
  `assets` prefix check without trailing separator; no `frame-ancestors`;
  pre-existing proxy-lib SSRF gaps (IPv4-mapped IPv6, names resolving to
  loopback); pre-existing untranslated "Could not fetch this feed (...)"; the
  Vite dev middleware still passes upstream content types.
- **Local-only by design (owner decision 2026-11-23).** The sync-provider selector
  and its connection fields are gone: Services now states that there is no account,
  provider or server and that OPML or a full backup is how data moves. The
  `SyncService` type and the `syncService`/`syncServer`/`syncUsername` preferences
  were removed; `loadPreferences` drops legacy sync fields (including the old
  password) so an old profile cannot keep a provider or credential. Backups ignore
  legacy sync fields too. 105 unit and 175 e2e tests pass; the e2e checks the
  local-only note and that no sync controls or stored fields remain.
- **Reading position per article.** The reader remembers where each article was
  left (`src/lib/readingPosition.ts`: localStorage, debounced, 300-entry cap) and
  restores it on open, clamped to the current height. The dashboard keeps its own
  scroll behind the backdrop. The old "always open at the top" effect in `App.tsx`
  is gone.
- **0.13.21** released on 2026-11-19 (Windows x64, macOS arm64, Linux
  AppImage, Android arm64, plus `SHA256SUMS.txt`); `main` is the working branch.
- **Reader overlay in every view.** Card, list, magazine and compact all open the
  article as a popup over a blurred dashboard (`ArticleOverlay`), with
  previous/next arrows and close-on-backdrop. Committed as `c7ecd10`; the README
  and `scripts/e2e.mjs` were updated with it.
- **Reader panel centres over the news column.** The backdrop still covers the
  whole dashboard, sidebar included, but the panel and its arrows centre on the
  content column: `--article-overlay-shift` is the sidebar width on desktop, `0`
  below 68.75rem (drawer) and `0` when the sidebar is collapsed. The arrows add
  or subtract half the shift because their percentages resolve against the
  backdrop's padding box. e2e asserts the panel centre against `.content-area`
  and that it is more than 50px off the window centre.
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

Last verified on 2026-11-22 (reading position) and 2026-11-19 (release):

- `npm run typecheck` OK.
- `npm run test:unit`: 105 passed (22 files).
- `npm run test:e2e`: 175 passed against `http://localhost:5173` (one cold-start
  run timed out once; reruns pass).
- `npm run build` OK.
- `npm run check:desktop`: fmt, clippy (`-D warnings`) and 13 Rust tests OK.
- Release `v0.13.21`: CI green on the tag (web plus the four desktop builds),
  release published with four assets and `SHA256SUMS.txt`; the downloaded
  Windows installer hash matches. The local `test:pwa` offline reload fails on
  this Windows machine (`ERR_FAILED` after `setOffline`), the same test passes in
  CI; `public/sw.js` and `src/main.tsx` are unchanged since v0.13.20, so it is
  environmental, not a regression.

## Next

- Nothing is uncommitted or half-done.
- The owner chose **per-article reading position**, and it is in (see State). On
  2026-11-23 the owner decided the reader stays **local only**: no sync provider and
  no paid service. The selector and credentials are gone; do not reintroduce them.
  PWA refresh without preview/third parties is merged and the login task is
  installed. Owner check left: log out/in, open the PWA, refresh and confirm in
  DevTools → Network that no request goes to a third party. Push of `main`
  (7 commits ahead) waits for the owner.
- Release only when asked: bump `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` and the `rss-reader` entry in `src-tauri/Cargo.lock`,
  then tag `vX.Y.Z` (see `docs/RELEASING.md`).
