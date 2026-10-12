# B-2 Core — 단일 정본 owner 최소 수직 경로 설계 검증

- 기준: `origin/main` = `efea11182d43abba4af31af10f461f160d97b923` (변경 없음)
- 범위: 설계 + 결정적 probe. `src/` 변경 0, Provider POST 0, Production DB write 0, 새 기능 PR 0, 자동 병합 0.
- 사용한 증거: 현재 main의 실제 `buildContext`/`evaluateEpisodicFactEvidence`/persist/ledger 코드를 임시 worktree(`/tmp`, 커밋 안 함)에서 실행한 결과, 이전 단계에서 저장된 real Luna 요약 27건·Gate 2 fixture.
- 재현: `probes/zz-slice.test.ts.txt`를 `src/lib/memory/`에 임시 복사해 `node --conditions=react-server --import tsx --test`로 실행 (커밋 금지). 결과 원본 `data/slice-results.json`, 최종 wire 발췌 `wires.md`, 선택 전략 `analysis/selection-*`.

## 상태 한 줄

**GLOBAL MEMORY IMPROVEMENT UNPROVEN. 구현 없음. 요약 prose 경로는 "정상 회상 유지 + 거짓 사건 차단"을 동시에 증명하지 못해 STOP. ledger 경로만 결정적으로 증명 가능한 MVP 후보(MVP-A)가 있고, 그것도 새 필드가 필요하므로 범위만 보고하고 STOP.**

---

## BEFORE (현재 main, 최종 wire 기준)

1. 최종 wire에서 요약 prose, 에피소드 라인, ledger는 모두 같은 `<LONG_TERM_MEMORY>` 아래에 있고, 이 블록의 서문은 "과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'"이다 (`wires.md` §2, §4의 "Placement" 확인값 `proseInsideAbsoluteFactsWrapper: true`, `episodicLineInsideAbsoluteFactsWrapper: true`).
2. 에피소드 경로는 서버가 검증하는 것이 **글자 존재 + 그 글자가 들어 있는 메시지의 role**뿐이다. 사건의 진위는 LLM이 준 `evidence_type/subject/category` 라벨에 의존한다.
3. ledger(`chats.memory_meta`의 `items`/`promises`)에는 근거 필드가 없다. 추가는 LLM 텍스트를 그대로 받고, 취소는 정확히 같은 문자열이어야 먹으며, 15개를 넘으면 새 약속이 조용히 버려진다.
4. 요약 prose는 Luna가 쓴 자유 서사이고, 서버가 사건 단위로 검증할 수 있는 근거 구조가 없다 (어휘 guard만 존재).

## PROBLEM (결정적 probe로 확인한 것)

### P1. 에피소드 검증은 라벨 정직성에 의존한다 (`wires.md` §1, `data/slice-results.json.verifierMatrix`, `liveGateWire`)

같은 12턴, 같은 bait 질의, 라벨만 바꿔서 실제 `persist → retrieve → buildContext`를 통과시킨 결과:

| 케이스 (거짓 내용 여부) | H: 라벨 정직 | M2: 라벨 회피(scene/비유저 subject) |
|---|---|---|
| N1 존재하지 않는 평생 약속 (거짓) | `[캐릭터 발언(미확정 주장)]` 로 표시 | `[AI가 쓴 장면 원문]` 로 표시, 통과 |
| N2 "누나가 렌을 알아봤다" (거짓) | 미확정 주장 라벨 | 장면 원문 라벨, 통과 |
| N3 화자 뒤바뀐 "아마추어" (거짓) | 미확정 주장 라벨 | 장면 원문 라벨, 통과 |
| N5 AI가 쓴 유저 과거 행동(이름 지칭) (거짓) | 미확정 주장 라벨 | **차단** (`assistant_evidence_cannot_authorize_user_linked_history`; 유저 이름 어휘 검사) |
| N6 지어낸 임무/우산 (거짓) | 미확정 주장 라벨 | 장면 원문 라벨, 통과 |
| N7 AI가 쓴 유저 손잡기 (현재 장면, 거짓) | **차단** (`assistant_evidence_cannot_authorize_user_action`) | 장면 원문 라벨, 통과 |
| N4 커피 저음 → 키스/포옹 gloss | 장면 원문(커피)만, gloss는 wire에 안 나감 | 동일 |

