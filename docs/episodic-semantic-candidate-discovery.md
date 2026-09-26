# Episodic semantic candidate discovery — system delta report

Classification: **BGE_SELECTED_PREMERGE_GATES_GREEN**

This PR closes the proven semantic-paraphrase candidate-recall gap by adding a
bounded BGE-M3 semantic lane to existing Retrieval V2 candidate discovery and
optional semantic evidence to the existing final scorer.

Live benchmark on head `98c008a8793338ec1abceaba1190700ced13aa20` selected
**BGE-M3** as the initial production semantic model. The BGE config is
`APPROVED`. Production retrieval remains unreachable until
`EPISODIC_SEMANTIC_DISCOVERY_ENABLED` and `EPISODIC_SEMANTIC_MODEL=bge_m3` are
explicitly set — approval alone does not activate the path. Railway env change
and merge remain separate GPT-owned follow-ups.

## Before

Lexical-only candidate discovery missed the paraphrase known-gap fact.

The benchmark case `semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01` proves:

- the canonical episodic fact exists in `episodic_memory_facts`;
- it is old, normal, and non-historical;
- the recent lane misses it;
- token-LIKE relevance misses the paraphrase;
- milestone lanes are inapplicable;
- candidate discovery misses it;
- final retrieval misses it.

Baseline: candidate recall 16/17, final recall 16/17.

## Problem

The correct fact never entered the candidate set before the final scorer.
A candidate-only Jev reranker cannot fix a fact it never sees.

## After

A BGE semantic lane adds bounded candidate-discovery evidence to existing
Retrieval V2. The existing single final scorer may use optional semantic
similarity evidence. No parallel memory truth, temporal owner, prompt owner,
or final ranking owner was added.

## Removed

No obsolete workaround was deleted in this activation-prep pass. The earlier
pre-claiming of lexical slots (which caused a milestone regression) was already
replaced by unused-capacity-only novel admission during foundation work.

## Preserved

- lexical lanes and budgets
- temporal truth
- Persona Secret
- adult / NSFW privacy fail-closed
- provider / semantic failure → lexical Retrieval V2 fallback
- final scorer owner
- Jev Decisions (untouched)

## Live benchmark (VALID model-selection run)

Head: `98c008a8793338ec1abceaba1190700ced13aa20`  
Flags: `REGULAR_TEST_REAL_PROVIDER_CALLS=1` + `REAL_EPISODIC_EMBEDDING_PROBE=1`  
Credential: `OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY` only (production
`OPENROUTER_API_KEY` unset in the process)

| Arm | Model | Result |
|---|---|---|
| A | `baai/bge-m3` @1024 | **SELECTED** — candidate/final recall 1.0/1.0; known-gap hit/hit; false injection 0; stale state 0; failures 0; query RTT p50/p95/max 231/370.6/489.4 ms; batch RTT p50/p95/max 283.2/858.1/1361.2 ms; cost $0.00001633 / 50 calls; observed response models `BAAI/bge-m3`, `parasail-bge-m3` |
| B | `qwen/qwen3-embedding-8b` @4096 | **NOT SELECTED** — recall stayed at lexical baseline 0.941/0.941; known-gap miss/miss; 2 query timeouts; query p95 ≈ 2.5s |
| C | `openai/text-embedding-3-small` @1536 | **NOT SELECTED** (benchmark control) — recall stayed at lexical baseline 0.941/0.941; known-gap miss/miss |

Selected BGE production config (do not retune in this PR):

- `modelId = baai/bge-m3`
- `dimensions = 1024`
- `configVersion = bge-m3@1024/approved-1`
- `status = APPROVED`
- `similarityPassThreshold = 0.5`
- `semanticScoreWeight = 4`
- `semanticLaneMaxShare = 0.1`

Qwen remains `PROVISIONAL_LIVE_BENCHMARK_PENDING` (flag ON still disables).
OpenAI text-embedding-3-small remains outside the runtime candidate registry.

### Invalid prior run — do not use

The earlier **141-call** run on `7a7e4cfe` is an **INVALID MODEL-SELECTION RUN**.
Every call was rejected by served-model string validation before any semantic
vector entered the path (lexical-only metrics). It must never be used as
selection evidence.

## Owner map

