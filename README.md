# RSS Reader

[![CI](https://github.com/MediaHub-Org/rss-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/MediaHub-Org/rss-reader/actions/workflows/ci.yml)

A lightweight, **local-first** RSS/Atom reader for the desktop browser. No account, no
backend, no telemetry — subscriptions, read state and preferences live in your own
browser storage.

Built from the Fluent Reader / FluentFlame / Folo aesthetic: clean, fast, minimal.

---

## Quick start

```bash
npm install
npm start             # build if stale → serve :4173 → open the app
npm run dev           # http://localhost:5173 (hot reload)
```

Production build and static hosting:

```bash
npm run build        # tsc + vite build → dist/
npm run preview      # serve the build (includes the feed proxy)
```

Serving `dist/` from any static host? Run the standalone proxy alongside it and set the
app to use it (the app already falls back to a public proxy if no local one is present):

```bash
npm run proxy         # http://localhost:8788/proxy?url=<encoded feed url>
VITE_PROXY_URL=http://localhost:8788/proxy npm run build
```

## Launching it easily

**One command — recommended:**

```bash
npm start
```

It rebuilds only when the sources changed, starts the app server in the background
*only if it isn't already running*, waits for it, then opens
http://localhost:4173. Running it again while the server is up just opens the app.
(`--no-open` skips opening the browser, for scripts/CI.)

**Double-click (Windows):** `Launch RSS Reader.bat` in the project folder, or
the **RSS Reader** icon on your Desktop. Runs `node scripts\launch.mjs` directly
with Windows node (no WSL) — `node_modules` here holds Windows-native
rollup/esbuild binaries, so that's the toolchain that actually works; routing
through WSL's Linux node instead fails on a missing
`@rollup/rollup-linux-x64-gnu`. The window stays open and pauses on failure so
you can read the error, instead of flashing closed. Create or refresh the
Desktop shortcut with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1
```

**Which shortcut should you actually use?**

| Entry point | Use it for |
|---|---|
| **Installed PWA icon** (below) | Daily reading — own window, no browser chrome, instant start, works offline |
| **Desktop shortcut / `npm start`** | Bringing the local server up — feed fetching always needs it |
| Browser bookmark of `localhost:4173` | Zero-install fallback if you don't want a PWA |

The installed app opens even with the server stopped (its shell is precached) — only
feed refreshes fail until you start the server again.

## Install it as an app

The production build is an installable PWA (manifest + service worker), so it runs in
its own window, starts instantly, and keeps working offline:

```bash
npm run build
npm run preview       # http://localhost:4173
```

Open that URL in Chrome/Edge and use **Install** in the address bar (or ⋮ → *Install
page as app…*); on macOS Chrome it is *File → Install "RSS Reader"*. The installed app
gets its own window and dock/taskbar icon, and boots from the precached shell even with
no network — only feed refreshes need connectivity.

Icons are generated from one SVG source (`npm run icons`).

Run the test suites (`npm run dev` for the first, `npm run build && npm run preview`
for the second):

```bash
npm run test:unit     # Vitest: backoff, feed ids, OPML/backup parsing
npm run test:e2e      # end-to-end smoke tests against bundled fixture feeds → test-artifacts/
npm run test:pwa      # installability + offline checks
npm run check         # typecheck + unit tests + Rust fmt/clippy/tests
```

CI runs the web suite on Ubuntu and the Rust checks + Windows installer build on
Windows (`.github/workflows/ci.yml`).

---

## Desktop app (Tauri)

The same UI ships as a native desktop app (Tauri 2 + the system WebView). There is
no Node process, no local server and no CORS proxy at runtime: feed requests are made
from Rust (`fetch_feed`) with the same SSRF/HTTPS/size guards as the web proxy, and
external links open in your default browser.

```bash
npm run desktop:dev            # dev window, hot reload
npm run desktop:build          # Windows installer → src-tauri/target/release/bundle/nsis/
```

Prerequisites: Rust (MSVC toolchain) and WebView2 on Windows. Linux/macOS builds use
the same commands on those systems (WebKitGTK / WKWebView; Linux media codecs are the
one thing to verify per distro). The Windows installer is unsigned for now, so
SmartScreen may ask for confirmation.

The desktop origin is different from `localhost:4173`, so the first run starts empty.
Export a **full backup** from the web/PWA version and import it to keep feeds,
folders, read state, preferences and cached articles.

The desktop app also keeps the newest **seven daily snapshots** under its data folder
(`…\com.mediahub.rssreader\backups`). **Settings → Data → Backups** can create one on
demand, restore a snapshot (replace) or delete old ones.

Desktop extras (Settings → General):

- **Tray icon** with Open / Refresh feeds / Quit, an unread tooltip, and left-click to
  show the window.
- **Close to tray** (opt-in) and periodic refresh that keeps running while hidden.
- **Native notifications** for new articles while the window is in the background,
  batched across feeds; mute individual feeds from their context menu.
- **Start at login** (opt-in).

---

## Features

**Feeds** — subscribe by URL or by website (the alternate feed link is discovered
automatically), validate before fetching, per-feed error state, unsubscribe with
confirmation, unread badges, favicons with a letter-avatar fallback. Desktop refresh
uses HTTP validators (ETag / Last-Modified) so unchanged feeds return 304 and keep
their cache; a failing feed backs off from 5 minutes to 6 hours, and the manual
refresh buttons force an immediate retry.

**Folders & sidebar** — A–Z folders with feeds A–Z inside, filter a view by folder,
create empty folders, add/rename/move/delete feeds and folders, drag-resize the
sidebar (desktop), and a resizable toolbar with feed sort order and a single
collapse/expand-all control. Each folder row has two targets: its caret (on the
left) is the **only** thing that expands or collapses the feed list, while the name
filters the view by that folder without changing the collapse state, so clicking a
collapsed folder never pops its list open and reading never hides it by accident.
Collapsed folders persist across reloads. On mobile the feed list is an off-canvas
drawer that closes after you pick something.

**Right-click actions** — feed, folder, article card and article-link context menus:
open, refresh, mark read/unread, copy URL, rename, move, add a feed to a folder,
collapse/expand, delete and more. Menus are keyboard-navigable and render at the
cursor even over the transformed mobile drawer. “Move to folder…” opens a searchable
picker (type to filter, ↑/↓ then Enter) instead of a menu that grows one row per
folder; “New folder…” can create the destination on the spot.

**Reading** — four layouts from the top-bar **View** menu: card grid (default), list,
magazine (featured first story) and compact. Star articles to keep them, and filter the
list to **All articles**, **Unread only** or **Starred only**. Links carry source labels;
article detail renders sanitized HTML with relative-URL resolution against the article
base URL. Read/unread works per article plus bulk **Mark as read** with all / older than
1, 3 or 7 day cutoffs, and sort is by newest / oldest / feed name. In card view the
reader opens in a blurred overlay with previous/next arrows over the list; in the other
views wide screens keep list and article side by side, while narrow windows use the
single-pane list ⇄ detail flow.

**Search** — full-text search over titles, summaries and article bodies with a
**View / All feeds** scope. The `Aa` button attached to the search field toggles
**case-sensitive** matching and **full-text** (off matches only titles, summaries and
authors), both persisted.

**History** — the browser's own back/forward works inside the reader, including a
mouse's side buttons, `Alt+←`/`Alt+→` and the back swipe on Android: it closes the open
article, then returns to the previous feed/folder list, then to *All articles*, instead
of leaving the page. The in-app **Back** button and `Esc` walk the same stack, so
forward still reaches the article afterwards. Jumping between articles with `j`/`k`
reuses one history entry, so Back always means “back to the list”, not “previous article”.

**Portability** — export/import **OPML** (standard, subscriptions and folders including
empty ones) and a **full JSON backup** (subscriptions, folders, read status, starred
articles, preferences *and* every cached article, so a new device/origin can be rebuilt
without refetching; the YouTube API key is deliberately not included). Import
validates the file, previews what it found, skips duplicates, and rejects invalid
`javascript:` URLs. The **OPML XML** editor shows a diff (added / updated / removed)
before replacing your subscriptions. **Manage** splits into **Feeds** and **Folders**:
each has its own select-all/none, **Move selected…** (same searchable picker) and
**Delete selected**, with one combined inline confirmation. Moving folders merges them
— their feeds go to the destination and the empty folder disappears. On desktop,
**Backups** keeps rotating automatic snapshots and restores them with one click.

**Media** — YouTube URLs are detected in titles, links and content (no API key; the id
is parsed from the URL), and **Vimeo, Spotify, SoundCloud, Deezer and Apple
Podcasts/Music** links open in the provider's own keyless embed instead of a redirect:
16:9 players for video, a fixed-height widget for audio. Detection also looks inside
the article body, so a Spotify link in prose plays in place, and clicking any provider
link while reading swaps the player above the text (modifier-clicks still open a tab).
Cards show a play/music badge over the thumbnail, or a branded band when the feed has
no artwork. Turn *Play media inline* off in Settings to open these links in a new tab
instead. An optional YouTube Data API key raises channel/playlist feeds from ~15 to 50
items. Podcast audio enclosures render a native inline player as well.

**Customization** — light/dark/system theme, comfortable/compact list density, reader
font size, view mode and article filter. All persisted in `localStorage` and applied
before first paint (no theme flash).

**Accessibility** — labelled controls, focus-trapped modal dialogs, skip link, visible
focus rings, keyboard navigation throughout.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` or `↓` / `↑` | Move through articles |
| `←` / `→` | Previous / next article (card overlay too) |
| `Enter` / `o` | Open the selected article |
| `m` | Toggle read/unread |
| `r` | Refresh all feeds |
| `/` | Focus search |
| `a` | Add feed |
| `Esc` | Close article / drawer / dialog |
| `Alt+←` / `Alt+→` | Back / forward through views (mouse side buttons too) |

---

## Architecture

```
server/
  proxy-lib.mjs        shared fetch proxy: validation, SSRF guard, HTTPS upgrade, size cap
  proxy.mjs            standalone proxy server (`npm run proxy`)
src-tauri/
  src/fetch.rs         desktop feed fetch: pooled client, ETag/304, redirect/time/size caps
  src/url_policy.rs    URL/SSRF policy + unit tests (private ranges, HTTPS upgrade)
  src/backups.rs       rotating on-disk snapshots + validation/rotation tests
  src/main.rs          tray/window, save dialog, external links and native commands
  tauri.conf.json      window, CSP, installer metadata
src/
  lib/
    feedParser.ts      rss-parser wrapper → normalized Feed/Article types
    fetchFeed.ts       layered CORS strategy + homepage → feed discovery
    sanitize.ts        DOMPurify config: allow-list, relative URLs, safe links
    youtube.ts         video-id extraction (watch, youtu.be, shorts, live, embed)
    embeds.ts          provider detection + keyless embed URLs (Vimeo, Spotify, …, YouTube)
    youtubeApi.ts      optional YouTube Data API path for channel/playlist feeds
    portability/
      index.ts         format detection + public import/export API
      opml.ts          OPML 2.0 export/parse, folder nesting
      backup.ts        JSON v2 full backup (cached articles + preferences)
      download.ts      browser download / native Save adapter
      types.ts         shared feed/import types, URL and folder helpers
    clipboard.ts       clipboard write with a legacy fallback
    desktop.ts         Tauri bridge: native save, external links, environment check
    desktopSettings.ts tray/login preference bridge + native unread tooltip
    notifications.ts   batched new-article notifications + permission handling
    notificationSummary.ts notification title/body builder (unit-tested)
    trayEvents.ts      tray "Refresh feeds" bridge
    backups.ts         desktop snapshots: list/create/read/delete + daily policy
    backoff.ts         retry delay (5 min → 6 h) shared by automatic refresh
    applyImport.ts     shared restore pipeline for Import and Backups
    viewHistory.ts     browser-history bridge: back/forward across views (no router)
    storage.ts         localStorage (prefs/subscriptions/read) + IndexedDB (article cache)
    hash.ts, url.ts, format.ts, feedId.ts
    search.ts          full-text matching (precomputed + legacy fallback)
  store/store.ts       framework-agnostic store (useSyncExternalStore), actions, selectors
  components/          Sidebar, TopBar, ArticleList, ArticleDetail, dialogs (folder picker included), context menu, toasts
  styles/
    theme.css          design tokens: light/dark palettes, density, font size
    app.css            layout and components
    responsive.css     breakpoints and touch/input capability queries
```

### Key decisions

**No backend.** Everything is client-side; state lives in `localStorage`
(subscriptions, read status, preferences) and IndexedDB (cached articles), with a quota
guard that evicts the cache before it can lose your subscriptions. The web build uses
the small local proxy only when CORS blocks a feed; the desktop build makes the same
request natively, with no server at all.

**CORS: layered fetch.** Each feed fetch tries, in order:

1. direct browser fetch (works for CORS-enabled origins),
2. the local proxy (`/proxy` on the dev/preview server, or `VITE_PROXY_URL`),
3. public proxies — last resort only, because they depend on third-party uptime.

The proxy enforces HTTPS-first, validates the URL, blocks private/loopback hosts (SSRF),
follows a bounded number of redirects, and caps responses at 5 MB.

**`rss-parser`, browser-safe.** The spec calls for a real RSS/Atom parser, and
`rss-parser` handles RSS 2.0, RSS 1.0/RDF, Atom and their namespaces correctly. It is a
Node library though: `xml2js`/`sax` touch `require('events')` and
`require('timers').setImmediate` at module load, which Vite stubs out. Two small aliases
fix that without polyfilling all of Node:

```ts
// vite.config.ts
{ find: /^events$/,  replacement: node_modules/events/events.js }  // real EventEmitter
{ find: /^timers$/,  replacement: src/shims/timers.js }            // browser timers
{ find: /^stream$/,  replacement: src/shims/stream.js }            // minimal base class
```

Only `parseString` is ever called — never `parseURL` — so `http`/`https`/`url` are never
reached.

**Sanitization is the XSS boundary.** Feed HTML is untrusted. `DOMPurify` strips
scripts/event handlers/foreign content against an explicit tag and attribute allow-list;
a hook then resolves relative `href`/`src`/`srcset` against the article URL, forces
`target="_blank" rel="noopener noreferrer"` on external links, and drops `javascript:`
URLs.

**Keyless media embeds.** Every supported provider (YouTube, Vimeo, Spotify,
SoundCloud, Deezer, Apple) exposes a public embed URL with no API key or OAuth, so
detection is pure URL parsing and the iframe src is rebuilt from the parsed parts
rather than copied from the feed. Players are on by default; *Play media inline* turns
them off for people who prefer the original site.

**Single user, local only.** No auth, no sync, no multi-tenancy — by design.

**Offline shell.** A production-only service worker precaches the app shell (including
the hashed CSS/JS it references on first load) so an installed app starts with no
network. `/proxy` is deliberately excluded — feed reads are never cached, and hashed
asset lookups use `ignoreVary` because the origin sends `Vary: Origin`, which would
otherwise make CORS-mode subresources miss the cache.

---

## Known limitations

- Read status, preferences and cached articles are per device; the **full JSON backup**
  moves all of them.
- Periodic refresh is 15 minutes while the tab is visible; feeds are also refreshed on
  launch.
- Article view is single-pane below 1100 px; wide windows use the two-pane layout.
- Feed icons depend on the site's favicon resolving; failures fall back to a letter
  avatar.
