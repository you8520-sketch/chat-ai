# Episodic semantic candidate discovery — system delta report

Classification: **SEMANTIC_DISCOVERY_CODE_READY_LIVE_BENCHMARK_PENDING**

This PR closes the proven semantic-paraphrase gap in a deterministic synthetic path while keeping production on exact lexical Retrieval V2. Every runtime embedding configuration remains `PROVISIONAL_LIVE_BENCHMARK_PENDING`; the canonical runtime gate refuses to activate provisional configs.

No live provider call is part of this implementation pass.

## Before

The benchmark case `semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01` proves:

- the canonical episodic fact exists in `episodic_memory_facts`;
- it is old, normal, and non-historical;
- the recent lane misses it;
- token-LIKE relevance misses the paraphrase;
- milestone lanes are inapplicable;
- candidate discovery misses it;
- final retrieval misses it.

Baseline: candidate recall 16/17, final recall 16/17.

The final scorer also required lexical overlap for non-empty scene queries, so candidate discovery and final relevance both needed semantic evidence.

## Root cause

The missing fact is outside the lexical candidate set. A candidate-only Jev reranker cannot fix a fact it never sees.

The fix therefore extends the existing candidate-discovery owner and the existing single final scorer. It does not create a parallel memory truth, temporal owner, prompt owner, or final ranking owner.

## Owner map

| Responsibility | Canonical owner | Semantic delta |
|---|---|---|
| Canonical episodic facts | `episodic_memory_facts` | none |
| Candidate scope / reset-fork boundary / RAW age | `buildEpisodicCandidateScope` | reused |
| Retrieval safety | `evaluateEpisodicRetrievalGuard` | reused |
| Lane budgets | `resolveEpisodicLaneBudgets` | unchanged |
| Candidate fetch / merge | `fetchEpisodicMemoryCandidateRows` | semantic lane added after lexical lanes |
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
| Semantic config | `memory-episodic-semantic-config.ts` | new single config owner |
| Derived vector sidecar | `memory-episodic-semantic-index.ts` | new disposable index owner |
| Embeddings HTTP | `openRouterEmbeddings.ts` | new endpoint-specific transport |
| Text-to-vector orchestration | `memory-episodic-semantic-jobs.ts` | new bounded job owner |

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

Therefore two facts with identical first 400 characters but different suffixes have different canonical hashes, and a late embedding write for the old text is rejected.

## Privacy boundary

Provider-send eligibility reuses canonical owners instead of copying boundary logic.

Only facts that are all of the following may be selected for indexing:

- inside the current candidate scope, including reset/fork boundary;
- allowed by the existing retrieval guard;
- stamped `content_route = "safe"`;
- canonical and current.

Pre-boundary, adult/NSFW, unstamped legacy, and unrecallable facts are not sent to the embeddings provider.

Invariant:

**OUT_OF_SCOPE_MEMORY_IS_NOT_SENT_TO_EMBEDDING_PROVIDER**

For initial rollout, adult/NSFW content is excluded from both sides:

- adult turns do not create query embeddings;
- adult-stamped facts are not indexed;
- a later safe turn cannot backfill adult facts.

Facts without a route stamp are fail-closed and not indexed. This includes pre-change rows and mutation replacements whose source route is not yet reliably carried through the mutation path.

## Query readiness

A safe query is embedded only when the current recall scope contains at least one **usable** semantic vector for the active model.

Readiness requires:

- current recall scope;
- `content_route = "safe"`;
- retrieval guard allowed;
- full canonical content hash still matches;
- stored vector decodes successfully for the configured dimensions.

Adult, unstamped, stale-hash, corrupt, or otherwise unusable sidecar rows do not trigger a query embedding call.

If no usable vector exists, the system returns lexical V2 with 0 embedding HTTP and 0 embedding RTT.

## Candidate budget

The lexical V2 lane-budget function is unchanged.

Semantic discovery runs after lexical lanes.

- overlap IDs add semantic provenance but consume no candidate slot;
- only novel semantic IDs may be added;
- novel IDs use only unused capacity;
- total candidate limit remains 100;
- if the lexical unique set already fills 100, semantic novel IDs are dropped rather than replacing lexical candidates.

