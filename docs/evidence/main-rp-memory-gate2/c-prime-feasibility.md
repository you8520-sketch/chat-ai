# B-2 Core C′ 설계 타당성 확인 (설계 전용, 코드 변경 0)

기준 main: `de266eb88f63ae9b6c4a3ef6d7e93a897250eb5f`

이 문서는 Cursor가 현재 main의 실제 코드 경로를 감사하고 provider 호출 없는 결정론 프로브를 실행한 결과다.
RP 품질 점수는 매기지 않는다. 프로브 원자료: `c-prime-probes/` (`cprime-probe.test.ts`, `cprime-probe-results.json`, `results-table.md`, `probe-run.log`).

## 0. 결론 (먼저)

- **C′를 지금 구현하면 ROOT_CAUSE_FIXED로 분류할 수 없다.** 현재 소스 정보(원문 `[N턴] 유저:/캐릭터:` 텍스트 + 서버 turn→message ID 매핑)로 결정론적으로 확정할 수 있는 것은 "인용문이 원문에 존재하는가 / 어느 role의 메시지인가"까지다. 요약 문장 속 사건·행위자·관계 주장이 원문에 의해 함의되는지는 결정론으로 판정할 수 없다. 라벨만 붙이거나 lane만 나누는 것은 검증이 아니다.
- **더 앞선 선행 결함이 있다 (P0).** live seal 경로에서 요약 가드(`isRollingSummaryGroundedInDialogue`)가 받는 `userPersona`는 `personaDisplayName`(맨 이름 문자열, 예: `"렌"`)인데, 가드의 단일 authority owner(`resolvePersonaName`)는 `이름/호칭: X` 줄 형식만 인식한다. 그 결과 live 경로에서는 유저 관계 날조 가드가 사실상 꺼져 있다. 프로브로 재현됨 (아래 §2).
- STOP 사유: (1) 확정/해석 구분을 기존 소스 정보만으로 결정론 판정 불가, (2) free-text lane은 LLM compaction에서 소거, (3) 사용자 수정 요약과 LLM 요약이 저장/렌더 시점에 구별 불가, (4) 구분을 살리려면 새 필드/별도 검증 호출/신규 owner 중 하나가 필요 -> 승인 전 수정 금지.

## 1. OWNER MAP (현재 main)

| 책임 | 단일 owner | 위치 |
|---|---|---|
| 5턴 요약 프롬프트(보존 항목·`[전환점 대사]`) | `buildRollingSummarySystemPrompt` | `memory-rolling-summary.ts` L76-130 |
| 인식론 정책(원문 근거 규칙) | `ROLLING_SUMMARY_EPISTEMIC_POLICY` | `memory-rolling-summary.ts` L135 |
| 요약 호출/재시도(최대 3회) | `summarizeTurnBatch` | `memory-rolling-summary.ts` L297-388 |
| seal-time 형식 검증 | `validateSummaryNarrative` | `memory-summary-integrity.ts` L377 |
| seal-time 근거 가드(정규식) | `isRollingSummaryGroundedInDialogue` -> `summaryInventsUnsupportedUserRelationship` | `memory-summary-integrity.ts` L329 |
| 출처 권한 분류(USER_EXPLICIT / CHARACTER_CLAIM / CURRENT_SCENE / UNSUPPORTED) | `resolveMemorySourceAuthority` + `sharedHistoryEvidence.ts` | `memory-source-authority.ts` L142 |
| 요약 저장 | `memory-summary-persist.ts` (`chat_turn_summaries`, `summary_kind`, `scope_payload`, `user_edited`) | |
| 사용자 직접 수정 | `updateMemoryRecordById` -> `main_canon` + `user_edited=1` | `memory-turn-summary.ts` L246 |
| Current Memory 조립 | `rebuildLorebookFromRecords` -> `formatMemoryBlock` | `memory-turn-summary.ts` L200 |
| 최종 프롬프트 소비 | `buildMemoryContextForChat` -> `[현재기억]` 헤더 | `memory-manager.ts` L236 |
| 장기 압축(LLM) | `compactCurrentMemory` (단일 서술, 블록/턴 마커 제거) | `memory-rolling-summary.ts` L417 |
| 장기 압축(비LLM 폴백) | `emergencyFallbackTrimLorebookSync` (최신 유지, 오래된 블록 삭제) | `memory-global-projection.ts` L17 |
| 검증된 에피소드 증거(B-1) | `memory-episodic-evidence.ts` (`evidence{role, message_id, quote, authority}`) | 에피소드 fact 전용. 요약 경로 미사용 |

