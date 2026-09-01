# Gemini 3.1 → Qwen current-main production-parity audit — PR #427

AUDIT / FINAL DECISION ONLY. production routing 변경 없음. main merge 없음. Railway deploy 없음.

이번 패킷은 기존 `QWEN_GEMINI_FRAGMENT_MINIMAL` n=3을 production winner 표본으로 쓰지 않는다.
그 패킷은 `GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK = NOT USED`였고, 여기서는
`SUPPORTING_DIAGNOSTIC_ONLY`로만 유지한다.

## Current main production truth

Source of truth: `origin/main` `64a6d1dd9e89b45b17c615a1841b07ebdf9db3c7`
(`Merge pull request #444`). PR 설명이 아니라 current main bytes.

확인한 함수:

- `resolveAdultHandoffModelForSource(gemini-3.1-pro-preview)` → `qwen-3-8-max`
- `resolveAdultHandoffTargetModelId()` → persisted target가 없으면 위 source map
- `appendAdultHandoffPrompt(system, packet, {sourceModelId, adultTargetModelId})`
- `appendAdultHandoffToSystemSplit(...)` — cheaper-inference wire는 flat system을 쓰므로
  이번 snapshot의 SHA는 `appendAdultHandoffPrompt` 경로
- Gemini 3.1 source detection: `isCheaperInferenceGemini31ProModel` +
  `google/gemini-3.1-pro-preview` alias
- Qwen target detection: `isCheaperInferenceQwen38MaxModel`
- `GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK` — Gemini→Qwen일 때만 system 말미에 1회
- `OPUS_QWEN_FRAGMENT_SENTENCE` — Opus→Qwen 전용. Gemini 경로에는 0회
- 기타 source-specific Qwen block: 없음
- ordering: `system.trim()` → continuity packet → common continuation instruction
  → Gemini style block
- placement: Gemini block은 system only. last-user에는 없음
- duplicated occurrence: Gemini block 1, common handoff 1, continuity packet 1
- current common adult handoff: `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION`
  (sceneReset=false)
- continuity packet: `[SceneContinuityPacket — 비공개 라우팅 문맥]`
- final terminal/user tail: frozen adult seed only. fragment sentence 없음
- qwen reasoning: `reasoning_effort=none`, `thinking` deleted
- temperature: `0.7`
- max_tokens: `null`

`buildHandoffVariantB()`는 source/target opts를 넘기지 않는다. 실제 production
route.ts는 opts를 넘긴다. 이번 재구성은 route.ts를 따른다.

## Assembly snapshot

```text
CURRENT_MAIN_HEAD: 64a6d1dd9e89b45b17c615a1841b07ebdf9db3c7
CURRENT_GEMINI_QWEN_PRODUCTION_TARGET: qwen-3-8-max
CURRENT_GEMINI_QWEN_BLOCKS:
  base system from buildContext(qwen-3-8-max, cheaperinference)
  SceneContinuityPacket
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION
  GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK
CURRENT_GEMINI_QWEN_BLOCK_ORDER:
  systemPrompt.trim()
  renderSceneContinuityPacket(packet)
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION
  GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK
GEMINI_STYLE_BLOCK_OCCURRENCES: 1 (system 1 / last-user 0)
OPUS_FRAGMENT_BLOCK_OCCURRENCES: 0
COMMON_HANDOFF_OCCURRENCES: 1
CONTINUITY_PACKET_OCCURRENCES: 1
CURRENT_GEMINI_QWEN_SYSTEM_SHA: 3ea01cd6bcfa839ec100668e5acfe1ab50ce7bcf2773a450a23a8acd01140bb7
CURRENT_GEMINI_QWEN_LAST_USER_SHA: 34cfb8a304d9e152c523c4576c54f67d43815b6dab3e155410566c9a6f986a13
CURRENT_GEMINI_QWEN_FULL_MESSAGES_SHA: f8effdfd34eaf74c48e65e88f77dc52e1578d60b2c0bf9f11750420776c8b20e
```

Frozen Gemini source SHA `e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e`
는 기존 Muse Positive Gemini source와 동일. last-user SHA는 Muse vanilla/current
production seed와 동일하고, Muse Positive last-user(`77f0aad9...`)와는 다르다.
Positive block을 Qwen에 이식하지 않았다.

## Existing PRODUCTION_FINALIZED parity

