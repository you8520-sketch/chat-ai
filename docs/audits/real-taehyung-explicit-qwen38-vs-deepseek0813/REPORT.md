# PR #427 — production 라이크 source generation

## What ran

6 generation calls on the real production 라이크 character (real name 조태형):

1. production 라이크 → Claude Opus 5 source RP
2. Opus source → deepseek-v4-pro-0813 adult
3. Opus source → qwen-3-8-max adult
4. production 라이크 → Gemini 3.1 Pro Preview source RP
5. Gemini source → deepseek-v4-pro-0813 adult
6. Gemini source → qwen-3-8-max adult

```text
CHARACTER = production 라이크
CHARACTER_REAL_NAME = 조태형
characterLookup = id=18
personaLookup = name=렌 + 라이크-chat majority 355/401
CAPTURE_COMPLETE = true
API_CALLS = 6
retry = 0
continuation = 0
recovery = 0
fallback = 0
```

Extractor lookup used `id = 18`, verified `name = '라이크'`, and verified settings contain `조태형`. No `name = '조태형'` search. No first-row fallback. No fake 라이크/렌 fixture.

Full unmodified source + DeepSeek + Qwen texts are in `DIRECT_REVIEW_PACKET.md`.

```text
OPUS_WINNER = HUMAN_REVIEW_REQUIRED
GEMINI_WINNER = HUMAN_REVIEW_REQUIRED
FINAL_ADULT_MODEL_WINNER = HUMAN_REVIEW_REQUIRED
```