- H에서는 6개 거짓 중 장면 사실 라벨로 새는 것이 0이지만, 5개의 거짓 인용이 여전히 "기정사실" 서문 아래에 인용문으로 노출된다 (라벨이 "미확정 주장"일 뿐).
- M2에서는 6개 거짓 중 5개가 `[AI가 쓴 장면 원문]` 으로 새고 N5만 어휘 검사(`mentionsUser`: 유저/사용자/페르소나 이름만, "네가/널" 미포함)가 잡는다.
- 결론: 현재 방어는 "서버가 증명한 것"이 아니라 "LLM이 정직하게 라벨했을 때"만 성립한다. 실제 extractor 라벨 정직도는 Provider 호출 없이 측정 불가 → **UNMEASURED**.
- gloss(`fact_text`)는 wire에 나가지 않는다 (`glossOnWire:false`) — 이는 좋은 불변.

### P2. ledger 경로 (`data/slice-results.json.ledger`, `wires.md` §2)

- 가짜 평생 약속·지어낸 소지품이 `<LONG_TERM_MEMORY>` 서문 아래에 그대로 렌더된다 (`약속: 라이크가 렌을 평생 지키겠다고 약속함`).
- 취소: 정확 문자열 취소만 반영(`cancelExact → []`), 말바꿈 취소는 약속이 남는다(`cancelParaphrase`). 
- 상한: `promises` 15개에서 오래된 것을 유지하고 새 것을 버린다(`cap15`: 원래 약속 유지, 마지막 "사소한 약속 14번"까지만).
- `parseMemoryMeta`는 알 수 없는 키를 제거한다(`unknownKeys`: promise 키가 `text`만 남음) — 근거 필드를 얹으려면 whitelist 변경이 필요하다.
- 삭제 롤백: before-snapshot이 있으면 정확히 복원, 없는 legacy 경로는 부분 문자열 휴리스틱이라 가짜 약속이 남는다(`deleteRollback.legacyNoSnapshotFallback`).

### P3. 요약 prose 경로

- 실제 Luna 요약 prose(A01~A06 등)는 거짓 가정을 그대로 재진술하지 않는 경우가 많지만, 이는 writer 행동이지 서버 보장이 아니다. prose를 끄고 인용만 쓰면(rows+anchors) 평균 토큰이 12개 실제 window에서 1,397 → 1,762 (+26%)로 늘고(`wires.md` §4), 감정/관계 서사의 압축 표현이 사라진다 → 감정 보존은 사람이 판정해야 한다 (**UNMEASURED**).
- 사용자 수정 요약: sealed 행(`scope_payload` 있음)에서 유저가 고친 텍스트가 wire에 안 나온다 (`userEditShadow.sealedRowShowsEditedText:false`, legacy 행은 나옴). 독립 결함.

### P4. 수명주기

- 에피소드: regen/마지막 턴 삭제에서 정상 정리 (`episodicLifecycle`: insert 1 → regen 0 → 재삽입 1 → delete 0). 이 경로는 건드릴 필요 없음.
- fork: ledger는 부분 문자열 휴리스틱으로 부모의 `내일까지 검을 갈아다 준다`를 잃고(`fork.ledgerSnapshot.keptInChild`), 에피소드는 복사되지만 `evidence.message_id`가 부모 메시지 ID(174) 그대로다 (child user=177). 근거 재검증이 fork 후에는 붕괴한다.

## OWNER MAP (현재 main에서 확인한 live owner)

