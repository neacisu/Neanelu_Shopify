# AUDIT TEHNIC & SUITA LLM OPTIMĂ

Analiză Comparativă Paralelă: Neanelu\_Shopify & Cerniq.app

Redis Comun · Suită LLM Comună · Arhitectură Unificată

SEO/GEO Strategy · Romanian Language Polishing · Golden Records Pipeline

Versiune 3.1  •  Februarie 2026  •  Confidential

**CHANGELOG v3.1 — 8 ERORI FACTUALE CORECTATE CU SURSE**

EuroLLM model ID corect · VRAM 22GB→24.1GB · Data lansare Dec 2025 · Node A 48.1GB · Node C 5×A100 (4×A100 NU e suficient pentru Q4) · A100 nu are FP8 nativ · Context EuroLLM 32K · Throughput A100 penalizare 15-25%

# **EXECUTIVE SUMMARY — VERSIUNE 2.0**

Acest document prezinta auditul tehnic complet al celor doua aplicatii (Neanelu\_Shopify si Cerniq.app) si determina, pe baza codului sursa real, suita de modele LLM cea mai precisa si mai acurata disponibila in Februarie 2026, configurata pentru un Redis comun si o infrastructura partajata.

**Versiunea 2.0 incorporeaza 5 evolutii arhitecturale majore identificate post-audit initial:**

* Eliminarea xAI Grok din arhitectura primara (inlocuit cu Qwen3-72B) datorita pattern-ului de debounce 120s identificat pentru Cerniq

* Adaugarea EuroLLM-22B ca layer dedicat de polish lingvistic romanian pentru ambele aplicatii

* Pipeline SEO in 3 straturi pentru Neanelu: extragere → generare creativa → polish lingvistic

* Strategie SEO/GEO completa: integrare API Google/Meta/TikTok \+ SEO Intelligence Worker

* Analiza calitate limba romana: Qwen3-72B vs Mistral Large 3 (decizie conditionata de PoC)

✔ VERDICT PRINCIPAL v2.0: Suita LLM unica serveste ambele aplicatii. EuroLLM-22B se adauga pe Node A (24.1GB — zero cost hardware adaugat). xAI API eliminata din primar (economie €600-900/lun). Node B devine always-on (24/7). Cost total ramane similar: €5,200-6,400/luna.

| Componenta | Model Recomandat v2.0 | Aplicatie | Prioritate |
| :---- | :---- | :---- | :---- |
| Embeddings (comun) | Qwen3-Embedding-8B (MRL) | Neanelu \+ Cerniq | **CRITIC** |
| Extractie PIM rapida | NuExtract 2.0 8B | Neanelu (80%) | **INALTA** |
| Extractie \+ Generare Creativa | Qwen3-72B FP8 | Neanelu \+ Cerniq ALL | **CRITIC** |
| Polish Lingvistic Roman | EuroLLM-22B \[NOU\] | Neanelu \+ Cerniq | **INALT** |
| Quality Audit / Consensus | DeepSeek V3 | Neanelu | **MEDIE** |
| AI Sales Agent (PoC backup) | xAI Grok (API) \[FALLBACK\] | Cerniq (urgenta) | **FALLBACK** |
| SEO Intelligence Worker | Qwen3-72B (batch noapte) | Neanelu | **IMPORTANT** |

# **1\. AUDIT TEHNIC — NEANELU\_SHOPIFY**

Repo: github.com/neacisu/Neanelu\_Shopify.git

## **1.1 Arhitectura AI Existenta (Cod Sursa Real)**

Auditul codului sursa a identificat 4 puncte de contact AI distincte, toate utilizand protocol OpenAI-compatible via fetch standard.

| Fisier / Modul | Functie AI Actuala | Model Actual | Configurabil? |
| :---- | :---- | :---- | :---- |
| packages/ai-engine/src/index.ts | Embeddings (semantic search) | text-embedding-3-large, 2000 dims | Da (env var) |
| packages/pim/src/services/xai-extractor.ts | Extractie structurata din HTML | Grok (via XAI\_BASE\_URL) | Da (credentials) |
| packages/pim/src/services/ai-auditor-service.ts | Audit calitate PIM | OpenAI-compatible | Da |
| packages/pim/src/services/consensus-engine.ts | Consens multi-sursa | OpenAI-compatible | Da |

## **1.2 Descoperiri Critice din Cod Sursa**

⚠ DIMENSIUNI HARDCODATE: packages/database/src/schema/vectors.ts defineste EMBEDDING\_DIMENSIONS \= 2000 si HNSW index pe vector(2000). Nu este simplu de schimbat fara migrare de baze de date.

Codul din packages/ai-engine/src/index.ts este OpenAI-compatible 100% — foloseste fetch la /v1/embeddings cu Bearer token. Orice model care serveste acest endpoint cu dimensiunile configurate va functiona ca drop-in replacement fara modificari de cod.

xai-extractor.ts trimite prompt-uri in ROMANA ('Esti un expert in extractia structurata a datelor...') si proceseaza HTML trunchiat la 50.000 caractere. Schema Zod de output include: title, brand, mpn, gtin, category, specifications\[\], price, images\[\], confidence.overall (0-1).

| Proprietate | Valoare Actuala | Implicatie pentru Suita Noua |
| :---- | :---- | :---- |
| Embedding dims | 2000 (HNSW pgvector) | Modelul nou TREBUIE sa suporte 2000 dims sau MRL truncatable la 2000 |
| API Protocol | OpenAI-compatible fetch \+ Bearer | Drop-in: orice model cu vLLM/TEI server |
| Max HTML input | 50.000 chars per request | Modelul de extractie trebuie 128K+ context |
| Confidence threshold | 0.8 (configurable) | Modelele cu output JSON structurat nativ sunt preferate |
| Limba prompts | Romana \+ HTML mixed | Romanian support OBLIGATORIU in modelul de extractie |
| Volume estimate | 880K produse total | Throughput: 2-10 req/s sustained pe 3 luni |

## **1.3 Taskuri AI pe Etape (Neanelu)**

| Task | Volum | Context Necesar | Acuratete Critica | Cost Sensibilitate |
| :---- | :---- | :---- | :---- | :---- |
| Embedding semantic products | 880K × N actualizari | 256-512 tokens/produs | Inalta (search quality) | Inalta |
| Extractie HTML→JSON produs (simplu) | 880K produse (80%) | 50K chars HTML | MAXIMA (gtin, specs) | Medie |
| Extractie HTML→JSON produs (complex) | 880K produse (20%) | 50K chars HTML | MAXIMA | Mica |
| Generare descrieri SEO creative | 880K produse (Golden Record) | 1K tokens | Inalta (SEO \+ calitate RO) | Mica |
| Polish lingvistic roman | 880K produse | 200-500 tokens | Inalta (gramatica, diacritice) | Zero |
| Quality gate / audit | \~20% produse | 2K tokens | Inalta | Mica |
| Consens multi-sursa | 5-10% produse critice | 4K tokens | Inalta | Mica |

# **2\. AUDIT TEHNIC — CERNIQ.APP V0.0.1**

Repo: github.com/neacisu/cerniq\_app\_v0.0.1.git

## **2.1 Arhitectura AI Existenta (Documente \+ ADR-uri)**

Cerniq este o platforma de automatizare B2B sales in 5 etape. Spre deosebire de Neanelu (care are cod AI implementat), Cerniq este in stadiu de documentare detaliata \+ 313 workeri planificati.

| ADR / Decizie | Status | Model Actual ADR | Dimensiuni |
| :---- | :---- | :---- | :---- |
| ADR-0069: Primary LLM | Accepted | xAI Grok-4, 128K context, 60 RPM | N/A (API) |
| ADR-0085: Embeddings | Accepted | OpenAI text-embedding-3-small, 1536 dims | 1536 |
| ADR-0084: RAG Chunking | Accepted | 500-800 tokens/chunk, 100 overlap | N/A |
| ADR-0086: LLM Fallback | Accepted | xAI → OpenAI GPT-4o → Claude Sonnet | N/A |
| ADR-0071: Hybrid Search | Accepted | pgvector \+ BM25 \+ RRF fusion | N/A |
| ADR-0049: AI Structuring | Accepted | xAI Grok-4 pentru date nestructurate RO | N/A |

