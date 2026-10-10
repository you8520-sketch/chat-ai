# Monthly RP Memory Quality — Phase 3A

Status: **PREFLIGHT ONLY. Provider POST 0. Cursor did not score reply quality. Draft PR only. Do not merge. Do not run Luna or Main RP.**

EXACT origin/main at branch: `d9937bcfc69035cbd3fe888875b00408e75f5ada`
#1504 merged as `d9e2bd74`. Phase 2C Luna sample remains archival. Rerun unauthorized.

Tracking: #1486. GPT handoff: 6/50-turn Main RP recall **preparation**, not a rebuild of deterministic retrieve.

## BEFORE

Phase 1 already proves store → retrieve → inject at 6-turn (A) and 50-turn (B) on 라이크 18 / 렌 fixtures. Benchmark `horizon-t6-01` also measures ~6-turn episodic injection IDs. Phase 2B proves canned 5-turn summaries can pass validators while dropping facts. Phase 2C archived one real Luna summary (`providerRequestId=52c1bd6a-23c2-4f82-83b4-9c9db9361694`). None of those tests prove a Main RP model used the injected memory in a generated reply.

## PROBLEM

Need a later, separately approved experiment that asks whether current Main RP models correctly use 6-turn-old and 50-turn-old memories in the reply. Existing retrieve PASS must not be labeled as that reply quality. This VM cannot read production character 18 or admin 렌.

## ROOT CAUSE

The live chat path injects Global Current Memory, episodic facts, and relationship memo, then streams one Main RP completion. Existing #1486 tests stop at retrieve/inject/prompt assembly. No current test captures assistant text against those memories. A 50-turn harbor A/B (`memory50TurnAb*`, 이안/서린) already exists as a different fixture family and already documents `MODEL_READING_FAILURE` as untested. Duplicating that script or generating 50 chat turns is not required to prepare the 라이크/렌 experiment.

## OWNER MAP

| Responsibility | Live owner |
| --- | --- |
| Main RP picker | `MAIN_RP_MODEL_IDS` ← `MAIN_RP_USER_SELECTABLE_OPTIONS` |
| 5-turn seal | `summarizeTurnBatch` / `processRollingSummaryBatch` → `callBackgroundMemory` (`gpt-6-luna`) |
| Global Current Memory | `resolveGlobalCurrentMemory` → `buildMemoryContextForChat` → `contextBuilder` `current-memory` |
| Episodic retrieve/inject | `getEpisodicMemoryForPrompt` → `episodic-memory-retrieved-facts` |
| LTM 10,000 | `MEMORY_CAPACITY_FIXED` |
| Relationship ledger | `memory-relationship-meta` → `[3b] Relationship memo` |
| Final-wire | `buildContext` → `assemblePrimaryRpRequest` → `streamOpenRouterAdultToClient` |
| Main RP usage | `requestKind=main-rp` |
| Provenance | `memoryEvidenceProvenance.ts` |
| Production identity probe (unread here) | `RP_QUALITY_PRECALL_RAILWAY_HASH_PROBE_CONTRACT` (read-only Railway `/data/app.db`) |
| Existing 6/50 retrieve | Phase 1 A/B, `horizon-t6-01` |

Active models: DeepSeek V4.1 Flash, Gemini 3.8 Flash, GPT-6.1 Sol, Claude Opus 5.5. Retired models are not in the picker.

## PATHS

**A. Seeded memory → retrieve → inject → one Main RP reply.**
Retrieve/inject can be proven by existing tests. Reply quality needs later paid Main RP POSTs.

**B. Real Luna seal → store → retrieve → inject → Main RP reply.**
A Path A pass is not a Path B pass. Phase 2C already produced one 5-turn Luna sample; do not re-call it.

**B-lite (preferred later 6-turn Path B):** inject the archived Phase 2C summary, then one Main RP reply per model. New Luna POST 0.

**B-full 50-turn:** 10 seal batches × existing max 3 attempts + 4 Main RP replies. Not approved. Do not generate 50 chat turns to build that history.

