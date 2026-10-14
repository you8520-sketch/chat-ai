# Main RP — episodic 프롬프트의 "제안 = 합의" 예시 감사 및 최소 수정

기준 main: `8471b7eecc2c2ebdaa332a70625e86a3c9fed2be` (티켓의 `b7159ec6` 이후 UI/증거 커밋만 추가됨; episodic 프롬프트·검증 owner 변경 없음 확인). #1591 `1389e04f`(Draft 유지, 무변경), #1571 `d74d2b06`(증거 전용, 무변경).
제품 변경은 `src/lib/memory/memory-episodic-prompt.ts` 예시 1줄 → 2줄 교체와 신규 단위 테스트 1개뿐이다. 새 규칙 문장·verifier·원장·스키마 없음. 병합/배포/운영 DB 변경 없음.

## 1. 실행 경로 감사 (현재 main)

| 단계 | owner / 위치 | 결과 |
|---|---|---|
| 프롬프트 생성 | `buildSharedInitialEpisodicSectionInstructions` (`memory-episodic-prompt.ts`) ← `postTurnSharedInitial/prompt.ts:66-68` `buildSharedOutputEnvelope`, `input.includeEpisodic` 일 때만 | **운영 wire에 주입됨** (`rg`로 호출자 2곳: Shared Initial, 그리고 호출자 없는 봉인 배치 추출기 `memory-episodic-extract.ts`) |
| includeEpisodic 결정 | `route.ts:5226` `shouldRequestEpisodicInSharedInitial` (메모리 기능 ON + OOC 장면 렌더 아님 + `resolveEpisodicEligibilityForSourceUserMessage`) → `route.ts:6477` / `statusWidget/extract.ts:942` | 일반 main_canon RP 턴이면 true |
| 호출 | `runPostTurnRelationshipOnlyInitial` → `runPostTurnSharedInitial` → `callBackgroundMemory(requestKind=background-post-turn-shared-initial, modelId=BACKGROUND_OPENROUTER_MODEL)` | 이번 실험은 이 함수를 그대로 호출(`gpt-6-luna`) |
| 파싱 | `parseSharedEpisodicSection` (`memory-episodic-shared.ts`) | facts[] |
| 검증·저장 | `reconcileSharedEpisodicFactsForTurn` → `persistEpisodicMemoryFactsCore` → `evaluateEpisodicFactEvidence`(`evidenceBinding`) → `episodic_memory_facts`(`attribute/value/fact_text` 원문 저장 + `metadata.evidence`) | 인용 존재·role만 검증, 라벨은 미검증 |
| 검색·주입 | `resolveEpisodicPromptFactText`: 검증된 행은 `fact_text`가 아니라 **검증된 인용 원문 + 권위 라벨**만 주입 | 최종 RP wire에는 "합의했다" 문장이 직접 가지 않음 |

결론: 문제 예시는 운영 Shared Initial 프롬프트에 실제로 들어간다. 저장 단계는 `value`/`fact_text`를 검증하지 않으므로 모델이 낸 구조 필드가 그대로 DB에 남는다. `relationship_status`/`lovers`를 읽는 비-프롬프트 소비자는 코드에 없다(`rg`) — 영향 범위는 (1) 저장된 행의 구조 필드·검색 gloss(`fact_text`/`value` 임베딩·매칭), (2) 인용 선택(어떤 원문이 근거로 남는가)이다.

## 2. BEFORE / PROBLEM (재현)

프롬프트 39행 예시: 유저 인용 `좋아, 우리 오늘부터 연인하자.`(제안) 하나로 `relationship_status=lovers`, `fact_text="…연인이 되기로 명시적으로 합의했다."`. 같은 프롬프트 25·28행은 "단발 턴에서 관계 단계 추론 금지, 확정 관계는 명시적 상호 합의 필요"라고 말한다 → 예시가 규칙과 모순.

재현: 운영 `runPostTurnSharedInitial`(includeEpisodic+includeRelationship, 모델 `gpt-6-luna`)을 FX06 원문(유저 제안 + 캐릭터는 손만 맞잡음, 명시 수락 없음)으로 6회 호출하고 응답 facts를 운영 검증기 `evaluateEpisodicFactEvidence`로 통과시켜 `data/raw/before__*.json`에 저장(원문·토큰·비용 포함).