| Responsibility | Canonical owner | Semantic delta |
|---|---|---|
| Canonical episodic facts | `episodic_memory_facts` | none |
| Candidate scope / reset-fork boundary / RAW age | `buildEpisodicCandidateScope` | reused |
| Retrieval safety | `evaluateEpisodicRetrievalGuard` | reused |
| Lane budgets | `resolveEpisodicLaneBudgets` | unchanged |
| Candidate fetch / merge | `fetchEpisodicMemoryCandidateRows` | semantic lane after lexical lanes |
| Temporal reconciliation | existing latest-state / historical owners | unchanged |
| Dedupe | existing episodic dedupe owner | unchanged |
| Final relevance / ranking | `scoreFactForPrompt` | optional semantic evidence |
| Final fact / char budget | `getEpisodicMemoryForPrompt` | unchanged |
| Regeneration / edit / delete / rewind | existing mutation owners | unchanged |
| Fork / reset boundary | memory source-boundary owners | unchanged |
| Post-turn lifecycle | `scheduleMemoryUpdate` | bounded index job after canonical commit |
| OpenRouter auth / headers | `openRouterConfig` | reused |
| Usage / cost ledger | existing provider ledger | reused |
| Benchmark cases | `memory-rp-benchmark-suite.ts` | single reusable case owner |
| Jev Decisions | `jevDecisions.ts` | untouched |
| Semantic config + activation gate | `memory-episodic-semantic-config.ts` | single config / runtime gate owner |
| Derived vector sidecar | `memory-episodic-semantic-index.ts` | disposable index owner |
| Embeddings HTTP | `openRouterEmbeddings.ts` | endpoint-specific transport |
| Text-to-vector orchestration | `memory-episodic-semantic-jobs.ts` | bounded job owner |
| Feature flag activation | `resolveEpisodicSemanticRuntime` | flag + known model + APPROVED only |

ONE RESPONSIBILITY = ONE CANONICAL OWNER. No new owners were added in this
activation-prep pass.

## Runtime activation gate

`resolveEpisodicSemanticRuntime` enables the BGE semantic path only when all of:

1. `EPISODIC_SEMANTIC_DISCOVERY_ENABLED` is truthy (`1` / `true` / `yes` / `on`)
2. `EPISODIC_SEMANTIC_MODEL=bge_m3`
3. BGE config `status === APPROVED`

Otherwise:

| Env | Result |
|---|---|
| flag OFF | `enabled: false`, `flag_off` |
| BGE + flag ON | `enabled: true`, BGE model |
| Qwen + flag ON | `enabled: false`, `config_provisional_live_benchmark_pending` |
| unknown model | `enabled: false`, `unknown_model` |

Railway env is **not** changed by this PR.

## Semantic sidecar

The derived table stores:

- canonical fact id;
- chat id;
- embedding model id;
- dimensions;
- full canonical-content hash;
- normalized Float32 vector bytes;
- timestamps.

It stores no fact text. `episodic_memory_facts` remains the only truth.

Dropping the sidecar leaves lexical Retrieval V2 behavior intact.

### Full canonical hash

Staleness is determined from the **full sanitized canonical `fact_text`**.

Only provider input is bounded to 400 characters.

Therefore two facts with identical first 400 characters but different suffixes
have different canonical hashes, and a late embedding write for the old text is
rejected.

## Privacy boundary

Provider-send eligibility reuses canonical owners instead of copying boundary logic.

Only facts that are all of the following may be selected for indexing:

- inside the current candidate scope, including reset/fork boundary;
- allowed by the existing retrieval guard;
- stamped `content_route = "safe"`;
- canonical and current.

Pre-boundary, adult/NSFW, unstamped legacy, and unrecallable facts are not sent
to the embeddings provider.

Invariant:

**OUT_OF_SCOPE_MEMORY_IS_NOT_SENT_TO_EMBEDDING_PROVIDER**

For initial rollout, adult/NSFW content is excluded from both sides:

- adult turns do not create query embeddings;
- adult-stamped facts are not indexed;
- a later safe turn cannot backfill adult facts.

Facts without a route stamp are fail-closed and not indexed.

## Query readiness

A safe query is embedded only when the current recall scope contains at least
one **usable** semantic vector for the active model.

Readiness requires:

- current recall scope;
- `content_route = "safe"`;
- retrieval guard allowed;
- full canonical content hash still matches;
- stored vector decodes successfully for the configured dimensions.

Adult, unstamped, stale-hash, corrupt, or otherwise unusable sidecar rows do not
trigger a query embedding call.

If no usable vector exists, the system returns lexical V2 with 0 embedding HTTP
and 0 embedding RTT.

## Candidate budget

The lexical V2 lane-budget function is unchanged.

Semantic discovery runs after lexical lanes.

- overlap IDs add semantic provenance but consume no candidate slot;
- only novel semantic IDs may be added;
- novel IDs use only unused capacity;
- total candidate limit remains 100;
- if the lexical unique set already fills 100, semantic novel IDs are dropped
  rather than replacing lexical candidates.

## Synthetic benchmark

| Mode | Candidate / final recall | False injection | Stale state | Known gap | Known-gap semantic admitted / novel / overlap / added | Milestone retention |
|---|---:|---:|---:|---|---|---:|
| Lexical baseline | 16/17 | 0 | 0 | miss / miss | — | 10/25 |
| Semantic share 0.05 | 17/17 | 0 | 0 | hit / hit | 1 / 1 / 0 / 1 | 10/25 |
| Semantic share 0.10 | 17/17 | 0 | 0 | hit / hit | 1 / 1 / 0 / 1 | 10/25 |
| Semantic share 0.20 | 17/17 | 0 | 0 | hit / hit | 1 / 1 / 0 / 1 | 10/25 |

