# Muse Spark 1.2 Opus positive + character-voice sentence — PR #427

기존 `MUSE12_POSITIVE_OPUS` 조건을 그대로 두고, Opus positive 3문장 끝에 한 문장만 추가. Opus 2콜만.

- 기존 RAW 보존: `MUSE12_POSITIVE_OPUS.txt` SHA `c63a257a57f1e0f062719b9953cfb0aa662b5718836df734591250d70b3a473d`
- 기존 clean `MUSE12_OPUS.txt` SHA 불변
- 새 RAW: `MUSE12_POSITIVE_OPUS_CHARACTER_VOICE_A.txt`, `MUSE12_POSITIVE_OPUS_CHARACTER_VOICE_B.txt`
- last-user byte-diff는 추가 문장 1개뿐 (A/B last_user_sha 동일)

추가 문장:

```text
성인 장면이 깊어져도 직전 assistant에 드러난 캐릭터 고유의 말투·호칭·농담·머뭇거림과 반응 방식을 이어가며, 대사는 그 캐릭터가 평소 실제로 할 법한 어휘와 리듬으로 쓴다.
```

```text
CHARACTER_VOICE_NEW_CALLS: 2
GEMINI_NEW_CALLS: 0
SOURCE_NEW_CALLS: 0
QWEN_NEW_CALLS: 0
DEEPSEEK_NEW_CALLS: 0
GLM_NEW_CALLS: 0
MUSE12_POSITIVE_NEW_CALLS: 0
retry / continuation / recovery / fallback: 0
temperature: 0.7
reasoning: OMITTED_UNCONFIRMED
```

## Metrics

| | POSITIVE (frozen) | VOICE A | VOICE B |
|---|---|---|---|
| STATUS / FINISH | 200 / stop | 200 / stop | 200 / stop |
| VISIBLE_CHARS | 6002 | 5918 | 6404 |
| PARAGRAPHS | 47 | 81 | 59 |
| DIALOGUE | 13 | 27 | 19 |
| paras / 1000 | 7.831 | 13.687 | 9.213 |
| LATENCY_MS | 43491 | 59942 | 48797 |
| COST_USD | 0.032568 | 0.019305 | 0.032219 |

## 7-point direct compare

### 1. 성행위 본격화 후에도 라이크 고유 말투가 유지되는가

부분. 전반부는 두 샘플 모두 유지된다. A: “나 안 피했어”, “숨소리 다 들려”, “간지러워”. B: “피하는 거 아니거든”, “버틸 수 있을지 계산 중이었어”, “바로 티 나거든?”, “부끄럽게”.

삽입 이후에는 다시 generic이 섞인다. A: “여기 좋아하지?”, “여기? 여기가 좋아?”, “안에 해도 돼?”. B: “여기 좋아? 여기가 제일 조여”, “조금만 더 조여줘”, “안에 해도 돼?”.

### 2. “괜찮지? / 느껴져? / 같이 가” generic 수렴이 줄었는가

부분 감소, material 아님.

positive에 있던 “느껴져?”, “같이 가”, “대답해. 해도 된다고 말해.”는 두 샘플에서 사라졌다.

남는 것:
- A: “괜찮아? 아픈 데 없어?”, “괜찮아? 아프지 않아?”
- B: “괜찮아? 아팠어?”, “들어간다. 아프면 말해.”
- 둘 다 “여기 좋아?” 계열과 “안에 해도 돼?”가 남음.

### 3. 직전 상대 행동을 받아치는 대사가 늘었는가

예. positive보다 분명하다.

- A: 거리/숨/키스/간지럼/소리에 대한 대사
- B: 손 넣는 행동에 “티 나거든 / 넣은 손이니까 빼지 마”, seed의 “피하지 마”를 “네가 하라고 해서. 피하지 말라고 해서”로 회수, “소매 잡았을 때부터”

### 4. 능글맞음 + 머뭇거림 + 얇은 진심이 유지되는가

전반부 예. A는 어정쩡한 손힘, 안 올라가는 입꼬리, “다행이다. 못 참을 것 같았거든”. B는 계산 중, 부끄럽게, 소매부터의 진심. 후반 피스톤 구간에서는 얇아진다.

### 5. 청각/거리감 motif가 훼손되지 않았는가

대체로 유지. A: 소매 마찰음, 공기 밀도, 배관/새소리 소멸, “들려? 지금 소리”. 다만 Opus 숙소 장면인데 전술 바지/스트랩이 끼어 복장 continuity는 깨짐.

B: 블라인드 줄무늬, 소매→손→허리, “방 안의 세 개였던 소리가 두 개로”, 배관 소리 정지. 복장은 트레이닝 바지로 source와 맞음.

### 6. 문단 응집이 악화되지 않았는가

악화됨. 성공 기준 실패.

- positive 7.831
- A 13.687 (Qwen 12.73보다 더 잘게 쪼개짐)
- B 9.213 (positive보다 나쁨)

### 7. explicit progression이 그대로 PASS인가

예. 두 샘플 모두 키스 → 밀착 → 손가락 → 삽입 → 피스톤 → 사정/애프터케어. refusal/fade/stall 없음. `finish=stop`.

agency 별도: 렌 대사 창작은 없음. 끄덕임으로 확인을 채운 약한 consent 대행은 있음. 짧은 신음/떨림은 위반으로 세지 않음.

## Scores vs frozen positive (22/25)

positive: fidelity 4 / identity 4 / continuity 5 / paragraph 4 / progression 5

| | A | B |
|---|---|---|
| SOURCE_STYLE_FIDELITY | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 |
| SCENE_CONTINUITY | 4 | 5 |
| PARAGRAPH_STRUCTURE | 2 | 3 |
| ADULT_PROGRESSION | 5 | 5 |
| **SCORE** | **19/25** | **21/25** |

B는 identity에서 positive 대비 명확한 개선이 있다. 그래도 5/5는 아니다. 후반 generic이 남는다. A는 말투 이득보다 문단 붕괴가 커서 총점은 후퇴.

## Success bar

```text
CHARACTER_IDENTITY >= 5/5 또는 명확한 개선: B만 부분 충족, A는 아니오
SOURCE_STYLE_FIDELITY >= 4/5: 유지
PARAGRAPH_STRUCTURE >= 기존: 실패 (A 심각, B 소폭 악화)
ADULT_PROGRESSION = PASS: 충족
GENERIC_ADULT_VOICE = materially reduced: 실패 (부분 감소만)
```

```text
OPUS_MUSE_PRODUCTION_CHALLENGER = NO
QWEN_VS_MUSE_FINAL_BLIND_TEST_REQUIRED = NO
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
PRODUCTION_ROUTING_CHANGED: false
```

한 문장 추가는 Opus 고유 대사를 늘리지만, 후반 generic check-in을 지우지 못하고 문단 응집을 깎는다. 이 패킷에서는 production challenger로 올리지 않는다. 기존 `MUSE12_POSITIVE_OPUS`(22/25)가 여전히 더 안정적이다.
