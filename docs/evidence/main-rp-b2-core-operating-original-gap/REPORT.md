# Main RP — 운영 장기기억 실패 원문 확보 (READ-ONLY, STOP)

Docs only. `src/` 변경 없음. Provider 호출 0. 운영 DB 쓰기 0. 제품 패치 없음. 구현 Draft 없음. #1591 미변경.

판정: **이 환경에는 배포 사이트의 등록 캐릭터와 관리자 페르소나로 된 30/50/80턴 운영 길이 Main RP 원문이 없다. 최초 손상 지점은 그 원문 없이 확정하지 않는다. 새 합성 테스트로 대체하지 않는다.**

## 최초 사용자 목표와 완료 조건

목표: 하브 Main RP가 30/50/80턴 이상에서 실제 사건, 유효한 약속, 취소, 관계, 감정, NPC, 시간 순서를 기억하고 평균 한글 2,700~3,500자(목표 3,200자 이상, 인위적 상한 없음)의 자연스러운 한국어 RP를 이어가게 한다.

이번 작업의 완료 조건은 코드가 아니다. 이미 저장된 운영 테스트 대화에서 정상 사건이 사라지거나 허위 과거가 사실이 된 장면 하나를 고르고, 그 장면의 원문·저장 기억·최종 wire·실제 RP를 같은 사건으로 비교해 최초 손상 owner를 확정하는 것이다. 그 원문이 없으면 확보 장애만 보고하고 멈춘다.

## 확인된 SHA

시작 시 `git fetch origin main` 뒤의 origin/main은 `69ed6acce8983f20a4a7e4c82cdd251a4e5e5328`이다. 티켓이 적은 `034b9521`의 후손이고, 그 사이 커밋은 `#1622` 한 개(`revert(main-rp): restore common DeepSeek terminal dialogue axis line`)다.

기억 owner 파일은 `ac67801c`, `65119ae9`, `034b9521`, 이 main이 같다. `src/lib/memory`, `src/lib/episodicMemoryFacts.ts`, `src/lib/hybridMemory.ts`, `src/lib/deepseekPromptStructure.ts`, `src/services/contextBuilder.ts`의 diff는 비어 있다.

#1571은 이 기록을 올리기 전 `e08e5e65`다. #1591은 `1389e04f`이고 병합하지 않는다.

## BEFORE — 이 환경에서 읽은 것

운영 Turso URL과 토큰은 process env와 `.env.local` 모두 없다. 로컬 `data/app.db`는 Cloud VM 스냅샷의 개발 DB다. 배포 사이트 DB가 아니다.

로컬 DB 메타데이터만 봤다. 다른 일반 사용자의 채팅 본문은 열지 않았다.

| 항목 | 값 |
|---|---|
| users | 150 |
| is_admin=1 | 3. `demo@playai.local`, `admin-off@example.com`, `admin-on@example.com` |
| 그 관리자 계정의 chats | 0 |
| 그 관리자 계정의 personas | 0 |
| 전체 chats / messages | 84 / 289 |
| 채팅이 있는 user | 14. 전원 `@test.local` CI 계정 |
| 채팅당 message 수 | 최대 1 |
| 운영 로스터 라이크/플러드/솔/권태현/로코/강이현/이혁/에녹 | 0행. id 10·11·13–18도 없음 |
| official=1 | 3. `SFW공개` / `NSFW공개` / `NSFW재사용`. 운영 로스터가 아님 |
| chat_turn_summaries | 0 |
| episodic_memory_facts | 2행. 본문은 읽지 않음 |
| TURSO_DATABASE_URL / TURSO_AUTH_TOKEN | UNSET |
| 유료 runner 원문 저장소 | 운영자 로컬 파일. 이 VM에 디렉터리가 없음 |

기존 #1571 증거는 재사용했다. 전부 같은 초단문 80턴 장작 fixture이거나, 그 fixture에서 한 턴만 생성한 RP다.

