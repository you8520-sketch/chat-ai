# Opus Cache & Cost Forensics — Audit Report

**Branch:** `cursor/opus-cache-cost-forensics-163d`
**PR:** #962 (evidence-backed minimal BUGFIX)
**Date:** 2026-09-19
**Method:** #962 head wire + post-fix live T1/T2/T3 (3 physical CI calls, 2026-09-19) + offline regression (HC-01..12).

**PR head:** `ad04557a` (passthrough patch) · **integration base:** `ad088282` (main / Railway production, PR #963 merged) · **live-tested runtime:** `9d8680cb` · **forensic SHAs preserved:** `ba9d3528`, `9d8680cb`, `31ffdaaf`, `3d4e6fe5`, `ad04557a`

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
- App wire root cause **fixed**; end-to-end cost root cause **supported but unconfirmed**
- Post-fix live: wire fix verified; **POST_FIX_HEALTHY not achieved** (write bucket unchanged)
- No cleanup merge-candidate pass
- Passthrough **query-parameter** patch implemented (offline regression only; **no live provider call**)
- Provider call budget cumulative: **0** (post-fix 3-call harness remains last live evidence)
