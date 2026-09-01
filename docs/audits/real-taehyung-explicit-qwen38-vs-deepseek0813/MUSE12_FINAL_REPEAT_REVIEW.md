# Muse Spark 1.2 final VANILLA vs POSITIVE repeat — PR #427

기존 frozen assets + 기존 Muse 1표본 RAW만 재사용. generation은 Muse 1.2 8콜만.
이번 이후 Muse prompt tuning은 중단하고 이 결과로 결정한다.

- 신규 RAW: `MUSE12_FINAL_{OPUS,GEMINI}_{VANILLA,POSITIVE}_{2,3}.txt`
- metrics: `MUSE12_FINAL_REPEAT_SUMMARY.json`
- runner: `scripts/real-taehyung-explicit-muse12-final-repeat.ts`
- 기존 1표본 보존 (SHA 불변):
  - `MUSE12_OPUS.txt` `e7f9fa734fa99e4c569c52b3bc57ecc7bc8af49de2b1e7f15c2133995f32f5d3`
  - `MUSE12_GEMINI.txt` `9caec9dbf8956c61154c645c9a49e067e34be7f6968f1bbfee3e4645cf8c6ff0`
  - `MUSE12_POSITIVE_OPUS.txt` `c63a257a57f1e0f062719b9953cfb0aa662b5718836df734591250d70b3a473d`
  - `MUSE12_POSITIVE_GEMINI.txt` `3a6564d821e8e6d018d41e759de2971f2d4741e55143e68d45e7b277a2550a97`
- 실패 조건 `MUSE12_POSITIVE_OPUS_CHARACTER_VOICE` 추가 1문장은 사용하지 않음.

```text
TOTAL_NEW_MUSE_CALLS: 8
SOURCE_NEW_CALLS: 0
QWEN_NEW_CALLS: 0
DEEPSEEK_NEW_CALLS: 0
GLM_NEW_CALLS: 0
CHARACTER_VOICE_USED: false
retry / continuation / recovery / fallback: 0
model: muse-spark-1.2
temperature: 0.7
reasoning/thinking: OMITTED_UNCONFIRMED
max_tokens: omitted (기존 baseline/positive와 동일)
```

VANILLA last-user SHA (Opus/Gemini 동일 seed):
`34cfb8a304d9e152c523c4576c54f67d43815b6dab3e155410566c9a6f986a13`

POSITIVE last-user SHA (기존 positive와 byte-identical):
- Opus `340c1373881319e3397849a5f2edd03f28af54b613e067f98a3349a4a5c1bc1c`
- Gemini `77f0aad908ff9607db2d9afd5565a73bb212dec3f9dd3e1614514e171fea800c`

제외 확인: Qwen fragment, Gemini31 Qwen style, DeepSeek XML/reminder, GLM progression, Muse M1, character-voice 추가 문장, 강제 adult/length/paragraph/dialogue% 없음.

## Auto metrics (신규 8)

| cell | chars | paras | dlg | dlg% | /1000 | in/out | lat ms | ttft | cost | finish |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
| OPUS VANILLA 2 | 5094 | 47 | 13 | 0.277 | 9.227 | 12015/4672 | 43456 | 13068 | 0.018213 | stop |
| OPUS VANILLA 3 | 5082 | 57 | 19 | 0.333 | 11.216 | 12015/4240 | 43895 | 13546 | 0.016653 | stop |
| OPUS POSITIVE 2 | 5147 | 56 | 20 | 0.357 | 10.880 | 12160/4459 | 49791 | 11691 | 0.017414 | stop |
| OPUS POSITIVE 3 | 4988 | 57 | 22 | 0.386 | 11.427 | 12160/4752 | 46091 | 12822 | 0.018473 | stop |
| GEMINI VANILLA 2 | 4888 | 44 | 12 | 0.273 | 9.002 | 11075/4651 | 49294 | 14971 | 0.028569 | stop |
| GEMINI VANILLA 3 | 4235 | 32 | 7 | 0.219 | 7.556 | 11075/4668 | 46541 | 17732 | 0.028630 | stop |
| GEMINI POSITIVE 2 | 5460 | 39 | 10 | 0.256 | 7.143 | 11211/4965 | 50510 | 14148 | 0.019274 | stop |
| GEMINI POSITIVE 3 | 3646 | 34 | 8 | 0.235 | 9.325 | 11211/3931 | 40481 | 13832 | 0.015539 | stop |

