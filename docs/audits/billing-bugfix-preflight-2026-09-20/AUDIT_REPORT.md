# BUGFIX Pre-Flight Audit — Stable Reference BASE_USER_CHARGE

**Date:** 2026-09-20  
**Exact HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805`  
**Prior audit:** PR #990 architecture audit (evidence baseline)  
**Mode:** READ-ONLY design — **no live billing change**  
**Constraints:** RUNTIME_CHANGE=NO · POINT_RATE_CHANGE=NO · BILLING_CUTOVER=NO · PROMOTION_CHANGE=NO · DB_CHANGE=NO · PROVIDER_GENERATION_CALLS=0 · MERGE=NO

---

## PRODUCT POLICY — SOURCE OF TRUTH (confirmed this session)

| Concept | Policy |
|---|---|
| **BASE_USER_CHARGE basis** | CI **reference/list** (discount-before) + competitor benchmark → **published target margin** |
| **CI current procurement** | Lowers **PROCUREMENT_COST** only; surplus → **ACTUAL_REALIZED_MARGIN** |
| **CI current discount** | Must **not** auto-change BASE_USER_CHARGE in normal operation |
| **Official provider promotion** | Separate verified system → site campaign → discount on BASE → FINAL |
| **CI `discountPercent`** | Not official/site promotion signal |

**Historical root cause (confirmed):** `1b350607` intentionally re-coupled CI current/upstream to BASE_USER_CHARGE inside PR #963. Per **new** product policy, that coupling is the **bug**.

---

## MAIN RELATION

| Item | Value |
|---|---|
| Base branch | `main` @ `3c5555a2` |
| Architecture audit | PR #990 |
| This audit branch | `cursor/billing-bugfix-preflight-audit-d09d` |
| Implementation | **None** — design + repro + matrix only |

---

## BUG REPRODUCTION

### Symptom

Same model + same billable usage + same FX → **BASE_USER_CHARGE changes** when only CI current procurement rate (or `upstreamCostUsd`) changes.

### Deterministic fixture

Model: `gemini-3.1-pro-preview`  
Usage: 10,000 prompt + 2,000 completion tokens  
FX: 1530 base / 1560.6 effective (2% card fee)  
CI reference/list: 100/100 USD per 1M (synthetic fixture)  
CI current scenarios: **100 → 70 → 40** (30% steps)

### Live path result (BUG)

| Scenario | CI current in/out | Live BASE_USER_CHARGE |
|---:|---:|---:|
| PROCUREMENT_100 | 100 / 100 | **187,200 P** (scaled fixture) |
| PROCUREMENT_70 | 70 / 70 | **131,040 P** |
| PROCUREMENT_40 | 40 / 40 | **74,880 P** |

BASE monotonically decreases as procurement discount deepens — **violates product policy**.

Test proof: `src/lib/billingStableReferencePreflightAudit.test.ts` → suite **"BUG REPRO"** (passes by asserting bug exists).

### Candidate stable-reference path (expected post-fix)

| Scenario | Candidate BASE_USER_CHARGE |
|---:|---:|
| PROCUREMENT_100 | **95 P** (published reference 2/12 @ 9% margin) |
| PROCUREMENT_70 | **95 P** (unchanged) |
| PROCUREMENT_40 | **95 P** (unchanged) |

Test proof: same file → suite **"CANDIDATE INVARIANT"** (11/11 tests pass).

---

## ROOT CAUSE

```text
Live BASE_USER_CHARGE owner: pointsReasoningMargins.ts
  resolveReasoningTokenPricing()
    → withLiveCheaperInferenceCatalogPricing(fallback)   // overlays CI CURRENT
  computeOpenRouterTurnBilling()
    → upstreamCostUsd ? ceil(usd × FX / (1−grossMargin))   // overlays CI ACTUAL
    → else token cost from current rates
