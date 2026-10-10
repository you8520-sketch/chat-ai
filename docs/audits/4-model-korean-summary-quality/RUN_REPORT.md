# RUN_REPORT — 4-Model Korean Summary Quality Benchmark

## Invariants

```json
{
  "fixture_count": 20,
  "model_count": 4,
  "calls_per_model": {
    "GLM-5.3-Flash": 20,
    "Gemini 3.1 Flash-Lite": 20,
    "DeepSeek V4 Flash": 20,
    "DeepSeek V4 Flash-0731": 20
  },
  "expected_primary_calls": 80,
  "actual_primary_calls": 80,
  "retry_calls": 0,
  "fallback_calls": 0,
  "continuation_calls": 0,
  "recovery_calls": 0,
  "regeneration_calls": 0
}
```

## Valid outputs by model

| Model | OK / 20 |
|-------|---------|
| GLM-5.3-Flash | 20 / 20 |
| Gemini 3.1 Flash-Lite | 20 / 20 |
| DeepSeek V4 Flash | 20 / 20 |
| DeepSeek V4 Flash-0731 | 4 / 20 |

## Request settings (all models)

- temperature: 0.3
- max_tokens: 350
- production prompt: canonical `buildRollingSummaryLlmRequest` from `memory-rolling-summary.ts`
- post-processing: none (raw provider text preserved)
- retry/fallback/continuation/recovery/regeneration: 0

### GLM-5.3-Flash
- requested_model_id: `glm-5.3-flash`
- reasoning_effort: `low`

### Gemini 3.1 Flash-Lite
- requested_model_id: `gemini-3.1-flash-lite`
- reasoning_effort: `none`

### DeepSeek V4 Flash
- requested_model_id: `deepseek-v4-flash`
- thinking: `{ type: "disabled" }`

### DeepSeek V4 Flash-0731
- requested_model_id: `deepseek-v4-flash-0731`
- thinking: `{ type: "disabled" }`

## DeepSeek model-id observations (factual)

```json
[
  {
    "fixture_id": "CASE-01",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-01",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-02",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-02",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-03",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-03",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-04",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-04",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-05",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-05",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-06",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-06",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-07",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-07",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-08",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-08",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-09",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-09",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-10",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-10",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-11",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-11",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-12",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-12",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "Baidu",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-13",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-13",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "Baidu",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-14",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-14",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-15",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-15",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-16",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-16",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "DeepSeek",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-17",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-17",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "Baidu",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-18",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-18",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "Baidu",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-19",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-19",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "Alibaba",
    "status": "CALL_FAILED"
  },
  {
    "fixture_id": "CASE-20",
    "requested_model_id": "deepseek-v4-flash",
    "reported_model_id": "deepseek-v4-flash",
    "provider": "NOT_AVAILABLE",
    "status": "ok"
  },
  {
    "fixture_id": "CASE-20",
    "requested_model_id": "deepseek-v4-flash-0731",
    "reported_model_id": "deepseek/deepseek-v4-flash-0731",
    "provider": "Baidu",
    "status": "CALL_FAILED"
  }
]
```

## OWNER MAP (production summary path — audited, unchanged)

| Responsibility | Canonical owner |
|----------------|-------------------|
| Summary batch LLM call | `summarizeTurnBatch` in `src/lib/memory/memory-rolling-summary.ts` |
| System prompt | `buildRollingSummarySystemPrompt` + `ROLLING_SUMMARY_EPISTEMIC_POLICY` |
| User prompt assembly | `buildRollingSummaryLlmRequest` |
| History/dialogue format | `formatBatchDialogue` / `__formatBatchDialogueForTests` |
| Production model routing | `callGeminiBackground` → `BACKGROUND_OPENROUTER_MODEL` (Luna default) |
| Provider adapter | `callOpenRouterCompletion` + `adaptCheaperInferenceChatBody` |
| Retry (production only) | `summarizeTurnBatch` up to 3 attempts — **not used in this benchmark** |
| Fallback (production only) | `resolveBackgroundMemoryFallbackModel` — **not used in this benchmark** |
| Output clamp (production only) | `clampMemoryRecordSummary` — **not used in this benchmark** |

## Infra classification

- **KEEP:** `docs/audits/final-production-model-smoke/`, handoff benchmark capsules (unrelated)
- **REPLACED:** N/A (no prior 4-model summary quality bench)
- **SAFE TO DELETE:** `scripts/summary-quality-bench/_probe-models.ts` (dev probe only)
- **FOLLOW-UP:** reliability/speed 200–300 call bench; TOP2 selection; production model change

PRODUCTION_CHANGED: false
PROMPT_CHANGED: false (only extracted shared builder; prompt text unchanged)
CURSOR_SCORING: NOT PERFORMED
