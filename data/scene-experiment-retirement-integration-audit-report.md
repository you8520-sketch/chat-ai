# Scene Experiment Retirement / Integration Decision Audit

**Main SHA (verified at start):** `e1e4ff18bd810b3e74e66852694a50ece258c496`  
(contains PR #927 `1050b5f1` owner-contract fix)  
**Branch:** `cursor/scene-experiment-retirement-audit-aa40`  
**Type:** Architecture / experiment decision audit — **no deletion, no rollout**  
**Status:** `NEEDS_PROVIDER_EVIDENCE`

---

## BEFORE

Three scene-policy systems coexist on main:

| System | Activation (Railway prod) | Production role today |
|--------|---------------------------|------------------------|
| **SceneDirective v1.2** | Always | Canonical motion, grounding, progression commit, Standard `[SCENE PACING]` / Auto-Sim full block |
| **sceneDirectiveV2** | `SCENE_DIRECTIVE_V2_MODE` unset → **off** | Experiment: compute/telemetry/reconvergence when `shadow`/`on` |
| **livingSceneDirective** | Living env vars **absent** → **off** | Experiment: Continuity Director when allowlisted |

PR #922–#927 fixed owner convergence, compact Standard, party wiring audit, dead wrappers, and V2/Living prompt owner split-brain.

---

## CAPABILITY MAP (responsibility × system)

| Responsibility | v1.2 | V2 | Living |
|----------------|------|-----|--------|
| MOTION_DECISION | **CANONICAL** | DUPLICATE (pacingDecision) | NOT_PRESENT |
| STAGNATION | **CANONICAL** | PARTIAL_OVERLAP (axes) | DUPLICATE (repetitionRisk) |
| SCENE_KIND | **CANONICAL** | NOT_PRESENT | NOT_PRESENT |
| SCENE_PHASE | NOT_PRESENT | NOT_PRESENT | **UNIQUE** |
| SCENE_ENERGY | NOT_PRESENT | NOT_PRESENT | **UNIQUE** (prompt-internal) |
| CAST_FOCUS | **CANONICAL** | NOT_PRESENT | NOT_PRESENT |
| NPC_GROUNDING | **CANONICAL** (entity evidence) | PARTIAL_OVERLAP (lexical) | NOT_PRESENT |
| NEW_NPC_PERMISSION | **CANONICAL** (npcGrounding) | DUPLICATE (allowNewNpc=false) | NOT_PRESENT |
| EXTERNAL_EVENT_PERMISSION | PARTIAL (progression/motion) | **UNIQUE** (allowNewExternalMessage) | NOT_PRESENT |
| NEW_MESSAGE_PERMISSION | NOT_PRESENT | **UNIQUE** (explicit flag) | NOT_PRESENT |
| NEW_ORDER_PERMISSION | NOT_PRESENT | **UNIQUE** (allowNewOrderOrSchedule) | NOT_PRESENT |
| PROGRESSION_SELECTION | **CANONICAL** (weighted RNG) | DUPLICATE (deterministic rules) | DUPLICATE (Living taxonomy) |
| PROGRESSION_HISTORY | **CANONICAL** (scene_progression_state) | NOT_PRESENT | NOT_PRESENT |
| TRIGGER_PRIORITY | **CANONICAL** | DUPLICATE (resolve_trigger) | DUPLICATE (TRIGGERED_EVENT phase) |
| USER_AGENCY | **CANONICAL** | DUPLICATE | DUPLICATE |
| NEXT_BEAT_STEERING | **CANONICAL** (nextBeatHint) | DUPLICATE | DUPLICATE |
| EVENT_BUDGET | NOT_PRESENT | **UNIQUE** (0\|1) | NOT_PRESENT |
| RECONVERGENCE | NOT_PRESENT | **UNIQUE** (stateful lifecycle + DB) | NOT_PRESENT |
| REPETITION_CONTROL | **CANONICAL** (stagnation) | PARTIAL_OVERLAP | DUPLICATE |
| DIALOGUE_PRESSURE | NOT_PRESENT | UNIQUE (field always `none`) | NOT_PRESENT |
| PROMPT_RENDER | **CANONICAL** (ENGINE / PACING wire) | UNIQUE marker (PACING RULE) | UNIQUE marker (CONTINUITY RULE) |
| PROMPT_OWNER_SELECTION | **CANONICAL** (default) | EXPERIMENT gate | EXPERIMENT gate |
| TELEMETRY | progression meta | **UNIQUE** (V2 JSON telemetry) | NOT_PRESENT |
| STATE_PERSISTENCE | progression history | **UNIQUE** (reconvergence tables) | NOT_PRESENT |

---

## UNIQUE CAPABILITIES

### V2 only (structurally proven)

| Capability | Classification |
|------------|----------------|
| Two-turn reconvergence lifecycle + hooks + due clock | **UNIQUE_AND_RUNTIME_RELEVANT** (when flag on) |
| `chat_reconvergence_state` / shadow + transition log | **STATEFUL_BUT_VALUE_UNPROVEN** |
| Explicit `eventBudget` 0\|1 | **UNIQUE_BUT_EXPERIMENTAL** — overlaps v1 motion intent post-#922 |
| `allowNewExternalMessage` / `allowNewOrderOrSchedule` | **UNIQUE_BUT_EXPERIMENTAL** |
| `reasonCodes[]` / `groundingSources[]` | **DIAGNOSTIC_ONLY** |
| `dialoguePressure` | **DIAGNOSTIC_ONLY** (always `none` in build) |

### Living only (structurally proven)

| Capability | Classification |
|------------|----------------|
| `scenePhase` (8 values) | **UNIQUE_BUT_EXPERIMENTAL** — affects Living progression/hints |
| `sceneEnergy` | **UNIQUE_BUT_EXPERIMENTAL** — internal; not in prompt |
| `eventSource` + `eventSourceEvidence` | **UNIQUE_BUT_EXPERIMENTAL** |
| `repetitionRisk` | **REDUNDANT_WITH_V1** (stagnation overlap) |
| Living progression taxonomy (8 types) | **REDUNDANT_WITH_V1** after `livingToLegacyProgression` |
| Multi-character phase hints | **UNIQUE_BUT_EXPERIMENTAL** — General Chat party **FEATURE_NOT_PRESENT** |

### v1.2 already owns (experiments duplicate)

- Motion (`HOLD`/`MICRO`/`SCENE_ADVANCE`/`ESCALATE`)
- NPC grounding (#922 entity evidence)
- Cast focus / simulation mode
- Progression history commit
- Execution contract / compact Standard pacing wire

---

## VOCABULARY DELTA

| Concept | v1.2 | V2 | Living | Same? | Conversion |
|---------|------|-----|--------|-------|------------|
| Hold quiet beat | HOLD | hold_current_beat | QUIET_CONTINUITY | Partial | None official |
| Advance scene | SCENE_ADVANCE / ESCALATE | advance_existing_beat | ACTIVE_SCENE | Partial | None |
| Trigger | trigger in lore/events | resolve_trigger | TRIGGERED_EVENT | Partial | None |
| Reunion | (none) | reconverge | (none) | **Different** | None |
| Stagnation | recentStagnation + reasons | stagnation axes | repetitionRisk | Partial | None |
| Progression | 9-type weighted | rule-based subset | 8-type Living | Partial | **livingToLegacyProgression** (route only) |

**Translation layers found:** `livingToLegacyProgression` — inline in `route.ts` only. Maps 8 Living types → ≤3 legacy types with **lossy collapse** (e.g. `future_intent` → `relationship`).

---

## V2 EVENT RESTRAINT vs v1.2 (#922–#924)

**Verdict: PARTIAL overlap — not fully redundant**

Post-#922 v1.2 has strong NPC grounding and motion gating. V2 still adds:

- Explicit per-turn **eventBudget** cap in prompt prose
- Hard **allowNewNpc / allowNewExternalMessage / allowNewOrderOrSchedule** flags in directive object
- Different prompt semantics on quiet scenes (v1 may still list progression types; V2 often `(none)` + hold)

**Classification:** `V2_EVENT_RESTRAINT_PARTIALLY_REDUNDANT` — restraint *intent* overlaps; *representation* and explicit permission flags differ.

---

## V2 RECONVERGENCE

**Verdict: structurally UNIQUE — v1.2 has no equivalent**

Trace: parting detection → `separation_pending`/`separated` → due turn (+2) → hook validation → `reconverge` offer → `commitReconvergenceTransition` (production/shadow namespace).

**WITHOUT_RECONVERGENCE (v1.2):** no lifecycle state, no due clock, no grounded return method picker.

**WITH_RECONVERGENCE (V2):** deterministic state transitions; fixture X8 shows non-`together` lifecycle affects pacing.

**Product value:** **UNPROVEN** — no production telemetry rows (Railway env off). Repo has offline fixture diffs (`data/scene-directive-v2-fixture-diff.txt`) only.

---

## LIVING CONTINUITY

**Verdict: mostly REDUNDANT_WITH_V1 at runtime; UNIQUE vocabulary only**

- `scenePhase` / `eventSource` change Living internal progression selection and prompt prose
- After `livingToLegacyProgression`, UI metadata collapses to legacy progression types
- No DB state; no progression history fork
- Multi-character hints **not connected** to General Chat party (FEATURE_NOT_PRESENT)

**Classification:** `LIVING_CONTINUITY_MOSTLY_REDUNDANT` — phase taxonomy is **UNIQUE_BUT_EXPERIMENTAL**, not proven necessary vs v1.2 motion contract.

---

## STATE / DB COST

| Artifact | Writer | Reader | Rows in prod |
|----------|--------|--------|--------------|
| `scene_progression_state` | v1.2 commit | v1.2 load | Yes (normal chats) |
| `chat_reconvergence_state` | V2 finalize | V2 compute | Unlikely (env off) |
| `chat_reconvergence_shadow_state` | V2 shadow | V2 shadow load | Test/shadow only |
| `chat_reconvergence_transition_log` | V2 commit | diagnostics | Unlikely |

**No DB changes this PR.**

---

## PROMPT COST (render-only, quiet fixture E1)

Approximate from `sceneExperimentDecisionAudit.test.ts`:

| Renderer | ~chars | marker |
|----------|--------|--------|
| v1.2 full | ~400–550 | `[PRIVATE SCENE ENGINE RULE]` |
| V2 full | ~450–600 | `[PRIVATE SCENE PACING RULE]` |
| Living full | ~400–500 | `[PRIVATE SCENE CONTINUITY RULE]` |

Standard production uses **compact `[SCENE PACING]`** (~much smaller) — not full v1 block.

---

## MAINTENANCE SURFACE (raw counts)

| Component | Source LOC | Test LOC | Route refs |
|-----------|------------|----------|------------|
| v1.2 core | 1307 | ~1450 (regression+weighted+primary) | Always |
| V2 + policy | 887 + 84 | ~1328 | ~28 in route |
| reconvergence | 1003 + 107 schema | in lifecycle tests | commit on finalize |
| Living + policy | 527 + 61 | 102 | ~28 in route |
| Audit fixtures | — | C/D/W/X suites | — |

**OFF-cost remains:** route branching, dual build paths, policy modules, reconvergence schema, 5+ test files, env docs, translation helper.

---

## EXISTING QUALITY EVIDENCE

| Source | Exists? | Notes |
|--------|---------|-------|
| Production V2 telemetry | **NO** | Railway env absent |
| Production reconvergence rows | **NO** (expected) | env off |
| Living canary output | **NO** | env absent |
| Offline fixture diffs | **YES** | `data/scene-directive-v2-fixture-diff.txt` |
| Premerge audit docs | **YES** | `data/scene-directive-v2-*.txt` |
| Provider A/B quality study | **NO** | |

**`NO_BEHAVIORAL_QUALITY_EVIDENCE`** for production rollout or retirement quality judgment.

---

## HYPOTHESES

| ID | Verdict |
|----|---------|
| H1 V2 event restraint now redundant | **PARTIAL** — intent overlaps; explicit flags/budget differ |
| H2 V2 reconvergence truly unique | **CONFIRMED** (structural) |
| H3 Living continuity redundant | **PARTIAL** — progression collapses to legacy; phase vocabulary unique |
| H4 Living scene phase unique value | **INSUFFICIENT_EVIDENCE** |
| H5 both experiments should remain | **REJECTED** as retirement blocker — not proven necessary |
| H6 absorb small capabilities then retire | **PARTIAL** — reconvergence is absorption candidate |
| H7 quality evidence required | **CONFIRMED** |

---

## RETIREMENT / INTEGRATION CLASSIFICATION

### sceneDirectiveV2

**`ABSORB_CAPABILITY_THEN_RETIRE`** (reconvergence only) + **`NEEDS_PROVIDER_EVIDENCE`** (full retirement)

Rationale: Event restraint largely overlaps v1.2 post-#922; reconvergence is the only clearly non-v1 stateful capability. Cannot prove reconvergence product value without provider/canary data.

### livingSceneDirective

**`RETIREMENT_CANDIDATE`**

Rationale: No unique persistence; progression maps lossily to v1 types; no production activation; multi-character value unlinked to shipped product.

---

## REMOVAL PLAN (not executed this PR)

| Item | Classification | Condition before action |
|------|----------------|----------------------|
| V2 event restraint module | RETIRE_WITH_SYSTEM | Provider evidence shows no gain over v1.2 |
| V2 reconvergence | ABSORB_FIRST | Design v1.2 reconvergence owner; migrate state readers |
| `chat_reconvergence_*` tables | RETIRE_WITH_SYSTEM | Zero production rows + no shadow consumers |
| Living Continuity Director | RETIRE_WITH_SYSTEM | Confirm no allowlisted users in any env |
| `livingToLegacyProgression` | RETIRE_WITH_SYSTEM | Living retired |
| Route experiment branches | RETIRE_WITH_SYSTEM | Flags removed after absorption/retirement decision |

---

## PRESERVED

Default v1.2 production, Standard compact, Auto/Sim full block, NPC grounding, dialogue budget, length, regen, recovery, provider calls, billing, DB schema, TRPG, party state.

---

## REGRESSION RISKS (future retirement)

Premature loss of reconvergence; lost Living parting hints; duplicate owner if absorption sloppy; orphaned DB rows; prompt inflation if experiments kept indefinitely.

---

## PROOF

- `src/lib/sceneExperimentDecisionAudit.test.ts` — X1–X15 structural fixtures (19 tests)
- Existing C/D/W/Q/O/P suites unchanged
- Source: `sceneDirective.ts`, `sceneDirectiveV2.ts`, `livingSceneDirective.ts`, `reconvergenceState.ts`, `route.ts`
- Offline: `data/scene-directive-v2-fixture-diff.txt`

**Final status: `NEEDS_PROVIDER_EVIDENCE`**