| BEFORE (FX06, 제안만, n=6) | 횟수 |
|---|---|
| `relationship_status=lovers` 행이 검증 통과·저장 | **6/6** |
| `fact_text`에 "명시적으로 합의했다" | **3/6** (나머지 3회는 "제안했다"인데 `value`는 여전히 `lovers`) |
| 예시의 식별자(`enoch_user`) 누출(이 채팅과 무관한 캐릭터명) | 2/6 |
| 손 맞잡기를 근거로 한 행 | 검증기가 거부(`assistant_evidence_cannot_authorize_user_action`) 1건 |

| BEFORE (정상 대조, 명시 수락 있음: 유저 제안 + 캐릭터 `"그래. 오늘부터 연인이다."`, n=6) | 횟수 |
|---|---|
| `lovers`/"합의" 행 저장 | 6/6 — 그러나 **근거 인용은 6/6 유저의 제안 문장**. 수락을 보여 주는 인용은 0/6 → 검색 시 주입되는 것은 제안 원문뿐이고 수락은 보존되지 않음 |

즉 예시 때문에 (a) 제안만 있는 경우와 실제 수락이 있는 경우가 **저장 결과에서 구별되지 않고**, (b) 실제 수락 사건은 근거 인용으로 남지 않는다.

## 3. 수정 (episodic 프롬프트 owner 내 예시 교체 1곳)

```diff
-  - {"category":"relationship","subject":"enoch_user","attribute":"relationship_status","value":"lovers",... "fact_text":"에녹과 유저는 서로 연인이 되기로 명시적으로 합의했다.","evidence_type":"explicit_scene_event","evidence":{"source_role":"user","source_quote":"좋아, 우리 오늘부터 연인하자."}}
+  - {"category":"relationship","subject":"user","attribute":"relationship_proposal","value":"proposed",... "fact_text":"유저는 에녹에게 연인이 되자고 제안했다.","evidence_type":"explicit_user_statement","evidence":{"source_role":"user","source_quote":"나랑 사귀자."}}
+  - {"category":"relationship","subject":"enoch","attribute":"relationship_response","value":"accepted",... "fact_text":"에녹은 연인 제안을 명시적으로 수락했다.","evidence_type":"explicit_scene_event","evidence":{"source_role":"assistant","source_quote":"그래, 오늘부터 연인이다."}}
```

- 제안은 유저 인용(`USER_EXPLICIT`), 수락은 캐릭터 인용(`CURRENT_SCENE`)으로 **서로 다른 근거 인용을 가진 별개 사건**. 실제 검증기로 두 예시가 각자 통과함을 단위 테스트가 확인.
- 수락 예시의 subject를 `enoch`(user 미포함), `fact_text`에서 "유저" 제외: 검증기가 relationship 범주의 assistant 인용에서 user-linked 서술/`*_user` 주체를 거부(`assistant_evidence_cannot_authorize_user_action` / `…_user_linked_history`)하므로, 이 형태만 통과한다(결정적 프로브 확인).
- 예시 문구는 FX06 원문과 다르게 작성(`나랑 사귀자.` / `그래, 오늘부터 연인이다.`) — 특정 원문에 대한 과적합 방지.
- 규칙 문장은 한 줄도 추가·삭제하지 않았다(25·28행 유지).

## 4. AFTER (같은 호출 경로, 같은 원문)

| AFTER | 결과 |
|---|---|
| FX06 제안만 (n=16) | `lovers` 저장 **0/16**, "합의" 0/16, `enoch_*` 누출 0/16, **제안 사건 행 16/16**(유저 인용 `[유저가 직접 쓴 원문]`) |
| 같은 FX06에서 모델이 `relationship_response=accepted`를 낸 경우 | 3/16 시도: 2건 검증기 거부, **1/16 저장**(손 맞잡기 장면 인용 + `accepted` gloss) — 잔여 위험 §7 |
| 정상 수락 대조 (n=16) | 제안 행 16/16, **수락 인용 `[AI가 쓴 장면 원문] "그래. 오늘부터 연인이다."` 저장 4/16**(BEFORE 0/6), `lovers` 0/16 |
| 캐릭터 주장(누나가 예전부터 알던 사이라더라, n=18) | BEFORE 13/18 → AFTER 5/18 행 저장. **저장된 행은 양쪽 모두 100% `explicit_character_claim`(`[캐릭터 발언(미확정 주장)]` 라벨)** — 객관 사실로 승격된 행 0 |
| 정상 감정+NPC(서린 꿀차·질투, n=18) | BEFORE 1/18 → AFTER 0/18 저장(양쪽 모두 거의 항상 빈 facts) |
| 유저 약속(원장 owner, n=6) | BEFORE/AFTER 모두 episodic 행 0 — 원장 경계 유지 |

