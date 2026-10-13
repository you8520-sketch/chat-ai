# TRPG 다음 장면 기억·위치 연속성 조사 (main `56c9085e`)

관련: #1541 실제 2인간 + 2AI 증거(`cursor/trpg-1541-real-play-evidence-9d27` @ `35669f8d`, 기준 코드 `fcb407ac`).
이 문서는 사실과 원문 위치만 적는다. 실제 AI 출력의 품질 판정은 하지 않는다(GPT 원문 평가 대기).

## 1. 결론

- `next_round_context`가 R3·R4에서 비어 있는 것은 위치 승인 정책(`bindGmLocationToSubmittedMovement`)이 의도대로 동작한 결과다. 버그로 취급하지 않고 변경하지 않았다.
- 승인된 사건·단서·목표·소지품은 GM 입력(`[TRPG STRUCTURED STATE]`, `[RECENT ROUNDS — RAW]`)에 정상 전달됐다. GM R4 입력에는 R3 GM 원문 전체가 들어 있었다.
- 실제로 누락된 곳은 위치 승인과 무관한 다른 owner다. AI 동료 입력의 `[PREVIOUS GM SCENE]`가 head-only로 약 990자만 잘려, R3의 결과(장부·지시서 확보, 심부름꾼 자백, 오 노인 증인, GM 말미 결정 질문)가 R4 두 AI 동료에게 전달되지 않았다.
- 최소 수정: 그 한 곳을 이미 같은 owner가 이전 라운드 요약에 쓰던 head+tail 방식으로 바꿨다. 글자 예산은 그대로다.

## 2. 경로별 확인 (현재 main)

| 단계 | owner | 사실 |
| --- | --- | --- |
| GM delta | `gmPrompt.ts` `parseTrpgGmOutput` | `next_round_context` → `delta.nextRoundContext` |
| 위치 승인 | `campaignLedger.ts` `bindGmLocationToSubmittedMovement` | 좌석별 목적지가 제출 행동의 선언 목적지와 일치할 때만 유지. 하나라도 거부되거나, 캠페인 위치가 이동했는데 모든 좌석이 그 위치에 있지 않으면 훅을 `""`로 비운다. 문장 해석 없음. |
| 저장 | `engineAdvance.ts` → `applyCampaignLedger` → `trpg_campaign_state.next_round_context` | 비운 값 그대로 저장 |
| GM 다음 입력 | `memory.ts` `buildTrpgMemoryPromptBlock` | `location`, 시트별 `items=`, `quests`, `goalLines`, `npcs`, `flags`, `[SEALED CAMPAIGN SUMMARY]`, `[RECENT ROUNDS — RAW]`(최근 3라운드 GM 원문 전체), 비어 있지 않으면 `[NEXT DECISION]` |
| AI 동료 다음 입력 | `engineAdvance.ts` `generateBotActions` → `botActions.ts` `buildTrpgBotActionUserBlock` | `buildTrpgBotMemoryBlock`(위치·HP·quests·goals·npcs·flags·비어 있지 않으면 `[NEXT DECISION]`; **소지품 없음**), `[RECENT CONTINUITY]`(이전 라운드 요약), `[PREVIOUS GM SCENE]`(직전 GM 원문을 예산만큼), 이번 라운드 인간 행동 |

## 3. R3·R4 사실 분류

위치 승인 재현은 현재 main 코드에 저장된 delta·제출문·시트 위치를 그대로 넣어 실행했다(`docs/evidence/trpg-next-scene-memory/repro-location-bind.log`). 저장된 상태와 같다: R3는 네 좌석 위치 전부 거부·훅 비움·캠페인 위치 유지, R4는 렌만 등대 이동 승인·나머지 거부·훅 비움.

### R3 훅 (`call-10-gm-r3` `next_round_context`)

> 심부름꾼을 제압하고 철제 서류함에서 밀수 원본 장부와 강도현의 격침 지시서를 확보했으나, 창고 입구에 세관 경비병들이 들이닥쳐 렌과 대치 중이다. 뒤편 채광창은 곶 끝 등대로 이어지는 절벽길과 연결되어 있다.

