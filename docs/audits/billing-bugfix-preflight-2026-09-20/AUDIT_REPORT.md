# BUGFIX Pre-Flight Audit — Stable Reference BASE_USER_CHARGE

**Date:** 2026-09-20  
**Exact HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805`  
**Draft PR:** #991  
**Mode:** READ-ONLY design — **no live billing change**  
**Constraints:** RUNTIME_CHANGE=NO · BILLING_CUTOVER=NO · MERGE=NO

---

## CORRECTION PASS (PR #991 exact-head review)

### Confirmed audit bug (fixed in this pass)

Initial `scripts/billing-preflight-price-matrix.ts` used a shared **`CI_FIXTURE`** (reference 2/12, current 1.4/8.4, 30% discount) seeded to **all** models. That is **Gemini 3.1-shaped** evidence only.

**Withdrawn claims (do not use for price sign-off):**

| Withdrawn | Reason |
|---|---|
| DeepSeek live 331 → candidate 90 (NORMAL) | Used G31 1.4/8.4 current, not DeepSeek 0.3045/0.609 |
| G37 live 187 → candidate 48 (NORMAL) | Used G31 current, not G37 0.2625/1.3125 |
| Terra live 75 → candidate 78 vs 253 benchmark on NORMAL shape | G31 fixture + char benchmark on wrong workload |
| Any operational row comparing competitor P on NORMAL/MEMORY/STRESS shapes | Benchmark workload mismatch |

**Preserved valid findings:** architecture bug repro, stable-reference invariant, procurement→margin swing, upstream coupling, promotion separation, candidate engine audit, cache/tier blocks.

Synthetic fixture renamed: **`SYNTHETIC_PROCUREMENT_SWING_FIXTURE`** (`billingPreflightModelPricingEvidence.ts`).

Evidence registry: **`billingPreflightModelPricingEvidence.ts`** — one reference/current block per model.

Machine-readable matrices: **`PRICE_MATRIX.json`** (regenerated).

---

## PRODUCT POLICY — SOURCE OF TRUTH

| Concept | Policy |
|---|---|
| **BASE_USER_CHARGE** | CI **reference/list** + competitor benchmark → **published target margin** |
| **CI current procurement** | **PROCUREMENT_COST** only; increases **CANDIDATE_POST_CUTOVER_REALIZED_MARGIN** |
| **Official / site promotion** | Separate verified layers; CI `discountPercent` is **not** a promotion signal |

---

## SYNTHETIC ARCHITECTURE REPRO

**Fixture:** `SYNTHETIC_PROCUREMENT_SWING_FIXTURE`  
Model: `gemini-3.1-pro-preview` (architecture only)  
Usage: 10k prompt / 2k completion  
CI current levels: 100 → 70 → 40 (synthetic reference 100/100)

| Invariant | Live (bug) | Candidate (expected) |
|---|---|---|
| BASE vs procurement swing | BASE **changes** | BASE **stable** |
| PROCUREMENT cost | decreases | decreases |
| Realized margin | not separated | increases as procurement drops |

Tests: `billingStableReferencePreflightAudit.test.ts` (11 pass)

**Root cause (unchanged):** `pointsReasoningMargins.ts` — `withLiveCheaperInferenceCatalogPricing()` + `upstreamCostUsd → baseCost` (`1b350607`).

---

## MODEL-SPECIFIC PRICING EVIDENCE

| Model | Reference (policy basis) | Current procurement | Status |
|---|---|---|---|
| **deepseek-v4-pro-0813** | 0.66 / 1.98 in, 0.022 cache read — published v2 2026-09-02 | 0.3045 / 0.609 / 0.231 cache — CI fallback 2026-07-29 | **known** |
| **gemini-3.1-pro-preview** | 2 / 12 — official base tier ≤200k | 1.4 / 8.4 @ 30% — CI observed 2026-08-28 | **known** |
| **gemini-3.7-flash** | 0.375 / 1.875 — calibration + published v2 | 0.2625 / 1.3125 @ 30% — calibration 2026-08-28 | **known** |
| **gpt-5.6-terra** | 2 / 12, cache 0.2 / 2 — published v2 2026-09-19 | — | **CURRENT_PROCUREMENT_UNKNOWN** |

Terra unknown reason: only direct-list fallback in code equals reference; no reproducible discounted CI snapshot without `/v1/models` (PROVIDER_GENERATION_CALLS=0).

---

## MODEL-SPECIFIC OPERATIONAL MATRIX

FX: 1530 / 1560.6 effective. Sources per model in `PRICE_MATRIX.json`.

### deepseek-v4-pro-0813

| Shape | Live BASE P | Candidate BASE P | ΔP | Ref KRW | Proc KRW | Live realized margin | Candidate post-cutover margin | Candidate |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| NORMAL | 54 | 90 | +36 | 44.9 | 18.7 | 0.654 | 0.792 | complete |
| MEMORY_HEAVY | 17 | 9 | −8 | 4.4 | 5.7 | 0.665 | 0.367 | complete |
| BOUNDED_STRESS | 120 | 196 | +76 | 97.8 | 41.9 | 0.651 | 0.786 | complete |

**Note:** No competitor benchmark — operational ΔP is **not** competitiveness sign-off.

### gemini-3.1-pro-preview

| Shape | Live BASE P | Candidate BASE P | ΔP | Ref KRW | Proc KRW | Live realized margin | Candidate post-cutover margin | Candidate |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| NORMAL | 119 | 95 | −24 | 86.3 | 59.2 | 0.503 | 0.377 | complete |
| MEMORY_HEAVY | 286 | 229 | −57 | 207.7 | 142.5 | 0.502 | 0.378 | complete |
| BOUNDED_STRESS (199k) | 930 | 745 | −185 | 677.3 | 464.8 | 0.500 | 0.376 | complete |

Cache semantics: **unverified** — cache-heavy production turns may **BLOCK** (not shown in no-cache MEMORY_HEAVY benchmark shape).

### gemini-3.7-flash

| Shape | Live BASE P | Candidate BASE P | ΔP | Ref KRW | Proc KRW | Live realized margin | Candidate post-cutover margin | Candidate |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| NORMAL | 33 | 48 | +15 | 21.5 | 14.8 | 0.552 | 0.692 | complete |
| MEMORY_HEAVY (20k cache) | 21 | — | — | 11.1 | 9.2 | 0.562 | — | **blocked** cache |
| BOUNDED_STRESS | 55 | 80 | +25 | 36.0 | 24.7 | 0.551 | 0.691 | complete |

G37-specific current **0.2625** — never G31 1.4/8.4.

### gpt-5.6-terra

| Shape | Live BASE P | Candidate BASE P | ΔP | Ref KRW | Proc KRW | Margins | Candidate |
|---|---:|---:|---:|---:|---:|---|---|
| NORMAL | 107 | 78 | −29 | 54.3 | null | null (proc unknown) | complete |
| MEMORY_HEAVY | 306 | 223 | −83 | 156.1 | null | null | complete |
| BOUNDED_STRESS | 484 | 353 | −131 | 246.6 | null | null | complete |

Live BASE uses code fallback (2/12 @ 50% live margin). Candidate uses published v2 (2/12 @ 30% target margin). **Procurement KRW not computed** — current unknown.

---

## COMPETITOR-ALIGNED PRICE MATRIX

**Rule:** Compare competitor P **only** at exact benchmark token workload.

| Model | Benchmark | Exact usage | Our candidate P | Competitor P | ΔP | Δ% | Comparability |
|---|---|---:|---:|---:|---:|---:|---|
| Gemini 3.1 | gemini31_competitor_a | 40,689 / 4,307 | **229** | 244.2 | −15.2 | −6.2% | EXACT_WORKLOAD |
| Gemini 3.7 | gemini37_competitor_a | 24,952 / 2,367 | **48** | 55 | −7 | −12.7% | EXACT_WORKLOAD |
| Gemini 3.7 | gemini37_competitor_b | 42,195 / 3,862 | **80** | 84.4 | −4.4 | −5.2% | EXACT_WORKLOAD |
| Terra | published_marketBenchmark | **6,025 chars only** | — | 253 | — | — | **NOT_DIRECTLY_COMPARABLE** |
| DeepSeek | — | — | — | — | — | — | **COMPETITOR_BENCHMARK_MISSING** |

**Do not** attach 244.2 P to G31 NORMAL 15k/2k row. **Do not** attach 253 P to Terra NORMAL token row.

---

## CURRENT LIVE REALIZED MARGIN vs CANDIDATE POST-CUTOVER REALIZED MARGIN

Formula (separate columns in matrix):

- **CURRENT_LIVE_REALIZED_MARGIN** = `(currentLiveBaseP − currentProcurementKrw) / currentLiveBaseP`
- **CANDIDATE_POST_CUTOVER_REALIZED_MARGIN** = `(candidateStableBaseP − currentProcurementKrw) / candidateStableBaseP`

When `currentProcurementKrw` is null (Terra), margins are null — not fabricated.

Post-cutover, deeper CI discounts **increase** candidate margin (stable BASE, lower procurement).

---

## OWNER MAP (unchanged)

| Owner | Current bug path | Cutover target |
|---|---|---|
| BASE_USER_CHARGE | `pointsReasoningMargins.ts` (CI current overlay) | `publishedUserCharge.ts` |
| PROCUREMENT_PRICE | `procurementCost.ts` / `upstreamCostUsd` | unchanged |
| OFFICIAL / SITE PROMOTION | `officialProviderPromotion.ts` / `sitePromotion.ts` | **KEEP** |

---

## CUTOVER DESIGN (record only — not implemented)

1. Wire `computePublishedUserChargeWithSnapshot()` as live BASE owner for Main RP CI models.
2. Remove CI current overlay and `upstreamCostUsd → baseCost` from BASE path.
3. Keep upstream for ACTUAL_PROVIDER_COST / CANDIDATE_POST_CUTOVER_REALIZED_MARGIN telemetry.
4. On `blocked` (cache/tier): explicit policy — **no silent fallback to CI current**.

---

## REGRESSION TESTS

| File | Tests | Purpose |
|---|---|---|
| `billingStableReferencePreflightAudit.test.ts` | 11 | Synthetic repro + invariant + promotion |
| `billingPreflightPriceMatrixCorrection.test.ts` | 10 | Model-specific evidence guards |
| `procurementPromotionSeparation.test.ts` | 12 | Promotion layer (unchanged) |

Correction guards:

1. Models cannot share one pricing fixture
2. G31 1.4/8.4 not on DeepSeek/G37/Terra
3. Terra → CURRENT_PROCUREMENT_UNKNOWN
4. Benchmark exact workload required
5. Terra char benchmark → NOT_DIRECTLY_COMPARABLE
6. SYNTHETIC_PROCUREMENT_SWING_FIXTURE architecture-only

---

## CLASSIFICATION

### **PARTIAL_PRICE_EVIDENCE**

**Not READY_FOR_PRICE_REVIEW** until:

| Gap | Blocker type |
|---|---|
| Terra current procurement unknown | CURRENT_PRICE_EVIDENCE |
| DeepSeek competitor benchmark missing | POLICY_DATA |
| G37 MEMORY_HEAVY cache blocked | MODEL_SEMANTICS |
| G31 cache unverified on cache turns | MODEL_SEMANTICS |
| Terra 253P char benchmark not token-comparable | POLICY_DATA |
| Operational ΔP varies by model — needs per-model GPT review | PRICE_REVIEW |

**Architecture bug classification:** CONFIRMED — cutover design valid; price sign-off evidence now model-specific but incomplete.

---

## PROOF

```bash
node --conditions=react-server --import tsx --test \
  src/lib/billingStableReferencePreflightAudit.test.ts \
  src/lib/billingPreflightPriceMatrixCorrection.test.ts
# → 21/21 pass

PREFLIGHT_MATRIX_OUT=docs/audits/billing-bugfix-preflight-2026-09-20/PRICE_MATRIX.json \
  node --conditions=react-server --import tsx scripts/billing-preflight-price-matrix.ts
```

---

**STOP.** MERGE = NO. Awaiting GPT exact-head review with corrected evidence.
