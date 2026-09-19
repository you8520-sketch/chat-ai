# Opus Cache & Cost Forensics — Audit Report

**Branch:** `cursor/opus-cache-cost-forensics-163d`
**PR:** #962 (evidence-backed minimal BUGFIX)
**Date:** 2026-09-19
**Method:** #962 head wire + post-fix live T1/T2/T3 (3 physical CI calls, 2026-09-19) + offline regression (HC-01..12).

**PR head:** `9d8680cbadb85a6a5205655b07af1c6cd66ef27a` · **main:** `6ab52974c61e2fedc9c75af6de7094096e9117a2`

---

## Final Classifications (separated)

| Label | Classification |
|-------|----------------|
| `SLIDING_RAW_HISTORY_CACHE_PREFIX` | **ROOT_CAUSE_CONFIRMED** |
| `CURRENT_OPUS_GROWING_HISTORY_CACHE` | **POST_FIX_HISTORY_WRITE_PERSISTS** (wire fixed; provider write bucket unchanged) |
| `CURRENT_OPUS_STATIC_PREFIX_CACHE` | **VERIFIED_WORKING** (17,357 read plateau T2/T3 post-fix) |
| `CACHE_AFFINITY_CHURN` | **CONFIRMED_BY_DETERMINISTIC_INPUT_CHANGE** (first retained history hash shifts each turn) |
| `CURRENT_OPUS_CACHE_HEALTH` | **PARTIAL_CACHE_ONLY** (wire 2-block ✓; economics unchanged vs pre-fix) |
| `ROOT_CAUSE_FIXED` | **SYMPTOM_MITIGATED_ONLY** (dead history marker removed; provider write attribution unchanged) |
| `HISTORICAL_OPUS_60K_INCIDENT` | **FAILURE_MODE_CONFIRMED** |
| `HISTORICAL_CACHE_BYPASS_UNDERLYING_CAUSE` | **ROOT_CAUSE_UNCONFIRMED** |
| `CURRENT_OPUS_PHYSICAL_PROMPT_DUPLICATION` | **NO_MATERIAL_DEFECT_FOUND** |
| `CURRENT_OPUS_BILLING_CONTRACT` | **UNVERIFIED_PRODUCTION_ENV_VALUE_REDACTED** |
| `OPUS_PUBLIC_EXPOSURE_GUARD` | **REMOVED_WITHOUT_CACHE_ROOT_CAUSE_PROOF** |

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

## STOP

- Draft PR #962 — **do not merge**
- Post-fix live: wire fix verified; **POST_FIX_HEALTHY not achieved** (write bucket unchanged)
- No cleanup merge-candidate pass (live did not meet healthy shape criterion #5)
- No `x-ci-prompt-cache*` / session affinity added