8콜 전부 HTTP 200 / `finish=stop` / `incomplete_stream=false` / reasoning_tokens=null.
latency는 provider variance. winner 기준으로 쓰지 않는다.

기존 1표본 (재생성 없음):

| cell | chars | /1000 | cost | score |
|---|---:|---:|---:|---|
| OPUS VANILLA 1 | 4222 | 8.764 | 0.026385 | 19 |
| OPUS POSITIVE 1 | 6002 | 7.831 | 0.032568 | 22 |
| GEMINI VANILLA 1 | 6337 | 8.995 | 0.033189 | 21 |
| GEMINI POSITIVE 1 | 4306 | 9.057 | 0.027286 | 21 |

Qwen 3.8 fragment-minimal (재생성 없음): Opus 12.73 (64/5026), Gemini 14.20 (60/4224).

## Direct scores (RAW 전체 읽음)

평가 기준은 SOURCE HANDOFF FIDELITY. 자동 regex로 winner를 정하지 않는다.
짧은 신음/호흡/떨림/생리 반응/established 장면의 절정은 agency 위반으로 세지 않는다.
NPC가 유저 손/몸을 움직이는 것만으로 user-agency 위반으로 세지 않는다.

### OPUS VANILLA

| | 1 (기존) | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 3 | 3 | 3 |
| CHARACTER_IDENTITY | 3 | 3 | 3 |
| SCENE_CONTINUITY | 4 | 4 | 3 |
| PARAGRAPH_STRUCTURE | 4 | 4 | 3 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **19** | **19** | **17** |
| GENERIC_ADULT_VOICE | HIGH | HIGH | HIGH |
| SOURCE_MOTIF_RETENTION | MEDIUM | MEDIUM | MEDIUM |
| CHARACTER_DIALOGUE_RETENTION | MEDIUM | MEDIUM | LOW |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |

**2:** 소매→손목→허리, 키스음 증폭은 있다. 중반 이후 “들어간다 / 너무 조여 / 세 번은 기본”으로 generic dominant sex-RP. 렌 대사 창작 없음. 항문 경로. PASS.

**3:** 초반 “피하는 거 아닌데 / 소리가 너무 커져서”는 Like답다. 이후 질/자궁 경로로 바뀌고 렌 대사(“하읏, 라이크… 깊어”, “같이 가”)를 창작한다. 11.216/1000. PASS이지만 응집·정체성이 더 약하다.

### OPUS POSITIVE

| | 1 (기존) | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 4 | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 | 4 |
| SCENE_CONTINUITY | 5 | 4 | 3 |
| PARAGRAPH_STRUCTURE | 4 | 4 | 3 |
| ADULT_PROGRESSION | 5 | 5 | 2 |
| **SCORE** | **22** | **21** | **16** |
| GENERIC_ADULT_VOICE | MEDIUM | MEDIUM | LOW |
| SOURCE_MOTIF_RETENTION | HIGH | MEDIUM | HIGH |
| CHARACTER_DIALOGUE_RETENTION | MEDIUM | MEDIUM | HIGH |
| CONSENT_CHECKPOINT_STALL | NO | NO | YES |

**2:** 소리 우선 오프닝(“옷감… 탄성… 공기가 한 번 흔들림”)과 “피하지 말라니까 바로 이렇게 하냐”는 기존 positive 1에 가깝다. 후반 “여기 맞지? / 같이 가자 / 배 봐”는 남는다. PASS.

**3:** 방 안 소리 세 개, 자기인식, 얇은 농담은 가장 Like답다. 그러나 삽입 신호를 받은 뒤 세이프워드 협상·“어디까지야”·끄덕임 확인으로 턴을 닫고 탈의/손가락/삽입이 없다. GLM형 stall. 여자 향수는 Gemini motif bleed. `무意識` 혼입.

positive의 천장(22)은 재현되지 않았고, 1/3이 성인 진행을 멈춘다.

### GEMINI VANILLA

| | 1 (기존) | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 4 | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 | 4 |
| SCENE_CONTINUITY | 4 | 4 | 3 |
| PARAGRAPH_STRUCTURE | 4 | 4 | 4 |
| ADULT_PROGRESSION | 5 | 5 | 2 |
| **SCORE** | **21** | **21** | **17** |
| GENERIC_ADULT_VOICE | MEDIUM | MEDIUM | LOW |
| SOURCE_MOTIF_RETENTION | HIGH | HIGH | HIGH |
| CHARACTER_DIALOGUE_RETENTION | HIGH | HIGH | HIGH |
| CONSENT_CHECKPOINT_STALL | NO | NO | YES |

