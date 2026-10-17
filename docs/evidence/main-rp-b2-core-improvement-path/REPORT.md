# Main RP B-2 Core — 장기기억 근본 개선 경로 (READ-ONLY, STOP)

Docs only. `src/` 변경 없음. Provider POST 없음. Production DB write 없음. 제품 패치·병합·배포 없음. 새 DB·새 runner·병렬 기억 저장소·정규식 추가 없음. S1, S2-lite, B3/K2, G7, 독립 Gemini 검증을 다시 돌리지 않았다. #1591은 수정하지 않는다. Cursor는 RP 품질 점수를 매기지 않는다.

판정: **기존 owner 안에서 일곱 조건을 동시에 만족하는 최소 변경은 특정되지 않는다. 구현 Draft는 열지 않는다.**

## BEFORE

최신 main `ac67801c5a3c0c2e25a8e5ae69dc68ba5a60add2` (`fix(trpg): 채택 불가 장면 재생성은 실패하고 과금하지 않음 (#1615)`). #1571 Draft `bf14123a`. #1591 Draft `1389e04f`는 병합하지 않음. #1614는 이미 main에 있다. 봉인·주입·압축·RAW floor 파일은 `14bf76ec` 이후 main에서 바뀌지 않았다 (`memory-rolling-summary.ts`, `memory-summary-integrity.ts`, `memory-source-authority.ts`, `memory-injector.ts`, `memory-constants.ts`, `hybridMemory.ts`, `deepseekPromptStructure.ts`, `sharedHistoryEvidence.ts`). main에 추가된 episodic·fork·user-edit는 요약 사실 채널의 대체 owner가 아니다.

소비 경로:

| 단계 | live owner | 하는 일 | 하지 않는 일 |
|---|---|---|---|
| RAW | `messages` | role과 본문 보존 | 페르소나 이름을 대사에 써 넣지 않음. 봉인 입력은 `유저:` / `{charName}:` (`memory-rolling-summary.ts`) |
| 5턴 frontier | `processRollingSummaryBatch` → `highestContiguousCompletedTurn` | 연속 완료 턴 다음 5턴만 시도. 실패하면 `false` | 실패한 구간을 건너뛰지 않음. RAW floor는 backlog와 함께 늘지 않음 (`resolveProviderRawTrimFloorExchanges`: RAW4, 지연 경계만 RAW5) |
| 요약 문장 | `summarizeTurnBatch` (Luna) → `validateSummaryNarrative` (main_canon 80자, 짧은 글은 패딩하지 않음) → `isRollingSummaryGroundedInDialogue` | 통과한 산문만 `chat_turn_summaries`에 저장 | 사건 성립·취소·관계 상태를 계산하지 않음 |
| 화자 연결 | `resolvePersonaName` (`이름/호칭:`) + `mentionsUser` | 가드가 요약에 페르소나 이름이 있는지 봄 | 요약 문장이나 판정 입력의 `유저:`를 그 이름으로 바꾸지 않음 |
| 사건·관계 판단 | 없음. 가드는 `looksLikePriorSharedUserHistory` 단어 단서 | 단서가 있고 유저 근거가 없으면 거절 | 단서 없는 스승·연인, 구간 6의 "관계 시작", 공동 행위자 문장은 통과 |
| 확정 사실로 사용 | `memory-injector.ts`가 `[현재기억]`으로 붙임. DeepSeek만 `wrapDeepSeekLongTermMemory`가 `LTM_ABSOLUTE_FACTS_RULE`로 감쌈 | 통과한 산문 전체가 그 블록에 들어감 | Gemini/Sol wire에는 그 절대사실 문장이 없음 |
| Global/Medium 압축 | `compactCurrentMemory` | 10,000자 초과 시 턴 표시 없는 `" → "` 3인칭으로 다시 씀. 프롬프트는 관계·약속·감정을 보존하라고 함 | 화자·메시지 id를 유지하지 않음. 이미 측정된 1회 압축에서 알아본 대상이 렌에서 라이크로 바뀌고, 2회에서 "아마추어"와 이별이 빠짐 |
| 병렬 채널 | episodic (`evaluateEpisodicFactEvidence`), relationship ledger | episodic은 인용 존재와 role. ledger는 문자열 | 요약 공백을 메우지 않음. episodic은 관련도 게이트·1회성 감정 생략. 취소는 정확 문자열 (K2 0/4) |

