#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "nvm was not found at $NVM_DIR/nvm.sh; cannot select the project Node version." >&2
  exit 1
fi

# Noninteractive task shells do not load ~/.bashrc, so initialize nvm here.
source "$NVM_DIR/nvm.sh"

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_version="$(tr -d '[:space:]' < "$project_root/.nvmrc")"
if [[ -z "$expected_version" ]]; then
  echo "The project .nvmrc is empty; cannot verify the Node runtime." >&2
  exit 1
fi

# `nvm use` is synchronous, but task terminals can be started before their
# shell setup has settled. Retry once, then verify the exact project runtime
# before the interactive commit-message editor can receive input.
for attempt in 1 2; do
  nvm use
  if [[ "$(node --version)" == "v$expected_version" ]]; then
    printf 'Verified Node v%s; opening the commit-message review.\n' "$expected_version"
    exec node "$project_root/scripts/git-update.js" "$@"
  fi

  if [[ "$attempt" -eq 1 ]]; then
    printf 'Node is not v%s yet; waiting one second before checking nvm again.\n' "$expected_version" >&2
    sleep 1
  fi
done

echo "nvm did not activate Node v$expected_version; refusing to start git:update." >&2
exit 1
