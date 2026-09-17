# Scene Owner Convergence Audit Report

**Main SHA (verified at start):** `7a1ecb20fe66f0eace48b889cd8853a4afc9d88a`
**Branch:** `cursor/scene-owner-convergence-audit-aa40`
**Baseline:** SceneDirective v1.2 merged via PR #922
**Status:** `ROOT_CAUSE_FIXED`
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

## 7. OWNER COUNT REGRESSION (O1–O5)

| Check | Standard | Auto/Sim |
|-------|----------|----------|
| O1 motion policy owners | 1 (`[SCENE PACING]`) | 1 (SceneDirective block) |
| O2 NPC grounding | 1 (SceneDirective) | 1 |
| O3 stagnation | 1 | 1 |
| O4 dialogue budget | 1 | 1 |
| O5 response length | 1 | 1 |

---

## BEFORE

- Standard prompt motion: parallel `resolveScenePacingDecision` tree + lexical NPC terms
- Auto/sim: SceneDirective block **and** `[SCENE PACING]` duplicate
- DB progression: SceneDirective; prompt motion: pacing controller ( divergent )
- File comment claimed pacing "not wired" — **false**

## PROBLEM

Confirmed dual motion owner (H1) and lexical NPC conflict with #922 entity grounding (H4).

## ROOT CAUSE

Historical G10 experiment arms evolved a parallel motion classifier in `scenePacingController` while SceneDirective v1.2 became canonical for auto/sim and DB commits. Standard path kept pacing wire without delegating to the same policy engine.

## AFTER

- `resolveScenePacingDecision` delegates to `buildSceneDirective` / `canonicalSceneDirective`
- `mapSceneMotionDecisionToPacingLevel` renders compact cue only
- `skipMotionCue` prevents duplicate motion prompt on auto/sim
- Route passes `canonicalSceneDirective`, `mode`, memory/trigger context

## REMOVED

- Parallel motion decision tree (~120 lines)
- `resolveNpcActionEligible` + `NPC_GROUND_TERMS` lexical grounding
- `ensemble_legacy_freedom` bypass

## PRESERVED

- Standard SceneDirective **block injection OFF**
- Auto / simulation / party contracts
- Dialogue budget Arm V
- Response length owner
- Provider calls / billing unchanged
- Q1–Q32 regression

## REGRESSION RISKS

- Standard `[SCENE PACING]` text now tracks SceneDirective motion (may differ from legacy parallel tree on edge cases)
- Party path still unwired — follow-up needed before party production test
- External cooldown still reads history shape from directive commits

## PROOF

- 196/196 scene-adjacent tests pass
- `npm run lint`, `typecheck:app`, `build`, `git diff --check` pass
- `sceneOwnerConvergence.test.ts` — O1–O5, S7, S12

---

## FOLLOW-UP (separate PR)

- Standard SceneDirective block activation / canary
- Wire `party: true` from character settings
- sceneDirectiveV2 / livingSceneDirective cleanup
- Arm R state envelope evaluation
