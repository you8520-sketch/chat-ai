# Billing / Provider Pricing Semantics Audit

**Date:** 2026-09-20  
**Exact HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805` (+ PR #991 correction commits)  
**Draft PR:** #991 (audit correction only)  
**Mode:** READ-ONLY — **no pricing row edits, no cutover, no merge**  
**Constraints:** RUNTIME_CHANGE=NO · POINT_RATE_CHANGE=NO · BILLING_CUTOVER=NO · PROMOTION_CHANGE=NO · DB_CHANGE=NO · MERGE=NO

---

## EXACT HEAD

| Field | Value |
|---|---|
| Repository HEAD (architecture baseline) | `3c5555a2fe97f9097cf7b65aff5912574d72b805` |
| PR #991 branch | `cursor/billing-bugfix-preflight-audit-d09d` |
| Stable-reference cutover | **STOP** (unchanged) |
| Provider generation calls this audit | **0** |

---

## PROVIDER PRICING MODE MAP

| Mode | Google G37 (official, 2026-09-20) | DeepSeek | Repo models this? |
|---|---|---|---|
| **A. Standard PayGo intro** | $0.75 / $3.75 in/out through 2026-12-31; cache read $0.075/M | — | `GOOGLE_STANDARD_STRESS_RATES` diagnostic only |
| **B. Standard PayGo post-intro** | $1.50 / $7.50 from 2027-01-01 | — | Not in published rows |
| **C. Flex PayGo intro** | $0.375 / $1.875 (half Standard intro) | — | **Not named** — collapsed into rates |
| **D. Batch intro** | Same half-rate as Flex | — | **Not named** |
| **E. Context cache read** | $0.075/M intro → $0.15/M post-intro | V4 Pro: $0.022 off-peak / $0.044 peak cache hit | Partial (G37 cache **unverified**) |
| **F. Provisioned Throughput credit** | GCP 50% promotional credit 2026-08-13–2026-12-31 | — | **Not in repo** — distinct from Flex 50% |
| **G. Peak/off-peak time tier** | — | V4 Pro + V4.1 Flash UTC windows | **Not in repo** as billing tier |
| **H. CI marketplace discount** | CI `discountPercent` (~30%) on current rates | CI current ≠ list | `cheaperInferenceCatalogPricing` current vs reference |

**Key finding:** The codebase does **not** encode Google Flex/Batch/Standard as separate billing modes. It stores flat USD/M pairs and conflates “CI reference” with “provider undiscounted list” in calibration gates.

Sources: [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Google Cloud Agent Platform pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing), [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing).

---

## GOOGLE G37 STANDARD / FLEX / BATCH / PROMO

| Tier | Input / Output ($/M) | Valid through | Same 50% as Flex? |
|---|---|---|---|
| Standard PayGo (intro) | 0.75 / 3.75 | 2026-12-31 | No — this is the headline list rate |
| Standard PayGo (post-intro) | 1.50 / 7.50 | 2027-01-01+ | — |
| Flex PayGo (intro) | 0.375 / 1.875 | 2026-12-31 | Yes — half of Standard intro |
| Batch (intro) | 0.375 / 1.875 | 2026-12-31 | Same as Flex |
| Cache read (intro) | 0.075 | 2026-12-31 | Half of Standard cache read |
| Provisioned Throughput promo | 50% **credit** on PT spend | 2026-08-13–2026-12-31 | **Different instrument** — not Flex pricing |

Introductory Standard pricing (A) is a **temporary list price**, not the same semantic class as Flex/Batch half-rate (C/D) or GCP PT credit (F).

---

## CI G37 LIST / CURRENT

| Field | Input / Output ($/M) | Discount | Aligns with |
|---|---|---|---|
| **CI list (reference)** | 0.75 / 3.75 | — | Google **Standard intro** |
| **CI current (procurement)** | 0.525 / 2.625 | 30% | Standard × 0.7 (marketplace discount) |
| **Calibration snapshot ref (2026-08-28)** | 0.375 / 1.875 | — | Google **Flex/Batch intro** |
| **Calibration snapshot current** | 0.2625 / 1.3125 | 30% | Flex/Batch × 0.7 |
| **Live fallback (`pointsReasoningMargins`)** | 0.525 / 2.625 | — | Standard discounted — **not** published 0.375 |

**Conclusion:** `CI list = stable undiscounted provider list` is **false** for G37 when “list” means Google Standard. CI list tracks Standard; published v2 reference tracks Flex/Batch.

---

## G37 PUBLISHED ROW PROVENANCE

| Field | Value |
|---|---|
| Published reference | **0.375 / 1.875** @ 55% target margin, v2, 2026-08-28 |
| Source commit | `d9788dc7` — PR #709 “shadow: Gemini 3.7 Flash published pricing v2 calibration” |
| Evidence object | `GEMINI37_CALIBRATION_RATE_EVIDENCE` — `sourceKind: "provider_public_model_page"` |
| Competitor gates | Benchmark A/B pass at 55% using **0.375/1.875** basis |
| Standard stress diagnostic | `computeDirectStandardStressMargin()` — published v2 vs Google Standard 0.75/3.75 yields **~10% margin** on benchmark A (confirms published basis is **not** Standard) |

### Provenance questions (unresolved)

| Question | Finding |
|---|---|
| Why published = Flex/Batch? | PR #709 copied CI **reference** fields from 2026-08-28 snapshot (0.375/1.875). No commit message documents intentional Flex-as-baseline choice. |
| Was Flex intentionally chosen? | **Not proven.** Acceptance gate `UNCACHED_TARGET_MARGIN_SEMANTICS_MATCH_PROVIDER_LIST` treats CI reference as “provider list” — at calibration time that equaled Flex/Batch, not Google Standard. |
| Did Google Standard price differ at calibration? | Google Standard intro 0.75/3.75 was already published at GA (2026-08-13). Standard did not change; **wrong tier was selected or CI page showed Flex-equivalent reference**. |
| Competitor benchmark assumed which mode? | Competitor end-user P (55P / 84.4P) aligns with **basis C (Flex-shaped)** our P, not basis A (Standard). Competitor likely prices on Standard or blended retail — mode unverified. |
| Does production use Flex procurement? | **Unverified.** Interactive chat uses CI `/v1/chat/completions` — no Flex/Batch flag in repo routing. No evidence of Flex-compatible procurement path. |

**Status:** `G37_PUBLISHED_ROW_PROVENANCE = UNCLEAR` — **do not promote published G37 row to live** without product decision on baseline mode.

---

## G37 THREE-BASIS BENCHMARK MATRIX

FX: 1530 KRW/USD × 1.02 fee → **1560.6 effective**. Target margin: **55%**. CI procurement: **0.2625 / 1.3125** (calibration current). Full JSON: `G37_THREE_BASIS_MATRIX.json`.

### Benchmark A — 24,952 in / 2,367 out (competitor **55P**)

| Basis | Ref KRW | Our P | Δ vs competitor | CI proc KRW | Realized margin @ our P |
|---|---:|---:|---:|---:|---:|
| **A — Standard intro** 0.75/3.75 | 43.1 | **96** | +41 (+74.5%) | 15.1 | 0.80 |
| **B — Post-intro Standard** 1.50/7.50 | 86.1 | **192** | +137 (+249%) | 15.1 | 0.90 |
| **C — Flex/Batch intro** 0.375/1.875 | 21.5 | **48** | −7 (−12.7%) | 15.1 | 0.70 |
| *Published v2 (same as C)* | 21.5 | **48** | −7 (−12.7%) | 15.1 | 0.70 |

### Benchmark B — 42,195 in / 3,862 out (competitor **84.4P**)

| Basis | Ref KRW | Our P | Δ vs competitor | CI proc KRW | Realized margin @ our P |
|---|---:|---:|---:|---:|---:|
| **A — Standard intro** | 72.0 | **160** | +75.6 (+89.6%) | 25.2 | 0.80 |
| **B — Post-intro Standard** | 144.0 | **320** | +235.6 (+279%) | 25.2 | 0.90 |
| **C — Flex/Batch intro** | 36.0 | **80** | −4.4 (−5.2%) | 25.2 | 0.70 |

**Audit note:** Cursor does **not** select the correct basis. Matrix is for GPT/product review only.

---

## DEEPSEEK ANNOUNCEMENT TIMELINE

| Date | Event | Source |
|---|---|---|
| 2026-09-10 | V4.1-Flash released; plan to route `deepseek-v4-pro` → Flash at Flash rates from 2026-09-14 | [news260910](https://api-docs.deepseek.com/news/news260910) |
| 2026-09-11 | **Reversal** — V4 Pro continues after Sept 14, billing unchanged | [Change Log](https://api-docs.deepseek.com/updates) |
| 2026-09-14 | Deadline passed; V4 Pro still serving | Third-party confirmation + official pricing footnote |
| Current official | `deepseek-v4-pro` → DeepSeek-V4-Pro-0813; `deepseek-flash` → V4.1-Flash | [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) |

**Supersession proof:** Current official docs **supersede** the Sept 10 retirement announcement. Do **not** canonicalize V4 Pro → Flash based on old announcement alone.

---

## CURRENT DEEPSEEK ROUTING TRUTH (REPO)

| Role | Canonical ID | Notes |
|---|---|---|
| CI Pro outbound | `deepseek-v4-pro-0813` | Published billing row |
| Legacy alias | `deepseek-v4-pro` → `0813` | `publishedModelAliases.ts` |
| CI Flash outbound | `deepseek-v4-flash-0731` | Retired from user picker |
| Official API Flash name | `deepseek-flash` | **Not wired** as CI model id in repo |
| Failover | 1 external attempt main RP; no cross-provider failover | `deepseekProviderFailover.ts` |

No repo change recommended this audit.

---

## CI DEEPSEEK MODEL IDENTITY MAP

**Live `/v1/models` fetch:** not performed (PROVIDER_GENERATION_CALLS=0). Inventory from repo constants + official docs crosswalk.

| ID | In repo? | Official maps to | Published row | CI evidence in repo |
|---|---|---|---|---|
| `deepseek-v4-pro-0813` | Yes (canonical) | V4-Pro-0813 | 0.66 / 1.98 ref | current 0.3045 / 0.609 |
| `deepseek-v4-pro` | Alias only | Same as 0813 | → 0813 | — |
| `deepseek-v4-flash-0731` | Yes (background) | Legacy → V4.1 Flash | v1 row 0.098/0.196 | fallback constants |
| `deepseek-v4-flash` | Alias → default picker | Legacy → V4.1 Flash | — | — |
| `deepseek-v4.1-flash` | **No** | V4.1-Flash | — | — |
| `deepseek-flash` | **No** (official API name) | V4.1-Flash | — | — |

If CI catalog exposes V4-Pro-0813 and V4.1-Flash as **separate records**, billing should keep them separate — repo already does for Pro vs Flash-0731.

---

## V4 PRO PEAK/OFF-PEAK MATRIX

Official peak: UTC Mon–Fri 01:00–04:00, 06:00–10:00. Off-peak = half of peak.

| Tier | Cache miss in | Output | Published v2 ref | Match? |
|---|---:|---:|---:|---|
| Off-peak | 0.66 | 1.98 | **0.66 / 1.98** | **Yes** |
| Peak | 1.32 | 3.96 | — | Published uses **off-peak**, not peak |
| CI current | 0.3045 | 0.609 | — | Marketplace discount on top |

### NORMAL shape (33,247 in / 3,461 out) — selected rows

| Tier | Raw KRW | Published-base P (50% margin) | CI proc KRW |
|---|---:|---:|---:|
| Off-peak official | 44.9 | 90 | — |
| Peak official | 89.8 | 180 | — |
| CI current | 18.7 | — | 18.7 |

Full matrix: `DEEPSEEK_MATRIX.json`. **COMPETITOR_BENCHMARK_MISSING** for DeepSeek.

**Policy gap:** Product policy says PROVIDER_NORMAL_BASELINE = **peak** for DeepSeek; published row = **off-peak**. Requires pricing-policy review before cutover — not implemented here.

---

## V4.1 FLASH MATRIX

Separate from V4 Pro — not mixed in matrices.

| Tier | Cache miss in / out ($/M) |
|---|---|
| Off-peak | 0.15 / 0.60 |
| Peak | 0.30 / 1.20 |

Repo routes legacy flash IDs; no published v2 Pro-equivalent row for V4.1 Flash main RP.

---

## DELIVERED MODEL RUNTIME EVIDENCE

| Source | Captures returned model? | Persisted for prod audit? |
|---|---|---|
| Provider response `model` | Yes — `responseModelId` in `TokenUsage` / `StageUsage` (`ai.ts`) | **Stripped** — `usage.stages[]` persists `model` (requested), not `responseModelId` |
| `usageReportingEvidence` | Runtime only | Stripped before DB (`usageReportingEvidence.ts`) |
| `deliveredModelId` | Set in chat route on handoff | Admin-only `billingContractDispatch` |
| `providerCostLedger` | `requested_model` / `actual_model` | Admin finance — not surveyed at scale this audit |
| Railway production logs | GPT inspection: no DeepSeek hits | Insufficient |

**Verdict:** `DELIVERED_MODEL_RUNTIME_UNVERIFIED` for production DeepSeek (and G37 Flex vs Standard delivery).

---

## PROMOTION DOUBLE-APPLICATION RISK

Promotion stack: `officialProviderPromotion` → verified → `sitePromotion` (60% pass-through, nearest 10%) → `applySitePromotionToCharge` on BASE.

| Case | BASE basis | Site promo | Risk |
|---|---|---|---|
| **A** | Already uses official **introductory** Standard price | Active (e.g. 50% official → 30% site) | **DOUBLE-DISCOUNT RISK** — intro embedded in BASE + site layer |
| **B** | Non-promotional baseline (peak Standard / full list) | Active | Expected layered behavior (BASE 100 → FINAL 70 @ 30% site) |
| **C** | Unchanged | None | Flex/off-peak/CI discount moves procurement + realized margin only; BASE must not move (live bug when BASE follows CI current) |

**Explicit exclusions (confirmed in code):**

- Flex/Batch half-rate → **not** auto-registered as site promotion
- CI `discountPercent` → **never** site promotion (`sitePromotion.ts` line 3)
- DeepSeek off-peak → **must not** be official site promotion (procurement tier only)

Deterministic cases: `SEMANTICS_MATRIX.json` → `promotionDoubleApplication`.

---

## OWNER MAP

| Dimension | Intended owner | Current live owner | Notes |
|---|---|---|---|
| PROVIDER_NORMAL_BASELINE | `publishedModelPricing` billingReference* | `pointsReasoningMargins` + CI overlay | G37: published=Flex, CI list=Standard |
| OFFICIAL_TEMP_PROMO | `officialProviderPromotion.ts` | Same | Verified admin rows only |
| PROCUREMENT_TIER | `procurementCost.ts` | Same (+ incorrectly BASE via upstream) | Off-peak, Flex if procured, CI current |
| CI_REFERENCE_QUOTE | CI catalog `reference_*` | Calibration evidence | Informational — not proven universal list |
| CI_CURRENT_PROCUREMENT | CI catalog current rates | `withLiveCheaperInferenceCatalogPricing` | ~30% marketplace |
| ACTUAL_UPSTREAM_COST | `providerCostLedger`, `upstreamCostUsd` | Same | Settlement truth |
| BASE_USER_CHARGE | `publishedUserCharge.ts` | `pointsReasoningMargins.ts` | Cutover STOP |
| SITE_PROMOTION | `sitePromotion.ts` | Same | On BASE only |
| FINAL_USER_CHARGE | BASE − site promo + surcharges | `pointsReasoningMargins.ts` | — |
| ACTUAL_REALIZED_MARGIN | Admin / shadow | upstream vs charged | Procurement-sensitive |

Full map: `SEMANTICS_MATRIX.json` → `ownerMap`.

---

## RECOMMENDED CANONICAL DIMENSIONS

Existing structure **can** host all dimensions without a parallel engine, provided:

1. **PROVIDER_NORMAL_BASELINE** — explicit mode tag per model (Standard vs peak vs tier cap) in published row metadata (future schema — not added this audit).
2. **PROCUREMENT_TIER** — time/mode actuals in `procurementCost` only.
3. **CI_REFERENCE_QUOTE** — never auto-equated to PROVIDER_NORMAL_BASELINE without mode proof.
4. **Separate acceptance gates** — retire `UNCACHED_TARGET_MARGIN_SEMANTICS_MATCH_PROVIDER_LIST` when it means “CI reference” instead of “Google Standard list”.

---

## BLOCKERS

| # | Blocker | Blocks |
|---|---|---|
| 1 | G37 published row provenance unclear (Flex/Batch vs Standard) | Live promotion of published v2 G37 |
| 2 | `CI list = undiscounted list` assumption false for G37 | Stable-reference cutover sign-off |
| 3 | DeepSeek published ref = off-peak, policy says peak baseline | DeepSeek BASE recalibration |
| 4 | `DELIVERED_MODEL_RUNTIME_UNVERIFIED` | Flex vs Standard procurement proof |
| 5 | Product decision required: Google baseline mode for G37 | Any reference rate change |

**Non-blockers (documented):** Promotion double-discount is semantic risk (Case A), not code double-apply. DeepSeek Sept 14 routing resolved by official reversal. CI marketplace discount correctly excluded from site promotion.

---

## PROOF

| Artifact | Path |
|---|---|
| Semantics audit module | `src/lib/billingPricingSemanticsAudit.ts` |
| Matrix generator | `scripts/billing-pricing-semantics-matrix.ts` |
| Tests (7) | `src/lib/billingPricingSemanticsAudit.test.ts` |
| Combined JSON | `docs/audits/billing-provider-pricing-semantics-2026-09-20/SEMANTICS_MATRIX.json` |
| G37 three-basis | `G37_THREE_BASIS_MATRIX.json` |
| DeepSeek matrix | `DEEPSEEK_MATRIX.json` |
| Prior preflight | `docs/audits/billing-bugfix-preflight-2026-09-20/` |
| G37 calibration commit | `d9788dc7` (PR #709) |
| Google pricing | https://ai.google.dev/gemini-api/docs/pricing |
| DeepSeek pricing | https://api-docs.deepseek.com/quick_start/pricing |

**Tests run:** `billingPricingSemanticsAudit.test.ts` 7/7 pass; `typecheck:app` clean.

---

## CLASSIFICATION

**`BLOCKED_BY_PROVIDER_IDENTITY`**

Reason: G37 published reference mode unconfirmed; CI list vs published reference diverge (Standard vs Flex/Batch); production delivered model / procurement tier unverified. Promotion semantics are auditable but baseline identity must be decided first.

**Not classified as:**

- `PRICING_SEMANTICS_READY_FOR_GPT_DECISION` — blockers above remain
- `BLOCKED_BY_PROMOTION_SEMANTICS` — owner separation exists; Case A is policy not wiring bug

---

**MERGE = NO · BILLING_CUTOVER = NO · STOP**
