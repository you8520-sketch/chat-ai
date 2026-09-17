# Scene Policy Provider-Evidence Benchmark Preparation Report

**Main SHA (verified at start):** `21a4e33e0f245011e22859d9bd7f475be70f1f8d`
**Branch:** `cursor/scene-policy-benchmark-preparation-aa40`
**Type:** Benchmark harness correctness bugfix — **no provider calls, no production changes**
**Status:** `READY_FOR_PROVIDER_PILOT`

---

## BEFORE

The initial harness computed non-scene fingerprints from `sharedBuilt` — a scene-free `buildContext` pass shared across arms. That proved “identical scene-free input → identical hash,” not **actual final V1/V2/Living provider payload parity** after `assemblePrimaryRpRequest`.

Additional bugs fixed in this pass:

- V1 `scenePolicyTokenEstimate` used full `renderSceneDirectiveForPrompt` artifact, not compact `[SCENE PACING]` in the actual payload.
- `stableJson` replacer dropped nested message fields, collapsing distinct raw payloads to identical hashes.
- Scene strip regex terminated at internal V2/Living `[이번 턴 …]` headers and over-stripped `[SCENE FLOW]` through `[RHYTHM]`.

---

## FINAL PAYLOAD PARITY

Parity is now computed from **actual** `assembled.messages` + `assembled.requestBody`:

1. `buildBenchmarkArmPayload` → production path (`buildContext` + `assemblePrimaryRpRequest` + `sceneServerControls`).
2. `resolveSceneStripTextsForArm` removes exact renderer-aligned scene blocks:
   - V1: `renderCompactScenePacingCue` (compact `[SCENE PACING]`)
   - V2: full `[PRIVATE SCENE PACING RULE]` block
   - Living: full `[PRIVATE SCENE CONTINUITY RULE]` block
   - Residual wire: exact `SCENE_FLOW_BLOCK` when present (V2/Living Standard wire)
3. `normalizeFinalPayloadForSceneParity` hashes normalized messages + generation params.

**BMARK2:** 32/32 fixtures pass — `NORMALIZED_FINAL_PAYLOAD_HASH(v1) = hash(v2) = hash(living)`.

---

## SCENE-ONLY DELTA PROOF

**BMARK9:** raw final payloads differ; normalized payloads match; `changedSections = ["scene-policy"]`.

---

## REPRESENTATION PROOF

| Arm | Final scene surface | Owner counts (BMARK18–20) |
|-----|---------------------|---------------------------|
| V1 Standard | compact `[SCENE PACING]` only | `scenePacing=1`, `v1Full=0` |
| V2 | full `[PRIVATE SCENE PACING RULE]` | `v2Full=1`, `scenePacing=0` |
| Living | full `[PRIVATE SCENE CONTINUITY RULE]` | `livingFull=1`, `scenePacing=0` |

---

## TOKEN COST

- `scenePolicyTokenEstimate` = `estimateTokens(actual final scene-owned text)` (**BMARK21**).
- `basePayloadTokenEstimate` = tokens of scene-stripped normalized messages.
- `inputTokenEstimate` = total final payload tokens.
- **BMARK22:** `base + scene ≠ total` within ~15% — `estimateTokens` is non-additive across joined segments (documented limitation, not enforced as exact arithmetic).

Output tokens: **ESTIMATE_HEURISTIC** — `estimateTokens` on `targetResponseChars` (chars×0.9), not provider tokenizer.

---

## TRAJECTORY CONTRACT

| Path | Function | History source |
|------|----------|------------------|
| Offline preparation | `buildOfflineTrajectoryTurnFixture` | `frozenAssistantResponse` placeholders |
| Live provider (future) | `buildLiveTrajectoryTurnFixture` | per-arm `assistantOutputByArm` only |

**TRJ1–TRJ3:** arm-specific history isolation; V2 reconvergence state only on V2 live fixtures.
**TRJ4:** live path does not read `frozenAssistantResponse`.
**Reconvergence transition:** `advanceV2ReconvergenceForBenchmark` reuses `getUpdatedReconvergenceStateFromBuild` (in-memory, no DB).

---

## COST OWNER

**Classification:** `COST_OWNER_CONFIRMED` (COST1)

| Field | Value |
|-------|-------|
| Benchmark model | `deepseek-v4-pro-0813` (MODEL_A) |
| Transport provider | `cheaperinference` |
| Upstream rate source | `openRouterModelPricing.resolveOpenRouterModelRates` (CheaperInference catalog snapshot + live catalog merge) |
| USD estimate fn | `openRouterUsdCostFromRates` (same table as `billingRawCost`) |

All four MAIN_RP picker models route through CheaperInference; rates are resolved per model via `listModelCandidateFacts` with per-model `upstreamCostSource`.

---

## EXACT CALL PLAN

Derived from manifest (`listPilotFixtures`, `listPilotTrajectories`, `RECONVERGENCE_TRAJECTORIES`) — no hardcoded `2×4`.

### MINIMAL (repeat=1)

| Component | Selected IDs | Formula | Calls |
|-----------|--------------|---------|------:|
| Single-turn | B01a, B03a, B10a, B13a | 4 × 3 arms × 1 | 12 |
| Trajectory | R1 (4 turns), R5 (3 turns) | sum(turns) × 2 arms × 1 = 7 × 2 | 14 |
| **Total** | | | **26** |

`callFormula`: `single:4×3×1 + trajectory:sum(turns×2)×1`

Sample estimates (MODEL_A, targetResponseChars=3200):

- avg input tokens/call ≈ 8104 (pilot final-payload sample)
- avg output tokens/call ≈ 2880 (ESTIMATE_HEURISTIC)
- estimated upstream USD ≈ **$0.11** (upper-bound heuristic, not billing quote)

BALANCED / HIGH-CONFIDENCE plans scale from full 32-fixture + R1–R6 manifest with repeats 2 and 3 respectively.

---

## BLIND PACKAGE

- Deterministic shuffle per `caseId`; `answerKey` separate from blind slots.
- `applyCaptureResultsToBlindPackage` stub for future live captures → slot fill (no Cursor scoring).

---

## PRESERVED

- Production route / SceneDirective v1.2 owner
- Railway env / DB / billing paths untouched
- No provider HTTP calls / no billing execution

---

## PROOF

| Gate | Result |
|------|--------|
| BMARK2 (32 fixtures) | PASS |
| BMARK9 scene-only delta | PASS |
| BMARK18–22 token/representation | PASS |
| TRJ1–TRJ4 trajectory contract | PASS |
| COST1–COST3 cost owner + exact calls | PASS |
| Provider HTTP | 0 |
| Billing | 0 |

Regression: existing scene audit suites (Q/O/P/F/W/D/C/X) unchanged scope.

---

## NEXT ACTION

**READY_FOR_PROVIDER_PILOT** — provider execution remains a separate follow-up PR with user approval. Cursor does not score quality.
