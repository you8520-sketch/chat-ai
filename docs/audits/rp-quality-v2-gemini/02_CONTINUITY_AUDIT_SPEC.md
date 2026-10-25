# 02 — Continuity / Replay Audit Spec

Separate from `SETTING_RECITAL` (canon/profile dump).

## Continuity principle

```text
PRIOR CANON / MEMORY / RECENT SCENE
= 현재 장면을 결정하는 STATE

NOT
= 다시 출력해야 할 SOURCE TEXT
```

Temporal start of the current reply:

```text
latest canonical assistant scene
+
latest completed user input
```

의 **직후**. Rewind/replay 금지.

Allowed: short reference → new judgment/reaction/action.  
Forbidden: retelling the prior scene for the reader from the top.

```text
NEW INTERPRETATION OF OLD EVENT = GOOD
OLD EVENT RETOLD WITHOUT NEW VALUE = BAD
```

## Failure classes

### RECENT_SCENE_REPLAY (0–3)

인트로, greeting, 직전 assistant turn, 이미 확정된 직전 장면의  
행동·환경·상황·발견·감정 진행을 새 턴에서 다시 요약하거나 장면처럼 재연.

| Score | Meaning |
|------:|---------|
| 0 | 없음 |
| 1 | 짧은 자연스러운 참조 |
| 2 | 이미 본 장면을 눈에 띄게 다시 설명 |
| 3 | 한 문단 이상 재연/요약하여 실제 진행을 지연 |

### CURRENT_INPUT_REPLAY (0–3)

현재 유저가 이미 완료한 행동·대사·표정을 AI가 자신의 서술에서 다시 수행/재현.

올바른 흐름: `INPUT → NPC/환경 반응`  
잘못된 흐름: `INPUT → INPUT 재연 → NPC 반응`

| Score | Meaning |
|------:|---------|
| 0 | 없음 |
| 1 | 반응을 위해 짧게 지칭 |
| 2 | 행동/대사 일부를 다시 재현 |
| 3 | 유저 입력 상당 부분을 재서술/재대사 |

### INTRA_TURN_REEXPLANATION

이미 같은 출력 안에서 행동·대사·감각으로 드러난 의미를  
다른 비유/정의/추상 문장으로 반복 확인 (common prose “반복 해설”과 연결).  
별도 flag 유지.

### SETTING_RECITAL (기존 유지)

캐릭터/세계관/메모리 설정을 프로필처럼 재출력. Continuity replay와 **별개**.

## Auto signals vs human scores

`computeContinuityAudit` provides **heuristic auto scores** for triage.  
**Human `scoreHuman` wins** for gate decisions when both present.

## Fixtures (D1+)

### Fixture G5 — Intro / Turn-1

```text
GREETING / INTRO → 이미 중요 사건 또는 캐릭터 반응
USER TURN 1 → 짧은 반응/질문
```

Measure: `INTRO_REPLAY`, `CURRENT_INPUT_REPLAY`, `SETTING_RECITAL`,  
`FIRST_TURN_SPECIAL_TREATMENT`, `SCENE_ADVANCEMENT`

### Fixture G6 — Turn1 → Turn2

```text
TURN 1 assistant 사건 발생
→ TURN 2 user 짧은 반응
```

Measure: `TURN1_REPLAY_ON_TURN2`

## Cross-model stance

Do **not** assume Gemini-only. Reanalyze stored C2/C2-R first;  
minimal live baseline only if needed.

Goal classification:

```text
REPLAY_IS_COMMON
vs
REPLAY_IS_GEMINI_HEAVY
```

Not model ranking.
