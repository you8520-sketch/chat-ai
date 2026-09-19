# Opus Cache & Cost Forensics — Audit Report

**Branch:** `cursor/opus-cache-cost-forensics-163d`
**PR:** #962 (evidence-backed minimal BUGFIX)
**Date:** 2026-09-19
**Method:** #962 head wire + post-fix live T1/T2/T3 (3 customer HTTP requests, 2026-09-19) + offline regression (HC-01..12). Request-layer counts are tracked separately from CI `provider_attempt_count` (see Attempt Topology).

**PR head:** `ad04557a` (passthrough patch) · **integration base:** `ad088282` (main / Railway production, PR #963 merged)

**Runtime SHAs (separate — do not conflate):**

| Label | SHA |
|-------|-----|
| `HISTORY_MARKER_REMOVAL_LIVE_RUNTIME` | `9d8680cbadb85a6a5205655b07af1c6cd66ef27a` |
| `PASSTHROUGH_LIVE_RUNTIME` | `5291c893e2af0d50b5171e98b4177d4cd1e05fec` |
| `CURRENT_REPORT_HEAD` | `3951d4a18747d4ad7c76e465c842466480dc4308` (doc-only updates follow on branch) |

**Forensic SHAs preserved:** `ba9d3528`, `9d8680cb`, `31ffdaaf`, `3d4e6fe5`, `ad04557a`, `5291c893`, `702aee96`, `3951d4a1`

---

## Final Classifications (separated layers)

| Label | Classification |
|-------|----------------|
| `APP_HISTORY_BREAKPOINT_DEFECT` | **FIXED** |
| `APP_CACHE_POLICY_WIRE` | **VERIFIED_2_STATIC_BREAKPOINTS** |
| `APP_WIRE_ROOT_CAUSE` | **FIXED** (alias — history `cache_control` removed) |
| `MULTI_LAYER_CACHE_POLICY_CONTROL` | **CONFIRMED** (app + CI gateway + upstream + usage/billing layers) |
| `CI_GATEWAY_EXTRA_BREAKPOINT_CAUSALITY` | **SUPPORTED_PENDING_LIVE_DISCRIMINATOR** |
| `END_TO_END_OPUS_CACHE_COST_ROOT_CAUSE` | **SUPPORTED_NOT_CONFIRMED** |
| `SLIDING_RAW_HISTORY_CACHE_PREFIX` | **ROOT_CAUSE_CONFIRMED** (app-layer dead history marker) |
| `CURRENT_OPUS_GROWING_HISTORY_CACHE` | **POST_FIX_HISTORY_WRITE_PERSISTS** (provider write bucket unchanged after wire fix) |
| `CURRENT_OPUS_STATIC_PREFIX_CACHE` | **VERIFIED_WORKING** (17,357 read plateau T2/T3 post-fix) |
| `CACHE_AFFINITY_CHURN` | **NOT_CONFIRMED** (input fingerprint shifts each turn, but post-fix affinity = hit all turns) |
| `LIVE_CACHE_AFFINITY` | **HIT_T1_T2_T3** (routing/stickiness evidence — **not** equivalent to cache_read hit; T1 cacheRead=0) |
| `CURRENT_OPUS_CACHE_HEALTH` | **PARTIAL_CACHE_ONLY** (static read ✓; suffix still cache_write-priced) |
| `USAGE_NORMALIZER_MISCLASSIFICATION` | **NO** (raw CI usage API ≡ normalized) |
| `CI_API_KEY_PROMPT_CACHE_MODE` | **UNVERIFIED_ACCOUNT_SETTING** (`GET /v1/keys` → 403, scope `account:read` missing) |
| `API_KEY_PROMPT_CACHE_MODE` | **UNVERIFIED** (alias of `CI_API_KEY_PROMPT_CACHE_MODE`) |
| `HISTORICAL_OPUS_60K_INCIDENT` | **FAILURE_MODE_CONFIRMED** |
| `HISTORICAL_CACHE_BYPASS_UNDERLYING_CAUSE` | **ROOT_CAUSE_UNCONFIRMED** |
| `CURRENT_OPUS_PHYSICAL_PROMPT_DUPLICATION` | **NO_MATERIAL_DEFECT_FOUND** |
| `CURRENT_OPUS_BILLING_CONTRACT` | **UNVERIFIED_PRODUCTION_ENV_VALUE_REDACTED** |
| `OPUS_PUBLIC_EXPOSURE_GUARD` | **REMOVED_WITHOUT_CACHE_ROOT_CAUSE_PROOF** |
| `MERGE #962` | **NO** (wire fix alone does not restore end-to-end economics) |
| `APP_EXPLICIT_CACHE_TTL` | **5_MIN_DEFAULT** (`ANTHROPIC_EPHEMERAL_CACHE = { type: "ephemeral" }`; no `ttl:"1h"`) |
| `PRIOR_53_MIN_APP_EXPLICIT_CACHE_REUSE` | **CONTRADICTED_BY_APP_TTL** (does not rule out CI/provider implicit TTL) |
| `CLIENT_HTTP_REQUEST_COUNT_PASSTHROUGH` | **2** |
| `APP_RETRY_FALLBACK_COUNT` | **0** |
| `CI_PROVIDER_ATTEMPT_COUNT_PASSTHROUGH` | **5** (T1=4, T2=1) |
| `INTERNAL_PROVIDER_ATTEMPTS_PRESENT` | **CONFIRMED** (passthrough T1 only) |
| `PASSTHROUGH_T1_ALL_STANDARD` | **OBSERVED** |
| `PASSTHROUGH_T1_SUCCESSFUL_USAGE_CACHE_CREATION` | **NONE_REPORTED** |
| `PASSTHROUGH_T1_INTERNAL_ATTEMPT_CACHE_SIDE_EFFECT` | **UNCONFIRMED** |
| `PASSTHROUGH_T1_CACHE_LINEAGE` | **CONFOUNDED_BY_INTERNAL_PROVIDER_ATTEMPTS** |
| `PASSTHROUGH_T2_WARM_SUFFIX_IMPROVEMENT` | **NOT_OBSERVED** |
| `PASSTHROUGH_T2_CACHE_LINEAGE` | **UNPROVEN** |
| `T1_INTERNAL_ATTEMPT_SEED` | **SUPPORTED_POSSIBILITY** (unconfirmed) |
| `PASSTHROUGH_EXPERIMENT_VALIDITY` | **CONFOUNDED_BY_T1_PROVIDER_ATTEMPTS** |
| `PASSTHROUGH_PROVIDER_BEHAVIOR` | **INCONCLUSIVE_CACHE_LINEAGE** |
| `PASSTHROUGH_RUNTIME_PATCH` | **NOT_MERGE_READY** |
| `PRIOR_CACHE_WITHIN_TTL` (5-min default) | **NO** |
| `PASSTHROUGH_T2_PRIOR_CACHE_CONTAMINATION` | **UNCONFIRMED** |
| `INTERNAL_ATTEMPT_CACHE_SIDE_EFFECT` | **UNCONFIRMED** |
| `LOCAL_FORENSICS_PROVIDER_ROUTE_LIMIT` | **CONFIRMED** |
| `UPSTREAM_IMPLICIT_CACHE_CAUSALITY` | **SUPPORTED** (warm suffix shape; not end-to-end root cause) |

---

## Root Cause (confirmed structurally)

> A bounded sliding RAW suffix changes content before the Anthropic history cache breakpoint, so each turn writes a new cumulative history-prefix cache entry that the next shifted-head turn cannot reuse.

**Dataflow (Main RP):**

```
DB dialogue turns
  → messagesToTurns
  → resolveRawRecentTurnPool (RAW4 latest-N slice)
  → rawRecentTurnsToHistory
  → trimHistoryToBudget / alignHistoryPrefixDrop
  → contextBuilder shortTermHistory
  → buildOpenRouterMessages
  → applyAnthropicCacheAndPrefill (system cache only — post-fix)
  → final cache_control wire
```

**Per-turn properties (saturated fixture, HC-01):**

| Property | Turn N (12 playable) | Turn N+1 (13 playable) |
|----------|----------------------|------------------------|
| Retained pool head | turn 9 (USER-Q-9) | turn 10 (USER-K-10) |
| First retained identity | changes | changes |
| systemRules fingerprint | stable | stable |
| characterSettings fingerprint | stable | stable |
| History monotonic-growing | **no** — bounded sliding suffix | **no** |

---

## Workaround Audit

| Mechanism | Classification |
|-----------|----------------|
| `trimHistoryToBudget()` | **EFFECTIVE** (token budget owner) |
| `alignHistoryPrefixDrop()` | **OBSOLETE_FOR_MAIN_RP** (chunk drop does not stabilize sliding RAW head) |
| `HISTORY_TRIM_CHUNK_MESSAGES` | **USED_BY_OTHER_PATH** (trim alignment; not deleted) |
| `resolveRawRecentTurnPool()` | **EFFECTIVE** (RAW4 owner) |
| `resolveHistoryCacheBreakpointIndex()` | **KEEP** (diagnostic + HC-02 structural proof) |
| `HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES` | **KEEP** (diagnostic only) |

---

## Patch (minimal BUGFIX)

**Change:** For all production Anthropic Main RP paths (bounded sliding history), **do not emit** history `cache_control`.

**Preserved cache layout:**

```
system[rules + cache]
system[character + cache]
system[dynamic uncached]
history uncached
current user uncached
```

**Unchanged:** history text, RAW4/RAW5, summary, memory, prompt content, history budget, order, billing, routing, TTL, provider contract.

**Caller inventory (`applyAnthropicCacheAndPrefill` / `applyCacheAndPrefillForTransport`):**

| Path | History shape | History cache post-fix |
|------|---------------|------------------------|
| `assemblePrimaryRpRequest` (CI Opus) | BOUNDED_SLIDING | **removed** |
| `streamOpenRouterAdult` | BOUNDED_SLIDING | **removed** |
| `callOpenRouterAdult` | BOUNDED_SLIDING | **removed** |

No production **MONOTONIC_GROWING** Anthropic RP path found (HC-11).

---

## Live Evidence (pre-fix, 3 calls — separate approval)

| | T1 (cold) | T2 (warm) | T3 (warm) |
|--|-----------|-----------|-----------|
| Prompt | 45,110 | 40,695 | 36,280 |
| Cache read | 0 | **17,357** | **17,357** |
| Cache write | 44,441 | 22,669 | 18,254 |
| Standard | 669 | 669 | 669 |
| Growing history cache read | ≈0 | ≈0 | ≈0 |

---

## Offline Patch Economics (reference only — not billed forecast)

CI Opus 5 catalog: input $3.5/M · read $0.35/M · write $4.375/M · output $17.5/M

| Turn | Current input USD | Patch input USD | Savings |
|------|-------------------|-----------------|---------|
| LIVE-T2 | ~$0.1076 | ~$0.0878 | **~18.4%** |
| LIVE-T3 | ~$0.0950 | ~$0.0787 | **~17.2%** |

Model: same static read + dead history cache-write reclassified as standard input + same standard tail.

---

## HC Regression Matrix

| Test | Scope |
|------|-------|
| HC-01 | Saturated RAW sliding head changes per turn |
| HC-02 | Legacy breakpoint resolves; pre-fix would emit 3 blocks |
| HC-03 | Post-fix: no history cache_control |
| HC-04/05 | systemRules + characterSettings breakpoints preserved |
| HC-06 | Content parity (cache_control metadata only diff) |
| HC-07/08 | RAW4 / RAW5 unchanged |
| HC-09 | Regen unchanged (2 blocks) |
| HC-10 | Memory-disabled: bounded sliding, no history cache |
| HC-11 | No monotonic-growing production path retains history cache |
| HC-12 | CI Opus Main RP → **2** cache blocks |

Tests: `src/lib/openRouterHistoryCache.test.ts`

---

## SYSTEM DELTA

**BEFORE**

- History owner supplies bounded sliding recent suffix
- Cache owner assumes history prefix is reusable
- Static cache hits (~17K read)
- History breakpoint repeatedly writes changing prefix (dead write)

**AFTER**

- Bounded sliding history unchanged
- Only genuinely stable prefixes are cache owners (2 system blocks)
- Dead history cache-write removed

**REMOVED**

- History `cache_control` emission in `applyAnthropicCacheAndPrefill`
- `applyCacheControlToMessageContent` (unreachable)

**PRESERVED**

- #957 RAW4/RAW5, #958 noncanon, #959 episodic, #960 User Note, #961 continuity
- All prompt/history/memory semantics

**REGRESSION RISKS**

- Hypothetical monotonic-growing Anthropic path — none found in production

---

## Historical Production Incident (PR #440)

| Field | Value |
|-------|-------|
| Input / output | 60,522 / 6,221 |
| Cache read / write | **0 / 0** |
| Failure mode | **FULLY_UNCACHED_CONFIRMED** |

---

## Artifacts

```bash
node --conditions=react-server --import tsx --test src/lib/openRouterHistoryCache.test.ts
node --conditions=react-server --import tsx --test scripts/test-support/opusCacheCostForensics.test.ts
node --conditions=react-server --import tsx --test src/lib/opusGeminiSameSnapshotDiagnostic.test.ts
node --conditions=react-server --import tsx --test src/lib/openRouterCache.test.ts
```

---

## Post-Fix Live Verification (2026-09-19, 3 calls)

**Harness:** `buildContext → assemblePrimaryRpRequest → adaptCheaperInferenceChatBody` on PR head `9d8680cb` → direct CheaperInference fetch (NOT Railway `/api/chat`).

| | T1 | T2 | T3 |
|--|----|----|-----|
| prompt | 45,114 | 40,705 | 36,296 |
| standard | 673 | 673 | 673 |
| read | 0 | **17,357** | **17,357** |
| write | 44,441 | **22,675** | **18,266** |
| output | 16 | 16 | 16 |
| billed USD | $0.19151 | $0.10508 | $0.08634 |
| wire cache_control | **2** | **2** | **2** |
| history cache_control | **0** | **0** | **0** |
| affinity | hit | hit | hit |

**Total:** $0.382931 (pre-fix ref: $0.382812). Partition invariant holds all turns.

**Write attribution (T2):** `write = prompt − read − standard = 22,675` — entire non-static-read suffix (dynamic + sliding history + tail) still billed as cache_write despite history marker removal. Magnitude tracks history size (T3 write shrinks with prompt). Classification: **provider suffix cache-write behavior unchanged**.

**Caller inventory (production-reachable vs shape):**

| Path | History shape | Production reachable | History cache post-fix |
|------|---------------|----------------------|------------------------|
| `/api/chat` → `streamOpenRouterAdultToClient` | BOUNDED_SLIDING | **YES** | removed (2 system blocks) |
| `callOpenRouterAdult` (non-stream) | varies by caller | indirect | removed |
| `narrativeLengthContinuation` → `callOpenRouterAdult` | caller-supplied | **NO** (`NARRATIVE_LENGTH_CONTINUATION_ENABLED=false`) |
| `serverUnderLengthRecovery` → `callOpenRouterAdult` | caller-supplied | **NO** (`SERVER_UNDER_LENGTH_RECOVERY_ENABLED=false`) |

`CURRENT_MAIN_STREAM_HISTORY_SHAPE = BOUNDED_SLIDING`  
`CALL_OPENROUTER_ADULT_CONTINUATION_CALLER = PRESENT_BUT_PRODUCTION_UNREACHABLE_WHILE_LENGTH_SUPPLEMENT_DISABLED`

---

## Post-Fix Root-Cause Investigation (2026-09-19, provider call budget = 0)

Re-analysis of existing live artifacts only. No new provider calls, no code patch.

### RAW LIVE USAGE ATTRIBUTION (post-fix T1/T2/T3)

Source: `/opt/cursor/artifacts/opus-postfix-live-verify-report.json` + CI `GET /v1/usage/requests` read-only attribution (`opus-usage-api-attribution.json`).

| | T1 | T2 | T3 |
|--|----|----|-----|
| `prompt_tokens` | 45,114 | 40,705 | 36,296 |
| `cache_read_input_tokens` (raw) | 0 | **17,357** | **17,357** |
| `cache_write_input_tokens` (raw) | 44,441 | **22,675** | **18,266** |
| implied standard (raw) | 673 | 673 | 673 |
| `billed_cost_usd` (raw) | 0.191510 | 0.105080 | 0.086341 |
| pre-fix T2/T3 reference | — | read 17,357 / write 22,669 | read 17,357 / write 18,254 |

**Pre vs post delta:** wire cache blocks 3→2, history markers 1→0; usage shape unchanged within noise (+6 / +12 write tokens).

**Write attribution shape (T2):** `write ≈ prompt − read − standard` → entire non-static-read suffix (dynamic + sliding history) billed as `cache_write_input_tokens`; `standard ≈ 673` tracks current-user tail only.

### RESPONSE CACHE METADATA

| Field | T1 | T2 | T3 |
|-------|----|----|-----|
| `x-ci-request-id` / `x-cheaper-inference-request-id` | 5be5af0b… | 98989b8b… | cfe23a66… |
| `x-ci-prompt-cache-affinity` | **hit** | **hit** | **hit** |
| `x-ci-prompt-cache` (response) | null | null | null |
| `x-ci-prompt-cache-scope` | null | null | null |
| `x-ci-prompt-cache-session` | null | null | null |
| `x-ci-cache` | absent | absent | absent |
| `x-ci-techniques` | absent | absent | absent |
| `x-ci-tokens-saved` | absent | absent | absent |
| `x-ci-saved-usd` | absent | absent | absent |
| `x-ci-discount-percent` | absent | absent | absent |

Pre-fix reference (`opus-live-cache-verify-report.json`): affinity = **new** all turns despite identical static fingerprint (`559d59eb50280cb2`). Post-fix affinity = **hit** all turns. Input-side `firstRetainedHistoryHash` shifts each turn in both runs — insufficient alone to prove provider affinity churn.

### APP CACHE POLICY OWNER (#962 head)

Production path: `assemblePrimaryRpRequest` → `applyCacheAndPrefillForTransport` → `applyAnthropicCacheAndPrefill` → `adaptCheaperInferenceChatBody` → `buildCheaperInferenceHeaders`.

| Question | Answer (code + live wire proof) |
|----------|--------------------------------|
| A. App sends `x-ci-prompt-cache`? | **NO** — `buildCheaperInferenceHeaders()` emits only `Content-Type` + `Authorization` |
| B. App sends `x-ci-prompt-cache-scope`? | **NO** |
| C. App sends `x-ci-prompt-cache-session`? | **NO** |
| D. App sends `prompt_cache_key`? | **NO** — not present anywhere in `src/` |
| E. OpenRouter `session_id` stripped on CI adapt? | **YES** — `adaptCheaperInferenceChatBody` deletes `session_id` |

**App explicit cache layout (post-fix, live-verified):**

```
system[rules + cache_control]
system[character + cache_control]
system[dynamic — no cache]
history messages — no cache_control
current user — no cache_control
```

Wire: **2** `cache_control` blocks, **0** history markers (preflight + live T1/T2/T3).

### CI / GATEWAY CACHE POLICY OWNER (CheaperInference API reference 2026-09-19)

Source: `https://www.cheaperinference.com/api-reference` — `POST /v1/chat/completions` **query parameters** (machine-readable OpenAPI at `/api/openapi.json` may lag; official customer docs list query params).

| Query param | Value | Documented meaning |
|-------------|-------|-------------------|
| `x-ci-prompt-cache` | `passthrough` | Default (or API key `prompt_cache_mode`). Forwards request unchanged re cache-control. |
| | `on` | Additionally marks prefix cacheable for Anthropic (`claude-*`); may add growing-conversation cache. |
| | `off` | Disables sticky affinity; removes explicit cache controls — **not used** (would forfeit app static cache). |
| `x-ci-prompt-cache-scope` | `session`/`user`/`org` | Sticky-affinity scope (not sent by app). |
| `x-ci-prompt-cache-session` | string | Session id when scope=session (not sent by app). |

**Effective mode when query absent:** default = `passthrough` **or** API key `prompt_cache_mode` — precedence when they differ is undocumented; key mode **UNVERIFIED**.

**Correction:** prior audit incorrectly described `x-ci-prompt-cache` as an HTTP **header**. Current official contract is a **query parameter** on the canonical base endpoint.

### ANTHROPIC OFFICIAL SEMANTICS (current docs)

Source: Anthropic prompt caching docs (2026).

| Field | Meaning |
|-------|---------|
| `cache_read_input_tokens` | Tokens served from existing cache entries (before breakpoints) |
| `cache_creation_input_tokens` | Tokens written to cache on this request |
| `input_tokens` | Tokens **after the last cache breakpoint** — uncached, standard-priced |

Identity: `total_input = cache_read + cache_creation + input_tokens`.

**Contract conflict:** Post-fix wire has last explicit breakpoints at characterSettings (2 blocks). Per Anthropic contract, dynamic + history + current user should appear primarily in `input_tokens` (standard). Observed post-fix T2/T3: `standard ≈ 673` (current user only), `write ≈ 22K/18K` (dynamic + history). **Conflicts with Anthropic explicit-breakpoint semantics** if no additional breakpoint exists downstream.

**Not re-investigating hidden app history markers** — live preflight already proved `historyCacheControlCount = 0`.

### USAGE NORMALIZER PARITY

Dataflow: raw CI response `usage` → `parseCompatibleUsage` / `parseOpenRouterUsage` → harness report → CI `GET /v1/usage/requests` billing row.

| Turn | raw `cache_read` | raw `cache_write` | raw implied standard | normalized match? |
|------|------------------|-------------------|----------------------|-------------------|
| T1 | 0 | 44,441 | 673 | ✓ |
| T2 | 17,357 | 22,675 | 673 | ✓ |
| T3 | 17,357 | 18,266 | 673 | ✓ |

`USAGE_NORMALIZER_MISCLASSIFICATION = NO`. Provider raw fields are authoritative; investigation proceeds on gateway/upstream cache policy.

### API KEY EFFECTIVE MODE

Attempted: `GET /v1/keys` with inference-scoped key → **403** (`account:read` scope required). `ApiKeySummary` schema in OpenAPI does not expose `prompt_cache_mode`.

`CI_API_KEY_PROMPT_CACHE_MODE = UNVERIFIED_ACCOUNT_SETTING` — not inferred as `on`.

### ROOT CAUSE CANDIDATES

| Candidate | Classification | Evidence |
|-----------|----------------|----------|
| A. `CI_GATEWAY_AUTO_BREAKPOINT` | **SUPPORTED** | OpenAPI `on` mode documents Claude growing-conversation cache; write magnitude ≈ dynamic+history; standard ≈ current user only; behavior unchanged after app history marker removal |
| B. `CI_OPENAI_TO_ANTHROPIC_TRANSLATION` | **SUPPORTED** | Path is `/v1/chat/completions` OpenAI-compatible; translation layer may apply provider cache policy beyond caller markers |
| C. `USAGE_NORMALIZER_MISCLASSIFICATION` | **CONTRADICTED** | Raw CI usage API ≡ normalized values |
| D. `ANTHROPIC_UPSTREAM_IMPLICIT_CACHE` | **UNCONFIRMED** | No direct upstream Anthropic response in artifacts; cannot isolate from CI layer |
| Effective mode = API key `on` | **UNCONFIRMED** | Key settings unreadable; behavior consistent with `on` but also with gateway translation |

**Most supported root cause:** parallel CI/gateway cache augmentation (candidate A, possibly via unverified API-key `prompt_cache_mode=on`) — **not** residual app history markers.

### PARALLEL CACHE POLICY OWNER MAP

| Owner | Controls | Post-fix state |
|-------|----------|----------------|
| App explicit `cache_control` | systemRules + characterSettings breakpoints | 2 blocks, live-verified |
| CI gateway `x-ci-prompt-cache` query / key default | May add growing-conversation breakpoints (`on`) or passthrough | **Post-fix patch: Opus Main RP sends `?x-ci-prompt-cache=passthrough`** (offline only; live unverified) |
| CI sticky affinity | `x-ci-prompt-cache-affinity`, session scope | Responding `hit` post-fix |
| Anthropic upstream | Breakpoint semantics, implicit cache | Usage shape suggests extra breakpoint beyond app’s last marker |
| Usage reporting | `cache_read/write_input_tokens`, billing | Raw from CI; matches normalizer |
| Billing | `billed_cost_usd` on usage API | Authoritative for cost |

`MULTI_LAYER_CACHE_POLICY_CONTROL = CONFIRMED` — structural fact: app, CI gateway, upstream, usage, and billing are separate layers.

`CI_GATEWAY_EXTRA_BREAKPOINT_CAUSALITY = SUPPORTED_PENDING_LIVE_DISCRIMINATOR` — post-fix live usage shape consistent with gateway augmentation, but causality not confirmed until passthrough live experiment.

### MINIMAL PATCH (implemented offline — live unverified)

**Goal:** Preserve app 2-block static cache; pin CI gateway request mode to passthrough.

**Do NOT use `x-ci-prompt-cache=off`** — removes caller explicit cache controls.

**Implemented:** `resolveCheaperInferenceMainRpOpusFetchUrl()` + `resolveMainRpProviderFetchUrl()` append **`?x-ci-prompt-cache=passthrough`** query parameter on CI Claude Opus 5 Main RP fetch URL only. **Not** added to HTTP headers.

Canonical base endpoint unchanged: `https://api.cheaperinference.com/v1/chat/completions`

Desired effective policy:

```
CI gateway request: ?x-ci-prompt-cache=passthrough
App: systemRules cached, characterSettings cached, dynamic/history/current user uncached
```

**Scope:** CI Opus Main RP (`streamOpenRouterAdult`, `callOpenRouterAdult`, `assemblePrimaryRpRequest`). DeepSeek/Gemini/Qwen/OpenRouter/TRPG unchanged (PC-06..09).

**Regression:** PC-01..12 offline; HC-01..12 preserved.

### EXPECTED PRE/POST ECONOMICS (estimate, not billed)

CI Opus 5 catalog: input $3.5/M · read $0.35/M · write $4.375/M · output $17.5/M

**Current post-fix T2 (observed):** ~$0.10508
**If passthrough removes suffix cache-write (T2 warm, write→0):**

- read 17,357 × $0.35/M + standard ~23,348 × $3.5/M + output 16 × $17.5/M ≈ **$0.088** (~16% input savings vs current T2)
- Aligns with offline HC economics estimate (~18% at T2 reference fixture)

**2-call cold/warm sequence (approval required, not executed):** same fixture, `max_tokens=16`, retry/fallback/continuation/recovery = 0, explicit `x-ci-prompt-cache: passthrough`. Expected warm: `cacheRead ≈ 17,357`, `cacheWrite ≈ 0`, `standardInput ≈ dynamic + history + current user`.

### NEXT LIVE EXPERIMENT (approval required — NOT executed this task)

1. Deploy passthrough query patch (already in #962 head — offline only so far)
2. 2-call sequence (cold T1 + warm T2) — budget ~$0.28 conservative ceiling
3. Compare usage shape vs post-fix baseline above
4. If write bucket collapses to ≈0 on warm turn, upgrade `CI_GATEWAY_EXTRA_BREAKPOINT_CAUSALITY` and `END_TO_END_OPUS_CACHE_COST_ROOT_CAUSE` to **CONFIRMED**

### SYSTEM DELTA (investigation outcome)

**BEFORE (problem boundary)**

- App emitted dead history cache marker (fixed in #962)
- CI gateway effective cache mode uncontrolled / unverified
- Provider bills suffix as cache_write despite app uncached history

**PROPOSED AFTER (not implemented)**

- App keeps 2-block static cache
- CI gateway explicitly passthrough on Opus Main RP
- Suffix repriced as standard input on warm turns

**PRESERVED:** static 17,357 read benefit, all prompt/history/memory semantics

**REGRESSION RISKS:** passthrough might not override key-level `on` if precedence differs; must verify live. `off` would destroy static cache — excluded.

**PROOF REQUIRED:** approved 2-call passthrough experiment

---

## STOP

- Draft PR #962 — **do not merge**
- App wire root cause **fixed**; end-to-end cost root cause **ROOT_CAUSE_UNCONFIRMED**
- Post-fix live: wire fix verified; **POST_FIX_HEALTHY not achieved** (write bucket unchanged)
- Passthrough live: customer requests=2, CI provider attempts=5; T1 all-standard / zero cache reported / **4 internal attempts**; T2 warm suffix unchanged; **lineage UNPROVEN / CONFOUNDED**
- Passthrough runtime patch **`NOT_MERGE_READY`** — desired static-only caching not proven; T1 confounded; preserve live-tested `5291c893` until support/lineage resolved
- No cleanup merge-candidate pass
- **This investigation:** **0 new customer HTTP requests** (read-only CI usage API + offline reconstruction)
- **Main integration (2026-09-19):** merged `ad088282` (PR #963 billing/procurement); zero file overlap; `behind=0`

### Passthrough live discriminator (2026-09-19, runtime `5291c893`)

**Layered request counts (do not conflate):**

| Layer | Passthrough experiment |
|-------|------------------------|
| `CLIENT_HTTP_REQUEST_COUNT` | **2** (T1 + T2) |
| `APP_RETRY_FALLBACK_COUNT` | **0** (harness verified) |
| `CI_PROVIDER_ATTEMPT_COUNT` | **5** (T1=**4**, T2=1) |

Do **not** describe this only as “physical provider calls = 2”. Use: **customer-facing requests = 2**; **CI-reported provider attempts = 5**. Cache side effects across internal attempts are **UNCONFIRMED**.

| | T1 (cold) | T2 (warm) |
|--|-----------|-----------|
| Query param | `?x-ci-prompt-cache=passthrough` | same |
| `created_at` (CI usage API) | 2026-09-19T07:06:53Z | 2026-09-19T07:08:21Z |
| Δ prior turn | — | **88 s** after T1 |
| prompt | 45,117 | 40,708 |
| standard | **45,117** | **674** |
| read | 0 | **17,357** |
| write | **0** | **22,677** |
| USD | $0.15819 | $0.105092 |
| `provider_attempt_count` | **4** | 1 |
| `cache_reporting_state` | zero | hit |
| wire cache_control blocks | 2 (systemRules + characterSettings) | 2 |
| **Total billed** | | **$0.263282** |

Baseline (no passthrough, post-fix): T2 write=22,675 / standard=673 / read=17,357 / $0.10508.

**Do not classify as `NO_EFFECT`.** T1 materially changed vs baseline (write 44,441→0; entire prompt standard). T2 warm suffix buckets match baseline within noise. T2 `cache_read=17,357` lineage **UNPROVEN** — final T1 settled usage reports `cache_creation=0`, but T1 had **4 internal provider attempts** (`PASSTHROUGH_T1_CACHE_LINEAGE = CONFOUNDED_BY_INTERNAL_PROVIDER_ATTEMPTS`).

| Classification | Value |
|----------------|-------|
| `PASSTHROUGH_T1_ALL_STANDARD` | **OBSERVED** |
| `PASSTHROUGH_T1_SUCCESSFUL_USAGE_CACHE_CREATION` | **NONE_REPORTED** |
| `PASSTHROUGH_T1_INTERNAL_ATTEMPT_CACHE_SIDE_EFFECT` | **UNCONFIRMED** |
| `PASSTHROUGH_T2_WARM_SUFFIX_IMPROVEMENT` | **NOT_OBSERVED** |
| `PASSTHROUGH_T2_CACHE_LINEAGE` | **UNPROVEN** |
| `PASSTHROUGH_EXPERIMENT_VALIDITY` | **CONFOUNDED_BY_T1_PROVIDER_ATTEMPTS** |
| `PASSTHROUGH_PROVIDER_BEHAVIOR` | **INCONCLUSIVE_CACHE_LINEAGE** |
| `CI_GATEWAY_EXTRA_BREAKPOINT_CAUSALITY` | **UNCONFIRMED** |
| `UPSTREAM_IMPLICIT_CACHE_CAUSALITY` | **SUPPORTED** (T2 warm shape ≡ post-fix baseline; suffix write persists) |
| `END_TO_END_OPUS_CACHE_COST_ROOT_CAUSE` | **ROOT_CAUSE_UNCONFIRMED** |
| `CURRENT_OPUS_CACHE_HEALTH` | **PARTIAL_CACHE_ONLY** |
| `PASSTHROUGH_RUNTIME_PATCH` | **NOT_MERGE_READY** |

Artifacts: `/opt/cursor/artifacts/opus-passthrough-live-verify-report.json`, `/opt/cursor/artifacts/opus-full-timeline-usage-api.json`, `/opt/cursor/artifacts/opus-prefix-lineage-matrix.json`, `/opt/cursor/artifacts/opus-attempt-topology.json`

---

## Passthrough Root-Cause Investigation (2026-09-19, provider calls = 0)

Re-analysis of existing live artifacts + read-only CI `GET /v1/usage/requests`. No new provider calls, no runtime patch, no merge.

### CURRENT STATE (verified 2026-09-19)

| Field | Expected | Actual |
|-------|----------|--------|
| Repo | `you8520-sketch/chat-ai` | ✓ |
| PR #962 | OPEN, DRAFT, not merged | ✓ OPEN DRAFT MERGEABLE |
| Report head | `3951d4a1…` | ✓ (this doc update follows) |
| Passthrough live runtime | `5291c893…` | ✓ |
| Main / Railway | `ad088282…` | ✓ |
| Branch vs main | ahead 9, behind 0 | ✓ |

### LIVE REQUEST TIMELINE (all 8 Opus forensic calls, sorted by `created_at`)

Source: CI usage API (`limit=100`) cross-checked with harness artifacts. Only these 8 `claude-opus-5` rows exist in workspace history.

| # | Run | Turn | Request ID | `created_at` | Runtime | Query cache | prompt | standard | read | write | USD | attempts | cache_state |
|---|-----|------|------------|--------------|---------|-------------|--------|----------|------|-------|-----|----------|-------------|
| 1 | pre-fix | T1 | `a38bd8ab…` | 05:29:01Z | `6ab52974` | (none) | 45110 | 669 | 0 | 44441 | 0.191496 | 1 | zero |
| 2 | pre-fix | T2 | `a5f5e7c2…` | 05:29:51Z | `6ab52974` | (none) | 40695 | 669 | 17357 | 22669 | 0.105040 | 1 | hit |
| 3 | pre-fix | T3 | `0ae750bf…` | 05:30:41Z | `6ab52974` | (none) | 36280 | 669 | 17357 | 18254 | 0.086276 | 1 | hit |
| 4 | post-fix | T1 | `5be5af0b…` | 06:13:33Z | `9d8680cb` | (none) | 45114 | 673 | 0 | 44441 | 0.191510 | 1 | zero |
| 5 | post-fix | T2 | `98989b8b…` | 06:14:28Z | `9d8680cb` | (none) | 40705 | 673 | 17357 | 22675 | 0.105080 | 1 | hit |
| 6 | post-fix | T3 | `cfe23a66…` | 06:15:24Z | `9d8680cb` | (none) | 36296 | 673 | 17357 | 18266 | 0.086341 | 1 | hit |
| 7 | passthrough | T1 | `0d8ba895…` | 07:06:53Z | `5291c893` | passthrough | 45117 | **45117** | 0 | **0** | 0.158190 | **4** | zero |
| 8 | passthrough | T2 | `83a65180…` | 07:08:21Z | `5291c893` | passthrough | 40708 | 674 | 17357 | 22677 | 0.105092 | 1 | hit |

Inter-turn gaps: pre/post sequences ≈50 s; passthrough T1→T2 = **88 s**.

### COMPLETE ATTEMPT TOPOLOGY (CI usage API, all 8 requests)

Source: `/opt/cursor/artifacts/opus-attempt-topology.json`. CI docs describe `routing_overhead_ms` as including routing and prior attempts before successful provider dispatch — multiple internal attempts are **strongly indicated** but per-attempt cache side effects are **UNCONFIRMED**.

| Experiment | Turn | Request ID | `created_at` | Runtime | attempts | routing_oh_ms | ttf_headers_ms | model_ttf_headers_ms | total_lat_ms | cache_state | prompt | std | read | write | USD |
|------------|------|------------|--------------|---------|----------|---------------|----------------|----------------------|--------------|-------------|--------|-----|------|-------|-----|
| pre-fix | T1 | `a38bd8ab…` | 05:29:01Z | `6ab52974` | 1 | 1280 | 3892 | 2612 | 3947 | zero | 45110 | 669 | 0 | 44441 | 0.191496 |
| pre-fix | T2 | `a5f5e7c2…` | 05:29:51Z | `6ab52974` | 1 | 1792 | 4163 | 2371 | 4210 | hit | 40695 | 669 | 17357 | 22669 | 0.105040 |
| pre-fix | T3 | `0ae750bf…` | 05:30:41Z | `6ab52974` | 1 | 4649 | 7595 | 2946 | 7655 | hit | 36280 | 669 | 17357 | 18254 | 0.086276 |
| history-marker-removal | T1 | `5be5af0b…` | 06:13:33Z | `9d8680cb` | 1 | 2240 | 4396 | 2156 | 4453 | zero | 45114 | 673 | 0 | 44441 | 0.191510 |
| history-marker-removal | T2 | `98989b8b…` | 06:14:28Z | `9d8680cb` | 1 | 669 | 6083 | 5414 | 6153 | hit | 40705 | 673 | 17357 | 22675 | 0.105080 |
| history-marker-removal | T3 | `cfe23a66…` | 06:15:24Z | `9d8680cb` | 1 | 679 | 4667 | 3988 | 4731 | hit | 36296 | 673 | 17357 | 18266 | 0.086341 |
| passthrough | T1 | `0d8ba895…` | 07:06:53Z | `5291c893` | **4** | **35139** | 36648 | 1509 | 36971 | zero | 45117 | 45117 | 0 | **0** | 0.158190 |
| passthrough | T2 | `83a65180…` | 07:08:21Z | `5291c893` | 1 | 2932 | 8458 | 5526 | 8529 | hit | 40708 | 674 | 17357 | 22677 | 0.105092 |

**Was passthrough T1 `attempt_count=4` unique?** **YES** — all other T1 cold turns (pre-fix, history-marker-removal) report `provider_attempt_count=1`.

**Correlation (observational only — not causal proof):**

| T1 experiment | attempts | cache_write | routing_overhead_ms | total_latency_ms |
|---------------|----------|-------------|---------------------|------------------|
| pre-fix | 1 | 44441 | 1280 | 3947 |
| history-marker-removal | 1 | 44441 | 2240 | 4453 |
| passthrough | **4** | **0** | **35139** | **36971** |

High attempt count on passthrough T1 co-occurs with zero cache reporting and ~15–27× higher routing overhead vs other T1s. Do **not** infer which providers failed, whether attempts reached Anthropic, or whether superseded attempts wrote cache.

### APP EXPLICIT CACHE TTL

App code (`src/lib/openRouterCache.ts`):

```typescript
export const ANTHROPIC_EPHEMERAL_CACHE = { type: "ephemeral" as const };
```

No `ttl: "1h"` is emitted on app cache blocks. Anthropic contract: `ephemeral` without explicit `ttl` defaults to **5 minutes**.

| Label | Classification |
|-------|----------------|
| `APP_EXPLICIT_CACHE_TTL` | **5_MIN_DEFAULT** |
| `PRIOR_53_MIN_APP_EXPLICIT_CACHE_REUSE` | **CONTRADICTED_BY_APP_TTL** |

This does **not** rule out CI implicit cache, provider automatic cache, or gateway-controlled TTL with different lifetime.

### TTL OVERLAP AUDIT (app explicit cache = 5 minutes)

For each prior cache-producing request vs passthrough T2 (`07:08:21Z`):

| Prior request | `created_at` | Δ to passthrough T2 | write | P1+P2 prefix match | Within 5-min TTL? |
|---------------|--------------|---------------------|-------|--------------------|-------------------|
| pre-fix T1 | 05:29:01Z | 5960 s (~99 min) | 44441 | YES | **NO** |
| pre-fix T2 | 05:29:51Z | 5910 s | 22669 | YES (static) | **NO** |
| pre-fix T3 | 05:30:41Z | 5861 s | 18254 | YES (static) | **NO** |
| post-fix T1 | 06:13:33Z | 3289 s (~55 min) | 44441 | YES | **NO** |
| post-fix T2 | 06:14:28Z | 3234 s | 22675 | YES (static) | **NO** |
| post-fix T3 | 06:15:24Z | 3177 s (~53 min) | 18266 | YES (static) | **NO** |
| passthrough T1 | 07:06:53Z | **88 s** | **0** | YES | YES — but **no reported cache write** |

`PRIOR_CACHE_WITHIN_TTL` (5-min default) = **NO** for any prior request with reported cache creation.

`PASSTHROUGH_T2_PRIOR_CACHE_CONTAMINATION` (app explicit 5-min TTL) = **UNCONFIRMED** — P1/P2/P3 match post-fix T1 cache producer, but that entry is **3177–3289 s stale** (>5 min app TTL). **`PRIOR_53_MIN_APP_EXPLICIT_CACHE_REUSE` = CONTRADICTED_BY_APP_TTL**. Does not rule out CI/provider implicit cache with different lifetime.

### PREFIX LINEAGE MATRIX (offline fixture reconstruction)

Source: `/opt/cursor/artifacts/opus-prefix-lineage-matrix.json` — semantic content hashes, excluding `cache_control` metadata.

| Prefix | Definition | Stable all runs? |
|--------|------------|------------------|
| P1 | systemRules | **YES** — `67cbfa16…` |
| P2 | systemRules + characterSettings | **YES** — static combined `559d59eb50280cb2` |
| P3 | P2 + dynamic | **YES** |
| P4 | P3 + legacy history through breakpoint index 10 | NO — turns differ |
| P5 | P3 + full history prefix | NO — turns differ |

**Passthrough T2 vs post-fix T2:** P1/P2/P3 **equal**; P5 **equal**; `fullSemanticPayload` **equal**. Confirms same fixture family and warm-turn payload parity.

**Passthrough T2 vs cache producers (pre-fix T1, post-fix T1):** P1/P2/P3 **equal**; P4/P5 differ (expected — T1 cold turn).

### PASSTHROUGH T1 ZERO-WRITE ANALYSIS

Wire (preflight + live, runtime `5291c893`):

- Fetch URL: `…/v1/chat/completions?x-ci-prompt-cache=passthrough` (**query param**, not HTTP header)
- Request headers: `Content-Type`, `Authorization` only
- `cache_control` blocks: **2** at systemRules + characterSettings
- History `cache_control`: **0**
- `session_id`: stripped on adapt

Observed usage: prompt 45,117 = standard 45,117; read 0; write 0; billed $0.158190 (standard-input pricing for entire prompt).

| Candidate | Classification | Notes |
|-----------|----------------|-------|
| A. CI OpenAI-compatible translation dropped/ignored caller `cache_control` | **SUPPORTED** | T1 all-standard despite 2 explicit blocks |
| B. Upstream did not create cache despite markers | **SUPPORTED** | Consistent with zero write/read |
| C. Implicit-cache path with different reporting semantics | **UNCONFIRMED** | No route/provider fields available |
| D. Passthrough changed effective cache translation vs baseline | **SUPPORTED** | Baseline T1 write=44,441; passthrough T1 write=0 |
| E. Final settled usage under-reports cache from prior internal attempts | **UNCONFIRMED** | T1 `provider_attempt_count=4`; do not assume cache token fields aggregate all four attempts |

### PASSTHROUGH T1 INTERNAL ATTEMPT ANALYSIS

| Label | Classification |
|-------|----------------|
| `INTERNAL_PROVIDER_ATTEMPTS_PRESENT` | **CONFIRMED** (T1 attempts=4; unique among all T1s) |
| `PASSTHROUGH_T1_SUCCESSFUL_USAGE_CACHE_CREATION` | **NONE_REPORTED** (read=0, write=0, standard=45117) |
| `PASSTHROUGH_T1_INTERNAL_ATTEMPT_CACHE_SIDE_EFFECT` | **UNCONFIRMED** |
| `PASSTHROUGH_T1_CACHE_LINEAGE` | **CONFOUNDED_BY_INTERNAL_PROVIDER_ATTEMPTS** |

Do **not** assume `cache_read_input_tokens` / `cache_write_input_tokens` on the settled row reflect all four internal attempts.

### PASSTHROUGH T2 CACHE SOURCE ANALYSIS

Question: where could `read=17,357` come from?

| # | Source | Support | Reason |
|---|--------|---------|--------|
| A | Cache from final successful T1 attempt | **WEAK / UNSUPPORTED** | Final settled T1 usage: write=0 |
| B | Cache side effect from one of T1's prior internal attempts | **SUPPORTED_POSSIBILITY** / **UNCONFIRMED** | T1 attempts=4; cache fields may reflect final attempt only |
| C | 53-minute-old app explicit cache (post-fix T1) | **CONTRADICTED_BY_APP_TTL** | App emits 5-min default ephemeral; Δ=3289 s |
| D | CI/provider implicit automatic cache on T2 | **SUPPORTED** | T2 warm shape ≡ post-fix baseline |
| E | Longer-lived gateway/provider implicit cache | **UNCONFIRMED** | No TTL observability for non-app layers |
| F | Usage reporting artifact | **UNCONFIRMED** | Raw live response ≡ usage API |

**Recommended classifications:**

- `PASSTHROUGH_T2_CACHE_LINEAGE` = **UNPROVEN**
- `T1_INTERNAL_ATTEMPT_SEED` = **SUPPORTED_POSSIBILITY** (unconfirmed)
- `UPSTREAM_OR_GATEWAY_IMPLICIT_CACHE` = **SUPPORTED**

### PROVIDER OBSERVABILITY LIMIT

CI `GET /v1/usage/requests` **does expose:** `request_id`, `created_at`, `model`, `endpoint`, `prompt_tokens`, `cache_read_input_tokens`, `cache_write_input_tokens`, `billed_cost_usd`, `provider_attempt_count`, `cache_reporting_state`, `status`.

**Does not expose:** effective `prompt_cache_mode`, per-request query params, forwarded Anthropic wire, private serving route. Schema documents `route` and `serving_provider` as **always null** (withdrawn).

`LOCAL_FORENSICS_PROVIDER_ROUTE_LIMIT` = **CONFIRMED**

### SUPPORT EVIDENCE PACKET (draft — not sent)

**Model:** `claude-opus-5` · **Endpoint:** `POST /v1/chat/completions` · **Query:** `?x-ci-prompt-cache=passthrough`

**Caller cache controls:** 2 explicit blocks (systemRules + characterSettings); 0 history breakpoint. No API secrets or prompt bodies included.

| | T1 | T2 |
|--|----|----|
| Request ID | `0d8ba895-22b4-4ddd-920f-2d5d10abbf26` | `83a65180-e5df-48e4-bdb5-f70ab4973b71` |
| Time | 2026-09-19T07:06:53Z | 2026-09-19T07:08:21Z (+88 s) |
| Customer HTTP requests | 1 | 1 |
| `provider_attempt_count` | **4** | 1 |
| prompt / standard / read / write | 45117 / 45117 / 0 / 0 | 40708 / 674 / 17357 / 22677 |
| billed USD | $0.158190 | $0.105092 |

**Priority questions for CheaperInference (attempt semantics — ask first):**

1. For request `0d8ba895-22b4-4ddd-920f-2d5d10abbf26` (`provider_attempt_count=4`): does this mean four upstream provider dispatch attempts occurred inside this single customer request?
2. Are `cache_read_input_tokens` and `cache_write_input_tokens` reported only for the successful/final attempt, or aggregated across all provider attempts?
3. Can a failed or superseded prior provider attempt create Anthropic/provider prompt-cache state that a later request can reuse?
4. If such a prior attempt creates cache state, is that cache creation included in the final settled request's `cache_write_input_tokens`?

**Existing policy / behavior questions:**

5. Was `?x-ci-prompt-cache=passthrough` effective for both request IDs?
6. What effective API-key `prompt_cache_mode` was applied?
7. Were the two caller `cache_control` blocks forwarded upstream?
8. Why did T1 report read=0 / write=0 despite two explicit caller breakpoints (entire prompt standard)?
9. Why did T2, 88 seconds later, report read=17,357 / write=22,677?
10. Was automatic/implicit prompt caching active?
11. Can `/v1/chat/completions` support caller-owned static explicit caching + uncached growing conversation?
12. If not, should Claude Opus use `/v1/messages` for precise cache-control ownership?
13. Does request-level passthrough override an API-key `prompt_cache_mode` setting?

### FUTURE CLEAN-ROOM EXPERIMENT (design only — not executed)

**Gate:** Do not execute until CheaperInference support response is reviewed.

Requirements: never-before-used static prefix fingerprint; identical P1/P2/P3 in T1+T2; no shared prior prefix; `max_tokens=16`; app retry/fallback/continuation/recovery=0; T1 → inspect usage API → 50 s → T2.

**NEW HARD GATE after T1:** inspect `provider_attempt_count` on T1 usage row.

- If `provider_attempt_count != 1` → **`STOP_INTERNAL_PROVIDER_ATTEMPT_CONFOUND`** — do **not** execute T2.
- Prevents another ambiguous T1→T2 cache lineage.

If T1 `provider_attempt_count=1`:

| Outcome | Interpretation |
|---------|----------------|
| CASE A: T1 static write only; T2 static read; history standard | `EXPLICIT_STATIC_CACHE_WORKS` |
| CASE B: T1 all standard; T2 all standard | `PASSTHROUGH_CALLER_CACHE_CONTROL_NOT_EFFECTIVE` |
| CASE C: T1 all standard; T2 read + growing write | `IMPLICIT_AUTOMATIC_CACHE_STRONGLY_SUPPORTED` |

### NATIVE `/v1/messages` OPTION (research only)

CheaperInference exposes `POST /v1/messages` (native Anthropic transport). If OpenAI-compatible `/v1/chat/completions` cannot provide caller-owned static explicit cache + uncached sliding history, classify native Messages for Opus as **`ARCHITECTURE_OPTION`**. Not implemented in #962. Future transport change requires: stream format, usage parsing, thinking fields, error envelopes, max_tokens, billing evidence, retry/fallback, safety, all Main RP caller audit.

### Next live cost budget (future experiments)

| Outcome | Approx total (2-call) |
|---------|----------------------|
| Expected healthy passthrough | ~$0.26 |
| Expected no-effect (negative control) | ~$0.30 |
| Hard safety ceiling (not target spend) | **$0.33** |
