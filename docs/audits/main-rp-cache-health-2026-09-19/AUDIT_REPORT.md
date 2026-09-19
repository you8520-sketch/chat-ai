# Main RP Cache Health Audit — Read-Only

**Date:** 2026-09-19 (initial) · **Follow-up:** 2026-09-19
**Scope:** Canonical Main RP models on CheaperInference production path
**Constraints:** provider generation calls = 0 · runtime patch = 0 · pricing/routing/cache-setting change = 0

---

## CURRENT STATE

| Item | Value |
|------|-------|
| Source main SHA | `15bb412e7e8b844f4c0900fa6214b86b721d5457` |
| PR | [#966](https://github.com/you8520-sketch/chat-ai/pull/966) — OPEN DRAFT, not merged |
| PR head (initial audit) | `3e8d662c30c6f96d5024462b153facc266c93d84` |
| Canonical Main RP | DeepSeek V4 Pro · Gemini 3.1 Pro Preview · Gemini 3.7 Flash |
| Opus 5 | Retired (#965) — out of scope |
| PR #962 | Frozen — not modified |

**PR scope label:** `RUNTIME_CHANGE = 0` · `AUDIT_TOOLING_CHANGE = YES` (one reusable read-only collector; compact audit artifacts).

---

## FINAL PR FILE SET

| File | Status |
|------|--------|
| `AUDIT_REPORT.md` | **KEEP** |
| `ci-usage-snapshot.json` | **KEEP** (aggregates only) |
| `g37-prefix-eligibility-offline.json` | **KEEP** (offline prefix proof) |
| `g37-live-cache-discriminator.json` | **KEEP** (2 sanitized live rows) |
| `g37-no-cache-pricing-safety.json` | **KEEP** (margin distribution + worst rows) |
| `scripts/main-rp-cache-health-readonly.ts` | **KEEP** (reusable usage/catalog GET) |

No full raw usage dump · no credentials · no prompt bodies.

---

## REMOVED FORENSIC SCAFFOLD

One-off investigative scripts **removed** from final PR (durable measurements preserved in JSON artifacts above):

| Script | Classification |
|--------|----------------|
| `scripts/gemini37-live-cache-discriminator.ts` | **SAFE_TO_DELETE_FROM_FINAL_PR** — paid probe complete |
| `scripts/gemini37-prefix-cache-eligibility-audit.ts` | **SAFE_TO_DELETE_FROM_FINAL_PR** — offline proof in JSON |
| `scripts/g37-no-cache-pricing-safety-audit.ts` | **SAFE_TO_DELETE_FROM_FINAL_PR** — economics in JSON |

`ONE_OFF_FORENSIC_SCAFFOLD` = **REMOVED**

---

## RAW TELEMETRY CLEANUP

| Item | Action |
|------|--------|
| `ci-usage-rows.json` (~31k lines, full row dump) | **Removed from PR** — `FULL_RAW_USAGE_DUMP = SAFE_TO_REMOVE_FROM_PR` |
| Local checksum (not committed) | `sha256:939386f8a009b324fe419d322bb63c14261ead72abeab58b8ebfc76223b6a41d` |

**Retained collection metadata** (in snapshot + report):

- Window: 2026-08-20 → 2026-09-19 UTC
- Total workspace rows scanned: **6,571**
- Pagination: **complete** (66 pages)
- Main RP subset rows: **1,858** (DeepSeek 1192 · G31 262 · G37 404)
- Collection timestamp: `2026-09-19T08:02:18.338Z`

No API secrets committed. Collector no longer writes full row dumps.

---

## MODEL OWNER MAP

Shared pipeline (all three):

`getUserChatSelectedAI` → CI transport → `buildContext` (`geminiStaticDynamicMode: false`) → `assemblePrimaryRpRequest` → `adaptCheaperInferenceChatBody` → `/v1/chat/completions` → `parseCompatibleUsage` → billing

| Model | APP_EXPLICIT_CACHE | PROVIDER_IMPLICIT |
|-------|-------------------|-------------------|
| `deepseek-v4-pro-0813` | NO | YES (observed) |
| `gemini-3.1-pro-preview` | NO | YES (historically sparse) |
| `gemini-3.7-flash` | NO | YES (historically rare; not observed recently) |

Native Gemini modules (`geminiExplicitCache.ts`, `geminiCacheBulk.ts`, `geminiStaticDynamicContext.ts`) are **not** on the CI Main RP wire path today.

---

## PROVIDER CACHE CAPABILITY

Live CI catalog (2026-09-19): all three models expose `cache_read_input_per_million` pricing. **Provider supports cached-input billing ≠ application cache health.**

---

## MODEL HEALTH CLASSIFICATION CORRECTIONS

### DeepSeek V4 Pro 0813

| Label | Value |
|-------|-------|
| `DEEPSEEK_CACHE_FUNCTIONALITY` | **CONFIRMED** |
| `DEEPSEEK_30D_CACHE_HEALTH` | **HEALTHY** (1192 rows · 941 cache-read positive · 78.9%; single-attempt 81.6%) |
| `DEEPSEEK_RECENT_7D_CACHE_HEALTH` | **INSUFFICIENT_SEQUENTIAL_EVIDENCE** (4/38 hits; no chat attribution) |
| `RECENT_HIT_RATE_DECLINE_CAUSE` | **UNCONFIRMED** — do not explain as T1-cold/new-chat without sequential proof |

### Gemini 3.1 Pro Preview

| Label | Value |
|-------|-------|
| `GEMINI31_CACHE_FUNCTIONALITY` | **CONFIRMED_HISTORICALLY** |
| `GEMINI31_30D_CACHE_HEALTH` | **PARTIAL** (15.3% rows with cache read; median ratio 0) |
| `GEMINI31_RECENT_7D_CACHE_HEALTH` | **INSUFFICIENT_NO_TRAFFIC** (0 requests in window) |
| “75.2% warm cache” | **Not cache health** — Track B audit script fallback / margin metric |

### Gemini 3.7 Flash

| Label | Value |
|-------|-------|
| `GEMINI37_CACHE_FUNCTIONALITY` | **CONFIRMED_HISTORICALLY** (23/404 rows; 1/86 single-attempt) |
| `GEMINI37_RECENT_7D_CACHE_HEALTH` | **NOT_OBSERVED** (46 rows · 0 cache reads) |
| `GEMINI37_CACHE_HEALTH` (overall) | **NOT_OBSERVED_RECENTLY** |
| Provider does not support G37 cache | **FALSE** — catalog + historical hits disprove |

---

## ATTEMPT TOPOLOGY (corrected terminology)

30-day Main RP CI usage subset:

| Layer | Count | Notes |
|-------|------:|-------|
| `CI_SETTLED_REQUEST_ROW_COUNT` | 1,858 | One row per settled CI usage record for the 3 models |
| `CI_REPORTED_PROVIDER_ATTEMPT_COUNT` | 2,749 | Σ `provider_attempt_count` |
| `APP_RETRY_FALLBACK_COUNT` | **UNKNOWN_FROM_USAGE_API** | |
| `CLIENT_HTTP_REQUEST_COUNT` | **UNVERIFIED_FROM_USAGE_API_ALONE** | Not equated to row count without app log proof |

Rows with `provider_attempt_count > 1`: **772 (41.6%)** — G37 **77.2%** → `INTERNAL_PROVIDER_ATTEMPT_CONFOUND` for clean cache lineage.

---

## G37 CURRENT PREFIX MEASUREMENT

**Method:** Offline deterministic fixture — `gemini-37-flash-growing-history` T1–T3, canned assistant text from `t*-raw.txt`, production assembly chain, **0 provider calls**.

**Reference threshold:** 4096 tokens (Google Gemini implicit cache eligibility; distinct from repo constant `GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD = 32768` used elsewhere).

| Pair | Full common prefix tokens | System common prefix tokens | Total prompt T2 |
|------|--------------------------:|----------------------------:|----------------:|
| T1–T2 | **7,611** | **7,592** | 11,050 |
| T2–T3 | 9,974 | 7,592 | 13,966 |

Tracked **system sections are byte-identical** T1→T2→T3 (no differing section id).

---

## FIRST PREFIX BREAK OWNER

| Scope | T1–T2 break |
|-------|-------------|
| Tracked system sections | **None** (all 10 section ids unchanged) |
| Wire message array | **Index 1 (`user`)** — current-turn user wrapper differs from history-stored user formatting (`history-message-1:user`) |
| Expected sequential growth break | Index 2+ (`assistant` history) on later pairs |

`STABLE_PREFIX_BEFORE_BREAK_TOKENS` (system-only, T1–T2): **7,592** (≥ 4096)

---

## G37 CACHE ELIGIBILITY

| Classification | Value |
|----------------|-------|
| `G37_CURRENT_PREFIX_CACHE_ELIGIBILITY` | **ELIGIBLE** |
| `COMMON_PREFIX_BELOW_CACHE_ELIGIBILITY_THRESHOLD` | **CONTRADICTED** — measured T1–T2 wire prefix 7,611 tokens |
| Prior label “threshold not met” | **Withdrawn** — total input length ≠ stable common prefix length |

**Offline decision matrix:** **CASE B (weakened)** — prefix ≥ 4096 on production assembly, yet recent aggregate usage shows cache_read = 0.

**Live discriminator (2026-09-19):** **CASE B (confirmed)** — see [G37 LIVE CACHE DISCRIMINATOR](#g37-live-cache-discriminator).

---

## DORMANT 148K TOKEN ANOMALY

Offline `geminiStaticDynamicMode: true` artifact showed `staticEstimatedTokens ≈ 148,332` while `systemTokens = 7,592`.

| Check | Finding |
|-------|---------|
| `GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD` | `32_768` in `contextTrack.ts` |
| `GEMINI_STATIC_CACHE_MIN_TOKENS` | `32_768` — used by `finalizeGeminiStaticCache` |
| `isGeminiExplicitCacheEnabled()` | Default **on** (`GEMINI_EXPLICIT_CACHE !== "0"`) |
| `finalizeGeminiStaticCache` | When explicit-cache path active, calls `buildStableSessionPadding` to pad static block toward 32k+512 |
| CI Main RP wire (`geminiStaticDynamicMode: false`) | **Does not** send padded static block — split is internal only |

**Classification:**

- `DORMANT_STATIC_DYNAMIC_TOKEN_ESTIMATE` = **INVALID_FOR_CURRENT_CI_MAIN_RP_COMPARISON**
- `LEGACY_GEMINI_32K_THRESHOLD` = **STALE_FOLLOW_UP**

The 148k figure is an offline estimate artifact of dormant explicit-cache padding logic (legacy 32k minimum), not a production CI wire token count. Current `false`-mode prefix proof remains independent and valid.

### Legacy 32k constant readers (no patch in this PR)

| Reader | Classification |
|--------|----------------|
| `contextTrack.ts` (definition) | **FOLLOW_UP** |
| `geminiStaticDynamicContext.ts` (`finalizeGeminiStaticCache`) | **FOLLOW_UP** |
| `geminiCacheBulk.ts` (`buildStableSessionPadding`) | **KEEP** (native explicit cache) |
| `geminiExplicitCache.ts` | **KEEP** |
| `contextBuilder.ts` (threshold logging only) | **FOLLOW_UP** — not active CI cache eligibility owner |

Current Google Gemini 3.7/3.1 implicit-cache documentation minimum: **4,096 tokens** (distinct from repo 32k constants).

---

## STATIC/DYNAMIC OFFLINE COMPARISON

`geminiStaticDynamicMode: true` tested **offline only** (never enabled in production).

| Metric | Current `false` | Offline `true` |
|--------|----------------:|---------------:|
| T1–T2 stable system prefix tokens | 7,592 | 7,592 |
| T1–T2 full wire prefix tokens | 7,611 | 7,611 |
| ≥ 4096 | YES | YES |
| First volatile break (T1–T2) | history-message-1:user | history-message-1:user |
| Static fingerprint stable T1–T3 | N/A | **YES** (`b1e1bffe0983c9fb`) |
| Outbound wire body change | — | **NO** (identical wire metrics; split affects internal `geminiSplit` only) |
| Section semantic parity (T2) | — | **YES** (no missing/duplicate/extra sections) |
| Explicit-cache padding (internal) | N/A | 148,332 static tokens when `GEMINI_EXPLICIT_CACHE` default-on in dev — **not sent as CachedContent on CI Main RP wire** |

**Conclusion:** Dormant static/dynamic owner does **not** improve CI wire prefix for implicit cache under current assembly (explicit cache API not wired). **Not CASE A.**

| Module | Classification |
|--------|----------------|
| `geminiStaticDynamicContext.ts` | **FOLLOW-UP** (not `FIX_CANDIDATE` for implicit cache on current CI path) |
| `geminiExplicitCache.ts` | **KEEP** |
| `geminiCacheBulk.ts` | **KEEP** |

Artifact: `g37-prefix-eligibility-offline.json`

---

## G37 LIVE CACHE DISCRIMINATOR

**Date:** 2026-09-19 · **Script:** `scripts/gemini37-live-cache-discriminator.ts` · **Artifact:** `g37-live-cache-discriminator.json`

Production path · `geminiStaticDynamicMode: false` · max_tokens = 16 · reasoning_effort = low · 50s warm interval · **2 customer generation requests**.

### Live preflight (unique cold prefix)

| Item | Value |
|------|-------|
| Audit marker | `[CACHE AUDIT FIXTURE — inert metadata: g37-live-disc-2026-09-19-37a38dd1c5a0d209]` |
| T1–T2 common prefix (estimated) | **7,686 tokens** |
| ≥ 4096 | **YES** |
| Source main SHA | `15bb412e7e8b844f4c0900fa6214b86b721d5457` |

### T1

| Field | Value |
|-------|------:|
| request_id | `88a32fe7-d99a-4dd9-b398-0398aa9876a9` |
| timestamp | `2026-09-19T08:20:29.497097+00:00` |
| model | `gemini-3.7-flash` |
| prompt_tokens | 4,926 |
| standard_input_tokens | 4,926 |
| cache_read_input_tokens | **0** |
| cache_write_input_tokens | 0 |
| completion_tokens | 1 |
| billed_cost_usd | 0.002589 |
| provider_attempt_count | **1** |
| cache_reporting_state | unknown |
| routing_overhead_ms | 1,466 |
| time_to_response_headers_ms | 2,288 |
| partition (prompt = std + read + write) | **OK** |

### T1 hard gate

**PASS** — `provider_attempt_count === 1` · model match · cost ≤ $0.01 · accounting OK.

### T2 (after 50s warm interval)

| Field | Value |
|-------|------:|
| request_id | `8d639ee1-10d3-49bd-aea1-16e9a3741691` |
| timestamp | `2026-09-19T08:21:22.649558+00:00` |
| prompt_tokens | 4,960 |
| standard_input_tokens | 4,960 |
| cache_read_input_tokens | **0** |
| cache_write_input_tokens | 0 |
| completion_tokens | 12 |
| billed_cost_usd | 0.002636 |
| provider_attempt_count | **1** |
| T1→T2 actual common prefix (estimated) | 7,686 tokens |

### Cache bucket comparison

| Turn | prompt | standard | cache_read | cache_write |
|------|-------:|---------:|-----------:|------------:|
| T1 | 4,926 | 4,926 | 0 | 0 |
| T2 | 4,960 | 4,960 | 0 | 0 |

T1 cold (expected). T2 warm interval elapsed with stable prefix ≥ 4096 (local estimate) — **no implicit cache read observed**.

### Cost

| | USD |
|--|----:|
| T1 | 0.002589 |
| T2 | 0.002636 |
| **Cumulative** | **0.005225** (≤ $0.02 ceiling) |

### Live result classification — **CASE B**

| Label | Value |
|-------|-------|
| `G37_LIVE_CACHE_DISCRIMINATOR` | **CLEAN_TWO_CALL** |
| `G37_CURRENT_IMPLICIT_CACHE_FUNCTIONALITY` | **ELIGIBLE_PREFIX_BUT_NO_IMPLICIT_HIT** |
| `G37_ELIGIBLE_PREFIX_LIVE_CACHE` | **NOT CONFIRMED** (T2 cache_read = 0) |
| `APP_PREFIX_LAYOUT_ROOT_CAUSE` | **CONTRADICTED** |
| `CI_OR_GOOGLE_IMPLICIT_CACHE_SEMANTICS` | **PRIMARY_UNCONFIRMED_OWNER** |

Prompt layout is **not** sufficient to explain zero cache. Next owner: CI routing / Google implicit-cache semantics / cache reporting (`cache_reporting_state: unknown`).

---

## G37 CACHE FINAL CONCLUSION

Cache optimization work can **stop** without a runtime patch:

| Label | Value |
|-------|-------|
| `G37_CACHE_FUNCTIONALITY` | **HISTORICALLY_CONFIRMED** |
| `G37_CURRENT_PREFIX_CACHE_ELIGIBILITY` | **ELIGIBLE** |
| `G37_CURRENT_IMPLICIT_CACHE_HIT` | **NOT_OBSERVED_IN_CLEAN_TWO_CALL** |
| `APP_PREFIX_LAYOUT_ROOT_CAUSE` | **CONTRADICTED** |
| `CI_OR_GOOGLE_IMPLICIT_CACHE_SEMANTICS` | **PRIMARY_UNCONFIRMED_OWNER** |

Implicit cache is **not reliable** today; cache miss does not block closing the audit. Follow-up is CI/provider support inquiry — not app prompt reordering.

---

## CURRENT G37 PRICING OWNER

**Owner:** `src/lib/gemini37FlashPricing.ts` · `computeGemini37FlashUserChargePoints`

Confirmed defaults (no `GEMINI37_*` Railway overrides in repo env):

| Parameter | Value |
|-----------|------:|
| basePoints | 35 |
| includedInputTokens | 25,000 |
| inputStepTokens / inputStepPoints | 10,000 / 1 |
| outputTier2500 … 9000 | 0 / 25 / 30 / 40 / 50 |
| longContextThresholdTokens | 75,000 |

**Cache-independent invariant confirmed:** user P depends only on `prompt_tokens` + billed output tokens — never `cacheRead` / `cacheWrite` / `standardInput` / `upstreamCostUsd`.

---

## NO-CACHE PRODUCTION SAMPLE

Read-only CI usage API · `cache_read_input_tokens = 0` · settled rows · **0 generation calls**.

| Window | Sample count |
|--------|-------------:|
| 30-day | 376 |
| 7-day (recent) | 46 |

Artifact: `g37-no-cache-pricing-safety.json` (hashed request ids only; no full raw dump).

---

## NO-CACHE MARGIN DISTRIBUTION

FX: billing snapshot at audit time (`resolveBillingExchangeRateSnapshot`); stress uses same fallback policy when API unavailable (`EXCHANGE_RATE_FALLBACK_KRW` + overseas card fee). Site promotion **not** applied — base pricing only (#963 owners preserved).

### 30-day no-cache (n=376)

| Metric | Actual FX |
|--------|----------:|
| Minimum margin | 20.9% |
| P5 | 48.0% |
| P10 | 55.4% |
| Median | 77.7% |
| Weighted aggregate | 76.8% |
| Below 0% | 0 (0%) |
| Below 50% | **21 (5.6%)** |
| Below 55% | 34 (9.0%) |
| Below 60% | 45 (12.0%) |

**Worst shape (30d):** ~24k input · ~2.1k output · user P = 35 (base only) · procurement ≈ ₩27.7 · margin **20.9%** · `provider_attempt_count = 2`.

### 7-day no-cache (n=46, recent)

| Metric | Actual FX |
|--------|----------:|
| Minimum margin | **52.6%** |
| Median | 68.6% |
| Below 50% | **0 (0%)** |

Recent production no-cache economics are within floor; 30d tail includes long-input / multi-attempt outliers.

---

## HISTORICAL COLD FIXTURE UNDER CURRENT PRICING

Fixture: `docs/audits/gemini-37-flash-pricing/RUNTIME.json` T1–T10 (all `cacheRead = 0`). **Not current production distribution.**

| Turn | Input | Output | Current P | Margin (current formula) |
|------|------:|-------:|----------:|-------------------------:|
| T1 | 4,312 | 1,613 | 35 | 71.7% |
| T6 | 17,256 | 2,400 | 35 | **32.9%** |
| T8 | 22,647 | 3,853 | 60 | **43.8%** |
| T10 | 30,477 | 4,434 | 66 | 54.5% |

Rolling margin under current pricing: **60.2%**. High-input turns at base P remain the stress shape.

---

## SITE PROMOTION SEPARATION

This audit reports **base pricing margin only** (`userPointsBeforeSitePromotion`). CI catalog discount ≠ site promotion. #963 promotion/receipt owners unchanged.

---

## SYSTEM DELTA

| | |
|--|--|
| **BEFORE** | Over-broad cache causal labels; 31k-line raw telemetry in git; one-off forensic scripts; no no-cache economics proof |
| **PROBLEM** | G37 implicit cache unreliable; unclear whether no-cache turns still meet margin floor |
| **AFTER** | Compact audit PR; cache root cause → CI/Google semantics; pricing safety evidence recorded |
| **REMOVED** | 3 one-off forensic scripts; full raw usage dump |
| **PRESERVED** | Cache conclusions; offline prefix proof; live 2-row discriminator; no-cache margin distribution; reusable collector |
| **REGRESSION RISKS** | None — no runtime/source changes |
| **PROOF** | Live CASE B + 376-row no-cache margin sample + historical fixture repricing |

---

## NEXT STEP (separate follow-ups)

| Item | Owner |
|------|-------|
| CI/Google implicit-cache support inquiry | External |
| Legacy 32k Gemini threshold cleanup | **STALE_FOLLOW_UP** |
| G37 pricing adjustment (if required) | **Separate PR** — only if margin follow-up confirms |
| Admin cache/margin telemetry | Product |
| Memory Long-Horizon Episodic Retrieval V2 | Memory track |

---

## FINAL CLASSIFICATION

```
DEEPSEEK_CACHE_FUNCTIONALITY           = CONFIRMED
DEEPSEEK_30D_CACHE_HEALTH              = HEALTHY
DEEPSEEK_RECENT_7D_CACHE_HEALTH        = INSUFFICIENT_SEQUENTIAL_EVIDENCE

GEMINI31_CACHE_FUNCTIONALITY           = CONFIRMED_HISTORICALLY
GEMINI31_30D_CACHE_HEALTH              = PARTIAL
GEMINI31_RECENT_7D_CACHE_HEALTH        = INSUFFICIENT_NO_TRAFFIC

G37_CACHE_FUNCTIONALITY                = HISTORICALLY_CONFIRMED
GEMINI37_RECENT_7D_CACHE_HEALTH        = NOT_OBSERVED

G37_CURRENT_PREFIX_CACHE_ELIGIBILITY   = ELIGIBLE
G37_LIVE_CACHE_DISCRIMINATOR           = CLEAN_TWO_CALL
G37_CURRENT_IMPLICIT_CACHE_HIT         = NOT_OBSERVED_IN_CLEAN_TWO_CALL
G37_ELIGIBLE_PREFIX_BUT_NO_IMPLICIT_HIT = CONFIRMED
APP_PREFIX_LAYOUT_ROOT_CAUSE           = CONTRADICTED
CI_OR_GOOGLE_IMPLICIT_CACHE_SEMANTICS  = PRIMARY_UNCONFIRMED_OWNER

G37_NO_CACHE_PRICING_SAFETY            = FOLLOW_UP_REQUIRED
ONE_OFF_FORENSIC_SCAFFOLD              = REMOVED
LEGACY_GEMINI_32K_THRESHOLD            = STALE_FOLLOW_UP

NEW_PROVIDER_GENERATION_CALLS          = 0
RUNTIME_CHANGE                         = 0
AUDIT_TOOLING_CHANGE                   = YES
MERGE                                  = NO
```

**Pricing safety note:** 30d no-cache sample has 21/376 rows below 50% margin floor (long-input base-P tail); 7d recent min margin 52.6% with 0 below 50%. Pricing change is **out of scope** for #966 — separate PR if follow-up confirms adjustment needed.
