# Signing and distribution

The current builds are **unsigned** on Windows and macOS. They install over the
previous version, but the operating system may show a SmartScreen or Gatekeeper
warning. Android uses a committed debug keystore so updates install over earlier
builds, but it is not a Play Store key.

This page lists what is needed when those credentials exist. Nothing here is
required for the local-first app to work.

## Windows (Authenticode)

You need one of:

- an OV/EV code-signing certificate exported as `.pfx`, or
- Azure Trusted Signing.

Recommended GitHub secrets:

- `WINDOWS_CERTIFICATE_PFX` — base64 of the `.pfx`
- `WINDOWS_CERTIFICATE_PASSWORD` — its password
- `WINDOWS_CERTIFICATE_THUMBPRINT` — repository variable, not a secret

In CI, import the certificate into the runner's certificate store before
`tauri build`, then configure Tauri's Windows signing:

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "<thumbprint>",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

Alternatively use `bundle.windows.signCommand` with a cloud signing CLI.

Without a certificate, SmartScreen will keep showing “Unknown publisher”. That
does not require uninstalling, but it does reduce trust.

## macOS (Developer ID + notarization)

You need an Apple Developer account and a **Developer ID Application**
certificate exported as `.p12`.

GitHub secrets:

- `APPLE_CERTIFICATE` — base64 of the `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: Name (TEAMID)`
- `APPLE_ID`
- `APPLE_PASSWORD` — app-specific password
- `APPLE_TEAM_ID`

Import the certificate into a temporary keychain on the macOS runner before
building. Tauri then signs the `.app`/`.dmg` and submits it for notarization.
Without this, macOS requires right-click → Open the first time.

## Android / Play Store

The repository ships a stable debug keystore at
`src-tauri/gen/android/app/rss-reader-debug.keystore`. It is fine for sideloaded
updates but not for Play Store distribution.

For Play Store:

- create an upload keystore and keep it outside the repository;
- add `PLAY_STORE_KEYSTORE_BASE64`, `PLAY_STORE_KEYSTORE_PASSWORD`,
  `PLAY_STORE_KEY_ALIAS` and `PLAY_STORE_KEY_PASSWORD` as secrets;
- add a Google Play service account JSON as a secret;
- build an `.aab`, sign with the upload key and publish through the Play Developer
  API or a GitHub Action.

The package name must stay `com.mediahub.rssreader` and the version code must keep
increasing (Tauri derives it from the app version).

## Updates

This project intentionally does **not** enable silent auto-update or the Tauri
updater plugin. “Check for updates” only queries GitHub and links to the installer
or APK. Installing the new package replaces the current version; data stays in the
user profile.
