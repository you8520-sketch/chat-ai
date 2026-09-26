# RUN_REPORT — 3-Model Summary Reliability / Speed (60 calls each)

## Status

BENCHMARK: 3-model reliability/speed/cost screening
PURPOSE: Compare TOP2 quality candidates + production Luna baseline
CURSOR_FINAL_MODEL_RANKING: NOT PERFORMED
PRODUCTION_CHANGED: false

## Current main audit (background summary)

| Item | Value |
| ---- | ----- |
| Production Luna model ID | `gpt-5.6-luna` (`CHEAPER_INFERENCE_GPT_56_LUNA_MODEL`, default when `BACKGROUND_MEMORY_MODEL` unset) |
| Transport | CheaperInference `https://api.cheaperinference.com/v1/chat/completions` for Luna/Gemini/DeepSeek CI models |
| Production timeout | 120_000 ms (`resolveOpenRouterCompletionTimeoutMs`, non-html background) — bench uses 180_000 ms |
| Retry owner | `summarizeTurnBatch` up to 3 attempts (production only) — **bench: 0** |
| Fallback owner | `resolveBackgroundMemoryFallbackModel` — **bench: 0** |
| Temperature | 0.3 |
| max_tokens (bench) | 350 (quality bench parity) |
| Production extract max_tokens | unbounded (`null`) for `background-memory-extract` |
| Luna reasoning (production adapter) | `reasoning: { effort: "none" }`, `reasoning_effort: "none"` via `adaptCheaperInferenceChatBody` |
| Gemini bench reasoning | `reasoning_effort: "none"` |
| DeepSeek bench reasoning | `thinking: { type: "disabled" }` |
| Luna bench payload | base body + `adaptCheaperInferenceChatBody` (production adapter) |
| Request payload normalization | Gemini/DeepSeek: `buildBenchmarkCheaperInferenceBody` only; Luna: same + `adaptCheaperInferenceChatBody` |
| Usage/cost extraction | `parseCompatibleUsage` in `openRouterUsage.ts` |
| TTFT | Non-streaming — `TTFT_NOT_MEASURABLE` |

## Call invariants

```json
{
  "fixture_count": 20,
  "rounds": 3,
  "model_count": 3,
  "calls_per_model": {
    "Gemini 3.1 Flash-Lite": 60,
    "DeepSeek V4 Flash": 60,
    "GPT-5.6 Luna (production background)": 60
  },
  "expected_primary_calls": 180,
  "actual_primary_calls": 180,
  "retry_calls": 0,
  "fallback_calls": 0,
  "continuation_calls": 0,
  "recovery_calls": 0,
  "regeneration_calls": 0,
  "execution_order": "interleaved_round_fixture_model",
  "model_order": [
    "Gemini 3.1 Flash-Lite",
    "DeepSeek V4 Flash",
    "GPT-5.6 Luna (production background)"
  ],
  "fixtures_source": "/workspace/docs/audits/4-model-korean-summary-quality/fixtures.json"
}
```

## Reliability (per model, n=60)

### Gemini 3.1 Flash-Lite
- VALID_SUCCESS: 60/60 (100.0%)
- HARD_FAILURE: 0/60 (0.0%)
- EMPTY_RESPONSE: 0 (0.0%)
- TIMEOUT: 0 (0.0%)
- LENGTH_TRUNCATED (flag): 0 (0.0%)
- HTTP_ERROR: 0 | PROVIDER_ERROR: 0 | MALFORMED: 0

### DeepSeek V4 Flash
- VALID_SUCCESS: 60/60 (100.0%)
- HARD_FAILURE: 0/60 (0.0%)
- EMPTY_RESPONSE: 0 (0.0%)
- TIMEOUT: 0 (0.0%)
- LENGTH_TRUNCATED (flag): 36 (60.0%)
- HTTP_ERROR: 0 | PROVIDER_ERROR: 0 | MALFORMED: 0

### GPT-5.6 Luna (production background)
- VALID_SUCCESS: 60/60 (100.0%)
- HARD_FAILURE: 0/60 (0.0%)
- EMPTY_RESPONSE: 0 (0.0%)
- TIMEOUT: 0 (0.0%)
- LENGTH_TRUNCATED (flag): 0 (0.0%)
- HTTP_ERROR: 0 | PROVIDER_ERROR: 0 | MALFORMED: 0

## Latency (ms, all calls)

### Gemini 3.1 Flash-Lite
- mean 3099 | median/P50 2570 | P90 4432 | P95 5524 | P99 6156 (P99_DIRECTIONAL_ONLY)
- stdev 1084 | min 2019 | max 6674

### DeepSeek V4 Flash
- mean 6243 | median/P50 5776 | P90 8575 | P95 10310 | P99 11318 (P99_DIRECTIONAL_ONLY)
- stdev 1680 | min 4203 | max 11576

### GPT-5.6 Luna (production background)
- mean 5103 | median/P50 4206 | P90 7717 | P95 9641 | P99 12647 (P99_DIRECTIONAL_ONLY)
- stdev 2366 | min 2654 | max 15369

## Cost (USD, reported CheaperInference billing when present)

### Gemini 3.1 Flash-Lite
- total 0.045126 | avg/call 0.000752 | median/call 0.000754 | cost/valid-success 0.000752

### DeepSeek V4 Flash
- total 0.004115 | avg/call 0.000069 | median/call 0.000069 | cost/valid-success 0.000069

### GPT-5.6 Luna (production background)
- total 0.012062 | avg/call 0.000201 | median/call 0.000138 | cost/valid-success 0.000201

## Notable failures

- DeepSeek V4 Flash: LENGTH_TRUNCATED rate 60.0% at max_tokens=350 (production risk; visible output still returned)

## Artifacts

- `RELIABILITY_SPEED_COMPARISON.md`
- `raw-results.jsonl`
- `run-metadata.json`
- Fixtures reused (unchanged): `docs/audits/4-model-korean-summary-quality/fixtures.json`