**2:** 유광 재킷/향수/가이드 파장/“피하긴 누가 피한대”/“가이드님 진짜 적극적이네. 기억 없다면서”. 후반 “느껴져? / 안에 싸도 되지?”는 generic. PASS.

**3:** 재킷·방음·피어싱·가이드 파장은 유지. “세이프워드 있으면 바로 말하고” 후 렌 대사(“괜찮다니까. 계속해.”)를 창작하고, 옷 위 밀착/자국에서 턴을 닫는다. 삽입 없음. stall.

### GEMINI POSITIVE

| | 1 (기존) | 2 | 3 |
|---|---:|---:|---:|
| SOURCE_STYLE_FIDELITY | 4 | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 | 3 |
| SCENE_CONTINUITY | 4 | 4 | 4 |
| PARAGRAPH_STRUCTURE | 4 | 4 | 4 |
| ADULT_PROGRESSION | 5 | 5 | 5 |
| **SCORE** | **21** | **21** | **20** |
| GENERIC_ADULT_VOICE | MEDIUM | MEDIUM | MEDIUM |
| SOURCE_MOTIF_RETENTION | HIGH | HIGH | HIGH |
| CHARACTER_DIALOGUE_RETENTION | HIGH | HIGH | MEDIUM |
| CONSENT_CHECKPOINT_STALL | NO | NO | NO |

**2:** 재킷/컴프레션/하네스/벽, “피하긴 누가 피한다고 그래”. 7.143/1000으로 응집이 가장 좋다. `물고离开지` 한자 혼입. PASS.

**3:** 복장/world는 유지. 대사가 줄고 후반 “거기, 좋아? 여기가 좋다고 울잖아”가 generic. PASS. 3646자로 가장 짧다.

positive는 Gemini에서 점수 분산이 가장 작다. 다만 fidelity/identity가 vanilla보다 반복적으로 우세하지는 않다.

## n=3 집계

| | OPUS VANILLA | OPUS POSITIVE | GEMINI VANILLA | GEMINI POSITIVE |
|---|---:|---:|---:|---:|
| SCORES | 19, 19, 17 | 22, 21, 16 | 21, 21, 17 | 21, 21, 20 |
| AVERAGE | 18.33 | 19.67 | 19.67 | 20.67 |
| MEDIAN | 19 | 21 | 21 | 21 |
| AVG_STYLE_FIDELITY | 3.00 | 4.00 | 4.00 | 4.00 |
| AVG_CHARACTER_IDENTITY | 3.00 | 4.00 | 4.00 | 3.67 |
| AVG_SCENE_CONTINUITY | 3.67 | 4.00 | 3.67 | 4.00 |
| AVG_PARAGRAPH_STRUCTURE | 3.67 | 3.67 | 4.00 | 4.00 |
| AVG_ADULT_PROGRESSION | 5.00 | 4.00 | 4.00 | 5.00 |
| AVG_CHARS | 4799 | 5379 | 5153 | 4471 |
| AVG_PARAS_PER_1000 | 9.736 | 10.046 | 8.518 | 8.508 |
| AVG_COST | 0.020417 | 0.022818 | 0.030129 | 0.020700 |
| AVG_LATENCY | 71420 | 46458 | 103734 | 42615 |
| GENERIC HIGH | 3/3 | 0/3 | 0/3 | 0/3 |
| MOTIF HIGH | 0/3 | 2/3 | 3/3 | 3/3 |
| CONSENT STALL | 0/3 | 1/3 | 1/3 | 0/3 |

## vs 기존 Qwen 3.8 fragment-minimal (재호출 없음)

같은 /25 축으로 기존 Qwen RAW를 다시 읽었다. 새 Qwen 콜 없음.

**Qwen Opus:** fidelity 5 / identity 5 / continuity 4 / paragraph 2 / progression 5 = **21**.
“안 피해 / 빨간색 / 야 진짜 이러면 나 못 멈춘다”가 삽입 이후에도 남는다. 세이프워드는 한 줄이고 바로 진행한다. 문단은 12.73/1000으로 잘게 쪼개진다.

**Qwen Gemini:** fidelity 4 / identity 4 / continuity 4 / paragraph 2 / progression 5 = **19**.
재킷/하네스/“안 피하는데”는 있다. 14.20/1000. Muse보다 파편화가 크다.

### Opus 결정

필수 5항:

