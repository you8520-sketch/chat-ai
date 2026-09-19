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

**PR scope label:** `RUNTIME_CHANGE = 0` · `AUDIT_TOOLING_CHANGE = YES` (read-only collector + offline prefix scripts; not docs-only).

---

## PR SCOPE CORRECTION

#966 adds durable audit artifacts and **read-only tooling**, not runtime behavior:

- `AUDIT_REPORT.md`
- `ci-usage-snapshot.json` (aggregates only)
- `scripts/main-rp-cache-health-readonly.ts`
- `scripts/gemini37-prefix-cache-eligibility-audit.ts`
- `g37-prefix-eligibility-offline.json`

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

**Decision matrix:** **CASE B** — prefix ≥ 4096 on production assembly, yet recent live usage shows cache_read = 0. Prompt layout alone is **insufficient** to explain missing cache.

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

## SYSTEM DELTA

| | |
|--|--|
| **BEFORE (#966 v1)** | Over-broad causal labels; full raw telemetry in git; stale `mainShaExpected`; equated CI rows to client HTTP count |
| **OBSERVED** | DeepSeek cache works at scale; G31/G37 hits exist historically; G37 recent prod all zero |
| **PROVEN (offline)** | G37 production prompt T1–T2 common prefix **≥ 4096 tokens**; system sections stable; static/dynamic does not change wire prefix |
| **NOT PROVEN** | Why G37 recent cache_read=0 despite eligible prefix; DeepSeek 7d hit-rate drop cause; G31 current health (no traffic) |
| **FIX CANDIDATE** | None from this audit — CASE B → provider/routing/semantics investigation first |

---

## NEXT STEP

| Question | Answer |
|----------|--------|
| Paid G37 probe required? | **YES** (if root cause still needed) — prefix eligibility alone does not explain zero recent cache |
| Runtime patch required now? | **NO** |

**Future G37 probe design (proposal only):**

- T1 cold → controlled interval → T2 warm
- Same deterministic fixture · stable prefix · no app retry/fallback/continuation
- Hard gate: T1 `provider_attempt_count === 1` else **STOP_INTERNAL_PROVIDER_ATTEMPT_CONFOUND** — do not run T2
- Requires separate approval before paid generation

---

## FINAL CLASSIFICATION

```
DEEPSEEK_CACHE_FUNCTIONALITY           = CONFIRMED
DEEPSEEK_30D_CACHE_HEALTH              = HEALTHY
DEEPSEEK_RECENT_7D_CACHE_HEALTH        = INSUFFICIENT_SEQUENTIAL_EVIDENCE

GEMINI31_CACHE_FUNCTIONALITY           = CONFIRMED_HISTORICALLY
GEMINI31_30D_CACHE_HEALTH              = PARTIAL
GEMINI31_RECENT_7D_CACHE_HEALTH        = INSUFFICIENT_NO_TRAFFIC

GEMINI37_CACHE_FUNCTIONALITY           = CONFIRMED_HISTORICALLY
GEMINI37_RECENT_7D_CACHE_HEALTH        = NOT_OBSERVED
GEMINI37_CACHE_HEALTH                  = NOT_OBSERVED_RECENTLY

G37_CURRENT_PREFIX_CACHE_ELIGIBILITY   = ELIGIBLE
G37_PREFIX_LAYOUT_ROOT_CAUSE           = WEAKENED

NEW_PROVIDER_GENERATION_CALLS          = 0
RUNTIME_CHANGE                         = 0
AUDIT_TOOLING_CHANGE                   = YES
MERGE                                  = NO
```

---

## ARTIFACTS

| File | Purpose |
|------|---------|
| `ci-usage-snapshot.json` | Aggregated 30d CI usage metrics |
| `g37-prefix-eligibility-offline.json` | Offline prefix / eligibility proof |
| `scripts/main-rp-cache-health-readonly.ts` | Reproducible usage API collector |
| `scripts/gemini37-prefix-cache-eligibility-audit.ts` | Offline G37 prefix audit |
