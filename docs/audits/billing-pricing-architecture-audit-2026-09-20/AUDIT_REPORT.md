# Billing / Pricing Architecture Audit

**Date:** 2026-09-20  
**Exact main HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805`  
**Mode:** READ-ONLY — no billing code changes, no cutover, no merge  
**Constraints honored:** PRODUCTION PRICE CHANGE = NO · POINT RATE CHANGE = NO · BILLING OWNER CHANGE = NO · PROMOTION CHANGE = NO · DB CHANGE = NO · PROVIDER GENERATION CALL = 0 · MERGE = NO

---

## HISTORY TIMELINE

```text
9a9f576e (2026-09-19 05:27 UTC) — PR #963 initial
  Intent: "Separate CI procurement from site promotions"
  Key invariant introduced:
    - "Stop overlaying CheaperInference live catalog rates onto user base charges"
    - resolveReasoningTokenPricing: hardcoded fallback constants only (no withLiveCheaperInferenceCatalogPricing)
    - computeOpenRouterTurnBilling: token-based baseCost only; upstreamCostUsd NOT used for user charge
    - procurementCost.ts added as separate admin/shadow owner
  Tests asserted:
    - Test A: rates.inputUsdPerMillion = 1.4 (fallback), NOT catalog current 60
    - Test B: CI current 60→55→63 changes procurement ONLY; billing.total UNCHANGED

1b350607 (2026-09-19 05:44 UTC) — 16 minutes later, same PR #963
  Intent: "Fix PR #963 billing invariant, refund concurrency, and promotion correctness"
  Explicit reversal:
    - "Restore CI current/upstream cost as normal user base price (margin policy unchanged)"
  Code restored:
    - withLiveCheaperInferenceCatalogPricing() overlays CI current rates onto base charge
    - computeOpenRouterTurnBilling: upstreamCostUsd path restored for CI models
  Tests rewritten:
    - Test A: rates.inputUsdPerMillion = catalog current (60)
    - Test B renamed: "changes normal user base charge" (totals must differ across current rates)
  Refund/concurrency/promotion fixes bundled in same commit (not isolated to pricing)

c73df2fe (2026-09-19 05:58 UTC) — PR #963 final audit
  Site promotion display, rounding, campaign timer policy — no further pricing owner change

0f265825 (2026-09-19 21:23 KST) — post-#963 on main
  Gemini 3.7 Flash: proportional token pricing (removed output cliffs)
  Terra fallback constants aligned to published reference (2/12 vs old 2.5/15)
  Added CHEAPER_INFERENCE_GEMINI_37_FLASH_* with live catalog overlay
  Did NOT revert 1b350607 CI-current→base-charge policy