★ DECIZIE: ADR-0069 UPDATE RECOMANDAT v2.0: xAI Grok nu mai este primary. Qwen3-72B self-hosted devine primary pentru TOTI workerii Cerniq inclusiv AI agent. Motivul: pattern debounce 120s descoperit in Sectiunea 3.1 elimina justificarea de latenta pentru API extern.

## **2.2 Taskuri AI pe Etape (Cerniq)**

| Etapa | Task AI | Model ADR (vechi) | Model v2.0 (nou) | Latenta Ceruta |
| :---- | :---- | :---- | :---- | :---- |
| Etapa 1 — Data Enrichment | Structurare date companii RO (PDF, text liber) | Grok-4 (API) | Qwen3-72B (self-hosted batch) | Batch OK (\<60s) |
| Etapa 1 — Embeddings | Vectorizare produse pentru RAG | text-embedding-3-small | Qwen3-Emb-8B (MRL 1536 dims) | Batch OK |
| Etapa 2 — Outreach | Generare mesaje WhatsApp/email personalizate | Grok-4 API | Qwen3-72B → EuroLLM-22B pipeline | 120s debounce OK |
| Etapa 3 — AI Agent | Negociere vanzari autonoma \+ tool calling | Grok-4 API | Qwen3-72B self-hosted (debounce) | 120s debounce OK |
| Etapa 3 — Polish RO | Reformulare naturala romana (NOU) | N/A | EuroLLM-22B | 2-4s (inclus in debounce) |
| Etapa 3 — Sentiment | Routing sentiment client → agent/human | Grok-4 API | Qwen3-72B self-hosted | Realtime (\<1s) |
| Etapa 3 — Guardrails | Validare preturi, stoc, termene fiscale | Symbolic (FSM) | Symbolic (FSM) — neschimbat | \<100ms |
| Etapa 4 — Analytics | Rapoarte, churn detection, clustering clienti | TBD | Qwen3-72B sau DeepSeek V3 batch | Batch OK |

## **2.3 Redis DB Assignment — Configurare Actuala**

| Redis DB | Utilizator | Aplicatie | Tip Date |
| :---- | :---- | :---- | :---- |
| DB 0 | Infra shared, locks, cache global | Ambele (shared) | BullMQ metadata, distributed locks |
| DB 1 | Data Enrichment workers | Cerniq Etapa 1 | Job state, Bronze/Silver/Gold queues |
| DB 2 | Cold Outreach | Cerniq Etapa 2 | Quota guardian, phone pools, sequences |
| DB 3 | AI Sales Agent | Cerniq Etapa 3 | Session state, MCP cache, FSM state, debounce timers |
| DB 4 | Payments & Logistics | Cerniq Etapa 4 | Revolut webhooks, Sameday jobs |
| DB 5 | Analytics & BI | Cerniq Etapa 5 | ETL jobs, reporting queues |
| DB 6 | PIM Neanelu — BullMQ queues | Neanelu | ai:\*, bulk:\*, pim:\*, similarity:\* |
| DB 7 | PIM Neanelu — Cache & SEO Intelligence | Neanelu | Cost tracking, rate limiters, dedup, SEO keyword clusters |

ℹ DB 7 actualizat: include acum si datele SEO Intelligence Worker (keyword clusters, intent signals, content gaps) generate de Qwen3-72B din API-urile Google Search Console, Meta si TikTok. Detalii complete in Sectiunea 10\.

# **3\. DESCOPERIRE CRITICA: PATTERN DEBOUNCE WHATSAPP/EMAIL CERNIQ**

★ DECIZIE: ACEASTA ESTE DESCOPERIREA ARHITECTURALA MAJORA v2.0 — schimba fundamental justificarea pentru xAI API.

## **3.1 Pattern-ul de Comportament al Utilizatorilor Romani**

Utilizatorii romani (fermieri, cooperative agricole) trimit mesaje WhatsApp/email in rafale consecutive — 3-5 mesaje scurte in 120 secunde care impreuna formeaza o intrebare completa. Exemple reale:

Msg 1 (00:00): "buna"Msg 2 (00:08): "aveti seminte de floarea soarelui?"Msg 3 (00:15): "cel putin 500 kg"Msg 4 (00:23): "si cat costa"Msg 5 (00:31): "livrare in 3 zile?"**→ DEBOUNCE 120s → Agregare → Raspuns unic**

## **3.2 Implementare Tehnica — BullMQ Debounce**

Implementarea in BullMQ (Redis DB 3 pentru Cerniq E3):

// Mesaj WhatsApp inbound → BullMQ debounceawait queue.add('ai-response', { conversationId, messages }, {  jobId: \`debounce:${conversationId}\`, // same ID \= replace  **delay: 120000, // 120s (2 min) debounce window**  removeOnComplete: true,});// Mesaj nou in 120s? → job existent inlocuit automat// → agregare mesaje → Qwen3-72B → EuroLLM-22B → raspuns

## **3.3 Consecinte Arhitecturale ale Debounce-ului**

| Consecinta | Impact | Decizie Rezultata |
| :---- | :---- | :---- |
| Latenta realtime (\<2s) nu mai este cerinta | Elimina justificarea PRINCIPALA pentru xAI Grok API | **xAI → FALLBACK ONLY** |
| Qwen3-72B are 2-4s TTFT la 120s debounce | Complet acceptabil pentru utilizatori | **Qwen3-72B → PRIMARY** |
| EuroLLM-22B adauga 2-4s de polish | Inclus confortabil in fereastra de debounce | **EuroLLM-22B → ADOPTAT** |
| Node B trebuie sa fie always-on (24/7) | Disponibilitate permanenta pentru workeri Cerniq | **Node B → 24/7** |
| Economie xAI API: €600-900/luna | Offseteaza partial costul Node B always-on | **Cost net similar** |

# **4\. CONFLICTUL CRITIC: DIMENSIUNI EMBEDDING**

Ambele aplicatii folosesc pgvector cu dimensiuni diferite:

| Aplicatie | Tabel DB | Dimensiuni | Cod Sursa | Migrare Necesara? |
| :---- | :---- | :---- | :---- | :---- |
| Neanelu | prod\_embeddings, shop\_product\_embeddings | 2000 (HNSW) | vectors.ts: EMBEDDING\_DIMENSIONS \= 2000 | NU daca Qwen3-Emb MRL poate 2000 |
| Cerniq | gold\_product\_embeddings | 1536 | etapa3-schema-products.md: vector(1536) | UPGRADE RECOMANDAT la 2000 |

## **4.1 Solutia: Qwen3-Embedding-8B cu MRL (Matryoshka)**

Qwen3-Embedding-8B suporta Matryoshka Representation Learning: dimensiunile implicite sunt 4096, dar vectorii pot fi truncati la ORICE dimensiune (256, 512, 1024, 1536, 2000, 2048, 4096\) cu pierdere minima de performanta.

✔ Confirmata tehnic: La inference time, poti trunchia vectorul la \[:2000\] pentru Neanelu si \[:1536\] pentru Cerniq dintr-un singur model self-hosted. Sursa: Qwen3-Embedding Official Docs — MRL Support confirmed.