Real Luna 16구간(캐릭터 라이크, 유저 렌): 80자 이상은 1(121), 6(95), 21(86), 36(83)뿐. 페르소나가 있으면 1·21·36은 grounding 실패, 6은 "연인 관계를 시작하기로 함"인데도 통과. 12구간은 길이 실패. 첫 실패가 frontier를 영구 정체시킨다.

## PROBLEM

목표는 30/50/80턴 RP가 정상 사건, 약속·취소, 관계·감정, NPC, 시간 순서를 더 정확히 기억하는 것이다. 봉인 횟수 자체가 목표가 아니다. 출력 길이 정책(평균 한글 2,700–3,500자, 목표 3,200자 이상, 출력 상한 없음)은 유지한다.

동시에 필요한 조건:

1. 잘못된 요약이 frontier를 영구 정체시키지 않음
2. 허위 과거·연인 확정이 사실로 승격되지 않음
3. 정상 검 약속·취소·이별이 보존됨
4. 페르소나 이름과 RAW 화자 identity가 일치함
5. NPC 행동과 감정·서사 문맥이 사라지지 않음
6. 구간마다 별도 유료 검증기를 두지 않음
7. Fork / Regen / Delete / Edit / Compaction 정합성 유지

이 일곱은 한 채널의 산문을 "사실"로 쓰면서는 동시에 성립하지 않는다. 실패는 페르소나 프롬프트 한 줄 누락이 아니다. 화자 연결과 사건 의미가 서로 다른 실패다.

### 화자 연결

봉인 대사는 `유저:`로 시작한다. 이름 `렌`은 `이름/호칭:`에만 있고, `mentionsUser`가 가드에서만 쓴다. 독립 Gemini 14건(`docs/evidence/main-rp-b2-independent-semantic-check/`)에서 같은 검 약속이 갈렸다.

- luna-w1 문장 "렌은 내일까지 검을 갈아 주겠다고 약속"은 `supported`. 인용은 라이크의 고개 끄덕이고, 판정 이유는 유저가 약속했다는 추론이다.
- promise-w1의 같은 약속은 `absent`. `source_quote`는 "내일까지 검을 갈아다 줄게. 약속이야."라서 사건 자체는 인용 안에 있다. 거절 이유는 원문에 글자 `렌`이 없다는 것이다. 교정문은 화자를 `유저`로 바꾼다.
- luna-w36 "렌이 … 헤어지자"도 `absent`. 인용은 "미안, 우리 그만 헤어지자."
- luna-w21의 장작과 "시장에 다녀왔어."도 같은 이유로 `absent`가 된 뒤 교정문에서 `유저`로 복구된다.

페르소나 줄을 판정 프롬프트에 넣는 실험은 하지 않았다. 그 줄은 이름 리터럴 검사만 바꾼다. 아래 사건 의미는 그대로다.

### 사건 의미

인용이 그 메시지에 있다는 것은 요약의 술어를 함의하지 않는다. S2-lite와 같다.

구간 6 요약 "렌과 라이크는 장작을 차례로 쌓으며"는 `supported`였다. 인용은 "라이크는 6번째 장작을 쌓았다."뿐이고, 유저 대사는 "오늘의 잡담 N"이다. 판정 `why`는 공동 행위자를 다시 말한다. 같은 호출은 "손을 맞잡았다"가 "연인 관계를 시작하기로 함"을 함의하지 않는다고 올바르게 `not_established`를 줬다. 한 모델이 같은 입력에서 관계 확정은 거르고 공동 행위자는 통과시킨다. 인용 존재·단어 단서·한 번의 독립 모델은 장면 감정, 허위 공유 과거, 잘못된 공동 행위자를 안정적으로 나누지 못한다.

단서 없는 "라이크는 렌의 스승", "라이크와 렌은 연인 사이가 됨"은 이 14건에서 `absent`였다. 교정문은 빈 문자열이라 `validateSummaryNarrative`를 통과하지 못하고 frontier가 다시 멈춘다. promise-w11 교정문은 원 요약에 없던 취소와 어깨 으쓱을 넣어 두 번째 요약기가 된다. 살아남은 교정 산문을 저장하면 DeepSeek `[현재기억]`은 그대로 절대사실 래퍼 안에 들어간다.

### G7 40회 RP에서 이미 본 것