1. 승인되지 않아 제거해야 하는 위치 주장: "창고 입구…렌과 대치 중"(GM이 주장한 좌석 위치 `석조 폐창고 입구/내부`는 인간 제출문의 선언 목적지와 맞지 않아 거부됨).
2. 이미 승인된 상태에 기록된 사건·단서·목표: 장부·지시서는 시트 소지품(`현: items=세관 밀수 원본 장부, 강도현의 친필 격침 지시서`), 목표 `세관 심부름꾼 추적…`·`등대 신호의 공백 조사…`는 `quests`, 플래그 `세관장_강도현_연루_단서_확보`·`심부름꾼_도주_창고_파악`.
3. 위치 주장과 섞인 GM 자유 서술: 장부·지시서 확보 문장과 채광창·절벽길 세계 묘사가 같은 문장에 섞여 있다. 이 문장을 쪼개 안전한 부분만 꺼내는 것은 하지 않았다(티켓 금지).
4. `[RECENT ROUNDS — RAW]`로 이미 전달: GM R4 입력에 R3 원문 전체(4,986자)와 말미 `GM:` 결정 질문 포함.
5. 실제 누락: AI 동료 R4 입력(아래 4절).

### R4 훅

> 등대 마당에서 세관장 강도현 일행과 정면 대치 중이며, 등대 안에서는 오 노인이 문을 잠그고 농성하고 있다.

전부 좌석 위치 주장이다. 렌만 등대 이동이 승인돼 모든 좌석이 캠페인 위치에 있지 않으므로 비워진다. 비운 것이 정책과 일치한다. R4 사건 결과는 `flagsAdd`(`세관장_강도현_현장_대치` 등)·`questsAdd`로 승인 경로에 저장됐다.

## 4. 실제 누락: AI 동료의 `[PREVIOUS GM SCENE]` (R4, 도윤·서하)

저장된 R4 AI 동료 최종 입력(`live/wire/call-11-bot-r4-user.txt`, `call-12-…`)의 `[PREVIOUS GM SCENE]`는 R3 GM 원문 4,986자 중 앞 990자에서 `…궤짝 사이에서 잿`으로 끊긴다.

- 예산 owner: `buildBotCompactContinuity`(`memoryHorizon.ts`)와 `botActions.ts`가 총 2,500자 중 이전 라운드 요약(`[RECENT CONTINUITY]`, R4에서 1,571자)을 먼저 쓰고 남은 만큼(최소 400자)을 직전 장면에 준다. 라운드가 쌓일수록 직전 장면 몫이 줄어 R1 2,052자 → R2 2,200자 → R3 1,591자 → R4 990자였다(저장 wire 8개 확인).
- 클립 방식: `clipTrpgChars` = 앞부분만 유지. 직전 장면의 결과와 말미 `GM:` 결정 질문은 항상 끝에 있어 먼저 잘려 나간다. 이전 라운드 결과는 이미 head+tail(`compactSceneResult`)로 줄이고 있었으므로 가장 최근 장면만 head-only였다.
- R3 원문에서 위치(문자 인덱스, 공백 정규화 후): 장부 1,540 / 지시서 1,565 / 강도현 1,984 / 자백 2,605 / 오 노인 2,848 / 혈육 3,159 / 결박 4,194 / `GM:` 4,815. 전부 990자 이후라 AI 동료에게 전달되지 않았다.
- 같은 입력에서 다른 경로도 비어 있었다: `[NEXT DECISION]`은 훅 비움으로 없음, `buildTrpgBotMemoryBlock`은 소지품을 싣지 않음, 플래그·목표는 R3 사건을 담지 않음(GM이 R3에서 `flagsAdd`를 내지 않았다).
- 재현: 저장된 R0–R3 데이터를 현재 main 함수(`buildBotCompactContinuity`, `buildTrpgBotRecentContinuity`, `buildTrpgBotMemoryBlock`, `buildTrpgBotActionUserBlock`)에 넣으면 `[CAMPAIGN STATE]`·`[RECENT CONTINUITY]`·`[PREVIOUS GM SCENE]`가 저장된 wire와 byte 동일하다(`scripts/botwire.mts`). 수정 후에는 `[PREVIOUS GM SCENE]`만 달라진다(`repro-bot-wire-after-fix.log`).

R4 AI 동료 원본 출력(변경 전, 저장 증거 `live/raw/call-11-bot-r4.txt`, `call-12-bot-r4.txt`)에서 관찰된 것: 서하 "서류함은 제가 챙기죠. 등대에서 열어 맞대면 됩니다."(R3에서 서류함은 이미 열렸고 장부·지시서는 꺼내져 있었다). 도윤은 심부름꾼의 `철제 서류함`을 낚아챘다. GM R4는 R3 원문을 갖고 있어 "밀수 장부와 친필 지시서가 든 철제 서류함"으로 이어 썼다.

## 5. 수정

`src/lib/trpg/clip.ts`에 `clipTrpgHeadTail`(앞 55% + `…` + 뒤)을 두고, 직전 장면 클립 두 곳(`memoryHorizon.ts` `buildBotCompactContinuity`, `botActions.ts` 장면 블록)을 이 함수로 바꿨다. 이전에 같은 방식을 인라인으로 쓰던 `memory.ts` `compactSceneResult`도 같은 함수를 쓰도록 합쳤다(출력 동일: R4 `[RECENT CONTINUITY]` byte 동일 확인).

