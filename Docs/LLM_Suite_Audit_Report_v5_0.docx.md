**AUDIT TEHNIC & SUITA LLM OPTIMĂ**

Analiză Comparativă Paralelă: Neanelu\_Shopify & Cerniq.app

Redis Comun · Suită LLM Comună · Arhitectură Unificată

SEO/GEO Strategy · Romanian Language Polishing · Golden Records Pipeline

**RunPod GPU Cloud · GPU Orchestrator Worker · Cost Automation**

**Versiune 5.0  •  Februarie 2026  •  Confidential**

| CHANGELOG v5.0 — DECIZII INFRASTRUCTURA ADOPTATE |
| :---- |

| Decizie | Versiune anterioara (v3.1/v4.0) | Versiune noua (v5.0) |
| :---- | :---- | :---- |
| Provider GPU | Hetzner GPU Cloud (A100 — inexistent) | RunPod Community Cloud (A100 PCIe 80GB confirmat) |
| Redis HA | 3× VPS Hetzner dedicate (\~€25/lun) | Redis-shared EXISTENT pe orchestrator (10.0.1.10:6379) — €0 |
| Storage modele | RunPod Network Storage 1TB ($70/lun) | hz.215 /hdd-archive 1.7TB existent — $0, nginx HTTP server |
| Serverless RunPod | Analizat ca optiune | EXCLUS — cold-start 30-60s incompatibil cu modele always-loaded |
| Conectivitate pods | Nespecificata | WireGuard tunnel: RunPod pods ↔ orchestrator Hetzner |
| Date si rezultate | Nespecificate | CT107 PostgreSQL \+ Redis shared existent. StorageBox BX11 backupuri |
| Orchestrare GPU | Manuala (dashboard RunPod) | gpu-orchestrator worker CT nou (Node.js \+ BullMQ \+ RunPod API) |
| Cost total lunar | €4,090-5,460/lun (v4.0 BAZA) | \~$3,825/lun (\~€3,525) — economie 14-35% |

# **I. ARHITECTURA INFRASTRUCTURII GPU — v5.0**

Aceasta sectiune documenteaza toate deciziile de infrastructura adoptate dupa auditul tehnic initial, bazate pe cercetarea de piata efectuata in Februarie 2026 si pe analiza infrastructurii Hetzner existente.

## **I.1  De ce RunPod (si nu Hetzner, DigitalOcean, AWS)**

Cercetarea de piata din Februarie 2026 a identificat urmatoarea situatie:

| Provider | A100 80GB disponibil? | Pret/ora | Recomandat pentru |
| :---- | :---- | :---- | :---- |
| Hetzner GPU Cloud | **NU — doar RTX 4000/6000 Ada** | N/A | VPS Redis, Storage — NU GPU |
| RunPod Community | **DA** | $1.33/ora | Node A, B, C — RECOMANDAT |
| RunPod Secure | DA | $1.45/ora | Optiune premium (+9%) |
| Vast.ai marketplace | DA | $0.70/ora (variabil) | PoC, Node C batch |
| DigitalOcean | NU (doar H100 80GB) | $3.39/ora | Storage S3 — NU GPU |
| AWS / GCP / Azure | DA | $4.10+/ora | Prea scump — EXCLUS |

| ⚠ DESCOPERIRE CRITICA: Hetzner nu ofera A100 80GB. Toate estimarile de cost din v3.1/v4.0 bazate pe Hetzner GPU sunt invalide. RunPod Community Cloud este providerul selectat. |
| :---- |

## **I.2  Configuratia Nodurilor — Finala**

| Nod | Tip Pod RunPod | GPU | Nr GPU | Mod operare | Cost/luna |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **NODE A** | Pod — Community Cloud | A100 PCIe 80GB | 1 | Always-on 24/7 | **\~$960** |
| **NODE B** | Pod — Community Cloud | A100 PCIe 80GB | 2 (pods separate) | Always-on 24/7 | **\~$1,915** |
| **NODE C** | Pod — Community Cloud | A100 PCIe 80GB | 5 (on-demand) | \~5h/zi × 22 zile \= 110h/luna | **\~$730** |

### **Node A — Modele si VRAM**

| Model | Format | VRAM | Task |
| :---- | :---- | :---- | :---- |
| Qwen3-Embedding-8B | Q8\_0 | 8 GB | Embeddings Neanelu \+ Cerniq (TEI server) |
| NuExtract-2.0-8B | FP16 | 16 GB | Extractie HTML→JSON PIM (vLLM) |
| EuroLLM-22B | Q8\_0 | 24.1 GB | Polish lingvistic roman (vLLM) |
| **TOTAL VRAM** |  | **48.1 GB / 80 GB** | Marja libera: 31.9 GB KV cache |

### **Node B — Modele si VRAM**

