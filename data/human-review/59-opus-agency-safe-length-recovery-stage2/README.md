# Audit 59 — Cost-Capped Agency-Safe Length Recovery Canary

## Audit 58 preserved

```text
OPUS_INSTRUCTION_BOUNDARY_AGENCY_PASS
OPUS_INSTRUCTION_BOUNDARY_CANARY_OVERALL_FAIL_LENGTH
AGENCY_BOUNDARY_SOLVED
LENGTH_RECOVERY_REQUIRED
```

## Question

```text
Arm E의 유저 주권 경계를 그대로 유지하면서,
과도하게 이른 종료만 완화해 중앙 분량을 회복할 수 있는가?
```

## Arms

| Arm | Name |
|---|---|
| E | Frozen Audit 58 Arm E |
| F | Arm E with exact one stop-sentence replacement |

No new style/length/agency/layout owners. No SceneDirective. No retry/continuation/recovery.

## Cost-capped stages

```text
Stage 1: s2 + s6 → 8 calls
Stage 2: s5 → 4 calls (only if Stage 1 passes)
Maximum: 12
```

## Status

```text
STAGE2_CAPTURED
human review: NOT_RUN — waiting for ChatGPT
Stage 2: CAPTURED
PRODUCTION_CHANGE_NO
```