관찰:
- `ScopePayloadV1.sourceMessageIds`는 스키마상 존재하고 fork 복제(`memory-fork-snapshot.ts`)만 읽는다. 일반 seal 경로에는 writer가 없다.
- 요약 원문에는 `[N턴]` 마커만 있고 message ID는 없다. 단 turn -> message ID는 서버에서 결정론적으로 복원 가능하다.
- 렌더 시점에 LLM 요약과 사용자 수정 요약은 동일한 `[a~b턴] 본문` 형식이다 (프로브 `renderedDistinguishable: false`).

## 2. 결정론 프로브 결과 (provider POST 0)

실행: `AB_OUT=... node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test cprime-probe.test.ts` (3 tests pass). 상세 표: `c-prime-probes/results-table.md`.

핵심 사실 (live 경로 = `bare_name_as_passed_by_chat_route`):
- 가짜 평생 약속(F1/F1b), 존재하지 않는 누나 친분(F2/F2c), 화자 반전(F3), 커피 발화에서 날조된 키스(F4)/포옹(F4b)이 모두 `ACCEPTED_AT_SEAL`.
- 파이프라인 프로브(`processRollingSummaryBatch` + 고정 요약기): 날조 요약이 `main_canon`, `user_edited=0`으로 저장되고 `[현재기억]`에 무라벨로 노출됨 (`currentMemoryContains_F1_promise: true`, `currentMemoryContains_F2_sister: true`).
- 정식 형식 persona(`이름/호칭: 렌`)를 주면 F2/F2c(친분 날조)는 차단되지만 F1/F1b(약속), F3(화자 반전), F4/F4b(키스/포옹)는 여전히 통과한다. 즉 persona 입력을 고쳐도 가드는 부분 방어일 뿐이다.
- 정식 persona 하에서 L5(감정 해석 "이후 ... 가능성이 있다")가 `이후` cue 때문에 거절됨. 정규식 cue가 정상 서사 표현을 과차단하는 사례다 (live 경로에서는 가드가 꺼져 있어 통과).
- 정상 케이스(NPC 문 열기 L1, 유저 직접 관계 선언 L2/L3, 정확한 "아마추어 같다" + 입술 깨묾 L4, 캐릭터 개인 과거 L6, 귀속된 CHARACTER_CLAIM F2b)는 모든 persona 변형에서 통과.
- 사용자 직접 수정: 저장 후 `summary_kind=main_canon`, `user_edited=1`이지만 렌더 문자열은 수정 전과 동일 형식이며, 수정 텍스트는 seal 가드 없이 저장된다 (`updateMemoryRecordById`는 길이만 검사).
- 예산: 10K Current Memory는 평균 요약 600/450/350/250자일 때 약 82/109/139/193턴에 도달한다. **이전 보고의 "약 400턴 이후 compaction"은 오류였다. 80~110턴대에서도 compaction이 발생할 수 있다.**
- 비LLM 폴백: 최신 블록을 유지하고 가장 오래된 블록(예: 1~5턴의 "아마추어" 장면)부터 삭제한다 (`oldestBlockSurvives: false`, 첫 생존 블록 `36~40`).

## 3. C′ 3분리 가능성 판정