| Model | Format | VRAM total (2 GPU) | Task |
| :---- | :---- | :---- | :---- |
| Qwen3-72B | FP8 | \~72 GB (tensor parallel pe 2× 80GB) | Cerniq ALL workers (E1-E5) \+ quality gate Neanelu |
| **TOTAL VRAM** |  | **\~72 GB / 160 GB** | Marja: 88 GB pentru KV cache extins |

### **Node C — Modele si VRAM (on-demand)**

| Model | Format | VRAM per pod (5× 80GB) | Task |
| :---- | :---- | :---- | :---- |
| DeepSeek V3 GGUF | Q4\_K\_M | \~70 GB/pod (350 GB total) | Audit PIM batch \+ Cerniq E1 overflow |
| **TOTAL VRAM** |  | **350 GB / 400 GB total** | Marja: 50 GB pe cluster |

## **I.3  De ce NU RunPod Serverless**

RunPod ofera 3 tipuri de compute. Decizia explicita:

| Tip RunPod | Cum functioneaza | Potrivit? | Motiv |
| :---- | :---- | :---- | :---- |
| Pod (Persistent) | VM cu GPU dedicat, mereu pornit | **✅ DA** | Modelele raman in VRAM — latenta 0 la primul request |
| Serverless Flex | Se trezeste la request, se opreste dupa idle | **❌ NU** | Cold-start 30-60s — inacceptabil pentru AI agent Cerniq si pipeline Neanelu |
| Serverless Active | Always-on, dar fara control deployment | **❌ NU** | Mai scump decat Pod fara beneficii. Nu permite custom Docker \+ vLLM |
| Instant Cluster | Multi-GPU cu NVLink | ⚠ OPTIONAL | Faza 2: daca throughput Node B insuficient (contact sales) |

## **I.4  Storage — Solutia Completa fara Costuri Noi**

Infrastructura Hetzner existenta acopera 100% din nevoile de storage. Zero cost nou.

| Ce stochez | Unde | Capacitate | Cost |
| :---- | :---- | :---- | :---- |
| Modele LLM (470 GB total) | hz.215 /hdd-archive (nginx HTTP) | 1.7 TB disponibil | **€0 — existent** |
| Rezultate, embeddings, audit | CT107 PostgreSQL (10.0.1.107) | ZFS mirror 223G SSD | **€0 — existent** |
| Cozi BullMQ, stari agenti | Redis-shared orchestrator (10.0.1.10:6379) | RAM orchestrator | **€0 — existent** |
| Backupuri offsite | StorageBox BX11 (\~880 GB liberi) | \~1 TB total, 12% utilizat | **€0 — existent** |
| Logs, traces observabilitate | Loki \+ Tempo pe orchestrator → BX11 | Configurat Faza M Neanelu | **€0 — existent** |

### **Strategia de Download Modele la Startup Pod**

**Problema:** Node C porneste 5 pods simultan → descarca DeepSeek V3 (\~70 GB/pod). Daca toti descarca din acelasi nod Hetzner: 1 Gbps ÷ 5 \= 200 Mbps/pod → 70 GB in \~47 min. Prea lent.

**Solutia:** Distribui shardurile DeepSeek pe 4-5 noduri Hetzner diferite. Fiecare pod descarca din sursa dedicata (env var MODEL\_SOURCE\_HOST). Fiecare nod are 1 Gbps propriu → 70 GB in \~9-10 min. Intri in fereastra de 15-20 min acceptata.

| Pod RunPod | Sursa download model | Banda disponibila | Timp estimat |
| :---- | :---- | :---- | :---- |
| Pod 1 (shard 1\) | hz.215 (95.216.36.215) | 1 Gbps | \~10 min |
| Pod 2 (shard 2\) | hz.247 (95.216.68.247) | 1 Gbps | \~10 min |
| Pod 3 (shard 3\) | hz.223 (95.217.32.223) | 1 Gbps | \~10 min |
| Pod 4 (shard 4\) | hz.118 (95.216.72.118) | 1 Gbps | \~10 min |
| Pod 5 (shard 5\) | hz.215 sau hz.123 | 1 Gbps | \~10 min |

Node A si B (always-on): download one-time la crearea pod-ului. Nu se repeta. Nicio constrangere de timp.

## **I.5  Conectivitate RunPod ↔ Infrastructura Hetzner**

Pods-urile RunPod sunt in cloud public. Accesul la Redis, PostgreSQL si storage intern se face exclusiv prin WireGuard tunnel.

| Serviciu intern | Adresa interna | Acces din RunPod via |
| :---- | :---- | :---- |
| Redis shared (BullMQ) | 10.0.1.10:6379 (HAProxy VIP) | WireGuard → orchestrator 10.0.0.2 |
| PostgreSQL CT107 | 10.0.1.107:5432 | WireGuard → orchestrator |
| OpenBao secrets | 10.0.0.2:8200 | WireGuard → orchestrator |
| Model download (nginx) | hz.215:8080 (sau rsync SSH) | Public IP Hetzner direct |
| Observabilitate OTLP | otel-neanelu.neanelu.ro | WireGuard → Traefik → otel-collector |