| 책임 | 현재 owner | 비고 |
|---|---|---|
| RAW 정본 | `messages` 테이블, 메시지 ID/role | 모든 근거의 유일한 뿌리 |
| Shared Initial 추출 (1회 호출) | `src/lib/postTurnSharedInitial/{prompt,schema,types,relationship}.ts` | 입력 = 현재 user + assistant 텍스트뿐. ledger/이전 턴을 못 본다. strict schema (`additionalProperties:false`) |
| 에피소드 정규화/저장 | `memory-episodic-normalize.ts`, `episodicMemoryFacts.ts` (`filterUnsafeEpisodicFactsForSave`) | OOC 유저 턴 차단(`sourceMessageIsNoncanonical`) 포함 |
| 에피소드 근거 판정 | `memory-episodic-evidence.ts` (`evaluateEpisodicFactEvidence`) | role-derived USER_EXPLICIT 은 서버 증명. CHARACTER_CLAIM/CURRENT_SCENE 은 LLM 라벨 의존 |
| 관계 ledger | `memory-relationship-meta.ts` (`parseMemoryMeta`, `mergePromises`) + `chatMemory.ts` | 근거 없음. 삭제 롤백은 `messages.memory_relationship_before_json` |
| 요약 | `memory-turn-summary.ts`, `memory-summary-persist.ts` (`scope_payload`) | `user_edited` 는 재seal만 막고 reader 우선순위는 scoped text 우선 |
| fork | `memory-fork-snapshot.ts` | ledger 부분 문자열 / `evidence.message_id` 미재매핑 |
| wire 조립 | `src/services/contextBuilder.ts` | prose/episodic/ledger 모두 `<LONG_TERM_MEMORY>` |

**목표 owner는 새로 만들지 않는다.** 근거 판정의 단일 owner = `memory-episodic-evidence.ts`. ledger는 그 owner의 role 도출을 재사용하는 소비자가 된다 (두 번째 verifier를 만들지 않음).

## TARGET CONTRACT (최소 event-authority 계약)

원칙: **권위(authority)는 근거 span이 들어 있는 정본 메시지의 role에서만 나온다. LLM 라벨은 주장일 뿐 증거가 아니다. 인용 존재는 사건 진위를 증명하지 않는다.**

| 항목 | 계약 | 서버가 결정적으로 판정 가능? |
|---|---|---|
| source | `{role, message_id, span(quote)}`; quote는 해당 메시지에 정규화 포함 | 가능 (현재도 구현됨) |
| 권위 상승 연산 (promise/관계 확립, 유저 행동·과거) | role=user 메시지의 span만 허용 | 가능 |
| 권위 하락 연산 (취소/철회) | 검증된 span이면 role 불문 | 가능 |
| 직접 발화 vs 현재 장면 vs 과거 주장 | assistant span의 하위 분류는 LLM 라벨 | **불가 (UNSOLVED)** — 서버는 role만 안다. 라벨 정직성은 측정 불가 |
| 누가 누구에게 무엇을 했는가 (AI 서사 내부 행위자) | 행위자 해석 필요 | **불가** — "네가/널" 같은 대명사 해석은 어휘 검사로는 부족(`mentionsUser` 한계) |
| 제안 vs 수락 ("연인하자") | 수락은 다음 턴의 근거 | **불가 (결정적 상태기계 불가)** — 최종 wire에서 두 인용을 시간순으로 나란히 보여주는 것까지만 가능 |
| 취소가 가리키는 약속 | 문자열 매칭에 의존 | **불가** (말바꿈 취소). 인용 둘을 나란히 보여주는 것까지 |
| OOC | 현재 persist가 OOC 유저 턴을 에피소드에서 제외 | 가능(제외). 그러나 "유효한 OOC 설정 선언"을 정본으로 **보존**하는 경로는 따로 없음 → P5 해당 케이스 insert 0 (`liveGateWire` P5 H/M2 모두 0) |
| 사용자 요약 편집 | `user_edited` 행은 최고 권위 | 가능하나 sealed 행에서 reader가 편집본을 안 읽는 결함이 먼저 |
| 무효화 (regen/IF/fork/delete) | 근거 메시지 삭제 → 연쇄 삭제 | 에피소드는 동작. ledger는 휴리스틱, fork는 `evidence.message_id` 재매핑 필요 |