`docs/evidence/main-rp-b2-core-authority-split-live/`. 라벨 재배치만. 입력 토큰 +0.4%.

- DeepSeek CURRENT는 가짜 평생 약속을 3/3 수용. CAND 2/3. 헤더 라벨만으로 ledger 신뢰가 내려가지 않음.
- DeepSeek 이별 언급 CURRENT 0/3 (연인 상태로 답함), CAND 2/3. CAND r2는 여전히 "연인이지… 안 바뀌었어".
- Sol CAND S1은 실제 검 약속을 회상하지 않음.
- Gemini CAND는 평생 약속을 부인하면서 "누나는 시장에 가지도 않았어"처럼 원문에 없는 부정을 만듦.
- DeepSeek CAND 출력은 2,700–3,500자 목표보다 짧음. 길이 상한은 넣지 않았다.
- fixture에 열린 유효 약속이 없어, 유효 약속 보존은 증명되지 않음.

라벨을 낮추면 허위 수용이 모델마다 남고, 정상 회상이 빠지거나, 부인 문장 자체가 새 사실이 된다.

### 이미 기각된 구조와의 차이

| 구조 | 이미 확인된 결과 | 이번 조건에서 |
|---|---|---|
| S1 미확인 라벨로 frontier만 전진 | 가드에 걸린 정상 사건을 미확인으로 내림. 산문을 wire에서 빼면 회상이 줄고, 래퍼 안에 남기면 세탁 | 1은 가능. 3·5는 실패 |
| S2-lite / B-1 인용 존재 + role | 인용이 있으면 통과. 술어 진위는 모름 | 구간 6 공동 행위자와 같은 클래스 |
| B3/K2 인용만 | 감정 1/13 수준으로 떨어짐. 취소 정확 문자열 0/4 | 5 실패 |
| #1591 `이후`를 절 앞에서 제거 | xlong에서 허위 과거 28/44. 단서 없는 8건은 main을 포함해 모든 arm 통과 | 2를 더 나쁨. 병합하지 않음 |
| c-ext 축어 앵커 (`architecture-feasibility`) | cap 12가 어휘 41/49 (산문 43/49), 창당 +42%자. STOP A: role+message id+인용은 행위자와 진위를 보증하지 않음. 따옴표 없는 "누나가 시장에서 널 알아봤대."가 장면 원문으로 렌더되어 현재 귀속보다 나쁨. STOP B: 자유 감정 태그 153개 중 19개가 사건을 샘 | 6은 만족(추가 호출 없음). 2와 5를 동시에 만족하지 못함 |
| G7 구역 라벨 | 위 40회 | 모델이 라벨을 존중한다는 가정이 측정에서 깨짐 |
| 구간마다 독립 검증기 | 14건, 약 17원. 허위 과거·미수락 연인은 거름. 정상 약속·이별은 문장에 따라 `absent` | 6 위반. 빈 교정은 봉인 불가 |

유저 role 발화만 떼어 `resolvePersonaName`으로 묶으면 추가 모델 없이 약속·취소·이별·제안의 **발화**와 이름이 남는다. 그것은 "약속이 취소된 상태"나 "연인이다"를 계산하지 않는다. assistant 문장을 빼면 서린의 목례, 시선, 어깨 으쓱이 빠진다. assistant 문장을 사실 채널에 남기면 구간 6류 공동 행위와 캐릭터의 거짓 과거가 승격된다. 한 줄 라벨로 그 사이를 나누는 것은 G7에서 이미 실패했다.

## AFTER

제품 변경 없음. 구현 Draft PR 없음.

안전한 수직 경로가 확정되지 않았다. 아래는 구현 후보가 아니라, GPT가 고를 때 이미 측정된 선택지다.

