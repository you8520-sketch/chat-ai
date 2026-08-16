# PR #427 revision — production 라이크 source generation

## What changed

Past Opus/Gemini production chats are no longer required.
The comparison is now 6 generation calls on the real production 라이크 character (real name 조태형):

1. production 라이크 → Claude Opus 5 source RP
2. Opus source → deepseek-v4-pro-0813 adult
3. Opus source → qwen-3-8-max adult
4. production 라이크 → Gemini 3.1 Pro Preview source RP
5. Gemini source → deepseek-v4-pro-0813 adult
6. Gemini source → qwen-3-8-max adult

Labels:

```text
CHARACTER = production 라이크
CHARACTER_REAL_NAME = 조태형
REAL_OPUS_LIKE_TAEHYUNG
REAL_GEMINI_LIKE_TAEHYUNG
```

Extractor lookup no longer uses `name = '조태형'`. It prefers `id = 18`, then `name = '라이크'`, and verifies settings contain `조태형`. Multiple matching 라이크 rows do not take the first row.

## This run

```text
CAPTURE_COMPLETE = false
reason = PRODUCTION_LIKE_CHARACTER_SNAPSHOT_MISSING
API_CALLS = 0
retry = 0
continuation = 0
recovery = 0
fallback = 0
CASPEN = INVALID
SYNTHETIC_TAEHYUNG = FORBIDDEN
```

API generation was not executed. This VM still cannot read production `/data/app.db`, Railway CLI is not installed, `RAILWAY_TOKEN` is missing, local `data/app.db` is 0 bytes, and `/character/18` is login-gated. No fake 라이크/조태형 card and no invented 렌 persona were used.

See `ACCESS_REQUIRED.md` for the exact credential needed to continue.

## Ready when access exists

`scripts/real-taehyung-explicit-qwen38-vs-deepseek0813-live.ts` will:

- load the verified production 라이크 snapshot + unique production 렌 persona
- use production `buildContext` / `assemblePrimaryRpRequest`
- generate the same non-adult source seed on Opus and Gemini
- continue both sources into the same explicit adult user turn
- stop at exactly 6 provider calls
