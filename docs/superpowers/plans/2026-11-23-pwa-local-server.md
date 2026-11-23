# PWA local server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The installed PWA refreshes every feed without `npm run preview` and without any third-party proxy.

**Architecture:** A dependency-free Node server (`server/app-server.mjs`) serves `dist/` and the existing `proxyFeedRequest` on `/proxy` from one origin, `http://localhost:4173`, on loopback only. The web fetch chain drops the public proxies. A per-user Windows scheduled task starts the server at login.

**Tech Stack:** Node ≥ 22 (`node:http`, `node:fs`), React + TypeScript + Vite, Vitest, Playwright e2e (`scripts/e2e.mjs`), PowerShell 7 `ScheduledTasks` cmdlets.

**Spec:** [`docs/superpowers/specs/2026-11-23-pwa-local-server-design.md`](../specs/2026-11-23-pwa-local-server-design.md)

## Global Constraints

- Port **4173**; origin `http://localhost:4173` must not change (the installed PWA's data lives there).
- Listen on `127.0.0.1` and `::1` only; never `0.0.0.0` / unspecified host.
- Allowed `Host` headers: `localhost:4173`, `127.0.0.1:4173`, `[::1]:4173` (port follows the configured port).
- No request from the web build to `allorigins.win`, `corsproxy.io` or `r.jina.ai` — or any host other than the feed origin and the app's own `/proxy`.
- No new npm dependencies.
- Every user-visible string goes through `t()` in `src/lib/i18n.ts` with its Spanish entry.
- Commits: one line, imperative, lowercase after the type (`feat: ...`), ending with the `Co-Authored-By` trailer.
- Do not install the scheduled task on the owner's machine without asking.

## Review Focus

1. **Path traversal through encoded segments** (`/..%2f..%2fpackage.json`, `/%2e%2e/`): must return 404, never a file outside `dist/`. → Task 1 test `refuses encoded traversal`.
2. **A page on another site calling `http://localhost:4173/proxy`** (`Origin: https://evil.example` or `Sec-Fetch-Site: cross-site`): 403, body not returned. → Task 1 test `rejects cross-site proxy calls`.
3. **DNS rebinding** (`Host: evil.example:4173`): 421 for every path. → Task 1 test `rejects foreign Host`.
4. **Port 4173 already taken** (an old `vite preview` still running): the server exits non-zero with a readable message, and `npm start` still opens the app when whatever is on 4173 serves it. → Task 1 test `reports EADDRINUSE`.
5. **Server down while the PWA is open:** refresh shows "local app server is not running", not a raw CORS message, and makes exactly two requests. → Task 2 test.

---

### Task 1: App server (static + `/proxy`, loopback, origin guards)

**Files:**
- Create: `server/app-server.mjs`, `server/app-server.d.mts`
- Create: `server/app-server.test.ts` (first line `// @vitest-environment node`)
- Modify: `vitest.config.ts` — `include: ['src/**/*.test.ts', 'server/**/*.test.ts']`
- Modify: `package.json` — add `"serve": "node server/app-server.mjs"`

**Interfaces:**
- Produces:
  - `createAppHandler(opts: { root: string; port: number; proxy?: typeof proxyFeedRequest }): (req, res) => Promise<void>` — `proxy` injectable for tests.
  - `startAppServer(opts: { root: string; port?: number /* 4173 */ }): Promise<http.Server[]>` — one server per loopback address; `::1` failing with `EADDRNOTAVAIL`/`EAFNOSUPPORT` is skipped; `EADDRINUSE` rejects with `Error('Port 4173 is already in use …')`.
  - CLI: `node server/app-server.mjs` → `root = <repo>/dist`, `PORT` env overrides; if `dist/index.html` is missing, print `dist/ is missing — run "npm run build" first.` and exit 1; on `EADDRINUSE` print the message and exit 1.

- [ ] **Step 1: Write the failing tests** in `server/app-server.test.ts`. Build a temp `root` with `index.html`, `sw.js`, `assets/app-abc123.js`, and a `secret.txt` one level above `root`. Start `createAppHandler` on an ephemeral `http.createServer` and request with `node:http` so `Host`/`Origin` can be set:
  - `serves index.html at /` → 200, `text/html`, `Cache-Control: no-cache`.
  - `falls back to index.html for unknown routes` → `GET /feeds/x` 200 with index body; `GET /assets/missing.js` 404 (no fallback under `assets/`).
  - `caches hashed assets` → `/assets/app-abc123.js` `Cache-Control: public, max-age=31536000, immutable`, `text/javascript`.
  - `never caches the service worker` → `/sw.js` `Cache-Control: no-cache`.
  - `refuses encoded traversal` → `/..%2fsecret.txt`, `/%2e%2e/secret.txt`, `/assets/..%5c..%5csecret.txt` all 404 and body ≠ secret.
  - `rejects foreign Host` → `Host: evil.example:<port>` on `/` and `/proxy?url=…` → 421.
  - `rejects cross-site proxy calls` → `/proxy?url=https://example.com/f.xml` with `Origin: https://evil.example` → 403; with `Sec-Fetch-Site: cross-site` → 403; injected `proxy` never called.
  - `proxies same-origin requests` → with `Origin: http://localhost:<port>` (and with no `Origin`), injected `proxy` resolves `{status:200, contentType:'application/xml', body:'<rss/>'}` → 200, body `<rss/>`, `Cache-Control: no-store`, **no** `Access-Control-Allow-Origin` header.
  - `listens on loopback only` → `startAppServer({root, port: 0})`… every `server.address().address` ∈ {`127.0.0.1`, `::1`}.
  - `reports EADDRINUSE` → occupy a port on `127.0.0.1`, `startAppServer({root, port})` rejects with `/already in use/`.

- [ ] **Step 2: Run and verify they fail** — `npx vitest run server/app-server.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `server/app-server.mjs`.** Decode the path with `decodeURIComponent`, reject on decode error or a NUL byte, `path.resolve(root, '.' + pathname)` and require the result to start with `root + path.sep` (or equal `root/index.html`). MIME map: `.html .js .mjs .css .json .webmanifest .svg .png .ico .woff2 .txt`. Host check first, before routing. Cross-site rule for `/proxy`: reject when `Sec-Fetch-Site` is `cross-site` or `same-site`, or when `Origin` is present and not one of the allowed origins. `GET`/`HEAD` only (405 otherwise). Add the `.d.mts` declarations matching the Interfaces block.

- [ ] **Step 4: Run tests** — `npx vitest run server/app-server.test.ts` → PASS; `npm run test:unit` → all pass.

- [ ] **Step 5: Manual smoke** — `npm run build; npm run serve`, then `curl -s -o NUL -w "%{http_code}" http://localhost:4173/` → `200` and `curl -s "http://localhost:4173/proxy?url=https%3A%2F%2Fwww.debian.org%2FNews%2Fnews"` returns XML. Stop the server.

- [ ] **Step 6: Commit** — `feat: add a loopback app server that serves the pwa and its feed proxy`

### Task 2: Web fetch chain without third parties

**Files:**
- Modify: `src/lib/fetchFeed.ts:19-28,101-169`
- Modify: `src/lib/fetchFeed.test.ts`
- Modify: `src/lib/i18n.ts` (new entry)

**Interfaces:**
- Produces: `type Via = 'native' | 'direct' | 'local-proxy'` (`'public-proxy'` removed — fix any reference the typechecker finds).

- [ ] **Step 1: Write failing tests** in `src/lib/fetchFeed.test.ts`:
  - `never contacts a public proxy` → fetch mock: direct rejects `TypeError`, proxy returns 502 → `fetchFeedDocument(url)` rejects; `fetchMock` called exactly 2 times; no call URL matches `/allorigins|corsproxy|jina/`.
  - `explains a stopped local server` → direct and proxy both reject `TypeError('Failed to fetch')` → rejects with message matching `/local app server is not running/i`; called exactly 2 times.
- [ ] **Step 2: Run** `npx vitest run src/lib/fetchFeed.test.ts` → the two new tests FAIL.
- [ ] **Step 3: Implement.** Delete `PUBLIC_PROXIES` and its spread; update the header comment (two hops). When the `local-proxy` attempt fails with a network error (`TypeError`) or 404, throw `FeedFetchError(t('The local app server is not running. Start it with npm start, or install the autostart task (scripts/windows/install-autostart.ps1).'))`. Spanish: `'El servidor local de la app no está en marcha. Arráncalo con npm start o instala la tarea de autoarranque (scripts/windows/install-autostart.ps1).'`
- [ ] **Step 4: Run** `npm run typecheck` and `npm run test:unit` → PASS.
- [ ] **Step 5: Commit** — `feat: drop the public feed proxies from the web build`

### Task 3: Launcher, standalone proxy, Services copy, CI and docs

**Files:**
- Modify: `scripts/launch.mjs` — spawn `server/app-server.mjs` (detached, `windowsHide: true`) instead of `vite preview`; error text says `Check "npm run serve".`
- Modify: `server/proxy.mjs` — `server.listen(PORT, '127.0.0.1', …)`; `ALLOW_ORIGIN` default `http://localhost:4173`.
- Modify: `src/components/settings/ServicesPanel.tsx:50-55`, `src/lib/i18n.ts`
- Modify: `scripts/e2e.mjs` (local-only block near line 849), `scripts/verify-pwa.mjs` header, `.github/workflows/ci.yml:59-66` (start `node server/app-server.mjs` with `PORT=4173`; wait loop unchanged; log file renamed)
- Modify: `README.md:30-39,144-155,176-183`, `AGENTS.md` (Commands), `docs/RELEASING.md:25`, `vite.config.ts:11-17` comment, `package.json` keep `preview` (still used for ad-hoc dev)

**Interfaces:**
- Consumes: Task 1 CLI (`node server/app-server.mjs`, `PORT` env).

- [ ] **Step 1: Write the failing e2e assertion** in the local-only block: `'Services says feeds never go through a third party'` → `/no third-party proxy/i.test(servicesText)`.
- [ ] **Step 2: Implement copy.** Wrap both notes in `t()`. Web text: `'The installed web/PWA build fetches feeds through its own local server on this device (localhost:4173), which starts at login once the autostart task is installed. No third-party proxy is used; cached articles stay readable offline.'` Spanish: `'La PWA instalada obtiene los feeds a través de su propio servidor local en este equipo (localhost:4173), que arranca al iniciar sesión cuando la tarea de autoarranque está instalada. No se usa ningún proxy de terceros; los artículos guardados se pueden leer sin conexión.'` Add a Spanish entry for the existing desktop sentence too.
- [ ] **Step 3: Launcher + proxy + CI + docs** as listed in Files. README web/PWA section: `npm run build`, `npm start` (or the autostart task) instead of `npm run preview`; drop the public-proxy sentence at 176-177.
- [ ] **Step 4: Verify** — `npm run typecheck`, `npm run test:unit`; with `npm run dev` on :5173, `npm run test:e2e` → all pass (176). Then `npm run build`, `npm run serve` and `npm run test:pwa` (the offline-reload check is known to fail locally on this machine — record it; everything else must pass). `npm start -- --no-open` with the server already up prints `Ready`.
- [ ] **Step 5: Commit** — `feat: launch the pwa from the app server and say no third party is used`

### Task 4: Windows autostart task

**Files:**
- Create: `scripts/windows/install-autostart.ps1`, `scripts/windows/uninstall-autostart.ps1`, `scripts/windows/README.md`
- Modify: `README.md` (PWA section: one paragraph + macOS/Linux note: run `npm run serve` from a login item / systemd user unit)

**Interfaces:**
- Consumes: Task 1 CLI.
- Produces: scheduled task named `RSS Reader app server`, current user, no elevation.

- [ ] **Step 1: Implement install.** `Set-StrictMode -Version Latest`, `$ErrorActionPreference = 'Stop'`. Resolve repo root from `$PSScriptRoot`; require `dist/index.html` (else tell the user to run `npm run build`) and `(Get-Command node).Source`. Action: `conhost.exe --headless "<node>" "<repo>\server\app-server.mjs"`, working dir = repo. Trigger: `-AtLogOn -User $env:USERNAME`. Settings: `-RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew`. Principal: `-LogonType Interactive -RunLevel Limited`. Re-running replaces the task (`-Force`). `-StartNow` switch starts it immediately and waits ≤ 10 s for `http://localhost:4173/` → prints `Ready`.
- [ ] **Step 2: Implement uninstall.** Stop the task, `Unregister-ScheduledTask -Confirm:$false`, then stop any `node` whose command line contains `server\app-server.mjs` in this repo. Idempotent: no task → `Nothing to remove.`
- [ ] **Step 3: Verify without touching the owner's setup** — parse both scripts: `pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/windows/install-autostart.ps1)) | Out-Null"` (same for uninstall) → no error. Then check the launch line itself by hand: `conhost.exe --headless <node> server\app-server.mjs` with `PORT=4199` starts with no visible window and answers on `http://localhost:4199/`; stop it. The real install happens only after the owner approves.
- [ ] **Step 4: Commit** — `feat: add a windows login task that keeps the app server running`

### Task 5: Handoff

- [ ] Update `docs/agent/HANDOFF.md` (State, Checks, Next: "owner: approve installing the autostart task; then log out/in, open the PWA, refresh, confirm in DevTools that no request leaves for a third party") and prepend `docs/agent/JOURNAL.md`. Commit `docs: record the local app server for the pwa`. No push, no release.