Shared Initial 호출이 **할 수 있는 것**: 현재 턴 user/assistant 텍스트에서 인용 span과 후보를 추출 (새 호출 없음, 출력 토큰만 약간 증가).  
**할 수 없는 것**: 이전 ledger/이전 턴을 모르므로 "어느 약속을 취소하는가", "이전 제안의 수락인가"를 판정할 수 없다. 새 verifier LLM은 금지이므로 이 의미 판정은 계약에 넣지 않았고, wire에서 인용을 나란히 노출하는 방식으로만 우회한다.

## 최종 wire 반례 검사 (`wires.md` 참조)

| 케이스 | 현재 main | role-derived ledger leg (probe) | 판정 |
|---|---|---|---|
| 존재하지 않는 평생 약속 (ledger) | 가짜 약속이 `Absolute Facts` 아래 렌더 | gloss 미렌더. AI span이면 `[AI가 쓴 원문(사실 미확정)]` 로만 표시, 유저 부정 발화가 같이 노출 (`wires.md` §3) | 개선 (ledger 경로) |
| "누나가 렌을 알아봤다" 에피소드 | H: 미확정 주장 라벨 / M2: 장면 라벨로 누수 | 변화 없음 (에피소드 owner) | **미해결** (라벨 의존) |
| 화자 뒤바뀐 아마추어 | 위와 동일 | 변화 없음 | **미해결** |
| 커피→키스/포옹 | gloss가 wire에 안 나가므로 안전 | 동일 | 통과 |
| AI가 쓴 유저 과거 행동 (N5) | H: 미확정 주장 라벨로 노출 / M2: 이름 어휘 검사로 차단 (이름이 없으면 불가) | 동일 | 부분 (어휘 의존) |
| 증폭 (인용이 반복 노출) | 근접 중복 클러스터 + dedupe(role,message_id,quote)로 억제 가능 | — | 선택 전략에서 확인 |
| 관계 선언 + 반응 | P1 유저 원문 + P2 장면 원문 모두 통과 | — | 통과 |
| 합의/이별/취소 | 에피소드에서 둘 다 인용으로 노출 가능(`T8 연인하자`, `40 헤어지자`); 취소는 ledger 문자열 매칭에 의존 | 인용 2줄 시간순 노출 | 정상 회상은 통과, **최신 상태는 모델이 읽어야 함** |
| NPC 행동 / 캐릭터 자기 과거·감정 | P3, P4 통과 (장면 원문) | — | 통과 (정상 NPC 권한 유지) |
| T1 아마추어 + 입술 깨물기 | 에피소드 rows에 둘 다 존재, anchors와 중복 → exact dedupe | — | 통과 |
| 유저 수정 요약 | sealed 행에서 편집본이 안 나옴 | — | **결함** (독립 follow-up) |
| regen/IF/fork/delete 후 정본 | 에피소드 OK, ledger/fork 휴리스틱 결함 | — | 부분 |
| 유효 OOC 설정 선언 | 에피소드 insert 0 (보존 경로 없음) | — | **미해결** |

## 선택 전략과 비용 (`analysis/selection-*`)

C2의 41/49는 합성 spec에 대한 **어휘 커버리지 프록시**이며 감정 보존의 증거가 아니다.

