# Scene Owner Convergence Audit Report

**Main SHA (verified at start):** `7a1ecb20fe66f0eace48b889cd8853a4afc9d88a`
**Branch:** `cursor/scene-owner-convergence-audit-aa40`
**Baseline:** SceneDirective v1.2 merged via PR #922
**Status:** `ROOT_CAUSE_FIXED` (owner convergence + lossless projection + directive propagation)
**Standard SceneDirective production ON:** **NO** (foundation only)

---

## 0. VERIFIED BASELINE

- `git fetch origin main` → `7a1ecb20fe66f0eace48b889cd8853a4afc9d88a`
- SceneDirective v1.2 pipeline: `resolveSceneMotionDecision → resolveNpcGrounding → selectProgressionTypesWeighted → execution contract → render`
- Q1–Q32 regression pack present
- Standard SceneDirective block injection remains OFF (`contextBuilder.pushSceneDirective` gate)

---

## 1. OWNER MAP

| Key | Canonical Owner | Production Path |
|-----|-----------------|-----------------|
| **STANDARD_MOTION_DECISION_OWNER** | `sceneDirective.buildSceneDirective` (computed every turn) | Route always builds; **prompt** via `[SCENE PACING]` mapped from directive |
| **STANDARD_PROMPT_MOTION_OWNER** | `scenePacingController.renderCompactScenePacingCue` (presentation only) | `openRouterAdult → applyProductionServerControlsToMessages` replaces `[SCENE FLOW]` |
| **AUTO_MOTION_OWNER** | `sceneDirective` (`mode: auto_progression`) | Injected `[3d] Private scene directive` block |
| **SIMULATION_MOTION_OWNER** | `sceneDirective` (`contentKind: simulation`) | Injected block; `skipMotionCue: true` on wire |
| **PARTY_MOTION_OWNER** | `sceneDirective` (when `party: true`) | **Implemented but unwired** in `route.ts` (`party: false` hardcoded) |
| **SCENE_KIND_OWNER** | `sceneDirective.resolveSceneKind` | Shared import; pacing reads via directive |
| **STAGNATION_OWNER** | `sceneDirective.analyzeStagnation` | Single source; pacing delegates |
| **NPC_GROUNDING_OWNER** | `sceneDirective.resolveNpcGrounding` | Entity evidence only (post-#922) |
| **CAST_ELIGIBILITY_OWNER** | `sceneDirective.resolveSceneCastFocus` + `resolveActiveSpeakingCast` | Route passes cast names; party unwired |
| **TRIGGER_OWNER** | `sceneDirective` motion + `resolveNpcGrounding` trigger_named | Trigger text from route |
| **EXTERNAL_COOLDOWN_OWNER** | `scenePacingController.isExternalCooldownActive` (reads committed history) | History written from `sceneDirective.progressionTypes` |
| **PROGRESSION_HISTORY_OWNER** | `sceneDirective.progressionTypes` → `commitSceneProgressionState` | Route finalize; **not** `progressionTypesForCommit` |
| **DIALOGUE_BUDGET_OWNER** | `scenePacingController` Arm V terminal budget | User turn `[이번 응답 대화]` |
| **DIRECT_SPEECH_CEILING_OWNER** | `scenePacingController.resolveTerminalDialogueBudget` | Presentation layer |
| **SCENE_FLOW_OWNER** | `generationProcessBeatFlow.SCENE_FLOW_BLOCK` | Formatting/beat flow in prose style |
| **RESPONSE_LENGTH_OWNER** | `responseLength.USER_TAIL_LENGTH_OWNER_SENTENCE` | User turn tail (unchanged) |

### scenePacingController export classification

| Export | Classification |
|--------|----------------|
| `applyProductionServerControlsToMessages` | **PRODUCTION** (wire) |
| `resolveScenePacingDecision` | **PRODUCTION** (delegates motion to SceneDirective) |
| `mapSceneMotionDecisionToPacingLevel` | **PRODUCTION** (presentation map) |
| `renderCompactScenePacingCue` | **PROMPT_RENDER** |
| `resolveTerminalDialogueBudget` | **DIALOGUE_BUDGET** |
| `resolveCommunicationDemand` | **DIALOGUE_BUDGET** |
| `appendTerminalDialogueBudgetToUserTurn` | **DIALOGUE_BUDGET** |
| `applyScenePacingArmToMessages` | **PRODUCTION** (wire helper) |
| `resolveScenePacingMode` | **DIALOGUE_BUDGET** (presentation bucket for budget/heuristics) |
| `detectIntimateDyad` | **DIALOGUE_BUDGET** |
| `isExternalCooldownActive` | **MOTION_POLICY** (history gate; reads directive commits) |
| `resolveSceneStateAuthority` | **HARNESS_ONLY** (Arm R; not production Arm V) |
| `renderCompactSceneStateEnvelope` | **HARNESS_ONLY** |
| `progressionTypesForCommit` | **DEAD** (no production caller) |
| `resolveNpcActionEligible` | **REMOVED** (was duplicate lexical grounding) |
| `NPC_GROUND_TERMS` | **REMOVED** |
| Arms A/P/Q/R/T/U | **HARNESS_ONLY** (contrast matrix in tests) |
| Arm V | **PRODUCTION** |

---

## 2. FINAL PROMPT INVENTORY

| Path | SceneDirective block | [SCENE PACING] | [SCENE FLOW] | Dialogue budget | Length rule |
|------|---------------------|----------------|--------------|-----------------|-------------|
| Standard interactive | 0 | 1 (replaces FLOW) | 0 | 1 (user tail) | 1 (user tail) |
| Standard regen | 0 | 1 | 0 | 1 | 1 |
| Auto progression | 1 | 0 (`skipMotionCue`) | 1 (baseline in style, not replaced) | 1 | 1 |
| Auto regen | 1 | 0 | 1 | 1 | 1 |
| Simulation | 1 | 0 | 1 | 0 (ensemble uncapped) | 1 |
| Party (when wired) | 1 | 0 | 1 | 0 | 1 |

**Duplicate motion rule (before fix):** Standard path computed motion in both `resolveScenePacingDecision` and `buildSceneDirective`; auto/sim injected SceneDirective block **and** `[SCENE PACING]`.

**After fix:** One motion policy computation (`buildSceneDirective`); presentation layer maps to compact cue or skips when block owns motion.

---

## 3. HYPOTHESIS AUDIT

| ID | Hypothesis | Verdict | Evidence |
|----|------------|---------|----------|
| **H1** | Dual motion owner in production | **CONFIRMED → FIXED** | Standard: parallel trees pre-fix; auto/sim: block + pacing cue |
| **H2** | Pacing motion dead in standard | **REJECTED** | `applyProductionServerControlsToMessages` wired in `openRouterAdult.ts`; file comment was stale |
| **H3** | [SCENE PACING] is standard motion prompt | **CONFIRMED** | Replaces `[SCENE FLOW]` in system message |
| **H4** | Lexical NPC grounding in pacing | **CONFIRMED → FIXED** | Removed `resolveNpcActionEligible` / `NPC_GROUND_TERMS`; pacing follows `npcGrounding` |
| **H5** | Duplicate stagnation decisions | **REJECTED** | Same `detectSceneStagnation` / `analyzeStagnation`; pacing now reads directive output |
| **H6** | Dialogue budget breaks on motion delegation | **REJECTED** | O4 fixture: cap 4 preserved; S12 negotiation budget ≥ 5 |
| **H7** | Compact [SCENE PACING] widens canonical permission | **CONFIRMED → FIXED** | P1–P7 + O6–O10: final Standard prompt preserves execution contract |
| **H8** | Fallback directive not propagated to compact renderer | **CONFIRMED → FIXED** | O11–O13: ONE REQUEST = ONE MATERIALIZED CANONICAL DIRECTIVE |

---

## 3c. P0 — FALLBACK CANONICAL DIRECTIVE NOT PROPAGATED (fixed)

### Invariant

`ONE REQUEST = ONE MATERIALIZED CANONICAL DIRECTIVE = SAME OBJECT FOR DECISION + PROMPT PROJECTION`

### BEFORE

`resolveScenePacingDecision()` built a fallback `SceneDirective` when `canonicalSceneDirective` was omitted, but `applyProductionServerControlsToMessages()` passed only `input.canonicalSceneDirective ?? undefined` to `applyScenePacingArmToMessages()`. Decision and compact renderer diverged → `cue=null` → Standard `[SCENE PACING]` missing.

### AFTER

Production boundary materializes once:

```typescript
const canonicalSceneDirective =
  input.canonicalSceneDirective ??
  buildSceneDirective(pacingInputToSceneDirectiveInput(pacingInput));
```

Same object passed to both `resolveScenePacingDecision` and `applyScenePacingArmToMessages`. Prebuilt directive is never rebuilt.

### Production callsite audit

| Caller | Passes `canonicalSceneDirective`? | Notes |
|--------|-----------------------------------|-------|
| `route.ts` → `sceneServerControls` | **Yes** (`legacySceneDirective`) | Primary production path |
| `openRouterAdult.ts` | Spreads `sceneServerControls` from route | No separate build |
| `deepseekV4ProP0Audit.test.ts` | **No** (harness) | Fixed by boundary materialization |
| `sceneOwnerConvergence.test.ts` | Mixed (O11 tests omit) | Fixed by boundary |

No per-caller workaround added — canonicalization owner stays at `applyProductionServerControlsToMessages`.

---

## 3b. P0 — LOSSY CANONICAL POLICY PROJECTION (fixed)

### Invariant

`PROMPT_PERMISSION must never be broader than CANONICAL_POLICY`

### BEFORE (pre-fix compact renderer)

`renderCompactScenePacingCue` mapped HOLD/MICRO/ADVANCE/ESCALATE → HOLD/AMBIENT/LOCAL/EXTERNAL and emitted generic sentences:

- HOLD: "주변 인물·환경의 짧은 반응이나 작은 마찰..."
- MICRO: "주변 인물·환경의 짧은 변화..."

`progressionTypes`, `npcGrounding.existingNpcEligible`, `eligibleActorNames`, `newNpcAllowed` were **dropped** from the final Standard prompt — re-allowing ungrounded NPC/world motion without entity evidence.

### ROOT CAUSE (projection)

Compact renderer owned its own motion wording + 4-level map instead of consuming the canonical execution contract from #922. Two render paths diverged: full SceneDirective block vs compact cue.

### AFTER (lossless projection)

Shared canonical helpers in `sceneDirective.ts`:

- `renderSceneMotionBody(motionDecision)` — motion body text
- `renderSceneExecutionContract({ motionDecision, progressionTypes, npcGrounding })` — permission boundary

`renderCompactScenePacingCue(directive)` now returns:

```
[SCENE PACING]
{renderSceneMotionBody}
{renderSceneExecutionContract}
```

Full renderer (`renderSceneDirectiveForPrompt`) and compact renderer consume the **same** contract — no duplicate prompt-rule builder in scenePacingController.

### REQUIRED CLEANUP (this PR)

| Item | Disposition |
|------|-------------|
| Generic HOLD "주변 인물" wording | **REMOVED** |
| Generic MICRO "주변 인물" wording | **REMOVED** |
| LOCAL/EXTERNAL source widening in compact cue | **REMOVED** (contract lists allowed progression labels only) |

### FOLLOW-UP (not blocking)

| Item | Disposition |
|------|-------------|
| `carrierHints` duplication on pacing decision | **FOLLOW-UP** (presentation metadata; not prompt-exposed) |
| `primaryProgression` on pacing decision | **FOLLOW-UP** (commit uses directive.progressionTypes) |
| `externalEligible` on pacing decision | **FOLLOW-UP** (derived from directive motion) |
| `resolveSceneStateAuthority` LOCAL/EXTERNAL domains | **FOLLOW-UP** (Arm R harness only) |

---

## 4. TARGET ARCHITECTURE (achieved foundation)

```
SceneDirective v1.2     = CANONICAL SCENE MOTION POLICY
scenePacingController   = DIALOGUE / PRESENTATION BUDGET + compact cue render
SCENE FLOW              = formatting only (replaced by [SCENE PACING] on standard)
```

Standard activation deferred to follow-up PR (no feature flag added).

---

## 5. SCENEPACING LEGACY CLASSIFICATION

| Item | Disposition |
|------|-------------|
| `SceneMotionLevel` | **KEEP** (presentation map target) |
| `SceneStateAuthority` | **FOLLOW-UP** (Arm R harness only) |
| `ExternalContinuity` | **FOLLOW-UP** (Arm R harness only) |
| `resolveNpcActionEligible` | **SAFE TO DELETE** (removed) |
| `NPC_GROUND_TERMS` | **SAFE TO DELETE** (removed) |
| `carrierHints` / `primaryProgression` on decision | **MOVE TO CANONICAL OWNER** (from directive) |
| `externalEligible` | **MOVE TO CANONICAL OWNER** (derived from directive motion) |
| `ensemble_legacy_freedom` branch | **SAFE TO DELETE** (removed with parallel tree) |
| `progressionTypesForCommit` | **DEAD** (keep for harness tests only) |
| Arms A/P/Q/R/T/U | **KEEP** (harness contrast) |
| Arm V dialogue budget | **KEEP** (production) |
| `TerminalDialogueBudgetResolution` | **KEEP** |
| `resolveCommunicationDemand` | **KEEP** |

---

## 6. REGRESSION MATRIX (summary)

| Scenario | Expected | Post-fix |
|----------|----------|----------|
| S1 quiet romance | HOLD possible | ✓ (Q1 + O1) |
| S2 user-led | no event stack | ✓ (Q2) |
| S3 stagnation | MICRO/ADVANCE | ✓ (Q4) |
| S5 off-scene NPC | no npc action | ✓ (Q29 + O2) |
| S7 lexical 경비 | no grounding | ✓ (Q10/H3 + O2) |
| S8 remote contact | not arrival | ✓ (Q31) |
| S10 simulation | autonomous contract | ✓ (Q15 + skipMotionCue) |
| S11 auto | min MICRO | ✓ (Q26) |
| S12 dialogue negotiation | budget preserved | ✓ (S12 test) |
| S14 regen | one motion owner | ✓ (O1) |

Full Q1–Q32 unchanged.

---

## 7. OWNER COUNT REGRESSION (O1–O10)

| Check | Standard | Auto/Sim |
|-------|----------|----------|
| O1 motion policy owners | 1 (`[SCENE PACING]`) | 1 (SceneDirective block) |
| O2 NPC grounding | 1 (SceneDirective) | 1 |
| O3 stagnation | 1 | 1 |
| O4 dialogue budget | 1 | 1 |
| O5 response length | 1 | 1 |
| O6 HOLD no-NPC contract in final prompt | ✓ | n/a |
| O7 MICRO no-NPC contract in final prompt | ✓ | n/a |
| O8 progression type does not widen | ✓ | n/a |
| O9 newNpcAllowed=false preserved | ✓ | n/a |
| O10 explicit-arrival=true without widening other paths | ✓ | n/a |
| O11 implicit canonical build inserts Standard pacing | ✓ | n/a |
| O12 explicit/implicit canonical parity | ✓ | n/a |
| O13 auto/sim skipMotionCue duplicate-free | ✓ | ✓ |

### Lossless projection proof fixtures (P1–P7)

| ID | Fixture | Final Standard [SCENE PACING] assertion |
|----|---------|----------------------------------------|
| P1 | HOLD, no NPC | `기존 NPC 행동: 없음`, `새 인물 도입: 없음`; no legacy "주변 인물·환경" |
| P2 | MICRO_MOTION, no NPC | `새 인물·별도 사건은 만들지 않는다`; contract denies NPC |
| P3 | ADVANCE, relationship only | `허용된 변화: 관계 변화` only — no unrelated sources |
| P4 | ADVANCE, npc_action grounded | `기존 NPC (테스트조연)의 행동만` |
| P5 | remote contact | `새 인물 도입: 없음` (no physical arrival) |
| P6 | ESCALATE, no new actor | external pressure separated from new actor intro |
| P7 | ESCALATE, explicit arrival | `새 인물 도입: 트리거·명시적 도착만` |

---

## BEFORE

- Standard prompt motion: parallel `resolveScenePacingDecision` tree + lexical NPC terms
- Auto/sim: SceneDirective block **and** `[SCENE PACING]` duplicate
- DB progression: SceneDirective; prompt motion: pacing controller ( divergent )
- Compact `[SCENE PACING]`: generic HOLD/MICRO "주변 인물·환경" sentences — **lossy projection** dropped execution contract
- Fallback directive built in `resolveScenePacingDecision` but **not propagated** to compact renderer when caller omitted `canonicalSceneDirective`
- File comment claimed pacing "not wired" — **false**

## PROBLEM

1. Confirmed dual motion owner (H1) and lexical NPC conflict with #922 entity grounding (H4).
2. **P0:** Compact Standard renderer projected motion level only; canonical NPC/progression permissions were **broader in prompt than policy** (H7).
3. **Integration:** Implicit canonical build in decision path was not forwarded to compact renderer (H8).

## ROOT CAUSE

1. Historical G10 experiment arms evolved a parallel motion classifier in `scenePacingController` while SceneDirective v1.2 became canonical for auto/sim and DB commits.
2. Compact renderer used a separate 4-level map + generic sentences instead of reusing `renderSceneExecutionContract` from the full renderer.
3. Production wire passed raw `input.canonicalSceneDirective` to arm apply while decision path silently materialized a fallback — **object flow split**.

## AFTER

- `resolveScenePacingDecision` delegates to `buildSceneDirective` / `canonicalSceneDirective`
- `applyProductionServerControlsToMessages` materializes canonical directive **once** at boundary; same object for decision + compact cue
- `renderCompactScenePacingCue(directive)` = shared motion body + shared execution contract (**lossless projection**)
- `skipMotionCue` prevents duplicate motion prompt on auto/sim
- Route passes `canonicalSceneDirective`, `mode`, memory/trigger context
- Standard full SceneDirective block remains **OFF**

## REMOVED

- Parallel motion decision tree (~120 lines)
- `resolveNpcActionEligible` + `NPC_GROUND_TERMS` lexical grounding
- `ensemble_legacy_freedom` bypass
- Generic compact HOLD/MICRO "주변 인물·환경" NPC-widening wording
- Split directive object flow (decision vs renderer)

## PRESERVED

- Standard SceneDirective **block injection OFF**
- Auto / simulation / party contracts
- Dialogue budget Arm V
- Response length owner
- Provider calls / billing unchanged
- Q1–Q32 regression

## REGRESSION RISKS

- Standard `[SCENE PACING]` is longer (includes execution contract lines) — still compact vs full block
- Party path still unwired — follow-up needed before party production test
- External cooldown still reads history shape from directive commits
- `resolveSceneStateAuthority` LOCAL/EXTERNAL domain map still harness-only (not production prompt)

## PROOF

- **211/211** scene-adjacent tests pass (Q1–Q32, O1–O13, P1–P7, S7, S12, scenePacingController, contextBuilder, auto progression)
- `npm run lint`, `typecheck:app`, `build`, `git diff --check` pass
- **One owner:** marker count O1 + auto/sim skipMotionCue
- **Lossless policy projection:** P1–P7 + O6–O10 inspect **final assembled Standard system prompt** — compact permission never broader than canonical policy
- **One materialized directive:** O11–O13 — implicit build inserts Standard pacing; explicit/implicit parity; skipMotionCue still duplicate-free

---

## FOLLOW-UP (separate PR)

- Standard SceneDirective block activation / canary
- Wire `party: true` from character settings
- sceneDirectiveV2 / livingSceneDirective cleanup
- Arm R state envelope evaluation