| IMPLEMENTARE WireGuard: Orchestratorul are deja interfata wg-home (10.99.0.1/24) configurata. La startup fiecarui pod RunPod, un script de init adauga pod-ul ca peer WireGuard. Token-ul WireGuard si configuratia sunt preluate din OpenBao (secret/gpu-orchestrator/wireguard). |
| :---- |

# **II. GPU ORCHESTRATOR WORKER**

Workerul de orchestrare GPU automatizeaza complet ciclul de viata al pods-urilor RunPod, monitorizarea costurilor in timp real si aplica limite bugetare, cu suport HITL (Human-in-the-Loop) pentru operatiunile critice.

## **II.1  Capabilitati API RunPod**

RunPod expune o API GraphQL completa (+ REST API din Martie 2025\) care permite controlul programatic al tuturor resurselor:

| Operatiune | API Call | Disponibil |
| :---- | :---- | :---- |
| Creare pod (deploy) | podFindAndDeployOnDemand | ✅ |
| Pornire pod | podResume | ✅ |
| Oprire pod (fara stergere) | podStop | ✅ |
| Terminare / destroy complet | podTerminate | ✅ |
| Listare pods \+ status | myself { pods } | ✅ |
| Cost curent pe ora (cont) | myself { currentSpendPerHr } | ✅ |
| Cost per pod individual | pod { costPerHr, adjustedCostPerHr } | ✅ |
| Spend limit pe cont | myself { spendLimit } | ✅ |
| Telemetrie GPU (utilization, temp, mem) | pod { latestTelemetry { averageGpuMetrics } } | ✅ |
| Istoricul cheltuielilor | myself { clientLifetimeSpend, spendDetails } | ✅ |

## **II.2  Arhitectura gpu-orchestrator**

Un container LXC nou pe hz.223, consistent cu pattern-ul de deployment Cerniq/Neanelu:

| Componenta | Detaliu |
| :---- | :---- |
| **Host** | hz.223 — CT nou (ex: CT115 gpu-orchestrator), 2 vCPU, 4 GB RAM |
| **Runtime** | Node.js 24.13.1 LTS (Krypton) — identic cu restul stackului |
| **Queue engine** | BullMQ — folosind Redis-shared existent (10.0.1.10:6379, prefix gpu:) |
| **Secrets** | OpenBao AppRole: secret/gpu-orchestrator/runpod (api\_key, spend\_limits) |
| **Expunere** | HAProxy → Traefik → gpu.intern.cerniq.app (acces intern) |
| **Observabilitate** | Prometheus exporter custom → Grafana central (dashboard GPU Nodes) |
| **HITL** | Telegram Bot (node-telegram-bot-api) cu butoane inline pentru aprobare |
| **CI/CD** | Acelasi flow GitHub Actions ca Cerniq/Neanelu (deploy.yml) |

## **II.3  Logica Automat vs HITL**

| Actiune | Mod | Conditie / Trigger |
| :---- | :---- | :---- |
| Node C pornire batch (dimineata) | **✅ AUTOMAT** | Cron 07:00 zilnic, daca cost zilnic \< 80% limita |
| Node C oprire (seara / queue goala) | **✅ AUTOMAT** | Cron 13:00 SAU BullMQ queue empty event |
| Node C rebuild dupa esec pod | **✅ AUTOMAT** | Pod mort \+ retry\_count \< 2 (cu backoff exponential) |
| Node C pornire urgenta overflow | **⚠ AUTOMAT \+ notif.** | Queue depth \> threshold si cost ok |
| Node A/B restart dupa down | **⚠ HITL obligatoriu** | Alerta Telegram → aprobare umana → restart |
| Node A/B rebuild complet | **❌ HITL strict** | Schimbare majora, risc downtime customer-facing |
| Scalare urgenta (\>5 pods extra) | **❌ HITL strict** | Cost one-shot \> $50 — aprobare obligatorie |
| Kill switch total (budget depasit) | **✅ AUTOMAT** | Cost zilnic \> limita RED — TOATE pods oprite instant |

## **II.4  Sistemul de Monitorizare a Costurilor**

Polling la fiecare 5 minute catre RunPod GraphQL API. Datele sunt stocate in PostgreSQL CT107 pentru istoric si in Redis pentru dashboard live.

| Nivel alerta | Threshold | Actiune automata |
| :---- | :---- | :---- |
| **🟡 YELLOW** | 80% din buget zilnic | Notificare Telegram. Nicio actiune operationala. |
| **🟠 ORANGE** | 95% din buget zilnic | Node C oprit automat (cel mai scump on-demand). Notificare. |
| **🔴 RED** | 100% sau spike spending | TOATE pods oprite. HITL pentru restart. Incident creat in Grafana. |
| **⚙ BACKSTOP** | spendLimit cont RunPod | Limita hardware setata direct in contul RunPod via API — failsafe daca workerul pica. |

