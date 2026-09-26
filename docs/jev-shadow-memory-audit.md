# Jev Shadow-Memory Audit — FINAL CORRECTION PASS (on current main + #1071 transport)

This PR is a FEATURE/AUDIT CORRECTION, not a semantic-retrieval feature.
It preserves the proven root cause (candidate-discovery gap) while fixing
the v1 evidence defects: unmeasured metrics reported as quality proof,
narrow benchmark scope vs claimed scope, a non-deterministic fixture 03, a
hand-written zero-relevant control, an over-broad stage classifier, an
over-claimed privacy guarantee, and the stale "no Jev transport on main"
premise after PR #1071 merged.

Principle unchanged: **CODE OWNS STATE. JEV ADVISES SEMANTICS.**
No production integration is added here.

## BEFORE — v1 evidence defects (honest list)

1. `secretLeakCount: 0` was a hand-written outcome field, not a measured
   wrong-observer execution.
2. `baselineVsShadowDelta: 0` and `fallbackParity: true` were hard-coded
   defaults presented alongside measured numbers — no shadow path and no
   fallback comparison were ever executed.
3. Jev latency/cost were reported as bare `null` without a status vocabulary,
   inviting readers to treat "no data" as "no cost".
4. `providerCallsPerTurn: 0` was asserted, not observed (no transport spy).
5. Benchmark claimed a wide `BenchmarkCategory` enum but executed only
   5 cases; most categories had zero executions behind them.
6. The zero-relevant "benchmark" was a hand-written outcome object — the
   production retrieval owner never ran for it.
7. Fixture 03 accepted three different outcomes (`assert.ok(a || b || c)`)
   — not a deterministic regression fixture.
8. `MemoryFailureStage` listed CAPTURE_FAILURE and MODEL_COMPLIANCE_FAILURE,
   which the pre/post/final triple cannot determine — claiming more
   coverage than the classifier owns.
9. `buildShadowJevInput` was documented as if it *cannot* receive secret/
   transcript text; it takes `readonly string[]` and structurally can.
10. v1 stated "no Jev Decisions transport on main". PR #1071 has since
    merged `src/lib/jevDecisions.ts`. The premise is stale and every STOP /
    owner / privacy sentence resting on it is corrected below.

## PROBLEM — why some v1 metrics looked stronger than measured

Unmeasured `0`/`true`/`null` values shared one flat metric object with real
measurements and no status labels, so a reader could not tell evidence from
absence-of-evidence. The fix is a measurement-status vocabulary on every
metric: MEASURED / DERIVED / NOT_MEASURED / NOT_APPLICABLE, with null values
and reasons for everything not executed.

## ROOT CAUSE — hard-coded defaults + unexecuted categories + stale main

Same cause for defects 1–6 and 10: the harness reported intentions
(zero leaks, zero delta, parity, no transport) instead of executions.

## AFTER — durable benchmark foundation

- `src/lib/memory/memory-jev-shadow-audit.ts`: retrieval-stage-only
  classifier (`CANDIDATE_RECALL_FAILURE` / `RANKING_FAILURE` /
  `TEMPORAL_FAILURE`), Jev applicability, and the bounded shadow-input
  builder with an explicit **audit-only caller policy** (option A — no new
  privacy subsystem; the builder documents that arbitrary strings are
  type-compatible and that approved callers must pass only bounded
  candidate excerpts + bounded scene query).
- `src/lib/memory/memory-rp-benchmark.ts`: raw-metric aggregation where
  every metric is `{ value, status, eligibleCases?, totalCases?, reason? }`;
  outcomes carry raw per-stage evidence ids (candidate / final with
  `allowedFactIds` / stale / observer isolation) and each metric's
  denominator is only the cases holding that evidence. Unmeasured stays null.
- `src/lib/memory/memory-jev-shadow-audit.test.ts`: 11 deterministic
  fixtures (03 split into 03A/03B, each with a single asserted outcome).
- `src/lib/memory/memory-rp-benchmark.test.ts`: 23 executed cases — one per
  requested category plus a real-retrieval `zero_relevant_control`, each
  running a real canonical owner on in-memory SQLite with zero provider HTTP
  (fetch spy) — plus a false-injection negative proof and a NOT_MEASURED
  eligibility test.
