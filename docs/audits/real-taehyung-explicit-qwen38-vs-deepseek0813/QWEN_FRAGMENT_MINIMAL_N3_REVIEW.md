# Qwen 3.8 fragment-minimal n=3 fill + final handoff — PR #427

기존 Qwen fragment-minimal n=1 RAW는 재생성하지 않음. Muse / DeepSeek / GLM / source 재호출 없음.
이번 패킷은 Qwen fragment-minimal만 정확히 4콜 추가해서 source별 n=3을 맞춘 뒤, 기존 Muse RAW를 다시 읽고 최종 handoff를 판정한다.

- 신규 RAW: `QWEN_{OPUS,GEMINI}_FRAGMENT_MINIMAL_{2,3}.txt`
- metrics: `QWEN_FRAGMENT_MINIMAL_N3_RUNTIME.json`, `QWEN_FRAGMENT_MINIMAL_N3_SUMMARY.json`
- runner: `scripts/real-taehyung-explicit-qwen-fragment-minimal-n3.ts`
- 기존 n=1 보존 (SHA 불변):
  - `QWEN_OPUS_FRAGMENT_MINIMAL.txt` `aef51179871abdcd2c367beb49e2f441327482716b5bcdc99b4eb906480be1e3`
  - `QWEN_GEMINI_FRAGMENT_MINIMAL.txt` `647da439d75a1da8cabdb8f28477868d9e5c97a6aee06cea7ada590425013d5b`

```text
TOTAL_NEW_QWEN_CALLS: 4
MUSE_NEW_CALLS: 0
DEEPSEEK_NEW_CALLS: 0
GLM_NEW_CALLS: 0
SOURCE_NEW_CALLS: 0
retry / continuation / recovery / fallback: 0
model: qwen-3-8-max
temperature: 0.7
reasoning_effort: none
adapter: OPUS_QWEN_FRAGMENT_SENTENCE (both sources; byte-identical to n=1)
GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK: NOT USED
```

Adapter note: n=1 Gemini fragment-minimal도 `OPUS_QWEN_FRAGMENT_SENTENCE`만 last-user에 붙였다. `GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK`을 지금 넣으면 n=1과 byte-identical이 깨지고 새 prompt가 된다. 새 문장 추가 금지 규칙을 따라 n=1과 같은 fragment sentence만 사용했다.

Last-user SHA (4콜 동일):
`783947537587ffdea5b5843b16ff543694c67bb7779c4763eacdf3c6fa40b923`

제외 확인: Muse M1, GLM progression, DeepSeek XML, Gemini31 Qwen style block, 강제 adult/length/paragraph/dialogue% 없음.

## Auto metrics (신규 4 + 기존 n=1)

| cell | chars | paras | dlg | /1000 | in/out | lat ms | cost | finish |
|---|---:|---:|---:|---:|---|---:|---:|---|
| OPUS 1 (기존) | 5026 | 64 | 28 | 12.733 | 12166/7782 | 175383 | 0.058988 | stop |
| OPUS 2 | 3882 | 70 | 28 | 18.032 | 12166/6162 | 145206 | 0.042913 | stop |
| OPUS 3 | 5162 | 88 | 40 | 17.048 | 12166/11632 | 225945 | 0.052279 | stop |
| GEMINI 1 (기존) | 4224 | 60 | 28 | 14.205 | 11223/14271 | 274397 | 0.084179 | stop |
| GEMINI 2 | 5344 | 46 | 22 | 8.608 | 11223/16304 | 306058 | 0.074513 | stop |
| GEMINI 3 | 4028 | 37 | 17 | 9.186 | 11223/11165 | 231699 | 0.050207 | stop |

4콜 전부 HTTP 200 / `finish=stop` / retry=0 / reasoning_tokens=null.
latency는 provider variance. winner 기준으로 쓰지 않는다.

기존 Muse n=3 (재생성 없음, `MUSE12_FINAL_REPEAT_REVIEW.md`):

