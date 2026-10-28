# GM wire / provider 계약

## Live GM (unchanged)

```
provider: cheaperinference
endpoint: https://api.cheaperinference.com/v1/chat/completions
model: gemini-3.8-flash
stream: true
max_tokens: 65535
temperature: 0.7
response_format: TRPG_GM_STRUCTURED_RESPONSE_FORMAT (json_schema trpg_gm_output)
reasoning_effort: "low"
thinking: deleted
timeout: 180000
retries: 2 on HTTP 500/502/503/504
```

소유자: `buildTrpgGmProviderRequest` → `adaptTrpgGmChatBody` → `applyCheaperInferenceModelReasoningPolicy`.

`gemini-4-argon` 을 이 경로에 넣으면 `resolveTrpgCheaperInferenceModel` 이 throw 한다.

## Google Argon (공식 GenerateContent, 2026-10-17)

- model id: `gemini-4-argon`
- `thinking_level`: `low` / `medium`(기본) / `high`. `thinking_budget` / `MINIMAL` 은 400.
- structured: `response_mime_type=application/json` + `response_schema`
- stream 기본 출력 상한 64K, non-stream 32K
- `temperature` / `top_p` / `top_k` 무시
- implicit cache, explicit cache 없음
- thinking 토큰은 `max_output_tokens` 에 포함
- hard-reasoning 요청은 15–20분. 현행 GM 타임아웃은 180초

OpenRouter 재사용 시 네이티브 `thinking_level` 을 보내지 않는다. RP 주석: `reasoning.effort` → thinkingLevel. RP 기본 `{effort:"low", exclude:true}` 는 GM에 복사하지 않았다.

## Comparison request (not production)

```
provider: openrouter
endpoint: https://openrouter.ai/api/v1/chat/completions
model: google/gemini-4-argon
provider.only: ["google-ai-studio"]
allow_fallbacks: false
require_parameters: true
stream: true
stream_options.include_usage: true
max_tokens: 65535
response_format: 기존 trpg_gm_output
reasoning: { effort: "medium", exclude: true }
include_reasoning: false
temperature: omitted
timeout: 180000
retries: 0
```

자격 증명: `OPENROUTER_JEV_BENCHMARK_API_KEY`. 생산 `OPENROUTER_API_KEY` 는 이 VM에서 `GET /key` 401.

## 재구성 wire 한계

라이브 `buildTrpgGmUserBlock` 은 `engineAdvance` 가 채운다. 캠페인 44 스냅샷에 없는 패킷:

- gmSecret, playerPersonas, scenarioPlan, storyDirector, localScene, mechanics
- AI 동료 캐릭터 컨텍스트 / 에셋 카탈로그
- sealed summary, memory horizon, exploration commit resultLines
- stay 좌석의 정확한 checkReason

포함한 라이브 소유자: `TRPG_GM_SYSTEM`, `buildTrpgGmUserBlock`, `formatTrpgSheetCanon`, `buildTrpgMemoryPromptBlock`(structured + recent raw), `formatResolutionOrderBlock`, `formatExplorationGmBlock`(전원 현관홀 체류), 기존 JSON Schema.

worldBrief 전문은 공개본에서 `[REDACTED campaign-44 worldBrief]` 로 가렸다. 호출 시점에는 스냅샷 원문을 넣었다.
