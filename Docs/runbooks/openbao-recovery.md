# OpenBAO Recovery Runbook

> **Last Updated:** 2025-12-25  
> **Severity:** Critical  
> **On-call Required:** Yes

---

## Purpose

This runbook documents recovery procedures for OpenBAO (Vault-compatible secrets manager) in case of:

- Auto-unseal failure
- Data corruption
- Root token compromise
- Cluster failover

---

## Prerequisites

- Access to HSM keys or Shamir unseal key shares (3 of 5 required)
- SSH access to OpenBAO host(s)
- Root/admin access to systemd services
- Backup location known (`/var/lib/openbao/snapshots/`)

---

## Scenario 1: Auto-Unseal Failure

### Symptoms

- OpenBAO health endpoint returns `sealed: true`
- Application pods/containers fail to read secrets
- Alert: "OpenBAO sealed > 5 minutes"

### Resolution Steps

1. **Verify sealed state:**

   ```bash
   docker exec openbao bao status
   # Look for: Sealed: true
   ```

2. **Manual unseal (Shamir):**

   ```bash
   # Requires 3 key holders to run in sequence
   docker exec openbao bao operator unseal $KEY_SHARE_1
   docker exec openbao bao operator unseal $KEY_SHARE_2
   docker exec openbao bao operator unseal $KEY_SHARE_3
   ```

3. **Verify unsealed:**

   ```bash
   docker exec openbao bao status
   # Look for: Sealed: false
   ```

4. **Restart dependent services:**

   ```bash
   docker compose restart backend-worker web-admin
   ```

5. **Investigate root cause:**
   - Check `/var/log/openbao/audit.log` for errors
   - Verify HSM connectivity (if using transit auto-unseal)
   - Check systemd timer for auto-unseal script

---

## Scenario 2: Root Token Compromise

### Immediate Actions

1. **Revoke compromised token:**

   ```bash
   bao token revoke $COMPROMISED_TOKEN
   ```

2. **Generate new root token:**

   ```bash
   # This requires unseal key holders to cooperate
   bao operator generate-root -init
   # Each key holder runs:
   bao operator generate-root -nonce=$NONCE $KEY_SHARE
   ```

3. **Rotate all application secrets:**
   - Shopify API tokens
   - Database credentials
   - BullMQ Pro token
   - Encryption keys

4. **Audit accessed paths:**

   ```bash
   grep -i "auth" /var/log/openbao/audit.log | tail -1000
   ```

---

## Scenario 3: Data Corruption

### Symptoms

- OpenBAO returns errors on secret reads
- Backend logs show "500 Internal Server Error" from OpenBAO
- Integrity check fails

### Resolution Steps

1. **Stop OpenBAO:**

   ```bash
   docker compose stop openbao
   ```

2. **Backup current state (even if corrupt):**

   ```bash
   cp -r /var/lib/openbao/data /var/lib/openbao/data.corrupt.$(date +%Y%m%d)
   ```

3. **Restore from latest snapshot:**

   ```bash
   bao operator raft snapshot restore /var/lib/openbao/snapshots/latest.snap
   ```

4. **Restart and unseal:**

   ```bash
   docker compose up -d openbao
   # Follow Scenario 1 for unseal
   ```

5. **Verify secret access:**

   ```bash
   bao kv get secret/neanelu/prod/shopify
   ```

---

## Scheduled Maintenance

### Weekly: Snapshot Verification

```bash
# Verify snapshot can be restored on a test instance
bao operator raft snapshot restore --force /var/lib/openbao/snapshots/latest.snap
```

### Quarterly: Key Rotation

- Rotate Shopify tokens
- Rotate encryption keys (coordinate with F2.2.3.2 key rotation task)
- Update OpenAI API key
- Rotate BullMQ Pro token

---

## Contacts

| Role            | Contact                      |
| --------------- | ---------------------------- |
| Primary On-Call | Defined in rotation schedule |
| Key Holder 1    | [REDACTED]                   |
| Key Holder 2    | [REDACTED]                   |
| Key Holder 3    | [REDACTED]                   |

---

## Related Documents

- `Docs/DevOps_Plan_Implementare_Shopify_Enterprise.md` Section 0.y
- `Plan_de_implementare.md` F0.2.7 (Secret Management)
