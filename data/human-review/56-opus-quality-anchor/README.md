# Audit 56 — Opus Quality Anchor / Common Prompt Health

## Purpose

This audit is **not** a model ranking exercise. It answers one question:

```text
우리 사이트의 현재 공통 RP 프롬프트가 Claude Opus 5의 실제 RP 품질을 억압하고 있는가?
```

Opus is not treated as an automatic winner or 100-point anchor. The same Opus model is run under three prompt structures to isolate prompt causality.

## Audit 55 correction (status only — Audit 55 artifacts untouched)

```text
AUDIT55_MODEL_RANKING_NOT_DECISION_GRADE
COMMON_PROMPT_HEALTH_UNVERIFIED
OPUS_QUALITY_ANCHOR_REQUIRED
CURRENT_TWO_MODEL_LINEUP_PROVISIONAL
NO_PRODUCTION_CHANGE
```

## Arms

| Arm | Name |
|---|---|
| A | CURRENT_STANDARD_EXACT |
| B | CURRENT_WITHOUT_NUMERIC_LENGTH |
| C | OPUS_NATIVE_MINIMAL |

Model: `claude-opus-5` / Cheaper Inference only.

## Phase-1 status

```text
OPUS_PROMPT_HEALTH_SCREEN_CAPTURED
HUMAN_BLIND_REVIEW_REQUIRED
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
```

Phase-2 confirmation runs are **not** started before human blind review.