| 요건 | 기존 owner로 가능한가 | 판정 |
|---|---|---|
| 확정 근거 (role/message ID/quote span) | quote 존재+role+server-assigned ID는 turn 매핑과 B-1 `normalizeEvidenceSpan`/`readVerifiedEvidence` 재사용으로 결정론 확인 가능. 단 요약 프롬프트에서 인용은 선택 사항(최대 1~2개)이라 대부분 요약 문장에는 span이 없다. 인용문과 같은 문장의 행위자/관계 주장은 인용과 별개로 날조될 수 있음(F3, F1) | 부분 가능 (인용 자체만) |
| 서사·감정 해석 (grounded) | "grounded"의 결정론 정의가 없다. 원문 행동에 근거한 감정 해석과 날조를 정규식으로 구분할 수 없음. 존재하는 가드는 cue 정규식뿐이고 L5처럼 과차단 | 불가 (판정 owner 없음) |
| 미확정 주장 (추측/회상, 공동 과거로 승격 금지) | `CHARACTER_CLAIM` 분류가 이미 있으나 persona 이름 입력 결함 때문에 live에서 `CURRENT_SCENE`로 분류됨 | persona 입력 수정 후 부분 가능 |
| lane 정보의 저장/재투영 생존 | `scope_payload` 확장 없이는 lane을 저장할 곳이 없다. free-text 마커는 `compactCurrentMemory`(마커 제거 단일 서술)에서 소거 | 불가 (새 저장 필드 필요) |
| 사용자 수정 권위 | `user_edited=1`은 있으나 렌더/압축 시 구별 불가, 가드 미적용 | 부분 (필드는 있음, 소비처 없음) |

따라서 "기존 요약 사실에 비권위 라벨을 붙이는 것"은 검증이 아니다. 라벨 방식은 LLM이 스스로 낸 분류를 서버가 신뢰하는 것과 같다 (날조 문장이 "확정" lane에 들어가면 그대로 통과).
`ROOT_CAUSE_FIXED` 불가. 최대 `MITIGATED` (아래 옵션).

## 4. 감정 기억 손실 위험

- 감정 해석을 전부 제거(사실 lane만 유지)하면 L5류 정상 감정 기억이 사라진다. 요약 프롬프트의 보존 항목 2번(관계 역학/감정 방향 변화)과 직접 충돌하며, "아마추어 같다 + 입술 깨묾"처럼 감정 결과가 핵심인 장면의 80턴 후 회상이 약해진다.
- 정규식 cue 강화 방식(현재 가드를 live에서 살리는 경우)은 L5와 같은 정상 문장의 재시도 소모(최대 3회, 이후 batch pending)를 늘린다. 요약 호출 횟수/비용이 증가할 수 있다.
- 정량화(턴별 회상률)는 provider 호출 없이는 불가. 이번 단계 미수행 (Opus 5.5 추가 6회는 승인 전 미실행).

## 5. 비용·토큰·추가 호출 영향

- 결정론 quote/role 검증: 추가 LLM 호출 0, 토큰 0. 로컬 CPU만 소모.
- lane 분리 프롬프트: 요약 출력 포맷이 길어져 600자 상한 안에서 사실 보존 공간이 줄어든다. 요약 1회당 토큰이 늘 수 있다. 정확한 증가량은 provider 호출 없이는 측정 불가.
- 별도 검증 LLM 호출은 기본 전제로 두지 않았고 STOP 사유(요금 변경)에 해당한다.

## 6. 회귀 설계 (provider-free, 구현 전)

모든 항목은 `__setSummarizeTurnBatchCallerForTests` 고정 요약기 + isolated DB + 결정론 판정으로 구성한다. 실현 가능성은 현재 main 기준.

