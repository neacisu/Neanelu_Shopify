#!/usr/bin/env bash
set -euo pipefail

ROLE_ID_FILE="/opt/openbao/.rotate-role-id"
SECRET_ID_FILE="/opt/openbao/.rotate-secret-id"
GUARDRAILS_ENV_FILE="/run/llm-secrets/guardrails.env"
GUARDRAILS_CONFIG_FILE="/opt/ai-guardrails/config/scanners.yml"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [rotate-guardrails-token] $*"; }

if ! docker exec openbao bao status -format=json 2>/dev/null | python3 -c 'import json,sys; sys.exit(0 if not json.load(sys.stdin).get("sealed", True) else 1)'; then
  log "ERROR: OpenBao sealed/unreachable"
  exit 1
fi

ROLE_ID=$(cat "$ROLE_ID_FILE")
SECRET_ID=$(cat "$SECRET_ID_FILE")

TOKEN=$(docker exec openbao sh -c "bao write -field=token auth/approle/login role_id=$ROLE_ID secret_id=$SECRET_ID")
if [ -z "$TOKEN" ]; then
  log "ERROR: AppRole login failed"
  exit 1
fi

NEW_TOKEN=$(openssl rand -hex 64)
docker exec -e BAO_TOKEN="$TOKEN" openbao bao kv put kv-llm/guardrails auth_token="$NEW_TOKEN" >/dev/null

sudo mkdir -p /run/llm-secrets
sudo sh -c "printf 'AUTH_TOKEN=%s\n' '$NEW_TOKEN' > '$GUARDRAILS_ENV_FILE'"
sudo chmod 0400 "$GUARDRAILS_ENV_FILE"

sudo tee "$GUARDRAILS_CONFIG_FILE" >/dev/null <<CFG
auth:
  type: http_bearer
  token: "$NEW_TOKEN"

input_scanners:
  - type: PromptInjection
    params:
      threshold: 0.9
  - type: BanTopics
    params:
      topics: [violence, illegal_activities, self-harm]
      threshold: 0.75
  - type: Toxicity
    params:
      threshold: 0.8
  - type: Anonymize
    params:
      entity_types: [EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD, IBAN_CODE, IP_ADDRESS, PERSON]
      use_faker: true
      threshold: 0.85

output_scanners:
  - type: Sensitive
    params:
      redact: true
      entity_types: [EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD]
      threshold: 0.85
  - type: Toxicity
    params:
      threshold: 0.8
  - type: Relevance
    params:
      threshold: 0.3
  - type: Deanonymize
CFG

cd /opt/ai-guardrails
sudo docker compose up -d --force-recreate llm-guard >/dev/null

log "SUCCESS: guardrails token rotated and llm-guard recreated"
