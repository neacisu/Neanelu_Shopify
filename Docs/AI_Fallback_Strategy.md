# AI Fallback Strategy - NEANELU Shopify Manager

> **Versiune:** 2.0 | **Data:** 2026-03-06

---

## Principii

- Furnizor primar pentru AI este **selfhosted** (Qwen2.5-14B, QwQ-32B, Qwen3-Embedding-8B).
- Fallback automat pe frontier este în 2 trepte: **xAI** (Tier 1) apoi **OpenAI** (Tier 2).
- Toate rutele AI folosesc retry cu budget, circuit breaker, observabilitate și guardrails.
- Nu se amestecă credențiale între provideri.

---

## Routing Oficial

| Tip task | Provider primar | Fallback tier 1 | Fallback tier 2 |
| --- | --- | --- | --- |
| `classification` | `selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ` | `xai:grok-4-1-fast-non-reasoning` | `openai:gpt-4o-mini` |
| `translation` | `selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ` | `xai:grok-4-1-fast-non-reasoning` | `openai:gpt-4o-mini` |
| `extraction` | `selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ` | `xai:grok-4-1-fast-non-reasoning` | `openai:gpt-4o-mini` |
| `audit` | `selfhosted:Qwen/QwQ-32B-AWQ` | `xai:grok-4-1-fast-non-reasoning` | `openai:gpt-4o-mini` |
| `embedding` | `selfhosted:qwen3-embedding-8b-q5km` | `openai:text-embedding-3-large` | `noop` (ultim resort) |

---

## Embeddings

- Dimensiune vector operațională: **2000**.
- Model selfhosted embedding: `qwen3-embedding-8b-q5km` (MRL truncation 4096 -> 2000).
- În perioade de tranziție, query-urile trebuie filtrate pe `model_version` pentru a evita comparații cross-model.

---

## Circuit Breaker

Configurare per endpoint selfhosted:

- `failureThreshold`: 5
- `successThreshold`: 2
- `openTimeoutMs`: 60000
- stări: `CLOSED` -> `OPEN` -> `HALF_OPEN`

Reguli:

- `OPEN` = fail-fast imediat, fără timeout lung pe request.
- După timeout, se intră în `HALF_OPEN`.
- 2 succese consecutive în `HALF_OPEN` => `CLOSED`.
- 1 eșec în `HALF_OPEN` => `OPEN`.

---

## Degradation Levels (L0-L3)

- **L0**: Selfhosted healthy, toate fluxurile AI active normal.
- **L1**: Selfhosted degradat (latență/queue), activare throttling și batch pentru workload-uri necritice.
- **L2**: Selfhosted indisponibil, fallback frontier activ (xAI/OpenAI).
- **L3**: Frontier indisponibil, aplicația rămâne funcțională cu fallback non-AI (ex. full-text search).

Metrica operațională asociată: `ai_degradation_level` (0..3).

---

## Observabilitate Minimă Obligatorie

- `ai_provider_routing_total`
- `selfhosted_fallback_to_frontier_total`
- `selfhosted_embedding_latency_seconds`
- `selfhosted_circuit_breaker_state`
- `vllm_time_to_first_token_seconds`
- `vllm_num_requests_waiting`
- `vllm_gpu_cache_usage_perc`
- `guardrails_scan_total`
- `guardrails_block_total`
- `guardrails_service_health`

---

## Rollout și Rollback

Rollout gradual pentru `selfhosted_llm_enabled`:

1. 10% trafic + monitorizare 24h
2. 50% trafic + monitorizare 48h
3. 100% trafic

Rollback rapid:

```sql
UPDATE feature_flags
SET rollout_percentage = 0, updated_at = now()
WHERE flag_key = 'selfhosted_llm_enabled';
```

---

## Guardrails

- API intern: `http://10.0.1.10:49004`
- Moduri: `disabled`, `warn-only`, `enforce`
- Fail-open obligatoriu când serviciul guardrails este indisponibil
- Token injectat din OpenBao (nu stocat hardcoded în cod)

1. Circuit breaker detects successful responses
2. Moves to HALF_OPEN state
3. Processes test requests
4. Returns to CLOSED if tests pass
5. Drains queued embedding jobs

### Manual Recovery

1. **Verify OpenAI status:** <https://status.openai.com/>
2. **Check credentials:** Verify API key valid
3. **Check billing:** Ensure account in good standing
4. **Reset circuit breaker:** Admin endpoint `/api/admin/ai/reset`
5. **Process backlog:** Trigger batch processor

---

## Configuration

Environment variables:

```bash
# Primary Provider
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...

# Fallback Settings
AI_FALLBACK_ENABLED=true
AI_CIRCUIT_BREAKER_ENABLED=true
AI_QUEUE_MAX_SIZE=10000

# Timeouts
AI_REQUEST_TIMEOUT_MS=30000
AI_BATCH_SIZE=50

# Alternative (future)
# AZURE_OPENAI_ENDPOINT=https://...
# AZURE_OPENAI_KEY=...
```

---

## Testing Fallback

### Manual Test

```bash
# Simulate OpenAI down
export OPENAI_SIMULATE_FAILURE=true
pnpm test:fallback

# Test search with and without AI
curl "http://localhost:65000/api/products/search?q=jacket"
```

### Integration Test

- Chaos engineering: Random API failures
- Load test: Verify queue handling
- Recovery test: Simulate full outage and recovery
