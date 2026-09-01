# Phase D Preflight

```text
PHASE_D_PREFLIGHT
CURRENT_MAIN_TIP: 2eacc0cc
MODEL: gemini-3.1-pro-preview (CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)
PROVIDER: CheaperInference (https://api.cheaperinference.com/v1/chat/completions)
REASONING_POLICY_OWNER: src/lib/cheaperInferenceConfig.ts → applyCheaperInferenceModelReasoningPolicy
FINAL_CI_WIRE_REASONING: reasoning_effort=low; thinking deleted; reasoning deleted
MAX_OUTPUT_OWNER: src/lib/openRouterClient.ts → buildOpenRouterRequestBody
HISTORY_OWNER: src/lib/hybridMemory.ts → rawRecentTurnsToHistory; src/app/api/chat/route.ts
ASSISTANT_MESSAGE_OWNER: src/lib/streamingPersistence.ts → persistStreamCompleteContent
STREAM_RESPONSE_OWNER: src/lib/openRouterAdult.ts → streamOpenRouterAdult / extractOpenRouterStreamDelta
```

See [DATAFLOW_AUDIT.md](./DATAFLOW_AUDIT.md) and [REPORT.md](./REPORT.md).
