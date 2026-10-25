# B39 — 저장된 비정사 과거의 선택적 조회

- 조사 기준 main / 병합된 B38 #1726: `55b893e76b28f1de8fdcc0442cfe5e834f23f9ce` (작업 중 원격 재확인).
- 구현 및 회귀 코드: `d4c3316ab592518d149fdacf00cd63911239a5be`.
- 이 문서의 통제 fixture 결과는 실제 모델 회상 성공을 뜻하지 않는다. 새 provider 호출 0회, API 비용 0원.
- 비공개 원문·캐릭터 정보·전체 wire는 저장소에 포함하지 않았다. 공개 자료는 합성 회귀와 내용 없는 집계 receipt뿐이다.

## BEFORE / PROBLEM

의미 있는 비정사는 기존 `composeBatchScopePayload` → `buildNoncanonSummaryFromTurns` → summary persistence를 거쳐 `chat_turn_summaries.scope_payload.noncanon`에 저장된다. 종료 분기는 같은 레코드의 `branch_canon`과 `branch_status=closed`로 남는다. 기존 Global/Medium 정본 reader는 이들을 본편 입력에서 제외한다.

최초 확인된 B 실패는 **질의 시 reader/조립 단계**다. 저장된 기록이 있어도 명시적 과거 IF 질문이 같은 정본 전용 reader만 사용하여 비정사 근거가 final request에 도달하지 않았다. 저장 실패나 모델 오답을 재현한 것으로 해석하지 않는다.

동일한 신규 20개 테스트를 변경 전 main에서 실행하면 6개 통과 / 14개 실패, 구현 후에는 20개 통과 / 0개 실패다. 실패는 비정사 검색 결과·범위 표지·최종 요청 전달이 없는 조건을 검사한다.

## AFTER

`memory-turn-summary.ts`의 기존 레코드 해석을 재사용하는 read-only 조회가 `noncanon`과 종료된 `branch_canon`의 각 내용을 읽는다. 같은 배치에 두 범위가 있어도 각각 검색한다. inactive, RAW 경계와 겹치는 레코드, 이미 본편으로 편입되어 해당 범위가 지워진 레코드는 제외한다.

`memory-manager.ts`의 preview/chat 양쪽에서 명시적 **범위 + 과거 + 회상/사건 질문**일 때만 조회한다. 기존 키워드 추출·Episodic lexical relevance·기억 내용 sanitizer를 재사용한다. 일반 RP, 본편 과거 질문, 새 IF 생성 요청에는 추가하지 않는다. 주제 없는 범위 질문은 최신 기록 1개, 주제 질문은 관련 기록 최대 3개를 선택한다. 표지를 포함해 1,800자 이내에서 레코드 전체만 전달하며 중간 절단하지 않는다.

선택 자료는 별도의 `NONCANON PAST RECALL` 블록과 비정사/종료 분기·원본 턴·레코드 표지를 갖는다. 기존 `mediumTermText` 전달 경로에 붙이고 현재 Global `.text`, 독립 Episodic, Relationship Durable Ledger에는 쓰지 않는다. 결과가 없을 때는 검색 결과 0개로 표시하고 과거 사건의 부재를 단정하지 않는다. 이 범위 표지는 검색 자료의 해석용이며 전역 `HISTORICAL_TRUTH_POLICY_BLOCK` 수정이 아니다.

최종 연결은 기존 경로 그대로다:

`저장된 scope_payload → memory-manager(preview/chat) → mediumTermText → /api/chat(정상/coverage reconciliation/fallback) → contextBuilder → assemblePrimaryRpRequest`

최종 요청 fixture는 수동 Global 10,000자와 함께 비정사 표지·내용이 남고 블록은 1회만 전달됨을 검사한다. 기존 runtime sanitizer를 약화하지 않고 사람에게 읽히는 출처 표지를 사용한다.

## A — T80 검증의 범위

정본 조사 경로는 `memory-summary-scope` / `oocSceneRender` → `memory-rolling-summary` → summary persistence → `memory-episodic-independent` / `episodicMemoryFacts` → `memory-manager` / `memory-medium-term` / `memory-narrative-context` → 실제 chat route / contextBuilder / Main RP request adapter다. B38의 입력 분류·통제 요약 증거는 재사용하고 새 유료 재실행으로 포장하지 않았다.

첨부 source에는 24개 메시지가 있으며 B37 당시 저장 DB·최종 wire·Gemini 답변은 없다. 비공개 원문의 T80을 격리 DB의 근거 메시지로 사용하고, **수작업 통제 추출 후보 2건**을 기존 source-evidence 저장 owner로 검증했다. 두 사실은 source role/quote를 보존하여 저장·검색되고 final request에 인용으로 전달됐다. 실제 추출 모델이 이 후보를 선택했다는 증거는 아니다. 저장 후보는 제안 행위와 공개 장면에 한정하며 법적 결혼 사실을 만들지 않았다.

