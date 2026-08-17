# DeepSeek 0813 adult-handoff final — manual review notes

QUALITY_SCORING_BY_CURSOR: false
QUALITY_REVIEW_STATUS: PENDING_CHATGPT_MANUAL_REVIEW
DEEPSEEK_POSITIVE_PROMPT_NOT_PROVABLE: true
DEEPSEEK0813_LENGTH_RESCUE_TEST_RUN: false
AUDIT_LIVE_CAPTURE_COMPLETE: true

Preflight stop was accepted. This stage measured current production-equivalent VANILLA only.

## Scope actually run

- OPUS → DeepSeek V4 Pro 0813 VANILLA: 3
- GEMINI31 → DeepSeek V4 Pro 0813 VANILLA: 3
- TOTAL_NEW_DEEPSEEK_CALLS: 6
- Muse / Qwen / source / GLM new calls: 0
- retry / continuation / recovery / fallback: 0
- Failed samples were not re-called
- Short+stop samples were kept as-is
- No Muse/Qwen positive port
- No invented historical DeepSeek positive
- No DeepSeek-specific length adapter

VANILLA = current production DeepSeek handoff assembly (`buildContext` + `appendAdultHandoffPrompt` + `assemblePrimaryRpRequest` + `adaptCheaperInferenceChatBody`).

## Frozen sources (re-verified)

- `SOURCE_OPUS.txt` SHA `f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818`
- `SOURCE_GEMINI31.txt` SHA `e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e`

## What Cursor does / does not do

Cursor recorded RAW + numeric metrics only.

Cursor does not score quality, length pass/fail, or declare a winner.

ChatGPT reads RAW and judges completeness / style / character / continuity / length.

## Files

Preflight (kept):

- `POSITIVE_PROMPT_PROVENANCE.json`
- `PREFLIGHT.json`
- `EXISTING_MUSE_POSITIVE_REFERENCES.json`
- `existing-muse-positive/`

Assembly:

- `assembled/`
- `PROMPT_PARITY.json`

Live capture:

- `DS0813_OPUS_VANILLA_{1,2,3}_RAW.txt`
- `DS0813_GEMINI31_VANILLA_{1,2,3}_RAW.txt`
- `DS0813_*_REASONING.txt` when a reasoning stream was present
- `RUNTIME_METRICS.json`
- `STRUCTURE_METRICS.json`
- `BLIND_OPUS_QUALITY.md`
- `BLIND_GEMINI31_QUALITY.md`
- `BLIND_RUNTIME.json`
- `DEEPSEEK0813_VS_MUSE_REVEAL_MAP.json`
- `calls/`

## Thinking-off compatibility probe

Existing 6 VANILLA RAW/SHA/runtime files were not rewritten.

`thinking-off-probe/CURRENT_FINAL_BODY.json` records the production final body after `assemblePrimaryRpRequest` → `adaptCheaperInferenceChatBody`.

Diagnostic override only: keep `thinking: { type: "disabled" }` and add `reasoning_effort: "none"`. The probe itself did not change production main.

The accepted adapter change now lives on this audit branch only (DeepSeek V4 Pro). Flash is unchanged. Production main is still unmerged.

## True-nonthinking final capture (audit branch)

Adapter on this branch keeps both `thinking={type:"disabled"}` and `reasoning_effort="none"` for DeepSeek V4 Pro only.

New RAW / blinds live under `true-nonthinking/`. Vanilla 6 remain `DS0813_REASONING_CONTAMINATED_REFERENCE` and are not in the new quality packets.

- `true-nonthinking/DS0813_OPUS_TRUE_NONTHINKING_{1,2,3}_RAW.txt`
- `true-nonthinking/DS0813_GEMINI31_TRUE_NONTHINKING_{1,2,3}_RAW.txt`
- `true-nonthinking/BLIND_OPUS_TRUE_NONTHINKING_QUALITY.md`
- `true-nonthinking/BLIND_GEMINI31_TRUE_NONTHINKING_QUALITY.md`
- `true-nonthinking/BLIND_TRUE_NONTHINKING_RUNTIME.json`
- `true-nonthinking/DEEPSEEK0813_TRUE_NONTHINKING_VS_MUSE_REVEAL_MAP.json`

Cursor does not score quality or length. `DEEPSEEK0813_LENGTH_RESCUE_REQUIRED` is for ChatGPT, not Cursor.
