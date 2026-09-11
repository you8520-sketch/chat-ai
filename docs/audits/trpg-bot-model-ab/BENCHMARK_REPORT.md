# TRPG Bot-Seat A/B Benchmark Report

Generated: 2026-08-28T08:50:13.997Z

## Comparison

| Metric | Gemini 3.7 Flash | GPT-5.6 Luna |
| --- | ---: | ---: |
| CALLS | 20.00 | 20.00 |
| SUCCESS_RATE | 95.0% | 100.0% |
| AVG_INPUT_TOKENS | 8245.11 | 8526.40 |
| AVG_OUTPUT_TOKENS | 297.53 | 388.65 |
| AVG_CACHE_READ_TOKENS | 1287.47 | 4680.00 |
| LATENCY_MEAN | 11831.32 | 8084.75 |
| LATENCY_P50 | 12164.00 | 7954.00 |
| LATENCY_P75 | 13894.00 | 8313.00 |
| LATENCY_P90 | 18686.00 | 10318.00 |
| LATENCY_P95 | 23612.00 | 11339.00 |
| LATENCY_MAX | 23612.00 | 11810.00 |
| AVG_ACTUAL_COST_USD | 0.0045 | 0.0005 |
| PARSE_SUCCESS_RATE | 100.0% | 100.0% |
| ACTION_TYPE_VALID_RATE | 100.0% | 100.0% |
| INTENT_VALID_RATE | 100.0% | 100.0% |
| FALLBACK_RATE | 0.0% | 0.0% |
| USER_AGENCY_VIOLATION_RATE | 0.0% | 0.0% |
| CONSEQUENCE_VIOLATION_RATE | 0.0% | 0.0% |

## Human quality (blank — score in HUMAN_REVIEW.md)

| Metric | Gemini 3.7 Flash | GPT-5.6 Luna |
| --- | ---: | ---: |
| CHARACTER_VOICE | | |
| KOREAN_NATURALNESS | | |
| CHARACTER_SETTING_FIDELITY | | |
| SCENE_UNDERSTANDING | | |
| ACTION_QUALITY | | |
| BOT2_COORDINATION | | |
| USER_AGENCY | | |
| CONSEQUENCE_DISCIPLINE | | |
| QUALITY_TOTAL | | |

## Cost (2-bot round, provider actual when available)

- Gemini: **14.30 KRW** (PASS) — est. from token rates
- Luna: **1.70 KRW** (PASS) — est. from token rates

## Request contracts

- **Gemini benchmark outbound:** `reasoning_effort: none` (production adapter uses `low`)
- **Luna benchmark outbound:** `reasoning: { effort: "none" }`, `reasoning_effort: "none"`
- Provider `usage.cost` was not exposed on most calls; costs are token-estimated.

## Failures

- F08 gemini-3.7-flash pass=2: HTTP 400 — {"error":{"message":"Reasoning is mandatory for this endpoint and cannot be disabled.","code":400,"metadata":{"provider_name":null}}}

## Final decision

- `FINAL_MODEL_WINNER`: **HUMAN_REVIEW_PENDING**
- `BEST_PRODUCTION_BOT_MODEL`: **HUMAN_REVIEW_PENDING**
- Cursor did not assign subjective quality scores.
