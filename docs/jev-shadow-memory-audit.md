# Jev Shadow-Memory Audit (FEATURE + MEMORY/RUNTIME QUALITY EXPERIMENT)

Goal of this PR is NOT to add a new memory system. Goal is to prove, with
deterministic reproduction + benchmark + shadow-only evidence, whether
TypeSafe Jev as a semantic decision layer has any narrow, safe place inside
the existing Memory Architecture — while keeping every current owner intact.

Principle: **CODE OWNS STATE. JEV ADVISES SEMANTICS.**
Jev is not a memory writer, canonical truth owner, authoring owner,
persona-secret permission owner, or scene permission owner in this PR.
The live code on `main` is the source of truth; past PR prose was
re-verified against the files below before any claim was written.

## 1. BEFORE — current memory layers and canonical owners (re-verified on main)

| # | Responsibility | Canonical owner (main) |
|---|---|---|
| 1 | Recent RAW / context assembly | `RAW_HISTORY_COMPLETE_EXCHANGES = 4` (`src/lib/memory/memory-constants.ts`); context assembly in `src/services/contextBuilder.ts`; RAW turns loaded via `src/lib/memory/memory-turn-loader.ts` |
| 2 | 5-turn seal / summary lifecycle | `ROLLING_SUMMARY_INTERVAL = 5`; seal owner `processRollingSummaryBatch` / `composeBatchScopePayload` / `persistValidatedSummaryBatch` in `src/lib/memory/memory-rolling-summary.ts` + `memory-summary-persist.ts` + `memory-summary-scope.ts`; canon-freeze gate `isRollingSummaryBatchSealEligible` |
| 3 | Medium N15 | `MEDIUM_TERM_BLOCK_COUNT = 15` in `src/lib/memory/memory-medium-term.ts`; read-only projection `buildMediumTermMemoryBlock(ForProjection)`; activates only on `global_compact` projection |
| 4 | Global Current Memory / whole-history compact | `chat_memories.recent_summary` rebuilt from `chat_turn_summaries` (`rebuildLorebookFromRecords`), compacted by `compactCurrentMemory` / `executeGlobalLorebookCompaction`; checkpoint in `memory-global-checkpoint.ts` |
| 5 | Episodic persistence | `persistEpisodicMemoryFactsCore` (+ `reconcileEpisodicMemoryFactsForGeneration`, `replaceEpisodicMemoryFactsForCanonicalMutation`) in `src/lib/episodicMemoryFacts.ts`; extraction contract `src/lib/memory/memory-episodic-prompt.ts` via `memory-episodic-extract.ts`; schema `memory-episodic-types.ts` + `memory-episodic-normalize.ts` |
| 6 | Episodic candidate discovery | `fetchEpisodicMemoryCandidateRows` + `buildEpisodicCandidateScope` + `resolveEpisodicLaneBudgets` in `src/lib/episodicMemoryFacts.ts` (lanes: 55 recent / 25 relevance LIKE / 10 critical + 10 important milestone per 100 candidates) |
| 7 | Episodic final ranking / relevance gate | `scoreFactForPrompt` (lexical overlap × 4 + importance + recency + milestone bonus; nonempty scene query requires lexical overlap) + `getEpisodicMemoryForPrompt` budget/dedupe in `src/lib/episodicMemoryFacts.ts` |
| 8 | latest-state / historical-event temporal | `reconcileGlobalStateLikeFacts` (global latest within boundary) + `resolveLatestFactsByLogicalKey` (local latest-wins for state-like, preserve-all for `historical_event`) + `classifyEpisodicFactTemporalNature` in `src/lib/episodicMemoryTemporal.ts` (`COMPLETED_SCENE_EVENT_ATTRIBUTES` = action/response/scene_event/encounter_event/role_direction) |
| 9 | Regeneration / edit / delete / fork / reset invalidation | Regen replace via `reconcileEpisodicMemoryFactsForGeneration(replaceSourceTurn)`; canonical-mutation replace via `replaceEpisodicMemoryFactsForCanonicalMutation`; assistant-id delete via `deleteEpisodicMemoryFactsByAssistantMessageIds`; seal-batch invalidation via `invalidateSummarySealBatchEpisodicFactsForSourceMutation`; epoch/reset boundary via `src/lib/memory/memory-source-boundary.ts` (`memory_epoch`, `resetAfterMessageId`, `isMemoryWriteGuardCurrentCore`) |
| 10 | Relationship Memory | Durable ledger in `chats.memory_meta` (items / promises); writer/persistence split owned by `src/lib/memory/memoryRelationshipTask.ts` + shared-runner handoff; episodic guard defers ledger-owned promise/item facts (`detectRelationshipLedgerOwnedFact`) — see `docs/post-turn-luna-owner.md` |
| 11 | Persona Secret knowledge / evidence | Public-only prompt path (`formatPublicPersonaForPrompt` in `src/lib/personaSecretPrompt.ts`, never `secret_description`); compiler/discovery owners `personaSecretCompiler.ts` / `personaSecretDiscoverySchema.ts` / `personaSecretDirectDisclosure.ts`; observer isolation enforced outside episodic recall |
| 12 | Scene Directive | `buildSceneDirective` / `renderSceneDirectiveForPrompt` in `src/lib/sceneDirective.ts` (motion decision HOLD/MICRO_MOTION/SCENE_ADVANCE/ESCALATE + weighted progression types + NPC grounding + execution contract) |
| 13 | Effective LIMITED/NORMAL/ALLOW/ABSOLUTE authoring | `resolveEffectiveUserAuthoringFromChatColumn` in `src/lib/userCoauthorState.ts` (base `chats.user_authoring_level` + `user_coauthor_mode` override + current-turn delegation; policy shapes in `userAuthoringPolicy.ts` / `currentTurnUserAuthoringDelegation.ts`) |
| 14 | Post-turn Shared Luna physical call | `runPostTurnSharedInitial` single-physical-call owner (`src/lib/postTurnSharedInitial/run.ts`); Status/Suggestions/Relationship consume the shared result, no repair fan-out — see `docs/post-turn-luna-owner.md` |
| 15 | Provider cost / provenance | `OPENROUTER_CHAT_COMPLETIONS_URL` + `resolveOpenRouterModelId` in `src/lib/openRouterConfig.ts`; spend ledgers `post_turn_shared_initial` / `status_widget_extract` families + receipt/billing owners (`storedTurnChargeEvidence.ts`, `billingUsage.ts`, `adminProviderRequestLookup.ts`) |
| 16 | Jev Decisions transport | **Does not exist on main.** Case-insensitive repo search for `jev` / `typesafe` / Decisions-API transport returns zero runtime matches. Per the task STOP rule, no duplicated temporary transport was created; only the audit/benchmark harness (no network) is implemented and integration is STOPped. |