In the known-gap fixture, 45 of 100 candidate slots remain unused, so no
donor/replacement policy is needed.

At full lexical capacity, the baseline lexical set is preserved and semantic
novel rows are dropped.

## Index lifecycle

1. Canonical episodic reconcile commits first.
2. The existing post-turn lifecycle runs the derived index job after commit and
   after the SSE response is completed.
3. The job prunes orphan vectors.
4. It selects at most 16 canonically eligible facts for one batch.
5. It embeds bounded provider inputs.
6. Each write re-reads the canonical row and rejects a deleted or changed fact.

No embedding HTTP runs inside a canonical write transaction.

The job is idempotent for the same fact/hash/model/dimensions.

### Sealed-batch writer audit

`extractAndPersistEpisodicFactsForSealedBatch` is currently test-only.

- no non-test runtime importer uses it;
- the live writer is the Shared Initial per-turn consumer;
- an existing regression pins that rolling-summary production does not call the
  legacy sealed-batch writer.

Verdict: **KEEP for now; deletion is a separate follow-up.**

Legacy rows without a route stamp remain excluded from semantic indexing.

## Disabled-feature schema behavior

Cleanup is cleanup-only.

If the semantic sidecar table does not exist, chat deletion and character
deletion no-op for semantic data and do not create the table.

When the table exists, both cleanup paths remove their derived rows.

## OpenRouter embeddings transport

`openRouterEmbeddings.ts` is the sole embeddings HTTP owner.

It reuses:

- OpenRouter auth/header primitives;
- usage parsing;
- provider cost ledger;
- auxiliary provider provenance.

Every request includes:

`provider: { zdr: true, data_collection: "deny" }`

ZDR prevents provider retention but does not mean the provider never receives
the text.

Malformed responses, wrong vector count, non-finite values, wrong dimensions,
served-model mismatch (case-insensitive exact or explicit
`responseModelAliases` only — no generic prefix stripping), transport failure,
and HTTP errors fail closed.

There is one attempt and no retry/fallback fan-out.

## Benchmark-only credential isolation

The live runner requires all three:

- `REGULAR_TEST_REAL_PROVIDER_CALLS=1`
- `REAL_EPISODIC_EMBEDDING_PROBE=1`
- `OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY`

The production `OPENROUTER_API_KEY` is never used by the live benchmark runner.

The benchmark key is passed explicitly to the transport, ledger persistence is
disabled, and without triple opt-in the runner returns `NOT_RUN` with 0 HTTP.

## Performance

In-process semantic scan remains synchronous on the chat retrieval path.

Measured synthetic retrieval p50, semantic off → on:

| Model | ~3,000 facts | 10,000 facts |
|---|---:|---:|
| bge-m3 / 1024 dims | 8.1 → 39.5 ms | 22.0 → 139.5 ms |
| qwen3-embedding-8b / 4096 dims | 8.1 → 85.6 ms | 22.1 → 290.5 ms |

Live BGE query RTT (valid benchmark): p50 231 ms / p95 370.6 ms / max 489.4 ms.

No ANN/vector DB or `vector_distance_cos` migration is part of this PR.

## Fallback

All semantic failures must preserve lexical V2 behavior:

- feature disabled;
- adult turn;
- no usable index;
- missing key;
- timeout / network error;
- 429 / 4xx / 5xx;
- malformed JSON;
- wrong vector count;
- non-finite vector;
- wrong dimensions;
- model mismatch;
- stale hash;
- corrupt bytes;
- malformed sidecar;
- partial batch failure.

None may fail Main RP.

## Regression risks (verified in this phase)

- known-gap miss without semantic (lexical baseline still misses)
- BGE semantic fixture recovers known-gap candidate + final hit
- false injection / stale state stay at 0 under synthetic path
- lexical budgets and milestone retention preserved
- Persona Secret / reset-fork / adult indexing+query zero / unstamped fail-closed
- stale-hash and corrupt vector reject
- provider failure → lexical fallback; Main RP not escalated
- no HTTP inside canonical DB write transaction
- disabled feature creates no schema side-effect

## SAFE OPTIONAL (not implemented)

- move Qwen provisional config into a benchmark-only registry
- further readiness-scan micro-optimizations

## SEPARATE FOLLOW-UP (not implemented)

- vector DB / ANN
- Jev reranking
- adult semantic embedding
- legacy unstamped fact route backfill
- additional embedding-model research
- Railway env activation
- merge to main

## Next gate

Exact-head CI green + GPT review → then separate Railway activation /
`EPISODIC_SEMANTIC_DISCOVERY_ENABLED=1` + `EPISODIC_SEMANTIC_MODEL=bge_m3` and
merge. This PR does not perform those steps.
