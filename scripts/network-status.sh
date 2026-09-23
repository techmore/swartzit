#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
port="${PORT:-4173}"
echo 'Swartzit network addresses'
echo "  Localhost: http://127.0.0.1:$port"

lan_ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
[[ -z "$lan_ip" ]] && lan_ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -n "$lan_ip" ]]; then
  echo "  Wi-Fi/LAN: http://$lan_ip:$port"
else
  echo '  Wi-Fi/LAN: not detected'
fi

if command -v tailscale >/dev/null 2>&1; then
  tailscale_ips="$(tailscale ip -4 2>/dev/null || true)"
  if [[ -n "$tailscale_ips" ]]; then
    while IFS= read -r ip; do [[ -n "$ip" ]] && echo "  Tailscale: http://$ip:$port"; done <<< "$tailscale_ips"
  fi
fi

utun_ips="$(ifconfig 2>/dev/null | awk '/^utun[0-9]+:/{iface=$1; sub(":","",iface)} iface && /inet /{print $2}')"
if [[ -n "$utun_ips" ]]; then
  while IFS= read -r ip; do [[ -n "$ip" ]] && echo "  VPN ($ip): http://$ip:$port"; done <<< "$utun_ips"
else
  echo '  Other VPN: not detected'
fi

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  Web server: listening on port $port"
else
  echo "  Web server: not listening on port $port"
fi
