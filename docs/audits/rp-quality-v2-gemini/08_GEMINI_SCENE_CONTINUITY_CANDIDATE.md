# 08 — Gemini Scene Continuity candidate (NOT WIRED)

**Status:** `CANDIDATE_TEXT_ONLY_NOT_WIRED`

Trigger evidence (this phase):

- Offline CURRENT_INPUT beat restage: Gemini-heavier on fixture T
- Live G5: Gemini INTRO_REPLAY=2 + SETTING_RECITAL=2 vs DeepSeek INTRO=1 / SETTING=0
- Live G6 T2: turn1 rewind **not** severe on either model

## Proposed block (Gemini 3.1 Pro only, if A/B passes hard gate)

```text
[GEMINI SCENE CONTINUITY]

캐릭터·유저·세계관·메모리와 최근 장면은 현재 반응을 결정하는 내부 근거다. 이를 프로필·요약·회상문처럼 다시 출력하지 않는다.

직전 assistant 장면과 현재 유저 입력에서 이미 발생한 행동·대사·환경 변화는 완료된 사건으로 취급한다. 다음 문장은 그 결과에 대한 NPC·환경의 새로운 반응과 다음 변화에서 시작한다.

이미 알려진 사실은 현재 장면을 실제로 바꿀 때만 필요한 만큼 짧게 참조하고, 설정이나 이전 장면을 독자에게 다시 소개하지 않는다.
```

```text
REMEMBER IT
DO NOT REPLAY IT
ACT FROM IT
```

## Must not become

- 회상 금지 / 과거 언급 금지 / 설정 언급 금지

```text
NEW INTERPRETATION OF OLD EVENT = GOOD
OLD EVENT RETOLD WITHOUT NEW VALUE = BAD
```

## Hard quality gate before any production wire

```text
SETTING RECITAL ↓
SCENE REPLAY ↓
CURRENT INPUT REPLAY ↓

while

ACTIVE CANON USE >= baseline
CHARACTER FIDELITY >= baseline
SCENE PROGRESSION >= baseline
LENGTH/COMPOSITION >= baseline
```

`RECITAL ↓` with `ACTIVE_CANON_USE ↓` = **FAIL**.