1. **Frontier만 비주입 span.** 기존 `empty_ooc` / `noncanon`은 `isPromptInjectibleMemoryRecord`가 주입에서 뺀다. 실패 산문을 그 kind로 남기면 정체는 멈춘다. RAW가 잘리면 초기 사건은 기억에 없다. 품질 목표는 그대로다.
2. **유저 발화만 role-bind.** 기존 `messages.id` + `resolvePersonaName`. 새 DB 없음. 검 약속·취소·이별·제안의 문장과 이름 `렌`은 남는다. NPC·감정은 빠진다. "취소됨" "연인 확정"은 만들지 않는다. 80턴 유저 원문을 전부 넣으면 `[현재기억]` 10,000자에 닿는다. `compactCurrentMemory`가 그 인용을 다시 쓰면 행위자 교체가 돌아온다.
3. **산문을 `[현재기억]`에 두고 정체만 해제.** 구간 6의 관계 시작과 공동 행위가 사실로 남는다. #1591의 `이후` 제거는 이 경로를 더 넓힌다.
4. **G7식 라벨.** 측정 끝. DeepSeek 평생 약속 2/3 잔존, Sol의 검 약속 누락, Gemini의 새 부정.
5. **같은 호출의 구조화 요약.** 추가 검증 호출은 없지만 종류는 모델 주장이다. 옛 행에는 구조가 없고, S2-lite와 같은 인용-존재 한계가 남는다. 이번 기본 선택지가 아니다.

데이터 계약은 따라서 **아직 쓸 수 없다.** 나중에 구현을 열 최소 계약은 새 테이블 없이 기존 행 안에서만 가능하다. 그러나 그 계약도 조건 2와 5를 동시에 증명하지 못했다.

- 권위는 메시지의 role에서만 온다. LLM `evidence_type`은 주장이며 증거가 아니다.
- 유저 role span은 페르소나 이름으로 렌더한다. 요약 문장 안의 `렌` 유무로 사건을 지우지 않는다.
- assistant span은 장면 사실로 올리지 않는다. "장면"과 "주장"을 따옴표나 단서로 나누지 않는다.
- 관계 성립·취소 완료·공동 행위는 저장 상태가 아니다. 시간순 발화를 나란히 보여주는 것까지만 서버가 한다.
- 압축은 그 발화를 다시 쓰지 않는다. `compactCurrentMemory`의 입력은 지금처럼 산문만일 때만 동작이 같다.
- Fork는 기존 `memory-fork-snapshot.ts`가 message id를 자식 id로 다시 매핑해야 한다. 지금은 episodic evidence id가 부모 id로 남는 결함이 따로 있다.
- Regen / Delete는 근거 메시지가 사라지면 그 span도 사라진다. 유저 편집 산문(`user_edited`)은 지금처럼 재봉인을 막으며, sealed 행에서 편집 본문이 wire에 안 나오는 기존 결함은 이 설계의 범위 밖이다.

운영 비용: 이 결론을 내는 데 새 호출은 0이다. 선택지 5나 구간 검증기를 다시 켜면 16구간·운영 2,700–3,500자 입력의 비용은 미측정이다. 짧은 fixture 14회 Gemini는 $0.012496, 약 17원, 약 66초였다. 80턴을 그 단가로 16번 부르면 약 20원·약 75초이고, 운영 길이에서는 그보다 커진다. 유저 발화만 남기는 선택지 2는 모델 호출이 늘지 않고 문자 수가 는다.

## REMOVED

없음. 가드, 프롬프트 문장, 저장 kind, #1591을 지우거나 병합하지 않았다.

## PRESERVED

- 봉인 owner, 80자 하한, grounding, `[현재기억]`, DeepSeek 절대사실 래퍼, RAW4/RAW5 floor, compaction 프롬프트.
- Fork / Regen / Delete / Edit / Compaction의 현재 동작.
- 출력 길이 owner (USER_TAIL). 상한을 추가하지 않음.
- #1571의 기존 증거와 #1591 `1389e04f`.

## REGRESSION RISKS

구현을 열면 바로 생기는 손실:

- 실패 산문을 건너뛰면 그 5턴의 감정·NPC가 RAW trim 이후 사라진다.
- 유저 발화만 남기면 서린, 시선, 으쓱, 라이크의 장작 행동이 빠진다. feasibility B는 감정 1/13.
- assistant 인용을 절대사실 래퍼에 넣으면 거짓 주장과 구간 6류 공동 행위가 사실처럼 읽힌다. G7은 라벨이 이를 막지 못했다.
- 빈 교정이나 80자 미만을 봉인 성공으로 치면 `SUMMARY_EMPTY` / `SUMMARY_INVALID`와 충돌하고, 안 치면 frontier가 다시 멈춘다.
- 압축이 인용을 산문으로 다시 쓰면 1회에 행위자가 바뀌고 2회에 이별이 빠진다.
- 앵커를 episodic과 따로 주입하면 T1 아마추어·이별·장작이 중복된다. 단일 블록 dedupe가 아니면 토큰만 늘어난다.