| # | fixture | 기대 | 현재 main 실측 |
|---|---|---|---|
| 1 | 가짜 평생 약속 | `[현재기억]`에 객관 사실로 미포함 | 실패 (포함됨) |
| 2 | 존재하지 않는 누나 친분 | 미포함. 귀속 주장(F2b)은 허용 | 실패 (live persona), 정식 persona면 차단 |
| 3 | 화자 반전 | 미포함 | 실패 (persona 무관) |
| 4 | 커피 발화에서 키스 날조 | 미포함 | 실패 |
| 5 | 합법적 NPC 문 열기 | 포함 | 통과 |
| 6 | 유저 직접 관계 선언/변경 | 포함 | 통과 |
| 7 | "아마추어 같다" 정확 문장 + 입술 깨묾 | 포함 | 통과 |
| 8 | 감정 해석 전부 제거 시 장기 RP 품질 | 감정 기억 보존 | provider 평가 필요 (미수행) |
| 9 | 사용자 직접 요약 수정 | 사용자 권위 유지, regen/variant 전환에서 보호 | 코드 감사상 보호됨, 렌더 구별 없음 |
| 10 | regen / IF / branch | `main_canon`/`branch_canon`/`noncanon` 격리 유지 | 코드 감사(`rebuildLorebookFromRecords`는 main_canon+active branch_canon+preference만 주입). 이번 단계 미실행 |
| 11 | 400턴+ compaction | lane/출처가 압축 후에도 생존 | compaction LLM 호출이 필요해 provider-free 불가. 비LLM 폴백만 측정 (최신 유지, 오래된 블록 삭제). 80~110턴대부터 발생 가능 |

설계가 #1/#3/#4를 차단하지 못하면 ROOT_CAUSE_FIXED로 분류하지 않는다. 현재 어떤 라벨/lane 설계안도 #3을 차단하지 못한다.

## 7. 정규식 가드 분류 (삭제 없음)

| 대상 | 분류 | 근거 |
|---|---|---|
| `resolvePersonaName`의 `이름/호칭:` 전용 파싱 | REWRITE (최소 변경 후보) | live 호출자는 맨 이름을 넘김. backfill/reconcile 경로도 persona 미전달. 단일 owner 입력 계약 수정 |
| `summaryInventsUnsupportedUserRelationship` + `PRIOR_SHARED_HISTORY_CUE` | KEEP + REWRITE 후속 | 정식 persona에서 F2는 차단하지만 `이후` 같은 흔한 어휘로 L5 과차단 |
| `ROLLING_SUMMARY_EPISTEMIC_POLICY` 와 `[전환점 대사]` | REWRITE 대상 (병합) | prompt 변경이 필요하면 두 문단을 합치고 누적 문장 금지 |
| `STRONG_GLOBAL_MEMORY_LOSS`, `SOURCE_UNCERTAINTY_MARKER` 가드 | KEEP | 이번 프로브에서 정상 케이스를 막지 않음. 별도 증거 없음 |
| `emergencyFallbackTrimLorebookSync` | KEEP | 비LLM 안전망. 오래된 블록 삭제는 알려진 손실 |
| `ScopePayloadV1.sourceMessageIds` | FOLLOW-UP | 일반 경로 writer 없음. 활용 여부는 새 저장 필드 승인과 함께 결정 |

## 8. 옵션 (STOP, 승인 대기)

- **A. 최소 수정 후보 (새 필드/호출 없음)**: 요약 seal/backfill/reconcile 가드 호출에 persona 이름을 단일 owner 계약에 맞게 전달(또는 `resolvePersonaName`이 맨 이름도 허용). 효과: F2/F2c류 친분 날조 차단. 한계: F1/F3/F4는 여전히 통과 -> MITIGATED.
- **B. 요약 노출 프레이밍**: `[현재기억]`에서 요약을 비권위(히스토리/관계 메모/검증된 에피소드 우선)로 명시하는 기존 헤더 규칙 유지·강화. 검증이 아니라 노출 정책이며 날조를 제거하지 않는다.
- **C. 인용 span 결정론 검증(요약 경로로 B-1 재사용)**: 요약 인용문이 해당 배치 원문에 존재하는지/role이 맞는지만 서버가 확인. 인용 외 주장은 미검증. 새 저장 필드는 불필요하나 인용이 없는 문장은 보호하지 못함.
- **D. 3-lane 설계**: lane 저장·압축 생존을 위해 새 저장 필드와 compaction 계약 변경이 필요 -> 승인 전 구현 금지.

Cursor 의견은 점수화하지 않는다. GPT 원문 평가와 설계 승인을 기다린다.