## **II.5  Monitorizare Agenti (nu doar pods)**

Pe langa costurile RunPod, workerul monitorizeaza sanatatea serviciilor care ruleaza in interiorul pods-urilor:

| Ce monitorizeaza | Cum | Endpoint |
| :---- | :---- | :---- |
| vLLM server Node B (Qwen3-72B) | HTTP polling la /health \+ /metrics | pod\_ip:8000 via WireGuard |
| TEI server Node A (embeddings) | HTTP polling la /health | pod\_ip:8080 via WireGuard |
| GPU utilization, temperatura, VRAM | RunPod API latestTelemetry | GraphQL polling |
| Queue depth BullMQ (toate nodurile) | Redis LLEN pe cheile gpu:\* | Redis 10.0.1.10:6379 |
| Tokens/second throughput | vLLM /metrics Prometheus scrape | Prometheus → Grafana |
| Cost per token (calculat) | costPerHr / tokens\_generated | Stocat in CT107 Postgres |

## **II.6  Securitatea API Key RunPod**

Token-ul RunPod este tratat cu acelasi nivel de securitate ca secretele OpenBao existente:

* Stocat in OpenBao: secret/gpu-orchestrator/runpod — aceeasi structura KV v1 ca Neanelu/Cerniq

* Preluare la runtime prin OpenBao agent HCL (acelasi pattern ca agent-api.hcl din Neanelu)

* Nu apare niciodata in variabile de environment, logs sau repo

* Rotatie recomandata: lunar, prin script automat in OpenBao

* Spend limit hardware setat direct pe contul RunPod ca backstop independent de aplicatie

## **II.7  Efort de Implementare Estimat**

| Componenta | Descriere | Efort |
| :---- | :---- | :---- |
| CT setup gpu-orchestrator | LXC pe hz.223, Node.js, BullMQ, OpenBao agent | 1 zi |
| RunPod API client | GraphQL wrapper, pod lifecycle mutations, cost queries | 2 zile |
| Cost monitor \+ PostgreSQL schema | Polling, stocare istorica, calcule proiectie | 1 zi |
| HITL Telegram Bot | Butoane inline aprobare/respingere operatiuni | 1 zi |
| Grafana dashboard GPU Nodes | Panel costs, GPU util, queue depth, tokens/sec | 0.5 zi |
| Automate Node C (cron start/stop) | Scheduler dimineata/seara \+ queue-based trigger | 1 zi |
| Budget limits \+ kill switch | Threshold logic, spendLimit API, incident alerting | 1 zi |
| WireGuard init script pods | Auto-add pod ca peer WireGuard la startup | 0.5 zi |
| **TOTAL** |  | **\~8-9 zile dev** |

# **III. BUGET LUNAR ACTUALIZAT — v5.0**

| \# | Resursa | Provider | Detaliu | Cost/luna |
| :---- | :---- | :---- | :---- | :---- |
| 1 | Node A — 1× A100 PCIe 80GB (always-on) | RunPod Community | $1.33/h × 720h | **\~$960** |
| 2 | Node B — 2× A100 PCIe 80GB (always-on) | RunPod Community | $1.33/h × 2 × 720h | **\~$1,915** |
| 3 | Node C — 5× A100 PCIe 80GB (on-demand) | RunPod Community | $1.33/h × 5 × 110h | **\~$730** |
| 4 | Redis HA | Redis-shared EXISTENT | Orchestrator 10.0.1.10:6379 | **€0** |
| 5 | Storage modele (470 GB) | hz.215 /hdd-archive EXISTENT | nginx HTTP server | **€0** |
| 6 | Backupuri (BX11) | StorageBox BX11 EXISTENT | \~880 GB liberi | **€0** |
| 7 | xAI Grok API (fallback) | xai.com | Fallback chain Node B down | \~$100 |
| 8 | Egress \+ misc | — | Transfer date RunPod → Hetzner | \~$50 |
| **TOTAL** |  |  |  | **\~$3,755/luna (\~€3,460)** |

## **III.1  Comparatie cu Versiunile Anterioare**

| Versiune | Cost estimat | Diferenta fata de v5.0 |
| :---- | :---- | :---- |
| v3.1 / v4.0 BAZA (Hetzner A100 — invalid) | €4,090-5,460/luna | \-15% pana la \-37% |
| v4.0 Full API (fara self-hosting) | €15,000-35,000/luna | **\-77% pana la \-90%** |
| **v5.0 RunPod Community (ACTUAL)** | **\~€3,460/luna** | **REFERINTA** |

## **III.2  Evolutia Costului in Faze**

| Faza | Durata | Config activa | Cost estimat |
| :---- | :---- | :---- | :---- |
| Faza 0 — PoC | 7-10 zile | 1× Pod A100 pe Vast.ai pentru teste | \~$150-250 total |
| Faza 1 — Productie initiala | Luna 1-3 | Node A \+ Node B always-on \+ Node C on-demand | \~$3,460/luna |
| Faza 2 — Optimizare | Luna 4+ | Active Workers RunPod (30% discount pe always-on) | \~$2,900-3,100/luna |
| Faza 3 — Scale | Luna 6+ | Negociere Reserved Pricing RunPod | \~€2,600-2,800/luna |