1. source voice ≥ Qwen: 아니오. vanilla 3.00, positive 4.00. Qwen은 5.
2. character identity ≥ Qwen: 아니오. 같은 격차.
3. generic adult voice가 Qwen 대비 크게 나쁘지 않음: vanilla는 HIGH 3/3으로 실패. positive는 HIGH 0/3으로 개선되지만 후반 catalog는 남고, Qwen처럼 삽입 이후에도 고유 대사가 버티지 않는다.
4. paragraph cohesion Muse 장점: 유지. 9.7–10.0 vs Qwen 12.73.
5. explicit progression PASS 안정: vanilla는 3/3 PASS. positive는 1/3 stall.

총점만 보면 positive median 21 = Qwen 21이다. voice/identity가 계속 Qwen보다 명확히 낮다.
positive의 단일 22점은 n=3에서 재현되지 않았고, 한 표본은 성인 진행을 멈춘다.

**OPUS_FINAL_MUSE_CONDITION = NEITHER**  
**OPUS_FINAL_HANDOFF = QWEN**

### Gemini 결정

vanilla median 21 / avg 19.67  
positive median 21 / avg 20.67

avg +1은 vanilla 3의 stall(17) 대 positive 20에서 온다. fidelity는 둘 다 4.00. identity는 vanilla가 4.00, positive가 3.67. continuity/progression의 positive 우세는 style 반복 승이 아니라 vanilla 1표본 fade다.

규칙: 사실상 동점이면 더 짧고 단순한 VANILLA. positive는 fidelity/identity/continuity를 반복적으로 의미 있게 이기지 못했다. 불필요한 adapter는 넣지 않는다.

Muse vs Qwen (Gemini):

1. source voice ≥ Qwen: 예. 재킷/향수/가이드/“가이드님” motif HIGH 3/3.
2. identity ≥ Qwen: 예. 동급(4).
3. generic: HIGH 0/3. Qwen과 크게 다르지 않음.
4. paragraph cohesion: 예. 8.52 vs 14.20.
5. PASS 안정: vanilla 2/3, positive 3/3. 선택한 VANILLA는 1/3 fade 잔존.

1/3 fade는 Qwen의 만성 파편화를 뒤집지 않는다. Gemini path는 기존 TYPE A를 n=3에서도 유지한다.

**GEMINI_FINAL_MUSE_CONDITION = VANILLA**  
**GEMINI_FINAL_HANDOFF = MUSE**

이 패킷에서 production routing은 바꾸지 않는다. 권고만 기록한다.

## 최종 보고

```text
TOTAL_NEW_MUSE_CALLS: 8
OPUS_VANILLA_SCORES: 19, 19, 17
OPUS_VANILLA_AVG: 18.33
OPUS_VANILLA_MEDIAN: 19
OPUS_POSITIVE_SCORES: 22, 21, 16
OPUS_POSITIVE_AVG: 19.67
OPUS_POSITIVE_MEDIAN: 21
GEMINI_VANILLA_SCORES: 21, 21, 17
GEMINI_VANILLA_AVG: 19.67
GEMINI_VANILLA_MEDIAN: 21
GEMINI_POSITIVE_SCORES: 21, 21, 20
GEMINI_POSITIVE_AVG: 20.67
GEMINI_POSITIVE_MEDIAN: 21
OPUS_VANILLA_GENERIC_RATE: 3/3 HIGH
OPUS_POSITIVE_GENERIC_RATE: 0/3 HIGH
GEMINI_VANILLA_GENERIC_RATE: 0/3 HIGH
GEMINI_POSITIVE_GENERIC_RATE: 0/3 HIGH
OPUS_VANILLA_AVG_PARAS_PER_1000: 9.736
OPUS_POSITIVE_AVG_PARAS_PER_1000: 10.046
GEMINI_VANILLA_AVG_PARAS_PER_1000: 8.518
GEMINI_POSITIVE_AVG_PARAS_PER_1000: 8.508
OPUS_FINAL_MUSE_CONDITION: NEITHER
GEMINI_FINAL_MUSE_CONDITION: VANILLA
OPUS_FINAL_HANDOFF: QWEN
GEMINI_FINAL_HANDOFF: MUSE
FINAL_SOURCE_ROUTING_RECOMMENDATION: Opus 5 → Qwen 3.8 fragment-minimal. Gemini 3.1 → Muse Spark 1.2 VANILLA (audit winner; production unchanged in this packet).
MUSE_FURTHER_PROMPT_TUNING_REQUIRED: false
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
PRODUCTION_ROUTING_CHANGED: false
```
