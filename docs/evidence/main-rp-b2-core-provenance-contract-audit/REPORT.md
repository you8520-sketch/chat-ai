# Main RP B-2: 연구 기반 provenance 계약 가능성 감사 (STOP 보고)

Evidence only. 제품 코드 변경 없음, 새 PR 없음, 유료 호출 0, 새 LLM 호출 0, DB 쓰기 0(격리 테스트 DB만), 병합 없음. #1591·#1571 본문은 수정하지 않았다.

- main: `3b553c6c` (fetch 시점 최신). `96a12cc6`(#1604) 이후 변경은 official 설정과 TRPG 파일뿐이다.
- #1591: `1389e04f` (Draft, base `14bf76ec`, main 미병합 상태 그대로).
- 오너 파일 재확인: `14bf76ec..origin/main`에서 `sharedHistoryEvidence.ts`, `memory-summary-integrity.ts`, `memory-source-authority.ts`, `memory-rolling-summary.ts`, `contextBuilder.ts`, `chatMemory.ts`는 변경 없음. 변경은 `memory-episodic-evidence.ts`(+19, #1599 포크 근거 id)와 `memory-summary-scope.ts`(+19, #1604)뿐이다. 이전 B-2 조사(`main-rp-b2-core-source-authority`)의 결론은 현재 main에서도 유효하다.
- 이번에 새로 실행한 것: (1) 현재 main과 `1389e04f`에서 #1591의 20개 seal-stall 테스트, (2) 같은 두 체크아웃에서 104건 false-past 프로브와 실제 Luna 16구간 가드 판정. 전부 격리 DB, provider 호출 없음.

## 1. 연구 원리와 하브 현재 구조의 대응 (논문 원문 확인)

arXiv 초록 원문을 직접 읽었다.

| 연구 | 실제 내용 | 하브에 이미 있는 것 | 하브에 없는 것 |
|---|---|---|---|
| CogMem 2610.11314 | PEC²F 그래프. Claim 노드가 주관적 진술의 출처(source)와 대상(target)을 보존. 턴을 provenance 인식 그래프 레코드로 증분 변환. 검색은 LLM 의도 파싱 + 규칙 기반 그래프 연산자 4종. LoCoMo·LongMemEval 평가 | episodic 추출의 `CHARACTER_CLAIM` / `USER_EXPLICIT` / `CURRENT_SCENE` 권위와 wire 라벨 3종(이전 조사에서 실행 확인) | 요약 prose 단위의 Claim 타이핑. 그래프 저장소. 쓰기 단계의 LLM 구조화 추출 |
| EPGM 2609.25913 | 코딩 에이전트 실행 trace(도구 인자·출력)를 source-aligned provenance unit으로 만들고, 토큰 예산 안에서 증거 완결성(Full Support@2048)으로 검색 평가. R-GCN으로 dense 점수 보정 | 80턴 `current-memory` 1,197자 / episodic 761자로 10,000자 한도 내(이전 조사 측정) | 대화 RP용 provenance unit. 검색 재순위 모델 |

정리하면 두 논문 모두 "출처가 붙은 단위를 만들어 두고 검색 시 연결"하는 방법이다. 둘 다 텍스트가 사실인지(entailment)를 판정하는 방법이 아니다. CogMem의 Claim은 "누가 말했다"라는 귀속이고, 하브는 episodic 경로에서 이미 이 귀속을 갖고 있다. 하브에 비어 있는 곳은 요약 prose다. 논문 방식으로 그 자리를 채우려면 쓰기 단계에서 Luna가 구조화된 Claim/Event를 출력해야 하며, 이는 새 출력 스키마와 파서가 필요하다(아래 S2).

## 2. 실제 실행 경로 재확인과 6개 사건

`messages` → Luna 5턴 요약 → `isRollingSummaryGroundedInDialogue`(공유 이력 단서 + 구간 커버리지 + 희박 요약 앵커) → `persistValidatedSummaryBatch` 봉인 → `chat_turn_summaries` + `scope_payload` → `buildMemoryContextForChat` → `buildContext` `current-memory`. episodic은 별도 경로(`evaluateEpisodicFactEvidence`, `metadata.evidence`).

원문 근거: 실제 Luna 16구간(`#1591 rolling-summary-seal-stall.real-luna.json`), 페르소나 `이름/호칭: 렌`. 구간별 판정: `data/real-luna-16-windows-guards-*.json`.

| # | 사건 | 원문(턴) | 실제 Luna 요약 | main `3b553c6c` | #1591 `1389e04f` |
|---|---|---|---|---|---|
| 1 | 검 손질 약속 후 취소 | 2턴 유저 "내일까지 검을 갈아다 줄게. 약속이야." / 15턴 유저 "그 약속은 취소할게. 검은 내가 직접 갈게." | 구간 1, 11 모두 요약에 있음(약속, 취소 각각) | 구간 1 grounded=false(거절, 3회 재시도 후 빈 봉인). 구간 11은 통과하나 구간 1에서 frontier가 멈춤 | 둘 다 봉인, wire에 남음 |
| 2 | 연인 제안과 수락 | 10턴 유저 "좋아, 우리 오늘부터 연인하자." / 캐릭터 "놀란 얼굴로 한참 말이 없다가 손을 맞잡았다." | 구간 6: "…연인 관계를 시작하기로 함." | 통과(구간 6) | 통과 |
| 3 | 유저의 실제 이별 통보 | 40턴 유저 "미안, 우리 그만 헤어지자." | 구간 36 요약에 있음 | grounded=false, authority=UNSUPPORTED(정상 사건 거절) | grounded=true, CURRENT_SCENE |
| 4 | 캐릭터가 주장한 근거 없는 누나 친분 | 24턴 캐릭터 "누나가 시장에서 널 알아봤대. 예전부터 알던 사이라더라." | 구간 21: "라이크는 …예전부터 아는 사이라고 말했다." (귀속됨) | grounded=false, UNSUPPORTED(귀속된 주장을 거절) | grounded=true, `CHARACTER_CLAIM` |
| 5 | 원문에 없는 스승·연인 | 해당 원문 없음(적대 합성 20개 변형) | 합성 문장 | §3 표 | §3 표 |
| 6 | 정상 감정(1턴 시선 회피)과 NPC 서린(20턴 목례) | 1턴, 20턴 | 구간 1, 16에 있음 | 구간 16 통과, 구간 1은 사건 1과 같은 이유로 거절 | 둘 다 봉인 |

16구간 중 main에서 거절되는 것은 1, 21, 36 세 개다(전부 persona 포함 시). 구간 1은 정상 유저 약속, 구간 21은 귀속된 캐릭터 주장, 구간 36은 정상 이별 통보다. 거절 이유는 같은 지점(절 맨 앞 `이후` 단서와 구간 커버리지 규칙)이며, 구간 1에서 frontier가 멈추므로 나머지 15구간이 봉인되지 않는다(`data/seal-stall-tests-main-3b553c6c.txt`: 20개 중 17 실패, #1591에서는 20/20 통과).

사건 2는 원문에 "손을 맞잡았다"만 있고 명시적 수락 발화는 없다. Luna 요약의 "시작하기로 함"은 해석이다. 현재 어떤 가드도 이 문장을 검사하지 않고 main과 #1591 모두 통과한다. 즉 요약 prose에는 이미 "상호 수락" 같은 해석이 확정 서술로 들어오며, 이는 `이후` 문제와 무관한 별도 노출이다.

## 3. 핵심 측정: 현재 가드는 진위 판별기가 아니다 (104건 재실행)

13 케이스 x 8 변형(4구간 x short/long), persona 포함. 수치는 `isRollingSummaryGroundedInDialogue`가 거절(grounded=false)한 개수다. `data/false-past-matrix-by-case.json`, 원본 행은 `data/false-past-probe-*.json`.

| 분류 | long(80자 이상) n | main 거절 | #1591 거절 | short(80자 미만) n | main 거절 | #1591 거절 |
|---|---|---|---|---|---|---|
| 날조, 단서 없음 (이후·역사 단서 모두 없음) | 8 | **0** | **0** | 8 | **0** | 8 |
| 날조, 절 맨 앞 `이후`만 | 16 | 16 | **0** | 16 | 12 | 16 |
| 날조, 명시적 과거 단서(예전부터, 그날 이후 등) | 16 | 16 | 16 | 16 | 16 | 16 |
| 날조, persona 이름 없음 | 4 | 4 | 0 | 4 | 0 | 4 |
| 정상, 유저 약속 | 4 | 4 | 0 | 4 | 4 | 2 |
| 정상, 구간 내 순서 서술 | 4 | 4 | 0 | 4 | 0 | 4 |

읽는 법:
- 단서 없는 날조는 main에서 long 8/8, short 8/8 모두 통과한다. main의 날조 방어는 단서가 있는 문장에만 작동했다.
- 정상 사건(유저 약속, 구간 내 순서)은 main에서 long 8/8 거절이다. 같은 단서 규칙이 정상과 날조를 구분하지 못한 결과다.
- #1591은 위 `이후`-only 날조 long 16건을 통과시킨다. 이것이 이미 확인된 직접 회귀다. 동시에 정상 long 8건과 실제 Luna 구간 1·36을 통과시킨다. short 변형은 #1591의 희박 요약 앵커 규칙 때문에 날조·정상 모두 대부분 거절된다.
- 즉 사용 가능한 비-LLM 신호(단서, 커버리지, 앵커)는 모두 거짓 수락과 거짓 거절 사이에서 교환될 뿐이고, 어느 설정에서도 "날조 전부 거절 + 정상 전부 수락"이 되지 않는다. 이전 조사에서 커버리지 규칙이 정상 절 3개 중 2개를 거절한다는 것도 확인했다(`false-past-coverage-probe.txt`).

## 4. STOP 판단

티켓 STOP 조건 중 해당하는 것:
- 문장 단위 진위를 기존 메시지 근거만으로 세울 수 없다. 구간 요약의 출처는 구간 단위(`source_start/end_user_message_id`, `assistant_message_id`)뿐이다. `ScopePayloadV1.sourceMessageIds`는 타입 선언만 있고 쓰는 코드가 없다(포크에서 id를 리맵할 때만 읽는다).
- 안전한 의미 판정에는 새 출력 스키마나 새 LLM 호출이 필요하다. 인용 존재와 역할 검증은 "그 말이 있었다"만 증명한다. 날조 `fact_text` + 실제 인용 행이 accepted되는 것을 이전 조사에서 실행으로 확인했다(`CURRENT_SCENE`, msg 47).
- 옛 가드는 날조를 막은 적이 없고, 정상 사건과 귀속 주장을 거절하며 봉인을 멈추게 했다. 이를 고치려면 단어별 예외, 토큰 겹침, 일괄 승인 중 하나가 필요한데 전부 금지 항목이다.

그래서 코드를 쓰지 않았다. 추측성 단서 예외, 토큰 임계값, 전체 요약 승인·강등, 별도 verifier는 만들지 않았다.

## 5. 최소 구조 변경 후보와 손익 (미구현, 선택 대기)

공통 사실: 무엇을 고르든 인용·역할은 "누가 말했는가"만 보장한다. "약속이 성립했다", "수락했다", "과거에 스승이었다"의 진위는 보장하지 못한다.

S1. 가드 걸린 구간만 "미검증 요약"으로 봉인하고 라벨 분리
- 내용: 3회 재시도 후 grounding 가드로 실패한 구간만, 마지막 후보를 `scope_payload`의 선택 필드(JSON, DB 마이그레이션 없음)로 `unverified` 표시하여 봉인하고 frontier를 전진시킨다. 렌더러는 해당 prose를 기정사실 래퍼 밖(미검증 요약)에 둔다. 장부·episodic·관계 메타에는 넣지 않는다. 사용자 편집은 표시를 해제한다.
- 얻는 것: 정상 구간 1·36과 귀속 주장 21도 정지 없이 이어지고, 단서가 있는 날조는 기정사실이 아니라 미검증으로 표시된다. 출력 자르기·패딩 없음. 호출 수 변화 없음.
- 잃는 것/위험: 단서 없는 날조(위 표 8/8)는 지금처럼 기정사실로 남는다. 가드가 걸린 구간의 prose는 여전히 AI에 보인다. 렌더러, Global 압축(Luna가 섞인 prose를 요약), 지문(fingerprint), Medium, 포크, regen, 편집 등 여러 소비자를 같이 바꿔야 한다. B3/K2 실험에서 라벨 변경은 모델별로 혼합 결과였고 DeepSeek 출력 길이가 줄었다(이전 GPT 판정). 이번 조사에서는 RP를 실행하지 않았다.
- 비용: 토큰 증가는 라벨 문구 수십 자 수준으로 추정(미측정). 10,000자 한도는 별도 확인 필요. RP 비교를 하려면 추가 유료 호출이 필요하며 별도 승인 대상이다.

S2. Luna 요약 출력에 구조화 Claim/Event 추가 (CogMem-lite)
- 내용: 같은 Luna 호출에서 `{recap, items:[{actor, kind: event|claim, quote, role}]}` 형태를 받아 `evaluateEpisodicFactEvidence`로 인용 존재·역할만 검증하고 `scope_payload`에 문장 단위 출처를 저장한다.
- 얻는 것: 문장 단위 귀속(누가 말했나)이 요약에도 생긴다. 논문 원리에 가장 가깝다.
- 잃는 것/위험: Luna 프롬프트·출력 파서·재시도 경로 변경. 출력 토큰 증가(미측정). 기존 행은 타입 없음. 부분 인용이 맥락(장소, 시간)을 빼는 문제를 K2에서 이미 봤다. 진위는 여전히 미보장.

S3. 약속 장부에 출처 필드 (이전 조사의 옵션 A)
- 약속 한 종류에만 해당. 요약 prose의 날조 문제는 해결하지 않는다.

S4. 별도 LLM 판정기
- 새 유료 판정 시스템이므로 이번 티켓에서 금지.

S0. 현재 상태 유지
- #1591 미병합: persona가 있는 채팅에서 구간 1이 막히면 이후 구간이 봉인되지 않는다(위 실제 16구간 기준 15개 미봉인). #1591의 `3084f4ef`(80자 하한 + 희박 앵커, GPT 검토 완료)와 `1389e04f`(`이후` 단서 완화)는 커밋이 분리되어 있다. 앞의 것만으로 persona 이름이 없는 경우의 정체는 해소되지만 persona 문자열이 `이름/호칭: 렌`인 실제 형태에서는 구간 1·21·36에서 막힌다(`persona-seal-stall-BEFORE-3084f4ef.log`).

## 6. 질문 / 필요한 결정

1. S1을 한 번 검증해 볼지(가드 걸린 구간만 미검증 라벨, 장부·episodic 미반영, 편집 시 해제). 승인되면 먼저 결정적 테스트(날조 구간이 기정사실 래퍼에 안 들어감, 정상 구간 보존, T30/T50/T80 wire, fork/regen/edit/Global 압축)를 만들고, 그 뒤 RP 원문 비교는 1,000원 미만 범위에서 별도 보고하겠다.
2. S2는 Luna 출력 스키마 변경이라 별도 승인과 비용 측정이 선행되어야 한다.
3. 어느 쪽이든 단서 없는 날조(표 8/8 통과)는 남는다. 이를 막으려면 S4가 필요하며 현재 금지다.

Cursor는 RP 품질 점수를 매기지 않는다. 판단은 GPT 몫이다.

## 파일

- `data/false-past-probe-main-3b553c6c.json`, `data/false-past-probe-1591-1389e04f.json`: 104건 행 데이터(요약 문장, grounded, authority, 보조 판정).
- `data/false-past-matrix-by-case.json`: 케이스별 집계.
- `data/real-luna-16-windows-guards-main-3b553c6c.json`, `data/real-luna-16-windows-guards-1591-1389e04f.json`: 실제 Luna 16구간 판정.
- `data/seal-stall-tests-main-3b553c6c.txt`, `data/seal-stall-tests-1591-1389e04f.txt`: #1591 seal-stall 테스트 결과.
- `data/false-past-cases.json`: 104건 입력. `probes/false-past-probe.ts.txt`: 프로브(`#1591`의 fixture와 `/tmp/probe/cases.json` 경로 가정).
