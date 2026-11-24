# Handoff — RSS Reader

Updated: 2026-11-24. History in [`JOURNAL.md`](JOURNAL.md), conventions in
[`AGENTS.md`](../../AGENTS.md).

## State

- **Reader beside the dashboard (0.14.0).** On desktop the reader is
  non-modal and scoped to the news column: the backdrop covers and blurs only
  `.content-area` (22px, darker scrim), the sidebar and top bar stay crisp and
  usable, and picking a feed/folder from the sidebar closes the article through
  `setActiveFeed`. The covered list is `inert`, focus opens on the article title
  (`aria-labelledby`), Tab can leave the dialog and Escape still closes. Below
  1100px the sidebar is a drawer and the reader keeps the full-screen modal
  (aria-modal, focus trap, both scrollers locked). `Dialog` gained `modal` and
  `backdropStyle`; `--article-overlay-shift` and the arrow shift math are gone.
  e2e asserts the backdrop box equals `.content-area` and no longer covers the
  sidebar.
- **PWA local server — in `main`, pushed as `3164127` on 2026-11-23; login
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
- **Deferred minors from the final review — closed on 2026-11-24:** the
  `/proxy` 404 only blames the local server when the proxy is its own origin;
  `npm start` detects a taken port and a child that exits instead of waiting
  30 s; uninstall matches the server path case-insensitively; the `assets`
  prefix check requires the separator; proxied responses add
  `frame-ancestors 'none'`; the proxy refuses IPv4-mapped IPv6, link-local/ULA,
  6to4/Teredo and hostnames that resolve to a private address; **every redirect
  hop is validated** (`redirect: 'manual'`, `5b1c06c`: a public feed could
  otherwise chase a 302 into loopback); "Could not fetch this feed (...)" goes
  through `t()`; the Vite dev/preview middleware uses the same sanitizing
  headers as the app server. Accepted, not fixed: `RestartCount 3` on the login
  task (a failing server already backs off one minute); DNS rebinding between
  the `lookup` and the `fetch` (closing it means pinning the connection to the
  validated address through an undici dispatcher, a dependency this app does
  not have).
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

Last verified on 2026-11-24 (0.14.1):

- `npm run typecheck` OK.
- `npm run test:unit`: 150 passed (25 files).
- `npm run test:e2e`: 180 passed against `http://127.0.0.1:5173`.
- `npm run build` OK.
- `npm run check:desktop`: fmt, clippy (`-D warnings`) and 13 Rust tests OK.
- `npm run test:pwa`: 15/16 on this Windows machine; the offline reload fails
  with `ERR_FAILED` after `setOffline`, the same environmental failure as
  before (it passes in CI). One cold run read the precache cache before the
  install finished and failed that assertion; the rerun passed it.

## Next

- Nothing is uncommitted or half-done.
- 0.14.1 is released: `main` at `1cd2f64` and tag `v0.14.1` were pushed on
  2026-11-24, both CI runs are green and the release published the four
  installers (`x64-setup.exe`, `amd64.AppImage`, `aarch64.dmg`,
  `android.apk`) plus `SHA256SUMS.txt`. It supersedes 0.14.0, which had gone
  out before the review found the unvalidated redirect; nothing is pending.
- The owner chose **per-article reading position**, and it is in (see State). On
  2026-11-23 the owner decided the reader stays **local only**: no sync provider and
  no paid service. The selector and credentials are gone; do not reintroduce them.
  PWA refresh without preview/third parties is merged and the login task is
  installed. Owner check left: log out/in, open the PWA, refresh and confirm in
  DevTools → Network that no request goes to a third party.
- Release only when asked: bump `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` and the `rss-reader` entry in `src-tauri/Cargo.lock`,
  then tag `vX.Y.Z` (see `docs/RELEASING.md`).