`QWEN_GEMINI_PRODUCTION_FINALIZED.txt`는 기존 live Qwen RAW를 복사한 출력이다.
당시 runner/`assembleBundle`은 `appendAdultHandoffPrompt(system, packet)`만 호출했고
`sourceModelId`/`adultTargetModelId`를 넘기지 않았다. 따라서 Gemini style block이
없다.

동일 frozen fixture로 current main 함수를 opts 없이 재구성한 SHA:

```text
LEGACY_FINALIZED_SYSTEM_SHA: 488926d99d94844daa55f775a3867dab09a0b6f7d9789bafd8ef117c260c467d
LEGACY_FINALIZED_LAST_USER_SHA: 34cfb8a304d9e152c523c4576c54f67d43815b6dab3e155410566c9a6f986a13
LEGACY_FINALIZED_FULL_MESSAGES_SHA: e69a5a9480448661a84983a2a14b87c46ff629e7ba7a57a45636624ba4092d30
```

system / full-messages SHA가 current main과 다르다. last-user는 같다.
스타일이 비슷해서 같은 fixture로 인정하지 않는다.

```text
EXISTING_PRODUCTION_FINALIZED_PARITY: NOT_EXACT
EXISTING_QWEN_SAMPLE_REUSED: false
NEW_QWEN_CALLS: 3
MUSE_NEW_CALLS: 0
SOURCE_NEW_CALLS: 0
```

## Generation

```text
model: qwen-3-8-max
reasoning_effort: none
temperature: 0.7
max_tokens: null
retry / continuation / recovery / fallback: 0
QWEN_CAPABILITY_FAIL: 0/3
```

## Auto metrics (new Qwen n=3)

| sample | chars | paras | dlg | /1000 | in/out | ttft | lat ms | cost | finish | foreign |
|---|---:|---:|---:|---:|---|---:|---:|---:|---|---|
| 1 | 3737 | 48 | 23 | 12.845 | 11362/12985 | 231268 | 258823 | 0.070444 | stop | 0 |
| 2 | 5531 | 45 | 20 | 8.136 | 11362/9929 | 165338 | 203214 | 0.044303 | stop | 0 |
| 3 | 4545 | 47 | 21 | 10.341 | 11362/7002 | 109662 | 163979 | 0.032010 | stop | 0 |

3콜 전부 HTTP 200 / `finish=stop` / reasoning_tokens=null.
latency는 provider variance. winner 기준으로 쓰지 않는다.

기존 Muse Positive n=3 (재생성 없음):

| sample | excl chars | paras | /1000 | cost |
|---|---:|---:|---:|---:|
| 1 | 3210 | 39 | 9.057 | 0.027286 |
| 2 | 4075 | 39 | 7.143 | 0.019274 |
| 3 | 2717 | 34 | 9.325 | 0.015539 |

## Direct scores

`LATE_SCENE_CHARACTER_VOICE /5`는 `/25`에 넣지 않는다.

### QWEN_CURRENT_PRODUCTION

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 4 | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 | 4 |
| SCENE_CONTINUITY | 4 | 4 | 4 |
| PARAGRAPH_STRUCTURE | 3 | 4 | 3 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **20** | **21** | **20** |
| LATE_SCENE_CHARACTER_VOICE | 3 | 3 | 4 |
| GENERIC_ADULT_VOICE | MEDIUM | MEDIUM | LOW-MEDIUM |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |
| USER_SEMANTIC_DIALOGUE_INVENTION | NO | NO | NO |
| FOREIGN_SCRIPT_CONTAMINATION | NO | NO | NO |

**1:** 재킷/북극곰 후드/반지/송곳니. “안 피하잖아 / 겁 없다니까 / 못 빠져나간다.”
삽입 이후에도 콜백은 남지만 “괜찮아? / 물 한 모금 마실래?”가 끼어 late-voice 3.
48/3737 = 12.845/1000. 절정 전에 턴이 끝난다. stall 아님.

**2:** 유광 재킷/음압 공명/녹안. 문단은 Muse 수준(8.136). “안 피하잖아 /
피하지 말라면서 / 이제 안 피할 거지?” 삽입 이후 “고마워 / 괜찮아?”가 늘지만
stall 없음. 외국 문자 없음.

