# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub's private vulnerability reporting:

https://github.com/MediaHub-Org/rss-reader/security/advisories/new

Include the affected version, steps to reproduce and any relevant logs. You should
receive an acknowledgement within a few days.

## Scope

The app is local-first: subscriptions, read state, rules and cached articles stay on
the device. The web/PWA build contacts feeds and the configured feed proxy; the desktop
build fetches feeds natively with HTTPS-first and private-host blocking. No account,
analytics or telemetry is used.

Reports about feed-content sanitization, URL handling, the desktop fetch policy, the
local proxy or the update/download path are especially useful.
