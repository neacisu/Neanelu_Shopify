#!/usr/bin/env bash
set -euo pipefail

# Rulare: manual, pe hostul Proxmox `hz.247` (gateway/NAT).
#
# Scop:
# - aplica (prin copiere + append) regulile Neanelu in `/etc/iptables.rules` in mod aditiv
# - NU modifica regulile existente; necesita review manual inainte de apply.
#
# IMPORTANT:
# - scriptul nu poate fi 100% automat fara context (pozitionare dupa reguli CT110 etc.)
# - foloseste-l ca helper pentru a evita copy/paste gresit; in final se aplica prin `iptables-restore`.

RULES_FILE="${RULES_FILE:-/etc/iptables.rules}"
EgressTpl="${EgressTpl:-./infra/config/iptables/hz247-neanelu-egress.rules}"
InboundTpl="${InboundTpl:-./infra/config/iptables/hz247-neanelu-inbound.rules}"

if ! command -v iptables-restore >/dev/null 2>&1; then
  echo "ERROR: iptables-restore not found. Run on hz.247." >&2
  exit 1
fi

if [ ! -f "$RULES_FILE" ]; then
  echo "ERROR: $RULES_FILE not found." >&2
  exit 1
fi

echo "Using RULES_FILE=$RULES_FILE"
echo "Egress template: $EgressTpl"
echo "Inbound template: $InboundTpl"

echo
echo "=== DRY-RUN: showing templates ==="
echo "--- egress ---"
sed -n '1,200p' "$EgressTpl"
echo "--- inbound ---"
sed -n '1,200p' "$InboundTpl"

echo
echo "=== NEXT STEPS (manual) ==="
echo "1) Backup: cp -a \"$RULES_FILE\" \"${RULES_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)\""
echo "2) Append templates in the correct section/order (aditiv, dupa regulile altor CT-uri)."
echo "3) Apply: iptables-restore < \"$RULES_FILE\""
echo "4) Verify: iptables -S FORWARD | egrep '10\\.0\\.1\\.(111|112)'"
echo
echo "Nota: acest script intentionat NU scrie automat in $RULES_FILE ca sa evitam interferenta."

