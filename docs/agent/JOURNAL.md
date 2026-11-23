# Journal — RSS Reader

Newest entries first. The current state is in [`HANDOFF.md`](HANDOFF.md).

## 2026-11-23

- **PWA without preview or third-party proxies** (branch `feat/pwa-local-server`,
  `473c122..c5a7fb7`, not merged). New `server/app-server.mjs` serves `dist/` and
  `/proxy` on `localhost:4173` (same origin as before, so installed-PWA data is
  kept), loopback only, with Host and caller guards shared with `proxy.mjs` via
  `server/guards.mjs`; proxied HTML/SVG is downgraded to text with nosniff and a
  sandbox CSP. allorigins/corsproxy.io/r.jina.ai removed from `fetchFeed.ts`;
  a stopped server now says so. `npm start` and CI use the app server.
  `scripts/windows/install-autostart.ps1`/`uninstall-autostart.ps1` add/remove a
  per-user login task (`conhost --headless`); **not installed** on this machine.
  Final Opus review: 3 Important fixed with failing-first tests; 8 minors deferred
  (listed in HANDOFF). Unit 128/128, e2e 176/176, test:pwa 15/16 (known local
  offline-reload failure).
- **Local-only decision.** The owner chose to stay local permanently: no sync
  provider and no paid service. Removed the provider selector, the server/username
  fields and the session password from Services; removed `SyncService` and the
  `sync*` preferences; `loadPreferences` and backup parsing drop legacy sync fields.
  Services now explains that OPML or a full backup is the way to move data.
- 105 unit tests pass, including a legacy-backup test; e2e replaced the selector
  checks with local-only assertions. Typecheck and build pass.

## 2026-11-22

- **Reading position per article.** The owner picked it from the three candidates.
  `src/lib/readingPosition.ts` keeps `rss-reader:positions` in localStorage:
  `{ y, at }` per article id, capped at 300 entries in least-recently-written
  order, written on a 250 ms timer and flushed when the reader closes. The overlay
  restores the offset on open and clamps it to `scrollHeight - clientHeight`, so a
  narrower window or an article opened last time with full content does not jump.
  The "open at the top" effect in `App.tsx` is gone.
- Unit tests cover rounding, the negative/NaN guard, the cap, corrupt JSON and the
  clamp; e2e scrolls with a temporary filler, asserts the stored offset for the
  active id, and asserts reopening lands on `min(220, max)`.
- `typecheck`, 104 unit and 175 e2e pass.
- **Reader centres over the news column.** `--article-overlay-shift` on
  `.article-overlay__backdrop` (sidebar width on desktop, `0` for the drawer
  below 68.75rem and for a collapsed sidebar); the arrows offset by half of it.
  The backdrop still covers the sidebar, so the blur and the click-to-close area
  are unchanged. The viewport-centred e2e check became a content-area check that
  also proves the panel is more than 50px off the window centre. Typecheck, 97
  unit and 173 e2e pass.

## 2026-11-19

- **0.13.21 released** (`0af09cd`, tag `v0.13.21`): Windows x64, macOS arm64,
  Linux AppImage and Android arm64, plus `SHA256SUMS.txt`; CI green on the tag
  and the Windows installer hash verified against the checksum file. Bumped the
  five version spots (the four in `docs/RELEASING.md` plus the root version in
  `package-lock.json`). Local `test:pwa` fails only on this Windows machine at
  the offline reload (`ERR_FAILED`); `sw.js` and `main.tsx` are unchanged since
  v0.13.20 and the same test passes in CI.
- Reader overlay committed (`c7ecd10`): every layout opens the article over a
  blurred dashboard, not only card and magazine. README and the list-view e2e
  expectation follow the change. Verified with typecheck, 97 unit and 165 e2e.
- All nine open Dependabot PRs squash-merged (#13, #14, #16–#22). `npm ci` after
  the lockfile changes; Rust fmt, clippy and tests pass with `rfd` 0.18.
- Keyboard and accessibility work (`6e7a9a9`): `s` stars, `1`–`4` switch layouts,
  `?` opens the shortcut reference, the overlay announces its position and the
  arrows expose `aria-keyshortcuts`. The unreachable split pane and its CSS were
  removed. E2e grows from 165 to 173 checks.
- Project docs added (`AGENTS.md`, this folder) because the repository had no
  agent entry point; state now survives between harnesses.
