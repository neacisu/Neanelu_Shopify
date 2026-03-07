# LLM Infrastructure Topology

## Network Architecture

```text
Internet (HTTPS)
    │
    ▼
┌─────────────────────────────────────┐
│  Traefik (orchestrator 77.42.76.185)│
│  Host rule: llm.neanelu.ro          │
│  Backend: http://10.0.1.10:49000    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  HAProxy L4 (hz.247)                │
│  VIP: 10.0.1.10                     │
│                                     │
│  49000 → 10.0.1.13:3000 (WebUI)    │
│  49001 → 10.0.1.13:8001 (QwQ-32B)  │
│  49002 → 10.0.1.13:8002 (Qwen-14B) │
│  49003 → 10.0.1.62:8003 (Embed)    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  hz.113 (10.0.1.13)                 │
│  GPU: NVIDIA RTX 6000 Ada (49 GiB) │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ vllm-qwq-32b (:8001)         │  │
│  │ Qwen/QwQ-32B-AWQ             │  │
│  │ GPU util: 65%, max 24576 ctx  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ vllm-qwen-14b (:8002)        │  │
│  │ Qwen/Qwen2.5-14B-Instruct-AWQ│  │
│  │ GPU util: 28%, max 12288 ctx  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ open-webui (:3000)            │  │
│  │ WEBUI_SECRET_KEY: OpenBao     │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ openbao-agent-llm             │  │
│  │ AppRole: neanelu-llm          │  │
│  │ KV v2: kv-llm/data/webui     │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Nodes

| Host         | Public IP     | Internal IP | Role                     |
| ------------ | ------------- | ----------- | ------------------------ |
| orchestrator | 77.42.76.185  | 10.0.0.2    | Traefik, OpenBao server  |
| hz.247       | 95.216.68.247 | 10.0.1.10   | HAProxy L4 gateway (VIP) |
| hz.113       | -             | 10.0.1.13   | GPU node (vLLM, WebUI)   |
| hz.62        | 95.216.66.62  | 10.0.1.62   | GPU node (Ollama Embed)  |

## HAProxy Configuration (hz.247)

File: `/etc/haproxy/haproxy.cfg`

| Frontend Port | Backend Target | Service                      | Timeouts                 |
| ------------- | -------------- | ---------------------------- | ------------------------ |
| 49000         | 10.0.1.13:3000 | Open WebUI                   | connect 10s, server 300s |
| 49001         | 10.0.1.13:8001 | vLLM QwQ-32B-AWQ             | connect 10s, server 600s |
| 49002         | 10.0.1.13:8002 | vLLM Qwen2.5-14B-Instruct    | connect 10s, server 300s |
| 49003         | 10.0.1.62:8003 | Ollama Qwen3-Embed-8B Q5_K_M | connect 10s, server 120s |

Health checks: `inter 30s rise 2 fall 3`

## Firewall Rules

### hz.247 iptables (VIP 10.0.1.10)

LLM API ports (49000-49003):

| Source     | Destination | Ports                   | Action | Comment                           |
| ---------- | ----------- | ----------------------- | ------ | --------------------------------- |
| 10.0.1.111 | 10.0.1.10   | 49000,49001,49002,49003 | ACCEPT | backend-worker (neanelu-prod LXC) |
| 10.0.0.2   | 10.0.1.10   | 49000,49001,49002,49003 | ACCEPT | orchestrator                      |
| 10.0.1.6   | 10.0.1.10   | 49000,49001,49002,49003 | ACCEPT | dev machine (neanelu-dev)         |
| 0.0.0.0/0  | 10.0.1.10   | 49000,49001,49002,49003 | DROP   | block all others                  |

OpenBao access (port 443 via Traefik):

| Source        | Destination | Port | Action | Comment           |
| ------------- | ----------- | ---- | ------ | ----------------- |
| 10.0.1.13     | 10.0.1.10   | 443  | ACCEPT | llm-infra-openbao |
| (other nodes) | 10.0.1.10   | 443  | ACCEPT | cluster services  |
| 0.0.0.0/0     | 10.0.1.10   | 443  | DROP   | block all others  |

Rules persisted to `/etc/iptables/rules.v4`.

### hz.113 UFW

| Rule                      | Action | Comment        |
| ------------------------- | ------ | -------------- |
| Default incoming          | DENY   |                |
| Default outgoing          | ALLOW  |                |
| 22/tcp from anywhere      | ALLOW  | SSH            |
| 8001/tcp from 10.0.1.0/24 | ALLOW  | vLLM Primary   |
| 8002/tcp from 10.0.1.0/24 | ALLOW  | vLLM Secondary |
| 3000/tcp from 10.0.1.0/24 | ALLOW  | Open WebUI     |
| All from cluster nodes    | ALLOW  | cluster-mesh   |

## Secrets Management (WEBUI_SECRET_KEY)

Flow:

1. OpenBao server (orchestrator, container `openbao`) stores key at `kv-llm/data/webui` (KV v2)
2. OpenBao agent on hz.113 (container `openbao-agent-llm`) authenticates via AppRole `neanelu-llm`
3. Agent renders `WEBUI_SECRET_KEY` to `/run/llm-secrets/webui-secrets.env` (permissions 0600, owner 100:1000)
4. `open-webui` container reads via `env_file` directive, depends on agent health check
5. `/run/llm-secrets` recreated at boot via tmpfiles.d (`/etc/tmpfiles.d/llm-secrets.conf`)

Rotation:

- Systemd timer `openbao-rotate-webui.timer` on orchestrator runs monthly
- Script `/opt/openbao/rotate-webui-key.sh` authenticates via AppRole `neanelu-llm-rotate`
- After writing new key, restarts agent + recreates open-webui on hz.113 via SSH (internal: 10.0.1.10 → 10.0.1.13)

Policies (least privilege):

| Policy             | Capabilities   | Path                             | Used by         |
| ------------------ | -------------- | -------------------------------- | --------------- |
| neanelu-llm        | read           | kv-llm/data/_, kv-llm/metadata/_ | Agent on hz.113 |
| neanelu-llm-rotate | create, update | kv-llm/data/webui                | Rotation cron   |

## GPU

- Model: NVIDIA RTX 6000 Ada Generation
- VRAM: 49,140 MiB (49.1 GiB)
- Allocation: QwQ-32B-AWQ 65% (~31.9 GiB) + Qwen2.5-14B 28% (~13.8 GiB) = 93% total

## Backend Worker Access

The backend-worker container runs on neanelu-prod LXC (10.0.1.111). It reaches vLLM via HAProxy VIP:

- `http://10.0.1.10:49001/v1/chat/completions` (QwQ-32B-AWQ, backend 10.0.1.13:8001)
- `http://10.0.1.10:49002/v1/chat/completions` (Qwen2.5-14B-Instruct-AWQ, backend 10.0.1.13:8002)
- `http://10.0.1.10:49003/v1/embeddings` (Qwen3-Embedding-8B Q5_K_M, backend 10.0.1.62:8003)

If backend-worker moves to a different node, its source IP must be added to iptables on hz.247 for ports 49000-49003.

## Embedding Limitations

vLLM does NOT serve `/v1/embeddings` for these models. Embeddings remain on OpenAI (`text-embedding-3-large`, 2000 dimensions). All pgvector indexes use `vector(2000)`.
