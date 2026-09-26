# Episodic semantic candidate discovery — SYSTEM DELTA REPORT

Classification: **SEMANTIC_DISCOVERY_CODE_READY_LIVE_BENCHMARK_PENDING**

The candidate-discovery gap is closed **in the code path** and proven with a
deterministic synthetic embedder. It is **not** closed in production: every
embedding config is `PROVISIONAL_LIVE_BENCHMARK_PENDING`, and the single
runtime gate refuses to activate a provisional config even when the flag is
on. So production retrieval is still exact lexical Retrieval V2. This is not
ROOT_CAUSE_FIXED: thresholds, weights, and the model choice need a live
benchmark (STOP condition 14).

## BEFORE

`semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01` reproduces on exact main
`96bb9b03`. The canonical fact exists in the DB; it is old, normal, and
non-historical, so it drops out of the saturated recent lane, has no token
match in the lexical `LIKE` lane, and is ineligible for the milestone lanes.
Result: pre-candidate miss and final miss. Benchmark baseline:
candidateRecall 16/17, finalRecall 16/17.

## PROBLEM / ROOT CAUSE

Candidate discovery is lexical only (`fetchEpisodicMemoryCandidateRows`), and
the one final scorer (`scoreFactForPrompt`) requires lexical overlap for any
non-empty query. Adding semantic candidates alone would fix only half: they
would be dropped again at the lexical relevance gate. Both owners had to
learn semantic evidence. A candidate-only Jev reranker cannot fix this,
because the answer never reaches the candidate set.

## OWNER MAP (current main; ONE RESPONSIBILITY = ONE OWNER)

| # | Responsibility | Canonical owner | Change |
|---|---|---|---|
| 1 | Episodic canonical fact storage | `episodic_memory_facts` (`episodicMemoryFacts.ts`, `db.ts`) | none |
| 2 | Candidate eligibility / RAW min-age / reset boundary | `buildEpisodicCandidateScope` | none; the semantic lane reuses `recallWhere` |
| 3 | Lane budgets | `resolveEpisodicLaneBudgets` | + `semanticFilled` slots, taken first; lexical weights unchanged (equal to main for limits 0..500 when 0) |
| 4 | Candidate fetch/merge | `fetchEpisodicMemoryCandidateRows` | + semantic lane inside the same owner |
| 5 | Retrieval safety guard | `evaluateEpisodicRetrievalGuard` | none; semantic rows pass through it |
| 6 | Canon / evidence guard | `detectUnverifiedCanonicalization` / `detectUnsupportedEvidenceFact` | none |
| 7 | Latest-state / historical reconciliation | `reconcileGlobalStateLikeFacts` + `resolveLatestFactsByLogicalKey` | none |
| 8 | RAW / Global / Relationship / Lorebook dedupe | `findDuplicateReason` | none; semantic rows pass through it |
| 9 | Final relevance / ranking | `scoreFactForPrompt` (still the only one) | + optional semantic evidence; absent evidence gives identical scoring |
| 10 | Final max-facts / max-chars budget | `getEpisodicMemoryForPrompt` | none |
| 11 | Regeneration replacement | `reconcileEpisodicMemoryFactsForGeneration` | none |
| 12 | Message-edit replacement | `replaceEpisodicMemoryFactsForCanonicalMutation` | none |
| 13 | Delete / rewind invalidation | `deleteEpisodicMemoryFactsByAssistantMessageIds`, seal-batch invalidation | none |
| 14 | Fork / reset boundary | `memory-source-boundary.ts`, `memory-fork-snapshot.ts` | none |
| 15 | Post-turn background lifecycle | `scheduleMemoryUpdate` (`memory-manager.ts`) | + gated index job after the committed reconcile |
| 16 | Provider auth / headers | `openRouterConfig` | reused |
| 17 | Provider usage / cost ledger | `parseOpenRouterUsage`, `recordBackgroundProviderCost` | reused (cost center `memory`) |
| 18 | #1072 benchmark | `memory-rp-benchmark.ts` + test | extended in place (modes) |
| 19 | #1071 Jev Decisions | `jevDecisions.ts` | untouched, not reused for embeddings |
| new | Semantic config (models, thresholds, weights, lane share, bounds, gate) | `memory-episodic-semantic-config.ts` | new, the only place these numbers live |
| new | Derived semantic sidecar | `memory-episodic-semantic-index.ts` (`episodic_memory_fact_embeddings`) | new |
| new | Embeddings transport | `openRouterEmbeddings.ts` | new, the only embeddings HTTP owner |
| new | Text→vector orchestration | `memory-episodic-semantic-jobs.ts` | new |