```

Introduced/restored in **`1b350607`** (16 min after `9a9f576e` separation). Merged via PR #963. Extended to G37 in **`0f265825`**.

**Not** an accidental regression — it was explicit merged behavior that **conflicts with newly confirmed product policy**.

Candidate engine already exists (`publishedUserCharge.ts`) but is **not wired** to live deduction.

---

## OWNER MAP

| Responsibility | Canonical owner (current main) | Post-cutover target |
|---|---|---|
| **REFERENCE_PRICE_POLICY** | `publishedModelPricing.ts` + `modelPublishedPricingPolicy.ts` | Same (live owner) |
| **PROCUREMENT_PRICE** | `procurementCost.ts` + provider `upstreamCostUsd` | Same |
| **BILLABLE_USAGE** | `turnBillableUsage.ts` → `billingUsage.ts` | Same |
| **FX** | `exchangeRate.ts` (live); `billingFxSnapshot.ts` (charge-time lock) | Same |
| **BASE_USER_CHARGE** | `pointsReasoningMargins.ts` → `computeOpenRouterTurnBilling().baseCost` | **`publishedUserCharge.ts`** |
| **OFFICIAL_PROVIDER_PROMOTION** | `officialProviderPromotion.ts` | **KEEP — no change** |
| **SITE_PROMOTION** | `sitePromotion.ts` + `sitePromotionPolicy.ts` | **KEEP — no change** |
| **FINAL_USER_CHARGE** | `applySitePromotionToCharge()` on base → settlement | Same layering |
| **ACTUAL_PROVIDER_COST** | `procurementCost.ts` / `upstreamCostUsd` / shadow | Same |
| **ACTUAL_REALIZED_MARGIN** | `shadowPricing.ts`; receipt `billingDisplay.resolveRealizedMarginRatePercent()` | Same (observability) |
| **SETTLEMENT** | `chatBillingSettlement.ts` → `deductPointsOnDb()` | Same entry; input points from new base owner |
| **REFUND** | `refund.ts` (settled points canonical) | Same |
| **REGEN BILLING** | Same `computeTurnBilling` path per request (`REGEN_USER_CHARGE_SCOPE=REQUEST_LOCAL`) | Same owner swap |

**ONE RESPONSIBILITY = ONE OWNER:** Today BASE_USER_CHARGE has **dual effective owners** (live CI current vs published shadow). Bug class = owner violation.

---

## PUBLISHED POLICY MATRIX

Fixture note: CI catalog values below use **code fallback + calibration evidence** when live `/v1/models` not called (PROVIDER_GENERATION_CALLS=0).

### deepseek-v4-pro-0813

| Field | Value |
|---|---|
| CI reference input / output | Official list basis in published row: **0.66 / 1.98** (not CI generic 2/12) |
| CI reference cache read | **0.022** (published); cache write absent (proven zero policy) |
| Published reference in/out | **0.66 / 1.98** |
| Published target margin | **0.50** |
| Minimum margin floor | **0.40** |
| pricingVersion / publishedAt | **v2 / 2026-09-02** |
| Market benchmark | **None** in `marketUsageBenchmarks.ts` |
| Live gross margin | **0.65** (`CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN`) |
| CI current (fallback) | **0.3045 / 0.609** (~54% discount vs published ref input) |

**Policy Q&A**

| Q | Answer |
|---|---|
| A. Published ref = CI reference? | **Partially** — published row IS the intended reference-cost basis; CI catalog reference fields should align but live catalog not fetched this audit |
| B. Why differ from CI current? | CI current = procurement discount; published = discount-before policy basis |
| C. Target margin from benchmark? | **UNCONFIRMED** — no competitor benchmark row; 0.50 appears calibration-derived (Phase 2) |
| D. Human-approved row? | **Likely yes** (v2 dated 2026-09-02) but **needs GPT price review** — no benchmark citation |
| E. Stale? | **POSSIBLY** — live margin 0.65 ≠ published 0.50 |

### gemini-3.1-pro-preview

| Field | Value |
|---|---|
| CI reference (official evidence) | **2 / 12** (`GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE`) |
| CI current observed (calibration) | **1.4 / 8.4** @ 30% (`GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE`) |
| Published reference | **2 / 12** |
| Target margin / floor | **0.09 / 0.05** |
| pricingVersion / publishedAt | **v2 / 2026-08-28T15:00** |
| Market benchmark | **244.2 P** @ 40689/4307 tokens (`gemini31_competitor_a`) |
| Live gross margin | **0.50** (bug: should become 0.09 at cutover) |
| Base tier cap | **200,000** prompt tokens |

**Policy Q&A**

| Q | Answer |
|---|---|
| A. Same meaning? | **YES** for base tier — published reference matches official provider list evidence |
| B. Why differ from CI current? | CI current = procurement; not user price basis |
| C. Margin from benchmark? | **YES** — `premiumPricingCalibration.ts` selects 0.09 to match ~244.2 P competitor charge |
| D. Human-approved? | **YES** — v2 PROPOSED merged to catalog; gates pass in tests |
| E. Stale? | **NO** for reference; **YES** for live margin (0.50 legacy) |

### gemini-3.7-flash

| Field | Value |
|---|---|
| CI reference (calibration evidence) | **0.375 / 1.875** |
| CI current observed (calibration) | **0.2625 / 1.3125** @ 30% |
| Published reference | **0.375 / 1.875** (matches evidence) |
| Target margin / floor | **0.55 / 0.50** |
| pricingVersion / publishedAt | **v2 / 2026-08-28T14:00** |
| Market benchmark | **55 P** (A), **84.4 P** (B) |
| Live gross margin | **0.55** (aligned with published) |
| CI fallback current | **0.525 / 2.625** |

**Policy Q&A**

| Q | Answer |
|---|---|
| A. Same meaning? | **YES** — published v2 matches `GEMINI37_CALIBRATION_RATE_EVIDENCE.reference*` |
| B. Differ from CI current? | Procurement discount |
| C. Margin from benchmark? | **YES** — `gemini37PricingPolicy.ts` v2 gates vs 55 P / 84.4 P |
| D. Human-approved? | **YES** — v2 in catalog; shadow gates pass |
| E. Stale? | Reference **NO**; cache policy **UNKNOWN** blocks cache turns |

### gpt-5.6-terra

| Field | Value |
|---|---|
| CI reference (published) | **2 / 12** |
| CI reference cache | read **0.2**, write **2** |
| Published reference | **2 / 12** (+ cache rates) |
| Target margin / floor | **0.30 / 0.15** |
| pricingVersion / publishedAt | **v2 / 2026-09-19T00:00** (recent) |
| Market benchmark | **253 P @ 6025 chars** (embedded `marketBenchmark`) |
| Live gross margin | **0.50** (bug: should become 0.30) |

**Policy Q&A**

| Q | Answer |
|---|---|
| A. Same meaning? | **YES** — published ref matches intended list basis |
| B. Differ from CI current? | CI current procurement lower |
| C. Margin from benchmark? | **YES** — v2 dated 2026-09-19 with embedded benchmark |
| D. Human-approved? | **LIKELY** — recent v2; **needs explicit GPT Terra sign-off** |
| E. Stale? | Live margin **stale** (0.50 vs 0.30) |

---

## CI REFERENCE VS CURRENT PROCUREMENT

| Model | Reference (policy) | Current (procurement) | Typical discount |
|---|---|---|---|
| DeepSeek 0813 | 0.66 / 1.98 | 0.3045 / 0.609 | ~54% |
| Gemini 3.1 | 2 / 12 | 1.4 / 8.4 | 30% |
| Gemini 3.7 | 0.375 / 1.875 | 0.525 fallback / 0.2625 observed | varies |
| Terra | 2 / 12 | live catalog wins (fallback 2/12 list) | 0–30% |

**Invariant after fix:** BASE uses **reference** column; margin swing absorbs **current** column movement.

---

## CURRENT LIVE PRICE MATRIX

FX: 1530 / 1560.6 effective. CI current fixture: 1.4/8.4 @ 30% (matrix script). Full JSON: `PRICE_MATRIX.json`.

| Model | Shape | Live BASE P | Proc KRW | Realized margin (live path) |
|---|---|---:|---:|---:|
| DeepSeek | NORMAL | 331 | 115.7 | 0.650 |
| DeepSeek | MEMORY_HEAVY (cache) | 67 | 23.4 | 0.651 |
| DeepSeek | BOUNDED_STRESS | 674 | 235.6 | 0.650 |
| Gemini 3.1 | NORMAL | 119 | 59.2 | 0.503 |
| Gemini 3.1 | MEMORY_HEAVY | 286 | 142.5 | 0.502 |
| Gemini 3.1 | BOUNDED_STRESS (199k) | 930 | 464.8 | 0.500 |
| Gemini 3.7 | NORMAL | 187 | 83.9 | 0.551 |
| Gemini 3.7 | MEMORY_HEAVY (cache) | 128 | 57.2 | 0.553 |
| Gemini 3.7 | BOUNDED_STRESS | 312 | 140.0 | 0.551 |
| Terra | NORMAL | 75 | 37.3 | 0.503 |
| Terra | MEMORY_HEAVY | 215 | 107.1 | 0.502 |
| Terra | BOUNDED_STRESS | 339 | 168.8 | 0.502 |

Live path realizes ~**50–65%** margin (uses live grossMargin constants), **not** published target margins.

---

## CANDIDATE STABLE PRICE MATRIX

| Model | Shape | Candidate BASE P | Status | Δ vs live | Benchmark P |
|---|---|---:|---|---:|---:|
| DeepSeek | NORMAL | 90 | complete | **−241** | — |
| DeepSeek | MEMORY_HEAVY | 9 | complete | **−58** | — |
| DeepSeek | BOUNDED_STRESS | 196 | complete | **−478** | — |
| Gemini 3.1 | NORMAL | 95 | complete | −24 | 244.2 |
| Gemini 3.1 | MEMORY_HEAVY | 229 | complete | −57 | 244.2 |
| Gemini 3.1 | BOUNDED_STRESS | 745 | complete | −185 | 244.2 |
| Gemini 3.7 | NORMAL | 48 | complete | −139 | 55 |
| Gemini 3.7 | MEMORY_HEAVY | — | **blocked** cache | — | 55 |
| Gemini 3.7 | BOUNDED_STRESS | 80 | complete | −232 | 55 |
| Terra | NORMAL | 78 | complete | +3 | 253 |
| Terra | MEMORY_HEAVY | 223 | complete | +8 | 253 |
| Terra | BOUNDED_STRESS | 351 | complete | +12 | 253 |

**Large |Δ| especially DeepSeek/G37 → mandatory GPT price review before cutover.**

---

## COMPETITOR BENCHMARK EVIDENCE

| Model | Evidence source | Points | Status |
|---|---|---:|---|
| Gemini 3.1 | `marketUsageBenchmarks` gemini31_competitor_a | 244.2 | **VERIFIED** |
| Gemini 3.7 | gemini37_competitor_a/b | 55 / 84.4 | **VERIFIED** |
| Terra | `publishedModelPricing.marketBenchmark` | 253 | **VERIFIED** (embedded) |
| DeepSeek | — | — | **MISSING — STOP for cutover PASS** |

Calibration owners: `premiumPricingCalibration.ts`, `gemini37PricingPolicy.ts`.

---

## PROCUREMENT VARIANCE INVARIANT (core regression)

Fixture: `billingStableReferencePreflightAudit.test.ts`

```text
PROCUREMENT_100 > PROCUREMENT_70 > PROCUREMENT_40     ✓
BASE_100 = BASE_70 = BASE_40 (candidate)            ✓
ACTUAL_REALIZED_MARGIN_100 < _70 < _40              ✓
```

---

## UPSTREAM COST INVARIANT

| Path | Behavior | Status |
|---|---|---|
| **Live today** | `upstreamCostUsd` → `baseCost = ceil(usd × FX / (1−margin))` | **BUG reproduced** |
| **Candidate** | upstream ignored for BASE; belongs to procurement/margin telemetry | **Design confirmed** |

Tests: suite **"UPSTREAM COST INVARIANT"** — live coupling fails policy; candidate stable.

**Post-cutover:** Keep storing `upstreamCostUsd` on usage for ACTUAL_REALIZED_MARGIN — do **not** remove telemetry.

---

## OFFICIAL PROMOTION PRESERVATION

Owners **not modified**. Proofs (11 tests pass):

| Scenario | Result |
|---|---|
| CI current 100→40 | Site campaign `activatedAt` unchanged |
| CI discountPercent change | No new site promo row |
| Verified official 50% → site 30% | `FINAL < BASE` exactly once |
| Promotion off | `FINAL = BASE` |

Existing `procurementPromotionSeparation.test.ts` (12/12) remains valid for promotion layer.

---

## MAIN RP MODEL ELIGIBILITY (candidate published billing live)

| Model | No-cache turns | Cache turns | Tier >200k (G31) | Overall |
|---|---|---|---|---|
| **DeepSeek** | **COMPLETE** | Policy **verified** (proven zero write) | tier_aware — OK | **CONDITIONAL PASS** — missing benchmark |
| **Gemini 3.1** | **COMPLETE** | **BLOCKED** (cache unverified) | **BLOCKED** >200k | **PARTIAL** |
| **Gemini 3.7** | **COMPLETE** | **BLOCKED** (cache unknown) | tier_aware — needs catalog above_threshold | **PARTIAL** |
| **Terra** | **COMPLETE** | **BLOCKED** if cache used (no published policy row; cache rates exist but policy unknown) | OK | **CONDITIONAL PASS** |

**Phase history (revalidated):**

| Phase | Models | Original defer reason | Still valid? |
|---|---|---|---|
| Phase 1 | G31, G37, Opus5 | Idempotency + cache/tier UNKNOWN | **Cache/tier still block G31/G37 production shapes** |
| Phase 2 | DeepSeek | Separate price policy + cache evidence | **Engine ready no-cache; benchmark missing** |
| Deferred | Terra, Luna, etc. | Outside phase scope | Terra now has published v2 — **eligible pending review** |

**No silent fallback:** G37 MEMORY_HEAVY returns `blocked: unsupported_cache_semantics` — correct.

---

## CACHE / REASONING / TIER GATES

| Model | Cache read | Cache write | Reasoning | Tier threshold | Candidate without cache | Candidate with production cache |
|---|---|---|---|---|---|---|
| DeepSeek | verified; write proven zero | OK when read-only | included_in_output | tier_aware | PASS | **PASS** (cache hit fixture) |
| Gemini 3.1 | **unverified** | **unverified** | included_in_output | **200k base only** | PASS | **BLOCK** |
| Gemini 3.7 | **unknown** | **unknown** | included_in_output | tier_aware (CI above_threshold) | PASS | **BLOCK** |
| Terra | rates in published | rates in published | included_in_output | none in policy | PASS | **UNKNOWN** — no `modelPublishedPricingPolicy` row |

**apiCompletionTokens:** Both live and candidate treat completion as authoritative (reasoning subset).

---

## NORMAL / MEMORY_HEAVY / BOUNDED_STRESS DELTA

See **CURRENT LIVE** vs **CANDIDATE STABLE** tables above.

**Key stress findings:**

- **G31 BOUNDED 199k:** candidate 745 P vs live 930 P — tier gate OK (≤200k) but far below competitor 244 P benchmark → policy tension requires review (benchmark is competitor charge not our target).
- **G37 MEMORY_HEAVY:** production-normal shape (26k prompt, 20k cache read) → candidate **blocked** until cache semantics verified.
- **DeepSeek MEMORY_HEAVY:** candidate 9 P vs live 67 P — largest relative drop; no competitor anchor.

---

## CUTOVER DESIGN (implementation NOT in this PR)

### Target architecture

```text
resolveTurnBillableUsage()           // unchanged
  → computePublishedUserChargeWithSnapshot()  // NEW live BASE owner
  → applySitePromotionToCharge()     // unchanged
  → settleChatTurnBillingExactlyOnce()

