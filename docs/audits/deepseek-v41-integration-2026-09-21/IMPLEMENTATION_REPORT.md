# DeepSeek V4.1 Flash — Hidden Production Integration

**Date:** 2026-09-21  
**Exact main HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805`  
**Branch:** `cursor/v41-flash-hidden-integration-a91d`  
**MERGE = NO · PUBLIC_PICKER_ENABLE = NO · PRICE_CUTOVER = NO**

---

## EXACT MAIN HEAD

| Field | Value |
|---|---|
| `origin/main` at branch start | `3c5555a2fe97f9097cf7b65aff5912574d72b805` |
| Implementation branch | `cursor/v41-flash-hidden-integration-a91d` |
| #993 / #991 audit artifacts | **not cherry-picked** |

---

## OPEN PR PATH OVERLAP

| PR | Overlap with this integration |
|---|---|
| #993 (preflight audit) | Evidence only — same owner map, no code conflict |
| #992 (pricing auto-tracker) | **No overlap** on `publishedModelPricing`, `chatBillingContractDispatch`, `chatModels`, `cheaperInferenceConfig` |

---

## OWNER MAP

| Concern | Owner (post-change) |
|---|---|
| Canonical model id | `CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL` in `chatModels.ts` |
| CI / CheaperInference gate | `isCheaperInferenceModel`, `isCheaperInferenceDeepSeekV41FlashModel` |
| DeepSeek family (prompt) | `isDeepSeekModel`, `isDeepSeekMainRpFamilyModel` (Pro + V4.1) |
| TRUE-OFF wire | `applyCheaperInferenceModelReasoningPolicy` in `cheaperInferenceConfig.ts` |
| Logical route / failover | `deepseekProviderFailover.ts` — `flash_v41`, `native_flash_v41` |
| Published aliases | `publishedModelAliases.ts` |
| Published pricing | `publishedModelPricing.ts` — v1 peak row |
| Cache policy | `modelPublishedPricingPolicy.ts` |
| Billing dispatch | `chatBillingContractDispatch.ts` — Phase 2 model set |
| Usage → charge | `turnBillableUsage.ts` → `publishedUserCharge.ts` |
| Ledger `actual_model` | `providerCostLedger.ts` (raw response preserved) |
| Admin receipt | `adminBillingReceiptV3Shared.ts` (unchanged — raw forensic) |

---

## MODEL IDENTITY

| Id | Role |
|---|---|
| `deepseek-v4.1-flash` | **New** canonical CI Main RP fast/value (hidden — not in picker) |
| `deepseek-flash` | Official API name (documented constant only) |
| `deepseek-v4-pro-0813` | Unchanged Main RP Pro default |
| `deepseek-v4-flash-0731` | Unchanged background/aux — **not repurposed** |

---

## DEEPSEEK FAMILY DELTA

- Added `isDeepSeekMainRpFamilyModel` = V4 Pro + V4.1 Flash.
- `contextBuilder.ts`: `<WORLD_LORE>` XML / length-stack Pro paths now use Main RP family (V4.1 gains Pro-parity prompt assembly).
- Legacy 0731 Flash length-stack diagnostic unchanged (`isCheaperInferenceDeepSeekV4FlashModel` only).

---

## FINAL REQUEST PARITY

**Artifact:** `docs/audits/deepseek-v41-integration-2026-09-21/request-parity/request-parity.json`

| Check | Result |
|---|---|
| `changedKeys` | **`model` only** |
| system chars delta | **0** |
| temperature / top_p | equal (0.92) |
| thinking (assemble stage) | equal |
| TRUE-OFF wire (adapt body) | equal — verified in `deepseekV41FlashIntegration.test.ts` |

**Classification:** `POST_INTEGRATION_REQUEST_PARITY` — pass.

---

## TRUE-OFF WIRE CONTRACT

All three DeepSeek CI Main paths emit:

```json
{ "thinking": { "type": "disabled" }, "reasoning_effort": "none" }
```

V4.1 uses explicit matcher (not generic fallback). V4 Pro and 0731 regressions unchanged.

---

## RESPONSE MODEL CANONICALIZATION

Extended `publishedModelAliases.ts`:

| Raw | Canonical |
|---|---|
| `deepseek/deepseek-v4-pro-0813` | `deepseek-v4-pro-0813` |
| `deepseek/deepseek-v4-pro` | `deepseek-v4-pro-0813` |
| `deepseek/deepseek-v4.1-flash` | `deepseek-v4.1-flash` |

Ledger continues storing **raw** `responseModelId`; billing dispatch uses requested `deliveredModelId` with canonicalize on published paths.

---

## PUBLISHED PRICING

| Field | V4.1 Flash v1 |
|---|---|
| Input (cache miss) | $0.30 / M |
| Output | $1.20 / M |
| Cache read | $0.006 / M |
| targetMargin | 60% |
| minimumMarginFloor | 50% |
| pricingVersion | 1 |
| publishedAt | 2026-09-21T00:00:00.000Z |

CI current procurement rates **not** in catalog row. Deterministic tests confirm identical BASE under hypothetical CI swings.

---

## CACHE CONTRACT

| Evidence | Finding |
|---|---|
| Official DeepSeek pricing | cache hit / miss / output — **no separate cache-write price** |
| Context caching | automatic (physical persistence may occur) |
| CI captured usage (preflight + policy design) | `cache_write_tokens` reported 0 or absent |
| Billing bucket B | absent/unreported → `cacheWriteAbsentSemantics: proven_zero` **in billing-bucket sense only** |

Regression: read > 0 complete; zero cache complete; positive write → **blocked** (`unsupported_cache_semantics`).

---

## BILLING DISPATCH

- Phase 2 generalized: `PHASE2_DEEPSEEK_PUBLISHED_MODELS` = Pro 0813 + V4.1 Flash.
- V4.1 direct selection + Phase 2 ON → `published_phase2` (see `deepseekPhase2PublishedBillingCutover.test.ts`).
- V4 Pro behavior preserved.

---

## LEGACY FALLBACK AUDIT

| Scenario | Result |
|---|---|
| Phase 2 OFF + V4.1 selected | `legacy` / `phase2_deepseek_billing_disabled` — **no silent procurement BASE** |
| Published blocked (cache write) | `legacy` / blocked reason — not CI-current coupling |
| Public picker | V4.1 **absent** — hidden integration only |

**Note:** `PUBLIC_LAUNCH_BLOCKED_BY_BILLING_FALLBACK` remains a launch gate until GPT confirms representative turns always resolve published complete with Phase 2 ON.

---

## V4 PRO PEAK FOLLOW-UP

`V4_PRO_PEAK_RECONCILIATION_REQUIRED_BEFORE_PUBLIC_POSITIONING`

Pro published row remains off-peak-shaped ($0.66 / $1.98). Flash ~55P vs Pro ~180P positioning copy requires Pro peak reconciliation — **out of scope** this PR.

---

## SMOKE FIXTURE TAXONOMY (evidence correction)

See `smoke-fixture-taxonomy.json` and `EVIDENCE_CORRECTION_REPORT.md`.

- `F_speech_lock` → **LENGTH_FREE_CONTINUATION** (not Speech Lock)
- `G_long_memory` → **AMBIGUOUS_SHARED_MEMORY_HANDLING** (not Long Memory Recall)

TRUE Speech Lock / Memory Recall / Production recovery evidence under `evidence-correction/`.

---

## BOUNDED LIVE A/B ARTIFACTS

**Script:** `scripts/deepseek-v41-integration-rp-ab.ts` (5 fixtures × Pro + V4.1 = **10 calls**)

| Status | Detail |
|---|---|
| Run | **Complete** — `rp-ab/operational.json`, blind samples under `rp-ab/samples/` |
| Blind map | Sample A = V4.1 Flash, Sample B = V4 Pro (`model-map.json`) |
| Provider identity | All 10 rows: `modelMismatch: false`; V4.1 returned `deepseek-v4.1-flash` |
| Physical attempts | V4.1 telemetry: `provider_attempt_count: 1`, `backup_provider: null` |
| Reasoning tokens | **0** on all rows |
| Cache write | **0** on all rows (absent/unreported) |
| Cache read | V4.1 G_long_memory: 4352; H_long_output: 4864; others 0 |

Fixtures: D_lore, F_speech_lock, G_long_memory, H_long_output, J_adult_fixture.

**Objective latency summary (V4.1):** TTFT 1547–10110 ms; total 13951–25065 ms; output 2079–3645 chars.

Prose quality / authoring-scope scoring deferred to GPT review (blind samples only).

---

## REGRESSION TESTS

| Suite | Count |
|---|---|
| `deepseekV41FlashIntegration.test.ts` | 20/20 |
| `deepseekPhase2PublishedBillingCutover.test.ts` | 32/32 (incl. V4.1 dispatch) |
| `deepseekProviderFailover.test.ts` | 42/42 |

Coverage map: tests A–R per spec in integration file + Phase 2 cutover matrix.

---

## DEAD SYSTEM AUDIT

| Item | Verdict |
|---|---|
| Duplicate V4.1 constant | **none** — single `CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL` |
| Generic fallback for V4.1 reasoning | **removed** — explicit branch |
| `flash` logical model alias | **renamed** `flash_0731` (explicit vs `flash_v41`) |
| Preflight-only `deepseekV41FlashPreflight.ts` | **not imported** — remains on audit branch only |
| Stale “all Flash = 0731” comments | **FOLLOW-UP** — no broad comment sweep in this PR |

---

## SYSTEM DELTA

### BEFORE

- `deepseek-v4.1-flash` zero main integration
- V4.1 missed DeepSeek Main RP prompt family (`<WORLD_LORE>`)
- No published pricing / cache policy / Phase 2 billing
- Namespace gap: `deepseek/deepseek-v4-pro-0813`

### PROBLEM

Hidden fast/value model could not be wired without picker/billing/prompt divergence.

### AFTER

- Canonical V4.1 identity + family + TRUE-OFF + failover route kind
- Published peak pricing + cache policy + Phase 2 billing membership
- Namespace aliases closed
- Picker unchanged (hidden)

### REMOVED

- Implicit reliance on generic reasoning fallback for unknown DeepSeek ids (V4.1 now explicit)

### PRESERVED

- `deepseek-v4-flash-0731` background callers and constants
- V4 Pro pricing, routing, TRUE-OFF
- Main RP single-attempt invariant
- Raw ledger forensic `actual_model`

### REGRESSION RISKS

- Logical model rename `flash` → `flash_0731` (tests updated)
- Phase 2 set expansion — V4.1 only when direct-selected + gate ON

### PROOF

- `request-parity/request-parity.json` — `changedKeys: ["model"]` only
- Test suites above — 94/94 related suites pass
- `rp-ab/operational.json` — 10 live calls, provider identity verified
- `buildDeepSeekFailoverBackupBody` — V4.1 Main RP streaming without OpenRouter backup throw

---

## FINAL CLASSIFICATION

**`READY_FOR_GPT_LAUNCH_REVIEW`**

Hidden integration + deterministic parity + regression tests + bounded live A/B complete.

**Does not mean:** public picker ready · billing cutover ready · merge approved · V4 Pro peak reconciliation done.

**MERGE = NO · STOP for GPT review.**
