# Style Track S1R — true-off clean retest

Transport-clean replication of Style Track S1. Not a new style prompt.

Old S1 remains historical evidence in `docs/audits/deepseek-0813-style-track-s1/`.
`OLD_S1_TRANSPORT_CONTAMINATED_BY_REASONING=true`.

## Transport

Experiment overlay only, after the production adapter:

- `thinking={type:"disabled"}`
- `reasoning_effort="none"`
- do not send `enable_thinking`, `reasoning`, or `include_reasoning`

Production `adaptCheaperInferenceChatBody` is unchanged and still deletes `reasoning_effort` for DeepSeek.

## Fixture

Exact S1 Gemini 3.7 Flash T1 RAW + `같이 갈래? *두리번*`.
Opus / Gemini 3.1 / source-model calls: 0.
