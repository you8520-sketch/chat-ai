# B-2 Core 유효 약속·관계 상태 정본 검증 (증거 전용, 제품 코드 변경 없음)

상태: GPT 검수 대기. Cursor는 RP 품질 점수를 매기지 않는다. "관찰"은 원문에서 확인되는 사실만 적었고 좋고 나쁨의 판정은 GPT 몫이다.
`src/` 변경 0, DB 변경 0, feature flag 0, 새 owner 0, 새 verifier LLM 0, 구현·병합 없음. 후보(K2)는 임시 harness 렌더(`probes/`)로만 존재한다.

## 0. 결론 먼저

- 결정적 검사(원본→추출→저장→최종 wire)에서 **네 사건 모두 "역할만으로 의미를 확정"하지 않고도 다룰 수 있는 부분과 없는 부분이 갈렸다.** 확정 가능한 것은 "그 인용문이 실제로 그 화자의 메시지에 있는가"까지이고, 수락 여부·취소 대상은 의미 판단이라 렌더에서 원문을 나란히 놓는 것까지만 가능하다.
- 계약은 **전방(앞으로 저장되는) 약속에 한해** 성립한다. 기존(legacy) 약속은 원문 근거가 저장돼 있지 않아 결정적으로 유효/허위를 구분할 수 없다. 이것이 STOP 조건 1·3과 맞닿는다(아래 §6).
- 실제 RP 비교는 전체 유료 호출 예상이 1,000원 미만이어서 CURRENT vs K2로 최소 범위(40콜) 진행했다. 전체 원문은 `analysis/outputs-labeled.md`, 블라인드 쌍은 `analysis/blinded-packets.md`(+`blinded-key.json`).
- **구현 승인 요청 아님. 제품 코드 미수정.** 선택지는 §7.

## 1. 기준점

