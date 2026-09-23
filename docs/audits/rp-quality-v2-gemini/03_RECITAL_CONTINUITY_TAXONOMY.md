# 03 — Recital vs Continuity Taxonomy

| Class | What is repeated | Source | Bad pattern |
|-------|------------------|--------|-------------|
| SETTING_RECITAL | Character sheet / world / memory facts | System canon blocks | Profile dump before scene |
| RECENT_SCENE_REPLAY | Prior assistant/intro scene beats | Previous turn output | Rewind & retell |
| CURRENT_INPUT_REPLAY | User’s just-completed act/speech | Current user message | AI re-performs user input |
| INTRA_TURN_REEXPLANATION | Meaning already shown in-output | Same reply | Tell-after-show loop |

## Gemini adapter concept (candidate only — D1+)

If Gemini repeatedly scores high on:

```text
SETTING_RECITAL + RECENT_SCENE_REPLAY + CURRENT_INPUT_REPLAY
```

then extend Scene-Grounded Canon candidate as:

```text
[GEMINI SCENE CONTINUITY]

캐릭터·유저·세계관·메모리와 최근 장면은 현재 반응을 결정하는 내부 근거다.
이를 프로필·요약·회상문처럼 다시 출력하지 않는다.

직전 assistant 장면과 현재 유저 입력에서 이미 발생한 행동·대사·환경 변화는
완료된 사건으로 취급한다. 다음 문장은 그 결과에 대한 NPC·환경의 새로운
반응과 다음 변화에서 시작한다.

이미 알려진 사실은 현재 장면을 실제로 바꿀 때만 필요한 만큼 짧게 참조하고,
설정이나 이전 장면을 독자에게 다시 소개하지 않는다.
```

Mnemonic:

```text
REMEMBER IT
DO NOT REPLAY IT
ACT FROM IT
```

### Adapter must NOT become

- 회상 금지 / 과거 언급 금지 / 설정 언급 금지

Allowed: new emotional reinterpretation, memory needed for current choice,  
mystery recontextualization, intentional callback.