| 증거 | 원문이 무엇인가 | 운영 등록 캐릭터 | 관리자 페르소나 | 턴당 2,700–3,500자 대화 | 30/50/80턴 연속 대화 |
|---|---|---|---|---|---|
| G7 `authority-split-live` | 합성 라이크·렌. Luna 16구간 + 40회 Main RP 생성 | 아니오. 보고가 "미사용"으로 적음 | 아니오 | 생성 출력만 일부 해당. 히스토리 RAW는 한 줄 | 합성 80턴. 장작·잡담 |
| Gate 2 `dump-cur-real-luna.json` | 같은 fixture의 봉인 dump | 아니오 | 아니오 | 80턴 원문 합 2,921자 | 합성 |
| 장면 복원 / 상태 누적 | 같은 fixture | 아니오 | 아니오 | 아니오 | 합성 |
| S1 / S2-lite / 독립 Gemini | 같은 fixture의 요약 절 | 아니오 | 아니오 | 아니오 | 합성 |
| 이 VM `app.db` | CI 1메시지 채팅 | 아니오 | 관리자 채팅 0 | 아니오 | 아니오 |

G7 CURRENT S4 DeepSeek wire는 메시지가 10개다. RAW는 `오늘의 잡담 77`–`80`과 `라이크는 N번째 장작을 쌓았다.`뿐이다. 그 네 줄 assistant 합은 72자다. `[현재기억]`에는 패딩된 16구간 산문이 들어가고, 그중 6–10은 "연인 관계를 시작하기로 함"이다. episodic 8행은 T40 이별과 T1 아마추어·입술, 그리고 T63–T75 장작이다. T2 약속과 T15 취소 행은 없다. legacy ledger의 "평생" 약속은 이 fixture에 주입된 장치다. 이 wire는 운영 30/50/80턴 대화가 아니다.

## PROBLEM — 확보 장애

운영 원문을 이 작업에서 열 수 없는 이유는 아래다. 새 합성을 만들지 않았다.

1. 배포 DB 읽기 자격 증명이 이 Cloud Agent 환경에 없다. G7이 Railway deployments API로 본 것은 배포 SHA이지 채팅 행이 아니다.
2. 로컬 DB에는 운영 로스터와 관리자 테스트 대화가 없다. 있는 84개 채팅은 `@test.local`의 1메시지 CI 행이다. 그 본문은 수집하지 않았다.
3. 유료 runner의 원문 파일은 운영자 로컬에만 남도록 되어 있고, 이 VM에 없다.
4. #1571에 이미 있는 RP 원문(G7 40회)은 길이만 보면 Gemini/Sol 일부가 2,700–4,600자다. 입력 대화는 한 줄 장작이다. 티켓이 금지한 대체다.

따라서 원문 → 5턴 요약 → 저장 → 압축 → episodic/ledger → 주입 → Main RP 소비를 **운영 대화 한 건**으로 따라갈 수 없다. 정상 기억 손실과 허위 기억 증가를 운영 길이로 같이 실측하지 못했다.

## 고장 단계와 원인 확정 여부

운영 대화 기준 최초 손상 지점: **미확정**.

기존 owner는 최신 main에서 재확인했고, `ac67801c` 이후 기억 파일은 같다. 이것은 경로의 이름이지, 운영 원문에서 무엇이 먼저 깨졌는지의 증거가 아니다.

| 책임 | live owner (origin/main `69ed6acc`) |
|---|---|
| RAW와 화자 | `messages`. 주입 상한 `resolveProviderRawTrimFloorExchanges` (RAW4, 지연 경계만 5) |
| 5턴 기억 생성 | `summarizeTurnBatch` → `processRollingSummaryBatch` |
| 이전 사건과 새 사건의 연결 | 없음. 봉인은 이번 구간만 본다 |
| 서사 요약 저장 | `chat_turn_summaries` |
| 사건 상태 저장·변경 | 확정 상태 기계 없음. episodic `fact_text`는 검색용 |
| 현재 기억 주입 | `rebuildLorebookFromRecords` → `[현재기억]`. DeepSeek만 `wrapDeepSeekLongTermMemory` |
| episodic 검색·주입 | `getEpisodicMemoryForPrompt` / `formatEpisodicMemoryPromptSection` |
| Global/Medium 압축 | `compactCurrentMemory` |
| 최종 조립 | `contextBuilder.ts` |
| Fork/Regen/Delete/Edit | `rebindForkEvidenceMetadata`, `resolveSummaryRowScopes` (`user_edited=1` 우선) |