## AFTER

- **Sidecar** `episodic_memory_fact_embeddings` stores `fact_id, chat_id, model_id, dimensions, content_hash, embedding BLOB, created_at, updated_at`.
  - Primary key is `(fact_id, model_id, dimensions)`.
  - It holds no fact text; canonical text is always re-read from `episodic_memory_facts`.
  - It is created lazily via `ensureEpisodicFactEmbeddingSchema`, the repo's side-table convention. No remote schema version bump; nothing is created while disabled.
- **Lane**: the semantic lane re-selects canonical rows under the same `recallWhere` scope and joins the sidecar on `(fact_id, chat_id)` for the same model and dimensions. It then:
  - recomputes the sha256 of the sanitized `fact_text` and skips any mismatch;
  - decodes the vector, failing closed on bad bytes;
  - computes a dot product (vectors are unit-normalized);
  - admits only similarities at or above the config threshold;
  - fills at most `semanticLaneMaxShare × candidateLimit` slots.
  
  The lexical lanes share the rest with unchanged weights. The candidate limit stays 100.
- **Scorer**: a fact passes the relevance gate on lexical overlap **or** on semantic similarity at or above the active config threshold. A semantic pass adds `semanticScoreWeight × similarity` to the score. Milestone status alone never passes.
- **Jev** is not involved (Phase 14). A Jev rerank is a separate follow-up, justified only if a benchmark shows ranking is the remaining bottleneck.

## INDEX LIFECYCLE

1. The canonical write (`reconcileSharedEpisodicFactsForTurn`) commits its own transaction.
2. Only then, `scheduleMemoryUpdate` awaits `runEpisodicSemanticIndexJob`. This reuses the existing post-turn owner; there is no new fire-and-forget subsystem.
3. The job prunes orphan vectors (the single cleanup owner), then selects at most 16 facts that have no vector for this model, or whose content hash drifted (newest indexed rows re-checked).
4. It embeds them in one call.
5. It writes each vector through `upsertEpisodicFactEmbedding`, which re-reads the canonical row and **drops** a result whose fact was deleted or changed during the call.

Other properties:
- Idempotent: the same fact, hash, model, and dimensions trigger 0 further embeddings (test L).
- Backfill is lazy and bounded (one batch per turn); there is no one-shot migration.
- Chat and character deletion wipe vectors in their existing cleanup owners.
- No embedding HTTP ever runs inside `persistEpisodicMemoryFactsCore`'s transaction.

## MUTATION SAFETY

Stale vectors are excluded **structurally**, through canonical re-resolution
+ scope + content hash, not through delete hooks in every mutation owner:

| Mutation | Why an old vector cannot resurrect a fact | Test |
|---|---|---|
| Regeneration | Rejected rows are deleted, so the JOIN finds nothing; the job prunes the orphan | E |
| Message edit | Replacement inserts new ids; the old id is orphaned, and an in-place change fails the hash | F, K |
| Delete / rewind | The canonical row is gone, so the JOIN finds nothing | G |
| Fork / reset | `recallWhere` enforces `source_user_message_id > resetAfterMessageId` | H |
| RAW window | `recallWhere` min-age excludes RAW-owned turns | H2 |
| Latest-state | The temporal owner still replaces stale state after the lane | D |
| Raced index write | The upsert re-checks the canonical row; the result is dropped | M |
| Other model / dims | Filtered in SQL; never compared | J |

