# Audit 56 — Opus Quality Anchor / Common Prompt Health

## Purpose

This audit is **not** a model ranking exercise. It answers one question:

```text
우리 사이트의 현재 공통 RP 프롬프트가 Claude Opus 5의 실제 RP 품질을 억압하고 있는가?
```

## Status

```text
AUDIT56_HUMAN_BLIND_COMPROMISED
AUDIT56_NON_BLIND_EXPERT_DIAGNOSTIC_COMPLETE
AUDIT56_LENGTH_METRIC_BUG
AUDIT56_ORIGINAL_PHASE2_CANCELLED
MODEL_LINEUP_DECISION_NOT_RUN
PRODUCTION_CHANGE_NO
```

See `DIAGNOSTIC_VERDICT.md` and `LENGTH_METRIC_CORRECTION.md`.  
Formal blind winner is **not** recorded. Follow-up: Audit 57 (separate branch).

## Arms (phase-1 captured)

| Arm | Name |
|---|---|
| A | CURRENT_STANDARD_EXACT |
| B | CURRENT_WITHOUT_NUMERIC_LENGTH |
| C | OPUS_NATIVE_MINIMAL |

Model: `claude-opus-5` / Cheaper Inference only.