# **IV. FAZA 0 — POC ACTUALIZAT**

Faza 0 PoC ramane obligatorie si non-negociabila inainte de orice deployment in productie. Platforma pentru PoC: Vast.ai (cel mai ieftin, fara commitment).

## **IV.1  Cele 4 Teste Obligatorii**

| Test | Ce validezi | Criteriu stop/go | Durata |
| :---- | :---- | :---- | :---- |
| Test 1: NuExtract F-Score | F-Score NuExtract-2.0-8B pe 100 HTML reale Neanelu vs xAI Grok actual | F-Score \< 0.80 → switch la Qwen3-72B ca workhorse unic | 8h |
| Test 2: Qwen3-72B vs Mistral Large 3 | 20-30 dialoguri B2B agricol roman — calitate conversationala | Esec Qwen3 → hardware upgrade necesar (Mistral Large 3\) | 16h |
| Test 3: EuroLLM-22B hallucination | 10 inputuri cu preturi/specificatii precise — rate hallucination | Rate \> 5% → EuroLLM eliminat din pipeline | 4h |
| Test 4: Pipeline 3-straturi complet | NuExtract → Qwen3-72B → EuroLLM pe 50 produse reale | Throughput \< 5 produse/min → reprofilare Node C | 8h |
| Test 5: MRL 2000 dims | Qwen3-Emb-8B Q8 — validare ca suporta truncare la 2000 dims pentru pgvector schema Neanelu | STOP daca MRL nu suporta 2000 dims (schema incompatibila) | 4h |

| Cost total Faza 0 PoC pe Vast.ai: \~$200-300 (10 zile × 1× A100 @ $0.70/h \+ overhead). Daca toate testele esueaza: pierdere maxima $300, nu €3,460/luna. |
| :---- |

## **IV.2  Checklist Pregatire Infrastructura inainte de PoC**

| \# | Actiune | Unde | Responsabil |
| :---- | :---- | :---- | :---- |
| 1 | Descarca toate modelele pe hz.215 /hdd-archive (\~470 GB) | hz.215 | DevOps |
| 2 | Configureaza nginx HTTP server pe hz.215 pentru servire modele | hz.215 | DevOps |
| 3 | Distribuie shardurile DeepSeek V3 pe hz.247, hz.223, hz.118 | 3× noduri Hetzner | DevOps |
| 4 | Creaza cont RunPod, seteaza spendLimit $500 (backstop PoC) | console.runpod.io | DevOps |
| 5 | Stocheaza RunPod API key in OpenBao: secret/gpu-orchestrator/runpod | orchestrator OpenBao | DevOps |
| 6 | Configureaza WireGuard peer pentru pod-ul de PoC pe orchestrator | orchestrator wg-home | DevOps |
| 7 | Pregateste 100 HTML reale Neanelu pentru Test 1 \+ 50 produse pentru Test 4 | CT111 sau local | Backend |
| 8 | Pregateste 20-30 dialoguri B2B agricol roman pentru Test 2 | Echipa vanzari Cerniq | Produs |

# **V. SUITA LLM — DECIZII CONFIRMATE (neschimbate fata de v3.1)**

Urmatoarele decizii din v3.1 raman valide si confirmate in v5.0. Sectiunile detaliate (audit cod Neanelu, audit ADR-uri Cerniq, analiza modele comparative) raman neschimbate.

## **V.1  Tabel Final Modele**

| Model | Task | Node | Verdict v5.0 |
| :---- | :---- | :---- | :---- |
| Qwen3-Embedding-8B Q8 | Embeddings AMBELE aplicatii (MRL 2000/1536 dims) | Node A | **✅ ADOPTAT** |
| NuExtract-2.0-8B FP16 | Extractie rapida PIM (80% produse Neanelu) | Node A | **✅ ADOPTAT** |
| EuroLLM-22B Q8\_0 | Polish lingvistic roman (Neanelu SEO \+ Cerniq WhatsApp) | Node A | **✅ ADOPTAT** |
| Qwen3-72B FP8 | Quality gate \+ Cerniq ALL workers \+ Generare SEO creativa | Node B | **✅ ADOPTAT — ROL EXTINS** |
| DeepSeek V3 GGUF Q4 | Audit PIM batch \+ consensus \+ Cerniq E1 overflow | Node C | **✅ ADOPTAT** |
| xAI Grok (API) | Fallback urgenta Cerniq Agent (era PRIMARY in v1.0) | API extern | **⚠ FALLBACK** |
| Mistral Large 3 | Contingenta PoC: daca Qwen3-72B esueaza pe romana B2B | — | ⏳ CONDITIONAT POC |
| Kimi K2.5 / GLM-5 | Eliminate — VRAM overkill / cluster masiv necesar | — | ❌ ELIMINAT |