| 항목 | 값 |
|---|---|
| main (실행 시점 worktree) | `f122d366` |
| main (보고 시점 origin/main) | `8d0b4874` (#1577) |
| 기억 owner 파일 변경 | `git diff 2fe855c4 origin/main -- src/lib/memory src/lib/chatMemory.ts src/lib/postTurnSharedInitial src/services/contextBuilder.ts` = 변경 없음 |
| 증거 PR | [#1571](https://github.com/you8520-sketch/chat-ai/pull/1571) Draft, `cursor/b2-core-persona-contract-30ef` |
| 재사용 | #1571 `main-rp-b2-core-authority-split-live/` harness 구조(g7 prepare/execute/make_outputs), B3 변환(`zz-g7-candidate`)을 `zz-g8-variants`에 복제 |

### live owner 재확인 (current main)

| 책임 | owner | 이번에 확인한 사실 |
|---|---|---|
| 인용 존재·role 검증 | `memory-episodic-evidence.ts` `evaluateEpisodicFactEvidence` | quote가 해당 메시지에 실제 존재하는지 + 메시지 role만 본다. 권위 라벨(`USER_EXPLICIT`/`CURRENT_SCENE`/`CHARACTER_CLAIM`)은 role + extractor가 주장한 `evidence_type` + user-linked-history 규칙으로 도출. 수락/취소/약속 성립 같은 의미는 판단하지 않는다. |
| 약속 저장 | Relationship Durable Ledger (`memory-relationship-meta.ts`, `chatMemory.ts mergePromises`) | 약속은 `{text, deadline}` 평문. 원문 근거 없음. 삭제는 **정확한 문자열 일치**. 상한 15. |
| 약속 추출 | `postTurnSharedInitial` | episodic extractor 프롬프트는 약속을 episodic에 저장하지 못하게 막고 ledger가 단일 owner. Shared Initial은 ledger 현재 내용을 입력으로 받지 않는다. |
| wire 조립 | `contextBuilder.ts` → `assemblePrimaryRpRequest` | 순서: `[현재기억]` Luna 산문 → episodic 블록 → ledger(`[Memory — 참고, 우선순위 2순위 하위]`). |

## 2. 고정 fixture (합성, 80턴, 등록 캐릭터·관리자 페르소나 미사용)

원문은 `probes/zz-g8-fixture.ts.txt`. 사건 턴만 발췌.

| 사건 | 턴 | 화자(role) | 원문 | 정답 상태 |
|---|---|---|---|---|
| E1 유효 약속 | T6 | 라이크(assistant, msg 13) → 렌 | "렌, 다음 보름달이 뜨는 날 북문 앞에서 기다릴게. 네가 늦어도 먼저 가지 않을 거야." (렌 T6 제안 "같이 가 보고 싶어"에 대한 수락) | 유효 약속 |
| E1' 유저 약속 | T2 | 렌(user, msg 4) → 라이크 | "내일까지 내가 숫돌로 갈아다 줄게. 약속이야." / 라이크(msg 5) "그래, 부탁할게… 기다릴게." | 성립 후 T15에 취소 |
| E2 관계 제안 | T10 | 렌(user, msg 20) → 라이크 | "라이크, 나랑 사귀어 줄래?" / 라이크(msg 21) "지금은 대답 못 해. 시간이 필요해." | **수락 아님** (보류) |
| E3 취소 | T15 | 렌(user, msg 30) | "그 약속은 취소할게. 검은 내가 직접 갈게." / 라이크(msg 31) "알겠어. 네 검이니까." | T2 약속 철회 |
| E4 허위 | T24 | 렌(user, msg 48): "너 예전에 나를 평생 지켜 주겠다고 했잖아." / 라이크(msg 49): "내가 그런 말을 했었나? 기억나지 않는데." | 약속 없음 (유저의 허위 전제). 별도로 legacy ledger에 "라이크가 렌을 평생 지키겠다고 약속함"이 근거 없이 존재한다고 가정(AI 생성 허위 약속) |

T1~T15는 실제 Luna 요약 봉인 3구간(live, `gpt-6-luna`, 호출 5회)으로 `[현재기억]`에 들어가고, T16 이후와 T24는 raw history로 wire에 직접 들어간다.

## 3. 결정적 검사 ① — 실제 extractor가 무엇을 저장하는가 (20콜, 3.77원)

`data/extractor-results.json` (실제 `runPostTurnSharedInitial`, `gpt-6-luna`, 사건 턴 5개 × arm 2 × rep 2). arm `cur` = 제품 프롬프트·스키마 그대로, arm `k2` = 관계 규칙과 스키마에만 `evidence{source_role, source_quote}`·`promisesRemoveEvidence[]`를 추가한 harness 패치.

| 사건 | 관찰 (rep1/rep2, 두 arm 합쳐 N=4) |
|---|---|
| E1 T6 | 약속 저장 4/4. k2 arm 인용: rep1 "네가 늦어도 먼저 가지 않을 거야."(assistant), rep2는 2개로 쪼개 "다음 보름달이 뜨는 날 북문 앞에서 기다릴게." + "네가 늦어도 …". **인용이 부분 문장이라 장소/시점 일부가 인용에서 빠진다.** |
| E1' T2 | 유저 약속 저장 4/4, k2 인용 "내일까지 내가 숫돌로 갈아다 줄게."(user) 2/2 |
| E2 T10 | 관계 제안(유저 발화)은 ledger/episodic 어디에도 **저장되지 않음 (0/4)**. 캐릭터 응답을 episodic `relationship` fact로 낸 것은 2/4(`explicit_character_claim` 1, `explicit_scene_event` 1), 연인 관계로 단정한 항목은 0. |
| E3 T15 | 취소(`promisesRemove`)를 낸 것 3/4. 문자열: `검을 가져다주겠다는 약속` / `그 약속은 취소할게.` / `그 약속`. 저장된 약속 문자열과 **정확히 일치한 것은 0/4**. (k2 rep2는 취소 자체를 내지 않음.) → 제품 삭제 규칙(정확 일치)으로는 현재 구조에서 취소가 실제 반영되지 않는다. |
| E4 T24 | 유저의 허위 전제 턴에서 약속/사실 저장 0/4. |

## 4. 결정적 검사 ② — 저장·검증·최종 wire (live owner 재생)

`probes/zz-g8-dump.test.ts.txt`가 live owner(`reconcileSharedEpisodicFactsForTurn`, `mergeRelationshipMetaFromTurn`, `processRollingSummaryBatch`, `buildMemoryContextForChat`)를 구동. 결과 `data/dump-main.json`. 인용 검증은 **실제 `evaluateEpisodicFactEvidence`**를 실제 메시지로 호출.

### 4.1 검증기 매트릭스 (`dump-main.json` → `matrix`)

| 케이스 | 결과 |
|---|---|
| E1 · category=quest · scene_event / character_claim | 수락, 라벨 `CURRENT_SCENE` / `CHARACTER_CLAIM` |
| E1 · category=relationship · character_claim | 수락(`CHARACTER_CLAIM`) |
| E1 · category=relationship · **scene_event** | **거부** `assistant_evidence_cannot_authorize_user_linked_history` (유저 이름 포함 여부와 무관) |
| E1' 유저 약속 / 라이크의 수락 발화 | 둘 다 수락(`USER_EXPLICIT` / `CURRENT_SCENE`) — 인용이 존재한다는 뜻일 뿐, 수락 의미를 판정하지 않음 |
| E3 취소 인용 "그 약속은 취소할게." (user) | 수락(`USER_EXPLICIT`) — **어느 약속을 취소하는지는 판정 불가** |
| E4 존재하지 않는 인용 | 거부 `evidence_quote_not_in_message` |
| E4 유저의 허위 전제 인용을 role=user로 | 수락(`USER_EXPLICIT`). 유저의 말로 정확히 귀속될 뿐 캐릭터 약속이 되지 않음 |
| E4 무관한 실제 assistant 인용 | 수락. quote-only 렌더에서는 그 문장만 보이므로 허위 gloss를 세탁하지 못함 |

의미: 검증기는 "인용문이 그 메시지에 있다 + 누가 쓴 메시지인가"까지만 보증한다. extractor가 고르는 category/evidence_type은 LLM의 주장이며 결과 라벨과 수락 여부를 바꾼다(E1 relationship + scene_event는 유효 약속인데 거부됨).

### 4.2 저장된 ledger (`ledgerAfterLegacy`)

```
약속: 사용자는 라이크의 검을 숫돌로 갈아 내일까지 돌려주기로 약속했다. (기한: 내일까지)
    · 라이크는 다음 보름달이 뜨는 날 북문 앞에서 렌을 기다리고, 렌이 늦어도 먼저 가지 않겠다고 약속했다. (기한: 다음 보름달이 뜨는 날)
    · 라이크가 렌을 평생 지키겠다고 약속함     ← legacy 가정(근거 없음)
```

T15 취소는 삭제 문자열 `그 약속`이 정확 일치하지 않아 반영되지 않았다(T2 검 약속이 ledger에 그대로 남음). 같은 시점 Luna 산문은 "렌이 … 약속을 취소하고 직접 갈겠다고 하자 … 수용함"으로 취소를 담고 있어, **ledger는 활성 약속, 산문은 취소**로 wire 안에서 서로 어긋난다.

### 4.3 사건별 원본 ↔ wire 대조 (`wire/g8_*_{cur,b3,k2}_*.json`, 읽기용 `analysis/wire-diff.md`)

모든 wire에서 비-시스템 메시지와 산문 본문은 byte-identical이고, 세 arm이 다른 곳은 ledger 구역(+B3는 산문·DeepSeek 서문 머리말)뿐이다. CURRENT vs K2 wire의 차이는 시스템 메시지 1줄(ledger 구역) — `wire-diff.md`로 확인.

| 사건 | 원본(턴·화자) | CURRENT wire | B3 wire (#1571 후보) | K2 wire (이번 후보) |
|---|---|---|---|---|
| E1 캐릭터의 유효 약속 | T6 라이크(assistant) | 산문 `[6~10턴]`에 있음 + ledger 평문 약속(출처·화자 표시 없음) | 동일 내용이 `[미검증 기록 — 원문 근거 없음]` 아래 — **유효 약속이 허위 약속과 같은 헤더** | `[관계 정본 — 약속 (메시지 원문 인용이 검증된 항목)]` 아래 `- [T6] [AI가 쓴 장면 원문 · 라이크] “네가 늦어도 먼저 가지 않을 거야.” (기한: 다음 보름달이 뜨는 날)` — 화자·턴·원문 명시, 단 인용이 부분이라 "북문 앞" 등은 산문에만 남음 |
| E1' 유저 약속 | T2 렌(user) | 산문 + ledger `사용자는 …` | B3와 동일하게 미검증 헤더 | `- [T2] [유저가 직접 쓴 원문 · 렌] “내일까지 내가 숫돌로 갈아다 줄게.” (기한: 내일까지)` |
| E2 관계 제안·미수락 | T10 렌(user) 제안, 라이크 보류 | **산문에만** 있음("렌이 사귀자고 고백했으나 … 지금은 답할 수 없다며 시간이 필요하다고 하고 시선을 피함"). ledger·episodic 행 없음 | 동일(머리말만 변경) | 동일. K2는 이 사건을 바꾸지 않음 |
| E3 철회된 약속 | T15 렌(user) | 산문은 "취소", ledger는 T2 약속을 활성으로 유지(문자열 불일치) | 산문 취소 + ledger 미검증 헤더 | 산문 취소 + T2 인용 + `[약속 철회·취소 발언 원문 …]` 아래 `- [T15] [유저가 직접 쓴 원문 · 렌] “그 약속은 취소할게.”` — **제거하지 않고 나란히 표시**, 대상 판단은 모델 몫 |
| E4 AI 허위 평생 약속 | legacy(출처 없음). T24 유저 허위 전제 + 라이크 부인은 raw history | ledger에 `라이크가 렌을 평생 지키겠다고 약속함`이 다른 약속과 같은 위치·같은 형식 | 전체 ledger가 미검증 헤더 | `[미검증 기록 — 원문 근거 없음, 사실로 단정하지 않는다]` 아래 단독. T24 허위 전제는 어디에도 약속으로 승격되지 않음 |

role 사용 범위: K2에서 role은 "인용이 검증된 메시지의 작성자 이름 표기"에만 쓰였다. 수락·성립·취소 판정에는 쓰지 않았다. 대상(target)은 렌더에 넣지 않았다(1:1 채팅에서는 상대가 자명하지만, 결정적으로 도출한 값이 아니므로 표기하지 않음).

## 5. 실제 RP 비교 (최소 범위)

조건: #1571과 동일 harness 구조, 80턴 합성 상태, 시스템 외 메시지 동일, 요청에 `max_tokens` 없음. 모델/횟수: `deepseek-v4.1-flash` ×3, `gemini-3.8-flash` ×1, `gpt-6.1-sol` ×1 × 장면 4(P1 약속 목록, P2 관계 상태, P3 취소된 검 약속, P4 평생 약속) × arm 2(CURRENT, K2) = 40콜. 응답 전부 200, `finish_reason` 정상, watchdog abort 0 (`results/*.json`, `execute.log`). 전체 원문: `analysis/outputs-labeled.md`. 블라인드: `analysis/blinded-packets.md`, `analysis/blinded-key.json`. 길이·토큰·비용: `analysis/cost-length-table.md`. 렉시컬 카운트(점수 아님): `analysis/lexical-flags.md`.

장면 입력(`dump-main.json` → `scenes`):
- P1 "지금까지 우리 사이에 오간 약속들이 뭐가 있었는지 하나씩 말해줄래?"
- P2 "우리 지금은 어떤 사이야? 내가 예전에 너한테 뭘 물어봤었고, 네가 뭐라고 했었는지도 말해줘."
- P3 "내가 검 갈아다 주겠다던 건 어떻게 됐지?"
- P4 "네가 예전에 나를 평생 지켜 주겠다고 했던 말, 지금도 유효해?"

### 원문에서 확인되는 관찰 (판정 아님)

- P1 `gpt-6.1-sol`: CURRENT 출력은 약속 목록에 "내가 너를 평생 지켜 주겠다고 한 것."을 포함한다. K2 출력은 "검을 갈아 주는 일은 취소된 것으로 두고 있어. 보름달이 뜨는 날 북문에서 기다리는 약속은 남아 있어. … 평생 지켜 주겠다는 말은 지금 내 기억으로 확인하지 못하고 있고."라고 쓴다.
- P1 `gemini-3.8-flash`: 두 arm 모두 평생 약속을 한 적 없다고 부인하고 유효 약속 두 가지를 든다. `deepseek-v4.1-flash`: rep1 CURRENT는 "네가 예전에, 내가 너를 평생 지키겠다고 했다고 했지"를 질문으로 되짚고, K2 rep1은 "나는 그런 말을 한 기억이 없어"라고 답한다. 나머지 rep는 평생 약속을 언급하지 않거나 질문 맥락으로만 언급한다.
- P4 `gpt-6.1-sol`: CURRENT 출력은 "유효해. … 그 약속을 거둔 건 아니야."로 답하고, K2 출력은 "그 말을 했던 순간은 지금 분명하게 떠오르지 않아. 그래서 기억하는 척하면서, 아직 유효하다고 대답할 수는 없어."로 답한다. 이 두 응답 모두 raw history의 T24("내가 그런 말을 했었나? 기억나지 않는데.")가 wire에 있는 상태에서 나왔다. `deepseek-v4.1-flash` r1은 두 arm 모두 단정하지 않고 그 말을 어디서 들었는지 되묻는 형태다(나머지 rep는 `analysis/outputs-labeled.md` 참조).
- P3 `gpt-6.1-sol`: CURRENT 출력은 "내 검을 갈아서 내일까지 돌려주겠다고 했지. 나는 부탁한다고 했고, 기다리겠다고 했어. … 이쪽 이야기를 묻는 거라면, 아직 기다리고 있어."이고, K2 출력은 "내일까지 갈아다 준다고 했던 거 말이지. 그건 네가 취소했어. … 그 약속은 취소된 채야."이다. 나머지 출력에서 "취소/철회" 단어가 나오는 것은 CURRENT는 DeepSeek r3과 Gemini, K2는 DeepSeek r1·r2·r3과 Gemini이고, CURRENT DeepSeek r1·r2는 "직접 갈겠다고 했다"로만 서술한다(`analysis/lexical-flags.md`). 산문 `[11~15턴]`은 두 arm 모두 취소를 담고 있다.
- P2: 샘플된 출력에서 두 arm 모두 "연인이 되었다"로 단정한 문장은 보이지 않고, 제안과 보류("지금은 답할 수 없다 / 시간이 필요하다 / 시선을 피함", Sol "지금 우리가 사귀는 사이라고 말할 수는 없어")를 서술한다. 이 정보는 두 arm 모두 산문 `[6~10턴]`이 유일한 출처다.
- 모든 장면에서 K2 출력이 CURRENT보다 전반적으로 짧은 경우가 많다(`cost-length-table.md`: DeepSeek P3 1983→1272자, Gemini P2 2228→1332자). Sol은 일부 장면에서 더 길다(P1 4274→4665). 방향이 일정하지 않고 N이 작아 해석하지 않는다.
- 두 arm 모두 DeepSeek P3에서 "내 검은 … 한 번도 안 갈았어" 같이 검의 소유 주체가 흐려진 문장이 나온다. fixture T15 "검은 내가 직접 갈게"가 원래 약속 방향과 겹쳐 모호하다는 fixture 한계다(§8).

### 비용

| 항목 | 예상(사전) | 실제 |
|---|---|---|
| extractor 20콜 (`gpt-6-luna`, 전용 실험 키) | ≈4원 | 3.77원 |
| Luna 요약 봉인 5콜 | ≈2원 | ≈1.1원 (`cheaperInferenceBilledCostUsd` 합) |
| RP 40콜 (캐시 할인 미적용 보수 환산, FX 1700) | 588원 (상한 968원) | **575.6원** (CURRENT 294.5, K2 281.1) |
| 합계 | ≈594원 | **≈580원 (< 1,000원)** |

첫 시도(`RP_QUALITY_PAID_CHEAPERINFERENCE_KEY`로 `gpt-6-luna`)는 403(해당 키는 모델 권한 없음)으로 20콜 전부 실패, 과금 0원. 이후 Luna 전용 실험 키로만 호출했다. 프로덕션 키·`CHEAPER_INFERENCE_BENCHMARK_API_KEY`는 사용하지 않았다.

## 6. STOP 조건 판정

| STOP 조건 | 판정 |
|---|---|
| 정상 유효 약속을 잃는가 | **전방 약속: 잃지 않음.** 실제 extractor가 T2·T6 약속을 4/4 저장, K2에서 인용 검증 통과 후 정본 헤더 아래 유지. **기존 약속: 잃음(강등).** 기존 ledger 항목은 원문 인용이 저장돼 있지 않아 K2 렌더에서는 전부 `미검증`이 된다 — B3와 같은 문제. 대안 K2′(근거 없는 항목은 지금처럼 렌더)는 유효 legacy 약속을 보존하지만 E4의 허위 legacy 약속과 구분이 안 된다. 또한 extractor가 category=relationship + scene_event를 고르면 유효 약속도 검증기에서 거부된다(§4.1). |
| 역할만으로 의미·수락·취소를 확정해야 하는가 | **K2는 확정하지 않는다.** 그러나 E2(수락 여부)와 E3(취소 대상)는 결정적으로 판정할 수단이 없어 "인용 병기 + 모델 판단"으로 남는다. E2는 현재 구조에서 ledger/episodic에 저장되지도 않고 산문만 담는다. |
| 새 verifier LLM / 별도 기억 시스템이 필요한가 | **전방 약속: 불필요**(기존 `evaluateEpisodicFactEvidence` 재사용). **legacy 약속의 근거 백필: 필요**(원문에서 인용을 다시 찾는 LLM 단계) — STOP 조건에 해당하므로 시도하지 않음. |
| 기존보다 감정·관계 기억을 적게 보존하는가 | 산문(감정·관계 서술)은 K2에서 byte-identical이라 감소 없음. 단 K2는 ledger 약속의 **gloss를 버리고 인용만** 렌더하므로 인용이 부분 문장일 때 ledger 쪽 세부(예: "북문 앞")가 줄어든다. 산문에 남아 있어 이번 fixture에서는 최종 wire 전체의 정보량은 줄지 않았지만, 산문이 해당 구간을 요약하지 못하면 줄 수 있다. |

K2를 제품에 넣으려면 변경해야 하는 정본: 약속 스키마(`{text, deadline}` → 근거 필드), `parseSharedRelationshipSection`/strict schema 화이트리스트, Shared Initial 프롬프트, `mergePromises`/`formatMemoryMetaForPrompt`, 저장 JSON. 새 owner는 아니지만 5곳이며 DB에 저장된 기존 데이터는 마이그레이션 없이는 근거가 없다(마이그레이션은 이번 범위 밖, 건드리지 않음).

## 7. 선택지 (GPT 검수 판단용, 구현 아님)

1. **현상 유지 + 취소 반영만 정정**: E3의 근본 원인은 삭제가 정확 문자열 일치인데 Shared Initial이 ledger를 못 본다는 점. Shared Initial 입력에 현재 약속 목록을 보여 주는 것이 최소 수정 후보(이 경우 새 근거 스키마 불필요). 이번 실험에서는 검증하지 않음.
2. **K2′ (전방 약속만 근거 인용, legacy는 현행 렌더)**: 전방 데이터의 허위 승격은 막고 legacy 유효 약속은 잃지 않는다. 대신 이미 저장된 허위 legacy 약속은 그대로 남는다.
3. **B3 전체 강등**: 이번 실험으로도 유효 약속과 허위 약속이 같은 헤더에 들어가는 점이 확인되어 권장하지 않음.
4. **보류**: E2는 어느 후보로도 개선되지 않으므로, 관계 제안/보류를 ledger나 episodic에 담을지는 별도 설계가 필요하다.

## 8. 한계 (정직 표기)

- 합성 80턴 1개, 사건당 extractor N=4(2 arm × 2 rep), RP는 DeepSeek N=3, Gemini/Sol N=1. 통계 주장 불가.
- 등록 캐릭터·관리자 페르소나·실제 사용자 데이터 미사용. 프로덕션 DB·배포 미접촉.
- extractor/요약 모델은 `gpt-6-luna`로 가정(프로덕션 실제 설정은 이번에 재확인하지 않음).
- fixture T15 "검은 내가 직접 갈게"는 방향이 모호해 일부 출력의 검 소유 혼선을 만들었다.
- K2의 `evidence`·`promisesRemoveEvidence`는 harness 스키마 패치이고, 제품 파서는 이 필드를 버린다(`extractor-results.json`의 `parsedRelationship`에 evidence가 없음). 근거는 `rawText`와 dump 재생에서만 사용했다.
- T24 허위 전제와 라이크의 부인은 raw history로 wire에 직접 들어가 있다. 즉 P4는 "기억에서의 허위 승격"과 "히스토리에서의 즉시 반박"이 섞인 조건이다.
- 점수·승패 판정 없음.

## 9. 파일

| 경로 | 내용 |
|---|---|
| `probes/zz-g8-fixture.ts.txt` | 합성 80턴, 사건 정답표 |
| `probes/zz-g8-extract.ts.txt` | 실제 extractor 캡처(cur/k2 arm, 비용 상한, 키 가드) |
| `probes/zz-g8-dump.test.ts.txt` | live owner 재생 + 실제 검증기 매트릭스 |
| `probes/zz-g8-variants.ts.txt` | B3·K2 렌더러 |
| `probes/zz-g8-prepare.test.ts.txt`, `zz-g8-execute.ts.txt` | wire 조립(36개) / 유료 호출(40콜, 상한·watchdog) |
| `data/extractor-results.json`, `data/dump-main.json` | 원자료 |
| `wire/` | wire 36개 + `manifest.json` (CURRENT/B3/K2, B3는 호출 없음) |
| `results/` | 40콜 원응답·usage·비용 |
| `analysis/` | wire-diff, outputs-labeled, blinded-packets/key, cost-length-table, lexical-flags |
| `execute.log` | 호출 로그 |
