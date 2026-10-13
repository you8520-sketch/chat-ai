# Main RP B-2 Core — 허위 과거를 막는 최소 출처 권위 계약 조사

Evidence only. 제품 코드 변경 없음, 새 PR 없음, 유료 호출 0, DB 변경 0(격리 테스트 DB만). 병합 없음.

- Main: `cab13960`. #1591 HEAD: `1389e04f` (Draft, 미병합). 조사 실행은 `1389e04f` 체크아웃에서 수행했다. 이번 조사에서 읽은 episodic 증거 게이트·요약 provenance·fork 코드는 main과 동일하다(`14bf76ec` 대비 및 `cab13960` 대비 diff 없음 확인).
- 입력: #1591 fixture `rolling-summary-seal-stall.real-luna.json` (실제 Luna 5턴 요약 16구간, 80턴 전체 메시지, 페르소나 "이름/호칭: 렌").
- extractor 출력은 새 호출 없이 #1571 `epi-base.json`의 실제 형태(`evidence_type` + `evidence.source_role/source_quote`)로 직접 구성했다.

## 1. 실행 경로 (canonical owner)

| 단계 | owner | 이번 조사에서 확인한 것 |
|---|---|---|
| 원문 | `messages` | 정본. 모든 비교 기준 |
| 인용 검증 | `evaluateEpisodicFactEvidence` (`memory-episodic-evidence.ts`) | 인용이 해당 턴의 정본 유저/AI 메시지에 존재함만 증명. 권위는 역할 + `evidence_type`에서 서버가 결정 |
| 저장 | `episodic_memory_facts.metadata.evidence` | `{role, message_id, quote, authority, match}` |
| 약속 | Relationship Durable Ledger | `{text, deadline}`만 저장. message id/인용 없음. episodic은 `detectRelationshipLedgerOwnedFact`로 약속을 받지 않음 |
| 요약 | `chat_turn_summaries` + `scope_payload` | `source_start/end_user_message_id`, 마지막 `assistant_message_id`(구간 단위). `scope_payload`는 `{v, scopes, branch*}`뿐. `ScopePayloadV1.sourceMessageIds`는 선언만 있고 쓰는 곳이 없음 |
| 회상 주입 | `getEpisodicMemoryForPrompt` | 설명(`fact_text`)이 아니라 검증된 인용을 권위 라벨과 함께 렌더 |
| 요약 주입 | `buildMemoryContextForChat` → `buildContext` `current-memory` | 요약 prose 그대로, id 없음 |

데이터: `data/source-authority-probe.json`, probe: `probes/source-authority-probe.test.ts.txt`.

## 2. 5개 사건 결과 (실제 fixture 메시지, 페르소나 포함)

| 사건 | 검증기 판정 | 저장 | 요약 |
|---|---|---|---|
| 검 손질 약속 (턴 2, 유저) | accepted, `USER_EXPLICIT`, msg 4 | **저장 안 됨** (약속은 ledger 소유라 episodic 필터에서 제외) | 1~5턴 요약 prose에 있음, 문장별 출처 없음 |
| 이별 통보 (턴 40, 유저) | accepted, `USER_EXPLICIT`, msg 80 | 저장됨, 인용 "미안, 우리 그만 헤어지자." | 36~40턴 요약 (범위 msg 72..81) |
| 누나 과거 친분 (턴 24, 캐릭터 주장) | `explicit_character_claim` → accepted, `CHARACTER_CLAIM`, msg 49 | 저장됨, wire에 "캐릭터 발언(미확정 주장)" 라벨 | 21~25턴 요약은 "…라고 말했다"로 귀속 |
| 같은 문장을 객관 사실로 승격 | rejected `assistant_evidence_cannot_authorize_user_linked_history` | - | - |
| 스승·연인: 존재하지 않는 인용 | rejected `evidence_quote_not_in_message` | - | - |
| 스승·연인: 실제 인용 + 유저와 엮은 설명 | rejected `assistant_evidence_cannot_authorize_user_linked_history` | - | - |
| 스승·연인: 유저 역할로 AI 메시지 인용 | rejected `evidence_quote_not_in_message` | - | - |
| **스승·연인: 실제 인용("라이크는 23번째 장작을 쌓았다.") + 유저와 무관한 날조 설명** | **accepted, `CURRENT_SCENE`, msg 47** | 저장됨(날조 `fact_text` 포함) | - |
| 정상 감정 (턴 1) | accepted, `CURRENT_SCENE`, msg 3 | 저장됨 | 포함 |
| NPC 행동 (턴 20) | accepted, `CURRENT_SCENE`, msg 41 | 저장됨 | 포함 |

해석:

- 인용이 존재한다는 사실(검증됨)과 인용이 설명하는 사건이 실제라는 판단(미검증)은 다른 층이다. 날조 설명 행이 그 증거다.
- 그 행도 최종 wire에는 `[AI가 쓴 장면 원문] "라이크는 23번째 장작을 쌓았다."` 인용만 오른다. 날조 설명은 wire에 오르지 않는다. 다만 회상 검색 순위에는 영향을 준다("라이크의 과거 스승이자 연인" 질의가 이 행을 회수함, `episodicWireByQuery.mentorLover`).

## 3. 티켓 5.1~5.5

1. **요약 사건의 원본 메시지 확인**: 불가(문장 단위). 구간 단위로 유저 메시지 id 범위만 있다. episodic 행은 메시지 id + 인용이 있다. 약속은 ledger에 id·인용이 없다.
   - 구간 범위와 episodic `message_id`를 join해 "근거 있음"으로 처리하면 안 된다. 날조 행(msg 47)이 21~25턴 범위(msg 42..51) 안에 있어서 같은 구간의 허위 요약 문장을 "근거 있음"으로 만든다.