비교 변형(단일 제안 예시만 교체, 수락 예시 없음; `data/raw/varB__*`): FX06 제안 행 16/18(+`relationship_status=dating` 1/18), 그러나 정상 수락 대조에서 `relationship_status=lovers` 6/18·`dating` 2/18이 다시 나타남 → 수락 예시가 있어야 `lovers` 패턴이 사라진다. 캐릭터 주장 행 6/18로 최종안과 같은 수준 → 주장 행 감소는 `lovers` 예시 제거의 부수효과이며 수락 예시 때문이 아니다.

## 5. 토큰·비용

| 항목 | BEFORE | AFTER |
|---|---|---|
| Shared Initial 시스템 프롬프트 길이(episodic 포함 envelope) | 8,834자 | 9,094자 (+260자, +2.9%) |
| 호출당 입력 토큰(공급자 보고, FX06 동일 입력) | 2,270 | 2,335 (+65, +2.9%) |
| 호출당 출력 토큰(FX06 / 수락 대조) | 130.7 / 118.7 | 155.2 / 183.7 (제안·수락을 별도 행으로 내므로 증가) |

유료 호출(운영 경로 `gpt-6-luna`, 벤치 키): **182회**, 입력 419,918 / 출력 19,135 토큰, 청구 **$0.01256 ≈ 17원**(상한 1,000원의 1.7%). 라벨별: before 54회 $0.00351, after 74회 $0.00542, varB 54회 $0.00363. 제공자 오류 0. 운영 DB 접근 없음.

## 6. 회귀 검증

- 신규 단위 테스트 `memory-episodic-prompt-examples.test.ts`(3 tests): ① Allowed 예시 전부가 운영 검증기 `evaluateEpisodicFactEvidence`를 각자의 인용으로 통과, ② relationship 예시 중 user 인용이 `lovers/accepted/합의/수락`을 주장하지 않음, ③ 제안(유저 인용)·수락(캐릭터 인용) 예시가 분리돼 있음. **구 예시로 되돌리면 2/3 실패(뮤테이션 확인)**, 현 변경은 3/3 통과. 프롬프트 문구 고정이 아니라 예시가 계약을 만족하는지 검사.
- 관련 34개 파일(episodic·Shared Initial·fork·regen·relationship task·source-edit·rpDerivedState·episodicMemoryFacts) 실행: main 518 tests → PR 521 tests(신규 3개), **실패 집합 동일**(`data/related-suite-failset-main.txt` = `-pr.txt`, 16개는 main에 이미 있는 실패: regen E3/E4/E5, memoryRelationshipTask 등). 새 실패 0.
- 전체 `npm run test:regular`: main 292 fail / PR 347 fail — 두 실행의 실패 이름이 양방향으로 달라(persona/TRPG/knowledgeTransfer 등 무관 파일, 병렬 실행 중 공유 자원 경합) **flaky로 판단**, episodic 관련 파일은 위 집합 비교로 별도 검증. 원로그 `data/` 미첨부(크기).
- `git diff --check` clean, `npm run lint`(= `typecheck:app`) 통과. 풀 `typecheck`는 main에 이미 있는 테스트 파일 오류 한정(이번 변경과 무관, 새 오류 없음 — 변경은 TS 상수 문자열과 신규 테스트 1개).
- regen/fork/delete: 프롬프트 상수만 바뀌어 해당 코드 경로는 변경 없음. 관련 기존 테스트(위 집합)가 main과 동일하게 동작.

## 7. REGRESSION RISKS / 한계 (GPT 판단 필요)

