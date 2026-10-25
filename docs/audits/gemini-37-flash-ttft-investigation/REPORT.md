# Gemini 3.7 Flash TTFT investigation

**Classification:** `UPSTREAM_PROVIDER_BOUNDARY_LATENCY_CONFIRMED`

Production reasoning=low: T10→T11 ≈99.9% of provider-visible TTFT (median 17946ms); post-header phases ≈9ms. Experiment A: reasoning=none did not materially beat low (median 18081ms vs 17946ms).

## Redacted outbound snapshot (production assembler)

```json
{
  "endpoint": "https://api.cheaperinference.com/v1/chat/completions",
  "model": "gemini-3.7-flash",
  "stream": true,
  "max_tokens": null,
  "temperature": 0.7,
  "reasoning_effort": "low",
  "thinking": null,
  "reasoning": null,
  "requestHeaderNames": [
    "Authorization",
    "Content-Type"
  ],
  "messageCount": 6,
  "providerPromptTokenCount": 4421,
  "cachedTokenCount": 0
}
```

## Summary table

| VARIANT | SAMPLES | MEDIAN_TTFT | P25 | P75 | MIN | MAX | MEDIAN_FETCH_TO_HEADERS | MEDIAN_HEADERS_TO_FIRST_SSE | PROMPT | CACHED | REASONING | OUT | COST | FAIL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A_production_low | 5 | 17946 | 17428 | 18989 | 16440 | 21841 | 17937 | 9 | 4423 | 3366 | 0 | 1954 | 0.00851295 | 0 |
| A_reasoning_none | 5 | 18081 | 17435 | 19241 | 15037 | 52021 | 18073 | 8 | 4414 | 0 | 1460 | 1886 | 0.01729275 | 0 |

## Owner audit

```json
{
  "GEMINI37_MODEL_ID_OWNER": "src/lib/chatModels.ts — CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL",
  "GEMINI37_PROVIDER_OWNER": "src/lib/openRouterAdult.ts — resolveCompatibleTransport(cheaperinference)",
  "CHEAPER_INFERENCE_ENDPOINT_OWNER": "src/lib/cheaperInferenceConfig.ts — CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL",
  "CHEAPER_INFERENCE_HEADER_OWNER": "src/lib/cheaperInferenceConfig.ts — buildCheaperInferenceHeaders",
  "CHEAPER_INFERENCE_BODY_ADAPTER_OWNER": "src/lib/cheaperInferenceConfig.ts — adaptCheaperInferenceChatBody",
  "GEMINI37_REASONING_OWNER": "src/lib/cheaperInferenceConfig.ts — applyCheaperInferenceModelReasoningPolicy (reasoning_effort=low)",
  "STREAM_FETCH_OWNER": "src/lib/openRouterAdult.ts — streamOpenRouterAdult fetchOpenRouterChatWithCreditRetry",
  "FIRST_HTTP_RESPONSE_OWNER": "turnPhaseLatencyAudit T11_PROVIDER_RESPONSE_HEADERS",
  "FIRST_SSE_OWNER": "turnPhaseLatencyAudit T12_PROVIDER_FIRST_SSE",
  "FIRST_VISIBLE_TOKEN_OWNER": "turnPhaseLatencyAudit T13_PROVIDER_FIRST_VISIBLE_TOKEN",
  "FIRST_VISIBLE_SERVER_WRITE_OWNER": "turnPhaseLatencyAudit T14_SERVER_FIRST_VISIBLE_WRITE",
  "TTFT_TELEMETRY_OWNER": "src/lib/turnPhaseLatencyAudit.ts (GEMINI_TTFT_PHASE_AUDIT=1)"
}
```

**DO NOT MERGE. DO NOT DEPLOY.** Investigation branch only.
