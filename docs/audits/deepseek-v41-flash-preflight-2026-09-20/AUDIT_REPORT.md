# DeepSeek V4.1 Flash — Feature Pre-Flight

**Date:** 2026-09-20  
**Exact main HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805`  
**Branch:** `cursor/deepseek-v41-flash-preflight-d09d`  
**Mode:** Pre-flight only — **no picker, no live billing, MERGE=NO**  
**Product positioning:** V4 Pro = Premium/quality · V4.1 Flash = Fast/Value (**not** a Pro replacement)

---

## EXACT MAIN HEAD

| Field | Value |
|---|---|
| `origin/main` | `3c5555a2fe97f9097cf7b65aff5912574d72b805` |
| Pre-flight branch | `cursor/deepseek-v41-flash-preflight-d09d` |
| PRICE_CUTOVER | **NO** |
| Live provider calls | Probe 4 + RP A/B 20 (bounded) |

---

## OWNER MAP

| Concern | Canonical owner (main) |
|---|---|
| Main RP registry / picker | `src/lib/chatModels.ts` — `MAIN_RP_USER_SELECTABLE_OPTIONS`, `DEFAULT_SELECTED_AI` |
| CI routing | `src/app/api/chat/route.ts` → `streamOpenRouterAdult` / `openRouterAdult.ts` |
| CI wire adapter | `src/lib/cheaperInferenceConfig.ts` — `adaptCheaperInferenceChatBody`, `applyCheaperInferenceModelReasoningPolicy` |
| DeepSeek failover | `src/lib/deepseekProviderFailover.ts` |
| Model aliases (published billing) | `src/lib/publishedModelAliases.ts` |
| Legacy picker remap | `LEGACY_TO_SELECTED` in `chatModels.ts` |
| Live BASE charge | `src/lib/pointsReasoningMargins.ts` |
| Published catalog (shadow) | `src/lib/publishedModelPricing.ts` |
| Published charge engine | `src/lib/publishedUserCharge.ts` |
| Cache/tier policy | `src/lib/modelPublishedPricingPolicy.ts` |
| Procurement | `src/lib/procurementCost.ts` |
| Usage parse | `src/lib/openRouterUsage.ts` — `cached_tokens`, `cache_write_tokens`, `reasoning_tokens` |
| Returned model (runtime) | `TokenUsage.responseModelId` in stream; ledger `actual_model` = `responseModelId ?? stage.model` |
| Persisted stages | `usage.stages[]` — **requested** `model` only (not `responseModelId`) |
| Admin receipt | `adminBillingReceiptV3Shared.ts`, `AdminBillingReceiptV2Panel.tsx` |
| Production prompt | `src/services/contextBuilder.ts` — `buildContext()` |

---

## MODEL IDENTITY MAP

| Stage | V4 Pro | V4.1 Flash (candidate) | Legacy 0731 |
|---|---|---|---|
| **CI catalog id** | `deepseek-v4-pro-0813` | **`deepseek-v4.1-flash`** | `deepseek-v4-flash-0731` (distinct CI row) |
| Official API name | `deepseek-v4-pro` | **`deepseek-flash`** | legacy names → V4.1 Flash |
| Requested (Main RP today) | `deepseek-v4-pro-0813` | *not in picker* | background only |
| Returned (probe/A/B) | `deepseek-v4-pro-0813` (usually) | **`deepseek-v4.1-flash`** | — |
| Billing (live) | `deepseek-v4-pro-0813` | — | `deepseek-v4-flash-0731` (background) |
| Published row | v2 `0.66/1.98` | **none** | v1 `0.098/0.196` |
| `isCheaperInferenceModel` | yes | **no** (not registered) |
| Failover wrapper | yes (`native_pro`) | **no** (passes through CI transport only) |

### Legacy alias classification

| ID | Verdict | Notes |
|---|---|---|
| `deepseek-v4-flash-0731` | **KEEP** | Do **not** overwrite with v4.1-flash; separate CI pricing & background callers |
| `deepseek-v4-flash` | **MIGRATE** | Wire → 0731 today; future user-facing id should be `deepseek-v4.1-flash` |
| `deepseek-v4.1-flash` | **FOLLOW-UP** | Add to `chatModels.ts` as new constant; separate from 0731 |
| `deepseek-flash` | **FOLLOW-UP** | Official name; map only if direct DeepSeek API path added |

---

## PROVIDER CAPABILITIES

| Capability | DeepSeek official | CI `deepseek-v4.1-flash` (2026-09-20) |
|---|---|---|
| Context | 1M | 1,048,576 |
| Max output | 384K | 384,000 |
| Vision | ✓ | not exposed in CI metadata |
| Thinking mode | non-thinking + thinking (default) | RP path forces **thinking disabled** via `openRouterClient` deepseek family |
| Tool calls | ✓ | not audited this pass |
| Streaming | ✓ | ✓ (verified A/B) |
| Cache hit/miss pricing | ✓ separate rates | ✓ CI list aligns with **peak** official |
| Concurrency | 2500 (Flash) | not measured |
| Response `model` field | yes | **matches requested** on probe + most A/B turns |

Official source: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)

---

## PEAK / OFF-PEAK PRICING

Product decision (this preflight):

| Model | PROVIDER_NORMAL_BASELINE (peak) | PROCUREMENT_TIER (off-peak) |
|---|---|---|
| **V4 Pro** | in **$1.32** / out **$3.96** / cache hit **$0.044** | half rates — does **not** change BASE |
| **V4.1 Flash** | in **$0.30** / out **$1.20** / cache hit **$0.006** | in $0.15 / out $0.60 / hit $0.003 |

CI list for `deepseek-v4.1-flash` (**0.30 / 1.20**) matches **Flash peak** baseline (not off-peak 0.15/0.60).

CI list for `deepseek-v4-pro-0813` (**0.66 / 1.98**) remains **off-peak-shaped** vs new Pro peak policy — **Pro published row recalibration is out of scope** (unchanged this PR).

---

## CANDIDATE 60% PRICE MATRIX

FX: **1560.6** effective (1530 × 1.02). Candidate: peak ref + **60%** target margin. CI current procurement from live catalog snapshot.

| Shape | Peak ref KRW | Candidate BASE P | CI proc KRW | Realized margin @ candidate P |
|---|---:|---:|---:|---:|
| NORMAL (33k/3461) | 22.0 | **55** | 8.9 | 0.80 |
| MEMORY_HEAVY (12.8k cache read) | 2.5 | **7** | 1.0 | 0.90 |
| BOUNDED_STRESS (80k/5k) | 46.8 | **117** | 18.9 | 0.80 |

CI snapshot (observedAt **2026-09-20**): current **0.120853 / 0.483412** (~59.7% discount), cache read **0.002417**.  
Candidate BASE **does not** use CI current — deterministic fixture in `deepseekV41FlashPreflight.ts`.

Full JSON: `PRICE_MATRIX.json`

---

## V4 PRO RELATIVE PRICE MATRIX

Same shapes; V4 Pro **peak** baseline @ published target margin **50%**:

| Shape | Flash candidate P | Pro peak-base P | Flash/Pro ratio |
|---|---:|---:|---:|
| NORMAL | 55 | 180 | **0.30** |
| MEMORY_HEAVY | 7 | 18 | 0.39 |
| BOUNDED_STRESS | 117 | 392 | 0.30 |

Positioning: Flash ~**30%** of Pro peak-base P on representative Main RP workloads.

---

## CACHE SEMANTICS

### Provider contract (verified)

| Field | Reported? | Parser owner |
|---|---|---|
| `prompt_tokens_details.cached_tokens` | **yes** | `parseOpenRouterUsage()` |
| `cache_write_tokens` | **yes** (0 in all captured calls) | same |
| `completion_tokens_details.reasoning_tokens` | **yes** (0 with thinking off) | same |

Evidence: `PROVIDER_PROBE.json`, RP A/B operational (e.g. Flash `F_speech_lock`: **4736** cache read tokens).

### Billing engine fit

| Model | `modelPublishedPricingPolicy` | `publishedUserCharge` with cache |
|---|---|---|
| V4 Pro 0813 | `cacheSemanticStatus: verified`, write absent = proven zero | **complete** with cache read rate |
| V4.1 Flash | **no policy row** | **blocked** → `unsupported_cache_semantics` until policy + published cache read rate added |

**No cache write price assumed** — provider reports `cache_write_tokens: 0`; DeepSeek uses automatic prefix cache only (`explicitCacheInjection: false`).

---

## REASONING SEMANTICS

| Path | V4 Pro | V4.1 Flash |
|---|---|---|
| CI adapter `applyCheaperInferenceModelReasoningPolicy` | Rewrites to 0813 + `thinking: disabled` | **Not matched** — id passes through unchanged |
| Stream path `openRouterClient` | `family: deepseek` → reasoning **disabled** | Same (observed in A/B logs) |
| Usage | `reasoning_tokens: 0` | `reasoning_tokens: 0` |
| Double-charge risk | **Low** at current RP settings — reasoning reported separately but zero |

**Follow-up:** Register v4.1-flash in adapter with explicit thinking policy (non-thinking default for RP vs thinking-capable product surface).

---

## RP A/B ARTIFACTS

**20 live calls** (10 fixtures × Pro + Flash), production `buildContext()` assembly.

| Artifact | Path |
|---|---|
| Blind samples | `rp-ab/samples/{fixture}_Sample_{A|B}.txt` |
| Model map (GPT only) | `rp-ab/model-map.json` |
| Operational metrics | `rp-ab/operational.json` (F–J detailed; A–C in samples + first run logs) |
| Manifest | `rp-ab/manifest.json` |

Fixtures: A_daily … J_adult_fixture (see `scripts/deepseek-v41-flash-rp-ab.ts`).

**Cursor did not score RP quality.** Objective checks recorded: output length, format violations, user-impersonation markers, completion, latency, token usage.

Notable runtime findings:
- **`G_long_memory` Pro:** `responseModelId` = `deepseek/deepseek-v4-pro-0813` while requested `deepseek-v4-pro-0813` → **modelMismatch: true** (billing canonicalization likely OK via alias; ledger surfacing required).
- **`F_speech_lock` Pro:** short English output (478 chars) — no degeneration on retry with error handler.

---

## LATENCY / COST EVIDENCE

Sample from operational (production-scale prompts ~5k input tokens):

| Fixture | Model | TTFT ms | Total ms | Out chars | Cache read |
|---|---|---:|---:|---:|---:|
| A_daily | Pro | 7134 | ~71000 | 1413 | — |
| A_daily | Flash | 8917 | ~65000 | 1791 | — |
| F_speech_lock | Flash | 8917 | 35862 | 2563 | 4736 |

Provider raw cost available via `upstreamCostUsd` on stream usage when reported.

---

## DEAD SYSTEM AUDIT

| Item | Verdict |
|---|---|
| `deepseek-v4-flash-0731` + published v1 row | **KEEP** |
| `pointsReasoningMargins` Flash constants (0731) | **KEEP** |
| `LEGACY_TO_SELECTED` flash → Pro | **KEEP** |
| `openRouterModelPricing` Flash rates | **FOLLOW-UP** (stale vs v4.1-flash) |
| Repurpose 0731 id for v4.1 | **FORBIDDEN** |

---

## REGRESSION RISKS

| Risk | Mitigation in cutover design |
|---|---|
| V4 Pro routing/billing drift | No changes to Pro constants/rows in this PR |
| 0731 background breakage | New id `deepseek-v4.1-flash`; leave 0731 callers untouched |
| Flash mis-billed as Pro | Separate published row + `isCheaperInferenceModel` entry + picker id |
| CI discount moves BASE | Use `publishedUserCharge` stable peak ref; procurement separate |
| Response model mismatch | Persist `responseModelId` or normalize in ledger; alert on mismatch |
| Failover absent for Flash Main RP | Explicit product choice: Flash single-attempt like Pro, or add `native_flash_v41` route kind |

---

## CUTOVER DESIGN (integration only — not implemented)

1. **`chatModels.ts`:** add `CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL = "deepseek-v4.1-flash"`; add to `isCheaperInferenceModel`; **do not** alter 0731 constant.
2. **Picker:** new option "DeepSeek V4.1 Flash" (Fast/Value), separate from Pro — feature-flagged.
3. **`publishedModelPricing.ts`:** new v2 row — peak ref 0.30/1.20, cache read 0.006, target margin **0.60**.
4. **`modelPublishedPricingPolicy.ts`:** add cache policy after production cache evidence (mirror Pro 0813).
5. **`cheaperInferenceConfig.ts`:** extend reasoning policy matcher for v4.1-flash (do not rewrite to 0731).
6. **`deepseekProviderFailover.ts`:** add route kind for v4.1 Main RP if product requires failover parity.
7. **Billing cutover:** `publishedUserCharge` only after cache policy verified; **PRICE_CUTOVER=NO** until GPT + product sign-off.

No parallel billing engine — extends existing owners.

---

## PROOF

| Artifact | Path |
|---|---|
| This report | `AUDIT_REPORT.md` |
| Price matrix | `PRICE_MATRIX.json` |
| Provider probe | `PROVIDER_PROBE.json` |
| RP A/B | `rp-ab/` |
| Code fixtures | `src/lib/deepseekV41FlashPreflight.ts` |
| Tests | `src/lib/deepseekV41FlashPreflight.test.ts` (5/5) |

---

## CLASSIFICATION

**`READY_FOR_GPT_RP_REVIEW`**

RP blind samples + model map + pricing matrix + provider contract evidence are complete.

**Implementation blockers (not GPT RP blockers):**
- `publishedUserCharge` cache path for v4.1-flash → **`BLOCKED_BY_CACHE_SEMANTICS`** until policy row added
- `chatModels` / adapter / failover registration → **`FOLLOW-UP`** before public picker

**MERGE = NO · PRICE_CUTOVER = NO · STOP**