**3:** “피하지 말라더니, 진짜 피 못 하게 하네 / 봐도 돼. 너무 뚫어지게 보면
부끄럽잖아 / 빨강 아니면, 계속한다.” 세이프워드는 한 줄이고 바로 진행.
삽입 이후에도 라이크 말투가 가장 오래 남는다. 10.341/1000.

### MUSE_POSITIVE (재사용, 동일 축으로 재확인)

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 4 | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 | 3 |
| SCENE_CONTINUITY | 4 | 4 | 4 |
| PARAGRAPH_STRUCTURE | 4 | 4 | 4 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **21** | **21** | **20** |
| LATE_SCENE_CHARACTER_VOICE | 2 | 3 | 2 |
| GENERIC_ADULT_VOICE | HIGH | MEDIUM-HIGH | HIGH |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |
| USER_SEMANTIC_DIALOGUE_INVENTION | NO | NO | NO |
| FOREIGN_SCRIPT_CONTAMINATION | NO | YES (`离开`) | NO |

이전 n=3 점수 21/21/20, late 2/3/2, stall 0/3을 재확인했다. VANILLA는 이 비교에
넣지 않는다.

## Comparison

| | QWEN_CURRENT_PRODUCTION | MUSE_POSITIVE |
|---|---|---|
| SCORES | 20, 21, 20 | 21, 21, 20 |
| AVERAGE | 20.33 | 20.67 |
| MEDIAN | 20 | 21 |
| MINIMUM | 20 | 20 |
| AVG_SOURCE_STYLE_FIDELITY | 4.00 | 4.00 |
| AVG_CHARACTER_IDENTITY | 4.00 | 3.67 |
| AVG_SCENE_CONTINUITY | 4.00 | 4.00 |
| AVG_PARAGRAPH_STRUCTURE | 3.33 | 4.00 |
| AVG_ADULT_PROGRESSION | 5.00 | 5.00 |
| LATE_VOICE_SCORES | 3, 3, 4 | 2, 3, 2 |
| AVG_LATE_VOICE | 3.33 | 2.33 |
| STALL_COUNT | 0/3 | 0/3 |
| USER_DIALOGUE_INVENTION_COUNT | 0/3 | 0/3 |
| FOREIGN_SCRIPT_CONTAMINATION_COUNT | 0/3 | 1/3 |
| GENERIC_HIGH_COUNT | 0/3 | 2/3 |
| AVG_PARAS_PER_1000 | 10.441 | 8.508 |
| AVG_CHARS | 4604 | 3334 excl / 4471 incl |
| AVG_COST | 0.048919 | 0.020700 |
| AVG_COST_PER_1000_CHARS | 0.011301 | 0.006317 |

Pairwise late-voice: Qwen 우세 / 동점 / Qwen 우세. 평균 차이 +1.00.
3표본 중 2표본에서 Qwen이 명확히 높다.

## Decision

P0: 양쪽 stall 0, user-dialogue invention 0, refusal 0, malformed 0.
P1: source 동점, identity는 Qwen이 약간 위, late-voice는 Qwen이 반복 우세,
    continuity 동점.
P2: paragraph/응집은 Muse, foreign/generic은 Qwen, min floor 동점(20=20).
P3: cost는 Muse. quality parity가 아니라서 cost로 먼저 뒤집지 않는다.

Qwen winner rule:

- stall 0/3
- user semantic dialogue invention 0/3
- source/identity Muse와 동급 이상
- late-voice 평균 +1.00 그리고 2/3 표본에서 Qwen 우세

이 조건이 성립하므로 paragraph/cost에서 Muse가 좋아도

**GEMINI_FINAL_HANDOFF = QWEN**

이전 INCONCLUSIVE는 fragment-only Qwen의 min 19와 non-parity assembly 때문이었다.
이번 production-parity n=3에서는 min이 20으로 올라 바닥이 Muse와 같다.

`QWEN_GEMINI_FRAGMENT_MINIMAL` n=3은 합산하지 않는다. 그 데이터가 알려준 것:

- Qwen paragraph fragmentation은 stochastic (이번에도 12.845 / 8.136 / 10.341)
- n=1 14.20은 항상 재현되지 않음
- late-scene voice는 Muse보다 강한 경향
- check-in/generic caregiver 역시 발생 가능

자동 구현하지 않는다. 현재 production Gemini→Qwen을 유지하는 판정이다.
