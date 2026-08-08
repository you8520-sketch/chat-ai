# Opus Arm E Compact A/B — Phase 2A STEP B

```text
QUESTION:
Arm E의 agency 의미를 유지하면서 중복 terminal tokens를 제거하면
Claude Opus 5의 문학성·장면 밀도·출력 분량이 회복되는가?
```

## Offline gate

```text
Arm A estimated tokens = 1134
Arm B estimated tokens = 424
reduction = 710 (62.6%)
semantic_parity = PASS
```

## Live (4 successful Opus calls + 1 aborted transport reissued)

| Fixture | Arm A chars | Arm B chars | Agency severe A | Agency severe B | Blind winner |
|---|---:|---:|---:|---:|---|
| L literary (c18) | 3225 | 2959 | 0 | 0 | **A** |
| A agency (c9 s2 T1) | 2257 | 2746 | 0 | **1** | **A** |

Transport note: first agency Arm A stream aborted (`TypeError: terminated`) with empty capture; reissued once (infra). Quality retry/continuation/recovery = 0.

## Scores (see SCORE_SEAL.md / REVEAL.md)

```text
literary L: A 91 > B 86
premium L: A 5 > B 4
agency A: Compact severe → REJECT
```

## Final

```text
OPUS_ARM_E_COMPACT_AB = CURRENT_ARM_E_KEEP
production Arm E = UNCHANGED
common prose = UNCHANGED
layout = UNCHANGED
Stage 2 = NOT_RUN
STEP C common compression = NOT_RUN
```