1. **캐릭터 주장 행 보존율 하락**(13/18 → 5/18, n=18, 한 모델·한 입력). 저장된 행은 항상 claim 라벨이라 허위 과거 방향 악화는 아님. `lovers` 예시가 relationship 범주 방출을 과하게 부추기던 효과가 사라진 부수효과로 보인다(varB 동일). 주장 보존을 유지하려면 claim 예시 1줄을 추가하는 별도 판단이 필요 — 이번엔 추가하지 않았다(변경 예산).
2. **수락 보존은 부분적**(정상 수락 대조 4/16 → 수락 인용 저장). BEFORE는 0/6이었으나 "상호 수락을 안정적으로 저장"한다고 주장하지 않는다. 확정 관계 상태는 원래 episodic이 아니라 관계/원장 owner의 몫이다.
3. **잔여 오탐 1/16**: 모델이 손 맞잡기를 `relationship_response=accepted`로 낸 경우, `subject=like`(user 미포함)이면 검증기가 CURRENT_SCENE으로 통과시킨다. 주입되는 것은 장면 인용(손을 맞잡음) 자체이며 "수락" gloss는 주입되지 않는다. 이는 검증기가 라벨/gloss를 보지 않는 설계 한계(S2-lite 증거와 동일)이며 이번 범위 밖이다.
4. 단일 모델(`gpt-6-luna`)·소표본·temperature 0.4. 모델/온도가 바뀌면 비율이 달라질 수 있다.
5. 기존 테스트 fixture(`memory-episodic-evidence-golden.test.ts` U6, `memory-episodic-capture-quality-benchmark.test.ts` CQ-02, `memory-episodic-source-evidence.test.ts`)가 같은 "제안 인용 = 합의" 패턴을 정상 예로 갖고 있다. 검증기 동작/벤치 골든이라 이번에 손대지 않았고 FOLLOW-UP으로 기록.

## 8. REMOVED / PRESERVED

- REMOVED: Allowed 예시 `enoch_user / relationship_status / lovers / 합의` 1줄.
- ADDED: 제안·수락 예시 2줄(교체), 단위 테스트 1파일, 이 증거 디렉터리.
- PRESERVED: 규칙 25·28행("단발 관계 단계 추론 금지, 확정은 명시적 상호 합의"), 약속·아이템 원장 경계(23·48행), 캐릭터 주장 attribution 규칙, 다른 Allowed 예시 4개, 검증기 `evaluateEpisodicFactEvidence`, 검색 주입 정책(검증된 인용만), 봉인 배치 추출기(호출자 없음 — 확대 안 함), #1591·#1571.

## 9. STOP 판정

- 예시가 운영 경로에 쓰이는가: **예**(§1). 원인이 다른 owner인가: 모순의 직접 원인은 프롬프트 owner이며, 검증기 설계 한계(라벨 미검증)는 별도 owner로 기록만(§7-3). 광범위 변경 불필요.
- 최소 수정 입증: FX06 `lovers` 6/6 → 0/16, 제안·수락 분리 저장, 구 예시 복원 시 단위 테스트 실패.
- 위 §7-1이 허용 가능한지 GPT 판단 후 STOP. 자동 병합 없음.

## 10. PROOF

| 항목 | 값 |
|---|---|
| 원문(전체 응답·검증 결과·토큰·비용) | `data/raw/{before,after,varB}__*.json` 182개, `data/summary-before.txt`, `data/summary-after.txt`, `data/summary-before-after.json` |
| 프롬프트 전문 | `data/before__SYSTEM_PROMPT.txt`, `data/after__SYSTEM_PROMPT.txt` |
| 변경 diff | `data/prompt-change.diff.txt` |
| 프로브 | `probes/ep-live.test.ts.txt`(운영 `runPostTurnSharedInitial` 직접 호출 + 검증기), `probes/sum.py.txt` |
| 재현 | `CHEAPER_INFERENCE_API_KEY=$CHEAPER_INFERENCE_BENCHMARK_API_KEY EP_LABEL=x EP_REPS=6 node --conditions=react-server --import tsx --test src/lib/memory/ep-live.test.ts` (정책 import 없이, 유료) |
