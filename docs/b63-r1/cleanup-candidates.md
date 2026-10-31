# B63 R1 — 삭제·통합 후보 목록 (실행 금지)

이 문서는 후보와 근거만 제출한다. R1/이번 PR에서는 어떤 코드도 삭제·통합하지 않는다.

## SAFE TO DELETE (근거가 확인된 후보, 아직 삭제하지 않음)

| 후보 | 근거 | 판정 |
|---|---|---|
| `analyzeTurnMemory` (`src/lib/ai.ts:628-680`) | 호출자 없음. `turnSummary` 200자 legacy per-turn 경로. | 삭제 후보. 단, 외부 스크립트/테스트 참조 재확인 필요. |
| `chats.memory_pending` per-turn writer | `db.ts:652`에서 default/copy만 되고 실제 per-turn write가 없음. | 컬럼/코드 정리 후보. migration 필요. |
| `buildStoredHistoryStaticBlock` / `buildRecentNarrativeContextBlock` (`src/lib/memory/memory-narrative-context.ts:36-81`) | production route에서 사용되지 않는 dormant 경로 (`geminiStaticDynamicMode: false`). | 삭제 후보. Gemini static/dynamic 재활성 계획이 없을 때. |
| `listTurnSummariesForChat` (`memory-turn-summary.ts:397-410`) | `@deprecated` 표시, canonical `listMemoryRecordsForChat`/view로 대체. | 삭제 후보. 호출자 확인 필요. |
| legacy `MEMORY_5PLUS4_ENABLED` | production reference 0; single-owner test가 0을 assert. | env/문서 정리 후보. |

## KEEP (이번 증거로 유지)

| owner | 근거 |
|---|---|
| `buildContext` final wire | A/B/C/D의 systemPrompt byte-equal 재구성 기준. |
| `memory-turn-loader` turn 정의 | completed turn count와 RAW 경계의 canonical owner. |
| `chat_turn_summaries` + 5턴 writer | A의 T1–100 Global과 B의 per-turn record 모두 이 구조를 재사용. |
| Global/Medium/Episodic/Relationship reader | 각각 다른 거리/우선순위를 담당. R1에서 중복 삭제 근거 부족. |
| `memory-lorebook-resolve` / `summaryTextForPromptInjection` | 10k trim과 projection kind의 canonical owner. |
| `memory-episodic-independent` / `postTurnSharedInitial` | B62 공통 주입의 출처. B63-R1에서 수정하지 않음. |

## FOLLOW-UP (삭제보다 설계/검증이 먼저)

| 항목 | 근거 | 다음 단계 |
|---|---|---|
| Medium no char cap | `memory-medium-term-prompt-budget-audit.ts:445`; system prompt는 hard trim되지 않음. | 별도 budget PR. |
| Global + Medium + detail 중복 | D가 T76–94를 Global과 detail로 두 번 주입. | 단일 recent-detail projection 설계. |
| 5턴 요약의 미래 정보 누출 | A `[66~70]`에 T71 지시. B73/B74에 “다음 날”. | summary prompt/source window 감사. |
| T95–96 gap | B summary T56–94, RAW T97–100. C RAW6 trim. | RAW/요약 경계 정상화 별도 PR. |
| B62 공통 주입 | T80이 모든 arm에 들어가 구조 비교를 오염. | 다음 비교에서는 양쪽 제거 또는 양쪽 동일 유지. |
| 40턴 참고자료 | 요약 참고자료이며 원문 대화가 아님. | 원문 확보 전 답안/원문으로 사용 금지. |
| 500/1,000턴 | 자료 없음. 100턴 복제 금지. | 별도 원문 확보 후 설계. |

## 통합 후보 (삭제 아님)

| 후보 | 근거 | 판정 |
|---|---|---|
| Global exact rebuild + Medium projection | 둘 다 `chat_turn_summaries`를 읽지만 activation 조건이 다름. | 즉시 통합 근거 부족. KEEP. |
| recent-detail projection + Medium | D는 Medium section을 재사용했지만 Global과 중복. | bounded 단일 projection으로 재설계할 후보. |
| summary item-role reconciliation + episodic artifact roles | 둘 다 item role을 보정하지만 대상 레이어가 다름 (요약 vs episodic). | 중복 아님. KEEP, 경계 문서화. |

## 결론

- 실제 삭제는 0건.
- “SAFE TO DELETE”도 호출자/마이그레이션 확인 전에는 실행하지 않는다.
- R1의 목적은 비교 입력과 보고를 바로잡는 것이며, owner 통합은 별도 PR에서 다룬다.
