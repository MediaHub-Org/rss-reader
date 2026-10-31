# RSS Reader

[![CI](https://github.com/MediaHub-Org/rss-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/MediaHub-Org/rss-reader/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/MediaHub-Org/rss-reader?label=download)](https://github.com/MediaHub-Org/rss-reader/releases/latest)

A lightweight, **local-first** RSS/Atom reader for Windows and the web. No account, no
backend, no telemetry: subscriptions, read/starred state, rules, preferences and cached
articles stay on your device. Built with React and Tauri, inspired by Fluent Reader.

## Download

**Windows desktop (64-bit):** download the latest installer from
[Releases](https://github.com/MediaHub-Org/rss-reader/releases/latest).

- Requires Windows 10/11 with WebView2.
- The installer is unsigned for now: SmartScreen → **More info** → **Run anyway**.
- Installing over a previous version keeps feeds, read state, stars, rules and cache.

**macOS (Apple Silicon):** download the `.dmg` from Releases. It is unsigned, so
right-click the app → **Open** the first time (or allow it in System Settings → Privacy &
Security).

**Linux:** download the `.AppImage`, make it executable (`chmod +x RSS.Reader_*.AppImage`)
and run it. It needs the distribution's WebKitGTK 4.1/GTK libraries (standard on Ubuntu 22.04+).

**Web / PWA:** build the app and install it from Chrome or Edge:

```bash
npm install
npm run build
npm run preview      # http://localhost:4173 → Install app
```

The installed PWA opens offline but needs the local preview/proxy server for feed
refreshes. The desktop app fetches natively and needs no Node process at runtime.

## Highlights

- **Four layouts** — cards, list, magazine and compact. List keeps the article pane
  beside the rows; magazine and card open the reader as a blurred popup.
- **Filters and search** — all/unread/starred, plus case-sensitive and full-text
  options attached to the search field.
- **Stars and rules** — keep articles, or automatically mark/star new arrivals with
  contains or regex rules scoped to a source or group.
- **Reader tools** — copy link and load the original full article text, cached for the
  session.
- **Local backups** — OPML plus a full JSON backup with subscriptions, folders, read
  state, stars, rules, preferences and every cached article. Desktop keeps seven daily
  snapshots.
- **Media** — YouTube, Vimeo, Spotify, SoundCloud, Deezer and Apple Podcasts play inline
  without API keys.
- **Desktop extras** — tray icon, close-to-tray, background refresh, native
  notifications and start-at-login.

## Features

**Sources and groups.** Subscribe by feed URL or website; the feed link is discovered
automatically. Organize with A–Z folders/groups, resize the sidebar, collapse all, and
bulk-select sources or groups in Settings for move/merge/delete. Feed failures back off
from 5 minutes to 6 hours; manual refresh retries immediately. ETag/Last-Modified
validators keep unchanged feeds on a 304.

**Reading.** Card, list, magazine and compact layouts. Wide windows use two panes for
list/compact; magazine and card use an overlay with previous/next arrows. Article HTML
is sanitized, relative URLs are resolved, and external links open safely in a new tab.
Mark as read works per article, all visible, or older than 1/3/7 days.

**Settings.** Six sections: **Preferences**, **Groups**, **Sources**, **Rules**,
**Services & Integration** and **About**. Theme, density, reading typeface (sans, serif,
mono) and font size live in Preferences. The top bar keeps only reading controls.
Services includes a sync-provider selector (Fever, Feedbin, Inoreader, Miniflux,
Nextcloud News). Server and username are stored locally; the password/token is
session-only. Two-way sync remains future work — use OPML or a full backup today.

**Privacy.** No sync service, account or telemetry. Everything is stored in
`localStorage` and IndexedDB on this device. The web/PWA build only contacts feeds and
the configured proxy; the desktop build fetches feeds from Rust with HTTPS-first,
SSRF/private-host blocking and a 5 MB response cap.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` or `↓` / `↑` | Move through articles |
| `←` / `→` | Previous / next article |
| `Enter` / `o` | Open the selected article |
| `m` | Toggle read/unread |
| `r` | Refresh all feeds |
| `/` | Focus search |
| `a` | Add feed |
| `Esc` | Close article, drawer or dialog |
| `Alt+←` / `Alt+→` | Back / forward through views |

## Development

Requirements: Node 20+; Rust and WebView2 for the desktop build.

```bash
npm install
npm start              # build if stale, serve :4173 and open the app
npm run dev            # http://localhost:5173 with hot reload

npm run build          # production bundle in dist/
npm run preview        # serve dist/ with the local feed proxy

npm run test:unit      # Vitest
npm run test:e2e       # Playwright smoke suite (needs npm run dev running)
npm run test:pwa       # installability + offline check (needs npm run preview)
npm run check          # typecheck + unit tests + Rust fmt/clippy/tests

npm run desktop:dev    # Tauri dev window
npm run desktop:build  # native bundle → src-tauri/target/release/bundle/

# Per-platform bundles:
npm run desktop:build -- --bundles nsis      # Windows installer
npm run desktop:build -- --bundles appimage  # Linux AppImage
npm run desktop:build -- --bundles dmg       # macOS disk image
```

CI runs the web suite on Ubuntu and the Rust checks plus Windows installer build on
Windows. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## How it works

- **Storage:** `localStorage` for preferences, subscriptions, read/starred IDs and rules;
  IndexedDB for cached articles, with a quota guard that evicts cache before state.
- **Fetching:** the web build tries a direct fetch, then the local `/proxy` (or
  `VITE_PROXY_URL`), then public proxies as a last resort. The desktop build makes one
  native Rust request with validators and retry backoff.
- **Security:** feed HTML crosses a DOMPurify allow-list boundary with relative-URL
  resolution and forced safe external links. The proxy and desktop fetcher enforce
  HTTPS-first, block private/loopback hosts and cap responses.
- **Offline shell:** a production service worker precaches the app shell; feed responses
  and `/proxy` are never cached.

Key folders:

```text
src/components/    UI, settings managers and dialogs
src/lib/           fetching, parsing, sanitization, backups, rules, storage
src/store/         framework-agnostic app store and selectors
src-tauri/         Tauri shell, native fetch, tray and snapshots
server/            shared local feed proxy
```

## Known limitations

- State is per device. Use the full JSON backup to move it.
- Automatic refresh runs every 15 minutes while the window is visible, plus on launch.
- Below 1100 px the article view becomes single-pane and the sidebar becomes a right-side drawer.
- The Windows installer and macOS disk image are unsigned; macOS needs a first-run
  right-click → Open.
- Services has a sync-provider selector, but two-way sync is not implemented yet; the
  server and username are stored locally (the password/token is session-only) and
  excluded from backups.
- “Load full content” depends on the page structure and on the proxy being reachable.