## **V.2  Riscuri Actualizate v5.0**

| Risc | Prob. | Impact | Mitigare v5.0 |
| :---- | :---- | :---- | :---- |
| RunPod Community — disponibilitate A100 80GB insuficienta (rented out) | Medie 30% | Inalt | Switch la RunPod Secure (+9% cost). Vast.ai ca fallback rapid pentru Node C. |
| WireGuard tunnel instabil (latenta Redis/PG) | Mica 15% | Mediu | Monitoring latenta in gpu-orchestrator. Fallback: IP public cu auth Redis ACL (temporar). |
| Download model \>20 min la startup Node C | Mica 20% | Scazut | Repartizare sharduri pe 5 noduri Hetzner \= \~10 min. Testat in Faza 0\. |
| Cost spike neasteptat RunPod (pricing variabil Community) | Mica 10% | Mediu | gpu-orchestrator: kill switch automat la 100% buget. spendLimit hardware pe cont RunPod. |
| Qwen3-72B calitate insuficienta romana B2B | Medie 40% | Inalt | Test 2 PoC obligatoriu. Fallback: Mistral Large 3 (cost+€500-800/luna). |
| EuroLLM-22B hallucineaza informatii tehnice | Mica 10% | Critic | Test 3 PoC. JSON schema strict → hallucination imposibil structural pe output definit. |
| Node B downtime → Cerniq fara AI agent | Mica 15% | Inalt | HITL restart \<5 min. Fallback chain: xAI Grok API → GPT-4o → Claude Sonnet. |

## **V.3  Licente — Confirmate v5.0**

| Model | Licenta | Comercial OK? |
| :---- | :---- | :---- |
| Qwen3-Embedding-8B | Apache 2.0 | ✅ DA — nicio restrictie |
| Qwen3-72B | Apache 2.0 | ✅ DA — nicio restrictie |
| NuExtract-2.0-8B | MIT | ✅ DA — nicio restrictie |
| DeepSeek V3 | MIT | ✅ DA — nicio restrictie |
| EuroLLM-22B | Apache 2.0 | ✅ DA — comercial complet OK |
| xAI Grok (API) | Proprietar | ✅ DA — fair use policy |
| Mistral Large 3 (contingenta) | Apache 2.0 | ✅ DA — nicio restrictie |

# **VI. CHECKLIST IMPLEMENTARE — ACTIUNI IMEDIATE v5.0**

| \# | Actiune | Urgenta | Ore Est. |
| :---- | :---- | :---- | :---- |
| 1 | Descarca modele pe hz.215 /hdd-archive (470 GB, one-time) | ACUM | 4h |
| 2 | Configureaza nginx pe hz.215 pentru servire HTTP modele | ACUM | 1h |
| 3 | Creeaza cont RunPod \+ seteaza spendLimit $500 backstop PoC | ACUM | 30min |
| 4 | Stocheaza RunPod API key in OpenBao (secret/gpu-orchestrator/runpod) | ACUM | 30min |
| 5 | Porneste 1× Pod A100 pe Vast.ai pentru Faza 0 PoC ($0.70/h) | Zi 1 | 1h |
| 6 | Test 5 (MRL 2000 dims): validare Qwen3-Emb-8B Q8 compatibilitate schema Neanelu | Zi 1 | 4h |
| 7 | Test 1 (NuExtract F-Score): 100 HTML reale Neanelu | Zi 1-2 | 8h |
| 8 | Test 2 (Qwen3-72B vs Mistral): 20-30 dialoguri B2B agricol roman | Zi 2-3 | 16h |
| 9 | Test 3 (EuroLLM hallucination): 10 inputuri cu preturi precise | Zi 3 | 4h |
| 10 | Test 4 (Pipeline complet): NuExtract → Qwen3-72B → EuroLLM pe 50 produse | Zi 3-4 | 8h |
| 11 | Decizie GO/NO-GO bazata pe PoC | Zi 5 | 4h |
| 12 | Deploy Node A \+ Node B pe RunPod Community (productie) | Saptamana 2 | 8h |
| 13 | Configureaza WireGuard peers pentru Node A/B pe orchestrator | Saptamana 2 | 2h |
| 14 | Creeaza CT115 gpu-orchestrator pe hz.223 (Node.js \+ BullMQ) | Saptamana 2-3 | 2 zile |
| 15 | Implementeaza RunPod API client (pod lifecycle \+ cost polling) | Saptamana 3 | 2 zile |
| 16 | Telegram Bot HITL pentru Node A/B operations | Saptamana 3 | 1 zi |
| 17 | Grafana dashboard: GPU Nodes (costs, utilization, throughput) | Saptamana 3 | 0.5 zi |
| 18 | Automate Node C: cron start/stop \+ queue-based trigger | Saptamana 4 | 1 zi |

