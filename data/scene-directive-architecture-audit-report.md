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
| NPC_GROUNDING | `resolveNpcGrounding` | Scene presence ≠ lore identity |
| PROMPT_RENDER | `renderSceneEngineRule` + `buildExecutionContract` | Single motion-semantics owner |

---

## PROBLEM (root causes)

1. Forced progression floor + intensity≤1 always pick
2. Lexical NPC grounding without entity presence
3. Cast mode owning motion policy (ensemble → always ADVANCE)
4. HOLD prompt contradicted unconditional BASE rule
5. Lore/memory name treated as scene presence
6. Auto progression could HOLD on quiet continue
7. User-led progress false positives (length, substring, prior turns)

---

## ROOT CAUSE PROOF (iteration 2)

| ID | Issue | Fix | Fixture |
|---|---|---|---|
| P0 | HOLD + mandatory-motion rule coexist | `renderSceneEngineRule(motionDecision)` | Q19 |
| P0 | Lore-only known NPC → eligible | Scene signal only, not groundingText | Q20–Q22 |
| P1 | Cast mode → SCENE_ADVANCE | Party shares single_primary motion policy | Q16, Q25 |
| P1 | Auto quiet → HOLD | Auto always ≥ MICRO | Q26 |
| P1 | Simulation quiet → HOLD | Simulation always ≥ MICRO | Q15 |
| P1 | userLedProgress FP | Current-turn action cues only | Q23, Q24 |
| P1 | newNpcAllowed too broad | Named trigger or explicit arrival class | Q27, Q28 |

---

## AFTER — Pipeline

```
resolveSceneMotionDecision
  → resolveNpcGrounding (KNOWN_ENTITY vs PRESENT_ACTOR)
  → selectProgressionTypesWeighted
  → renderSceneEngineRule + buildExecutionContract
  → renderSceneDirectiveForPrompt
```

---

## PROMPT OWNER INVENTORY

| Removed | Replaced by |
|---|---|
| Static BASE always-motion line | `renderSceneEngineRule(decision)` |
| Duplicate HOLD "허용된 변화" line | Engine rule covers natural continuation |

| Kept | Role |
|---|---|
| `renderSceneEngineRule` | Mandatory-motion semantics (decision-aware) |
| `buildExecutionContract` | Allowed types, NPC, new-intro bounds |
| `nextBeatHint` | Micro guidance when not HOLD |

---

## REGRESSION PROOF

- Q1–Q28 deterministic fixtures
- weighted, primaryFocus, scenePacingController, contextBuilder, autoProgression
- `npm run lint`, `npm run typecheck:app`, `git diff --check`

---

## PRESERVED

- Standard SceneDirective OFF
- SceneProgressionType enum / DB schema
- No provider call changes

---

## FOLLOW-UP

- Standard reactivation review (separate PR)
- sceneDirectiveV2 / livingSceneDirective consolidation (NO TOUCH this PR)