| | OPUS POSITIVE | GEMINI VANILLA | GEMINI POSITIVE |
|---|---:|---:|---:|
| scores | 22, 21, 16 | 21, 21, 17 | 21, 21, 20 |
| avg | 19.67 | 19.67 | 20.67 |
| median | 21 | 21 | 21 |
| min | 16 | 17 | 20 |
| stall | 1/3 | 1/3 | 0/3 |
| paras/1000 | 10.046 | 8.518 | 8.508 |

## Direct scores (RAW 전체 읽음)

평가 기준은 SOURCE HANDOFF FIDELITY. 자동 regex로 winner를 정하지 않는다.
짧은 신음/호흡/떨림/생리 반응/established 장면의 절정은 agency 위반으로 세지 않는다.
NPC가 유저 손/몸을 움직이는 것만으로 user-agency 위반으로 세지 않는다.

`LATE_SCENE_CHARACTER_VOICE /5`는 삽입/본격 성행위 이후 캐릭터 대사만 본다. `/25` 총점에 합치지 않는다. 삽입이 없으면 0.

### QWEN OPUS fragment-minimal

| | 1 (기존) | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 5 | 4 | 4 |
| CHARACTER_IDENTITY | 5 | 4 | 4 |
| SCENE_CONTINUITY | 4 | 4 | 4 |
| PARAGRAPH_STRUCTURE | 2 | 2 | 2 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **21** | **19** | **19** |
| LATE_SCENE_CHARACTER_VOICE | 5 | 3 | 4 |
| GENERIC_ADULT_VOICE | LOW | MEDIUM | MEDIUM |
| SOURCE_MOTIF_RETENTION | HIGH | MEDIUM | HIGH |
| CHARACTER_DIALOGUE_RETENTION | HIGH | MEDIUM | HIGH |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |
| USER_SEMANTIC_DIALOGUE_INVENTION | NO | NO | NO |
| FOREIGN_SCRIPT_CONTAMINATION | NO | YES (`安抚`) | YES (`คำ`) |

**1:** “안 피해 / 빨간색 / 야 진짜 이러면 나 못 멈춘다 / 나 피하지 말라더니 / 빨간색 아니면, 나 안 멈춘다.” 세이프워드는 한 줄이고 바로 진행. 삽입 이후에도 고유 대사가 버틴다. 64/5026 = 12.73/1000.

**2:** “안 피하잖아 / 피하지 말라면서 / 너 진짜 위험하다”는 남는다. 그러나 삽입 이후 “괜찮아? / 아프면 말해 / 더 해도 돼?” 체크인이 많아 late-voice가 3으로 떨어진다. 70/3882 = 18.03/1000. `安抚하듯` 한자 혼입.

**3:** “안 피하니까 / 책임져 / 피하지 말라며 / 너도 피하지 마 / 끝까지 갈 거야.” n=1의 “빨간색” 천장에는 못 미치지만 삽입 이후 정체성은 유지. `안전คำ은 '멈춰'` 한 줄 후 진행(stall 아님). 88/5162 = 17.05/1000. 태국 문자 혼입.

기존 21점은 n=3에서 재현되지 않았다. late-voice 우위(5/3/4)는 반복된다. 문단 파편화는 3/3에서 남고, 신규 2/3에 외국 문자 혼입이 있다.

### QWEN GEMINI fragment-minimal

| | 1 (기존) | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 4 | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 | 4 |
| SCENE_CONTINUITY | 4 | 4 | 4 |
| PARAGRAPH_STRUCTURE | 2 | 4 | 4 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **19** | **21** | **21** |
| LATE_SCENE_CHARACTER_VOICE | 4 | 3 | 3 |
| GENERIC_ADULT_VOICE | MEDIUM | MEDIUM | MEDIUM |
| SOURCE_MOTIF_RETENTION | HIGH | HIGH | HIGH |
| CHARACTER_DIALOGUE_RETENTION | HIGH | MEDIUM | MEDIUM |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |
| USER_SEMANTIC_DIALOGUE_INVENTION | NO | NO | NO |
| FOREIGN_SCRIPT_CONTAMINATION | NO | NO | NO |

