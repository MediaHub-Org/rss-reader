# Windows helpers

PowerShell scripts for running the RSS Reader on Windows. They assume
Windows 10/11, Node.js 20+ on `PATH` and a built `dist/` (`npm run build`).

| Script | What it does |
|---|---|
| `install-autostart.ps1` | Registers the per-user scheduled task **RSS Reader app server**. At login it runs `server\app-server.mjs` with no window (`conhost.exe --headless`), so the installed PWA can refresh feeds on `http://localhost:4173` without `npm start`. Loopback only, no third-party proxy, no admin rights. `-StartNow` also starts it and waits for the app. Re-running replaces the task. |
| `uninstall-autostart.ps1` | Stops and removes the task and any running app server from this repo. Safe to run twice. |

```powershell
npm run build
pwsh -NoProfile -File scripts\windows\install-autostart.ps1 -StartNow
# later
pwsh -NoProfile -File scripts\windows\uninstall-autostart.ps1
```

After pulling a new version, run `npm run build` again; the task serves whatever
is in `dist/`. The task runs the repository in place, so moving the folder means
installing the task again.

On macOS or Linux, run `npm run serve` from a login item or a systemd user unit.