# **VII. STRATEGIA DE DEVELOPMENT — CONTROL COSTURI**

In perioada de dezvoltare si testare, arhitectura de resurse GPU este fundamental diferita fata de productie. Regula de baza: niciun nod always-on in development. Nodurile always-on (Node A, Node B) exista EXCLUSIV in productie.

## **VII.1  Cele 3 Componente si Necesarul de GPU**

| Componenta | Ce dezvolti | GPU necesar in dev | Cost dev |
| :---- | :---- | :---- | :---- |
| **1\. gpu-orchestrator worker** | Node.js, BullMQ, RunPod API client, cost polling, HITL logic, cron jobs, alerting | **ZERO — cod Node.js pur** | **$0** |
| **2\. Aplicatii Neanelu / Cerniq** | Integrare API LLM, BullMQ workers, pipeline logic, debounce, retry, business logic | GPU mic RunPod (RTX 4090 sau L4) cu modele mici. Mock server pentru logica pura. | \~$0.45/h (sesiuni scurte) |
| **3\. Teste calitate modele** | F-Score NuExtract, calitate Qwen3-72B pe romana, pipeline complet, hallucination tests | A100 80GB real — DOAR cand esti gata cu testul specific. Oprit imediat dupa. | \~$1.33/h (sesiuni 2-8h) |

## **VII.2  GPU Mic RunPod pentru Componentele 1 si 2**

Un singur pod RTX 4090 (24 GB VRAM) pe RunPod Community acopera tot ce ai nevoie in development. Modelele de productie sunt inlocuite cu variante mici Q4 care incap pe 24 GB. Schimbi doar LLM\_BASE\_URL si MODEL\_NAME in .env.development. Tot codul aplicatiei — BullMQ workers, pipeline logic, debounce 120s, retry chains — ruleaza identic.

| Model productie | Inlocuitor development | VRAM | GPU dev |
| :---- | :---- | :---- | :---- |
| Qwen3-72B FP8 (72 GB) | Qwen3-8B Q4 (\~5 GB) | 5 GB | RTX 4090 24 GB — $0.45/h |
| EuroLLM-22B Q8 (24 GB) | EuroLLM-9B Q4 / Llama-3-8B Q4 (\~5 GB) | 5 GB | RTX 4090 24 GB — $0.45/h |
| NuExtract-2.0-8B FP16 (16 GB) | Acelasi model Q4 (\~5 GB) | 5 GB | RTX 4090 24 GB — $0.45/h |
| Qwen3-Emb-8B Q8 (8 GB) | Acelasi model Q4 (\~4 GB) | 4 GB | RTX 4090 24 GB — $0.45/h |
| DeepSeek V3 GGUF (350 GB / 5 pods) | DeepSeek-R1-8B Q4 (\~5 GB) | 5 GB | RTX 4090 24 GB — $0.45/h |
| **Cost total dev vs productie** | 1x RTX 4090 (on-demand, sesiuni scurte) | **$0.45/h** | **vs $6.65/h (3x A100 productie) \= de 15x mai ieftin** |

| gpu-orchestrator worker (componenta 1\) NU necesita niciun pod RunPod in development. Tot RunPod API client-ul se testeaza cu un mock local sau cu queries read-only gratuite. Cheltuiesti $0 GPU pentru a dezvolta 100% din logica de orchestrare, cost monitoring si HITL. |
| :---- |

## **VII.3  Workflow Sesiuni de Dezvoltare**

Modelul de lucru in development: pornesti podul cand lucrezi, il opresti cand nu lucrezi. Nu exista pod deschis peste noapte sau in weekend.

| Activitate | Pod necesar | Durata sesiune | Cost sesiune |
| :---- | :---- | :---- | :---- |
| Dezvoltare gpu-orchestrator (API client, BullMQ, HITL) | NICIUNUL — mock local | Ore intregi zilnic | **$0** |
| Business logic Neanelu/Cerniq fara LLM real (pipeline, queues, retry) | NICIUNUL — mock OpenAI-compatible server local (llama-server cu TinyLlama 1B) | Ore intregi zilnic | **$0** |
| Test integrare LLM real (format prompt/response, pipeline end-to-end cu model mic) | 1x RTX 4090 RunPod — pornit, testat, oprit | 1-2h/sesiune | \~$0.50-1 |
| Test calitate model (F-Score, calitate romana, hallucination — model real) | 1x A100 80GB Vast.ai — pornit, testat, oprit | 4-8h/sesiune | \~$3-6 (Vast.ai $0.70/h) |
| Test pipeline complet end-to-end pre-productie | 1x A100 80GB Vast.ai — sesiune dedicata | 4-6h | \~$3-4 |

## **VII.4  Switch Controlat catre Nodurile Reale (Faza 1 Validare)**

Trecerea de la GPU mic la nodurile reale A100 se face in sesiuni controlate, cu obiectiv clar si durata maxima prestabilita. Nu pornesti un nod 'sa vezi ce se intampla'.

