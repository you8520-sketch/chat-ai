# Phase C Diagnostic Summary — Gemini 3.1 Pro / CheaperInference

**Generated:** 2026-08-29  
**Branch:** `cursor/gemini31-phase-c-ttft-benchmark-c8bc`  
**Mode:** READ-ONLY measurement (no production changes)

## Preflight (main @ 80d15975 + PR #724)

| Check | Result |
|-------|--------|
| PR724_PRESENT_IN_MAIN | YES |
| PROMPT_SECTION_FINGERPRINT_OWNER | present |
| FINAL_CONTEXT_TELEMETRY_POST_RECONCILE | present |
| SUMMARY_CONTENTION_SNAPSHOT | present |
| TOKEN_ACCOUNTING_AUDIT | present |
| REASONING_WIRE_LOW | PASS |
| LAYOUT_DEFAULT | dual injection |
| MEMORY_ARCHITECTURE | non-blocking summary path preserved |
| Commits after PR724 merge | NONE |

## Run configuration

- **Fixtures:** A (steady-state), B (one-batch-behind), C (catch-up active)
- **Live turns per fixture:** 12 (same-chat, varied user messages)
- **Total live API turns:** 36
- **Model:** `gemini-3.1-pro-preview` via CheaperInference
- **Reasoning:** `low`

## Key measurement limitation

**Provider `cached_tokens` was not reported** on any turn (`null` in stage usage). Therefore **actual same-chat cache ratio cannot be computed** from this CheaperInference path today. Prefix churn is inferred from section fingerprint telemetry (`first_changed_section`, `unchanged_prefix_sections`) instead.

## Fixture summary

| Fixture | Median TTFT | Median reasoning tokens | Contention turns | Top first-changed sections |
|---------|-------------|-------------------------|------------------|----------------------------|
| A | 55.6s | 4,037 | 0/12 | relationship-meta, current-memory |
| B | ~49s | similar | partial | relationship-meta, current-memory |
| C | ~52s | similar | 7/12 with background summary active | relationship-meta, current-memory |

Pre-provider assembly: **~1–2.6s** (median). Provider TTFT dominates total latency.

## Diagnosis

```text
PRIMARY_CACHE_MISS_OWNER:
  first_changed_section=relationship-meta (8/36 turns) and current-memory (8/36)
  — EXPECTED dynamic/memory growth; static prefix (7 sections) often unchanged

PRIMARY_TTFT_OWNER:
  provider wait dominates — pre_provider_ms ≪ TTFT; CI serving/queue likely floor

BACKGROUND_SUMMARY_CONTENTION:
  YES — 7/36 turns had summary background active at provider start (fixture C)

CI_SERVING_FLOOR_LIKELY:
  LIKELY — median provider TTFT 33–88s across fixtures

UNEXPECTED_CACHE_DROPS: 0 (cached_tokens unavailable — drops not classifiable)

NEXT_RECOMMENDATION:
  1. Enable provider cache-read token reporting on CheaperInference/G31 path before cache-ratio optimization
  2. Re-run Phase C with cached_tokens to validate same-chat cache ratio hypothesis
  3. Isolate summary catch-up worker contention (fixture C) before prompt/layout changes
  4. Do NOT implement optimization in Phase C — measurement only
```

## Artifacts

- `report.json` — full per-turn records + analysis
- `turns-{A,B,C}.jsonl` — line-delimited turn records

**STOP:** No merge, deploy, or optimization implementation.