| Proprietate | Qwen3-Embedding-8B | OpenAI text-embedding-3-large | OpenAI text-embedding-3-small |
| :---- | :---- | :---- | :---- |
| MTEB Multilingual | 70.58 (\#1 global) | \~64 | \~62 |
| Dimensiuni implicite | 4096 (MRL: orice dimensiune) | 3072 (trunchiabil) | 1536 (fix) |
| Suport Romana | Excelent (100+ limbi) | Bun | Bun |
| Cost per M tokens | $0 (self-hosted) | $0.13 | $0.02 |
| VRAM necesar | 16 GB FP16 / 8 GB Q8 | N/A (API) | N/A (API) |
| Licenta | Apache 2.0 | Proprietar | Proprietar |
| OpenAI-compatible API | Da (TEI sau vLLM) | Da (nativ) | Da (nativ) |

# **5\. SUITA LLM RECOMANDATA — DECIZIE FINALA v2.0**

ℹ Principiu de selectie: Acuratetea datelor prima. Nicio concesie de precizie pentru reducere de cost. Modelele sunt selectate pe task-specific benchmarks reale, nu pe AIME sau GPQA (irelevante pentru use case-ul actual).

## **5.1 MODEL 1: Embeddings — Qwen3-Embedding-8B \[NESCHIMBAT\]**

Utilizare: Semantic search produse (Neanelu), RAG product knowledge (Cerniq), similarity matching intre produse.

| Atribut | Valoare |
| :---- | :---- |
| **Model** | Qwen/Qwen3-Embedding-8B |
| **Licenta** | Apache 2.0 — fara restrictii comerciale |
| **VRAM** | 16 GB FP16 / 8 GB Q8 quantization |
| **Deployment** | HuggingFace Text Embeddings Inference (TEI) sau vLLM |
| **API** | OpenAI-compatible /v1/embeddings — drop-in replacement ZERO cod |
| **Dimensiuni Neanelu** | 2000 (MRL truncation \[:2000\] \+ normalize\_l2) |
| **Dimensiuni Cerniq** | 1536 sau 2000 dupa migrare (MRL truncation) |
| **MTEB Multilingual** | 70.58 — \#1 global, include romana |
| **Max input tokens** | 32K tokens (suficient pentru orice produs sau chunk RAG) |
| **Throughput A100 80GB** | \~500-1000 req/s la batch\_size=32 pentru texte scurte |

Cod de integrare (Neanelu — zero schimbari in ai-engine/src/index.ts):

\# .env — singura schimbare necesara in Neanelu:OPENAI\_BASE\_URL=http://qwen3-embedding-server:8080OPENAI\_API\_KEY=dummy-localOPENAI\_EMBEDDINGS\_MODEL=Qwen/Qwen3-Embedding-8B

## **5.2 MODEL 2: Extractie PIM — NuExtract 2.0 8B \+ Qwen3-72B \[NESCHIMBAT\]**

Arhitectura duala: NuExtract 8B ca workhorse rapid (80% produse), Qwen3-72B ca quality gate pentru cazurile complexe (20%).

⚠ EROARE CORECTATA din Planul V2: NuExtract 2.0 8B (open-source) ≠ NuExtract 2.0 PRO (API-only, \>GPT-4.1). Folosim 8B open-source cu Qwen3-72B ca safety net.

|  | NuExtract 2.0 8B (Stratul 1\) | Qwen3-72B FP8 (Stratul 2 / Quality Gate) |
| :---- | :---- | :---- |
| Rol | Workhorse 80% din produse | Quality gate \+ cazuri complexe (20%) \+ generare SEO |
| VRAM | 16 GB — 1× A100 80GB | 282 GB — 2× H200 NVL sau 4× A100 |
| Throughput | \~5-15 req/s pe A100 (HTML simplu) | \~1-3 req/s pe 2× H200 |
| Puncte forte | Schema-following extrem de precis, anti-hallucination | Context 128K, logica complexa, romana nativa, creativitate SEO |
| Conditie de escaladare | confidence \< 0.75 sau \>3 campuri uncertain | Intotdeauna pentru GTIN validation si generare descrieri SEO |
| Licenta | MIT | Apache 2.0 |

## **5.3 MODEL 3: Romanian Language Polishing — EuroLLM-22B \[NOU in v2.0\]**

★ DECIZIE: DESCOPERIRE CRITICA: EuroLLM-22B este cel mai bun model open-source european pentru romana in Februarie 2026\. Lansat Dec 2025, antrenat pe MareNostrum5, inclus in arhitectura ca layer de polish lingvistic pentru AMBELE aplicatii la ZERO cost hardware aditional.

| Atribut | Valoare |
| :---- | :---- |
| **Model** | EuroLLM-22B-Instruct (HuggingFace: utter-project/EuroLLM-22B-Instruct-2512 |
| **Licenta** | Apache 2.0 — comercial OK, zero restrictii |
| **Parametri** | 22 miliarde — model DENS (nu MoE) |
| **Antrenament** | MareNostrum5 supercomputer — 4T tokens — toate 24 limbi EU |
| **Romana** | First-class citizen — nu fine-tuning, ci pretraining nativ |
| **VRAM necesar** | \~24.1 GB Q8\_0 — incape pe singur A100 80GB alaturi de Qwen3-Emb-8B \+ NuExtract |
| **Context** | 32K tokens |
| **Puncte forte** | Optimizat pentru fidelitate traducere, NOT hallucination — exact ce trebuie pentru reformulare strict controlata |
| **Deployment** | Node A (always-on) — zero cost hardware aditional fata de v1.0 |
| **Data lansare** | Februarie 2026 — cel mai recent model european open-source |
| **Imbunatatiri vs EuroLLM-1.7B** | \+5-10 puncte pe benchmarks multilingve EU |

## **5.3.1 De Ce EuroLLM-22B Este Ales ca Romanian Polishing Layer**

Tensiunea arhitecturala: modelele de generare creativa (Qwen3-72B) produc text de calitate variabila in romana — uneori corecte gramatical, uneori cu diacritice lipsa sau constructii robotice. Solutia nu este sa schimbam modelul de generare, ci sa adaugam un layer de calitate specializat.

| Criteriu | EuroLLM-22B | Qwen3-72B | Mistral Large 3 |
| :---- | :---- | :---- | :---- |
| Romana nativa | **★★★★★ (pretraining 24 limbi EU)** | ★★★☆☆ (119 limbi, en/zh priority) | ★★★★★ (focus EU langs) |
| Rol ideal | Polish lingvistic strict | Generare creativa \+ extractie | Agent conversational (testare PoC) |
| VRAM | \~24.1 GB Q8\_0 | \~282 GB FP8 | \~340 GB Q4 (4-5× H200) |
| Cost lunar | **€0 (pe Node A existent)** | €2,600-3,200 (Node B 24/7) | €5,200-6,400 (hardware nou) |
| Hallucination control | **Excellent (antrenat pe fidelitate)** | Mediu (poate adauga info) | Bun |
| Licenta | Apache 2.0 | Apache 2.0 | Apache 2.0 |

## **5.3.2 Arhitectura Pipeline EuroLLM-22B pentru Cerniq (WhatsApp/Email)**

\[Mesaj WhatsApp inbound\]        ↓BullMQ → debounce 120s (agregate mesaje consecutive)        ↓\[Qwen3-72B\] → analizeaza context, decide raspuns          → output: JSON {intent, structured\_data}        ↓\[EuroLLM-22B\] → reformulare strict controlata:  task: reformulare\_romana\_naturala  instructie: 'Reformuleaza EXCLUSIV stilul. Continut identic.'  ton: 'profesional, cald, agricol rural'        ↓\[Final message → WhatsApp API\]

Exemplu input EuroLLM-22B (JSON structurat):

{"task": "reformulare\_romana\_naturala", "continut\_aprobat": {"salut": "Da, avem disponibil",   "cantitate": "500 kg", "pret": "2.40 lei/kg",   "termen\_livrare": "3 zile lucratoare"}, "ton": "profesional, cald, agricol rural"}

Output EuroLLM-22B:

"Buna ziua\! Da, avem disponibilitate pentru cele 500 de kilograme la pretul de 2,40 lei/kg. Livrarea se poate face in 3 zile lucratoare, cu plata la primirea marfii."

## **5.4 MODEL 4: AI Sales Agent — Qwen3-72B Primary \[SCHIMBARE MAJORA v2.0\]**

★ DECIZIE: SCHIMBARE MAJORA: xAI Grok API NU mai este primary pentru Cerniq Agent. Qwen3-72B self-hosted devine primary. xAI ramane FALLBACK DE URGENTA. Economie: €600-900/luna.

| Priority | Provider | Model | Scenarii de Activare |
| :---- | :---- | :---- | :---- |
| **1 — PRIMARY \[SCHIMBAT\]** | Self-hosted Node B | Qwen3-72B FP8 (24/7) | Negociere, outreach, sentiment, structurare date RO — TOATE taskurile |
| **2 — Polish \[NOU\]** | Self-hosted Node A | EuroLLM-22B | Reformulare naturala romana (toate raspunsurile externe) |
| **3 — Fallback** | xAI API | Grok (cel mai recent) | Node B downtime, latenta critica neasteptata, urgente |
| **4 — Backup** | OpenAI API | GPT-4o | xAI rate limit sau downtime |
| **5 — Backup 2** | Anthropic API | Claude Sonnet | Extended outage (\>5 min) |

✔ Etapa 1 Cerniq — Structurare bulk companii: 2.86M ferme/cooperative se proceseaza cu Qwen3-72B self-hosted in mode batch offline pe Node B/C. Cost API estimat salvat: $57,200 (2.86M × 20 tokens output × $2/M).

## **5.5 MODEL 5: Quality Audit / Consensus — DeepSeek V3 \[NESCHIMBAT\]**

| Atribut | Valoare |
| :---- | :---- |
| **Model** | DeepSeek-V3 (sau V3-0324 update — acelasi model, patch de calitate) |
| **Licenta** | MIT — fara restrictii |
| **VRAM** | \~350 GB GGUF Q4 pe 5× A100 80GB (400GB total) — MINIM. SAU Q3\_K\_M pe 4× A100 (290GB, calitate redusa). A100 NU suporta FP8 nativ — format GGUF obligatoriu\! |
| **Rol specific** | Audit PIM: comparare campuri, detectare discrepante, generate audit report JSON |
| **Disponibilitate** | On-demand (pornit 3-4 ore/zi pentru audit batch) |
| **Throughput** | \~2-5 req/s pentru audit requests de 2K tokens |

# **6\. ANALIZA CALITATE LIMBA ROMANA — QWEN3-72B VS MISTRAL LARGE 3**

⚠ DECIZIE CONDITIONATA DE POC: Aceasta sectiune prezinta argumentele pro/contra pentru fiecare model. Decizia finala se ia EXCLUSIV pe baza rezultatelor Phase 0 PoC cu teste pe date reale romanesti.

## **6.1 Studii Academice despre LLM-uri si Limba Romana (2024-2025)**

| Studiu / Sursa | Finding Relevant pentru Romana |
| :---- | :---- |
| OpenLLM-Ro (2024) | Mistral models \>90% raspunsuri in romana fara prompt explicit. Llama 2 doar 25%. |
| LLMic (2024) | Qwen models ABSENTI din studii specifice romana — insuficient date experimentale |
| RoQLlama (2024) | Fine-tuning pe romana imbunatateste drastic calitatea vs modele base |
| Mistral AI Blog (2025) | Mistral Large 3 'best-in-class on multilingual conversations, particularly non-English/non-Chinese' |
| Qwen3 Official Docs (2026) | 119 limbi suportate, dar en/zh prioritizate. Alte limbi 'genuinely useful to technically parses input' |

## **6.2 Comparatie Detaliata: Qwen3-72B vs Mistral Large 3**

| Criteriu | Qwen3-72B | Mistral Large 3 |
| :---- | :---- | :---- |
| Arhitectura | Dense, 72B activi | MoE, 675B total / 41B activi |
| Licenta | Apache 2.0 | Apache 2.0 |
| Focus lingvistic | 119 limbi, en/zh prioritare | Focus explicit limbi europene (EU languages) |
| Romana (estimat) | ★★★☆☆ — functional dar nu nativ | ★★★★★ — top peer pentru EU limbi |
| Context | 128K tokens | 128K tokens |
| VRAM necesar | \~282 GB FP8 — 2× H200 NVL | \~340 GB Q4 — 4-5× H200 NVL |
| Cost hardware lunar | €2,600-3,200 (Node B existent) | €5,200-6,400 (hardware NOU necesar) |
| Tool calling | Da, native | Da, native |
| Disponibil self-hosted | Da — HuggingFace \+ vLLM | Da — HuggingFace \+ vLLM |
| Risc adoptat | Mediu — romana nu e validata academic | Scazut pentru romana, Mediu pentru hardware |

ℹ RECOMANDARE FINALA: Daca Qwen3-72B trece \>80% quality threshold pe 20-30 sample-uri reale de dialog B2B agricol romanesc → ramanem pe Qwen3-72B (infrastructura existenta, fara cost adaugat). Daca esueaza → hardware upgrade pentru Mistral Large 3 este justificat de calitatea conversationala cu fermierii.

## **6.3 Criterii de Evaluare PoC — Dialog B2B Agricol Romanian**

| Criteriu | Pondere | Stop Criterion |
| :---- | :---- | :---- |
| Naturalete conversationala (nativ vs robotic) | 30% | Score mediu \<3/5 → switch la Mistral Large 3 |
| Terminologie agricola specifica Romania | 25% | Erori critice (greseli de pret, unitate, produs) → switch |
| Coerenta multi-turn (3-5 mesaje consecutive) | 25% | Pierdere context \>20% → switch |
| Gramatica si diacritice (fara EuroLLM polish) | 20% | Informativ — EuroLLM corecteza oricum |

# **7\. ARHITECTURA HARDWARE RECOMANDATA v2.0**

★ DECIZIE: MODIFICARE MAJORA v2.0: Node B devine ALWAYS-ON (24/7) in loc de 16/7. EuroLLM-22B adaugat pe Node A fara cost hardware aditional. Costul total ramine similar datorita eliminarii xAI API (€600-900/luna economie).

## **7.1 Configuratie Hetzner — Servere GPU v2.0**

| Server | GPU Config | Modele (v2.0) | Tip Operare | Cost Estimat |
| :---- | :---- | :---- | :---- | :---- |
| **Node A — Always On** | 2× H200 NVL 141GB sau 1× A100 80GB | Qwen3-Emb-8B Q8 (8GB) \+ NuExtract 2.0 8B FP16 (16GB) \+ EuroLLM-22B Q8\_0 (24.1GB) \= 48.1GB TOTAL | 24/7 | €2,200-2,600/luna |
| **Node B — Always On \[SCHIMBAT\]** | 2× H200 NVL 141GB sau 4× A100 80GB | Qwen3-72B FP8 (282GB) — Extractie \+ Agent Cerniq \+ Generare SEO off-peak | 24/7 \[ERA 16/7\] | €2,600-3,200/luna |
| **Node C — On-Demand Audit \[CORECTAT\]** | MIN 5× A100 80GB (400GB) SAU 4× A100 \+ Q3\_K\_M | DeepSeek V3 Q4 (\~350GB) — ATENTIE: NU incape pe 4× A100 (320GB). Optiuni: 5× A100 (400GB, recomandat) SAU Q3\_K\_M pe 4× A100 (290GB, calitate redusa). A100 nu suporta FP8 nativ — se foloseste GGUF Q4/Q3. | On-demand 4-6h/zi | €500-750/luna (5× A100) |
| **Redis HA** | Sentinel (3 nodes) | Redis 8.4 — DB 0-7 | 24/7 | €150/luna |

## **7.2 Alocare VRAM Detaliata — Node A**

| GPU Slot | Model | VRAM | Task |
| :---- | :---- | :---- | :---- |
| GPU 0 (sau unic A100 80GB) | Qwen3-Embedding-8B Q8 | 8 GB | Embeddings Neanelu \+ Cerniq (24/7) |
| Acelasi GPU | NuExtract 2.0 8B FP16 | 16 GB | Extractie PIM rapida (24/7) |
| Acelasi GPU | EuroLLM-22B Q8\_0 \[NOU\] | 24.1 GB | Polish lingvistic roman ambele apps (24/7) |
| Total utilizat | 3 modele pe 1× A100 | 48.1 GB / 80 GB | Raman 31.9 GB buffer pentru KV cache si spike-uri |

✔ Node A poate functiona pe O SINGURA A100 80GB in loc de 2× H200 NVL — reducere de cost posibila de €500-800/luna daca H200 NVL nu e disponibil pe Hetzner.

## **7.3 Diagrama Arhitecturala — Redis Comun v2.0**

┌──────────────────────────────────────────────────────────────────┐│          REDIS HA SENTINEL (DB 0-7 izolate)                      ││  DB0:Locks  DB3:Cerniq-Agent+Debounce  DB6:Neanelu  DB7:SEO     │└────────┬──────────────────────┬──────────────────────────────────┘         │                      │┌────────▼──────┐     ┌────────▼──────────────────────────┐│  NEANELU      │     │  CERNIQ (313 Workers \+ AI Agent)  ││  backend-api  │     │  debounce 120s → Qwen3-72B      │└───────┬───────┘     └────────────────┬──────────────────┘        │                              │┌───────▼──────────────────────────────▼─────────────────────────┐│                    SHARED LLM LAYER v2.0                         ││  \[Node A\] Qwen3-Emb-8B (8GB) \+ NuExtract-8B (16GB)              ││  \[Node A\] EuroLLM-22B (24.1GB Q8\_0) ← Romanian Polish Layer \[NOU\]      ││  \[Node B\] Qwen3-72B FP8 — PRIMARY pentru AMBELE apps (24/7)     ││  \[Node C\] DeepSeek V3 — Audit PIM \+ Cerniq Batch E1             ││  \[API\]    xAI Grok — FALLBACK ONLY (era primary in v1.0)        ││  \[API\]    Google/Meta/TikTok — SEO Intelligence Input            │└─────────────────────────────────────────────────────────────────┘

# **8\. PIPELINE SEO GOLDEN RECORDS — NEANELU \[NOU IN v2.0\]**

Golden Record \= produsul perfect din perspectiva SEO, GEO (Generative Engine Optimization) si calitate lingvistica romana. Acesta este rolul central al Neanelu Manager: transformarea produselor existente in Golden Records pentru clienti, motoare de cautare si AI-urile frontier.

## **8.1 Context: Revolutia SEO/GEO in 2026**

Lumea SEO s-a schimbat fundamental in 2025-2026. Nu mai este suficient SEO clasic. Trebuie optimizat simultan pentru 3 motoare:

* Google clasic (traditional SERP — inca dominant)

* Google AI Overviews (apar in 16-30% din cautari, mai ales high-intent) — necesita GEO

* ChatGPT / Perplexity / Claude (sessiunile AI au crescut 527% in H1 2025\) — necesita GEO

ℹ Brandurile cu date structurate curate si continut de calitate pentru produse sunt semnificativ mai susceptibile sa fie incluse in raspunsuri AI generate (Google AI Overviews, ChatGPT). Schema.org JSON-LD \+ FAQ \+ continut semantic dens \= pasaportul in AI search.

## **8.2 Pipeline in 3 Straturi pentru Generare Descrieri SEO Neanelu**

\[NuExtract 2.0 8B\] — STRATUL 1: EXTRACTIE  → extrage date brute din HTML sursa  → output: JSON {title, brand, specs\[\], price, category, gtin}          ↓\[SEO Intelligence Worker — Redis DB7\]  → inject: {top\_keywords\[\], faq\_questions\[\], buyer\_tone, competitor\_gaps\[\]}          ↓\[Qwen3-72B\] — STRATUL 2: CREATIVITATE SI SEO  → genereaza: titlu SEO optimizat H1 cu keyword principal  → genereaza: meta description 155 caractere  → genereaza: paragraf beneficii (emotional, nu tehnic)  → genereaza: specificatii tehnice (structurate pentru GEO parsing)  → genereaza: sectiune FAQ cu 3-5 intrebari reale din GSC  → genereaza: Schema.org JSON-LD (Product, Offer, AggregateRating)  → genereaza: variante social (Instagram caption, TikTok hook)          ↓\[EuroLLM-22B\] — STRATUL 3: CALITATE LINGVISTICA ROMANA  → verifica si corecteaza gramatica romana  → adauga diacritice lipsa, fluentizeaza expresii  → NU modifica informatii tehnice, preturi, specs          ↓\[Shopify/Platforma\] → publicare automata

✔ SEPARAREA ROLURILOR: Qwen3-72B (capacitate creativa \+ SEO) → EuroLLM-22B (garanteaza calitate lingvistica romana). Qwen3-72B ESTE deja activ pe Node B pentru extractie — se foloseste OFF-PEAK (noapte/weekend) pentru generare descrieri la zero cost aditional.

## **8.3 Elementele Obligatorii ale unui Golden Record (SEO \+ GEO)**

| Element | Tip | Import SEO | Import GEO (AI Search) | Generare |
| :---- | :---- | :---- | :---- | :---- |
| Titlu H1 optimizat \+ keyword | On-page SEO | **CRITIC** | **INALT** | Qwen3-72B |
| Meta description 155 chars cu keyword | On-page SEO | **INALT** | Mediu | Qwen3-72B |
| Schema.org JSON-LD Product \+ Offer | Structured data | **CRITIC** | **CRITIC** | Qwen3-72B |
| Sectiune FAQ (3-5 intrebari din GSC) | Content \+ GEO | **INALT** | **CRITIC** | Qwen3-72B |
| Paragraf beneficii (semantic dens) | Content | Mediu | **INALT** | Qwen3-72B |
| Specificatii tehnice structurate | Content | **INALT** | **INALT** | NuExtract → Qwen3-72B |
| Polish gramatica \+ diacritice romana | Calitate lingvistica | Mediu | Mediu | EuroLLM-22B |
| Embedding semantic pentru search intern | Vector search | **CRITIC (intern)** | N/A | Qwen3-Emb-8B |

⚠ AVERTISMENT CRITIC SEO: LLM-urile nu stiu ce keywords rankeza ACUM pe Google.ro / eMAG pentru categoriile tale. SEO Intelligence Worker trebuie sa injecteze keywords reale din Google Search Console API \+ SEMrush/Ahrefs in promptul pentru Qwen3-72B. Altfel modelul va genera descrieri cu keywords irelevante sau inexistente.

# **9\. STRATEGIE SEO/GEO COMPLETA — NEANELU \[NOU IN v2.0\]**

Aceasta este cea mai valoroasa oportunitate strategica pentru Neanelu: 880.000 de produse cu Golden Records SEO/GEO complet reprezinta o masa critica de continut structurat pe care nicio competitie locala nu o are. Fiecare produs devine un landing page independent care atrage trafic organic si este citat de AI-urile frontier.

## **9.1 Arhitectura in 5 Straturi**

| Strat | Componenta | Sursa Date | Output |
| :---- | :---- | :---- | :---- |
| **1 — Data Intelligence** | Colectare semnale din toate platformele | Google Search Console API, Google Data Manager API, Meta Ads API, TikTok Business API, GA4 API | Raw signals → Redis DB7 |
| **2 — Signal Processing** | SEO Intelligence Worker | Qwen3-72B batch (noapte) | Keyword clusters, intent signals, content gaps, trending queries |
| **3 — Content Generation** | Pipeline 3-straturi (Sectiunea 8\) | NuExtract → Qwen3-72B → EuroLLM-22B | Golden Record \= descriere SEO/GEO ready |
| **4 — GEO Optimization** | Schema.org, FAQ, structured data | Qwen3-72B \+ template-uri | Vizibilitate in Google AI Overviews \+ ChatGPT citations |
| **5 — Feedback Loop** | Performance monitoring \+ regenerare | Vanzari reale, GSC impressions vs CTR, AI citations tracking | Regenerare automata saptamanala a descrierilor underperforming |

## **9.2 Integrari API — Date Despre Clienti si Trafic**

**ATENTIE: Toate integrarile de date de audienta trebuie sa respecte GDPR si Consent Mode v2 activ pe site pentru piata romaneasca.**

| API / Platforma | Ce Importam | Utilizare in Neanelu | Prioritate |
| :---- | :---- | :---- | :---- |
| **Google Search Console API** | Query-uri exacte cu care utilizatorii gasesc produsele, CTR per produs, impresii vs click-uri, pozitie medie | Top keywords per categorie, identificare pagini unde AI Overviews fura traficul (impresii ↑ CTR ↓) | **IMEDIAT — cost zero, date disponibile imediat** |
| **Google Analytics 4 API** | Comportament pe site al cumparatorilor, pagini cu conversie, sesiuni per produs, timp pe pagina | Identificare produse cu trafic dar fara conversie → descrieri slabe → candidati pentru regenerare | **IMEDIAT** |
| **Google Data Manager API \[NOU dec 2025\]** | Date first-party centralizate: audience lists, offline conversions, CRM data | Semnale de calitate audienta pentru optimizare continut. Conexiune directa Google Ads \+ GA4 \+ DV360 | **Luna 1** |
| **Meta Conversions API** | Demografice ale cumparatorilor (varsta, locatie, interese), produse cu engagement organic, termeni cautare Facebook Shop | Ton si vocabular al audientei, categorii populare pe social | **Luna 1 (GDPR required)** |
| **TikTok Business API** | Hashtag-uri asociate produselor, continut UGC, search trends TikTok Shop (diferite fata de Google) | Keywords TikTok-native pentru variante social ale descrierilor, audiente tinere Z/Millennial | **Luna 2** |
| **Instagram Graph API** | Engagement per tip de continut produs, hashtag-uri organice, mentions | Optimizare format descrieri pentru Instagram Shopping | **Luna 2** |

## **9.3 SEO Intelligence Worker — Implementare Tehnica**

Worker dedicat in Neanelu, rulat in batch noapte (22:00-06:00) pe Node B (Qwen3-72B):

\[Google Search Console API\]  →\[Google Analytics 4 API\]     →  \[SEO Intelligence Worker\]  →  \[Redis DB7\]\[Meta Ads API\]               →  (Qwen3-72B batch, noapte)       ↓\[TikTok Business API\]        →                            \[Keyword Clusters\]\[GA4 Audience Segments\]      →                            \[Intent Signals\]                                                          \[Content Gaps\]                                                          \[Trending Queries\]                                                               ↓                                              \[Pipeline 3-straturi SEO\]                                              (NuExtract → Qwen3-72B → EuroLLM-22B)

Ce produce Qwen3-72B din aceste date pentru fiecare categorie de produse:

* Top 10 keywords cu intentie de cumparare pentru categoria respectiva (Google.ro specific)

* Intrebarile frecvente ale cumparatorilor (pentru sectiunea FAQ pe pagina de produs)

* Tonul si vocabularul pe care audienta il foloseste efectiv (din GSC query data)

* Produsele concurentilor care rankeza pe aceleasi query-uri

* Gap-uri de continut: ce intreaba utilizatorii dar nu exista pe paginile actuale

## **9.4 Feedback Loop — Regenerare Automata**

| Trigger | Conditie | Actiune Automata |
| :---- | :---- | :---- |
| CTR scade desi impresii cresc | Scadere CTR \>20% in 2 saptamani consecutiv | Regenerare titlu H1 \+ meta description cu keywords refreshed |
| Pagina de produs nu apare in AI Overviews | Zero citations in 4 saptamani (monitorizat) | Adaugare/imbunatatire schema JSON-LD \+ FAQ section |
| Vanzare \= 0 desi trafic exista | 0 conversii pe \>100 sesiuni | Regenerare paragraf beneficii \+ CTA \+ restructurare descriere |
| Keyword nou trending in GSC | Query nou in top 50 cu \>100 impresii/saptamana | Update titlu \+ FAQ cu noul keyword tintit |

✔ Obiectiv strategic: scaderea dependentei de PPC si Ads prin cresterea traficului organic. Un produs cu Golden Record SEO/GEO genereaza trafic organic gratuit pe toata durata sa de viata. La 880K produse, efectul compus este semnificativ.

# **10\. MAPARE COMPLETA TASK → MODEL v2.0**

| Task | Aplicatie | Model v2.0 | Node | Cost/Request |
| :---- | :---- | :---- | :---- | :---- |
| Embedding produse (semantic search) | Neanelu | Qwen3-Embedding-8B (2000 dims) | Node A | \~€0 (self-hosted) |
| Extractie HTML→JSON produs (simplu) | Neanelu | NuExtract 2.0 8B | Node A | \~€0 (self-hosted) |
| Extractie HTML→JSON produs (complex, confidence\<0.75) | Neanelu | Qwen3-72B FP8 | Node B | \~€0 (self-hosted) |
| Generare descriere SEO creativa (Stratul 2\) | Neanelu | Qwen3-72B (off-peak) | Node B | \~€0 (self-hosted) |
| **Polish lingvistic roman descrieri \[NOU\]** | Neanelu | EuroLLM-22B | Node A | \~€0 (self-hosted) |
| Quality Audit / Consensus PIM | Neanelu | DeepSeek V3 Q4 | Node C | \~€0 (self-hosted) |
| **SEO Intelligence Worker \[NOU\]** | Neanelu | Qwen3-72B (batch noapte) | Node B | \~€0 (self-hosted) |
| Embedding produse RAG (1536 dims) | Cerniq E3 | Qwen3-Embedding-8B (MRL) | Node A | \~€0 (self-hosted) |
| Structurare date companii RO (batch 2.86M) | Cerniq E1 | Qwen3-72B FP8 (batch, offline) | Node B/C | \~€0 (self-hosted) |
| **Negociere vanzari AI (debounce 120s) \[SCHIMBAT\]** | Cerniq E3 | Qwen3-72B self-hosted | Node B | \~€0 (era xAI API) |
| **Polish roman raspunsuri WhatsApp/email \[NOU\]** | Cerniq E2-E3 | EuroLLM-22B | Node A | \~€0 (self-hosted) |
| Generare mesaje outreach personalizate | Cerniq E2 | Qwen3-72B → EuroLLM-22B pipeline | Node A+B | \~€0 |
| Sentiment routing client | Cerniq E3 | Qwen3-72B self-hosted | Node B | \~€0 |
| Churn detection / clustering (weekly) | Cerniq E5 | Qwen3-72B sau DeepSeek V3 batch | Node B/C off-peak | \~€0 |
| Fallback orice task critic | Ambele | xAI Grok (API) → GPT-4o → Claude Sonnet | Cloud API | Per request |

# **11\. ESTIMARE COSTURI REALISTE v2.0**

✔ Principiu de calcul: Eliminarea xAI API (€600-900/luna) compenseaza aproape complet costul crescut al Node B always-on (vs 16/7). EuroLLM-22B este 100% cost-neutral — incape pe Node A existent.

## **11.1 Costuri Lunare Estimate (Post-Deploy Full v2.0)**

| Componenta | Detalii v2.0 | Cost Lunar |
| :---- | :---- | :---- |
| **Node A (Always-On, neschimbat)** | Qwen3-Emb-8B (8GB) \+ NuExtract-8B (16GB) \+ EuroLLM-22B (24.1GB Q8\_0) \= 48.1GB | 1× A100 80GB sau 2× H200 NVL | €2,200-2,600 |
| **Node B (Always-On 24/7) \[SCHIMBAT\]** | Qwen3-72B FP8 (282GB) — ALL Cerniq workers \+ extractie Neanelu \+ SEO generation off-peak | 2× H200 NVL sau 4× A100 | €2,600-3,200 |
| **Node C (On-Demand) \[CORECTAT\]** | DeepSeek V3 GGUF Q4 (\~350GB) — Audit PIM \+ Cerniq batch Etapa 1 | MIN 5× A100 80GB (400GB) SAU Q3\_K\_M pe 4× A100 (290GB) | 4-6h/zi × 22 zile. NOTA: A100 nu are suport FP8 hardware nativ. | €500-750 |
| **xAI API \[SCHIMBAT — FALLBACK ONLY\]** | Estimat \<5% din trafic Cerniq (urgente, downtime Node B) | €80-150 (era €600-900) |
| **OpenAI fallback** | \~2% din trafic Cerniq | €40-80 |
| **API-uri SEO \[NOU\]** | Google Search Console API (gratuit), GA4 API (gratuit), Meta Ads API (gratuit cu cont activ), TikTok Business API (gratuit) | €0-50 (aditional) |
| **Redis HA (3 nodes)** | 3× Hetzner CX31 sau similar | €120-180 |
| **Network \+ Storage** | S3 artifacts, Postgres storage, backup | €150-250 |
| **TOTAL** | Infrastructura completa ambele aplicatii self-hosted | **€5,590-7,110/luna** |

| Scenariu | Cost Lunar Estimat | Observatie |
| :---- | :---- | :---- |
| Full API (fara self-hosted) | €15,000-35,000 | Volum Neanelu 880K produse × \~1K tokens → 880M tokens/luna |
| Self-hosted mixt v1.0 | €4,950-6,480 | Cu xAI API primary, Node B 16/7 |
| **Self-hosted mixt v2.0 (recomandat)** | **€5,590-7,110** | Node B 24/7, xAI fallback only, EuroLLM-22B adaugat |
| Diferenta v1.0 → v2.0 | \+€600-630/luna | Justificat de: calitate romana, eliminare xAI risc, SEO pipeline activ |

# **12\. PLAN DE IMPLEMENTARE SI VALIDARE v2.0**

## **12.1 Faza 0 — PoC (7-10 Zile) — 4 Teste Obligatorii**

⚠ TOATE CELE 4 TESTE SUNT OBLIGATORII inainte de orice deployament in productie. Testele 1 si 2 sunt NOI in v2.0 si au STOP CRITERION clar.

**TEST 1 (NOU) — Calitate Conversationala Romana Cerniq:**

| Parametru | Detaliu |
| :---- | :---- |
| Obiectiv | Valideaza daca Qwen3-72B este suficient pentru dialog B2B agricol in romana sau daca trebuie Mistral Large 3 |
| Dataset | 20-30 conversatii reale de negociere agricola (WhatsApp/email) de la clienti actuali |
| Metodologie | Qwen3-72B (cu si fara EuroLLM-22B polish) vs Mistral Large 3 (API) pe aceleasi inputuri |
| Evaluare | Naturalete, terminologie agricola, coerenta multi-turn, gramatica (blind evaluation de 3 evaluatori umani) |
| Stop criterion | Daca Qwen3-72B \<80% acceptabilitate → hardware upgrade pentru Mistral Large 3 |

**TEST 2 (NOU) — Calitate Polish EuroLLM-22B:**

| Parametru | Detaliu |
| :---- | :---- |
| Obiectiv | Valideaza ca EuroLLM-22B reformuleaza natural romana fara sa adauge sau sa stearga informatii |
| Dataset | 100 inputuri JSON structurate → output text roman natural |
| Criteriu de succes | Zero hallucination (nicio informatie adaugata/stearsa), gramatica/diacritice accuracy \>95% vs review uman |
| Test critic | 10 inputuri cu preturi si cantitati precise — EuroLLM NU trebuie sa le modifice sub nicio forma |

**TEST 3 (NOU) — Pipeline 3-Straturi Descrieri Produse Neanelu:**

| Parametru | Detaliu |
| :---- | :---- |
| Obiectiv | Valideaza pipeline-ul complet NuExtract → Qwen3-72B → EuroLLM-22B pe produse reale |
| Dataset | 50 produse din categorii diverse (seminte, ingrasaminte, pesticide, echipamente) |
| Evaluare | Integrare keyword SEO, calitate romana, acuratete factuala, comparare vs descrieri actuale |
| Stop criterion | Daca pipeline-ul este mai lent de 120s/produs (batch) → optimizare throughput sau reducere straturi |

**TESTE 4 (din v1.0, mentinute):**

| Test | Dataset | Criteriu de Succes | Responsabil |
| :---- | :---- | :---- | :---- |
| Qwen3-Emb-8B Romanian quality | 1000 produse Neanelu existente | Cosine similarity \>0.85 cu grupuri corecte | Dev Backend |
| NuExtract 2.0 8B pe HTML real | 100 HTML reale 30-50KB | F-Score \>0.80 vs xAI actual | Dev Backend |
| Qwen3-72B extractie GTIN | 100 produse cu GTIN cunoscut | GTIN accuracy \>= 95% | Dev Backend |
| Redis DB isolation | Cerniq DB3 vs Neanelu DB6+DB7 | Zero interferente intre chei | Dev Infra |
| BullMQ debounce 120s | 50 simulari de conversatii WA reale | Agregare corecta, no duplicate responses | Dev Backend |

## **12.2 Faza 1 — Neanelu Deployment (2-3 Saptamani)**

| Sprint | Task | Risc |
| :---- | :---- | :---- |
| S1.1 | Deploy Qwen3-Embedding-8B via TEI pe Node A — test endpoint /v1/embeddings | Scazut |
| S1.2 | Update .env Neanelu: OPENAI\_BASE\_URL \+ OPENAI\_EMBEDDINGS\_MODEL — validare dimensiuni 2000 | Scazut |
| S1.3 | Regenerare embeddings existente (880K produse × 3 tipuri \= \~2.6M embeddings) | Mediu (24-48h process) |
| S1.4 | Deploy NuExtract 2.0 8B pe Node A — integrare cu xai-extractor.ts | Mediu |
| S1.5 | Deploy Qwen3-72B pe Node B (24/7) — configurare quality gate \+ SEO generation | Mediu |
| S1.6 | Deploy EuroLLM-22B pe Node A — integrare ca polish layer in pipeline | Scazut |
| S1.7 | Deploy DeepSeek V3 pe Node C — update ai-auditor-service.ts | Scazut |
| S1.8 | Conectare Google Search Console API \+ GA4 API → SEO Intelligence Worker | Scazut |
| S1.9 | A/B test descrieri: pipeline nou vs descrieri actuale pe 1000 produse live | Scazut |

## **12.3 Faza 2 — Cerniq Integration (1-2 Saptamani)**

| Sprint | Task | Risc |
| :---- | :---- | :---- |
| S2.1 | Update ADR-0069: xAI Grok API → Qwen3-72B self-hosted PRIMARY, xAI → fallback | Scazut |
| S2.2 | Update ADR-0085: text-embedding-3-small → Qwen3-Embedding-8B (MRL 1536 dims) | Scazut |
| S2.3 | Implementare BullMQ debounce 120s pentru WhatsApp/email workers Cerniq E2-E3 | Mediu |
| S2.4 | Integrare EuroLLM-22B ca polish layer pentru raspunsuri externe Cerniq | Scazut |
| S2.5 | Migrare schema DB: vector(1536) → vector(2000) in gold\_product\_embeddings | Mediu |
| S2.6 | Test Cerniq E1 batch: Qwen3-72B Node B/C pentru structurare 2.86M companii RO | Mediu |
| S2.7 | Validare fallback chain: Node B down → xAI → GPT-4o → Claude Sonnet | Scazut |

## **12.4 Faza 3 — SEO/GEO Full Deploy (Luna 2-3)**

| Sprint | Task | Risc |
| :---- | :---- | :---- |
| S3.1 | Conectare Meta Conversions API \+ TikTok Business API (GDPR Consent Mode v2 obligatoriu) | Mediu (legal) |
| S3.2 | SEO Intelligence Worker complet — procesare nocturn pentru top 1000 categorii | Mediu |
| S3.3 | Pipeline 3-straturi activ pentru primele 10.000 produse prioritare (top trafic) | Scazut |
| S3.4 | Implementare Schema.org JSON-LD automat pe paginile de produs | Scazut |
| S3.5 | Monitoring: GSC impressions vs CTR per produs — identificare underperforming | Scazut |
| S3.6 | Feedback loop automat — regenerare saptamanala a descrierilor cu CTR scazut | Mediu |
| S3.7 | Rollout complet: pipeline SEO pe toate cele 880K produse (batch lunar) | Mediu |

# **13\. DECIZII CHEIE SI RISCURI v2.0**

## **13.1 Ce Ramane din Versiunea 1.0**

✔ Qwen3-Embedding-8B — alegere excelenta, SOTA multilingual, MRL rezolva conflictul de dimensiuni

✔ Arhitectura 3 noduri (always-on / on-demand / API fallback) — structura corecta, Node B acum 24/7

✔ Faza 0 PoC obligatorie inainte de productie — extinsa la 4 teste in v2.0

✔ DeepSeek V3 pentru audit — confirmat, cost-eficient, MIT license

✔ NuExtract 2.0 8B ca workhorse \+ Qwen3-72B quality gate — dual-layer extraction pastrat

## **13.2 Ce Se Schimba fata de Versiunea 1.0**

✖ xAI Grok API eliminat din primar pentru Cerniq Agent → Qwen3-72B self-hosted PRIMARY. Motivul: debounce 120s elimina cerinta de latenta realtime care justifica API.

✖ Node B devine ALWAYS-ON (24/7) in loc de 16/7. Justificare: workeri Cerniq activi 24/7.

★ DECIZIE: EuroLLM-22B adaugat pe Node A ca layer de polish lingvistic roman — zero cost hardware aditional (48.1GB total pe A100 80GB).

★ DECIZIE: Pipeline SEO in 3 straturi (nou): NuExtract → Qwen3-72B (creative) → EuroLLM-22B (polish) — core al strategiei Golden Records.

★ DECIZIE: Strategie SEO/GEO completa adaugata: integrari API Google/Meta/TikTok, SEO Intelligence Worker, feedback loop automat.

## **13.3 Riscuri Actualizate si Mitigari v2.0**

| Risc | Probabilitate | Impact | Mitigare |
| :---- | :---- | :---- | :---- |
| Qwen3-72B calitate conversationala insuficienta pentru dialog B2B agricol roman | Medie (40%) | Inalt | Test 1 PoC cu 20-30 sample-uri reale. Daca esueaza → hardware upgrade Mistral Large 3 (€5,200-6,400/luna) |
| EuroLLM-22B modifica (hallucineaza) informatii tehnice sau preturi | Mica (10%) | Critic | Test 2 PoC cu 10 inputuri cu preturi precise. JSON schema strict → hallucination imposibil structural |
| Node B downtime → Cerniq fara AI agent | Mica (15%) | Inalt | Fallback chain: xAI Grok API (warm, cont activ) → GPT-4o → Claude Sonnet. Recovery \<60s |
| NuExtract 2.0 8B \<80% F-Score pe HTML real Neanelu | Medie (40%) | Inalt | Stop criterion Faza 0 — switch la Qwen3-72B ca workhorse unic. Pierdere viteza, nu precizie |
| API-uri SEO rate limiting / costuri neasteptate | Mica (20%) | Scazut | GSC \+ GA4 gratuite. Meta \+ TikTok gratuite cu cont activ. SEMrush/Ahrefs optional la €100-200/luna |
| Hetzner GPU availability (H200 NVL) | Medie (30%) | Mediu | Alternativa: 4× A100 80GB pentru Node B (Qwen3-72B \~20GB per GPU shard). Lambda Labs, Vast.ai |
| Pipeline SEO prea lent pentru 880K produse | Medie (35%) | Scazut | Off-peak batch processing. Target: 1000 produse/noapte \= 880 zile. Sau prioritizare top 10K produse |
| GDPR violation pentru integrari Meta/TikTok audience data | Scazuta daca implementat corect | CRITIC | Consent Mode v2 activ OBLIGATORIU. Doar date agregate, nu individual. Consultare juridica inainte de faza 3 |

## **13.4 Licente — Verificare Finala v2.0**

| Model | Licenta | Comercial OK? | Restrictii |
| :---- | :---- | :---- | :---- |
| Qwen3-Embedding-8B | Apache 2.0 | **DA** | Niciuna |
| Qwen3-72B | Apache 2.0 | **DA** | Niciuna |
| NuExtract 2.0 8B | MIT | **DA** | Niciuna |
| DeepSeek V3 | MIT | **DA** | Niciuna |
| **EuroLLM-22B \[NOU\]** | Apache 2.0 | **DA** | Niciuna — comercial complet OK |
| xAI Grok (API) | Proprietar | **DA** | Fair use policy, nu redistribuie model |
| Mistral Large 3 (daca adoptat) | Apache 2.0 | **DA** | Niciuna |

# **14\. CHECKLIST IMPLEMENTARE — ACTIUNI IMEDIATE**

**Aceasta lista de actiuni poate fi executata in 48 de ore pentru a valida fezabilitatea inainte de angajamentul full de infrastructura:**

| \# | Actiune | Urgenta | Ore Estimate |
| :---- | :---- | :---- | :---- |
| 1 | Pornire instanta A100 80GB pe Hetzner GPU Cloud (1 GPU, 1 luna trial) | **ACUM** | 2h |
| 2 | Deploy TEI cu Qwen3-Embedding-8B Q8 — test /v1/embeddings cu 100 texte produse Neanelu | **ACUM** | 4h |
| 3 | Deploy EuroLLM-22B Q8 pe acelasi GPU — test reformulare romana pe 50 inputuri JSON | **ACUM** | 3h |
| 4 | Deploy NuExtract 2.0 8B — test F-Score pe 100 HTML reale Neanelu vs xAI Grok actual | Zi 1 | 8h |
| 5 | TEST 1 (NOU): Qwen3-72B vs Mistral Large 3 pe 20-30 dialoguri reale B2B agricol roman | Zi 1-2 | 16h |
| 6 | TEST 2 (NOU): EuroLLM-22B hallucination test pe 100 inputuri cu preturi precise | Zi 2 | 4h |
| 7 | TEST 3 (NOU): Pipeline complet NuExtract → Qwen3-72B → EuroLLM-22B pe 50 produse reale | Zi 2-3 | 8h |
| 8 | Benchmark throughput real: timp pentru 1000 HTML requests pe A100 | Zi 2 | 4h |
| 9 | Test BullMQ debounce 120s: 50 simulari conversatii WhatsApp cu mesaje consecutive | Zi 3 | 4h |
| 10 | Conectare Google Search Console API (gratuit) — test export primele 1000 query-uri | Zi 3 | 2h |
| 11 | Decizie finala bazata pe rezultate PoC: go/no-go pe suita propusa \+ decizie Qwen3 vs Mistral | Zi 4 | 4h |
| 12 | Planning Faza 1 daca PoC verde: Sprint S1.1-S1.9 cu timeline si responsabili | Zi 4-5 | 4h |

# **CONCLUZIE v2.0**

Versiunea 2.0 a auditului consolideaza toate deciziile luate pe parcursul conversatiei intr-un document unic complet. Evolutia de la v1.0 la v2.0 este determinata de doua descoperiri cheie:

**1\. Pattern-ul de debounce 120s pentru WhatsApp/email Cerniq — care elimina cerinta de latenta realtime si deschide calea pentru self-hosting complet al agentului de vanzari.**

**2\. Rolul strategic al Golden Records SEO/GEO pentru Neanelu — care transforma PIM-ul dintr-un simplu catalog de produse intr-un motor de trafic organic, reducand dependenta de PPC/Ads.**

| Model | Task | Verdict v2.0 |
| :---- | :---- | :---- |
| **Qwen3-Embedding-8B** | Embeddings AMBELE aplicatii (MRL: 2000 dims Neanelu, 1536/2000 Cerniq) | **ADOPTAT** |
| **NuExtract 2.0 8B** | Extractie rapida PIM (Neanelu workhorse, 80% produse) | **ADOPTAT** |
| **Qwen3-72B FP8** | Quality gate extractie \+ Cerniq AGENT PRIMARY \+ Generare SEO creativa Neanelu | **ADOPTAT — ROL EXTINS** |
| **EuroLLM-22B \[NOU\]** | Polish lingvistic roman pentru AMBELE apps — Cerniq WhatsApp \+ Neanelu descrieri | **ADOPTAT NOU** |
| **DeepSeek V3** | Audit PIM \+ consensus (Neanelu on-demand) | **ADOPTAT** |
| **xAI Grok (API)** | Fallback de urgenta Cerniq Agent (era PRIMARY in v1.0) | **RETROGRADAT — FALLBACK** |
| **Mistral Large 3** | Contingenta PoC: daca Qwen3-72B esueaza pe romana B2B | **CONDITIONAT DE POC** |
| **Kimi K2.5** | Eliminat — VRAM overkill (623GB Q4), cost dublu fata de DeepSeek V3 | **ELIMINAT** |
| **GLM-5 (self-hosted)** | Eliminat — necesita cluster masiv, nu fezabil in config propusa | **ELIMINAT (API: optional)** |

ℹ PRIORITATEA \#1 RAMANE: Acuratetea datelor. Nicio decizie de cost sau simplitate nu justifica sacrificarea preciziei de extractie sau calitatii lingvistice in romana. Faza 0 PoC este obligatorie si non-negociabila inainte de orice deployment in productie.

Document actualizat: Versiunea 3.1  |  Februarie 2026  |  Claude Sonnet 4.6  |  Confidential