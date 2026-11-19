# Journal — RSS Reader

Newest entries first. The current state is in [`HANDOFF.md`](HANDOFF.md).

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
