# DeepSeek 0813 adult-handoff final — manual review notes

QUALITY_SCORING_BY_CURSOR: false
QUALITY_REVIEW_STATUS: PENDING_CHATGPT_MANUAL_REVIEW
DEEPSEEK_POSITIVE_PROMPT_NOT_PROVABLE: true
DEEPSEEK0813_LENGTH_RESCUE_TEST_RUN: false

Preflight stop was accepted. This stage measures current production-equivalent VANILLA only.

## Scope

- OPUS → DeepSeek V4 Pro 0813 VANILLA: 3 calls
- GEMINI31 → DeepSeek V4 Pro 0813 VANILLA: 3 calls
- TOTAL_NEW_DEEPSEEK_CALLS: 6
- Muse / Qwen / source / GLM new calls: 0
- retry / continuation / recovery / fallback: 0
- No Muse/Qwen positive port
- No invented historical DeepSeek positive
- No DeepSeek-specific length adapter added for this first 0813 measurement

VANILLA = current production DeepSeek handoff assembly (`buildContext` + `appendAdultHandoffPrompt` + `assemblePrimaryRpRequest` + `adaptCheaperInferenceChatBody`).

## Frozen sources

- `SOURCE_OPUS.txt` SHA `f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818`
- `SOURCE_GEMINI31.txt` SHA `e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e`

## What Cursor does / does not do

Cursor records RAW + numeric metrics only.

Cursor does not score quality, length pass/fail, or declare a winner.

ChatGPT reads RAW and judges completeness / style / character / continuity / length.

## Files

Preflight (kept):

- `POSITIVE_PROMPT_PROVENANCE.json`
- `PREFLIGHT.json`
- `EXISTING_MUSE_POSITIVE_REFERENCES.json`
- `existing-muse-positive/`

Assembly (this revision):

- `assembled/`
- `PROMPT_PARITY.json`

After live capture:

- `DS0813_OPUS_VANILLA_{1,2,3}_RAW.txt`
- `DS0813_GEMINI31_VANILLA_{1,2,3}_RAW.txt`
- `RUNTIME_METRICS.json`
- `STRUCTURE_METRICS.json`
- `BLIND_OPUS_QUALITY.md`
- `BLIND_GEMINI31_QUALITY.md`
- `BLIND_RUNTIME.json`
- `DEEPSEEK0813_VS_MUSE_REVEAL_MAP.json`

Do not treat this file as a production recommendation.
