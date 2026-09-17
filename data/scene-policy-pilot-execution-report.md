# Scene Policy Provider Pilot Execution Report

**Status:** `PILOT_COMPLETE_READY_FOR_BLIND_EVALUATION`
**Draft PR:** #931 (not merged)
**Pilot type:** SCREENING PILOT — MINIMAL 26-call plan

---

## PILOT BASELINE

| Item | Value |
|------|-------|
| PILOT_BASELINE_SHA | `0d4c08515cb60a079a7e300ded5a87420e6c74f9` |
| Main sync source | `origin/main` @ `db2dd21b201327358ece4664da3d0c7b56ba81d2` |
| Offline gates (pre-pilot) | BMARK1–22, TRJ1–4, MODEL1–4, COST1–5 PASS; parity 32/32; typecheck PASS |
| Baseline freeze | No harness/fixture changes during 26-call execution |

Post-merge main delta (PR #932): post-turn Luna wire tests / status widget telemetry — **no scene assembly semantic change observed**.

---

## PROVIDER CONTRACT

| Field | Value |
|-------|-------|
| Model | `gemini-3.7-flash` (`getBenchmarkPilotModelDescriptor()`) |
| Transport | CheaperInference |
| Wire model | `gemini-3.7-flash` (bare CI slug) |
| Assembly | `buildBenchmarkArmPayload` → `assemblePrimaryRpRequest` |
| HTTP | `fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL)` + `buildCheaperInferenceHeaders()` |
| Fallback policy | **None** — fail-stop on first error |
| Retry policy | **None** |
| Auxiliary calls | **0** |

---

## EXECUTION PLAN

| Component | Selected IDs | Calls |
|-----------|--------------|------:|
| Single-turn | B01a, B03a, B10a, B13a × (v1, v2, living) | 12 |
| Trajectory | R1 (4 turns), R5 (3 turns) × (v1, v2) | 14 |
| **Total** | `single:4×3×1 + trajectory:sum(turns×2)×1` | **26** |

Arms: single-turn all three; trajectory v1 + v2 only (manifest MINIMAL).

---

## CALL ACCOUNTING

| Counter | Value |
|---------|------:|
| planned_logical_samples | 26 |
| attempted_physical_calls | 26 |
| successful_provider_calls | 26 |
| failed_provider_calls | 0 |
| fallback_calls | 0 |
| retry_calls | 0 |
| auxiliary_calls | 0 |

---

## SINGLE-TURN

All 12 calls captured with pre-call normalized parity assert (BMARK2-style).
Scene-only delta verified offline before execution phase.

| Fixture | Arms captured |
|---------|---------------|
| B01a | v1, v2, living |
| B03a | v1, v2, living |
| B10a | v1, v2, living |
| B13a | v1, v2, living |

Raw outputs preserved unmodified (no repair/regen/continuation).

---

## TRAJECTORY

Execution order: per trajectory → per arm → sequential turns (turn N+1 only after turn N captured).

| Trajectory | Arms | Turns executed |
|------------|------|----------------|
| R1 | v1, v2 | 4 each |
| R5 | v1, v2 | 3 each |

- Turn 1: initial scene-policy parity assert (exogenous inputs equal)
- Turn 2+: arm-specific history divergence expected (causal treatment effect)
- V2 reconvergence: in-memory `advanceV2ReconvergenceForBenchmark` / `getUpdatedReconvergenceStateFromBuild`
- Cross-arm contamination: **none** (isolated history keys per trajectory:arm)

---

## TOKEN / COST

| Metric | Value |
|--------|------:|
| Planning estimate (pre-pilot) | ~$0.30 upstream USD (ESTIMATE_HEURISTIC) |
| Actual cumulative (26 calls) | **~$0.209** upstream USD (`openRouterUsdCostFromRates` on provider-reported usage) |
| Billing / user points | **0** |

Sample actual usage (B01a): v1 4190→1363 tok; v2 4446→1055 tok; living 4436→2768 tok.

---

## BLIND PACKAGE

| Artifact | Path |
|----------|------|
| Full captures (internal) | `data/scene-policy-pilot/pilot-result.json` |
| Blind samples (no arm identity) | `data/scene-policy-pilot/blind-samples.json` |
| Answer key (separate) | `data/scene-policy-pilot/answer-key.json` |

Cursor did **not** score quality or select a winner.

---

## PRESERVED

- Production `/api/chat` route untouched
- DB writes: **0**
- User billing: **0**
- Railway env: unchanged
- SceneDirective production owners: unchanged

---

## REGRESSION RISKS

- Output length variance across arms (living arm longer on some fixtures) — screening evidence only
- Trajectory turn2+ payload divergence is expected; not a parity failure
- Main may advance after pilot; this run frozen at PILOT_BASELINE_SHA

---

## PROOF

- Provider HTTP calls: **26** (CheaperInference only)
- Fallback/retry/auxiliary: **0**
- Execution log: `/opt/cursor/artifacts/scene-policy-pilot-run.log`
- Runner: `scripts/scene-policy-benchmark-pilot-run.ts`