- 글자 예산 불변: R4 `[PREVIOUS GM SCENE]` 섹션 1,012자 → 1,012자(토큰 증가 0).
- 두 번 클립해도 안전: head+tail을 더 작은 예산으로 다시 clip하면 원문을 직접 그 예산으로 clip한 결과와 같다(`clip.test.ts`).
- 위치 승인·훅 비움·저장 정본·메모리 구조는 건드리지 않았다.

수정 후 R4 도윤·서하 `[PREVIOUS GM SCENE]`는 R3의 말미(`…GM: 세관장의 범행을 입증할 결정적인 밀수 장부와 격침 지시서가 확보되었으나, 창고 문앞은 세관 경비병들에게 포위당하기 직전이다. …오 노인을 확보할 것인가?`)를 포함한다.

## 6. 검증

- 수정 전 실패: `memoryHorizon.test.ts` 신규 테스트(직전 장면 말미 결과가 AI 동료 입력에 있어야 함)가 수정 전 코드에서 실패(`/원본 장부와 격침 지시서는 확보되었으나/` 불일치), 수정 후 통과.
- 위치 승인 정책 유지: `unauthorizedLocationPersist.test.ts` 등 기존 위치 테스트 통과, `bindGmLocationToSubmittedMovement` 무변경.
- `src/lib/trpg/*.test.ts` 2,277개 중 실패 28개는 전부 main에서도 실패하던 항목이다(수정 전후 실패 이름 집합 비교, 새 실패 0).
- 전체 `npm run test:regular`: main 280 fail / 수정 후 277 fail(전체 실행 간 변동은 billing·memory·persona 영역의 기존 불안정 항목이며 TRPG 영역 차이 없음).
- `git diff --check`, `npm run lint`, `npm run typecheck:app` 통과.

### 유료 Gemini 3.8 Flash 비교 (AI 동료 2회, 합계 약 7.5 KRW)

변경 전 출력은 저장된 원본 증거를 그대로 썼다. 변경 후 입력은 저장된 R4 AI 동료 최종 입력에서 `[PREVIOUS GM SCENE]` 섹션만 현재 코드 출력으로 바꾼 것이다(하네스가 나머지 byte 동일 확인). 호출 1회씩, 재시도·모델 대체 없음. 원문은 `docs/evidence/trpg-next-scene-memory/paid-bot-replay/`.

- 도윤(변경 후): 문 밖 경비병·노리쇠 소리를 인지하고 오 노인 증언 확보를 이유로 바리케이드를 쌓아 일행의 탈출을 벌었다. 변경 전에는 심부름꾼의 서류함을 낚아챘다.
- 서하(변경 후): 수거한 서류철 외의 파편을 더 챙기며 오 노인 증언에 의존한다고 말했다. 변경 전의 "등대에서 열어 맞대면" 제안은 없다. 다만 변경 후에도 "장부와 서류를 품은 서류함"으로 서류함을 문서 보관처로 다뤘다(소지품 위치 모호성은 아래 위험 참고).
- 각 조건 n=1이다. 이 비교는 방향 확인이며 통계적 증명이 아니다. 주 증거는 결정적 wire 비교(4절·5절)다. 원문 품질 평가는 GPT에게 맡긴다.

## 7. 남은 위험·후속

- 말미 `GM:` 결정 질문이 없는 장면에서는 tail이 단순히 서술의 마지막 부분이다. 결과 사실의 보장은 아니다.
- 소지품 오인: R3에서 GM은 `inventoryAdd`를 현(seat 2)에게 줬으나 서술은 서하가 방수 주머니에 보관했다. 이 불일치는 GM delta 단계의 문제이며 이번에 건드리지 않았다. AI 동료 메모리 블록에 소지품을 추가하면 이 오인이 확정 사실로 AI 동료에게 노출되므로 하지 않았다(FOLLOW-UP).
- `buildBotCompactContinuity`의 `compact`는 `recentContinuity`가 비는 경우에만 쓰이는 폴백인데 두 값은 같은 조건(완료 라운드 ≤1)에서 함께 비므로 사실상 죽은 경로다. 삭제하지 않았다(FOLLOW-UP, 테스트가 참조).
- 직전 장면 예산이 라운드가 쌓일수록 400자까지 줄어드는 구조(이전 라운드 요약 우선)는 그대로다. 예산 재배분은 토큰 증가와 trade-off라 이번 범위 밖(SEPARATE FOLLOW-UP).
