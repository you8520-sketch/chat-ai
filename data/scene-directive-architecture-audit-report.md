# SceneDirective Architecture Audit Report

**PR base SHA:** `ddc09580183a5e6fcfb0ee57db08aecc06dbc374`
**Branch:** `cursor/scene-directive-architecture-audit-aa40`
**PR:** [#922](https://github.com/you8520-sketch/chat-ai/pull/922)
**Version:** `world-motion-v1.2`
**Status:** `ROOT_CAUSE_FIXED`

---

## BEFORE — Owner Map (production paths)

| Responsibility | Canonical Owner | Notes |
|---|---|---|
| STANDARD_SCENE_MOTION | `scenePacingController` via `applyProductionServerControlsToMessages` | SceneDirective injection OFF |
| AUTO_PROGRESSION_MOTION | `sceneDirective.ts` | Explicit continue contract |
| SIMULATION_MOTION | `sceneDirective.ts` | Autonomous multi-cast |
| PARTY_MOTION | `sceneDirective.ts` | Cast eligibility only — motion from intensity/stagnation |
| STAGNATION | `analyzeStagnation` | |
| SHOULD_PROGRESS | `resolveSceneMotionDecision` | HOLD is first-class |
| ACTIVE_SPEAKING_CAST | `resolveActiveSpeakingCast` | Current-turn cue / trigger only |
| NPC_GROUNDING | `resolveNpcGrounding` | activeSpeakingCast, user_named, trigger_named |
| PROMPT_RENDER | `renderSceneEngineRule` + `buildExecutionContract` | Single motion-semantics owner |

---

## PROBLEM (iteration 3 gaps)

1. **P0 active cast leak:** `resolveActiveSpeakingCast` scored known supporting names in `recentMessages` (+1). Any prior mention promoted names into `activeSpeakingCast`, which `resolveNpcGrounding` consumed as `PRESENT_ACTOR` evidence.
2. **P1 historical mention:** `namePresentInScene` over `sceneSignalText` (includes full recent history) treated recall/past mentions as scene presence.
3. **P1 remote contact = arrival:** `TRIGGER_ARRIVAL_TERMS` included `연락`/`호출`, so named remote triggers set `newNpcAllowed=true`.
4. **P1 multi-cast bypass:** `npcActionAllowed` used `sceneCastMode !== "single_primary"` as implicit grounding, allowing `npc_action` without entity evidence in party/simulation.

---

## ROOT CAUSE

| ID | Root cause | Canonical fix | Proof |
|---|---|---|---|
| P0 | Recent generic name mention owned activeSpeakingCast | Remove recent scoring in `resolveActiveSpeakingCast`; only current user message (+3) and trigger (+2) | Q29 full `buildSceneDirective` |
| P1 | Scene-signal lexical scan owned presence | Remove `namePresentInScene` / `known_cast_name` path; presence from activeSpeakingCast, user_named, trigger_named only | Q30 |
| P1 | Remote and physical arrival shared term list | Split `TRIGGER_PHYSICAL_ARRIVAL_TERMS`; `newNpcAllowed` requires physical arrival or explicit team pattern | Q31, Q27, Q28, Q9 |
| P1 | Cast mode substituted for grounding | `npcActionAllowed = existingNpcEligible \|\| newNpcAllowed` only | Q32 |

**Pre-fix Q29 reproduction (neutral fixture):**

```
activeSpeakingCast: ["테스트주인공", "테스트조연"]  // BUG
existingNpcEligible: true                           // BUG
```

**Production hardcode audit:** No real character names in `src/lib/sceneDirective.ts` or prompt paths. Names exist only in regression/audit fixtures (now synthetic).

---

## AFTER — Pipeline

```
resolveSceneCastFocus
  → resolveActiveSpeakingCast (current-turn cues only)
  → resolveSceneMotionDecision
  → resolveNpcGrounding (entity evidence only)
  → selectProgressionTypesWeighted (grounding-gated npc_action)
  → renderSceneEngineRule + buildExecutionContract
  → renderSceneDirectiveForPrompt
```

---

## REMOVED

- Recent-message scoring in `resolveActiveSpeakingCast`
- `namePresentInScene` / `known_cast_name` presence path
- `연락` / `호출` from physical arrival terms
- Cast-mode implicit `npcActionAllowed` bypass

---

## PRESERVED

- Standard SceneDirective OFF
- v1.2 motion pipeline (HOLD / MICRO / ADVANCE / ESCALATE)
- SceneProgressionType enum / DB schema unchanged
- No provider / billing / sceneDirectiveV2 / livingSceneDirective changes
- Production uses dynamic `primaryCharacterName`, `knownSupportingCastNames`, `activeSpeakingCast`

---

## REGRESSION PROOF

- Q1–Q32 deterministic fixtures (synthetic names: 테스트주인공, 테스트조연, …)
- weighted, primaryFocus, scenePacingController, contextBuilder, autoProgression — **187/187 PASS**
- `npm run lint`, `npm run typecheck:app`, `git diff --check` — PASS
- `npm run build` (test-safe env) — PASS

---

## REGRESSION RISKS

- Supporting cast no longer auto-selected from prior-turn dialogue; requires current user cue or trigger (intentional conservative policy).
- Scene-signal-only NPC presence (without activeSpeakingCast) no longer grounds `npc_action`; ensemble/simulation must pass established cast via `activeSpeakingCast`.
- Named remote triggers allow existing-NPC consequence paths but not physical new-actor arrival.

---

## FOLLOW-UP

- Standard reactivation review (separate PR)
- sceneDirectiveV2 / livingSceneDirective consolidation (NO TOUCH this PR)
