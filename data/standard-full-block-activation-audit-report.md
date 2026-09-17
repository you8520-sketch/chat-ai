# Standard Full SceneDirective Block — Activation Decision Audit

**Main SHA (verified at start):** `d4c268f37d2c290beb25583d6fcd5e290144ab88`  
**Branch:** `cursor/standard-full-block-activation-audit-aa40`  
**Baseline:** PR #923 merged — owner convergence + lossless compact projection + directive propagation  
**Standard full SceneDirective production ON:** **NO** (this audit)  
**Status:** `COMPACT_SUFFICIENT`

---

## 0. VERIFIED BASELINE

```bash
git fetch origin main → d4c268f37d2c290beb25583d6fcd5e290144ab88
```

Foundation on main:

- SceneDirective v1.2 = canonical scene-motion policy
- Standard = lossless compact `[SCENE PACING]` projection (shared motion body + execution contract)
- Auto / Simulation = full SceneDirective block (`contextBuilder.pushSceneDirective` gate)
- ONE REQUEST = ONE MATERIALIZED CANONICAL DIRECTIVE at production boundary
- Standard full block remains OFF (`keepModeSpecificProgression` gate)

---

## 1. CURRENT OWNER MAP

| Key | Canonical Owner | Standard Path |
|-----|-----------------|---------------|
| **MOTION_POLICY_OWNER** | `sceneDirective.buildSceneDirective` | Route builds every turn; wire materializes once |
| **MOTION_PROMPT_OWNER_STANDARD** | `scenePacingController.renderCompactScenePacingCue` | Replaces `[SCENE FLOW]` via Arm V wire |
| **MOTION_PROMPT_OWNER_AUTO** | `sceneDirective.renderSceneDirectiveForPrompt` | Injected `[3d] Private scene directive` |
| **MOTION_PROMPT_OWNER_SIMULATION** | `sceneDirective.renderSceneDirectiveForPrompt` | Same block; `skipMotionCue: true` |
| **USER_AGENCY_OWNER** | `noGodmodding.COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` | contextBuilder `[2b]` / system rules — **not** SceneDirective full |
| **CAST_FOCUS_OWNER** | `sceneDirective.resolveSceneCastFocus` + `resolveActiveSpeakingCast` | Internal + full prompt line only; **not** compact |
| **NPC_GROUNDING_OWNER** | `sceneDirective.resolveNpcGrounding` | Policy internal; **projected** via execution contract |
| **NEW_ACTOR_PERMISSION_OWNER** | `sceneDirective.resolveNpcGrounding.newNpcAllowed` | Projected in execution contract (compact + full) |
| **SCENE_KIND_OWNER** | `sceneDirective.resolveSceneKind` | Internal classifier — not Standard prompt |
| **STAGNATION_OWNER** | `sceneDirective.analyzeStagnation` | Internal; full renders flag only |
| **INTENSITY_OWNER** | `sceneDirective.selectSceneIntensity` | Internal; full renders recommendation only |
| **NEXT_BEAT_OWNER** | `sceneDirective.buildNextBeatHint` | Full renderer only (narrative hint) |
| **DIALOGUE_BUDGET_OWNER** | `scenePacingController` Arm V | User turn `[이번 응답 대화]` |
| **LENGTH_OWNER** | `responseLength.USER_TAIL_LENGTH_OWNER_SENTENCE` | User turn tail |
| **SPEECH_LOCK_OWNER** | `privateSpeechControlBlock` / speech rules | contextBuilder + format rules |

**ONE RESPONSIBILITY = ONE CANONICAL OWNER:** Confirmed for permission boundaries. Full block duplicates some narrative hints but does not own unique permission fields on Standard.

---

## 2. FULL VS COMPACT INFORMATION DELTA

| Field | Full | Compact | Classification |
|-------|------|---------|----------------|
| motion body | `[PRIVATE SCENE ENGINE RULE]` + shared body | `[SCENE PACING]` + shared body | **COMPACT PRESENT** |
| execution contract | yes | yes (identical text) | **COMPACT PRESENT** / **BEHAVIOR CRITICAL** |
| engine rule footer | yes | no | **DIAGNOSTIC ONLY** (reinforcement) |
| mode label | `모드: 일반 RP` | no | **DIAGNOSTIC ONLY** (path-known) |
| scene kind | internal only | internal only | **DIAGNOSTIC ONLY** |
| stagnation flag | `정체 감지:` | no | **DIAGNOSTIC ONLY** |
| recommended intensity | `권장 강도:` | no | **DIAGNOSTIC ONLY** |
| progression types | `전개 방향:` + contract `허용된 변화` | contract only | **REDUNDANT** in full |
| avoid list | `피할 것:` | no | **FULL ONLY** — anti-pattern hint, not permission |
| user control | `유저 조종:` | no | **OTHER STANDARD OWNER** (COLLABORATIVE INTERACTIVE) |
| cast focus line | `직접 발화 중심:` | no | **FULL ONLY** — cast drift hint; NPC **permission** in contract |
| nextBeatHint | `다음 장면 힌트:` | no | **FULL ONLY** — narrative steering, not permission |
| NPC grounding | execution contract | execution contract | **COMPACT PRESENT** |
| new actor permission | execution contract | execution contract | **COMPACT PRESENT** |
| auto ensemble rule | auto only | n/a | **AUTO OWNER** |
| NO FALSE SHARED MEMORY | auto only | n/a | **AUTO OWNER** |
| trigger priority line | full only | no | **REDUNDANT** (trigger text injected elsewhere) |

