# SceneDirective V2 / Living Feature-Flag Contract Audit Report

**Main SHA (verified at start):** `8b74e5cc242acfee7872f30955fe6553946ef053`
**Branch:** `cursor/scene-directive-v2-owner-contract-aa40`
**Status:** `ROOT_CAUSE_FIXED`

---

## BEFORE

| Mode | Selected owner (`resolveScenePacingPromptOwner`) | Rendered block (no canary) | UI (`generationPreparationUi`) |
|------|--------------------------------------------------|----------------------------|----------------------------------|
| V2=off | legacy_v1 | legacy_v1 | legacy_v1 |
| V2=shadow | legacy_v1 | legacy_v1 | legacy_v1 |
| V2=on | event_restraint_v2 | **legacy_v1 (bug)** | event_restraint_v2 |
| Living on | living_continuity_director | **legacy_v1 (bug)** | living_continuity_director |
| V2=on + canary | event_restraint_v2 | event_restraint_v2 | event_restraint_v2 |

`rpDiagnosticCanary` outer conditional owned **owner selection**, not just transform.

---

## PROBLEM

**CONFIRMED split-brain:** When `SCENE_DIRECTIVE_V2_MODE=on` or Living enabled, policy/UI selected V2/Living but non-canary requests rendered legacy v1.2 block.

---

## ROOT CAUSE

**H1 CONFIRMED** — `rpDiagnosticCanary` gated owner-based render; non-canary path always called `renderSceneDirectiveForPrompt(sceneDirectiveForRender)`.

**H2 REJECTED** — Policy, `.env.example`, and comments agree: `on` means inject V2.

**H3 CONFIRMED** — generationPreparationUi used V2/Living while prompt used v1.

**H4 PARTIAL** — V2 on committed production reconvergence namespace while prompt was v1 (pre-fix). Fixed by aligning prompt with owner.

**H5 CONFIRMED** — Same root cause as H1 for Living.

**H6 CONFIRMED** — Canary is transform-only (`applyRpDiagnosticToSceneDirectiveBlock`); route wrongly used it as selection gate.

---

## AFTER

**Contract:**

```
resolveScenePacingPromptOwner (once)
  → materializeSceneDirectivePromptBlock (once)
  → optional applyRpDiagnosticToSceneDirectiveBlock (transform only)
  → contextBuildInput.scenePacingPromptOwner + sceneDirectiveBlock
  → skipMotionCue when experiment owner
  → generationPreparationUi (same scenePacingOwner)
```

| Mode | promptOwner | computeOwner |
|------|-------------|--------------|
| off | legacy_v1 | — |
| shadow | legacy_v1 (or Living if enabled) | V2 shadow |
| on | event_restraint_v2 | V2 production namespace |

---

## OWNER MAP

| Role | Owner |
|------|-------|
| V2_MODE_OWNER | `getSceneDirectiveV2Mode` / `SCENE_DIRECTIVE_V2_MODE` |
| V2_COMPUTE_OWNER | `isSceneDirectiveV2ComputeEnabled` |
| V2_INJECT_OWNER | `isSceneDirectiveV2InjectEnabled` (= mode `on`) |
| SCENE_PACING_SELECTION_OWNER | `resolveScenePacingPromptOwner` |
| SCENE_PROMPT_RENDER_OWNER | `materializeSceneDirectivePromptBlock` |
| CANARY_TRANSFORM_OWNER | `applyRpDiagnosticToSceneDirectiveBlock` |
| GENERATION_PREPARATION_UI_OWNER | `scenePacingOwner` (same selection) |
| RECONVERGENCE_NAMESPACE_OWNER | `sceneDirectiveV2Inject ? "production" : "shadow"` |
| RECONVERGENCE_COMMIT_OWNER | `commitReconvergenceTransition` (post-finalize) |
| TELEMETRY_OWNER | `logSceneDirectiveV2Telemetry` |
| LEGACY_V1_PROMPT_OWNER | v1.2 when owner=`legacy_v1` |
| LIVING_ENABLE_OWNER | `isLivingSceneDirectiveV2EnabledForUser` |

---

## REMOVED

Duplicate owner-selection branch inside `rpDiagnosticCanary` conditional (replaced by materialize + transform).

---

## PRESERVED

- Railway default OFF (no env changes)
- Standard COMPACT_SUFFICIENT when V2/Living off
- Auto / Simulation v1.2 when experiment off
- V2/Living modules + reconvergence stack
- NPC grounding, dialogue budget, length, billing, provider calls, DB schema
- TRPG / party untouched

---

## REGRESSION RISKS

| Risk | Mitigation |
|------|------------|
| Accidental V2 rollout | Env unchanged; C12 Railway-like default |
| Shadow inject | C2 — inject disabled, legacy prompt |
| Dual prompt | C9 — skipMotionCue + owner count |
| UI/prompt split | C10 — same owner field |
| Regen divergence | C13 — scenePacingPromptOwner in contextBuildInput |

---

## PROOF

- C1–C14: `src/lib/sceneDirectiveOwnerContractAudit.test.ts` (15 tests)
- C3 pre-fix FAIL / post-fix PASS reproduced
- Q/O/P/F/W/D suites pass
- lint + typecheck:app + build pass

**Final status: `ROOT_CAUSE_FIXED`**
