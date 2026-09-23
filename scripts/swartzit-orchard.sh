#!/usr/bin/env bash
set -euo pipefail

action="${1:-status}"
json=0
[[ "${2:-}" == "--json" ]] && json=1
BREW="${SWARTZIT_BREW:-$(command -v brew 2>/dev/null || true)}"
if [[ -z "$BREW" ]]; then
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x "$candidate" ]] && BREW="$candidate" && break
  done
fi

app_installed=0
for app in "/Applications/Orchard.app" "$HOME/Applications/Orchard.app"; do
  [[ -d "$app" ]] && app_installed=1
done
if command -v mdfind >/dev/null 2>&1 && mdfind 'kMDItemCFBundleIdentifier == "container-compose.Orchard"' 2>/dev/null | grep -q .; then
  app_installed=1
fi

brew_installed=0
if [[ -n "$BREW" ]] && ("$BREW" list --cask orchard >/dev/null 2>&1 || "$BREW" list --versions orchard >/dev/null 2>&1); then
  brew_installed=1
fi

container_cli=0
command -v container >/dev/null 2>&1 && container_cli=1

case "$action" in
  status)
    if (( json )); then
      node -e 'console.log(JSON.stringify({app_installed:process.argv[1]==="1",homebrew_installed:process.argv[2]==="1",container_cli_installed:process.argv[3]==="1"}))' "$app_installed" "$brew_installed" "$container_cli"
    else
      printf 'Orchard app:             %s\n' "$([[ $app_installed == 1 ]] && echo installed || echo not-found)"
      printf 'Homebrew cask:           %s\n' "$([[ $brew_installed == 1 ]] && echo installed || echo not-found)"
      printf 'Apple container CLI:     %s\n' "$([[ $container_cli == 1 ]] && echo available || echo not-found)"
    fi
    ;;
  install)
    [[ "${2:-}" == "--yes" ]] || { echo 'Installing Orchard uses Homebrew. Re-run as: swartzit orchard install --yes' >&2; exit 2; }
    [[ -n "$BREW" ]] || { echo 'Homebrew is required to install Orchard.' >&2; exit 1; }
    "$BREW" install orchard
    ;;
  open)
    open -g 'orchard://dashboard'
    ;;
  *)
    echo 'Usage: swartzit orchard {status [--json]|install --yes|open}' >&2
    exit 2
    ;;
esac
