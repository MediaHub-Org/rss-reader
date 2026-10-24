#!/usr/bin/env bash
# Windows-side entry point, called by "Launch RSS Reader.bat":
#   wsl bash scripts/launch-wsl.sh [args passed to npm start]
#
# A fresh `wsl` shell here is non-interactive, so ~/.bashrc (which puts
# node/npm on PATH) never runs. Add the toolchain explicitly, then hand over
# to `npm start`, which rebuilds if needed, serves the app and opens it.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/node/bin:$PATH"

if ! command -v npm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

exec npm start -- "$@"
