#!/usr/bin/env bash
set -euo pipefail

verify=false
if [[ "${1:-}" == "--verify" || "${1:-}" == "-v" ]]; then
  verify=true
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mise_toml="$repo_root/mise.toml"

if [[ ! -f "$mise_toml" ]]; then
  echo "mise.toml not found at $mise_toml" >&2
  exit 1
fi

export CI=true
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_FUND=false
export NPM_CONFIG_UPDATE_NOTIFIER=false
export NPM_CONFIG_CONFIRM_MODULES_PURGE=false
export PNPM_DISABLE_SELF_UPDATE_CHECK=true

echo "Trusting mise config: $mise_toml"
mise trust "$mise_toml"

echo "Installing mise-managed tools"
(
  cd "$repo_root"
  mise install -y
)

echo "Installing APM dependencies"
(
  cd "$repo_root"
  apm install --frozen
)

if [[ "$verify" == true ]]; then
  echo "Verifying mise-managed tools"
  pnpm --version
fi

echo "Setup complete."