---

## 3. CRITICAL INVARIANT

**For Standard interactive:** compact must contain every **behavior-critical permission boundary** that full contains.

**Verdict:** **SATISFIED.** Both renderers call the same `renderSceneMotionBody` + `renderSceneExecutionContract`. Full-only lines are diagnostic, redundant, or owned elsewhere.

---

## 4. HYPOTHESES

| ID | Hypothesis | Verdict | Evidence |
|----|------------|---------|----------|
| **H1** | COMPACT_IS_SUFFICIENT | **CONFIRMED** | F1–F10 permission parity; execution contract byte-identical |
| **H2** | FULL_HAS_MISSING_CRITICAL_CONSTRAINT | **REJECTED** | No permission field exclusive to full without other Standard owner |
| **H3** | FULL_ONLY_ADDS_REPETITION | **CONFIRMED** | `전개 방향` duplicates contract; engine footer repeats motion body |
| **H4** | FULL_OVERCONTROLS_STANDARD | **PARTIAL** (risk only) | avoid/nextBeatHint/intensity could over-steer — **no provider eval run** |
| **H5** | COMPACT_UNDERCONTROLS | **REJECTED** | P1–P7, O6–O10, F1–F10; no wider permission in compact |

---

## 5. PERMISSION PARITY (F1–F10)

Same canonical `SceneDirective` object → full and compact share:

- motion body text
- execution contract text (motion / progression / existing NPC / new actor)

| Fixture | Result |
|---------|--------|
| F1 HOLD no NPC | PASS |
| F2 MICRO relationship | PASS |
| F3 ADVANCE relationship only | PASS |
| F4 ADVANCE environment only | PASS |
| F5 existing grounded NPC | PASS |
| F6 known off-scene NPC | PASS |
| F7 remote contact | PASS |
| F8 explicit actor arrival | PASS |
| F9 ESCALATE without new actor | PASS |
| F10 ESCALATE with explicit arrival | PASS |

**User agency / cast implication:** Full `유저 조종` duplicates `[USER CONTROL — COLLABORATIVE INTERACTIVE]`. Full `직접 발화 중심` is a cast hint; NPC **action permission** remains in execution contract.

---

## 6. FINAL PROMPT OWNER INVENTORY

| Path | SceneDirective full | [SCENE PACING] | [SCENE FLOW] | User agency | Dialogue budget | Length |
|------|---------------------|----------------|--------------|-------------|-----------------|--------|
| Standard interactive | **0** | **1** | **0** (replaced) | **1** (noGodmodding) | **1** | **1** |
| Standard regen | **0** | **1** | **0** | **1** | **1** | **1** |
| Auto progression | **1** | **0** (skipMotionCue) | **1** (baseline) | auto rules | **1** | **1** |
| Auto regen | **1** | **0** | **1** | auto rules | **1** | **1** |
| Simulation | **1** | **0** | **1** | sim rules | **0** (uncapped) | **1** |

**Duplicates on Standard today:** None for motion permission. User agency appears once (noGodmodding). SceneDirective `유저 조종` line absent on Standard path.

**ARM D (full + compact, diagnostic):** Would duplicate motion body + contract — **not a production candidate**.

---

## 7. OFFLINE ARM C / F / D

| Arm | Composition | Role |
|-----|-------------|------|
| **C (current Standard)** | compact `[SCENE PACING]` only | **Production** |
| **F** | full block only, compact OFF | Hypothetical — adds non-permission fields only |
| **D** | full + compact | Diagnostic duplicate — contract identical |

---

## 8. BEHAVIOR SCENARIOS (offline prompt delta)

Mapped to existing regression fixtures (no provider calls):