| 방식 (역할 분리 커버리지) | 전체 | Q | R | E | S | 평균 chars/window |
|---|---|---|---|---|---|---|
| CURRENT prose | 43/49 | 4/6 | 12/14 | 11/13 | 16/16 | 274 |
| user raw 200 (결정적) | 38/49 | 3/6 | 10/14 | 10/13 | 15/16 | 291 |
| verified rows만 | 13/49 | 0/6 | 7/14 | 1/13 | 5/16 | 31 |
| rows + all anchors (C2) | 41/49 | 5/6 | 12/14 | 10/13 | 14/16 | 420 |
| user anchors만 | 27/49 | 1/6 | 8/14 | 7/13 | 11/16 | 118 |
| assistant anchors만 | 29/49 | 4/6 | 8/14 | 6/13 | 11/16 | 270 |

- 단서가 assistant 본문에만 있는 사실은 11/49 → user 원문만으로는 상한이 있다.
- 장작 반복 선택(중복 에피소드/앵커 총 49줄, 중요 19줄, 장작 30줄): 예산 300~900자에서 `최신순`(S0)은 중요 stem 0/8, `user-first`(S1)는 5/8이지만 장작이 계속 남는다. **근접 중복 군집화 후 user-first**(S2)는 450자에서 7/8, 600자 이상에서 8/8, 장작은 1줄로 줄어든다. 일반 window 271 앵커에서 군집 오병합 0 (임계 0.5~0.8).
- S2에서도 거짓 G2 후보 줄이 2개 남는다 (모두 `[AI가 쓴 …]`/`[캐릭터 발언(미확정 주장)]` 라벨이 붙은 인용). 인용 노출이므로 "차단"이 아니라 "라벨링".
- 중복 주입: 에피소드 rows와 anchors를 따로 주입하면 18 rows / 44 anchors 중 중복이 13쌍(T1 아마추어, 입술 깨물기, 연인하자, 헤어지자, 장작 …) → **단일 블록 + dedupe(role, message_id, 정규화 quote)** 만 허용. 앵커는 별도 주입기가 아니라 같은 episodic 블록의 row여야 한다.
- 토큰: 12개 실제 window에서 CURRENT 평균 1,397 tokens(1,552 chars) vs rows+anchors 1,762 tokens(1,958 chars), **+26%**. 10K Current Memory 안에서는 예산 문제 없음. OLD 대비 비교는 OLD 출력이 없어 UNMEASURED.

## STORAGE / DELETION / COMPAT (§6)

- 에피소드: 이미 행에 `evidence {role, message_id, quote, authority, match}` JSON이 저장된다 — 추가 저장 없음.
- 요약: `scope_payload {v:1, scopes, sourceMessageIds}` 와 `user_edited` 존재 — 추가 구조 불필요. 단 sealed 행의 편집 shadow 결함은 독립 수정 대상.
- ledger(MVP-A에 필요한 최소 변경): `chats.memory_meta` JSON의 `promises[]`/`items[]` 항목에 선택 키 `evidence:{role,message_id,quote}` 를 허용. **DB 마이그레이션은 불필요**(기존 JSON 컬럼)하지만 **`parseMemoryMeta` whitelist와 Shared Initial strict schema가 바뀌어야 한다** → 이는 "새 필드" 범위이므로 설계만 보고하고 STOP.
- legacy: 근거 없는 기존 항목은 자동 승격 금지. 표시에서만 "미검증 레거시"로 강등 (probe `wires.md` §3), 삭제 안 함.
- 삭제/롤백: 근거 메시지가 삭제되면 해당 항목 무효화(근거 존재 여부로 판정) — before-snapshot이 없는 legacy 경로의 부분 문자열 휴리스틱을 대체.
- fork: 복사 시 `evidence.message_id` 를 자식 메시지 ID로 재매핑해야 근거 검증이 유지된다.

## REGRESSION RISKS