## FALLBACK

These all return **exact lexical V2** output (deep-equal comparison against a
no-semantic call), and none can fail Main RP:
- missing key (0 HTTP);
- timeout / network failure;
- HTTP 429 / 4xx / 5xx;
- malformed JSON;
- wrong vector count;
- NaN or Infinity values;
- wrong dimensions;
- model mismatch;
- empty or missing index;
- stale content hash;
- corrupt stored bytes;
- malformed sidecar table (lane error);
- a partial batch failure (writes nothing).

The only retry is none: one attempt per call, no fallback fan-out.

## PRIVACY DELTA

- **Sent (only once activated):** the bounded current user message, used as the query (≤500 characters); and sanitized canonical episodic `fact_text` (≤400 characters per fact, ≤16 facts per batch).
- **Never sent:** transcripts, Global Memory, Persona Secret text, system prompts, credentials, DB ids, or metadata.
- **Routing:** every request carries `provider: { zdr: true, data_collection: "deny" }`. This was verified in the official `openapi.json`: `/embeddings.provider` is `ProviderPreferences`, which includes `zdr` and `data_collection`, and routing errors when no compliant endpoint exists. Both candidates currently have ZDR endpoints: bge-m3 on Parasail and DeepInfra; qwen3-embedding-8b on Nebius, SiliconFlow, and DeepInfra.
- **ZDR still means the provider receives and processes the text.**
- **Open decision for GPT/user before activation:** episodic facts and user messages from adult chats would be in scope. Should adult or NSFW chats be excluded from semantic indexing?

## COST DELTA

- **Live cost:** NOT_MEASURED.
- **List price:** $0.01 per million input tokens for both candidates (OpenRouter `/api/v1/embeddings/models`).
- **Estimated upper bound per turn (assumes ~1 token per Korean character):** ≤500 query tokens + ≤1,200 index tokens → ≤~1,700 tokens per turn → about $0.000017 per turn, about $0.017 per 1,000 turns. This is ESTIMATED, not measured.
- **Ledger:** rows go to the existing `api_cost_ledger` (request kind `background-memory-episodic-embedding`, cost center `memory`). No billing or point policy changes.

## LATENCY DELTA

- **Query embedding:** 1 call per turn, awaited before retrieval (2.5 s timeout). Live round-trip is NOT_MEASURED.
- **Index job:** ≤1 call per turn, off the critical path.
- **In-process scan:** measured on synthetic unit vectors with the real owners and 15 iterations. It runs synchronously in retrieval, so this is added latency on the chat path:

| model / dims | facts | B/fact | retrieval OFF p50/p95 ms | retrieval ON p50/p95 ms |
|---|---|---|---|---|
| bge-m3 / 1024 | 150 | 4096 | 2.61 / 2.93 | 4.68 / 5.43 |
| bge-m3 / 1024 | 900 | 4096 | 3.89 / 4.13 | 14.62 / 16.17 |
| bge-m3 / 1024 | 3000 | 4096 | 8.06 / 9.19 | 43.86 / 50.05 |
| bge-m3 / 1024 | 10000 | 4096 | 21.43 / 25.75 | 152.7 / 170.67 |
| qwen3-8b / 4096 | 150 | 16384 | 2.24 / 3.00 | 6.30 / 7.58 |
| qwen3-8b / 4096 | 900 | 16384 | 3.84 / 4.84 | 25.17 / 28.07 |
| qwen3-8b / 4096 | 3000 | 16384 | 7.83 / 9.06 | 87.9 / 93.18 |
| qwen3-8b / 4096 | 10000 | 16384 | 21.07 / 25.88 | 304.53 / 341.86 |

