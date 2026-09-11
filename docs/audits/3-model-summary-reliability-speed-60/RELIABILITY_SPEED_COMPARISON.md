# 3-Model Summary Reliability / Speed / Cost (60 calls each)

PURPOSE: Reliability/speed/cost screening — **not** quality rescoring.
CURSOR_FINAL_MODEL_RANKING: NOT PERFORMED

GPT quality reference (not recomputed): Gemini 91.0, DeepSeek V4 84.5, GLM 82.5, 0731 excluded.

## Summary table

| Model | Valid | Hard fail | Empty | Timeout | Length | P50 (ms) | P90 (ms) | P95 (ms) | Avg cost | Cost / valid |
| ----- | ----: | --------: | ----: | ------: | -----: | -------: | -------: | -------: | -------: | -----------: |
| Gemini 3.1 Flash-Lite | 60/60 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 2570 | 4432 | 5524 | 0.000752 | 0.000752 |
| DeepSeek V4 Flash | 60/60 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 36 (60.0%) | 5776 | 8575 | 10310 | 0.000069 | 0.000069 |
| GPT-5.6 Luna (production background) | 60/60 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 4206 | 7717 | 9641 | 0.000201 | 0.000201 |

## Provider distribution

| Model | Provider | Calls | Valid | Failures | Median latency (ms) |
| ----- | -------- | ----: | ----: | -------: | ------------------: |
| DeepSeek V4 Flash | NOT_AVAILABLE | 60 | 60 | 0 | 5776 |
| GPT-5.6 Luna (production background) | Azure | 1 | 1 | 0 | 9616 |
| GPT-5.6 Luna (production background) | NOT_AVAILABLE | 59 | 59 | 0 | 4189 |
| Gemini 3.1 Flash-Lite | Google | 16 | 16 | 0 | 3181 |
| Gemini 3.1 Flash-Lite | NOT_AVAILABLE | 44 | 44 | 0 | 2496 |

## Latency notes

- P99 values are **P99_DIRECTIONAL_ONLY** (n=60).
- Prefer P50 / P90 / P95 for decisions.

## Success vs failure latency (ms)

### Gemini 3.1 Flash-Lite
- SUCCESS: mean 3099, P50 2570, P90 4432
- FAILURE: mean —, P50 —, P90 —

### DeepSeek V4 Flash
- SUCCESS: mean 6243, P50 5776, P90 8575
- FAILURE: mean —, P50 —, P90 —

### GPT-5.6 Luna (production background)
- SUCCESS: mean 5103, P50 4206, P90 7717
- FAILURE: mean —, P50 —, P90 —