| Scenario | Q/O ref | ARM C vs F contract | Notes |
|----------|---------|---------------------|-------|
| A1 quiet romance | Q1 | identical contract | full adds intensity/stagnation/hint |
| A2 short replies non-stagnant | Q3 | identical | |
| A3 repetitive stagnation | Q4 | identical | stagnation flag full-only |
| A4 relationship progression | F3 | identical | |
| A5 environmental progression | F4 | identical | |
| A6 off-scene NPC | F6, Q29 | identical | |
| A7 grounded current NPC | F5 | identical | |
| A8 remote contact | F7, Q31 | identical | |
| A9 explicit arrival | F8 | identical | |
| A10 user-led progression | Q2 | identical | |
| A11 dialogue-heavy | S12 | n/a (budget owner separate) | |
| A12 regeneration | regen test | full block 0 on Standard | |
| A13 long multi-turn progression | weighted tests | identical contract per turn | |
| A14 memory-rich | contextBuilder tests | motion owner unchanged | |
| A15 lore-heavy | contextBuilder tests | motion owner unchanged | |

No offline evidence that full-only fields close a permission gap on Standard.

---

## 9. TOKEN / PROMPT COST AUDIT (raw)

Measured via `estimateTokens` (chars × 0.9) on main — **Cursor assigns no value score**.

| Case | Motion | Full chars | Compact chars | Δ chars | Full tokens | Compact tokens | Δ tokens |
|------|--------|------------|---------------|---------|-------------|----------------|----------|
| quiet hold-ish | HOLD/MICRO | 477–523 | 124–129 | ~353–394 | 430–471 | 112–117 | **~318–354** |
| trigger advance | SCENE_ADVANCE | 538 | 131 | 407 | 485 | 118 | **367** |

**Average Δ (fixture pack):** ~330 tokens / ~370 chars per turn (full minus compact).

Full activation would add ~330 tokens/turn on Standard without new permission information.

---

## 10. LEGACY / DEAD SYSTEM AUDIT

| Item | Disposition |
|------|-------------|
| `legacySceneDirective` naming (route.ts) | **FOLLOW-UP** rename to `canonicalSceneDirective` |
| Standard SceneDirective OFF comment (contextBuilder) | **KEEP** — updated for clarity |
| old ARM-D comments | **FOLLOW-UP** |
| `nextBeatHint` in full renderer | **KEEP** (auto/full path narrative) |
| `avoid` / intensity prompt fields | **KEEP** (full/auto narrative steering) |
| duplicated user-control in full | **REDUNDANT** on Standard — other owner exists |
| `sceneDirectiveV2` | **FOLLOW-UP** — not touched |
| `livingSceneDirective` | **FOLLOW-UP** — not touched |

---

## BEFORE

Standard interactive receives:

- `[USER CONTROL — COLLABORATIVE INTERACTIVE]` (user agency)
- `[SCENE PACING]` = shared motion body + execution contract (lossless)
- Dialogue budget + length on user turn
- **No** full SceneDirective block

---

## INFORMATION DELTA

Full-only on Standard-relevant renderer (if enabled):

- Engine rule wrapper + footer
- Mode / stagnation / intensity labels
- Redundant `전개 방향`
- `피할 것`, `다음 장면 힌트`, `직접 발화 중심`
- Redundant `유저 조종` (other owner exists)

**None are exclusive behavior-critical permission boundaries.**

---

## DUPLICATE OWNER MAP

| Full field | Already owned by |
|------------|------------------|
| user control | `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` |
| progression permission | execution contract (compact) |
| NPC / new actor permission | execution contract (compact) |
| motion semantics | shared motion body (compact) |
| trigger priority | triggered event block in route/context |

---

## PERMISSION PARITY

**Full vs Compact behavior boundary: IDENTICAL** for all F1–F10 fixtures (execution contract + motion body).

---

## TOKEN DELTA

~**318–367 tokens** (~**353–407 chars**) additional per turn if full replaced compact (raw measurement; no value judgment).

---

## RECOMMENDED REPRESENTATION

**`COMPACT_SUFFICIENT`**

Standard interactive should **not** enable full SceneDirective block. Full-only fields are diagnostic, redundant, or narrative hints — not missing permission boundaries.

If future work needs cast-focus or next-beat steering on Standard, prefer **small extension to execution contract or existing owner** — not full block activation.

---

## REMOVED

- (none — audit-only PR)

## PRESERVED

- Standard compact `[SCENE PACING]` production path
- Auto / simulation full block
- Dialogue Budget Arm V
- Length / speech owners
- Provider calls / billing unchanged

## REGRESSION RISKS (if full activated)

- Prompt duplication (ARM D effect)
- Token inflation ~330/turn
- Over-control via avoid/nextBeatHint/intensity stacking
- Quiet-scene freeze / forced progression (H4 — unverified without provider eval)

## PROOF

- `standardSceneRepresentationAudit.test.ts` — F1–F10, token delta, ARM C/F/D, owner inventory
- Existing: Q1–Q32, O1–O13, P1–P7
- `scripts/scene-representation-token-delta.mjs` — raw delta samples
- `npm run lint`, `typecheck:app`, `build`, `git diff --check`

---

## STOP

**Standard full SceneDirective production ON: NOT RECOMMENDED.**  
Separate activation PR only if new evidence shows a permission gap compact cannot express.