current main (3c5555a2) — unchanged pricing invariant since 0f265825
```

---

## OWNER MAP

| Responsibility | Canonical owner | ONE owner? | Notes |
|---|---|:---:|---|
| Official/reference provider USD rate (OpenRouter list) | `openRouterModelPricing.ts` → `resolveOpenRouterModelRates()` | YES (OpenRouter path) | Static + CI catalog merge for cache receipt display |
| Official/reference provider USD rate (CI catalog reference) | `cheaperInferenceCatalogPricing.ts` → `reference*UsdPerMillion` fields from `/v1/models` | YES (CI reference path) | Parsed in `cheaperInferenceCatalogPricing.server.ts` |
| Published billing reference USD | `publishedModelPricing.ts` → `billingReference*UsdPerMillion` | YES | **Shadow/cutover candidate only — NOT live charge** |
| Target gross margin (live) | `pointsReasoningMargins.ts` → per-model `*_GROSS_MARGIN` constants | YES (live) | e.g. G37=0.55, DS Pro=0.65, G31=0.5 |
| Target margin (published/shadow) | `publishedModelPricing.ts` → `targetMargin` | YES (shadow) | Often differs from live margins (G31: 0.09 vs live 0.5) |
| Minimum margin floor | `publishedModelPricing.ts` → `minimumMarginFloor` | YES (shadow/calibration) | Used by shadow pricing + cutover readiness gates; **not enforced on live path** |
| CI current procurement rate | `cheaperInferenceCatalogPricing.ts` → `inputUsdPerMillion` etc. (current tier) | YES | Refreshed via `refreshCheaperInferenceCatalogPricing()` |
| CI reference/list rate | Same catalog object → `reference*UsdPerMillion` | YES | Informational; used in `procurementCost.ts` for `providerListCostUsd` |
| upstreamCostUsd (API-reported) | Provider response → `route.ts` stage assembly → passed to `computeOpenRouterTurnBilling` | YES (when present) | Authoritative actual billed USD from CI/OpenRouter |
| Raw actual procurement cost (computed) | `procurementCost.ts` → `resolveProcurementCostFromCatalog()` | YES (admin/shadow) | Uses CI **current** rates only |
| Base user point charge | `pointsReasoningMargins.ts` → `computeOpenRouterTurnBilling().baseCost` | **YES — single live formula** | CI current catalog OR upstreamCostUsd + model grossMargin |
| Official provider promotion | `officialProviderPromotion.ts` → DB `official_provider_promotions` | YES | Admin-entered, verified, exact model_id |
| Site promotion | `sitePromotion.ts` → DB `site_promotion_campaigns` | YES | Activated at verified promo create; pure read at billing |
| Final user charge | `computeOpenRouterTurnBilling().total` → `settleChatTurnBillingExactlyOnce()` | YES | baseCost after `applySitePromotionToCharge()` |
| Actual realized margin | `shadowPricing.ts` → `actualRealizedMargin` (admin telemetry) | YES (shadow/admin) | `billingDisplay.resolveRealizedMarginRatePercent()` on receipts |
| Receipt margin display | `billingDisplay.ts` → `resolveRealizedMarginRatePercent()` | YES (display) | Uses stored `apiRawCostKrw` or recomputed from upstream/catalog |

**Duplicate / non-canonical (not live owners):**

| Item | Status |
|---|---|
| `openRouterModelPricing.ts` static snapshots vs `pointsReasoningMargins.ts` constants | FOLLOW-UP — parallel fallback tables; live billing uses `pointsReasoningMargins` |
| `publishedModelPricing.ts` margins vs `pointsReasoningMargins.ts` margins | FOLLOW-UP — intentional divergence until cutover |
| `computeCheaperInferenceMarketPreviewCost()` | KEEP — model-picker estimate only; fixed 15% discount midpoint |
| `getTargetMargin()` / `getMinimumMarginFloor()` exports | KEEP — shadow-only consumers |

---

## CURRENT PRODUCTION BILLING FLOW (Main RP)

```text
selected model (route.ts)
  → refreshCheaperInferenceCatalogPricing()          [CI models only, 60s TTL]
  → resolveOpenRouterReasoningPointRates(modelId)    [pointsReasoningMargins.ts]
       resolveReasoningTokenPricing()
         → withLiveCheaperInferenceCatalogPricing(fallback)  [CI current rates overlay]
         → grossMargin from *_GROSS_MARGIN constants
  → computeOpenRouterTurnBilling()                   [pointsReasoningMargins.ts]
       upstreamCostUsd present? → baseCost = ceil(upstreamUsd × FX / (1-margin))
       else → computeReasoningPointCost() from live rates × tokens
  → resolveActiveSitePromotion(modelId)              [sitePromotion.ts — DB read only]
  → applySitePromotionToCharge(baseCost, siteDiscountPercent)
  → total → settleChatTurnBillingExactlyOnce()       [chatBillingSettlement.ts]
  → usage JSON + buildPublicBillingReceipt()         [publicBillingReceipt.ts]
  → computeShadowPricing()                           [shadow/admin telemetry — parallel, no deduction]