This removes the earlier milestone regression caused by pre-claiming lexical slots.

## Synthetic benchmark

| Mode | Candidate / final recall | False injection | Stale state | Known gap | Known-gap semantic admitted / novel / overlap / added | Milestone retention |
|---|---:|---:|---:|---|---|---:|
| Lexical baseline | 16/17 | 0 | 0 | miss / miss | — | 10/25 |
| Semantic share 0.05 | 17/17 | 0 | 0 | hit / hit | 1 / 1 / 0 / 1 | 10/25 |
| Semantic share 0.10 | 17/17 | 0 | 0 | hit / hit | 1 / 1 / 0 / 1 | 10/25 |
| Semantic share 0.20 | 17/17 | 0 | 0 | hit / hit | 1 / 1 / 0 / 1 | 10/25 |

In the known-gap fixture, 45 of 100 candidate slots remain unused, so no donor/replacement policy is needed.

At full lexical capacity, the baseline lexical set is preserved and semantic novel rows are dropped.

## Index lifecycle

1. Canonical episodic reconcile commits first.
2. The existing post-turn lifecycle runs the derived index job after commit and after the SSE response is completed.
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
- an existing regression pins that rolling-summary production does not call the legacy sealed-batch writer.

Verdict: **KEEP for now; deletion is a separate follow-up.**

Legacy rows without a route stamp remain excluded from semantic indexing.

## Disabled-feature schema behavior

Cleanup is cleanup-only.

If the semantic sidecar table does not exist, chat deletion and character deletion no-op for semantic data and do not create the table.

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

ZDR prevents provider retention but does not mean the provider never receives the text.

Malformed responses, wrong vector count, non-finite values, wrong dimensions, served-model mismatch, transport failure, and HTTP errors fail closed.

There is one attempt and no retry/fallback fan-out.

## Benchmark-only credential isolation

The live runner requires all three:

- `REGULAR_TEST_REAL_PROVIDER_CALLS=1`
- `REAL_EPISODIC_EMBEDDING_PROBE=1`
- `OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY`

The production `OPENROUTER_API_KEY` is never used by the live benchmark runner.

The benchmark key is passed explicitly to the transport, ledger persistence is disabled, and without triple opt-in the runner returns `NOT_RUN` with 0 HTTP.

Prepared arms:

- `baai/bge-m3`
- `qwen/qwen3-embedding-8b` at 4096 dimensions
- `openai/text-embedding-3-small` as a non-selectable control

No reduced-dimension Qwen arm is assumed until live/provider support is verified.

## Performance

In-process semantic scan remains synchronous on the chat retrieval path.

Measured synthetic retrieval p50, semantic off → on:

| Model | ~3,000 facts | 10,000 facts |
|---|---:|---:|
| bge-m3 / 1024 dims | 8.1 → 39.5 ms | 22.0 → 139.5 ms |
| qwen3-embedding-8b / 4096 dims | 8.1 → 85.6 ms | 22.1 → 290.5 ms |

The larger unknown remains live query-embedding RTT, which is not measured yet.

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

## Preserved invariants

Unchanged:

- lexical lane weights and budgets;
- temporal truth;
- canon/evidence guards;
- Relationship Memory;
- Persona Secret;
- Scene Directive;
- user authoring;
- Global / Medium / RAW memory;
- Main RP model routing;
- Jev Decisions;
- user billing / point charging.

## Remaining limitations

- Route-unstamped legacy rows do not receive semantic recall.
- Edited or variant-switched replacement facts without a reliable source-route stamp do not receive semantic recall.
- Live model quality, thresholds, provider RTT, and actual cost remain unmeasured.
- Semantic activation remains disabled until those are benchmarked and an approved config is explicitly selected.

For the initial rollout, fail-closed exclusion of route-unstamped facts is intentional and preferred over guessing privacy scope.

## Next gate

After exact-head review and current-main sync, the next allowed step is the benchmark-only live embedding probe.

Production activation, threshold approval, model selection, adult/NSFW inclusion, ANN/vector DB work, and Jev reranking remain separate follow-ups.
