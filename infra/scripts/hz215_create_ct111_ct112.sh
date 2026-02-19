#!/usr/bin/env bash
set -euo pipefail

# Rulare: pe hostul Proxmox `hz.215`.
# Scop: creeaza 2 LXC pentru Neanelu:
# - CT111 (prod)  IP 10.0.1.111/24
# - CT112 (staging) IP 10.0.1.112/24
#
# Aliniere platforma:
# - bridge: vmbr4000 (VLAN 4000)
# - gateway: 10.0.1.7 (hz.247 NAT)
# - MTU: 1400
#
# IMPORTANT:
# - Nu adaugam IP-uri noi pe hosturi; doar definim IP/gw la nivel de CT.
# - Dupa create, egress-ul catre internet este asigurat prin reguli iptables ADITIVE pe hz.247 (pas separat).

CT_STORAGE="${CT_STORAGE:-local}"
CT_TEMPLATE="${CT_TEMPLATE:-local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst}"
CT_BRIDGE="${CT_BRIDGE:-vmbr4000}"
CT_GW="${CT_GW:-10.0.1.7}"
CT_MTU="${CT_MTU:-1400}"

create_ct() {
  local ct_id="$1"
  local hostname="$2"
  local ip="$3"

  if pct status "$ct_id" >/dev/null 2>&1; then
    echo "CT $ct_id already exists; skipping create"
    return 0
  fi

  echo "Creating CT $ct_id ($hostname) ..."
  pct create "$ct_id" "$CT_TEMPLATE" \
    --hostname "$hostname" \
    --cores 8 \
    --memory 32768 \
    --swap 2048 \
    --rootfs "${CT_STORAGE}:100" \
    --unprivileged 1 \
    --features nesting=1,keyctl=1 \
    --net0 "name=eth0,bridge=${CT_BRIDGE},ip=${ip}/24,gw=${CT_GW},mtu=${CT_MTU}" \
    --onboot 1 \
    --start 1

  echo "CT $ct_id created and started."
}

main() {
  if ! command -v pct >/dev/null 2>&1; then
    echo "ERROR: pct not found. Run this on Proxmox host hz.215." >&2
    exit 1
  fi

  create_ct "111" "neanelu-prod" "10.0.1.111"
  create_ct "112" "neanelu-staging" "10.0.1.112"

  echo
  echo "Next steps:"
  echo "- Verify: pct config 111; pct config 112"
  echo "- Verify egress from CTs AFTER hz.247 iptables rules are applied (FAZA 0 - Pas 0.002)."
}

main "$@"