Parallel telemetry (unchanged):
  upstreamCostUsd / procurementCost → ACTUAL_REALIZED_MARGIN
  computeShadowPricing()            // convergence check
```

### Required production changes (future PR)

1. **`pointsReasoningMargins.ts`:** Remove `withLiveCheaperInferenceCatalogPricing` from BASE path; remove `upstreamCostUsd → baseCost` shortcut.
2. **`computeTurnBilling` / route:** Wire published charge engine for Main RP CI models (phase flags or unified dispatch in `chatBillingContractDispatch.ts`).
3. **Margin source:** Use `publishedModelPricing.targetMargin` not `*_GROSS_MARGIN` live constants.
4. **FX:** Charge-time locked snapshot (`billingFxSnapshot`) — already partially wired for phase-2 DeepSeek dispatch.
5. **Blocked shapes:** Return explicit billing error / waiver policy — **never** fall back to CI current silently.
6. **Tests:** Flip `procurementPromotionSeparation.test.ts` Test B to **stable BASE** invariant; keep procurement/margin tests.

### What stays

- `officialProviderPromotion.ts`, `sitePromotion.ts`, campaign DB schema
- `procurementCost.ts`, `upstreamCostUsd` telemetry
- Published catalog rows (until GPT review adjusts)

---

## REMOVED / KEEP / FOLLOW-UP

| Item | Action |
|---|---|
| `withLiveCheaperInferenceCatalogPricing()` on BASE path | **REMOVE** at cutover |
| `upstreamCostUsd → baseCost` | **REMOVE** at cutover |
| `publishedUserCharge.ts` engine | **KEEP** — promote to live owner |
| `publishedModelPricing.ts` catalog | **KEEP** — verify DeepSeek + Terra with GPT |
| `pointsReasoningMargins *_GROSS_MARGIN` | **FOLLOW-UP** — deprecate after cutover |
| `computeCheaperInferenceMarketPreviewCost` | **KEEP** — picker only |
| Phase 1/2 feature flags in `chatBillingContractDispatch` | **KEEP** — extend for unified cutover |

---

## REGRESSION RISKS

1. **User-visible P drops/increases** — especially DeepSeek (−241 P NORMAL), G37 (−139 P).
2. **Cache-heavy turns** — blocked until semantics verified (must not 500; need product decision on waiver vs block).
3. **G31 >200k prompts** — tier block; currently live charges via CI current (unbounded).
4. **Regen / multi-stage** — must use same BASE owner per `REGEN_USER_CHARGE_SCOPE`.
5. **Receipt realized margin** — will rise when procurement discount deepens (expected).

---

## EXECUTION PATH TRACE (BASE owner today)

All paths resolve to **`computeTurnBilling()` → `computeOpenRouterTurnBilling()`** (unified reasoning models):

| Path | BASE owner today | Site promo |
|---|---|---|
| Normal Main RP | `pointsReasoningMargins` | optional |
| Regen | same per request | optional |
| Continuation / retry | same turn assembly | optional |
| Refusal fallback | delivered model billing ID | optional |
| Stealth fallback | primary delivered model | optional |
| Usage unavailable | waiver path (`shouldWaiveTurnBilling`) | n/a |
| Waiver | minimum charge resolvers in `points.ts` | n/a |
| Site promo active/inactive | base unchanged; FINAL adjusted | yes |

**Candidate:** same routing; only swap charge computation module.

---

## PROOF

```bash
# Exact HEAD
git rev-parse HEAD
# → 3c5555a2fe97f9097cf7b65aff5912574d72b805