2. **권위 구분**: 가능(이미 구현). `USER_EXPLICIT` / `CHARACTER_CLAIM` / `CURRENT_SCENE`, wire 라벨 3종.
3. **허위 과거를 확정 사실로 넣지 않고 주장이 있었다는 기억은 보존**: 가능(이미 구현). 누나 사례는 `CHARACTER_CLAIM`으로 저장되고 wire에 미확정 주장으로 오른다. 객관 승격은 거절된다. 요약 prose는 주장이 귀속된 경우에만 안전하며, 이 부분은 문장 출처가 아니라 텍스트 방어에 의존한다.
4. **정상 감정·NPC·관계 연속성**: 손실 없음. 80턴 최종 wire의 `current-memory`에 16구간 전부, 검 약속·연인 제안·약속 취소·서린 목례·이별 통보가 남는다. 감정·NPC는 episodic 검증도 통과한다.
5. **봉인·후속 구간 진행**: #1591(`1389e04f`)에서 16구간 모두 봉인(페르소나 포함). main은 정체. `data/seal-stall-BEFORE-main-14bf76ec.log`, `data/persona-seal-stall-BEFORE-3084f4ef.log`, `data/persona-seal-stall-AFTER.log`, `data/seal-stall-AFTER.log`.

## 4. 새로 확인한 결함: fork가 근거 메시지 id를 새 채팅으로 옮기지 않음 (티켓 7번 위험)

`copyForkEpisodicMemoryFacts`는 `source_user_message_id`와 `metadata.assistant_message_id`는 재매핑하지만 `metadata.evidence.message_id`는 재매핑하지 않는다.

- 결과(`data/fork-evidence-id-probe.json`): 부모 msg 1, 포크 msg 3일 때 포크 행의 `evidence.message_id`는 1 그대로이고 이 id는 포크 채팅 소속이 아니다.
- wire는 인용만 쓰므로 현재 프롬프트 내용은 영향이 없다. `readVerifiedEvidence`는 id 소속을 검사하지 않아 여전히 통과한다. 같은 인용은 포크 메시지에 대해 재검증하면 통과한다(msg 3 accepted).
- 결론: 출처 id를 계약의 일부로 쓰기 전에 이 지점이 필요하다. regen·delete 경로의 evidence 일관성은 이번에 실행 검증하지 않았다(미검증으로 남김).

## 5. 기존 differential 재현 결과 (정확한 수치)

티켓의 "기존 26건"에 해당하는 단일 파일을 찾지 못했다. 보관 중인 differential 수치는 다음과 같고, 원본 파일을 그대로 올렸다.

- 프로브 104건(13 케이스 x 8 변형), main `14bf76ec` vs #1591 `1389e04f`.
- 필드가 하나라도 달라진 행 88건.
- 페르소나 포함 `isRollingSummaryGroundedInDialogue` false→true 30건: 허위 과거 20건(직접 회귀, 절 맨 앞 `이후` 단서만 있는 스승·연인 문장)과 정상 10건(`scene-sequencing-ok`, `user-promise-ok`).
- 페르소나 포함 true→false 20건(강화 방향).
- 파일: `data/false-past-differential-14bf76ec-vs-1389e04f.json`(20건 회귀 목록), `data/false-past-probe-OLD-14bf76ec.json`, `data/false-past-probe-NEW-1389e04f.json`, `data/false-past-cases.json`, `probes/false-past-probe.ts.txt`.
- 26건 아티팩트가 따로 있다면 위치를 알려주면 같은 디렉터리에 추가한다.

## 6. 가능한 최소 수정 범위 (승인 대기, 미구현)

옵션 A. 약속 장부에 출처 결합 (가장 작음, 기존 owner 재사용)
- 변경: ledger 약속 항목에 선택 필드 `{role, message_id, quote}`를 추가하고 기존 `evaluateEpisodicFactEvidence`로 검증한다. 새 verifier, 새 DB, 새 호출은 없다.
- 영향 파일(예상): `chatMemory.ts`(약속 타입/병합), `postTurnSharedInitial` schema/parse(promisesAdd에 인용 필드), `memory-fork-snapshot.ts`(id 재매핑). #1588의 정확 텍스트 취소는 유지한다.
- 비용: 기존 Shared Initial 호출 1회 안에서 약속당 인용 1개(최대 300자) 추가. 호출 수는 그대로이며 토큰 증가량은 실측하지 않았다(약속이 없는 턴은 0).
- 위험: 기존 장부 행은 필드가 없다(legacy, 출처 미상으로 취급). 인용-사건 일치는 여전히 증명하지 못한다.

옵션 B. 요약 prose를 "원문 근거 미검증 파생 서술"로 라벨 강등
- 권위가 필요한 사건은 검증된 episodic 인용이 맡는다. wire 문구 변경이라 별도 승인과 wire 예산(현재 80턴 `current-memory` 1,197자 / episodic 761자, 10,000자 한도 내) 확인이 필요하다.

옵션 C. fork 근거 id 재매핑 (독립 결함 수정, 매우 작음)
- `copyForkEpisodicMemoryFacts`에서 `evidence.message_id`도 `messageIdMap`으로 재매핑하고, 없으면 evidence 제거 또는 행 제외. A/B와 독립이다.

하지 않을 것: 구간 범위 join, 문장별 정규식/토큰 겹침 보정 추가, 기존 방어 삭제.

## 7. STOP

원문 출처를 붙여도 인용-사건 일치(의미) 판정은 기존 구조로 안전하게 닫히지 않는다(날조 설명 행). 요약 문장 단위 출처 계약은 지금 데이터로 증명할 수 없다. 따라서 제품 코드 수정 없이 STOP한다. GPT 재검수 대기.