1. 근거 없는 정상 항목(LLM이 인용을 못 달았을 때)이 사라져 중요 관계/약속 기억이 줄 수 있다 — 강등 표시로 방지(삭제 금지), 그러나 실제 비율은 Provider 없이 측정 불가.
2. Shared Initial strict schema에 인용 필드 추가 시 출력 토큰 증가와 스키마 거부율 변화 (측정 불가).
3. assistant span을 "미확정"으로 라벨링하면 합법적인 NPC/세계 사건의 서사 영향력이 낮아질 수 있다. 일괄 라벨은 결정적 안전이 아님 (GPT 지적과 동일) — 장면 사건(P2, P3, P4)은 현재 통과하므로 건드리지 않는다.
4. 요약 prose를 끄면 감정/관계 연속성이 줄 위험 (E 11/13 → 10/13 어휘 프록시, 실제는 UNMEASURED).
5. 선택 전략 S2는 합성 + 12 window 위주이므로 일반화는 미증명.

## PROOF (결정적, Provider POST 0)

- raw → store → inject 경로 존재 확인: 에피소드 persist → retrieve → 실제 `buildContext` 최종 wire (`wires.md` §1, §4).
- 정상 회상 + 거짓 차단 **동시 증명은 실패**: M2에서 에피소드 경로가 5/6 누수, 요약 prose 경로는 근거 구조 자체가 없음 → 게이트 미통과, 구현 0.
- ledger 경로의 role-derived 판정은 probe fixture 5건에서 결정적으로 동작 (`data/slice-results.json.ledgerPrototype`: 위조 인용 거절, 유저 취소 인용, 가짜 약속은 gloss 미렌더). 그러나 실제 Luna 추출 분포가 아니라 fixture이므로 production 증명 아님.
- 재현: 위 probe 명령. `git diff --check` 및 `src/` 변경 0 확인 포함.

## COST

- 새 모델 호출 0, verifier LLM 0. 추가는 Shared Initial 출력 토큰(항목당 인용 약 20~60 tokens, 신규 약속/소지품 추가 시에만), 서버 DB 조회 1회(근거 메시지 로딩 — 에피소드 경로가 이미 사용 중인 `loadEpisodicEvidenceSources`).
- wire: 살아 있는 gate wire 1,980 vs 1,965 tokens (H/M2 차이 없음). rows+anchors(prose off)는 +26%.
- 롤백: 선택 키라 코드 revert만으로 되돌림, 데이터 마이그레이션 없음.

## CHANGE BUDGET

- MUST FIX NOW: 없음 (STOP).
- 승인 시 첫 MVP(MVP-A, ledger leg): `parseMemoryMeta` whitelist + Shared Initial schema의 promise/item `evidence` 선택 키 + ledger 렌더에서 gloss 대신 검증된 인용 사용 + legacy 강등. 에피소드/요약 owner 변경 0.
- REQUIRED CLEANUP: 없음.
- SAFE OPTIONAL / FOLLOW-UP: 아래 §8, 독립 결함 목록.

---

## 제안: 가장 작은 실행 가능한 MVP — MVP-A (ledger leg)

**내용**: ledger의 `promises`/`items` 항목은 `{role, message_id, quote}` 근거가 서버에서 검증될 때만 "근거 있는 항목"으로 렌더한다. 권위 상승(약속/관계 확립)은 role=user 메시지 span만 허용, 취소는 검증된 span이면 허용. wire에는 LLM gloss 대신 검증된 인용과 role 라벨만 노출. 근거 없는 legacy 항목은 삭제하지 않고 "미검증 레거시"로 강등. 새 모델 호출 0.

**이 MVP가 풀지 못하는 것 (명시)**:
1. 에피소드 CHARACTER_CLAIM/CURRENT_SCENE 라벨 정직성 (M2 5/6 누수) — 서버가 증명할 수 없음.
2. 요약 prose의 거짓 서사 — 별도 근거 구조 필요.
3. 제안 vs 수락, 어느 약속의 취소인가 — 의미 판정, 인용 나란히 노출까지만.
4. 유효한 OOC 설정 선언의 정본 보존 (현재 에피소드 insert 0).
5. 감정/관계 연속성이 OLD 대비 좋아지는지 — 전체 기억 개선은 증명되지 않음.

