# #1541 TRPG 실제 2인간 + 2AI 목표 진행 — 실제 출력 증거

추적 이슈: https://github.com/you8520-sketch/chat-ai/issues/1541

이 문서는 사실과 원문 위치만 기록한다. 품질 점수·판정은 하지 않는다(GPT 원문 평가 대기).
코드는 수정하지 않았다. 새 PR은 없다. 이 브랜치는 docs-only 증거 브랜치다.

## 1. 기준

- 기준 main / Railway SUCCESS SHA: `fcb407ac6b6f60ee39f220e59310b253d26180e7` (`feat(trpg): show initial and current campaign goals in HUD (#1596)`). 실행 전 `git fetch origin main`으로 main HEAD가 같은 SHA임을 확인했다.
- 모델: GM·AI 동료 모두 `gemini-3.8-flash` (CheaperInference `https://api.cheaperinference.com/v1/chat/completions`). GM은 스트리밍 + structured JSON, AI 동료는 비스트리밍. 키는 `CHEAPER_INFERENCE_BENCHMARK_API_KEY`(수동 live-probe용 키)를 사용했고 어떤 파일에도 키 값이 없다.
- 실행 경로: 실제 `startTrpgCampaign` / `submitTrpgAction` / `advanceTrpgCampaign`, 실제 `callTrpgGm` / `callTrpgBot`, 엔진이 만드는 실제 최종 프롬프트 조립. 하네스는 프롬프트를 만들지 않는다(`harness/run.ts`).

## 2. 시나리오·페르소나 (대체 픽스처임)

- 운영에 게시된 admin 소유 시나리오·페르소나는 이 환경에서 읽을 수 없다(운영 DB 접근 권한 없음). 따라서 **대체 픽스처**를 썼다.
- 시나리오: 「안개항 실종 사건」(마레노 부두, 어선 해오라기호 실종). #1574 실제 모델 증거 하네스의 시나리오 계획에서 `encounters`만 제거한 것. 시나리오 계획의 비밀(`secretContent`)과 `scenarioPlan.goal`("세관장 강도현이 해오라기호를 침몰시킨 범인임을 밝혀 낸다")은 GM에게 전달된다.
- 사람 좌석: 렌(방장), 현. **두 사람 행동은 에이전트가 직접 쓴 스크립트다. 실제 사람이 플레이한 것이 아니다.** 각 라운드의 GM 원문을 읽은 뒤 다음 행동을 작성했다(`inputs/human-actions-r{1..4}.json`). 목표를 완료시키거나 새 퀘스트를 만들도록 지시한 행동은 없다.
- AI 동료: 서하(신중한 기록 조사관), 도윤(충동적인 전직 갑판장). 엔진의 `persona_json`(description / greeting / systemPrompt) 경로로 만든 대체 페르소나이며 `characters` 행을 쓰지 않았다.
- 격리: DB는 `/tmp/g1541/live/data/app.db`(임시, `DATA_DIR`), 하네스가 경로가 격리 경로인지 확인하고 아니면 중단한다. 운영 DB 쓰기·실제 유저 포인트 차감·배포 없음. `skipBilling: true`.

## 3. 비용·호출 한도 (첫 유료 호출 전 계산)

