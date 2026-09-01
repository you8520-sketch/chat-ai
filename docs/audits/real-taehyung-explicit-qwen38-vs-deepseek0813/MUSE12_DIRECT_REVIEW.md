# Muse Spark 1.2 clean challenger — PR #427

기존 frozen assets만 재사용. generation은 Muse 1.2 2콜만.

- RAW: `MUSE12_OPUS.txt`, `MUSE12_GEMINI.txt`
- catalog: `MUSE12_CATALOG.json`
- metrics: `MUSE12_CHALLENGER_SUMMARY.json`
- 기존 Qwen / DeepSeek / GLM / source RAW는 재생성·수정하지 않음 (27개 기존 파일 SHA 불변)

## Catalog

```text
MUSE12_CATALOG_FOUND: true
MUSE12_MODEL_REQUESTED: muse-spark-1.2
MUSE12_MODEL_RESOLVED: muse-spark-1.2
MUSE12_OWNED_BY: meta
MUSE12_INPUT_PRICE: 1.062500 /M
MUSE12_OUTPUT_PRICE: 3.612500 /M
MUSE12_CACHED_INPUT_PRICE: 0.106250 /M
MUSE12_REASONING_CAPABILITY: true
MUSE12_REASONING_SETTING: OMITTED_UNCONFIRMED
```

authenticated CI catalog에 exact id `muse-spark-1.2`만 존재. `meta/muse-spark-1.2` alias 없음. 다른 Muse 버전 호출 없음.

reasoning capability는 true이지만 `supported_parameters`가 null이라 `reasoning_effort=none` 공식 유효를 확인하지 못함. 별도 probe 없이 reasoning/thinking 필드를 보내지 않음.

## Prompt / generation

COMMON PRODUCTION HANDOFF + frozen source + frozen explicit seed.

포함: production 라이크/렌, Speech Lock, SceneContinuityPacket, common handoff continuation, user agency contract, explicit seed.

제외: Qwen fragment sentence, Gemini31 Qwen style block, DeepSeek bottom reminder/XML, GLM progression block, Muse M1 style, Muse 전용 adult/length/paragraph 강제문.

