# Opus Arm E Compact A/B — Phase 2A STEP B

```text
QUESTION:
Arm E의 agency 의미를 유지하면서 중복 terminal tokens를 제거하면
Claude Opus 5의 문학성·장면 밀도·출력 분량이 회복되는가?
```

## Fixed variables

- common system prompt / prose-style / korean-prose-top / no-godmodding
- character canon / persona / memory / layout / CURRENT USER wrapper
- temperature / sampling / provider / model / history / user input

## Unique variable

```text
OPUS ARM E TERMINAL
Arm A = OPUS_ARM_E_TERMINAL (production frozen)
Arm B = OPUS_ARM_E_COMPACT_CANDIDATE (A/B only; not production-wired)
```

## Fixtures (4 calls max)

| ID | Character | Input |
|---|---|---|
| Fixture L | c18 라이크 | `신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.` |
| Fixture A | c9 미지현상관리국 | `시키는 대로 할게요. 뭘 하면 돼요?` (Audit 58 s2 T1) |

## Status

```text
semantic_parity: PENDING
live_calls: PENDING
production_Arm_E: UNCHANGED
common_prose: UNCHANGED
layout: UNCHANGED
Stage_2: NOT_RUN
```