Turn dataflow (one turn, code order):
user/assistant source → RAW (N-3..N) → 5-turn seal (`memory-rolling-summary.ts`)
→ episodic extraction (`memory-episodic-extract.ts`) → persistence
(`persistEpisodicMemoryFactsCore`, ledger/canon/psychological/evidence filters)
→ reconciliation (`reconcileGlobalStateLikeFacts` → `resolveLatestFactsByLogicalKey`)
→ retrieval candidate discovery (4 lanes) → ranking (`scoreFactForPrompt` + relevance floor)
→ dedupe vs current-user/RAW/Global/relationship/lorebook/triggered
→ prompt injection (`formatEpisodicMemoryPromptSection` via `contextBuilder.ts`)
→ Main RP consumption. Retrieval errors fall back to an empty block; Main RP
request never fails because of memory.

## 2. PROBLEM — reproduced failures, separated by stage (never mixed)

Deterministic fixtures: `src/lib/memory/memory-jev-shadow-audit.test.ts`
(10 cases). Every case records PRE_CANDIDATE_SET
(`fetchEpisodicMemoryCandidatesForDebug`), POST_RANK_RESULT
(`getEpisodicMemoryForPrompt` debug: `relevance_pass` / `final_rank`),
FINAL_PROMPT_INJECTION (`promptBlock`) separately.

