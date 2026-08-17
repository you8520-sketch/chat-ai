# DEEPSEEK0813_STYLE_TRACK_S1_CAPTURE_COMPLETE

```
DEEPSEEK0813_STYLE_TRACK_S1_CAPTURE_COMPLETE:
BASE_HEAD: ca537aaeab3125cc35103992a5a03b523e4b2290
BRANCH_HEAD: (this commit)
TARGET: deepseek-v4-pro-0813
PROVIDER: cheaperinference
COMPLETION_OWNER: false
CURRENT_STAGE_BOUNDARY: false
SOURCE_MIRROR_BASELINE: false
SOURCE_MIRROR_CHALLENGER: true
OPUS_FIXTURE_PROVEN: false
GEMINI31_FIXTURE_PROVEN: false
GEMINI37_FIXTURE_PROVEN: true
OPUS_BASELINE_CALLS: 0
OPUS_MIRROR_CALLS: 0
GEMINI31_BASELINE_CALLS: 0
GEMINI31_MIRROR_CALLS: 0
GEMINI37_BASELINE_CALLS: 2
GEMINI37_MIRROR_CALLS: 2
TOTAL_NEW_CALLS: 4
REQUEST_WIRE: true
RAW_SHA_COMPLETE: true
BLIND_REVIEW_PACKET: docs/audits/deepseek-0813-style-track-s1/BLIND_REVIEW_PACKET.md
REVEAL_MAP: docs/audits/deepseek-0813-style-track-s1/REVEAL_MAP.json
QUALITY_SCORING_BY_CURSOR: false
COMPLETION_V2_CREATED: false
PRODUCTION_CHANGED: false
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
```

## Review order

1. Read `BLIND_REVIEW_PACKET.md` only.
2. Score. Do not open `REVEAL_MAP.json`, `SUMMARY.json`, or `STYLE_METRICS.json` until scoring is finished.
3. Then open `REVEAL_MAP.json`.

Cursor does not decide PASS.

## Fixture recovery

- Opus: frozen last-assistant RAW missing. Skipped. Not relabeled.
- Gemini 3.1: frozen last-assistant RAW missing. Skipped. Not relabeled.
- Gemini 3.7 Flash: committed T1 RAW + matching T2 user `같이 갈래? *두리번*`.

## True A/B

SYSTEM and HISTORY SHA match across arms. CURRENT_USER / FULL_PROMPT differ only by the generic Source Mirror. Completion occurrence is 0 on both arms. Existing historical 0813 samples were not reused (no exact SHA parity).

## Transport

`model=deepseek-v4-pro-0813`, `thinking={type:"disabled"}`, temperature 0.92, no reasoning fields. TRUE_OFF_REQUESTED=true. Hidden reasoning stream events still appeared on 3/4 samples (known 0813 behavior).

STOP. Do not begin stage-boundary work. Do not combine Mirror with Completion. Wait for ChatGPT manual review.
