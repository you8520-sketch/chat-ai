# Scene Policy Provider-Evidence Benchmark Preparation Report

**Main SHA (verified at start):** `21a4e33e0f245011e22859d9bd7f475be70f1f8d`  
**Branch:** `cursor/scene-policy-benchmark-preparation-aa40`  
**Type:** Experiment design / benchmark preparation — **no provider calls, no production changes**  
**Status:** `READY_FOR_PROVIDER_PILOT`

---

## BASELINE

| Item | Value |
|------|-------|
| Main SHA | `21a4e33e0f245011e22859d9bd7f475be70f1f8d` (includes PR #929 experiment retirement audit) |
| Production scene owner | SceneDirective v1.2 (`legacy_v1`) |
| V2 / Living in production | OFF (env unchanged this PR) |
| Reused infrastructure | `buildContext`, `assemblePrimaryRpRequest`, `materializeSceneDirectivePromptBlock`, `openRouterModelPricing`, `scene-directive-v2-fixtures.ts` pattern |
| New harness | `src/lib/scenePolicyBenchmarkHarness.ts` + dataset + BMARK1–17 tests |

---

## OWNER MAP

| Key | Owner |
|-----|-------|
| PROVIDER_MODEL_OWNER | `route.ts` + `MAIN_RP_USER_SELECTABLE_OPTIONS` |
| MODEL_PARAMETERS_OWNER | `openRouterClient.buildOpenRouterRequestBody` |
| TEMPERATURE_OWNER | `openRouterClient.normalizeOpenRouterGenerationParams` (model-specific) |
| MAX_OUTPUT_OWNER | `openRouterClient.resolveOpenRouterMaxTokens` |
| TARGET_LENGTH_OWNER | `responseLength` + `targetResponseChars` |
| SYSTEM_PROMPT_ASSEMBLY_OWNER | `services/contextBuilder.buildContext` |
| SCENE_POLICY_OWNER | v1.2 / V2 / Living builders + `materializeSceneDirectivePromptBlock` |
| CANON_OWNER | `contextBuilder` + `characterParser` chunks |
| MEMORY_OWNER | `contextBuilder` longTermMemory + memoryMeta |
| USER_AGENCY_OWNER | Identity/rules layers in `contextBuilder` |
| SPEECH_OWNER | `privateSpeechControlBlock` + scene speech rules |
| REGEN_OWNER | `route.ts` regenerate branch (**follow-up**, not phase-1 pilot) |
| PROVIDER_PAYLOAD_OWNER | `openRouterAdult.assemblePrimaryRpRequest` |
| TOKEN_ESTIMATE_OWNER | `tokenEstimate.estimateTokens` |
| PROVIDER_COST_OWNER | `openRouterModelPricing.openRouterUsdCostFromRates` |
| BILLING_PRICE_OWNER | `points.ts` / `billingDisplay` (**benchmark bypasses**) |
| BENCHMARK_FIXTURE_OWNER | `scenePolicyBenchmarkDataset.ts` |
| MOCK_DRY_RUN_OWNER | `assemblePrimaryRpRequest` (credential-free transport descriptor) |

---

## BENCHMARK ARCHITECTURE

### A — Controlled single-turn (Benchmark A)

- Frozen history + user message + canon/memory/lore/trigger shared across arms.
- Arms: **V1** (`legacy_v1` + compact `[SCENE PACING]` wire), **V2** (`event_restraint_v2` + full block), **Living** (`living_continuity_director` + full block).
- Payload assembly mirrors production: `buildContext` → `assemblePrimaryRpRequest` + `sceneServerControls`.

### B — Stateful trajectory (Benchmark B)

- `RECONVERGENCE_TRAJECTORIES` R1–R6 with scripted user actions + **frozen assistant placeholders** (offline).
- Arms default **V1 vs V2** (Living excluded where reconvergence N/A).
- Turn history accumulates frozen assistant text — no live model output required for harness prep.

---

## DATASET

| Family | Fixtures | Count |
|--------|----------|------:|
| B01–B16 scenario families | 2 each (B01a/b … B16a/b) | 32 |
| Event restraint focus ER1–ER10 | id references | 10 |
| Living focus L1–L7 | id references | 7 |
| Reconvergence R1–R6 | multi-turn trajectories | 6 |

**Total single-turn fixture rows:** 32  
**Pilot representatives:** B01a, B03a, B10a, B13a, R1, R5

Fixtures use neutral synthetic character **한서린**, 4–10 turn histories, optional lore/trigger/reconvergence state — not one-line keyword tests.

---

## FAIRNESS PROOF

Non-scene fingerprint compares (per case, all arms):

- MODEL, TEMPERATURE, MAX_OUTPUT, TARGET_LENGTH  
- CANON, USER_PERSONA, MEMORY, HISTORY, LORE, TRIGGER, SPEECH, AGENCY, STYLE  
- Shared `buildContext` **without** scene directive injection (scene wire excluded)

**BMARK2:** all 32 fixtures pass three-arm non-scene parity in offline tests.

Scene-related sections intentionally differ:

- V1: compact `[SCENE PACING]` (production Standard wire)  
- V2/Living: full experiment blocks via `[3d] Private scene directive`

---

## ARM DELTA (what actually differs)

| Arm | Prompt owner | Scene surface | Unique metadata |
|-----|--------------|---------------|-----------------|
| V1 | `legacy_v1` | `[SCENE PACING]` compact cue | motionDecision, npcGrounding, progressionTypes |
| V2 | `event_restraint_v2` | `[PRIVATE SCENE PACING RULE]` | eventBudget, allowNewNpc, reconvergenceState, permission flags |
| Living | `living_continuity_director` | `[PRIVATE SCENE CONTINUITY RULE]` | scenePhase, eventSource, Living progression taxonomy |

Harness stores per-arm `sceneBlock`, `sceneMetadata`, token estimates (base vs scene vs total).

---

## RECONVERGENCE BENCHMARK

| ID | Scenario |
|----|----------|
| R1 | Natural parting, no hook |
| R2 | Shared item |
| R3 | Confirmed next meeting |
| R4 | Shared unfinished task |
| R5 | User avoids reunion |
| R6 | Multi-turn separation (5 turns) |

---

## LIVING BENCHMARK

L1–L7 map to B11a, B01a, B16a, B10a, B05a, B15a, B16b — phase/eventSource/parting/quiet/active coverage.

---

## EVENT RESTRAINT BENCHMARK

ER1–ER10 map to quiet, stagnation, task, NPC, off-scene, remote, no-contact, user-led, trigger, conflict fixtures.

---

## MODEL CANDIDATES (raw facts — no scoring)

| Slot | Model ID | Provider | Input $/M | Output $/M | Cache |
|------|----------|----------|-----------|------------|-------|
| MODEL_A | `deepseek-v4-pro-0813` | cheaperinference | 0.3045 | 0.609 | automatic prefix |
| MODEL_B | `claude-opus-5` | cheaperinference | 3.5 | 17.5 | explicit cache_control |
| MODEL_C | `gemini-3.1-pro-preview-2601` | cheaperinference | 1.4 | 8.4 | automatic |
| MODEL_D | `gemini-3.7-flash` | cheaperinference | 0.53 | 2.63 | automatic |

**Single-model first pass:** supported — pilot can run on MODEL_A only; decision questions are policy-comparison-first, not model-ranking.

**Seed support:** generation overrides accept `seed` in `OpenRouterGenerationOverrides`, but provider/model deterministic replay is **not guaranteed** — do not label runs “deterministic” without per-model verification.

---

## CALL PLANS

Estimates from pilot sample avg input tokens + `targetResponseChars` output estimate via `openRouterUsdCostFromRates` (upstream USD, not user points).

| Plan | Repeat | Single-turn calls | Trajectory calls | Total calls | Est. input tok | Est. output tok | Est. upstream USD |
|------|--------|-------------------|------------------|------------:|---------------:|----------------:|------------------:|
| MINIMAL | 1 | 18 (6×3) | 8 | 26 | ~182k | ~75k | ~0.10 |
| BALANCED | 2 | 192 (32×3×2) | 52 | 244 | ~1.71M | ~703k | ~0.92 |
| HIGH-CONFIDENCE | 3 | 288 (32×3×3) | 78 | 366 | ~2.57M | ~1.05M | ~1.38 |

*(USD varies with live Cheaper Inference catalog rates; harness uses canonical rate owner.)*

**Billing separation:** harness never calls `points` charge paths. Provider benchmark execution must use admin/offline billing bypass (follow-up PR).

---

## BLIND EVALUATION FORMAT

- Export: fixture context + Response A/B/C (raw output slots empty in prep phase)
- Deterministic shuffle per `caseId` → separate `answerKey` (A/B/C → v1/v2/living)
- Rubric items defined in `BLIND_EVALUATION_RUBRIC_ITEMS` — **score columns empty**
- Cursor does **not** auto-score

---

## NO-LIVE-CALL PROOF

| Gate | Result |
|------|--------|
| Provider HTTP calls | **0** (BMARK13 fetch interceptor) |
| Billing calls | **0** (BMARK14 — harness excludes charge imports) |
| Production route | Unchanged (BMARK16) |
| Railway env | Unchanged |

---

## PRESERVED

- Production route / SceneDirective v1.2 owner  
- Standard compact `[SCENE PACING]` when flags off  
- Auto / Simulation / Regen / Continuation / Recovery paths untouched  
- TRPG / General Chat party untouched  
- DB schema / Railway env / billing production path  

---

## RISKS

| Risk | Mitigation |
|------|------------|
| Benchmark bias | Non-scene fingerprint + blind export |
| Prompt mismatch | Shared context + BMARK2 parity gate |
| Trajectory drift | Frozen assistant placeholders + separate Benchmark B |
| Model variance | Repeat plans 2–3; report raw outputs |
| Cache effects | Separate quality vs cache-cost analysis |
| Length bias | Same targetResponseChars / max_tokens; record actual output length |
| Provider fallback contamination | Benchmark path must fail closed (follow-up execution PR) |

---

## DECISION QUESTIONS (harness enables — not answered here)

DQ1–DQ10 and E1–E8 from audit brief — evidence deferred to post-provider blind evaluation.

---

## NEXT ACTION

**READY_FOR_PROVIDER_PILOT**

Suggested follow-up (separate PR, user approval):

1. Phase 1 pilot — 6 representative fixtures × 3 arms × REPEAT=1  
2. Parity gate re-check on live payload snapshots  
3. Blind package export with raw model outputs  
4. Human/GPT rubric fill (Cursor does not score)
