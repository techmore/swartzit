#!/usr/bin/env bash
set -euo pipefail

interface_ip() {
  local interface="$1"
  if [[ "$interface" == "loopback" || "$interface" == "localhost" || "$interface" == "lo0" ]]; then
    echo 127.0.0.1
    return 0
  fi
  ipconfig getifaddr "$interface" 2>/dev/null || \
    ifconfig "$interface" 2>/dev/null | awk '$1 == "inet" { print $2; exit }'
}

rows=''
add_option() {
  local id="$1" label="$2" interface="$3" ip="$4" kind="$5"
  [[ -n "$ip" ]] || return 0
  rows="${rows}${id}"$'\t'"${label}"$'\t'"${interface}"$'\t'"${ip}"$'\t'"${kind}"$'\n'
}

add_option loopback Loopback lo0 127.0.0.1 loopback

wifi_interface="${SWARTZIT_WIFI_INTERFACE:-en0}"
wifi_ip="$(interface_ip "$wifi_interface" || true)"
if [[ -z "$wifi_ip" && "$wifi_interface" == "en0" ]]; then
  wifi_interface=en1
  wifi_ip="$(interface_ip "$wifi_interface" || true)"
fi
add_option wifi 'Wi-Fi/LAN' "$wifi_interface" "$wifi_ip" wifi

ethernet_interface="${SWARTZIT_ETHERNET_INTERFACE:-en1}"
ethernet_ip="$(interface_ip "$ethernet_interface" || true)"
if [[ "$ethernet_interface" != "$wifi_interface" ]]; then
  add_option ethernet Ethernet "$ethernet_interface" "$ethernet_ip" ethernet
fi

vpn_interface=''
vpn_ip=''
if command -v tailscale >/dev/null 2>&1; then
  vpn_ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  [[ -n "$vpn_ip" ]] && vpn_interface=tailscale
fi
if [[ -z "$vpn_ip" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    vpn_interface="${line%%$'\t'*}"
    vpn_ip="${line#*$'\t'}"
    break
  done < <(ifconfig 2>/dev/null | awk '/^utun[0-9]+:/{iface=$1; sub(":", "", iface)} iface && /inet /{print iface "\t" $2}')
fi
add_option vpn VPN "${vpn_interface:-utun}" "$vpn_ip" vpn

for interface in $(ifconfig -l 2>/dev/null || true); do
  if [[ "$interface" =~ ^(en|bridge|utun)[0-9]+$ ]]; then
    if [[ "$interface" != "$wifi_interface" && "$interface" != "$ethernet_interface" && "$interface" != "${vpn_interface:-}" ]]; then
      ip="$(interface_ip "$interface" || true)"
      add_option "$interface" "Interface $interface" "$interface" "$ip" interface
    fi
  fi
done

if [[ "${1:-}" == "--json" ]]; then
  node -e 'const rows=String(process.argv[1]||"").split("\n").filter(Boolean); console.log(JSON.stringify(rows.map(row=>{const [id,label,iface,ip,kind]=row.split("\t"); return {id,label,interface:iface,ip,kind};})));' "$rows"
  exit 0
fi

echo 'Swartzit web bind interfaces'
while IFS=$'\t' read -r id label interface ip kind; do
  [[ -n "$id" ]] || continue
  printf '  %-10s %s (%s, %s)\n' "$id" "$label" "$interface" "$ip"
done <<< "$rows"
echo 'The API remains loopback-only unless SWARTZIT_API_INTERFACE is configured.'
