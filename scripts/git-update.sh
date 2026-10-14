#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "nvm was not found at $NVM_DIR/nvm.sh; cannot select the project Node version." >&2
  exit 1
fi

# Noninteractive task shells do not load ~/.bashrc, so initialize nvm here.
source "$NVM_DIR/nvm.sh"
nvm use

exec node "$(dirname "${BASH_SOURCE[0]}")/git-update.js" "$@"