Identity: **FIXTURE_ONLY**. Local `data/app.db` has characters 1–9 only. Production sheets unread. Homepage / Railway-container parity UNPROVEN.

## EVALUATION CASES

Reused, not rewritten:

| Horizon | Source | Probe |
| --- | --- | --- |
| 6턴 | Phase 1 A | T1 우산 골목 → T7 `그때 우산 같이 썼던 거 기억나?` |
| 50턴 | Phase 1 B | T1 옥상 첫 담배 → T51 `옥상에서 담배 피웠던 첫날 기억해?` |

Contrast already owned (not added, not in the later 8-POST core):

- past vs current — Phase 1 D
- claim vs fact — Phase 1 G / Phase 2B
- owner / promise / emotion / 공수 — Phase 1 E/F, Phase 2B facts
- false shared memory — existing scheduled HISTORICAL_ONLY case, different character

Harbor 이안/서린 50-turn A/B stays out of this packet.

## PAID PLAN (not executed)

This phase: **Provider POST 0**.

If a later operator approves Path A only:

| Item | Count |
| --- | --- |
| Horizons | 2 (t6, t50) |
| Models | 4 |
| Main RP POSTs | **8** |
| Luna POSTs | **0** |
| Chat generations to seed history | **0** |

If a later operator approves 6-turn Path B-lite (reuse Phase 2C summary):

| Item | Count |
| --- | --- |
| Main RP POSTs | **4** |
| New Luna POSTs | **0** |

Path B-full remains a separate approval. Duplicate-run prevention: archival evidence + `paidEvaluationApproved: false` + no execute CLI. Do not add a new permanently runnable paid path.

Rates come from `resolveOpenRouterModelRates(resolveMainRpPrimaryWireModelId(id))`. Gemini wire id is `google/gemini-3.8-flash`. Actual billed USD is provider-reported, not this estimate.

## GPT PACKET

`emptyPhase3aGptReviewPacket` reserves:

source turns, stored summary/episodes, retrieval candidates, injected text, final-wire, model response, missing facts, wrong time/actor/relation/ownership, ungrounded memory, tokens/USD/finish reason, SHA, provenance.

`cursorQualityScore` is always null. GPT scores Korean naturalness, relationship/emotion, scene continuity, and dialogue balance later.

## AFTER

Plan constant + packet shape + provider-free assembly of a Path A 6-turn final-wire. No execute helper. No new memory owner. No prompt or pricing change.

## REMOVED

Nothing from Phase 1–2C. No one-shot paid runner added.

## PRESERVED

Phase 1 / 2A / 2B / 2C evidence, Phase 2B fixture, Phase 2C Luna text/usage, `summary5_raw4`, RAW4, 10,000 LTM, production prompt, billing policy, character/user/chat isolation, current-state retrieve priority.

## REGRESSION RISKS

CI now runs the Phase 3A preflight next to Phase 1/2B/provenance. The new files must not import a paid execute path.

## PROOF

- Local `data/app.db` character ids 1–9; no 라이크 18 / 렌 persona
- `MAIN_RP_MODEL_IDS` = 4 live picker ids
- Phase 3A plan `providerPosts: 0`, `paidEvaluationApproved: false`
- Path A pass helper returns false for Path B
- `git diff --check`, `npm run lint`, `npm run typecheck:app`

## SYSTEM DELTA

Preflight labels and a GPT packet schema on the existing provenance owner. Shared Phase 1/2B fixtures reused. No production summary-owner, prompt, provider, or cost-policy change.

## FOLLOW-UP (not this PR)

Separately approved Path A 8-call Main RP experiment; optional 6-turn Path B-lite using the archived Luna sample; Path B-full only with a new quantified approval; Railway hash probe for production identity; CURRENT_PRODUCTION_PARITY only after observed runtime SHA + sheet read.

## STOP

Draft PR. Do not merge. Do not call providers.
