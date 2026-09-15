# SceneDirective Architecture Audit Report

**Main SHA:** `ce3b726095d79517b8f710e697e1a97970ec5625`  
**Branch:** `cursor/scene-directive-architecture-audit-aa40`  
**Version:** `world-motion-v1.2`  
**Status:** `ROOT_CAUSE_FIXED`

---

## BEFORE — Owner Map (production paths)

| Responsibility | Canonical Owner | Notes |
|---|---|---|
| STANDARD_SCENE_MOTION | `scenePacingController` via `applyProductionServerControlsToMessages` | Injected as `[SCENE PACING]` replacing `[SCENE FLOW]` in `openRouterAdult.ts` |
| AUTO_PROGRESSION_MOTION | `sceneDirective.ts` (`buildSceneDirective`) | Injected when `autoProgressionEnabled` |
| SIMULATION_MOTION | `sceneDirective.ts` | `contentKind=simulation` |
| PARTY_MOTION | `sceneDirective.ts` | `party=true` |
| STAGNATION | `detectSceneStagnation` / `analyzeStagnation` in `sceneDirective.ts` | Standard uses same helper via pacing controller |
| SHOULD_PROGRESS | **missing (v1.1)** | Forced floor always picked ≥1 type |
| INTENSITY | `selectSceneIntensity` | |
| PROGRESSION_TYPE | `selectProgressionTypesWeighted` | |
| NPC_GROUNDING | Lexical `NPC_GROUND_TERMS` only (v1.1) | Not tied to cast names |
| NPC_INTRODUCTION | Implicit via `npc_action` hint | No existing/new split |
| CAST_ELIGIBILITY | `resolveActiveSpeakingCast` (server only) | Not passed to selector |
| COOLDOWN | `cooldownMultiplierForType` + history | Mitigation layer |
| PROMPT_RENDER | `renderSceneDirectiveForPrompt` | |
| PROGRESSION_HISTORY_WRITER | `commitSceneProgressionState` | Post-finalize route |
| PROGRESSION_HISTORY_READER | `loadSceneProgressionState` | Pre-turn route |

**Duplicate owners (standard):** SceneDirective OFF + `scenePacingController` ON — intentional ARM D split, not merged in this PR.

**Parallel experiment systems (not production):** `sceneDirectiveV2.ts`, `livingSceneDirective.ts` — gated OFF by default.

---

## PROBLEM

1. **Forced progression:** `pickCountForIntensity(≤1)=1` + eligibility floor (`environment=1, relationship=1`) meant intensity=0 quiet scenes always received motion.
2. **Lexical NPC grounding:** Generic words (`경비`, `동료`) satisfied `npcGrounded` without named entity evidence.
3. **Scene-kind NPC bypass:** `npcGrounded` gate applied only on `rest/neutral`; `operation/climax` +4 boosts selected ungrounded `npc_action`.
4. **Cast/selector disconnect:** `activeSpeakingCast` / `knownSupportingCastNames` computed but not used in selection.
5. **Mitigation stack masked root cause:** cooldowns, 0.55 multiplier, standard-OFF — symptoms reduced, architecture unchanged.
6. **Stagnation false positives:** `shortUserReplies≥3 && movement≤1` flagged quiet intimacy as stagnation.

Standard SceneDirective was disabled (64d6c47 / contextBuilder ARM D) because forced motion + NPC spam were worse than no directive.

---

## ROOT CAUSE PROOF

| Hypothesis | Result | Evidence |
|---|---|---|
| H1 FORCED_MOTION | **CONFIRMED → FIXED** | Pre-fix: intensity=0 → `[environment]`. Post-fix: `HOLD`, `[]` |
| H2 NPC_WITHOUT_ACTOR | **CONFIRMED → FIXED** | Operation without cast: `npc_action` removed from eligible |
| H3 LEXICAL_NPC_GROUNDING | **CONFIRMED → FIXED** | Generic `경비` alone: `existingNpcEligible=false` |
| H4 EXISTING_VS_NEW_NPC | **PARTIAL → IMPROVED** | Execution contract separates existing NPC vs new intro |
| H5 SLOW_BURN_FALSE_STAGNATION | **CONFIRMED → FIXED** | Short replies alone no longer trigger stagnation |
| H6 MITIGATION_STACK | **CONFIRMED** | Cooldown/multiplier did not remove forced floor |
| H7 DUPLICATE_STANDARD_OWNER | **CONFIRMED (intentional)** | Standard uses pacing controller; SceneDirective OFF |

---

## AFTER — Canonical Pipeline

```
resolveSceneMotionDecision (HOLD | MICRO | ADVANCE | ESCALATE)
  → resolveNpcGrounding (entity evidence)
  → selectProgressionTypesWeighted (no floor, cast-aware)
  → buildExecutionContract
  → renderSceneDirectiveForPrompt
```

**Preserved:** auto/simulation/party injection paths unchanged in routing. Standard remains OFF.

---

## REMOVED

- Forced eligibility floor (`environment=1, relationship=1`)
- Lexical-only NPC grounding for selection
- Rest/neutral-only NPC gate (now all scene kinds)
- Short-reply-only stagnation trigger

## PRESERVED

- Standard SceneDirective injection OFF
- Auto/simulation/party SceneDirective ON
- `SceneProgressionType` enum (DB JSON compatibility)
- Cooldown rotation (now on genuinely eligible candidates only)
- `scenePacingController` for standard path

---

## REGRESSION RISKS

| Risk | Mitigation |
|---|---|
| Quiet RP freeze | HOLD only when intensity=0 + not stagnant + single_primary |
| Under-progression | Stagnation still → MICRO_MOTION; auto_progression never HOLD when stagnant |
| NPC underuse | Named cast + triggers still eligible |
| Event over-escalation | ESCALATE tied to intensity≥4 or trigger |
| Regen divergence | Same seed/version determinism preserved |
| Multi-cast regression | ensemble/simulation always SCENE_ADVANCE |

---

## PROOF

- `src/lib/sceneDirective.regression.test.ts` — Q1–Q18 + H1/H3
- Existing: `sceneDirective.test.ts`, `sceneDirective.weighted.test.ts`, `sceneDirective.primaryFocus.test.ts`
- `scenePacingController.test.ts`, `contextBuilder.assemblyOrder.test.ts`, `autoProgression.prompt.test.ts`
- `npm run lint`, `npm run typecheck:app`, `git diff --check`

---

## Historical Fix Audit (Phase B)

| Commit | Still active? | Root cause fix? | Notes |
|---|---|---|---|
| 407c235 weighted rotation | Yes (auto/sim/party) | No — mitigation | Cooldown/weights only |
| 6e5e837 primary focus | Yes | No — mitigation | 0.55 npc multiplier |
| bafbd098 canary bootstrap | Canary only | No | Relationship priority experiment |
| 64d6c47 standard OFF | Yes | Symptom hide | Removed standard injection; did not fix selector |

---

## STOP / Follow-up

- **Standard reactivation:** Separate review gate (not this PR)
- **sceneDirectiveV2 / livingSceneDirective:** Evaluate merge or delete in follow-up
- **scenePacingController ↔ sceneDirective unification:** Follow-up when standard reactivation planned