합성 fixture에서 이미 측정된 손상은 참고로만 적는다. 운영 장면의 최초 손상으로 채택하지 않는다.

- 허위 연인 성립 문장 "연인 관계를 시작하기로 함"과 공동 장작은 Luna 산문 생성 시점에 처음 나타난다. owner는 `summarizeTurnBatch`다. 원문 T10은 제안과 손 맞잡음이다.
- 그 산문은 `[현재기억]`에 항상 들어가고, DeepSeek에서는 절대사실 래퍼로 감싸진다. G7 DeepSeek CURRENT는 주입된 가짜 평생 약속을 3/3 사실처럼 말했다.
- T15 취소는 원문에 있으나 이 fixture의 episodic 행에 없고, S4 질의의 기존 어휘 점수는 취소 구간을 고르지 못한다.
- 2회 `compactCurrentMemory`는 아마추어와 이별을 산문에서 지운다. 원문 메시지는 남아 있다.
- 보통 턴은 점수 2 이상 장면을 고르지 못한다.

이 목록은 장작 fixture의 경로다. 운영 3,200자 턴이 10,000자 Current Memory와 10,000토큰 history를 어떻게 깨는지는, 그 길이의 대화가 없어서 확인하지 못했다.

## AFTER

제품 변경 없음.

## REMOVED

없음.

## PRESERVED

5턴 봉인, grounding, `[현재기억]`, DeepSeek 절대사실 래퍼, episodic 인용, RAW4/RAW5, 유저 편집 우선, 출력 길이·요금·모델 라우팅. #1591은 그대로다. 다른 사용자의 채팅 본문은 이 기록에 없다.

## 가장 직접적인 수정 후보 하나

코드가 아니다. **배포 사이트의 관리자 계정 + 운영 등록 캐릭터(예: 라이크 id=18)로 이미 저장된 30/50/80턴 이상 테스트 대화 한 건을 READ-ONLY로 내보내는 것**이다. 필요한 행은 `messages`, `chat_turn_summaries`, `episodic_memory_facts`, 해당 채팅의 ledger/relationship memo, 그리고 그 다음 턴의 실제 Main RP 요청 wire와 생성 원문이다. 일반 사용자 채팅은 넣지 않는다.

그 한 건이 오기 전에는 `summarizeTurnBatch`를 고치거나 기억 아키텍처를 교체하는 패치를 시작하지 않는다. 기존 구조를 지켜야 한다고 가정하지 않는다. 확인되지 않은 원인을 추측해 패치하지도 않는다.

## REGRESSION RISKS / 검증 방법

이번 턴에 제품 변경이 없으므로 회귀는 없다.

원문이 확보된 뒤의 검증은 이 한 장면으로 충분하다.

1. 원문에서 사건 한 개를 고른다. 예: 약속 후 취소, 제안 후 미수락, NPC 등장, 유저가 고친 기억.
2. 같은 사건의 저장 요약, episodic 행, 압축 전후 산문, 최종 wire, 그 다음 RP 본문을 나란히 둔다.
3. 원문에는 있는데 저장에서 처음 사라지는 지점, 또는 원문에는 없는데 저장에서 처음 생기는 지점을 최초 손상으로 적는다.
4. 그 owner 하나만 고칠 후보로 남긴다. 정상 감정·NPC가 같이 사라지면 그 후보는 버린다.

## PROOF

- origin/main `69ed6acc`. 기억 owner diff vs `ac67801c` / `034b9521` 공집합.
- 로컬 관리자 chats=0, 운영 로스터 캐릭터 0행, Turso unset. 채팅 있는 14 계정은 `@test.local`, 채팅당 메시지 최대 1.
- G7 S4 CURRENT DeepSeek wire: 메시지 10, RAW assistant 4줄 합 72자, `[현재기억]`에 6–10 "연인 관계를 시작하기로 함". 운영 대화가 아님.
- 신규 Provider 호출 0. 운영 DB 쓰기 0. `src/` diff 없음.

GPT 검수 후 STOP.
