# Phase C.1 Diagnostic Summary — Corrected Root-Cause Report

**Branch:** `cursor/gemini31-phase-c-ttft-benchmark-c8bc` (Draft PR #736)  
**Mode:** READ-ONLY — no production changes  
**Corrects:** Phase C initial analyzer misclassifications

## GEMINI31_CI_PHASE_C1_ROOT_CAUSE

```text
PRODUCTION_CHANGED: NO
EXISTING_PHASE_C_DIAGNOSIS_CORRECTED: YES
PR736_PRODUCTION_FILES_CHANGED: 0

CACHE_READ_REPORTING: UNAVAILABLE
CACHE_RATIO: NOT_MEASURABLE
CI_EXACT_MATCH_CACHE: separate — not in done.usage; gateway headers not captured in legacy 36-run

BACKGROUND_SUMMARY_OVERLAP: OBSERVED (7/36 turns all-fixtures; fixture C alone 6/12)
BACKGROUND_SUMMARY_CONTENTION: NO_EVIDENCE
  — active P50 TTFT 41,337ms < inactive P50 49,092ms (all 36 runs)
  — overlap ≠ contention

COUNT_MISMATCH_ROOT_CAUSE:
  Legacy report "7/36" counted all-fixture overlap total (A:0, B:1, C:6).
  Fixture C JSONL is 6 active / 6 inactive — raw data consistent.

SUMMARY_ACTIVE_N: 7 (all fixtures) | 6 (fixture C only)
SUMMARY_INACTIVE_N: 29 | 6 (fixture C only)

TTFT_VS_REASONING (36 rescored runs):
  ALL: Pearson 0.9365, Spearman 0.9056 (n=35)
  A:   Pearson 0.9369, Spearman 0.9091
  B:   Pearson 0.9608, Spearman 0.8671
  C:   Pearson 0.9601, Spearman 0.9580

PROVIDER_WAIT_P50: 9,407ms (stage-timing follow-up n=10)
VISIBLE_TTFT_P50: 43,848ms (36-run rescored) / 43,848ms (follow-up)
PRE_VISIBLE_GAP_P50: 32,553ms (follow-up)

HIGH_PROVIDER_SIDE_PRE_VISIBLE_LATENCY: YES
PRIMARY_PRE_VISIBLE_LATENCY_OWNER: HIDDEN_REASONING
  — CASE B: provider_first_sse P50 ~9.4s << visible_ttft P50 ~43.8s
  — pre_visible_gap P50 ~32.6s (hidden/non-visible generation after stream opened)
  — TTFT vs reasoning_tokens Pearson 0.94 (36 runs)

CI_SERVING_FLOOR: NOT_CONFIRMED
  — gateway wait is NOT the dominant 30–90s block; hidden pre-visible generation is

COST_FIELD_SEMANTICS: done.cost = user_charge_points (settlement.settledPoints), NOT USD
VISIBLE_TOKEN_FIELD_SEMANTICS: provider_completion_tokens (includes reasoning); visible_chars from stream

ROOT_CAUSE_STATUS: ROOT_CAUSE_CONFIRMED_READ_ONLY
NEXT_RECOMMENDATION: Investigate hidden reasoning pre-visible generation under reasoning_effort=low. Do NOT reduce reasoning or change production yet. Enable CI cache-read token reporting before cache-ratio work.
```

## Corrected vs Phase C (initial)

| Claim (Phase C) | Correction (C.1) |
|-----------------|------------------|
| BACKGROUND_SUMMARY_CONTENTION = YES | **NO_EVIDENCE** — active group not slower |
| cache_ratio = 0 | **NOT_MEASURABLE** — `cached_tokens` always null |
| CI_SERVING_FLOOR_LIKELY | **UNKNOWN** — need PROVIDER_WAIT_MS decomposition |
| billed_cost_usd | **user_charge_points** (293 = points, not USD) |
| visible_output_tokens | **provider_completion_tokens** (includes reasoning) |
| summary_barrier_ms | **memory_sync_to_canon_ms** (T4→T5, not summary LLM barrier) |

## Cache dataflow finding

`parseOpenRouterUsage()` uses `readNum`/`pickUsageField` → **missing cache fields collapse to 0**.  
Client `done.usage` **omits** `cacheReadTokens` when zero/unreported.  
Phase C legacy collector wrote `cache_ratio: 0` when `cached_tokens: null` — **fixed in C.1 analyzer**.

## Artifacts

- `report-c1.json` — rescored 36 turns
- `METRIC_AUDIT.md` — per-metric semantics
- `ci-usage-inventory.json` — usage key inventory (no bodies)
- `stage-timing-followup-summary.json` — after follow-up completes

**STOP** — No merge, deploy, or latency optimization.
