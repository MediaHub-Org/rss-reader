# Releasing

Releases are built and published by `.github/workflows/ci.yml` when a `v*` tag is
pushed. The tag workflow builds Windows, macOS arm64, Linux AppImage and the Android
APK, then creates a GitHub Release with generated notes and `SHA256SUMS.txt`.

## 1. Bump the version

Keep these in sync:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- the `rss-reader` entry in `src-tauri/Cargo.lock`

Android derives `versionName`/`versionCode` from the Tauri version; do not edit the
generated `tauri.properties` by hand.

## 2. Run the checks

```bash
npm run check
npm run test:e2e     # needs npm run dev on :5173
npm run build
npm run test:pwa     # needs npm run preview on :4173
```

`npm run check` runs TypeScript, Vitest, Rust fmt/clippy and the Rust tests.

## 3. Commit, tag and push

```bash
git add -A
git commit -m "chore: release 0.13.7"
git tag v0.13.7
git push origin main
git push origin v0.13.7
```

The tag push is the release trigger. Do not create the GitHub Release by hand; the
workflow does it and marks it `latest`.

## 4. Verify the release

- All four assets are present.
- `SHA256SUMS.txt` is present and matches the assets.
- The notes include download links and the install-over instructions.
- Install the build over the previous version on at least one platform.

## Signing

Signing is optional and documented in [SIGNING.md](SIGNING.md). Without those
secrets the installers are unsigned but still upgrade in place.

## Updates

There is no silent auto-updater. `About → Check for updates` queries the latest
GitHub release and links to the matching installer/APK. The version in
`package.json` is injected as `__APP_VERSION__` and compared with the release tag.
