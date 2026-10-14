# 캐릭터 주장 보존 회귀 검증 (PR #1614 후속)

기준 SHA
- main `f641c129` (episodic prompt/parse/verify 경로는 `8471b7ee` 대비 변경 없음)
- #1614 이전 HEAD `1fd3c89f` (arm `pr`), main prompt (arm `main`), 후보 (arm `cand` = `1fd3c89f` + 예시 1줄 교체)
- 모델 `gpt-6-luna`, 경로 `runPostTurnSharedInitial` -> `reconcileSharedEpisodicFactsForTurn` -> `getEpisodicMemoryForPrompt` (격리 DB, 운영 DB 쓰기 없음)
- 세 arm을 같은 시각에 같은 원문·같은 호출 조건으로 실행. 원문/최종 wire/토큰/비용은 `raw/*.json`, 집계는 `analysis.txt`, 하네스는 `ep-e2e.probe.ts.txt`.

## 1. 원인

- 기존 182건 재사용: 캐릭터 주장 보존 before 13/18, after 5/18, varB 6/18 (Fisher p=0.018 / 0.044).
- 동시 재측정(신규 호출): main 18/24, #1614 10/24, 후보 19/24. main vs #1614 p=0.039.
- 두 측정을 합치면 main 31/42, #1614 15/42 (p≈0.001, 하네스가 달라 참고용).
- 확률 변동만으로 보기 어렵다. Allowed examples 구성이 `explicit_character_claim` 방출을 편향시킨다. `lovers` 예시를 제거하고 제안/수락 예시를 넣은 뒤 "이전 친분 주장"류 relationship 행이 줄었다. 후보는 같은 슬롯에 귀속 주장 예시를 넣는 것만으로 main 수준을 회복했다 (개입 실험).
- 별개 관찰: 직접 단정형 주장("3년 전 용병단에서 같이 싸웠던 그 렌 맞지?")은 main 12/12, #1614 12/12, 후보 10/12로 어느 arm에서도 보존된다. 하락은 전해 들은 형태("누나가 ... 알던 사이라더라")에 집중됐다.

## 2. 후보 (단일 변경)

`memory-episodic-prompt.ts`의 일반 A/B 주도·동행 예시를 아래 귀속 주장 예시로 교체. 제안/수락 분리 예시, 규칙 문구, 스키마는 그대로.

```
{"category":"relationship","subject":"enoch","attribute":"claimed_prior_acquaintance","value":"claimed","importance":"normal","fact_text":"에녹은 유저와 예전부터 알던 사이라고 주장했다.","evidence_type":"explicit_character_claim","evidence":{"source_role":"assistant","source_quote":"우린 예전부터 알던 사이잖아."}}
```

`fact_text`에 귀속 동사(`주장했다`)가 있어 `detectUnverifiedCanonicalization`을 통과하고, `evaluateEpisodicFactEvidence`는 `CHARACTER_CLAIM`으로만 승인한다 (단위 테스트로 고정).

## 3. 결과 (동시 호출, n = 반복 수)

| 사례 | main | #1614 | 후보 |
|---|---|---|---|
| 근거 없는 누나 친분 주장 -> CHARACTER_CLAIM 행/최종 wire | 18/24 | 10/24 | 19/24 |
| 직접 단정 주장 (용병단) | 12/12 | 12/12 | 10/12 |
| FX06 제안만 -> `lovers` 확정 | 16/16 | 0/16 | 0/16 |
| FX06 제안 행 보존 | 11/16 | 16/16 | 16/16 |
| 명시적 수락 -> 수락 행 저장 | 0/16 | 4/16 | 5/16 |
| 정상 문 잠금 행동 | 12/12 | 12/12 | 12/12 |
| 유저 과거 고백 | 12/12 | 12/12 | 12/12 |
| NPC 감정 사건 (기준선 낮음) | 1/12 | 1/12 | 1/12 |
| 유저 약속 -> 에피소딕 행 (원장 소유) | 0/6 | 0/6 | 0/6 |
| 지시/방향 사건 | 7/48 | 7/48 | 4/48 |