| Etapa | Noduri active | Sesiuni | Cost |
| :---- | :---- | :---- | :---- |
| **Development (Sapt. 1-6)** | 0 sau 1x RTX 4090 on-demand | 1-2h/zi cand e nevoie | \~$20/luna |
| **Faza 0 PoC (Sapt. 7-8)** | 1x A100 80GB Vast.ai, on-demand per test, oprit dupa fiecare test | 5 sesiuni × 4-8h | \~$200-300 total (one-time) |
| **Faza 1 Validare (Sapt. 9-10)** | Node A \+ Node B RunPod, sesiuni 4-6h: validezi throughput real, latenta, WireGuard, Redis, BullMQ integration | 3-4 sesiuni × 4-6h, oprite dupa fiecare | \~$55-80 total (one-time) |
| **Productie (Luna 3+)** | Node A \+ B always-on 24/7. Node C on-demand automat prin gpu-orchestrator. | Permanent — GO confirmat din PoC \+ validare | **\~$3,460/luna** |

## **VII.5  Reguli de Cost Control in Development**

| \# | Regula | Implementare concreta |
| :---- | :---- | :---- |
| **R1** | Auto-stop obligatoriu pe orice pod de dev | Script startup pod: sleep 14400 && runpodctl stop pod $RUNPOD\_POD\_ID & — SAU: 'Stop After \= 4 hours' din RunPod dashboard la creare pod |
| **R2** | Cont RunPod separat pentru development | Al doilea cont RunPod cu spendLimit \= $100/luna. Imposibil sa depasesti accidental, indiferent ce se intampla. |
| **R3** | Vast.ai pentru toate testele cu A100 (nu RunPod) | Vast.ai $0.70/h vs RunPod $1.33/h — economie 47% per sesiune de test. Fiabilitatea nu conteaza in dev. |
| **R4** | Node C nu exista in development | DeepSeek V3 pe 5x A100 nu se testeaza niciodata complet in dev. Testezi logica cu model mic, calitatea cu 1x A100 pe sample-uri limitate. |
| **R5** | Sesiunile Faza 1 se planifica in avans | Fiecare sesiune cu noduri reale: obiectiv clar documentat, checklist de validat, durata maxima 6h. Nu pornesti fara plan. |
| **R6** | Mock server local pentru zero-cost dev zilnic | llama-server sau vllm cu TinyLlama 1.1B (1 GB RAM, fara GPU). Port 8000 local. Tot codul aplicatiei ruleaza identic. |

## **VII.6  Cost Lunar Estimat in Development**

| Activitate | Frecventa | Cost |
| :---- | :---- | :---- |
| gpu-orchestrator \+ business logic (mock/zero GPU) | Zilnic, ore intregi | **$0** |
| Sesiuni RTX 4090 pentru integrare LLM real | 1-2h/zi × 15 zile lucratoare | \~$14-20/luna |
| Faza 0 PoC pe Vast.ai (5 teste A100) | One-time | \~$200-300 total |
| Faza 1 validare noduri reale RunPod (3-4 sesiuni) | One-time, inainte de productie | \~$55-80 total |
| **TOTAL development lunar recurent** | Pe toata perioada de dev | **\~$20/luna** |
| **TOTAL one-time pana la productie** | PoC \+ validare | **\~$280-380** |

| Raport cost: Development \~$20/luna recurent \+ \~$300 one-time vs Productie $3,460/luna. Nu pornesti Node A si Node B in modul always-on pana cand nu ai GO confirmat din toate cele 5 teste PoC si din sesiunile de validare Faza 1\. |
| :---- |

# **VIII. CONCLUZIE v5.0**

Versiunea 5.0 finalizeaza arhitectura de infrastructura GPU pe baza cercetarii de piata complete din Februarie 2026 si a analizei infrastructurii Hetzner existente. Principalele evolutii fata de v3.1/v4.0:

* **RunPod Community Cloud selectat ca provider GPU (Hetzner nu are A100 80GB)**

* **Zero costuri noi pentru Redis, storage modele si backupuri — infrastructura Hetzner existenta acopera totul**

* **gpu-orchestrator worker adaugat: control programatic complet al ciclului de viata pods \+ monitorizare costuri reale \+ HITL via Telegram**

* **Cost total redus la \~€3,460/luna fata de €4,090-5,460 estimat in v4.0 (14-37% economie)**

* **Fata de full API usage: economie 77-90% (€15,000-35,000 → €3,460)**

| PRIORITATEA \#1 RAMANE NESCHIMBATA: Acuratetea datelor. Faza 0 PoC este obligatorie si non-negociabila. Nicio decizie de cost sau simplitate nu justifica sacrificarea preciziei de extractie sau calitatii lingvistice in romana. |
| :---- |

*Document actualizat: Versiunea 5.0  |  Februarie 2026  |  Claude Sonnet 4.6  |  Confidential*