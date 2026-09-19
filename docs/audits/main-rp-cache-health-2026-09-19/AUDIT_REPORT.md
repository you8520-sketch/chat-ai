# Main RP Cache Health Audit — Read-Only

**Date:** 2026-09-19  
**Scope:** Canonical Main RP models on current CheaperInference production path  
**Constraints:** provider generation calls = 0 · runtime patch = 0 · pricing/routing/cache-setting change = 0

---

## CURRENT STATE

| Item | Value |
|------|-------|
| Source of truth | `origin/main` @ `15bb412e` (includes merged #965 Opus retirement @ `0ea67e9b`) |
| Canonical Main RP | DeepSeek V4 Pro · Gemini 3.1 Pro Preview · Gemini 3.7 Flash |
| Claude Opus 5 | Retired from user Main RP (#965) — out of scope |
| PR #962 | Frozen — not modified |
| Measurement | CI `/v1/usage/requests` read-only (30-day window) + frozen repo harness artifacts |

---

## MODEL OWNER MAP

Shared pipeline for all three models:

`getUserChatSelectedAI` → `route.ts` (`isCheaperInferenceModel`) → `buildContext` (`geminiStaticDynamicMode: false`) → `assemblePrimaryRpRequest` → `adaptCheaperInferenceChatBody` → `https://api.cheaperinference.com/v1/chat/completions` → `parseCompatibleUsage` → `computeTurnBilling`

| Stage | Owner |
|-------|-------|
| Selected model | `chatModels.ts` / `userSelectedAI.ts` |
| Provider | CheaperInference (`cheaperInferenceConfig.ts`) |
| Outbound model id | `deepseek-v4-pro-0813` · `gemini-3.1-pro-preview` · `gemini-3.7-flash` |
| Endpoint | `CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL` |
| Request assembler | `assemblePrimaryRpRequest` (`openRouterAdult.ts`) |
| Transport | `fetchOpenRouterChatCompletion` / `resolveCompatibleTransport` |
| Reasoning | `applyCheaperInferenceModelReasoningPolicy` — DeepSeek TRUE-OFF; Gemini `reasoning_effort: low` |
| Cache (request) | `applyCacheAndPrefillForTransport` → **no-op** for all three (non-Anthropic) |
| Usage parser | `parseOpenRouterUsage` / `parseCompatibleUsage` (`openRouterUsage.ts`) |
| Billing | DeepSeek/G31: `pointsReasoningMargins.computeOpenRouterTurnBilling` · G37: `gemini37FlashPricing.ts` (cache excluded from user P) |

### Per-model explicit vs implicit cache

| Model | APP_EXPLICIT_CACHE | PROVIDER_IMPLICIT_OR_AUTOMATIC_CACHE |
|-------|-------------------|--------------------------------------|
| **A. deepseek-v4-pro-0813** | **NO** | **YES** (observed in CI usage) |
| **B. gemini-3.1-pro-preview** | **NO** | **YES** (sparse; mostly zero in recent volume) |
| **C. gemini-3.7-flash** | **NO** | **UNCONFIRMED** on Main RP growing-history path (near-zero in prod + harness) |

There is no `APP_EXPLICIT_CACHE` env. Anthropic `cache_control` applies only to Opus (retired). Google `GEMINI_EXPLICIT_CACHE` / CachedContent path is **not wired** to Main RP.

---

## PROVIDER CACHE CAPABILITY

Live CI catalog (`GET /v1/models`, 2026-09-19):

| Model | input/1M | cached input/1M | cache write/1M |
|-------|---------:|------------------:|---------------:|
| deepseek-v4-pro-0813 | $0.462 | $0.003824 | $0.462 |
| gemini-3.1-pro-preview | $1.400 | $0.140 | $0.2625 |
| gemini-3.7-flash | $0.525 | $0.0525 | $0.02912 |

**Provider supports cached-input pricing = YES for all three.**  
Provider capability ≠ application cache health (see classifications below).

---

## GEMINI NATIVE CACHE PATH

| Module | On CI Main RP path? | Classification |
|--------|---------------------|----------------|
| `geminiExplicitCache.ts` | **NO** — zero external callers on Main RP | **KEEP** (Google-native explicit cache; not deleted) |
| `geminiCacheBulk.ts` | **NO** — only via explicit-cache padding | **KEEP** |
| `geminiStaticDynamicContext.ts` | **NO** — requires `geminiStaticDynamicMode: true`; production sets `false` in `route.ts` | **FOLLOW-UP** (dead on Main RP; potential non-RP Google path) |

**NATIVE_GEMINI_EXPLICIT_CACHE_ON_CI_MAIN_RP = NO** for both Gemini models.

---

## EXISTING LIVE EVIDENCE

### Gemini 3.1 — “75.2% warm cache ratio” claim

**Debunked as a current-production cache metric.**

- Source: `scripts/gemini31-ci-production-architecture-audit.ts` uses `ciCacheRatioMedian: ciSummary?.cacheRatio?.median ?? **0.752**` — a **Track B baseline fallback**, not a timestamped current-production measurement.
- `docs/audits/gemini31-layout-owner-live-ab/report.json`: **18/18 runs `cacheRatio: 0`** (Aug 2026 layout A/B harness).
- The number **75.2%** in Gemini 3.7 pricing docs is **gross margin at T20**, not cache hit rate (`GROWING_HISTORY_T20.md`).

### Gemini 3.7 — growing-history T1–T10

**Verified.** `docs/audits/gemini-37-flash-pricing/REPORT.md` §E–F:

- Production path: `buildContext` → `assemblePrimaryRpRequest` → CI
- T1–T10: `cacheReadTokens = 0`, `cacheWriteTokens = 0`, input 4,312 → 30,477
- `provider_attempt_count` not recorded in that harness table; retry=0 by harness design

### DeepSeek — boundary resmoke cached_input_tokens

**Verified with model-id caveat.** `docs/audits/final-production-deepseek-boundary-resmoke/all_rows.json`:

| Turn | model (wire) | cached_input_tokens |
|------|--------------|--------------------:|
| instruction T1 | `deepseek-v4-pro` | 0 |
| instruction T2 | `deepseek-v4-pro` | **4096** |
| relationship T1 | `deepseek-v4-pro` | **1024** |
| relationship T2 | `deepseek-v4-pro` | **4096** |

Current canonical outbound id is **`deepseek-v4-pro-0813`** via `normalizeDeepSeekV4ProModelId`. The smoke predates `-0813` slug but demonstrates provider implicit cache on the DeepSeek CI family.

---

## CURRENT USAGE EVIDENCE

**Method:** Read-only `GET /v1/usage/requests`, window **2026-08-20 → 2026-09-19 UTC**, pagination complete (6,571 rows scanned).

Artifacts: `ci-usage-snapshot.json`, `ci-usage-rows.json`, collector `scripts/main-rp-cache-health-readonly.ts`.

| Model | Samples | cache_read > 0 | cache_write > 0 | median cache-read ratio | provider_attempt > 1 |
|-------|--------:|---------------:|----------------:|------------------------:|---------------------:|
| deepseek-v4-pro-0813 | 1192 | 941 (78.9%) | 0 | 0.970 (among all rows) | 392 (32.9%) |
| gemini-3.1-pro-preview | 262 | 40 (15.3%) | 18 | 0.000 (median) | 68 (26.0%) |
| gemini-3.7-flash | 404 | 23 (5.7%) | 3 | 0.000 (median) | 312 (77.2%) |

**Last 7 days (2026-09-12 → 2026-09-19):**

| Model | Samples | cache_read > 0 |
|-------|--------:|---------------:|
| deepseek-v4-pro-0813 | 38 | 4 (10.5%) |
| gemini-3.1-pro-preview | 0 | — |
| gemini-3.7-flash | 46 | 0 |

**Single-attempt rows only (`provider_attempt_count = 1`):**

| Model | Rows | cache_read > 0 |
|-------|-----:|---------------:|
| deepseek-v4-pro-0813 | 794 | 648 (81.6%) |
| gemini-3.1-pro-preview | 193 | 21 (10.9%) |
| gemini-3.7-flash | 86 | 1 (1.2%) |

`cache_reporting_state` values observed: `hit`, `zero`, `unknown` (varies by model/era).

---

## SEQUENTIAL TURN ANALYSIS

**SEQUENTIAL_ATTRIBUTION (production usage) = INSUFFICIENT** — CI usage rows lack `chat_id` / fixture id; cannot safely join unrelated requests.

**Partial cluster (Gemini 3.1, Aug 29 2026):** 92 requests; 15 with cache reads. Stable prefix fingerprint:

- `prompt_tokens = 6319` fixed across sequential requests ~45s apart
- `cache_read_input_tokens = 3475` stable (≈55% of prompt)
- `provider_attempt_count = 2` on each → **INTERNAL_PROVIDER_ATTEMPT_CONFOUND** for clean lineage, but cache read is consistently reported

**Gemini 3.7 (Sep 17 2026):** 46 requests, all `cache_read = 0`, **`provider_attempt_count = 3` on all** → confounded; not usable as clean cache proof.

---

## GEMINI 3.1 CACHE HEALTH

**GEMINI31_CACHE_HEALTH = PARTIAL**

| Evidence | Finding |
|----------|---------|
| Provider capability | Cached-input pricing supported |
| App explicit cache | NO |
| 30d CI usage | 15.3% rows with cache_read > 0; median ratio 0 |
| Last 7d | **Zero G31 production requests** in window |
| Aug 29 cluster | Repeat reads on stable 6319-token prefix (~55% read ratio) |
| “75.2% warm” hypothesis | **CONTRADICTED** as current-production cache metric (fallback default / margin confusion) |

Cache **can** work via provider implicit path, but is **not reliably observed** in recent production volume.

---

## GEMINI 3.7 CACHE HEALTH

**GEMINI37_CACHE_HEALTH = NOT_OBSERVED**

| Evidence | Finding |
|----------|---------|
| Provider capability | Cached-input pricing supported |
| App explicit cache | NO |
| Growing-history harness T1–T10/T20 | **cacheRead = 0 every turn** despite input growth |
| 30d CI usage | 5.7% rows with cache_read > 0; median 0 |
| Last 7d | 46 rows, **all cache_read = 0** |
| Single-attempt subset | 1.2% cache_read > 0 |
| Multi-attempt confound | **77.2%** of rows have `provider_attempt_count > 1` |

Root-cause candidates (investigation only, no patch):

| Candidate | Status |
|-----------|--------|
| Provider automatic-cache threshold not met | **SUPPORTED** (harness + recent prod align on zero) |
| Prefix instability / dynamic tail break | **UNCONFIRMED** (prefix stability not measured this run) |
| Provider/model-specific cache behavior | **SUPPORTED** (sparse historical hits exist) |
| Routing / affinity (multi-attempt) | **SUPPORTED** (312/404 rows attempt>1) |
| Cache reporting semantics | **UNCONFIRMED** (`unknown`/`zero`/`hit` mixed) |
| Request structure (no explicit cache) | **SUPPORTED** (app sends plain messages) |

---

## DEEPSEEK V4 PRO 0813 CACHE HEALTH

**DEEPSEEK_V4_PRO_0813_CACHE_HEALTH = HEALTHY**

| Evidence | Finding |
|----------|---------|
| Provider capability | Cached-input pricing supported ($0.003824/1M read vs $0.462/1M standard) |
| App explicit cache | NO |
| 30d CI usage | **78.9%** rows cache_read > 0; median read ratio **0.97** among rows with hits |
| Single-attempt subset | **81.6%** cache_read > 0 |
| Legacy smoke | T2 `cached_input_tokens` 4096 on `deepseek-v4-pro` family |
| Last 7d | 4/38 hits (10.5%) — consistent with T1-cold / new-chat heavy window; not evidence of broken cache |

Economics: billed USD in usage rows reflects discounted cached input when `cache_read_input_tokens > 0` (see examples in `ci-usage-snapshot.json`).

---

## ATTEMPT TOPOLOGY

30-day Main RP CI usage subset (1,858 settled rows for the three models):

| Layer | Count | Notes |
|-------|------:|-------|
| **CLIENT_HTTP_REQUEST_COUNT** | 1,858 | One CI usage row ≈ one client HTTP completion (Main RP invariant) |
| **APP_RETRY_FALLBACK_COUNT** | **UNKNOWN** | Not exposed in usage API |
| **CI_REPORTED_PROVIDER_ATTEMPT_COUNT** | 2,749 | Σ `provider_attempt_count` |
| Rows with attempt > 1 | 772 (41.6%) | **INTERNAL_PROVIDER_ATTEMPT_CONFOUND** for clean cache lineage |

Per model attempt>1 rate: DeepSeek 32.9% · G31 26.0% · **G37 77.2%**.

Do **not** use G37 multi-attempt rows as clean cache proof without justification.

---

## ECONOMICS

| Model | User billing uses cache? | Provider bills cached input? | Observed in prod usage? |
|-------|-------------------------|------------------------------|-------------------------|
| DeepSeek V4 Pro 0813 | YES (`pointsReasoningMargins`) | YES | YES (dominant) |
| Gemini 3.1 Pro Preview | YES (unified reasoning path) | YES | PARTIAL (sparse) |
| Gemini 3.7 Flash | **NO** (user P ignores cache) | YES | Rare / NOT_OBSERVED on Main RP |

No savings estimates added where raw `billed_cost_usd` + token splits exist in usage rows.

---

## DEAD SYSTEM CLASSIFICATION

| System | Status | Action |
|--------|--------|--------|
| `geminiExplicitCache.ts` | Dead on Main RP | **KEEP** |
| `geminiCacheBulk.ts` | Dead on Main RP | **KEEP** |
| `geminiStaticDynamicContext.ts` | Gated off (`geminiStaticDynamicMode: false`) | **FOLLOW-UP** |
| `applyAnthropicCacheAndPrefill` | No-op for all 3 models | **KEEP** (Opus/historical) |
| `openRouterCache.ts` system split | Used for prefix estimation, not CI cache_control | **KEEP** |
| `GEMINI_EXPLICIT_CACHE` env | Unused on Main RP | **FOLLOW-UP** |
| DeepSeek legacy alias `deepseek-v4-pro` | Normalized to `-0813` at wire | **KEEP** |

Nothing deleted in this audit.

---

## ROOT CAUSE CANDIDATES FOR UNHEALTHY MODELS

### Gemini 3.7 (primary gap)

1. **Provider implicit cache not engaging** on production assembled prompts (harness + recent prod agree) — **SUPPORTED**
2. **High internal provider attempt rate** (77%) obscuring/losing cache affinity — **SUPPORTED**
3. **No app-side cache breakpoint** (unlike retired Opus Anthropic path) — **SUPPORTED**
4. Prefix instability from dynamic system tail — **UNCONFIRMED**

### Gemini 3.1 (secondary)

1. Low hit rate outside brief Aug clusters — **SUPPORTED**
2. Zero recent production volume — **SUPPORTED**
3. Misleading 75.2% baseline fallback in architecture audit script — **CONTRADICTED** as health metric

---

## FUTURE LIVE PROBE (proposal only — not executed)

**Priority:** Gemini 3.7 Flash first (NOT_OBSERVED).

| Parameter | Value |
|-----------|-------|
| Fixture | Deterministic character + fixed user turns (reuse growing-history seed) |
| Turns | T1 cold → 30–60s → T2 warm (same stable prefix) |
| Constraints | `provider_attempt_count` must equal 1 after T1; else **STOP_INTERNAL_PROVIDER_ATTEMPT_CONFOUND** |
| Path | Production `buildContext` → `assemblePrimaryRpRequest` → CI (no app retry/fallback/continuation) |
| Approval | **Required before any paid generation** |

Do **not** probe all three models in one run.

---

## FINAL CLASSIFICATION

```
GEMINI31_CACHE_HEALTH              = PARTIAL
GEMINI37_CACHE_HEALTH              = NOT_OBSERVED
DEEPSEEK_V4_PRO_0813_CACHE_HEALTH  = HEALTHY
NEW_PROVIDER_GENERATION_CALLS      = 0
RUNTIME_CHANGE                     = 0
MERGE                              = NO
```

---

## ARTIFACTS

| File | Description |
|------|-------------|
| `ci-usage-snapshot.json` | Aggregates + catalog + recent examples |
| `ci-usage-rows.json` | Full 30d row extract per model |
| `scripts/main-rp-cache-health-readonly.ts` | Reproducible read-only collector |