- Transport existence alone triggered no integration: the #1071 transport
  (`callJevDecisions`) has no ZDR/retention request field on its official
  wire body (`{model, state, questions}`), reuses the production
  `OPENROUTER_API_KEY` auth owner, and has no benchmark-only credential
  owner (the repo's benchmark-only owner covers CheaperInference, not Jev).
  So: no live Jev run, no secret/adult-transcript transmission, no
  reranker — STOP stands on current-main grounds, not stale ones.

## OWNER MAP — current main (re-verified after #1071 merge)

Unchanged from v1 except the corrected row 16:

| # | Responsibility | Canonical owner (current main) |
|---|---|---|
| 1 | Recent RAW / context assembly | `RAW_HISTORY_COMPLETE_EXCHANGES = 4` (`memory-constants.ts`); `contextBuilder.ts`; `memory-turn-loader.ts` |
| 2 | 5-turn seal / summary lifecycle | `ROLLING_SUMMARY_INTERVAL = 5`; `processRollingSummaryBatch` / `composeBatchScopePayload` / `persistValidatedSummaryBatch`; canon-freeze gate |
| 3 | Medium N15 | `MEDIUM_TERM_BLOCK_COUNT = 15` (`memory-medium-term.ts`); `global_compact`-only activation |
| 4 | Global Current Memory / whole-history compact | `chat_memories.recent_summary` rebuild + `compactCurrentMemory` / `executeGlobalLorebookCompaction` |
| 5 | Episodic persistence | `persistEpisodicMemoryFactsCore` / `reconcileEpisodicMemoryFactsForGeneration` / `replaceEpisodicMemoryFactsForCanonicalMutation` (`episodicMemoryFacts.ts`); extraction contract (`memory-episodic-prompt/extract.ts`); schema+normalize |
| 6 | Episodic candidate discovery | `fetchEpisodicMemoryCandidateRows` + `buildEpisodicCandidateScope` + `resolveEpisodicLaneBudgets` (55 recent / 25 LIKE / 10+10 milestone per 100) |
| 7 | Final ranking / relevance gate | `scoreFactForPrompt` (lexical×4 + importance + recency + milestone; nonempty query needs overlap) + budget/dedupe in `getEpisodicMemoryForPrompt` |
| 8 | latest-state / historical-event temporal | `reconcileGlobalStateLikeFacts` + `resolveLatestFactsByLogicalKey` + `classifyEpisodicFactTemporalNature` (`episodicMemoryTemporal.ts`) |
| 9 | Regen / edit / delete / fork / reset | regen reconcile (`replaceSourceTurn`); canonical-mutation replace; `deleteEpisodicMemoryFactsByAssistantMessageIds`; seal-batch invalidation; epoch/reset boundary (`memory-source-boundary.ts`) |
| 10 | Relationship Memory | `chats.memory_meta` ledger (`memoryRelationshipTask.ts` + shared runner); episodic defers ledger-owned promise/item facts |
| 11 | Persona Secret knowledge / evidence | Public-only prompt (`personaSecretPrompt.ts`); isolation reads (`personaSecretKnowledge.getObserverSecretKnowledge`); compiler/discovery owners |
| 12 | Scene Directive | `buildSceneDirective` / `renderSceneDirectiveForPrompt` (`sceneDirective.ts`) |
| 13 | Effective LIMITED/NORMAL/ALLOW/ABSOLUTE authoring | `resolveEffectiveUserAuthoringFromChatColumn` (`userCoauthorState.ts`) |
| 14 | Post-turn Shared Luna physical call | `runPostTurnSharedInitial` single-call owner (`postTurnSharedInitial/run.ts`) |
| 15 | Provider cost / provenance | `openRouterConfig` (URL/model/key+headers); ledgers `post_turn_shared_initial` / `status_widget_extract`; billing/receipt owners |
| 16 | **Jev Decisions transport (CORRECTED)** | **`src/lib/jevDecisions.ts` (`callJevDecisions`, PR #1071): pinned `typesafe/jev-1.13`, official `/api/alpha/decisions` wire `{model, state, questions}` — no ZDR field, no production call sites, fail-closed answers/usage parsing, canonical cost-ledger + provenance reuse. This PR neither duplicates nor modifies it.** |

Turn dataflow is unchanged from v1 §1. Retrieval errors still fall back to
an empty block; memory never fails a Main RP request.

## PROVEN ROOT CAUSE — re-run on current main (Phase 2)

Fixture 01 re-executed after the main sync: episodic row in DB → old normal
non-historical fact → 60-row saturated recent lane → lexical relevance lane
no match on the paraphrased cue → milestone lanes ineligible (normal,
non-historical) → PRE_CANDIDATE_SET miss → FINAL miss. All 11 audit
fixtures pass on current main.

**SEMANTIC_PARAPHRASE_CANDIDATE_DISCOVERY_GAP = PROVEN (maintained).**
A candidate-only Jev reranker is not the fix for this case. Fixture 03B
additionally shows the adjacent ranking-stage shape (milestone lane rescues
candidacy, relevance gate fails on zero overlap) as evidence only — it does
not authorize integration.

## FINAL CORRECTION PASS — metric semantics (exact-head review of d3dcbad)

Two remaining blockers, both fixed:

1. **False injection was decided by fixture naming.** `evaluate()` flagged a
   false injection only when an injected fact's subject started with
   `"filler"`, and non-retrieval cases were pushed with `falseInjected: false`,
   inflating the denominator. Now every final-retrieval case declares explicit
   `allowedFactIds`; `detectFalseInjection` flags any injected fact outside
   that set; and `falseInjectionRate` counts only cases that actually ran the
   final retrieval owner (`final` evidence present).
2. **Knowledge-store isolation was reported as prompt non-leakage.** The
   Persona Secret case only ran `upsertObserverSecretKnowledge` +
   `getObserverSecretKnowledge` for right/wrong observers. That is
   **knowledge-store observer isolation ≠ end-to-end prompt non-leakage.**
   It is now reported as `wrongObserverKnowledgeLeakCount` (MEASURED, computed
   from the actual wrong-observer lookups), and `secretLeakCount` is
   `null / NOT_MEASURED` — "final wrong-observer prompt/context assembly not
   executed". No Persona Secret prompt subsystem was added.

### Per-metric eligibility

Each case carries evidence objects only for stages a canonical owner actually
ran; a metric's denominator is the cases holding its evidence type:

| Metric | Eligible cases = cases that… |
|---|---|
| `candidateRecall@K` | ran candidate discovery with ≥1 expected answer id |
| `finalRecall@8` | ran final retrieval with ≥1 expected answer id |
| `falseInjectionRate` | ran final retrieval with an explicit `allowedFactIds` set (incl. `allowed = []` controls) |
| `staleStateRecallRate` | ran a real stale-vs-latest competition in one DB |
| `wrongObserverKnowledgeLeakCount` | ran the knowledge-store observer isolation owner |
| `secretLeakCount` (prompt-level) | ran the final prompt/context assembly path — none in this harness |

Allowed sets used: single-answer → `[answerId]`; same-turn multi-event →
`[id1, id2]`; historical repeat → `[id1, id2]` (expected final = the cued
event); character injury→recovery → `[injury, recovery]` (expected =
injury); latest-state / location → `[latestId]` with the old row as stale;
regeneration-rejected / delete / fork / zero-relevant → `[]`. Canon-guard-only
and secret-isolation-only cases carry no `final` evidence and never enter the
false-injection denominator.

## MEASURED METRICS (23 executed cases, fetch spy, real owners)

```text
cases=23
candidateRecall@K=0.941[MEASURED, eligibleCases=17/23]
finalRecall@8=0.941[MEASURED, eligibleCases=17/23]
falseInjectionRate=0[MEASURED, eligibleCases=21/23]
staleStateRecallRate=0[MEASURED, eligibleCases=2/23]
wrongObserverKnowledgeLeakCount=0[MEASURED, eligibleCases=1/23]
secretLeakCount=null[NOT_MEASURED, eligibleCases=0/23]
baselineVsShadowDelta=null[NOT_APPLICABLE]
providerCallsPerTurn=0[MEASURED] jevInvocationRate=0[MEASURED]
jevP50=null[NOT_APPLICABLE] jevP95=null[NOT_APPLICABLE]
jevCostPer1k=null[NOT_APPLICABLE] promptTokenDelta=null[NOT_APPLICABLE]
fallbackParity=null[NOT_APPLICABLE]
```

Eligible counts are computed from evidence present at runtime (the test
asserts them against `outcomes.filter(...)`, not against fixed numbers).

Coverage: all 22 requested categories plus `zero_relevant_control` executed
≥1 real-owner case. Owners per case type: retrieval (`fetchEpisodicMemoryCandidatesForDebug`
+ `getEpisodicMemoryForPrompt`), canon guard (`detectUnverifiedCanonicalization`),
regeneration reconcile, canonical-mutation replace, assistant-id delete,
recall-side fork reset boundary, knowledge-store observer isolation.
Regeneration/delete/fork cases now also run the real final retrieval after
the mutation (allowed = `[]`), so their false-injection eligibility is real.

**Negative proof:** with real fixture ids (relevant normal answer + unrelated
critical fact) and a deliberately wrong final result fed to the pure
evaluator, `detectFalseInjection` returns `true` for `[answer, unrelated]`,
`[unrelated]`, and `allowed=[]` with any injection, and `false` for
`[answer]`. Aggregating one wrong + one clean + one guard-only case yields
`falseInjectionRate=0.500[MEASURED, eligibleCases=2/3]` — the metric catches
wrong injections and excludes non-retrieval cases. A separate test proves a
guard-only run reports every retrieval/secret metric as
`null / NOT_MEASURED / eligibleCases=0`.

**KNOWN_GAP:** the single candidate/final recall miss (16/17) is still
`semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01`: fact exists in DB
(asserted) → candidate miss → final miss on current main. A candidate-only
Jev reranker is not the fix; the semantic-candidate-discovery PR must flip it.

## UNMEASURED METRICS (explicit nulls, not proof)

- `secretLeakCount`: NOT_MEASURED — final wrong-observer prompt/context assembly not executed.
- `baselineVsShadowDelta`, `jevP50/p95`, `jevCostPer1k`, `promptTokenDelta`,
  `fallbackParity`: NOT_APPLICABLE — no shadow/live path executed, no
  benchmark-only Jev credential owner, production key must not be reused.
- Live Jev benchmark stays STOPped pending explicit approval with a stated
  call/token/cost budget, a benchmark-only credential owner, and a bounded
  shadow-input data scope.

## REMOVED

- Stale "no Jev transport on main" premise and every sentence resting on it.
- Hard-coded `baselineVsShadowDelta: 0`, `fallbackParity: true`, bare-null
  latency/cost fields.
- Fixture-name false-injection check (`subject.startsWith("filler")`) and all
  hand-written `falseInjected` / `staleInjected` / `secretLeaked` outcome
  booleans — outcomes now carry raw evidence ids only.
- `secretLeakCount` as a MEASURED value (knowledge-store isolation now lives
  in `wrongObserverKnowledgeLeakCount`).
- `CAPTURE_FAILURE` / `MODEL_COMPLIANCE_FAILURE` from the classifier union.
- The "candidate recall is always < 1" invariant (replaced by the tagged
  KNOWN_GAP case).
- Over-claim "builder cannot receive secrets" (replaced by the audit-only
  caller policy `SHADOW_INPUT_CALLER_POLICY`).

## DEAD-HELPER AUDIT

| File | Writer/caller | Runtime reader | Test reader | Future reader | Verdict |
|---|---|---|---|---|---|
| `memory-jev-shadow-audit.ts` | harness tests | none (by design) | audit + benchmark tests | semantic-discovery follow-up (stage vocabulary) | SAFE TO KEEP |
| `memory-rp-benchmark.ts` | benchmark test | none (by design) | benchmark test | fix PR re-run (BEFORE→AFTER proof) | SAFE TO KEEP |

## PRESERVED (untouched)

Episodic discovery lanes and budgets, `scoreFactForPrompt`, final budget,
temporal owner, Relationship Memory, Persona Secret runtime permissions,
Scene Directive, authoring owner, Global / Medium / RAW, Main RP, the #1071
Jev transport, billing/ledger, provider routing. Provider HTTP = 0 (fetch
spy, `httpCallsObserved` asserted 0). Semantic/vector index = 0. DB
migration = 0. Live Jev = 0.

## REGRESSION RISKS

None from this PR: additive harness/test/doc files only, no production
import. Pre-existing failures are reproduced on the exact current main (see
PROOF) and are untouched by this change.

## PROOF

- New harness: 14/14 pass (11 audit fixtures + full-category benchmark +
  false-injection negative proof + NOT_MEASURED eligibility test).
- Main sync: PR #1073 (authoring `user_impersonation` mirror retirement)
  touches no memory / episodic / Persona Secret / Jev / benchmark file.
- EXACT MAIN / EXACT HEAD / BEHIND_MAIN and the full test matrix + build
  parity are recorded in the PR body for the reviewed head.

## FINAL CLASSIFICATION

**MEMORY_BENCHMARK_FOUNDATION_READY**

The candidate-discovery gap stays proven; false injection is measured by
explicit allowed ids with a real-eligibility denominator and a negative
proof; knowledge-store isolation is separated from prompt-level secret
leakage, which is honestly NOT_MEASURED. Draft PR, do not merge. STOP for
GPT exact-head review.