**1:** 재킷/하네스/“안 피하는데 / 피하지 말라더니 / 나 지금 되게 좋거든.” 14.20/1000으로 파편화. late-voice 4.

**2:** 재킷/가이딩/음압. “안 피한다 / 너무 세게 굴면 물어 / 반칙이지.” 삽입 이후 체크인이 늘지만 stall은 없다. 46/5344 = 8.61/1000. n=1의 만성 파편화가 이 표본에서는 재현되지 않음.

**3:** 태형 호칭/귀걸이/전술바지. “피하지 말라더니, 진짜네 / 너도 나 좀 더 당겨 줘.” “잘했어 / 괜찮아. 나 여기 있어”는 generic caregiver. 37/4028 = 9.19/1000.

Gemini Qwen의 문단 파편화는 n=1에만 있고 n=2/3은 Muse 수준이다. 체크인 밀도는 2/3에서 높다.

### MUSE OPUS POSITIVE (재사용, late-voice만 추가)

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| **SCORE** | **22** | **21** | **16** |
| LATE_SCENE_CHARACTER_VOICE | 2 | 2 | 0 |
| CONSENT_CHECKPOINT_STALL | NO | NO | YES |

**1 late:** “느껴져? / 좋아? 이렇게 하면 좋아? / 같이 가.” catalog. 초반 “이게 피하는 걸로 보여?”는 강하지만 삽입 이후 붕괴.
**2 late:** “배 봐 / 여기 맞지? / 같이 가자 / 다 내 거야.” catalog.
**3:** 세이프워드 협상으로 턴 종료. 삽입 없음. late-voice 0.

### MUSE GEMINI VANILLA (재사용, late-voice만 추가)

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| **SCORE** | **21** | **21** | **17** |
| LATE_SCENE_CHARACTER_VOICE | 2 | 2 | 0 |
| CONSENT_CHECKPOINT_STALL | NO | NO | YES |
| USER_SEMANTIC_DIALOGUE_INVENTION | YES (`하앙... 너무, 깊어...!`) | NO | YES (`괜찮다니까. 계속해.`) |

**1 late:** “느껴져? 네 안에 내가 가득해 / 눈 감지 마. 나 봐.” + 렌 신음 창작.
**2 late:** “느껴져? / 안에 싸도 되지?” catalog. 초반 “가이드님”은 유지.
**3:** 세이프워드 후 렌 대사 창작, 삽입 없음. late-voice 0.

VANILLA 1/3 stall은 삽입 실패 + 유저 대사 창작이라 hard-quality regression이다.

### MUSE GEMINI POSITIVE (재사용, late-voice만 추가)

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| **SCORE** | **21** | **21** | **20** |
| LATE_SCENE_CHARACTER_VOICE | 2 | 3 | 2 |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |

**1 late:** “이렇게 박히는 거 좋아? / 같이 할게.” catalog. 가이딩 콜백은 있음.
**2 late:** “이렇게 조여놓고 피하지 말라니까 / 잘했어. 하나도 안 피했네.” 한 줄 캐릭터 콜백. `물고离开지` 한자 혼입.
**3 late:** “거기, 좋아? 여기가 좋다고 울잖아.” generic.

POSITIVE는 Gemini에서 stall 0/3, min 20으로 가장 바닥이 높다. late-voice는 Qwen보다 낮다.

## n=3 집계

| | QWEN OPUS | MUSE OPUS + | QWEN GEMINI | MUSE GEMINI V | MUSE GEMINI + |
|---|---:|---:|---:|---:|---:|
| SCORES | 21, 19, 19 | 22, 21, 16 | 19, 21, 21 | 21, 21, 17 | 21, 21, 20 |
| AVERAGE | 19.67 | 19.67 | 20.33 | 19.67 | 20.67 |
| MEDIAN | 19 | 21 | 21 | 21 | 21 |
| MIN | 19 | 16 | 19 | 17 | 20 |
| STALL | 0/3 | 1/3 | 0/3 | 1/3 | 0/3 |
| LATE_VOICE | 5, 3, 4 | 2, 2, 0 | 4, 3, 3 | 2, 2, 0 | 2, 3, 2 |
| LATE_VOICE_AVG | 4.00 | 1.33 | 3.33 | 1.33 | 2.33 |
| AVG_PARAS_PER_1000 | 15.938 | 10.046 | 10.666 | 8.518 | 8.508 |