이 MVP는 **새 필드(`evidence`)가 필요하므로 구현하지 않고 범위만 보고한다.** GPT 재검수에서 승인되면 그때 범위를 한 PR로 제한한다.

## Stage B 대안 (요약 prose 경로, 2~3개)

| 대안 | 품질 | 비용 | 롤백 | 증거 상태 |
|---|---|---|---|---|
| B1. 현 상태 유지 + MVP-A만 | prose 노출은 그대로 | 변화 없음 | 즉시 | 확인됨 (현재 wire) |
| B2. prose off + rows+anchors (S2 선택, 단일 episodic 블록) | 어휘 41/49 vs 43/49, 거짓 인용은 라벨로 남음, 감정 서사 압축 사라짐 | +26% tokens, 호출 0 | feature flag | 어휘 프록시만, 감정 **UNMEASURED** |
| B3. prose는 유지하되 `Absolute Facts` 서문 밖(서사 맥락 블록)으로 이동, 인용 anchors를 사실 블록에 | 정상 회상 유지 가능성, 단 서문 문구 변경은 별도 GPT 검수 필요 | 호출 0, 토큰 +10~25% | flag | **UNMEASURED** (모델 행동 측정에 Provider 필요) |

어느 안도 현재 증거로는 "정상 회상 유지 + 거짓 차단"을 입증하지 못했다.

## §8 삭제/통합 후보 분류 (자동 삭제 없음)

| 후보 | 분류 | 근거 |
|---|---|---|
| 요약 lexical guard | **KEEP** | prose 경로에 대한 유일한 현행 방어. Stage B 증명 전 제거 금지 |
| 중복 persona parser (`resolveSummaryUserName` vs `resolvePersonaName`) | **REWRITE (FOLLOW-UP)** | 동일 책임이 두 곳. 병합은 별도 소형 PR. 이번 MVP와 무관 |
| 에피소드/앵커 중복 주입 | **해당 없음 (미배포)** | 앵커는 아직 production 경로에 없음. 설계 규칙: 단일 episodic 블록 + dedupe(role,message_id,quote) |
| 독립 ledger 검증 owner | **REWRITE (재사용)** | 새 verifier를 만들지 말고 `memory-episodic-evidence.ts` 의 role 도출을 ledger가 재사용 |
| `mentionsUser` 어휘 검사 | **KEEP / FOLLOW-UP** | "네가/널" 미포함은 한계지만 삭제 근거 없음 |

## 독립 결함 (이번 범위 아님, FOLLOW-UP)

1. sealed 요약 행에서 user-edit이 wire에 안 나옴 (`userEditShadow`).
2. fork ledger 부분 문자열 손실 및 `evidence.message_id` 미재매핑.
3. `promises` 15개 초과 시 새 약속이 버려짐.
4. ledger 취소 정확 문자열 매칭, 삭제 롤백 legacy 휴리스틱.
5. 유효 OOC 설정 선언의 보존 경로 부재.

## UNMEASURED / 불가

- 실제 extractor의 라벨 정직도 분포 (Provider 필요).
- 감정/관계 보존의 GPT 판정, OLD 대비 비교.
- 라벨링이 합법적 NPC 사건에 미치는 서사 영향.
- Production 데이터 분포(읽기 전용 접근도 하지 않음).

## 결론

- **GLOBAL MEMORY IMPROVEMENT UNPROVEN.**
- 단일 정본 owner 최소 수직 경로: 에피소드 owner(`memory-episodic-evidence.ts`)가 role-derived 권위의 정본이며, ledger를 같은 owner에 묶는 MVP-A가 유일하게 결정적으로 설계 가능하다. 단 새 필드 범위이므로 STOP.
- 의미 판정(사용자 행동/NPC 현재 사건/캐릭터 주장, 제안/수락, 취소 대상)은 서버가 결정적으로 할 수 없다. 별도 verifier LLM·regex 누적·병렬 DB 없이는 해결 불가 → 해당 부분은 STOP.
- 구현·병합 없음. GPT 재검수 대기.