- 가격(CheaperInference `/v1/models` 무료 GET, standard): 입력 $0.4875 / 캐시 읽기 $0.04875 / 출력 $2.4375 per 1M tokens. 환율은 보수적으로 1,450 KRW/USD.
- 계획 호출: GM 5(오프닝 + 4라운드) + AI 동료 8(4라운드 × 2) = 13 POST (한도 14).
- 상한 계산: 코드 기본 `max_tokens`는 65,535라 그대로면 호출당 최악 약 232 KRW(13회 약 3,000 KRW)가 되어 한도(1,000 KRW)를 넘는다. 그래서 **전송 파라미터 `max_tokens`만** 하네스 fetch 래퍼에서 GM 16,384 / 동료 4,096으로 낮췄다(`wire/*-provider-request.json`에 실제 전송값이 있다). 메시지(system/user)는 건드리지 않았다. 입력은 드라이런 프롬프트 길이(16~17k자)를 1자=1토큰으로 보수 계산. 이 상한 기준 최악 합계는 약 545 KRW(GM 5 × 79 + 동료 8 × 19), 800 KRW 미만.
- 이전 증거(#1574 등)의 GM 출력은 1~4k tokens였고, 이번 GM finish_reason은 5회 모두 `stop`이다(잘림 없음).
- 차단 장치(`harness/run.ts`): 논리 호출마다 POST 1회만 허용(재시도·모델 대체 시 fetch가 막힌다), POST 누적 14 / 800 KRW 도달 시 차단, `memoryCall`·`mechanicsCall`은 호출 시 throw, `TRPG_MECHANICS_REFEREE_ENABLED` 제거, 모든 GET·비-CheaperInference 요청 차단.
- 실측: POST 13회(전부 HTTP 200, 차단된 POST 0건, 재시도 0), 입력 72,663 / 출력 20,002 tokens, **0.0842 USD = 약 122 KRW**(1,450원 기준). `live/calls/*.json`에 호출별 토큰·비용·소요시간, `live/fetch-log-*.json`에 fetch 기록.

## 4. 라운드별 원문 (전문)

각 파일에 사람 입력, 각 호출의 최종 입력 wire 링크, 원문 응답(내레이션 + delta JSON), 서버 저장 상태, 참가자별 HUD가 있다.

- [R0 오프닝](rounds/R0.md)
- [R1](rounds/R1.md)
- [R2](rounds/R2.md)
- [R3](rounds/R3.md)
- [R4](rounds/R4.md)
- [방장 해결 확인 전/후](rounds/confirm.md)

원본 데이터: `live/wire/`(system / user / provider request), `live/raw/`(모델 원문), `live/parsed/`(파서가 읽은 delta), `live/state/`(라운드 전/후 저장 상태, 참가자별 snapshot·HUD view·해결 확인 카드), `live/calls/`(호출 메타).

## 5. 목표 상태 전이 (서버가 저장한 값 기준)

| 시점 | goals_json | 렌(방장) HUD | 현 HUD |
| --- | --- | --- | --- |
| R0 후 | 없음 | "등록된 목표가 없습니다" | 동일 |
| R1 후 | 없음 | 동일 | 동일 |
| R2 후 | goal-2-1, goal-2-2 active (GM `questsAdd` 2개) | 진행 중 2개 | 동일 |
| R3 후 | 변화 없음 | 진행 중 2개 | 동일 |
| R4 후 | goal-2-1 `claimedRound=4`(active 유지), goal-2-2 active, goal-4-1 active(새 목표) | goal-2-1 "확인 대기" + 해결 확인 카드(확인/아직 진행 중) | goal-2-1 "확인 대기", 카드는 읽기 전용 "해결 여부는 방장이 확인합니다." |
| 방장 확인 후 | goal-2-1 `completed`, `closedRound=4`, evidence `host_confirmed`(participantId 1) | "방장 확인 완료" 1개 + 진행 중 2개 | 동일 |

GM이 R4에서 제안한 delta: `questsClaimDone`와 `questsRemove`에 모두 goal-2-1 제목, `questsAdd`에 `{title}` 객체 1개. 서버는 완료로 확정하지 않고 방장 확인 전까지 active + pending으로 보관했다. 방장 확인은 모델 호출 0, 포인트 변동 없음.

## 6. 확인된 현상 (원문 근거 + 소유 경로, 수정 없음)

점수가 아니라 관측 사실이다. 어느 것도 새 프롬프트 문장으로 고치지 않았다.

1. **첫 목표가 R0·R1에 없다.** 오프닝 GM delta에는 `questsAdd`가 없고 `threadsAdd`만 있다(`live/parsed/call-01-gm-open-delta.json`). 로그에 `[TRPG][goal] missing_after_opening { round: 0 }`. R1도 `threadsAdd`만. 첫 목표는 R2에서 처음 생겼다. 생성 단계(모델 출력) 관측.
2. **해결을 서술했지만 제안하지 않은 라운드가 있다(R3).** R3 내레이션은 현이 서류함을 열어 원본 장부를 확보하는 장면까지 쓰지만 delta는 `questsClaimDone`·`questsRemove` 없이 `threadsResolve`·`encountersEnded`에 "세관 심부름꾼 추적"을 넣었다. 목표 해결 제안은 한 라운드 뒤(R4)에 나왔다. 생성 단계 관측.
3. **R4는 `questsRemove`와 `questsClaimDone`를 같은 제목으로 함께 냈다.** 서버는 claim으로 처리(active 유지, pending)했다. 같은 R4에서 `threadsResolve`에 "등대 신호의 공백 조사"를 넣었지만 goal-2-2는 claim되지 않아 HUD에는 진행 중으로 남는다(내레이션상 등대 문 앞 대치까지만 진행).
4. **GM이 낸 NPC가 저장되지 않는다.** R4 delta `npcsAdd`가 `{name, description}` 객체 2개(강도현, 오 노인)인데 `ledger.npcs`는 `[]`다. `gmPrompt.asDelta`가 `npcsAdd`를 `stringList`(문자열만 통과)로 읽어 객체를 조용히 버리고 진단도 남기지 않는다. 같은 delta의 `questsAdd` 객체는 `questLine`이 받아 준다. 계약(`gmStructuredOutput` 스키마 `npcsAdd: array` — 원소 타입 미지정, 프롬프트 예시 `npcsAdd: []`, `types.ts` `npcsAdd?: string[]`)과 모델 출력 형태가 어긋난 지점이다. owner 후보: parse(`src/lib/trpg/gmPrompt.ts`). 모델이 객체를 낸 원인(스키마가 원소 타입을 안 정함)은 확정하지 않았다.
5. **위치가 좌석별로 갈린다.** R3 GM `location`은 "부두 뒷골목 석조 폐창고"였지만 서버는 아무도 이동시키지 않았다(캠페인·4좌석 모두 "마레노 부두", `next_round_context` 저장값 빈 문자열). R4에서 캠페인 위치와 렌 좌석만 "곶 끝의 낡은 등대"로 이동했고 현·서하·도윤 좌석은 "마레노 부두"에 남았다. 이동은 각 좌석 본인의 제출에 목적지 이름이 선언돼야 인정되는 설계(`campaignLedger.bindGmLocationToSubmittedMovement`)와 일치한다(렌은 "등대로 향한다"를 썼고 현은 목적지를 쓰지 않았으며 AI 동료 제출 intent에는 장소명이 없다). 결과적으로 R4 GM 입력의 `[TRPG STRUCTURED STATE]`는 `location=마레노 부두`로, R3 내레이션이 있던 창고와 다르다(`live/wire/call-13-gm-r4-user.txt`). 설계된 동작이며 불일치가 이야기에 미치는 영향은 GPT 평가 대상.
6. **아이템 귀속.** R3 delta는 원본 장부·친필 지시서를 현(participantId 2)에게 줬다. 내레이션은 서하가 서류함을 낚아채 장부를 읽고 현이 열쇠로 연다. R4 내레이션은 도윤·서하가 서류함을 옮긴다.
7. **전개 속도·비밀 노출(관측만).** 4라운드 만에 시나리오 비밀(강도현 범행, 격침 지시서, 오 노인과 형제 관계)이 모두 내레이션에 나왔고 R3 delta `storyPhase`는 `CLIMAX`다. GM 내레이션은 AI 동료뿐 아니라 사람 PC의 입력에 없는 행동도 서술한다(예: R3 "렌이 칼을 쥐고 경비병들의 접근을 지연시키며"). 오프닝 내레이션에서도 서하·도윤의 대사를 GM이 썼다(AI 동료의 첫 행동 호출 전). 판단은 GPT 몫.
8. **기억 입력 한계(이번 실행).** `memoryCall`을 비용 계획상 차단해 R4 GM 입력의 `[SEALED CAMPAIGN SUMMARY]`는 실제 요약 모델이 아닌 결정적 fallback(원문 이어 붙임)이다. 실제 봉인 요약 품질은 이번에 검증하지 못했다. 같은 입력에서 최근 3라운드 원문(`[RECENT ROUNDS — RAW]`), 구조 상태(`quests:`, `flags:`), 시나리오 계획, AI 캐릭터 카드, 좌석별 시트는 정상 주입됐다.
9. **기계적 연속성(모델 호출 0, 54라운드).** `harness/sim.ts`: 실제 엔진·저장소에 스텁 응답으로 54라운드, 네트워크 차단. 결과는 `continuity/continuity-54.json`. 서사 품질이 아니라 코드가 이월하는 상태만 본다.
   - `goals_json`은 완료 9개를 모두 유지한다(HUD는 최근 완료 3개만 표시, GM 입력 `goals_done`도 3개).
   - `npcs`(최대 16)·`worldFlags`(최대 24)는 한도에서 **오래된 항목을 유지하고 새 항목을 버린다**(`mergeFacts`). R54 시점 NPC0~15, FLAG0~23만 남고 NPC40·FLAG30 등은 저장되지 않는다. 비우는 경로는 GM의 `npcsRemove`/`flagsRemove`뿐이다. 실제 GM은 4라운드 동안 flags 5개를 추가했고 `npcsRemove`·`flagsRemove`는 한 번도 내지 않았다.
   - `[SEALED CAMPAIGN SUMMARY]`는 요약 연결문을 앞에서 2,500자로 자른다(`memory.persistRoundSummary`). 스텁 fallback 기준 R54 입력의 봉인 요약은 R0~R24만 담고, R25~R50은 봉인 요약에도 최근 원문(R51~53)에도 없다. 장기 기억 이벤트(`memoryHorizon`) 회상 경로는 스텁이라 검증하지 못했다. 실제 요약기는 배치당 500자라 포화 시점은 비슷할 것으로 보이나 이번에 측정하지 않았다.
   - 50턴 이상의 실제 모델 서사 품질은 주장하지 않는다. 실제 장기 플레이가 필요하면 별도 호출 수·비용 계획이 필요하다.

## 7. 아직 검증하지 못한 것

- 운영 게시 시나리오·페르소나(대체 픽스처 사용).
- 실제 사람 플레이(두 사람 행동은 에이전트 스크립트).
- 실제 봉인 요약 모델·장기 기억 이벤트 회상.
- 수학적 판정 심판(mechanics referee)은 기본 off로 호출 0(서버 d20 판정은 동작: R4 렌 `check_required d20=7 ... PARTIAL_SUCCESS`).
- R4 이후 후속 라운드: POST 상한(14) 때문에 새 목표(goal-4-1)와 완료 후 HUD 반영은 R4 직후 저장 상태까지만 관측했고, 다음 라운드 GM 입력에서 완료/신규 목표가 어떻게 쓰이는지는 모델 호출로 확인하지 않았다.

## 8. 재현

```
cd <repo> && export DATA_DIR=/tmp/g1541/live/data G_MODE=live G_GM_MAX_TOKENS=16384 G_BOT_MAX_TOKENS=4096
TSX="node --conditions=react-server --import tsx"
$TSX harness/run.ts init && $TSX harness/run.ts open
$TSX harness/run.ts round inputs/human-actions-r1.json   # r2, r3, r4 동일
$TSX harness/run.ts confirm
# 모델 호출 0 연속성 점검
DATA_DIR=/tmp/g1541/sim/data $TSX harness/sim.ts
```

하네스는 저장소 `@/` alias(`tsconfig.json`)를 쓰므로 저장소 루트를 작업 디렉터리로 실행한다. `G_MODE=dry`(기본)는 모든 fetch를 막고 스텁 응답만 쓴다.