Full breakdown (load, decode, similarity, heap) is in the script output. Real
per-chat P50 volume is NOT_MEASURED: the dev DB has 0 facts. The only
production writer caps at 3 facts per turn, so T1000 ≈ 3,000 facts. No
ANN/vector DB is proposed until a live benchmark shows this matters.

libsql's built-in `vector32()` and `vector_distance_cos()` are available
locally and are a follow-up option for pushing the scan into SQL.

## BENCHMARK (#1072 harness, synthetic embedder, same metric semantics)

| mode | candidateRecall | finalRecall | falseInjection (21/23 eligible) | staleState (2/23) | known gap cand/final | milestone retention | semantic admitted |
|---|---|---|---|---|---|---|---|
| lexical-v2-baseline | 16/17 | 16/17 | 0 | 0 | miss/miss | 10/25 | 0 |
| semantic share 0.05 | 17/17 | 17/17 | 0 | 0 | hit/hit | 9/25 | 5 |
| semantic share 0.10 | 17/17 | 17/17 | 0 | 0 | hit/hit | 9/25 | 10 |
| semantic share 0.20 | 17/17 | 17/17 | 0 | 0 | hit/hit | 8/25 | 20 |

These are raw numbers; no winner is chosen. The synthetic embedder says
nothing about how bge-m3 or qwen3-embedding-8b would perform. Per-model
quality, threshold, and weight are NOT_MEASURED.

## LIVE BENCHMARK PROPOSAL (not run; needs explicit approval)

- **Credential:** a benchmark-only credential following the repo's triple opt-in convention (`scripts/lib/benchmarkCheaperInferenceCredential.ts`, `realProbeIsolation.test.ts`):
  - `REGULAR_TEST_REAL_PROVIDER_CALLS=1`
  - `REAL_EPISODIC_EMBEDDING_PROBE=1`
  - `OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY`
  
  This would need an explicit-key parameter on the transport. It is not added here, and the production `OPENROUTER_API_KEY` must not be reused.
- **Scope:** both candidates (plus `openai/text-embedding-3-small` as a control), run over the #1072 cases.
- **Estimated size:** roughly 40 facts plus 23 queries per model, which is ~63 inputs and ≤~25k tokens per model. That is far below $0.01 per model at list price.

## REMOVED / PRESERVED / REGRESSION RISKS

- **Removed:** nothing. No dead helpers were introduced: every export has a runtime or test reader.
- **Preserved:**
  - lexical lanes and weights, and the final budget;
  - temporal, canon, and dedupe owners;
  - Relationship Memory and Persona Secret;
  - Scene Directive and authoring;
  - Global, Medium, and RAW memory;
  - Main RP routing;
  - the Jev transport;
  - billing and provider routing.
- **Risks, only after a future activation:**
  - synchronous scan latency (see the latency table);
  - query-embedding round-trip on the chat path;
  - adult-content privacy scope;
  - uncalibrated thresholds.
  
  The runtime gate currently makes all of these unreachable in production.

## PROOF

- **Semantic discovery:** 36/36. **Embeddings transport:** 20/20. **Synthetic fixture:** 1/1. **#1072 benchmark:** 5/5, including the semantic shadow run.
- **39-file regression matrix:** identical pass/fail counts and identical failing test names on branch and exact main `96bb9b03`. The failures (`episodicMemoryFacts` 4, `rpDerivedStateEpisodic` 4, `memory-source-edit-invalidation` 3, `memory-branch-reopen` 6) are pre-existing.
- **After the main sync:** `realProbeIsolation` 10/10 and `gmCompletionIntegrity` 20/20.
- **Static checks:** `git diff --check`, `npm run lint`, and `npm run typecheck:app` are clean. Full `tsc` shows the same 2 errors on both branch and main, in `postGmOngoingTrust.test.ts`.
- **Build:** the default `npm run build` fails identically on branch and main because `SESSION_SECRET` is missing. With a ≥32-character dummy value, both build with exit 0 (110/110 pages).
- **Real provider HTTP in tests:** 0 (fetch spy asserted).
