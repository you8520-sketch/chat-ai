# Jev Shadow-Memory Audit — CORRECTION PASS (on current main + #1071 transport)

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
  every metric is `{ value, status, reason? }`. Unmeasured stays null.
- `src/lib/memory/memory-jev-shadow-audit.test.ts`: 11 deterministic
  fixtures (03 split into 03A/03B, each with a single asserted outcome).
- `src/lib/memory/memory-rp-benchmark.test.ts`: 22 executed cases — one per
  requested category, each running a real canonical owner on in-memory
  SQLite with zero provider HTTP (fetch spy) — plus a real-retrieval
  zero-relevant control.
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

## MEASURED METRICS (22 executed cases, fetch spy, real owners)

```text
cases=22 candidateRecall@K=0.941[MEASURED] finalRecall@8=0.941[MEASURED]
falseInjectionRate=0.000[MEASURED] staleStateRecallRate=0.000[MEASURED]
secretLeakCount=0[MEASURED] baselineVsShadowDelta=null[NOT_APPLICABLE]
providerCallsPerTurn=0.000[MEASURED] jevInvocationRate=0.000[MEASURED]
jevP50=null[NOT_APPLICABLE] jevP95=null[NOT_APPLICABLE]
jevCostPer1k=null[NOT_APPLICABLE] promptTokenDelta=null[NOT_APPLICABLE]
fallbackParity=null[NOT_APPLICABLE]
```

Coverage: all 22 requested categories executed ≥1 real-owner case —
boundary_5turn, callback_75turn, t300, t1000, semantic_paraphrase, promise,
betrayal, first_never, role_event_direction, same_turn_multi_event,
latest_state_replacement, historical_repeat_events,
irrelevant_critical_vs_relevant_normal,
user_canonical_vs_assistant_hallucination (real `detectUnverifiedCanonicalization`
guard: undisclosed risky state blocked, user-stated allowed),
regeneration_rejected_event (real reconcile owner deletes the rejected
variant), message_edit (real canonical-mutation replace swaps v1→v2),
delete_rewind (real assistant-id delete), fork_variant (real recall-side
reset boundary excludes pre-fork sources), persona_secret_wrong_observer
(real `upsert` + `getObserverSecretKnowledge`: observer 10 sees, observer 99
gets null), trpg_quest, character_state_transition, location_ownership_transition.
Zero-relevant control runs the real `getEpisodicMemoryForPrompt` on an
irrelevant-only DB and injects 0 facts / empty block.

The single recall miss (16/17) is the tagged
`semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01` case — a documented
baseline repro, NOT a permanent invariant: the approved
semantic-candidate-discovery fix PR must flip it to hit (Phase 10).

## UNMEASURED METRICS (explicit nulls, not proof)

- `baselineVsShadowDelta`, `jevP50/p95`, `jevCostPer1k`, `promptTokenDelta`,
  `fallbackParity`: NOT_APPLICABLE — no shadow/live path executed, no
  benchmark-only Jev credential owner, production key must not be reused.
- Live Jev benchmark stays STOPped pending explicit approval with a stated
  call/token/cost budget, a benchmark-only credential owner, and a bounded
  shadow-input data scope.

## REMOVED

- Stale "no Jev transport on main" premise and every STOP/owner/privacy
  sentence resting on it.
- Hard-coded `baselineVsShadowDelta: 0`, `fallbackParity: true`,
  hand-written zero/false-injection outcomes, bare-null latency/cost fields.
- `CAPTURE_FAILURE` / `MODEL_COMPLIANCE_FAILURE` from the classifier union
  (separate evidence owners required; not inferable here).
- The "candidate recall is always < 1" general invariant — replaced by the
  tagged KNOWN_GAP_BASELINE_REPRO case the fix PR must flip.
- Over-claim "builder cannot receive secrets" — replaced by the explicit
  audit-only caller policy (`SHADOW_INPUT_CALLER_POLICY`).

## DEAD-HELPER AUDIT (Phase 9)

| File | Writer/caller | Runtime reader | Test reader | Future reader | Verdict |
|---|---|---|---|---|---|
| `memory-jev-shadow-audit.ts` | harness tests | none (by design) | audit + benchmark tests | semantic-discovery follow-up (stage vocabulary) | SAFE TO KEEP (audit/test utility, header documents readers) |
| `memory-rp-benchmark.ts` | benchmark test | none (by design) | benchmark test | fix PR re-run (BEFORE→AFTER proof) | SAFE TO KEEP (durable baseline-harness owner) |

No production-only dead helper exists (both have test readers and a named
follow-up reader). Nothing to move or delete. No duplicate
relevance/importance helper was introduced — classification reuses existing
`candidate_lanes` / `relevance_pass` / `final_rank` diagnostics.

## PRESERVED (untouched)

Episodic discovery lanes, `scoreFactForPrompt`, final budget, temporal
reconciliation, Relationship Memory, Persona Secret runtime, Scene
Directive, user authoring, Global / Medium / RAW, Main RP, the #1071 Jev
transport, billing/ledger, provider routing. Provider HTTP = 0 (measured
via fetch spy). Semantic/vector index = 0. DB migration = 0.

## REGRESSION RISKS

None from this PR: additive harness/test/doc files only, no production
import. The 4 pre-existing failures in `memory-retrieval-v2` /
`episodicMemoryFacts` suites are reproduced on the exact current main
(see PROOF) and are untouched by this change.

## PROOF

- New harness: 13/13 pass (11 audit fixtures + full-category benchmark + real zero-relevant control).
- Gates run: audit/benchmark tests, Retrieval V2 tests, episodic-facts tests, #1071 `jevDecisions` tests, role-event-direction tests, memory scope/regen/delete/fork tests, `git diff --check`, `npm run lint`, `npm run typecheck:app`, `npm run build`.
- Pre-existing failures reproduced on EXACT MAIN (not cited from memory).
- EXACT MAIN: `da10e55f2c7594fbb7e47bbbdf471101eb9c9cd8` (Merge PR #1071).
- EXACT PR HEAD: branch tip of #1072 at review time (see PR head commit).
- BEHIND_MAIN: 0 (`git rev-list --count HEAD..origin/main` = 0 after sync merge).
- PROVIDER HTTP = 0 (fetch spy over the benchmark run).

## FINAL CLASSIFICATION

**MEMORY_BENCHMARK_FOUNDATION_READY**

The candidate-discovery gap stays proven, every claimed category now has an
executed real-owner baseline, and every unmeasured metric says so
explicitly. The follow-up semantic-candidate-discovery PR can reuse this
harness as its BEFORE→AFTER proof (flip KNOWN_GAP_BASELINE_REPRO to hit).
Draft PR, do not merge. STOP for GPT exact-head review.