정상 기억 손실을 막는 방법 (구현 전 게이트로만 둔다):

- 유저 role의 약속·취소·이별 문장은 요약 실패와 무관하게 메시지 id로 남긴다. 이름 `렌`은 `resolvePersonaName`으로만 붙인다.
- assistant 문장을 사실로 승격하는 저장을 만들지 않는다. 장면으로 남기려면 G7과 다른 측정이 먼저다.
- `compactCurrentMemory` 입력에 그 발화를 넣지 않는다.
- 빈 요약으로 다음 구간을 막지 않되, 빈 요약을 `[현재기억]`에 쓰지 않는다.

## PROOF

재사용한 증거 (이번 턴에 재호출하지 않음):

- `docs/evidence/main-rp-b2-independent-semantic-check/` — 14건. luna-w1 `supported` vs promise-w1 `absent`. luna-w6 공동 장작 `supported`, 인용은 라이크의 6번째 장작. 관계 시작은 `not_established`. 빈 교정 3건.
- `docs/evidence/main-rp-b2-core-authority-split-live/` — G7 40회.
- `docs/evidence/main-rp-b2-core-architecture-feasibility/` — 압축 행위자 교체, c-ext STOP A/B, 커버리지 43/49 vs 41/49 vs 13/49.
- `docs/evidence/main-rp-b2-core-single-owner-vertical-slice/` — assistant 하위 분류와 행위자는 서버가 판정 불가.
- `docs/evidence/main-rp-b2-core-valid-promise-state/` — 취소 정확 문자열 0/4.
- `docs/evidence/main-rp-b2-s1-isolated-validation/` — 미확인 라벨은 wire에서 빼면 회상이 줄고, 래퍼에 남으면 세탁.

코드 확인 (main `ac67801c`, 제품 diff 없음):

- `processRollingSummaryBatch`는 `composed.ok`가 아니면 `false`.
- `validateSummaryNarrative`의 main_canon 하한은 `ROLLING_SUMMARY_MIN_CHARS` 80.
- 봉인 대사는 `유저:` / `{charName}:`.
- `resolvePersonaName`은 `이름/호칭:`만 읽는다.
- `isPromptInjectibleMemoryRecord`는 `noncanon`과 `empty_ooc`를 주입하지 않는다.
- `compactCurrentMemory`는 `" → "` 재작성.
- `wrapDeepSeekLongTermMemory`만 `LTM_ABSOLUTE_FACTS_RULE`을 붙인다.
- `resolveProviderRawTrimFloorExchanges`는 RAW4, 지연 시 RAW5. backlog와 함께 늘지 않는다.
- `looksLikePriorSharedHistoryClaim`은 main에 없다. #1591에만 있다.

### 코드 전에 통과해야 하는 게이트

결정적 레드→그린. 유료 재실험 없음. 기존 16구간과 14대표 행만 사용한다.

- 구간 1·11·36의 유저 발화(검 약속, 취소, 이별)가 이름 `렌`으로 남는다. 요약 문장에 `렌`이 없다는 이유로 지우지 않는다.
- 구간 6은 "연인 관계를 시작하기로 함"과 "렌과 라이크가 장작을 쌓음"을 사실로 저장하지 않는다. 제안 발화와 라이크의 손·장작 문장은 발화로 남을 수 있다.
- 단서 없는 스승·연인 문장은 절대사실 블록에 들어가지 않는다.
- 서린의 목례, 시선, 어깨 으쓱이 보이되, 객관적 공유 과거로 라벨되지 않는다. 이 항목은 G7과 다른 측정이 없으면 통과로 치지 않는다.
- frontier가 턴 80에 도달한다. 빈 산문이나 실패한 산문이 다음 구간을 막지 않는다.
- 주입되는 기존 행의 Fork / Regen / Delete / Edit / Compaction 테스트가 동작 동일하다.
- 구간당 추가 모델 호출이 없다.
- `[현재기억]`이 10,000자 안에 있고, 압축이 유저 발화의 화자를 바꾸지 않는다.

이 게이트를 기존 자료만으로 통과하는 구조는 없다. 특히 "서린·시선·으쓱이 보이면서 객관적 과거가 되지 않음"은 G7에서 모델 행동이 갈렸다. 그 측정 없이 제품 패치를 시작하지 않는다.

GPT 검수 후 STOP.
