# Audit 58 — Explicit Action vs Future Instruction Boundary Canary

## Audit 57 preserved

```text
OPUS_UNIFIED_TERMINAL_PHASE1_FAIL
ARM_D_ARCHITECTURE_PROMISING
ARM_D_SINGLE_AGENCY_BOUNDARY_FAIL
PHASE2_NOT_RUN
PRODUCTION_CHANGE_NO
```

Arm D median score = 90; D>B preference 9/12; severe takeover 2/12 (both `action_combat_2` instruction-following).

## Question

```text
유저가 행동을 직접 선언한 경우에는 그 행동의 즉각적인 결과를 전개할 수 있다.
하지만 유저가 “지시해”, “시키는 대로 할게”, “명령만 해”처럼 아직 정해지지 않은
미래 행동을 위임하는 표현을 사용해도, AI가 그 미래 행동들을 같은 응답 안에서
대신 수행해서는 안 된다.
```

## Arms

| Arm | Name |
|---|---|
| D | FROZEN Audit 57 persona-aware unified terminal (control) |
| E | Arm D + one instruction-boundary paragraph |

No new style/length/example/model-adapter owners.

## Matrix

```text
2 arms × 6 scenarios × 2 turns = 24 new Opus CI calls
retry / continuation / recovery = 0
```

## Blind integrity

- `_HIDDEN_MAP.json` local artifact only
- Git has `HIDDEN_MAP_SHA256.txt` seal only
- Reveal map after score doc + score hash commit

## Status

```text
human review: NOT_RUN — waiting for ChatGPT
PRODUCTION_CHANGE_NO
```
