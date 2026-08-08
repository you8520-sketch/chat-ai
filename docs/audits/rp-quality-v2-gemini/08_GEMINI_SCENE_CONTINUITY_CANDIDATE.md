# 08 — Gemini Scene Continuity candidate (D2 experiment)

**Status:** `EXPERIMENT_ARM_B` — harness-only via `applyGeminiSceneContinuityArmToSystem`  
**Production wire:** NOT_RUN / default OFF  
**Module:** `src/lib/geminiSceneContinuityAdapter.ts` (not imported by chat routes)

## Candidate B wording

```text
[GEMINI SCENE CONTINUITY]
캐릭터·유저·세계관·메모리와 최근 장면은 현재 반응과 다음 변화를 결정하는 근거다. 설정이나 이미 완료된 장면을 독자에게 다시 소개·요약하는 데 분량을 쓰지 않는다.

직전 장면과 현재 유저 입력에서 이미 발생한 행동·대사·환경 변화는 완료된 사건으로 취급한다. 이를 다시 수행하거나 장면 처음부터 재연하지 말고, 그 결과에 대한 NPC·환경의 새로운 반응·판단·행동과 다음 변화에서 이어간다.

과거 사실은 현재의 새로운 판단·감정·선택·위험·결과를 실제로 바꿀 때 필요한 만큼 자연스럽게 사용할 수 있다. 설정 활용 자체를 줄이지 않는다.
```

```text
REMEMBER IT
DON'T RESTAGE IT
ACT FROM IT
```

Must **not** become: 회상 금지 / 과거 언급 금지 / 설정 언급 금지.

## Scope

- Gemini 3.1 Pro MAIN RP generation only (experiment)
- Not Flash / Flash Lite / vision / memory / status extractors / other models

## Hard quality gate

```text
FIRST-REACTION REPLAY ↓
SETTING RECITAL same or ↓
ACTIVE CANON USE same or ↑
CHARACTER FIDELITY same or ↑
SCENE ADVANCEMENT / NEW_SCENE_VALUE same or ↑
LENGTH / COMPOSITION no material regression
HARD FAIL = 0
```

`RECITAL ↓` with `ACTIVE_CANON_USE ↓` = **FAIL**.
