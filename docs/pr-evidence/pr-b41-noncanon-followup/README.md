# B41 — 명시적 IF 사건의 사실·본편 편입 확인 질문

- 기준 main: `b859226915d827efc06f5069452ec223db298bd5` (작업 시작 시 원격 확인).
- 구현 및 직접 회귀 SHA: `dcb66cd44e2167850d7b128e271ef68df4014886`.
- 유료 호출·인증 재조사·100턴 재투입·신규 runner 없음. 격리 DB와 기존 테스트/최종 request adapter를 사용했다.

## BEFORE / PROBLEM

`그럼 IF에서 있었던 청혼이 본편에서도 확정된 거지?`는 저장된 IF 사건의 본편 확정 여부를 묻지만 검색되지 않았다. 기존 `memory-manager.ts` 게이트는 비정사 범위 AND 과거 어휘 AND 회상 어휘를 모두 요구했다.

기준 main의 실제 JavaScript 정규식 결과는 `NONCANON_RECALL_SCOPE=true`, `PAST_RECALL=false`, `RECALL_QUESTION=false`다. `있었던`이라는 사건 지시와 확인 질문이 있어도 `예전/기억` 등의 조건을 동시에 충족하지 못해 **scope reader 호출 전에** 탈락했다. 저장·검색 랭킹·토큰 예산·모델 답변에서 생긴 실패가 아니다.

같은 52개 테스트는 수정 전 31 pass / 21 fail, 수정 후 52 pass / 0 fail이다. 기존 B39 20개는 전후 모두 통과하며, 신규 32개 중 21개의 실패를 고친다. 새 사실 확인 질문뿐 아니라 이전 게이트가 잘못 열었던 가정/새 장면 작성 요청도 포함한다.

## AFTER

기존 owner 안의 단일 private query-intent helper로 다음을 구분한다.

1. 명시적 비정사 범위가 있어야 한다.
2. 새 장면 작성 요청 또는 조건·가정이면 조회하지 않는다.
3. 기존 과거 회상 요청 **또는** 명시한 IF 사건의 사실/확정/유효성/본편 편입 확인 질문이면 조회한다.

확인 질문은 확인할 술어와 의문/확인 요청 발화를 함께 검사한다. B2 문장이나 `있었던/거지`를 예외 목록에 넣지 않는다. 과거 부사와 기억 동사가 없는 확인 질문도 해당 발화 유형으로 처리한다. 회상 요청에는 기존 조건을 유지한다. 이 helper는 검색 의도만 판별하며 OOC 장면 분류·생성 정본·본편 편입 owner를 대체하지 않는다.

저장된 scope reader, keyword/relevance/sanitizer, 시간선 표지, 1,800자/최대 3개 예산과 일반 RP 경로는 바꾸지 않는다. 새로운 prompt 규칙도 없다.

## PRESERVED

`listNoncanonRecallRecords`의 기존 noncanon/종료 분기 reader를 그대로 사용한다. 본편/활성 분기, inactive, RAW 겹침, 이미 본편으로 편입된 기록에 관한 기존 처리는 유지한다. 본편 Global/Episodic/Ledger에 쓰거나 자동 편입하지 않는다. preview/chat 양쪽이 같은 게이트를 사용하며 조회 전후 DB 변경 수는 0이다.

새 IF 작성, 일반 RP, 단순 가정·조건, 비정사 범위 미지정, 사실을 묻지 않는 평서문/단순 편입 명령은 조회로 처리하지 않는다. 없는 사건 확인 질문에는 기존 0개 결과를 전달한다. 실제 본편 편입은 기존 사용자 명시 편입 owner가 수행하며 그 회귀도 유지한다.

RAW4·5턴 요약·Medium/Global·수동 Global 10,000자·독립 Episodic·관계 Ledger·T80/T99와 원문 다운로드는 변경하지 않는다. 관련 직접 회귀 목록은 `validation.json`에 있다.

## REMOVED

모든 질문에 과거 어휘와 회상 어휘를 동시에 강제하던 단일 AND guard를 교체했다. 별도 fallback reader/분류기·상태 저장·API·실험 인프라는 추가하지 않았다. 기존 과거 회상 조건은 해당 발화 유형에 계속 필요하므로 유지한다.

## PROOF

| B2의 RAW 조건 | 수정 전 선택 기록/출처 표지 | 수정 후 선택 기록/출처 표지 | DB 쓰기 |
| --- | --- | --- | --- |
| 단독 B2, RAW 없음 | 0 / 0 | 1 / 1 | 0 |
| B1 요청 조립 → 합성 B1 답변 RAW → B2 | 0 / 0 | 1 / 1 | 0 |

순차 검증에서는 같은 chat의 B1을 먼저 실제 memory/context/request owner로 조립한다. **첫 질문의 실제 모델 답변은 없다.** 이후 RAW의 assistant 문장은 테스트가 만든 합성 답변이며 실제 B1 답변으로 주장하지 않는다. 선택 기록과 문구가 다른 합성 RAW를 사용해, 최종 B2 request 전체에서 저장 레코드 본문·시간선 출처·회상 블록이 각각 한 번만 존재함을 검사한다. 합성 RAW 자체도 final request에 남는지 검사한다.

최종 경로: `buildMemoryContextForChat → buildNoncanonRecallBlock → 기존 저장 scope reader → mediumTermText → contextBuilder → assemblePrimaryRpRequest.requestBody`. 실제 adapter의 request body를 검사했으며 네트워크로 전송하지 않았다. 모델의 동의/거절·시간선 구분 답변은 이번 검증 대상이 아니다.

`receipts.json`은 전후 실제 gate 결과와 위 두 final request 집계다. 공개 합성 fixture만 쓰며 비공개 RP 원문·전체 wire는 공개하지 않는다. 입력 토큰은 추정치이며 실제 usage가 아니다. API 비용은 0원이다.

## REGRESSION RISKS / 제한

- 기존처럼 보수적인 lexical gate다. 모든 언어·문체·복합 요청을 의미 분석하는 모델이 아니다. 확인과 창작/가정이 섞이면 창작/가정을 우선 제외하므로 복합 요청을 놓칠 수 있다.
- 의미가 모호한 표현·게이트를 벗어난 표현의 일반화 및 실제 모델 답변 정확도는 보장하지 않는다. 관련 레코드 선택·예산은 기존 owner를 따른다.
- 저장된 기록이 없는 비정사 RAW를 새로 추출하거나 복구하지 않는다.
- 실제 모델 B1→B2 대화, 장기 T150/300/500/1,000 성능은 검증하지 않았다. `SOURCE_ROUTING_VERIFIED_ONLY`를 모델 회상 성공으로 표시하지 않는다.

검증 명령은 기존 regular contract로 관련 파일만 선택한다. build 완료 후 lint/app typecheck를 순서대로 실행한다. 전체 테스트/기존 test 타입 오류·공유 DB 인프라로 범위를 확대하지 않는다.

**Draft PR → GPT 검수 요청 → STOP. 병합·배포·운영 DB 쓰기 없음.**