```

### Stage consumption table

| Stage | current discounted rate | reference rate | upstream actual | published reference | target margin | promotion discount |
|---|---|---|---|---|---|---|
| `refreshCheaperInferenceCatalogPricing` | **stores** in-memory map | **stores** reference fields | — | — | — | stores `discountPercent` (info only) |
| `resolveOpenRouterReasoningPointRates` | **consumes** current for USD/token rates | ignored | — | — | **consumes** `*_GROSS_MARGIN` | — |
| `computeOpenRouterTurnBilling` (base) | **consumes** via rates OR token cost | ignored | **consumes** if `upstreamCostUsd > 0` (CI) | — | **consumes** grossMargin | — |
| `resolveActiveSitePromotion` | ignored | ignored | — | — | — | **consumes** persisted `site_discount_pct` |
| `applySitePromotionToCharge` | — | — | — | — | — | **applies** site % on baseCost |
| `computeShadowPricing` | **consumes** for actualProviderCost | **consumes** for providerListCost | **consumes** if provided | **consumes** billingReference* | **consumes** targetMargin + floor | published promo if configured |
| `buildPublicBillingReceipt` | — | — | — | — | — | **displays** site promo only |

---

## FOUR DISTINCT ECONOMIC VALUES

### REFERENCE_COST
- **Owner:** `publishedModelPricing.ts` (`billingReference*UsdPerMillion`) for shadow/cutover; `cheaperInferenceCatalogPricing.reference*` for CI list cost; `openRouterModelPricing.ts` for OpenRouter list.
- **Live production charge:** NOT consumed.
- **Meaning:** Stable official/list basis for calibration, admin shadow, future cutover.

### PROCUREMENT_COST
- **Owner:** `procurementCost.ts` (catalog current) OR provider-reported `upstreamCostUsd`.
- **Live production charge:** When `upstreamCostUsd > 0`, base charge is derived directly from this (× FX ÷ (1−margin)). When absent, token billing uses CI **current** catalog rates — economically equivalent to procurement cost at those rates.
- **Meaning:** Actual CheaperInference discounted procurement.

### BASE_USER_CHARGE
- **Owner:** `computeOpenRouterTurnBilling().baseCost` in `pointsReasoningMargins.ts`.
- **Formula:** `ceil(procurementCostUsd × effectiveKrwPerUsd / (1 − grossMargin))` OR token-sum equivalent.
- **Promotion:** Applied AFTER this value.

### FINAL_USER_CHARGE
- **Owner:** `computeOpenRouterTurnBilling().total` after `applySitePromotionToCharge()`.
- **Settlement:** `settleChatTurnBillingExactlyOnce()` deducts this.

### Margins

| Type | Owner | Formula / meaning |
|---|---|---|
| **REFERENCE_MARGIN** | Shadow: `publishedModelPricing.targetMargin` | Policy target on billingReference cost — cutover candidate |
| **ACTUAL_REALIZED_MARGIN** | `shadowPricing.actualRealizedMargin`; receipt: `resolveRealizedMarginRatePercent()` | `1 − (actualProviderCostKrw / finalChargeKrw)` — uses upstream or catalog current as cost basis |

These are **never merged into a single live `margin` field** on the charge path. Live billing applies `grossMargin` at charge time; realized margin is observability-only.

---

## KEY QUESTIONS (code + commit evidence)

### 1. Does CI current rate change BASE_USER_CHARGE in production?
**YES — CONFIRMED.**

Evidence:
- `withLiveCheaperInferenceCatalogPricing()` overlays `live.inputUsdPerMillion` onto rate resolution (`pointsReasoningMargins.ts:236–248, 256–287`).
- `procurementPromotionSeparation.test.ts` Test B (current main): totals differ when current goes 60→55→63.
- `route.ts:1431–1433` refreshes catalog before billing on CI turns.

### 2. Is this intentional final product policy from `1b350607`?
**YES — CONFIRMED as merged PR #963 policy.**

Evidence:
- Commit message explicitly: "Restore CI current/upstream cost as normal user base price (margin policy unchanged)".
- Tests were deliberately rewritten in same commit (not accidental revert of unrelated code).
- PR #963 merged (`ad088282`); no subsequent commit re-separates procurement from base charge.
- `0f265825` extended the same pattern to G37 without reversing it.

### 3. Accidental regression of 9a9 separation invariant?
**NO for merged main — it was an explicit 16-minute policy correction within PR #963.**

The 9a9 separation was superseded intentionally before merge. Whether that correction matches long-term product intent is a **POLICY_DECISION_REQUIRED** item (see Conflicting Invariants), not an accidental code bug.

### 4. Why was 9a9 reversed 16 minutes later?
**CONFIRMED technical reason (commit message + bundled scope):**

PR #963 combined (a) procurement/promotion architecture, (b) refund concurrency, (c) public receipt simplification. The first commit (`9a9f576e`) introduced strict procurement/user-price separation. The follow-up (`1b350607`) restored the **pre-#963 production behavior** where CI current/upstream cost feeds normal user base price, while **keeping** the new site promotion layer separate.

Inferred product rationale (POLICY_INTERPRETATION — not independently documented outside commit messages):
- User base price tracks actual procurement cost + fixed gross margin (pass-through economics).
- Site promotion remains a separate verified official-promo layer (not CI `discountPercent`).
- Removing upstreamCostUsd from base charge would have changed live billing for all CI models mid-PR.

### 5. Is published pricing engine live or shadow-only?
**SHADOW-ONLY — CONFIRMED.**

Evidence:
- `publishedUserCharge.ts:3` — "Shadow/readiness only in this PR."
- `shadowPricing.ts:3` — "USER BILLING UNCHANGED: deductPoints() still uses legacy points.ts path."
- `grep getPublishedPricing src/lib/points*.ts` → **no matches** on live charge path.
- `route.ts` calls `computeShadowPricing()` for telemetry only (`~5121`); deduction uses `computeTurnBilling()`.
- `billingLiveOwnerReadinessAudit.ts` labels `CANDIDATE_PUBLISHED_CHARGE_OWNER` vs `CURRENT_LIVE_USER_CHARGE_OWNER`.

`billingReferenceInputUsdPerMillion` / `targetMargin` / `minimumMarginFloor` in `publishedModelPricing.ts` mean:
- **Stable user-price reference** for cutover simulation and admin calibration.
- **NOT** the production base charge owner today.
- **Cutover candidate** — documented in `docs/audits/live-billing-cutover-readiness.md` (all models BLOCKED).

### 6. Is official provider promotion fully separated from CI discount?
**YES — CONFIRMED.**

Evidence:
- `sitePromotion.ts:3` — "CheaperInference catalog discount is NEVER a site promotion signal."
- `officialProviderPromotion.ts` requires admin `verified_at` + exact `model_id`.
- `procurementPromotionSeparation.test.ts` Test H: CI `discountPercent: 75` → no site promo row, baseCost = total.
- Site campaigns created only via `createOfficialProviderPromotion()` → `activateSitePromotionCampaign()`.

### 7. Is verified official promo → site promotion auto-apply path preserved?
**YES — CONFIRMED.**

Evidence:
- `createOfficialProviderPromotion()` calls `activateSitePromotionCampaign()` when `verifiedAt` set.
- `computeOpenRouterTurnBilling()` → `resolveActiveSitePromotion()` → `applySitePromotionToCharge()`.
- Tests D/E/F, explicit 50%→30% billing test, model-specific scope test all pass (12/12).

### 8. Does CI procurement discount change affect site promotion timer/discount?
**NO — CONFIRMED.**

Evidence:
- Campaign `activated_at` / `ends_at` set at activation (`sitePromotion.ts:127–131`), not on billing read.
- Test F: official discount change within episode updates `site_discount_pct` but **does not reset** `activatedAt`.
- CI catalog refresh has no import of `sitePromotion.ts`.

---

## ABSOLUTE SEPARATION INVARIANT (A / B / C)

| Concept | Owner | Must NOT be conflated with |
|---|---|---|
| **A. CI procurement discount** | Catalog `input_per_million` (current) + `discountPercent` | B, C |
| **B. Official provider promotion** | `official_provider_promotions` (verified admin) | A, C |
| **C. Site promotion** | `site_promotion_campaigns` (60% pass-through, max 7 days) | A |

**Current main status:**
- A → base charge: **linked** (CI current drives BASE_USER_CHARGE) — this is product policy, not conflation with B/C.
- A → B/C: **separated** — CI `discountPercent` does not create promotions.
- B → C: **linked by design** — verified official promo activates site campaign once.

---

## CONFLICTING INVARIANTS (reported, not hidden)

| Source A | Claims | Source B | Claims | Resolution on main |
|---|---|---|---|---|
| `9a9f576e` + initial tests | CI current must NOT change user base charge | `1b350607` + current tests | CI current MUST change user base charge | **1b350607 wins** (merged) |
| `publishedModelPricing.ts` | G31 targetMargin=0.09, Terra=0.3, DS=0.5 | `pointsReasoningMargins.ts` | G31=0.5, Terra=0.5, DS=0.65 live grossMargin | **Live margins win**; published is shadow/cutover |
| `docs/audits/live-billing-cutover-readiness.md` | G37 live owner = gemini37FlashPricing cliffs | `0f265825` + current code | G37 unified proportional in pointsReasoningMargins | **Doc stale** — code moved to proportional |
| PR #989 `BILLING_GATE: PASS` | Realized margins meet canonical floors via live billing | This audit | Live grossMargin ≠ published minimumMarginFloor for several models | **BILLING_POLICY_SEMANTICS_UNRESOLVED** for #989 |

---

## CURRENT CANONICAL POLICY

| Policy | Status |
|---|---|
| CI current catalog rate (+ upstreamCostUsd when reported) → base user charge at per-model grossMargin | **CONFIRMED** (since `1b350607`, extended by `0f265825`) |
| CI reference / discountPercent → NOT site promotion | **CONFIRMED** |
| Verified official provider promo → site campaign (separate layer) | **CONFIRMED** |
| Published pricing engine → shadow/cutover candidate only | **CONFIRMED** |
| 9a9 strict procurement/user-price separation | **SUPERSEDED** (not current main) |
| Long-term intent: should user price decouple from CI procurement swings? | **UNCONFIRMED** — requires product owner decision before any cutover |

---

## REGRESSION TEST INVENTORY

| Test file | Policy asserted |
|---|---|
| `procurementPromotionSeparation.test.ts` | CI current → base charge; reference/discountPercent ≠ site promo; verified official → site 30%; campaign timer immutability; CI discount ≠ site row |
| `sitePromotionPolicy.test.ts` | official×0.6 → nearest 10% site discount; ceil rounding on final charge |
| `sitePromotionDisplay.test.ts` | UI badge/notice from `resolveActiveSitePromotion` only |
| `sitePromotionClientLifecycle.test.ts` | Client view lifecycle / parity |
| `points.reasoning-margin.test.ts` | Muse/DS/Gemini36: static list USD × FX ÷ (1−margin); API tokens authoritative |
| `points.gemini31CheaperInference.test.ts` | Fallback 1.4/8.4 @ 50% margin; upstreamCostUsd overrides token calc |
| `points.gemini37Flash.test.ts` | Proportional token billing @ 55%; live catalog + cache; no output cliffs |
| `points.terra.test.ts` / `points.luna.test.ts` / etc. | Per-model live CI overlay + margin |
| `publishedModelPricing.test.ts` | billingReference independent of provider list; shadow calibration gates |
| `shadowPricing.test.ts` | reference=list, current=discounted; USER BILLING UNCHANGED |
| `billingDisplay.marginRate.test.ts` | Realized margin from apiRawCostKrw / upstream / catalog fallback |
| `billingLiveOwnerReadinessAudit.test.ts` | Live vs candidate published charge divergence diagnostics |
| `liveBillingCutoverReadiness.test.ts` | Cutover classification — no live switch |
| `deepseekPhase2PublishedBillingCutover.test.ts` | Published cutover simulation (not live) |

**Cross-test conflict (documented):** 9a9-era Test A/B assertions vs current Test A/B — resolved by `1b350607` rewrite.

---

## SAFE TO DELETE / KEEP / FOLLOW-UP

| Item | Classification | Rationale |
|---|---|---|
| `procurementCost.ts` | KEEP | Canonical procurement snapshot; admin/shadow |
| `publishedModelPricing.ts` + `publishedUserCharge.ts` | KEEP | Shadow/cutover candidate — not live |
| `shadowPricing.ts` | KEEP | Admin telemetry; explicit non-live |
| `withLiveCheaperInferenceCatalogPricing()` | KEEP | **Live production owner** |
| Duplicate USD constants in `openRouterModelPricing.ts` vs `pointsReasoningMargins.ts` | FOLLOW-UP | Parallel fallbacks; drift risk (Terra 2/12 updated in 0f265825 on one side) |
| `computeCheaperInferenceMarketPreviewCost()` | KEEP | Model picker — explicitly not turn billing |
| `getTargetMargin()` / `getMinimumMarginFloor()` | KEEP | Shadow consumers only |
| 9a9-era separation comments (removed) | SAFE TO DELETE | Already gone; do not restore without product decision |
| Stale G37 cliff owner in `live-billing-cutover-readiness.md` | FOLLOW-UP | Doc update only |
| `gemini37FlashPricing.ts` cliff tables (if any remain) | FOLLOW-UP | Verify dead after 0f265825 — do not delete without usage audit |

---

## IMPACT ON PR #989

PR #989 (`cursor/forensic-memory-cost-audit-95f9`) claims:
- `BILLING_GATE: realized margins meet canonical floors`
- `SAFE_FOR_SEPARATE_FEATURE_PR` for memory/context work

**This audit finding:** `BILLING_POLICY_SEMANTICS_UNRESOLVED`

Reasons:
1. PR #989 margin matrix uses live `computeOpenRouterTurnBilling` with `pointsReasoningMargins.ts` grossMargin floors — valid for **current** production policy.
2. It does **not** resolve whether CI-current-linked base charge is the intended long-term invariant (9a9 vs 1b350607 product question).
3. Published `minimumMarginFloor` differs from live `grossMargin` for G31/Terra/DS — cutover semantics remain open.
4. Memory/context findings (Creator 20 attach, 4K injection, Global10/15, headroom) remain **`SAFE_FOR_SEPARATE_FEATURE_PR`** only for **non-billing** scope.
5. Do **not** use #989 `BILLING_GATE` as canonical billing architecture sign-off until product confirms 1b350607 policy vs 9a9 separation intent.

**No changes made to PR #989 branch.**

---

## RECOMMENDED NEXT ACTION

1. **Product owner decision (BLOCKING for any pricing cutover):** Confirm whether BASE_USER_CHARGE should track CI current procurement (1b350607 policy) or decouple to stable published reference (9a9 policy).
2. **If decouple desired:** Separate PR — do not bundle with memory/context (#989).
3. **If pass-through confirmed:** Document as canonical billing policy in `AGENTS.md` or billing policy doc; update stale cutover readiness doc (G37 owner).
4. **Do not merge PR #989 billing-gate claims** as architecture resolution — treat as forensic context-only.
5. **No code changes from this audit.**

---

## PROOF

### Exact HEAD
```bash
$ git rev-parse HEAD
3c5555a2fe97f9097cf7b65aff5912574d72b805
```

### Commit messages
```bash
$ git log --oneline 9a9f576e^..0f265825 -- src/lib/pointsReasoningMargins.ts
0f265825 refactor(billing): move Gemini 3.7 to proportional token pricing
1b350607 Fix PR #963 billing invariant, refund concurrency, and promotion correctness
9a9f576e Separate CI procurement from site promotions; simplify public receipt
```

### Test B policy (current main) — 12/12 pass
```bash
$ node --conditions=react-server --import tsx --test src/lib/procurementPromotionSeparation.test.ts
# tests 12 | pass 12 | fail 0
```

Key assertion (Test B): `billing.baseCost === expectedBaseChargeFromCurrentRates(..., current, current)` and `totals[0] != totals[1]`.

### 9a9 vs 1b350607 test B diff
- 9a9: `assert.equal(billing.total, baseBilling.total)` — totals **unchanged** across CI current swings.
- 1b350607+: `assert.notEqual(totals[0], totals[1])` — totals **change** with CI current.

### Live path code anchors
- `pointsReasoningMargins.ts:250–254` — comment: "CI current/effective catalog = normal procurement cost → target gross margin"
- `pointsReasoningMargins.ts:599–619` — upstreamCostUsd priority for baseCost
- `sitePromotion.ts:3` — CI discount never site promotion
- `publishedUserCharge.ts:3` — shadow/readiness only
- `shadowPricing.ts:3` — USER BILLING UNCHANGED

### Published vs live margin divergence (example)
| Model | published targetMargin | live grossMargin |
|---|---:|---:|
| gemini-3.1-pro-preview | 0.09 | 0.50 |
| gpt-5.6-terra | 0.30 | 0.50 |
| deepseek-v4-pro-0813 | 0.50 | 0.65 |
| gemini-3.7-flash | 0.55 | 0.55 |

---

**STOP.** No implementation. MERGE = NO.