| Fixture | PRE | POST | FINAL | Stage class |
|---|---|---|---|---|
| 01 paraphrase, no lexical overlap (saturated 60-row recent lane) | miss | n/a | miss | **CANDIDATE-RECALL FAILURE → JEV_RERANK_NOT_APPLICABLE** |
| 02 relevant-normal vs irrelevant-critical (lexical bridge present) | hit | pass | hit | already correct (no Jev needed) |
| 03 long-horizon milestone + paraphrased cue | lane-dependent | lane-dependent | recorded | candidate-or-ranking (bounded shadow input proven) |
| 04 zero-relevant | n/a | n/a | empty (correct) | NO_OP_ZERO_RELEVANT |
| 05 latest-state conflict | hit | pass | newest wins | temporal owner correct (not rerank) |
| 06 historical-event preservation | hit | preserved | preserved | temporal owner correct |
| 07 participant/direction-sensitive | hit | pass | hit | already correct |
| 08 first-time / never continuity | hit | pass | hit | already correct |
| 09 promise/commitment (non-ledger phrasing) | hit | pass | hit | already correct; formal `약속했다`-class stays ledger-owned by design |
| 10 TRPG quest callback | hit | pass | hit | already correct (lexical bridge required) |

The semantic paraphrase gap is real and is a **candidate-discovery**
problem, not a ranking problem: with the recent lane saturated by 60 newer
rows, the old normal non-historical answer fact is unreachable by the token
`LIKE` relevance lane (no shared token) and by the milestone lanes (normal
importance, non-historical attribute), so it never enters the bounded
100-candidate set. A reranker that only reorders existing candidates cannot
fix this by construction.

## 3. ROOT CAUSE (evidence-based)

`fetchEpisodicMemoryCandidateRows` discovers relevance lexically
(`tokenizeForSimpleBoost` → `LOWER(fact_text|subject|attribute|value) LIKE`),
and `scoreFactForPrompt` additionally floors nonempty scene queries on
`relevance > 0`. Both owners are in `src/lib/episodicMemoryFacts.ts` and are
unchanged by this PR. The pre-existing `docs/memory-retrieval-v2-audit.md`
already documents this as "an explicit lexical limit". Fixture 01 above
re-proves it deterministically on current main with stage separation:
`preCandidateHasAnswer=false` while the row exists in DB.

## 4. OWNER MAP — before / after

Before: §1 table (16 owners, all canonical).
After: **identical.** This PR adds two read-only, provider-free modules and
their tests/docs only:

- `src/lib/memory/memory-jev-shadow-audit.ts` (pure stage classifier + bounded shadow-input builder)
- `src/lib/memory/memory-rp-benchmark.ts` (pure raw-metric aggregation)
- `src/lib/memory/memory-jev-shadow-audit.test.ts`, `src/lib/memory/memory-rp-benchmark.test.ts`
- this doc

No existing scorer, guard, lane, budget, ledger, seal, authoring, secret,
scene, billing, or provider file is modified. No duplicate
relevance/importance helper was introduced: classification reuses
`fetchEpisodicMemoryCandidatesForDebug` / `getEpisodicMemoryForPrompt` debug
output, and shadow instrumentation reuses the existing
`candidate_lanes` / `relevance_pass` / `final_rank` diagnostics.

## 5. AFTER — Jev's restricted semantic responsibility

None in production. The only Jev-shaped artifact is the **bounded shadow
input builder** (`buildShadowJevInput`: scene query ≤500 chars + ≤8
candidates as local aliases `P0..Pn` with ≤200-char fact excerpts; no
transcript, no Global Memory, no Persona Secret text, no unrelated user
data, no raw DB ids, no credentials, no system prompt). It is exercised by
fixture 03 as a shape proof only — no transport, no live call, no prompt
effect. Production prompt results are the existing V2 output byte-for-byte.

## 6. REMOVED / PRESERVED / RISKS

- REMOVED: nothing (no temporary transport, no duplicate scorer, no obsolete experiment code introduced).
- PRESERVED: RAW policy, 5-turn seal lifecycle, Medium N15 lifecycle, Global whole-history compact, episodic persistence owner, latest-state/historical-event semantics, regen/edit/delete/fork/reset correctness, Persona Secret observer isolation, user-authoring canonical owner, Main RP model routing, Shared Luna physical-call budget, billing/cost ledger, normal failure fallback, final prose format. **Jev DOWN == existing site memory behavior** holds trivially (no integration).
- REGRESSION RISKS: none from this PR (additive test/harness/doc files only; no runtime import by production paths).

## 7. PRIVACY / PROVIDER DELTA

