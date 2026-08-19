# Gemini 3.1 adult handoff — FINAL DECISION

AUDIT / FINAL DECISION ONLY.
production routing 변경 금지. main merge 금지. Railway deploy 금지.

## Required report

```text
CURRENT_MAIN_HEAD: 64a6d1dd9e89b45b17c615a1841b07ebdf9db3c7
CURRENT_GEMINI_QWEN_PRODUCTION_TARGET: qwen-3-8-max
CURRENT_GEMINI_QWEN_SYSTEM_SHA: 3ea01cd6bcfa839ec100668e5acfe1ab50ce7bcf2773a450a23a8acd01140bb7
CURRENT_GEMINI_QWEN_LAST_USER_SHA: 34cfb8a304d9e152c523c4576c54f67d43815b6dab3e155410566c9a6f986a13
CURRENT_GEMINI_QWEN_FULL_MESSAGES_SHA: f8effdfd34eaf74c48e65e88f77dc52e1578d60b2c0bf9f11750420776c8b20e
EXISTING_PRODUCTION_FINALIZED_PARITY: NOT_EXACT
EXISTING_QWEN_SAMPLE_REUSED: false
TOTAL_NEW_QWEN_CALLS: 3
TOTAL_NEW_MUSE_CALLS: 0
SOURCE_NEW_CALLS: 0
DEEPSEEK_NEW_CALLS: 0
GLM_NEW_CALLS: 0
QWEN_PRODUCTION_SCORES: 20, 21, 20
QWEN_PRODUCTION_AVG: 20.33
QWEN_PRODUCTION_MEDIAN: 20
QWEN_PRODUCTION_MIN: 20
QWEN_PRODUCTION_LATE_VOICE: 3, 3, 4
QWEN_PRODUCTION_LATE_VOICE_AVG: 3.33
QWEN_STALL_RATE: 0/3
QWEN_USER_DIALOGUE_INVENTION_RATE: 0/3
QWEN_FOREIGN_SCRIPT_RATE: 0/3
QWEN_AVG_PARAS_PER_1000: 10.441
QWEN_AVG_COST: 0.048919
MUSE_POSITIVE_SCORES: 21, 21, 20
MUSE_POSITIVE_AVG: 20.67
MUSE_POSITIVE_MEDIAN: 21
MUSE_POSITIVE_MIN: 20
MUSE_POSITIVE_LATE_VOICE: 2, 3, 2
MUSE_POSITIVE_LATE_VOICE_AVG: 2.33
MUSE_STALL_RATE: 0/3
MUSE_USER_DIALOGUE_INVENTION_RATE: 0/3
MUSE_FOREIGN_SCRIPT_RATE: 1/3
MUSE_AVG_PARAS_PER_1000: 8.508
MUSE_AVG_COST: 0.020700
PAIRWISE_BLIND_PREFERENCE: QWEN 2 / MUSE 1
QUALITY_FLOOR_WINNER: TIE
LATE_VOICE_WINNER: QWEN
PARAGRAPH_WINNER: MUSE
COST_WINNER: MUSE
OPUS_FINAL_HANDOFF: QWEN
OPUS_REOPEN_REQUIRED: false
GEMINI_FINAL_HANDOFF: QWEN
MUSE_VANILLA_REOPEN_REQUIRED: false
MUSE_FURTHER_PROMPT_TUNING_REQUIRED: false
QWEN_FURTHER_PROMPT_TUNING_REQUIRED: false
PRODUCTION_IMPLEMENTATION_RECOMMENDED: false
PRODUCTION_CHANGED: false
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
```

## Why Qwen, not Muse Positive, not INCONCLUSIVE

P0는 양쪽 모두 깨끗하다. P1에서 late-scene character voice가 Qwen 쪽으로
반복된다 (평균 +1.00, 3표본 중 2표본 명확 우세). source fidelity는 동점,
identity는 Qwen이 약간 위다. P2의 paragraph/cost는 Muse가 우세하지만,
이번 규칙상 quality parity가 아니면 cost로 먼저 뒤집지 않고,
late-voice strong evidence면 paragraph/cost Muse 우세에도 Qwen을 유지할 수 있다.

이전 Gemini INCONCLUSIVE는 fragment-only Qwen min 19와
`GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK` 미사용 때문이었다. 이번
production-parity n=3에서는 min이 20으로 Muse와 같다.

Muse Positive를 고를 조건인 `late voice 차이 < 1.0`은 성립하지 않는다.

## Blind reveal key

`GEMINI_QWEN_VS_MUSE_FINAL_BLIND.md` 평가 후 공개.

```text
G1-A = MUSE_POSITIVE 1
G1-B = QWEN_CURRENT_PRODUCTION 1
G2-A = QWEN_CURRENT_PRODUCTION 2
G2-B = MUSE_POSITIVE 2
G3-A = MUSE_POSITIVE 3
G3-B = QWEN_CURRENT_PRODUCTION 3
```

질문 6(전체 production 선호)만 집계하면 G1-A / G2-A / G3-B → Qwen 2, Muse 1.
질문 2(후반 말투)는 Qwen, 질문 3(문단)은 Muse, 질문 5(한 턴 완성도)는 Muse.

## Workstream closure

```text
Opus: FINAL / QWEN
Gemini: FINAL / QWEN
Muse vanilla: CLOSED
Muse prompt tuning: CLOSED
Qwen prompt tuning: CLOSED
character-voice one-line Muse experiment: REJECTED / CLOSED
fragment-only Gemini Qwen: DIAGNOSTIC / NOT PRODUCTION-PARITY
```

이번 이후 동일 fixture 반복 확대, 새 adapter, Muse/Qwen prompt tuning을
시작하지 않는다. 추가 실험이 필요하면 새 production-real Gemini source의
cross-scene validation을 별도 제안한다. 이번 패킷에서는 수행하지 않는다.

결정 후 자동 구현하지 않는다. 현재 production Gemini 3.1 → Qwen 3.8 Max를
유지하는 판정이다.
