# Scene Policy Provider-Evidence Benchmark Preparation Report

**Main SHA (synced):** `316d1dc14e748611c5843860b480ed682631d099`
**Branch:** `cursor/scene-policy-benchmark-preparation-aa40`
**Type:** Pilot preparation update (latest main + Gemini 3.7 Flash MODEL_A) — **no provider calls, no production changes**
**Status:** `READY_FOR_PROVIDER_PILOT`

---

## BEFORE

PR #931 benchmark harness used `BENCHMARK_DEFAULT_MODEL = deepseek-v4-pro-0813` (DeepSeek V4 Pro) as MODEL_A. Scene policy pilot intent is Gemini 3.7 Flash — the stale DeepSeek default made cost estimates, capture schema, and pilot model assumptions inconsistent with the intended provider pilot.

---

## LATEST MAIN

| Item | Value |
|------|-------|
| Synced main SHA | `316d1dc14e748611c5843860b480ed682631d099` |
| Merge | PR #930 (DeepSeek regen receipt observability) + prior main |
| Scene assembly delta | **None observed** — `buildContext`, `assemblePrimaryRpRequest`, scene owner/materialization paths unchanged for benchmark purposes |
| Post-sync parity | 32/32 normalized final payload parity retained |

---

## MODEL OWNER

Single canonical owner: `scenePolicyBenchmarkDataset.getBenchmarkPilotModelDescriptor()`

| Owner | Canonical source |
|-------|------------------|
| Benchmark pilot model | `CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL` (`gemini-3.7-flash`) |
| Picker provider | `MAIN_RP_USER_SELECTABLE_OPTIONS` → `cheaperinference` |
| Transport provider | `cheaperinference` (via `assemblePrimaryRpRequest` messageOpts) |
| Provider wire model ID | `gemini-3.7-flash` (bare CheaperInference slug) |
| Generation params | `openRouterClient.buildOpenRouterRequestBody` |
| Upstream cost rates | `openRouterModelPricing.resolveOpenRouterModelRates` |
| Call plan | `computeExecutionMatrix` from manifest filters |
| Capture schema model/provider | `getBenchmarkPilotModelDescriptor()` |

---

## FINAL PAYLOAD PARITY

Actual `assembled.messages` + `requestBody` compared after scene-owned strip (renderer-aligned blocks).

**BMARK2:** 32/32 fixtures — `NORMALIZED_FINAL_PAYLOAD_HASH(v1) = hash(v2) = hash(living)`

---

## SCENE-ONLY DELTA

**BMARK9:** raw payloads differ; normalized match; `changedSections = ["scene-policy"]`

---

## REPRESENTATION PROOF

| Arm | Final surface | BMARK |
|-----|---------------|-------|
| V1 Standard | compact `[SCENE PACING]` only | BMARK18 |
| V2 | full `[PRIVATE SCENE PACING RULE]` | BMARK19 |
| Living | full `[PRIVATE SCENE CONTINUITY RULE]` | BMARK20 |

**BMARK21–22:** scene token estimate from actual final scene text; non-additivity documented.

---

## TRAJECTORY

Offline (`buildOfflineTrajectoryTurnFixture`) vs live (`buildLiveTrajectoryTurnFixture`) separation unchanged.

**TRJ1–TRJ4:** PASS on latest main + Gemini 3.7 configuration.

---

## COST OWNER

**Classification:** `COST_OWNER_CONFIRMED` (COST1, COST4)

| Field | Value |
|-------|-------|
| Pilot model | `gemini-3.7-flash` |
| Transport | `cheaperinference` |
| Wire model ID | `gemini-3.7-flash` |
| Upstream source | `openRouterModelPricing.resolveOpenRouterModelRates` (CI catalog snapshot + live merge) |
| Rates label | Cheaper Inference · Google automatic cache |
| Billing alignment | `billingRawCost.openRouterUsdCostFromRates` uses same table |

DeepSeek V4 Pro COST_OWNER_CONFIRMED result is **not** reused for Gemini pilot.

---

## EXACT CALL PLAN

Derived from manifest (not hardcoded):

| Component | Selected IDs | Formula | Calls |
|-----------|--------------|---------|------:|
| Single-turn | B01a, B03a, B10a, B13a | 4 × 3 arms × 1 | 12 |
| Trajectory | R1 (4 turns), R5 (3 turns) | sum(turns) × 2 arms × 1 | 14 |
| **MINIMAL total** | | `single:4×3×1 + trajectory:sum(turns×2)×1` | **26** |

Arms: `v1`, `v2` (trajectory); all three for single-turn.

---

## COST ESTIMATE (Gemini 3.7 Flash, MINIMAL 26 calls)

| Metric | Value | Method |
|--------|------:|--------|
| Est. input tokens | ~197k | pilot final-payload sample avg × 26 |
| Est. output tokens | ~75k | **ESTIMATE_HEURISTIC** (`estimateTokens` on targetResponseChars=3200) |
| Est. upstream USD | **~$0.30** | `openRouterUsdCostFromRates` (upper-bound heuristic, not billing quote) |

DeepSeek ~$0.11 estimate **not reused**. Output token cost is heuristic, not provider tokenizer exact.

---

## PRESERVED

- Production route / SceneDirective v1.2 owner
- Railway env / DB / billing paths
- DeepSeek production selectable option (not retired in this PR)
- Provider HTTP = 0, billing = 0

---

## REMOVED/UPDATED

- Benchmark-only `BENCHMARK_DEFAULT_MODEL` → `gemini-3.7-flash` via `getBenchmarkPilotModelDescriptor()`
- Report cost text updated from DeepSeek to Gemini 3.7
- Added MODEL1–4, COST4–5 regression gates

---

## PROOF

| Gate | Result |
|------|--------|
| BMARK1–22 | PASS |
| TRJ1–4 | PASS |
| MODEL1–4 | PASS |
| COST1–5 | PASS |
| Parity 32/32 | PASS |
| Provider HTTP | 0 |
| Billing / DB | 0 |

---

## NEXT ACTION

**READY_FOR_PROVIDER_PILOT** — actual provider execution remains separate follow-up. **Do not merge** until pilot approved. Cursor does not score quality.