- PRIVACY DELTA: zero. No new data leaves the server; the harness runs on in-memory SQLite fixtures. Phase A rule is honored structurally: the shadow input builder cannot accept transcripts, Global Memory, or Persona Secret text.
- OpenRouter/TypeSafe privacy/ZDR contract (Phase 4): re-checked at implementation time — this repo contains no Decisions-API client, no ZDR option field, and no workspace guardrail owner to cite. Because request-level ZDR support in the Decisions API could not be confirmed from an official in-repo source, **no ZDR field was invented** and no live provider call is made. A live integration must first confirm the official ZDR enforcement path; until then STOP stands.
- PROVIDER CALL DELTA: `+0` per turn (`providerCallsPerTurn=0`, `jevInvocationRate=0`).
- COST DELTA: `+0` (`jevCostPer1000Turns=null` — unmeasured by design, no live run authorized).
- LATENCY DELTA: `+0` (`jevP50/p95=null` — no transport to time; no retry/fallback fan-out created).

## 8. PROOF — benchmark raw metrics (no subjective scores)

Harness: `src/lib/memory/memory-rp-benchmark.ts`; run:
`src/lib/memory/memory-rp-benchmark.test.ts` (in-memory DB, no network).

Current run (5 cases incl. zero-relevant control):

```text
cases=5 candidateRecall@K=0.750 finalRecall@8=0.750 falseInjectionRate=0.000
staleStateRecallRate=0.000 secretLeakCount=0 baselineVsShadowDelta=0
providerCallsPerTurn=0 jevInvocationRate=0 jevP50=null jevP95=null
jevCostPer1k=null promptTokenDelta=0 fallbackParity=true
```

`candidateRecall@K < 1` is the paraphrase candidate-recall gap (fixture 01);
`finalRecall@8` tracks it exactly because the miss happens before ranking.
`secretLeakCount=0`, `staleStateRecallRate=0`, `fallbackParity=true`.
No quality score was invented; GPT/human reviewers judge from these raw
numbers plus the per-fixture stage tables in §2.

## 9. LIVE PROVIDER BOUNDARY (Phase 6 — STOP, approval required)

No live Jev benchmark was run and none is authorized by this PR. If a live
run is ever approved, the following must be stated first (current values are
STOP defaults, not estimates): expected physical call count, expected input
tokens, expected cost, credential owner (a benchmark-only owner must be
created — production `OPENROUTER_API_KEY` must NOT be reused), and exact
transmitted data scope (bounded shadow input only). Regular unit/integration/CI
uses no real key (this harness uses in-memory fixtures only).

## 10. FOLLOW-UP CANDIDATES (separate PRs, not this one)

- Fact + evidence-anchor audit: `episodic_memory_facts.source_user_message_id` + `metadata.assistant_message_id/request_id/evidence_source_turn` already exist; a bounded canonical excerpt could be re-resolved behind active-variant, regen-reject, edit/delete-stale, fork-scope, and observer-isolation checks. Needs design; no schema migration in this PR.
- Persona-conditioned projection: keep Episodic = objective event truth, Relationship = character-specific interpretation, Persona Secret = epistemic knowledge; Relationship must reference (not rewrite) source fact ids/provenance.
- Critical-turn / scene-direction routing (CONTINUE/ESCALATE/DEESCALATE/INVESTIGATE/REVEAL/RESOLVE/TRANSITION): Jev may propose WHICH direction only; Scene Directive owner keeps prompt construction and the authoring owner keeps WHAT MAY BE AUTHORED. TRPG identical.
- Semantic embedding candidate discovery, adaptive recall depth, admission gate, temporal-contradiction assistance, periodic hygiene: all separate follow-ups gated on the candidate-recall proof above.

## 11. FINAL CLASSIFICATION

**JEV_RERANK_NOT_APPLICABLE_CANDIDATE_RECALL_GAP**

The proven narrow point is semantic candidate discovery (hybrid embedding /
disposable index over canonical fact ids feeding the existing guards), not
reranking. Shadow rerank integration is STOPped per the task's own stop
conditions (relevant fact missing from the pre-rank set; no Jev transport on
main; unclear official ZDR enforcement). Draft PR; do not merge as a behavior
change — it is evidence, not a rollout.