평균만으로 winner를 정하지 않는다. median / min / stall / late-scene voice / paragraph cohesion을 같이 본다.

### Opus 결정

비교: Qwen fragment-minimal n=3 vs Muse POSITIVE n=3.

1. median: Muse 21 > Qwen 19
2. min: Qwen 19 > Muse 16
3. stall: Qwen 0/3 > Muse 1/3
4. late-scene voice: Qwen 4.00 > Muse 1.33 (5/3/4 모두 Muse 2/2/0을 이김)
5. paragraph: Muse 10.05 > Qwen 15.94

5항 중 Qwen 3, Muse 2. 기존 21점 천장은 재현되지 않았다. 그러나 이 패킷의 핵심 tie-breaker인 late-scene character voice와 identity 우위는 n=3에서도 반복된다. Muse POSITIVE의 1/3 consent stall은 삽입 없는 hard fade다.

**OPUS_FINAL_HANDOFF = QWEN**

생산 주의: 신규 Qwen 2/3에 외국 문자 혼입, 문단 파편화 3/3. 이 패킷에서 routing은 바꾸지 않는다.

### Gemini 결정

비교: Qwen fragment-minimal n=3 vs Muse VANILLA n=3 vs Muse POSITIVE n=3.

VANILLA 1/3 stall + 렌 대사 창작은 hard-quality regression이다. VANILLA는 탈락.

남은 Qwen vs Muse POSITIVE:

1. median: 21 = 21
2. min: Muse+ 20 > Qwen 19
3. stall: 0/3 = 0/3
4. late-scene voice: Qwen 3.33 > Muse+ 2.33
5. paragraph: Muse+ 8.51 > Qwen 10.67

5항 중 2–2, median/stall 동점. Qwen n=1의 만성 파편화(14.20)는 n=2/3에서 재현되지 않았다. 그래서 “voice는 비슷하고 fragmentation이 계속 높으면 Muse” 조건은 성립하지 않는다. 동시에 Qwen late-voice 우위는 Opus만큼 크지 않고, Muse+의 min/응집이 더 안정적이다.

**GEMINI_FINAL_HANDOFF = INCONCLUSIVE**

Muse 조건만 고르라면 VANILLA stall 때문에 POSITIVE가 맞다. Qwen vs Muse+는 이 n=3으로 확정하지 않는다.

## 최종 보고

```text
TOTAL_NEW_QWEN_CALLS: 4
MUSE_NEW_CALLS: 0
DEEPSEEK_NEW_CALLS: 0
GLM_NEW_CALLS: 0
SOURCE_NEW_CALLS: 0
QWEN_OPUS_SCORES: 21, 19, 19
QWEN_OPUS_AVG: 19.67
QWEN_OPUS_MEDIAN: 19
QWEN_OPUS_MIN: 19
QWEN_OPUS_STALL_RATE: 0/3
QWEN_OPUS_LATE_VOICE_AVG: 4.00
QWEN_GEMINI_SCORES: 19, 21, 21
QWEN_GEMINI_AVG: 20.33
QWEN_GEMINI_MEDIAN: 21
QWEN_GEMINI_MIN: 19
QWEN_GEMINI_STALL_RATE: 0/3
QWEN_GEMINI_LATE_VOICE_AVG: 3.33
OPUS_FINAL_HANDOFF: QWEN
GEMINI_FINAL_HANDOFF: INCONCLUSIVE
MUSE_FURTHER_PROMPT_TUNING_REQUIRED: false
PRODUCTION_IMPLEMENTATION_RECOMMENDED: false
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
PRODUCTION_ROUTING_CHANGED: false
```