`source_turn=80`, `current_turn=100`은 근거 번호와 검색 연령을 위한 fixture 값이다. 100턴 전체 재실행·실제 장기 회상 검증이 아니다. 캐릭터 카드/페르소나도 실제 운영 자료를 복원한 것이 아니다. T81에는 본래 장면으로 돌아가라는 USER 지시가 있음을 원문에서 확인했지만 그 이후 모델 답변은 재검증하지 않았다. 제안·반응·결과의 독립적 확인 및 모델의 법적 관계 오인 여부도 미검증이다.

**최초 미검증 단계는 실제 요약/추출 모델 호출**이다. 검증된 B37 실험 연결이 이 환경에 없고, 사용자가 금지한 과거 DNS/401 경로를 재시도하지 않았다. 실제 요약·추출·RP 답변 모두 `BLOCKED_AUTH`; 따라서 A의 새로운 실패 owner를 확정하거나 추측으로 수정하지 않았다.

## C — 본명 주장

B38의 `CHARACTER_CLAIM` 저장·검색·wire 증거는 재사용했다. 기존 `HISTORICAL_TRUTH_POLICY_BLOCK`은 contextBuilder의 정본 owner이며 변경하지 않았다. 같은 모델·질문의 실제 소비 비교는 `BLOCKED_AUTH`이고, 오답 원인은 `ROOT_CAUSE_UNCONFIRMED`다. 전후 모델 원문과 실제 출력 토큰은 모두 null이다. 새 전역 기억/문체 규칙을 추가하지 않았다.

## REMOVED / PRESERVED

삭제해야 할 기존 우회 reader·writer는 발견하지 않았다. 이번 경로에는 기존 owner의 파싱·점수·sanitizer·prompt 전달을 사용한다. 새 DB, migration, API, backfill/장기 runner, provider, 라우팅 또는 과금 변경은 없다.

RAW4, 5턴 요약, N15 Medium, Global/수동 10,000자, 독립 Episodic, 관계 ledger, 본편 편입·복귀, 페르소나 지식 경계, T99 정상 `draft`와 자기비평 차단, B37 다운로드/HTML 원문을 유지한다. 관련 회귀의 실패 및 제한은 `validation.json`에 분리했다. 운영 DB 쓰기·병합·배포는 수행하지 않았다.

## REGRESSION RISKS / 미검증

- 질의 gate와 관련도는 보수적인 lexical 판단이다. 표현·동의어·조사 차이로 검색을 놓칠 수 있으며 모델 기반 의미 검색 품질을 주장하지 않는다.
- 기록이 없는 일회성 UI/샘플이나 RAW만 있는 비정사는 되살리지 않는다. 현재 구조상 해당 내용의 새 저장/복구는 별도 작업이다.
- 관련 기록이 여러 개이면 최대 3개, 범위만 물으면 최신 1개다. 큰 레코드는 절단 대신 제외한다. 모든 과거 비정사를 망라하는 답변을 보장하지 않는다.
- 명시적 조회에서 최대 1,800자만 추가된다. 일반 RP에는 비용/입력 증가가 없고, 선택 자료가 dynamic block으로 전달되는 기존 경로를 따른다.
- 최종 모델이 본편·비정사를 구별하는지, 없는 사건을 발명하지 않는지, T80 결과와 본명 출처를 정확하게 답하는지는 **실제 모델 미검증**이다. 저장·검색·wire 통과를 그 대용으로 선언하지 않는다.
- T150/300/500/1,000의 실제 기억력은 미검증이다. 기존 합성 budget 테스트의 큰 턴 번호는 장기 모델 실험이 아니다.

## PROOF

`receipts.json`은 비공개 T80 fixture 집계와 공개 합성 B 최종 요청 receipt다. 입력 토큰은 contextBuilder 추정치로 A 8,063 / B 16,578(수동 Global 10,000자 포함)이며 billed usage가 아니다. 실제 모델 출력·사용량은 없고, 신규 API 비용은 0원이다. 원본 전체 wire와 private 인용은 격리 작업 디렉터리에만 남았다. 공개 집계만으로 비공개 원문을 독립 재검수할 수 있다고 주장하지 않는다.

재현 명령은 regular suite의 실행 조건을 유지한 관련 파일 선택이다:

```sh
node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test src/lib/memory/memory-noncanon-recall.test.ts
git diff --check
npm run lint
npm run typecheck:app
npm run build
```

기존 C5 누락 artifact는 생성하거나 대체하지 않았다. 전체 테스트/전체 test 타입 검사를 확대하지 않았다. Draft PR의 정확한 최종 HEAD 및 검증 결과를 기준으로 GPT 검수를 요청하고 STOP한다.