# Pre-flight regression (11 tests)
node --conditions=react-server --import tsx --test src/lib/billingStableReferencePreflightAudit.test.ts
# → pass 11 / fail 0

# Promotion layer unchanged (12 tests)
node --conditions=react-server --import tsx --test src/lib/procurementPromotionSeparation.test.ts
# → pass 12 / fail 0

# Price matrix
node --conditions=react-server --import tsx scripts/billing-preflight-price-matrix.ts
# → docs/audits/billing-bugfix-preflight-2026-09-20/PRICE_MATRIX.json
```

---

## CLASSIFICATION

### **READY_FOR_PRICE_REVIEW**

**Rationale:** Product policy confirmed; root cause isolated; deterministic repro + candidate invariant proven; cutover design documented; **no implementation in this PR**.

**Cutover blocked until resolved (do not PASS silently):**

| Blocker | Type |
|---|---|
| DeepSeek — no competitor benchmark | POLICY_DATA |
| DeepSeek / G37 large \|ΔP\| vs live | PRICE_REVIEW |
| G37 + G31 cache semantics on production shapes | MODEL_SEMANTICS |
| G31 >200k tier policy vs live unbounded charging | MODEL_SEMANTICS |
| Terra v2 recent — explicit sign-off | PRICE_REVIEW |

---

**STOP.** Design only. MERGE = NO (draft PR for review artifacts).