추가 재측정 (FX06 / 수락 각 16회, 수락 전용 질의 포함):
- #1614: 허위 `lovers` 0/16, 허위 수락 행 0/16, 수락 행 3/16 (수락 질의 wire에 인용 3/16)
- 후보: 허위 `lovers` 0/16, 수락 행 7/16 (수락 질의 wire에 인용 7/16), FX06 허위 수락 행 1/16

토큰/비용 (194콜/arm): 입력 평균 main 2282, #1614 2344, 후보 2340. 신규 호출 총 646콜, 약 $0.040 (약 60원), 기존 182콜 약 $0.013 (약 19원). 합계 약 80원.

## 4. 최종 wire (후보)

주장 (질의: "누나가 시장에서 나를 알아봤다던데, 우리 예전부터 알던 사이였어?")
```
- [T1] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대. 예전부터 알던 사이라더라.”
```
제안만 (FX06)
```
- [T1] [유저가 직접 쓴 원문] “좋아, 우리 오늘부터 연인하자.”
```
수락 (질의: "라이크가 연인 제안을 수락했어?", 결정적 재현 + 라이브 `cand2` 7건)
```
- [T1] [AI가 쓴 장면 원문] “그래. 오늘부터 연인이다.”
- [T1] [유저가 직접 쓴 원문] “좋아, 우리 오늘부터 연인하자.”
```
main (수정 전, FX06): 제안 문장만 있는데 `relationship_status=lovers` 행이 16/16 저장되었다.

## 5. 골든/직접 관련 테스트 감사

- `memory-episodic-evidence-golden.test.ts` U6: 유저 단독 발화를 "서로 합의(lovers)" 사실로 표시하던 fixture를 `relationship_proposal` 제안 사건(`U6 user relationship proposal event`)으로 정정. 레거시 baseline 경로가 `explicit_user_statement`를 문자열 지지 없이 거부하므로 `explicit_scene_event` + user quote를 유지했다. 파일에 "검증기는 인용 존재·역할만 확인하고 사건의 진위는 확인하지 않는다"는 한계를 명시.
- `memory-episodic-source-evidence.test.ts`: 인용 존재/역할/메시지 ID 바인딩 검증은 그대로. 테스트 이름과 fixture만 "합의"에서 "제안 발화"로 정정. 진위 검증으로 의미를 바꾸지 않음.
- `role-event-direction-continuity.test.ts` REC-08: 예시 문자열 `a_led_b_followed`를 고정하던 단언을 제거하고 `explicit_scene_event` 정의 문구로 대체 (dominance/personality 비추론 단언은 유지).
- CQ-02: `sourceUserText`/원문 대화 없이 미리 작성된 `lovers` gold fact를 persist 파이프라인에 통과시키는 용량/검증 fixture다. 실제 상호 수락 근거는 없고, 진위 검증이 아니라 persist 손실 분류를 측정한다. 다른 benchmark로 확대하지 않고 변경하지 않았다 (보고만).

## 6. 회귀 위험

- 지시/방향 사건 4/48 vs 7/48 (p=0.52): 통계적으로 구분되지 않지만 REC-08이 보호하던 A/B 주도 예시 제거에 따른 소폭 손실 가능성은 배제하지 못한다. 일반 장면 기준선 자체가 낮다 (7/48).
- FX06에서 후보가 손잡기 장면을 "응했다"로 요약한 행이 1/16 (추가 측정 합산 2/32, #1614 0/32; p=0.49). wire에는 `손을 맞잡았다.` 인용만 주입되고 `lovers`는 아니다.
- 수락 질의 외 일반 질의에서는 수락 행이 relevance 필터(fact_text 어휘 겹침)에 걸려 wire에 안 나온다. 기존 동작이며 이번 변경 범위 밖.
- 단일 모델, 소표본이다. 확정이 아니라 가설 지지다.