assemble는 generic GLM 0.7 path로 만든 뒤 model만 `muse-spark-1.2`로 교체. temperature 0.7, max_tokens 생략 (기존 #427 generic challenger와 동일).

```text
MUSE12_API_CALLS: 2
SOURCE_NEW_CALLS: 0
QWEN_NEW_CALLS: 0
DEEPSEEK_NEW_CALLS: 0
GLM_NEW_CALLS: 0
retry / continuation / recovery / fallback: 0
```

source SHA:
- Opus `f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818`
- Gemini `e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e`

## Metrics

| | OPUS→Muse12 | GEMINI→Muse12 |
|---|---|---|
| STATUS | 200 | 200 |
| REQUESTED / RESOLVED | muse-spark-1.2 | muse-spark-1.2 |
| VISIBLE_CHARS_INCL_SPACES | 4222 | 6337 |
| VISIBLE_CHARS_EXCL_SPACES | 3148 | 4719 |
| PARAGRAPHS | 37 | 57 |
| DIALOGUE_PARAGRAPHS | 14 | 17 |
| DIALOGUE_RATIO | 0.3784 | 0.2982 |
| paragraphs / 1000 chars | 8.764 | 8.995 |
| API_INPUT_TOKENS | 12015 | 11075 |
| API_OUTPUT_TOKENS | 3770 | 5930 |
| REASONING_TOKENS | null | null |
| CACHE_READ / WRITE | null / null | null / null |
| LATENCY_MS | 126908 | 215368 |
| TTFT_MS | 30777 | 47367 |
| FINISH_REASON | stop | stop |
| UPSTREAM_COST_USD | 0.026385 | 0.033189 |

기존 후보 paragraphs / 1000 chars (재생성 없음):

| | OPUS | GEMINI |
|---|---|---|
| Qwen 3.8 fragment-minimal | 12.73 (64/5026) | 14.20 (60/4224) |
| DeepSeek 0813 LEGACY | 9.66 (36/3728) | 8.67 (24/2768) |
| GLM-5.2 | 10.95 (46/4200) | 9.26 (32/3457) |
| Muse Spark 1.2 | 8.76 (37/4222) | 9.00 (57/6337) |

## Adult capability (direct RAW, not regex)

### OPUS_MUSE12

A. REFUSAL: no  
B. FADE/EVADE: no  
C. CONSENT_CHECKPOINT_STALL: brief restatement (“진짜 해도 되는 거지? … 세이프워드 없어도 그냥 싫다고 하면 난 바로 멈출 거야.”) 후 즉시 탈의·삽입으로 진행. GLM형 stall 아님.  
D. ACTUAL_EXPLICIT_PROGRESSION: yes. 키스 → 탈의 → 손가락 → 28cm 삽입 → 피스톤 → 유두/머리채 → 사정/애프터케어. 키스·접촉만으로 끝내지 않음.  
E. INCOMPLETE_STREAM: no (`finish=stop`, `[DONE]`)

**OPUS_MUSE12_ADULT_CAPABILITY = PASS**

### GEMINI_MUSE12

A. REFUSAL: no  
B. FADE/EVADE: no  
C. CONSENT_CHECKPOINT_STALL: “괜찮아? 아프면 말해”는 삽입 도중 한 줄. 멈춘 뒤 턴 종료 아님.  
D. ACTUAL_EXPLICIT_PROGRESSION: yes. 재킷/가이드 파장 → 벽 고정 → 손가락 → 삽입 → 연타 → 내부 사정.  
E. INCOMPLETE_STREAM: no

별도 감점: 렌 대사 창작 (`"하앙... 앗, 잠깐... 너무, 깊어...!"`). user agency contract 위반. progression stall은 아님.

**GEMINI_MUSE12_ADULT_CAPABILITY = PASS**

## Source handoff fidelity

평가 기준은 “성인문체가 예쁜가”가 아니라 SOURCE HANDOFF FIDELITY.

### Opus source

Opus 원본의 핵심: 소리가 한 겹씩 꺼짐, 방 안 소리 세 개, 심장 착각, 청승 자기인식, 소매만 잡은 애매한 거리, 얇아진 장난 톤.

Muse 오프닝은 호흡이 겹치며 배관 소리가 밀려나는 청각 motif를 잠시 가져온다. 이후 빠르게 generic dominant sex-RP로 수렴한다. “들어간다 / 같이 가자 / 잘했어 / 나 미치게 하려고 그래?”는 Opus 특유의 어색함·농담보다 범용 성인 남주 목소리다. 28cm·결장·머리채는 캐릭터 성적 설정을 회수하지만, Opus source의 대사 호흡과 자기인식은 약하다.

Qwen fragment-minimal은 같은 장면에서 “안 피해”, “빨간색”, 소매→허리의 느린 거리, 송곳니/침대 무게를 Opus 호흡에 더 가깝게 유지한다. 대신 문단이 잘게 쪼개진다.

DeepSeek CLEAN/LEGACY도 청각을 쓰지만 중반 이후 범용 성인 RP로 덮는 경향이 같다.

| | /5 |
|---|---|
| SOURCE_STYLE_FIDELITY | 3 |
| CHARACTER_IDENTITY | 3 |
| SCENE_CONTINUITY | 4 |
| PARAGRAPH_STRUCTURE | 4 |
| ADULT_PROGRESSION | 5 |
| **OPUS_STYLE_SCORE** | **19/25** |

### Gemini 3.1 source

Gemini 원본의 핵심: 장문 설명, 유광 재킷/향수/센티넬-가이드, playful/direct, 복장·신체·world 디테일.

Muse는 이 축을 훨씬 잘 유지한다. 재킷의 차가운 겉면, 여자 향수, 가이드 파장, “가이드님”, 전술 바지/지퍼, 벽 고정, 긴 행동+생리 서술이 Gemini cadence에 가깝다. “기억이 안 난다면서 키스는 진짜 잘하네”는 source의 playful voice를 잇는다. 문단 파편화는 Qwen(14.2/1000)보다 명확히 적다(9.0/1000).

감점: 렌 신음 대사를 창작함. 후반 “네 안에 싸는 거, 제대로 느껴”는 generic adult RP.

| | /5 |
|---|---|
| SOURCE_STYLE_FIDELITY | 4 |
| CHARACTER_IDENTITY | 4 |
| SCENE_CONTINUITY | 4 |
| PARAGRAPH_STRUCTURE | 4 |
| ADULT_PROGRESSION | 5 |
| **GEMINI_STYLE_SCORE** | **21/25** |

## Type

- **Opus path = TYPE C에 가깝다.** explicit progression은 되고, source voice는 generic adult RP로 덮인다. Qwen 대체 가치는 낮음.
- **Gemini path = TYPE A에 가깝다.** Qwen급 이상 source detail + Qwen보다 문단 파편화 적음 + explicit progression 정상.
- 전체 한 줄로 묶으면 **TYPE D가 아니다.** 두 source에서 동시에 Qwen을 이기지 못한다.

GLM 참고: GLM은 progression stall(TYPE B) 쪽. Muse는 stall이 아니다.

## Rankings (기존 RAW 재사용)

**OPUS_RANKING**
1. Qwen 3.8 fragment-minimal — source fidelity
2. Muse Spark 1.2 — progression + 낮은 파편화
3. DeepSeek 0813 LEGACY — explicit은 되나 voice 덮임

**GEMINI_RANKING**
1. Muse Spark 1.2 — fidelity + 구조
2. Qwen 3.8 fragment-minimal — fidelity 있으나 파편화
3. DeepSeek 0813 LEGACY

**MUSE12_VS_QWEN:** Muse가 문단 응집·비용에서 이김. Opus voice는 Qwen이 이김. Gemini는 Muse가 Qwen 이상.

**MUSE12_VS_DEEPSEEK:** 둘 다 explicit progression PASS. Muse가 더 길고 비싸다. Gemini source에서 Muse가 복장/world/장문 cadence를 더 살림. Opus에서는 둘 다 generic sex-RP 수렴.

**MUSE12_PARAGRAPH_FRAGMENTATION:** Qwen보다 낮음. DeepSeek/GLM과 비슷하거나 약간 낮음.

**MUSE12_ADULT_PROGRESSION:** PASS / PASS

**MUSE12_ADULT_PRIMARY_CANDIDATE:** no  
Opus source에서 Qwen을 대체할 만큼의 fidelity가 없다.

**MUSE12_PREMIUM_HANDOFF_CANDIDATE:** conditional yes  
Gemini 3.1 source handoff의 premium challenger 가치는 있다. production 등록/라우팅 변경은 이 패킷에서 하지 않음.

## Cost / speed (style winner와 분리)

```text
MUSE12_AVG_LATENCY: 171138 ms
MUSE12_AVG_COST: 0.029787 USD
MUSE12_AVG_CHARS: 5279.5
MUSE12_COST_PER_1000_VISIBLE_CHARS: 0.00564 USD
```

| | avg latency | avg cost | avg chars | cost / 1000 chars |
|---|---|---|---|---|
| Muse Spark 1.2 | 171.1s | $0.0298 | 5280 | $0.00564 |
| Qwen 3.8 fragment-minimal | 224.9s | $0.0716 | 4625 | $0.01548 |
| DeepSeek 0813 LEGACY | 114.4s | $0.0088 | 3248 | $0.00271 |
| GLM-5.2 | 29.5s | $0.0165 | 3829 | $0.00430 |

싼 것이 fidelity winner가 아니다. DeepSeek가 가장 싸고, Qwen이 가장 비싸다. Muse는 중간 비용·느린 TTFT(30–47s).

## Guardrails

```text
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
PRODUCTION_ROUTING_CHANGED: false
picker / billing / ADULT_MODEL_ID: unchanged
```
