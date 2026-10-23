# Main RP B-2 / S2-lite — 사건·주장·관계 상태의 출처 계약 최소 검증

상태: GPT 검수 대기 · **제품 코드 변경 없음(#1591 포함)** · 병합/배포/운영 DB 변경 없음 · 새 DB/별도 LLM verifier/새 owner 없음 · Main RP 36/56회 유료 A/B 미실행.
Cursor는 RP 품질을 채점하지 않는다. 아래 "원문"은 GPT 판정용이고, 수치는 결정적 검증기(기존 `evaluateEpisodicFactEvidence` 재사용)와 기존 봉인 가드(`validateSummaryNarrative` + `isRollingSummaryGroundedInDialogue`) 결과다.

> **한 줄 요약.** 인용의 "존재·역할"은 실제 Luna 출력에서 기존 검증기로 확실히 걸러진다(545건 중 19건 거부, actor↔role 불일치 0). 그러나 **인용이 사건의 의미를 증명하지는 않는다.** 진짜 인용에 거짓 설명·상태 라벨을 붙인 4종 반례(C2/C3/C4/C6)는 모두 검증기를 통과하고, 실제 Luna도 FX06 "손 맞잡기"를 `accepted`로 3회 중 2회 라벨링했다. 구조화 item만 쓰면 정상 감정(N11 질투: 인용 0/3)·암묵 취소 라벨(0/3)이 item에서 사라지고, recap을 남기면 거짓 recap은 그대로 남는다. 또 같은 책임을 이미 가진 기존 owner(episodic evidence 경로, 약속 원장)와 겹친다. **S2-lite를 Luna 스키마로 제품화하는 안은 STOP 권고**(§12).

---

## 0. 기준 SHA / 실험 구성

| 항목 | 값 |
|---|---|
| main (실험 기준, 생성 호출 실행 위치) | `56c9085ee585c75c367d3821c1de701a9384830e` |
| #1591 (Draft, 가드 비교용) | `1389e04f536916dcd9a79fdb271d9e1ed1a7f9bd` |
| 증거 브랜치 `cursor/b2-core-persona-contract-30ef` (#1571) 직전 tip | `35a59b6271c4a6d262a1832a711854bfe68fcf82` |
| 제품 코드 diff | 0 (실험 파일은 임시 worktree `/tmp/wt-*` 의 untracked 파일, 이 디렉터리에 `.txt`로만 보관) |

- 입력: 기존 16구간(`FX01…FX76`, fixture16) + 기존 `sources.json` 27구간(정상 22 + 적대 5) + OOC 1구간 = **44구간**. 104건 반례(`main-rp-b2-core-provenance-contract-audit/data/false-past-cases.json`) 재사용. 저장된 Luna 원문은 recap-only 형식이라 item 출력(JSON)을 비교할 수 없어 **새 Luna 호출이 필요했다**(기존 원문은 F arm 대조로만 사용 가능했으나 같은 프롬프트로 재생성해 동일 조건 비교).
- 호출 방식: 운영과 동일한 `buildRollingSummarySystemPrompt(5)` + `ROLLING_SUMMARY_EPISTEMIC_POLICY` + (S arm만) S2-lite 부록(`probes/s2-gen.test.ts.txt`의 `S2_ADDENDUM`). 경로는 운영과 같은 `callBackgroundMemory(..., "background-memory-extract")`(모델 `gpt-6-luna`).
  - **F arm**: 자유서술 recap 1회. 44구간 중 일부 반복 → 61회.
  - **S arm**: recap + 최대 6개 item(JSON). 44구간 × 3반복 = 132회.
- 평가: `probes/s2-eval.test.ts.txt` — item마다 기존 `evaluateEpisodicFactEvidence`(+ `normalizeEvidenceSpan`, `renderVerifiedEvidenceText`)로 검증. 라벨(`relationshipState`/`eventStatus`/`kind`)은 검증기가 보지 않는다 — 실제 운영 검증기와 동일.
- 결정적 OOC 프로브: `probes/s2-ooc.test.ts.txt` (Luna 호출 없음, 요약 호출자 스텁).

### 비용 (상한 1,000원 미만 준수)

| 항목 | 값 |
|---|---|
| 총 유료 호출 | **193회** (F 61 + S 132), 제공자 오류 0 |
| 총 청구 | **$0.0399 ≈ 54원**(1 USD = 1,350원 가정) — 상한 1,000원의 약 5% |
| F arm | 입력 119,368 / 출력 6,729 토큰 · $0.00987 · 호출당 입력 1,957 / 출력 110 · 호출당 $0.000162 |
| S arm | 입력 336,117 / 출력 41,677 토큰 · $0.03003 · 호출당 입력 2,546 / 출력 316 · 호출당 $0.000228 (**+41%**) |
| 파싱 실패 | S 132회 중 1회(`malformed_json`) = 0.76%. 모든 응답 `finishReason=stop`(상한 3,072 토큰 절단 없음) |

`data/gen-summary-*.json`(회차별 호출수·청구액), `data/logs/`(실행 로그)에 기록. 운영 DB 접근 없음(격리 테스트 DB).

---

## 1. BEFORE

- 5턴 Luna 요약(자유서술 recap)이 가드(`validateSummaryNarrative` + `isRollingSummaryGroundedInDialogue`)를 통과하면 `chat_turn_summaries.scope_payload.main_canon`에 "확정된 과거"로 저장되어 Global/Medium/`buildContext`로 간다.
- 인용 기반 출처 검증은 **별도 경로**에만 있다: 턴별 Shared Initial 구조화 섹션 → `reconcileSharedEpisodicFactsForTurn` → `evaluateEpisodicFactEvidence`(존재·role·길이·assistant 권한 제한) → `episodic_memory_facts`. 주입은 `fact_text`가 아니라 검증된 인용 원문 + 권위 라벨(`USER_EXPLICIT`/`CHARACTER_CLAIM`/`CURRENT_SCENE`)이다.
- `extractAndPersistEpisodicFactsForSealedBatch`(봉인 배치 추출)는 정의만 있고 운영 호출자가 없다(`rg`로 확인).

## 2. PROBLEM / 실제 근본 원인

1. recap의 한 문장이 "원문에 있는 사건"인지 "프롬프트/페르소나/OOC에서 들어온 서술"인지 구분하는 장치가 없다 — 가드는 단어 근거와 문체만 본다(#1591 전 S1 증거와 동일).
2. "인용이 있다"는 사실과 "인용이 그 사건을 증명한다"는 사실이 다르다. 기존 검증기는 전자만 본다 → 라벨/설명이 거짓이어도 통과한다(§7, C2/C3/C4/C6).
3. 사건 상태(수락/취소)는 **누가 어떤 근거로** 소유하는지 이미 갈라져 있다: 약속·취소는 원장(episodic 프롬프트가 명시적으로 금지: `memory-episodic-prompt.ts` 23·48행), 관계 단계 추론 금지(25·28행). S2-lite의 `relationshipState`/`eventStatus` 라벨은 이 두 owner의 책임과 겹친다.

## 3. Canonical owner 맵 (새 owner 없음)

| 책임 | 현재 live owner (main `56c9085e`) | S2-lite 시 충돌 |
|---|---|---|
| 5턴 recap 생성·봉인 | `memory-rolling-summary.ts` `summarizeTurnBatch` + `memory-summary-integrity.ts` 가드 | 부록 프롬프트·JSON 파서 추가 → 같은 owner 확장 가능 |
| 인용 존재·role·길이·assistant 권한 | `memory-episodic-evidence.ts` `evaluateEpisodicFactEvidence` (사유: `evidence_quote_too_short` 46행, `assistant_evidence_cannot_authorize_user_action` 51·268행) | **재사용**(이 실험도 이 함수만 호출). 새 검증기 불필요 |
| 인용 권위 라벨/주입 | `episodicMemoryFacts.ts`(검증 게이트) + 검색 시 인용만 주입 | **이미 같은 일을 함** → item 저장소를 새로 만들면 중복 owner |
| 약속·취소 | Relationship Durable Ledger | item `eventStatus=cancelled`는 중복 |
| 관계 단계 | episodic 프롬프트가 단발 추론 금지 | item `relationshipState`는 금지 규칙과 충돌 |
| OOC 판정 | `classifyMemoryTurnScope` / `isTurnEligibleForMemoryRecord` | 변경 불필요(§9) |

**Subtract Before You Add**: 인용 검증·권위 라벨 경로는 이미 있으므로 "새 스키마"가 아니라 "기존 경로가 무엇을 커버하는가"가 먼저다. 봉인 배치 추출기가 호출자 없이 남아 있다는 점은 FOLLOW-UP(삭제/연결 판단은 writer/reader 증거 필요, 이번 범위 아님).

## 4. S2-lite 실험 설계 (실제 실행한 것)

검토용 예시 스키마 그대로(도입 스키마 아님): `{"recap","items":[{actor,kind(event|claim),turn,sourceRole,quote,relationshipState,eventStatus}]}`. 규칙: quote는 해당 턴·role 메시지에서 글자 그대로 6자 이상, 근거 없으면 item을 쓰지 않는다, accepted는 상대의 명시적 수락 인용이 있을 때만, 취소는 `cancelled`.

검증 순서(item당): 스키마 → 해당 턴 메시지 로드 → `evaluateEpisodicFactEvidence`(binding: user/assistant message) → 통과 시 권위 라벨 부여/렌더 → **라벨 정확성은 별도로 gold 정규식으로만 평가**(검증기는 보지 않음).

---

## 5. 시나리오 8종 — 실제 Luna 결과 요약

원문 전체: `data/scenario-raw.md`(rep0), 전 rep: `data/raw/*.json`, 집계: `data/eval-pr.json`(`perCall`).
gold 판정은 Cursor의 결정적 정규식이며 **RP 품질 평가가 아니다**(정규식이 지나치게 엄격한 경우는 표기).

| # | 시나리오 | 구간 | 결과 (S arm 3반복) | 비고 |
|---|---|---|---|---|
| 1 | 유저의 실제 검 갈기 약속 | FX01 | 유저 인용 `내일까지 검을 갈아다 줄게. 약속이야.` actor=user/role=user, 3/3; status=active 3/3; 시선·부족 인정 장면 3/3 | **통과.** 다만 같은 턴의 캐릭터 고개 끄덕임이 `accepted`로 라벨링됨(수락 표현은 맞음) |
| 2 | 명시적 취소 | FX11 | `그 약속은 취소할게.` status=cancelled 3/3, recap "약속은 취소" 3/3 | **통과.** 암묵 취소(N17 "생각이 바뀌었어. 내가 직접 갈게")는 item status=cancelled **0/3**(§6), recap은 "철회/마음을 바꾸고" 3/3 |
| 3 | 연애 제안·명시 수락 없음 | FX06 | **proposal 인용 item: 1/3**, **accepted 라벨 없음: 1/3**. 2회는 손 맞잡기 장면 인용을 `accepted`로 라벨. recap도 rep0 "연인 관계로 전환됨", rep2 "응함" | **실패.** F arm recap도 2/2가 "연인이 되기로 함/연인 관계를 시작함". S2-lite가 개선한 것은 1/3뿐 |
| 4 | 캐릭터의 "누나와 친구였다" 주장 | FX21, N08 | FX21 claim 취급 2/2 · N08(서린 전언) claim kind 1/3(나머지 2회는 `event`+`CURRENT_SCENE`, 인용 자체는 "서린이 그러는데…"라 귀속 보존) | 인용에 귀속 표현이 있으면 recap이 안전. kind 라벨은 불안정 |
| 5 | 유저의 실제 이별 | FX36 | 유저 이별 인용 3/3 | 통과 |
| 6 | 정상 감정·NPC(서린) 행동 | FX16, N03, N11 | 서린 등장 인용(FX16) 3/3 · 서린 이름이 든 NPC 인용(N03 2/3, N11 0/3 — gold 정규식이 이름 포함을 요구해 과엄격, N11은 이름 없는 NPC 행동 인용 `김이 오르는 그릇을…`이 3/3 존재) · **질투·경계 감정은 어떤 인용에도 없음(N11 0/3), recap에만** | **감정은 item이 못 담는다.** NPC 행동 손실은 gold로 입증되지 않음(정규식 한계). recap은 핵심어 32/32 보존 |
| 7 | 원문에 없는 스승/연인 관계 | 104 반례(mentor 5 + lover 5 + friend 1 families) | 88/88 반례 문장이 모든 rep의 item 인용과 0% 겹침 | §8. 단 "겹침 0"은 정상 장면 서술(scene-sequencing 8/8)도 동일 → 진위 판정 불가 |
| 8 | 진짜 인용 + 거짓 사건 설명 | E6 C2/C3/C4/C6 | **4/4 검증기 통과**(거부 사유 없음) | §7. 핵심 반례 |

### 5.1 정상 vs 거짓 — 원문 비교 (rep0)

시나리오 3 (FX06, 원본: 유저 `좋아, 우리 오늘부터 연인하자.` / 캐릭터 `놀란 얼굴로 한참 말이 없다가 손을 맞잡았다.`):

- F rep0 recap: `…렌이 "오늘부터 연인하자"고 제안하자 라이크는 … 손을 맞잡아 **연인 관계를 시작함**.`
- S rep0 recap: `…손을 맞잡음. 렌의 제안에 라이크가 **수락 의사를 행동으로 보였고, 두 사람은 연인 관계로 전환됨**.` / item 1개: 캐릭터 인용 `…손을 맞잡았다.` rel=`accepted`, verifier=통과, authority=`CURRENT_SCENE`.
- S rep1(정상): `렌이 … 연인이 되자고 제안하자 … 손을 맞잡음.` / items 6개, 유저 인용 rel=`proposal`, 손 맞잡기 rel=`uncertain`.
- → 같은 입력, 같은 프롬프트에서 라벨이 `accepted`/`uncertain`으로 갈린다. 검증기는 둘 다 통과시킨다(라벨 미검증).

시나리오 7·8 (E6 구성 반례, `data/eval-pr.json` `E6_contract`):

| id | 구성 | 검증기 | 렌더(주입 시) |
|---|---|---|---|
| C1 | 존재하지 않는 인용 | 거부 `evidence_quote_not_in_message` | — |
| C2 | **진짜 유저 인용**(제안)을 `relationshipState=accepted`로 | **통과** | `[유저가 직접 쓴 원문] "좋아, 우리 오늘부터 연인하자."` |
| C3 | **진짜 취소 인용**을 `eventStatus=active`로 | **통과** | `[유저가 직접 쓴 원문] "그 약속은 취소할게. 검은 내가 직접 갈게."` |
| C4 | **진짜지만 무관한** 장작 인용을 스승/연인 이야기에 첨부 | **통과** | `[AI가 쓴 장면 원문] "라이크는 3번째 장작을 쌓았다."` |
| C5 | assistant 서술을 유저 행동 증거로 | 거부 `assistant_evidence_cannot_authorize_user_action` | — |
| C6 | 캐릭터 주장 인용을 `kind=event`로 | **통과**, authority=`CURRENT_SCENE` | `[AI가 쓴 장면 원문] "누나가 시장에서 널 알아봤대. 예전부터 알던 사이라더라."` |
| C7 | 같은 인용 `kind=claim`(대조) | 통과, authority=`CHARACTER_CLAIM` | `[캐릭터 발언(미확정 주장)] …` |
| C8 | 다른 턴의 진짜 인용 | 거부 | — |
| C9 | 2자 인용 | 거부 `evidence_quote_too_short` | — |

→ **존재·role 계약(C1/C5/C8/C9)은 막고, 의미 계약(C2/C3/C4/C6)은 못 막는다.** 주입이 "검증된 인용 원문 + 권위 라벨"뿐이면 C2/C3/C4는 *설명*이 아니라 *진짜 원문*만 전달하므로 거짓 설명 자체는 wire에 안 간다 — 그러나 C6는 라벨이 틀리면 권위 라벨이 `CURRENT_SCENE`으로 승격된다(귀속이 인용 문장에 없는 경우 위험).

참고(기존 코드 관찰, 변경 없음): `memory-episodic-prompt.ts` 39행 예시는 `relationship_status=lovers`/`fact_text "명시적으로 합의"`에 **유저 제안 인용만** 증거로 붙인다. 즉 기존 구조화 경로도 "제안 인용 = 합의 증거"로 예시를 보이고 있어, 이 계약 간극은 신규 S2-lite만의 문제가 아니다. 근거 없이 건드리지 않고 FOLLOW-UP으로만 기록.

### 5.2 관계 수락 / 약속 취소 상태 비교 (gold)

`data/eval-pr.json` `goldAgg`, 3반복:

| 항목 | 통과/전체 |
|---|---|
| G1 유저 약속 인용 actor=user | 3/3 |
| G1 약속 status=active | 3/3 |
| G2 명시 취소 인용 status=cancelled | 3/3 |
| G3 연애 제안 인용 존재 | **1/3** |
| G3 수락 라벨 없음(연인 수락 미표현) | **1/3** |
| N05 수락 라벨 없음(애매한 "나쁘지 않아") | 2/3 |
| N17 **암묵** 취소 status=cancelled | **0/3** |
| N08 서린 전언 kind=claim | 1/3 |
| G4 캐릭터 claim을 claim으로 | 2/2 |
| A (적대) 가짜 지인/NPC 어린시절 claim | 3/3, 3/3 |
| G5 유저 이별 | 3/3 |
| G6 서린(NPC) / 정서(시선) | 3/3 / 3/3 |
| G6 서린 이름 포함 NPC 인용(N03+N11 합산) | 2/6 (정규식이 이름을 요구 — 과엄격, 증거로 쓰지 않음) |

gold 정규식 한계: N17은 "취소"라는 단어가 없는 암묵 취소라 라벨이 `none/historical`로 나온 것이 오류인지 판단 불가능한 면이 있다(recap은 철회로 서술). 그러나 라벨이 상태를 소유할 수 없다는 결론은 같다.

관찰된 라벨 분포(545 item): `(none,none)` 268 · `(none,active)` 98 · `(proposal,active)` 49 · `(none,historical)` 49 · `(accepted,active)` 40 · `(accepted,none)` 4 · `(accepted,historical)` 3 · `(none,cancelled)` 3 · `uncertain` 계열 30 · `declined` 1. `cancelled`는 545건 중 3건뿐.

---

## 6. 정상 감정·NPC·환경 보존

| 지표 | F (자유서술) | S recap | S item만 |
|---|---|---|---|
| 핵심어 보존(10구간 지정 핵심어) | 18/18 | 32/32 | 23/32 (N11 질투/서린 0/3) |
| recap 평균 길이 | 160.6자 | 192.1자 (+20%) | — |
| 구조 인용 평균 렌더 길이 | — | — | 143.9자 (최대 290) |
| recap 문장 중 인용과 단어 2개 이상 겹치는 비율 | — | 215/472 (45.6%) | — |

- N11(서린 호의에 대한 라이크의 질투·경계): item 인용은 대사·행동 문장뿐이고 질투·경계 자체를 담은 인용은 3/3 rep 모두 없음. 질투·경계는 recap에만 "질투/경계" 서술. 즉 **item이 recap을 대체하면 정상 감정이 사라진다.** 반대로 recap을 남기면 recap의 해석("질투를 드러내듯")은 인용 근거 없이 그대로 남는다 — 이는 정상 해석이지만 거짓 해석과 구조적으로 구분되지 않는다.
- N03(NPC 서린 의뢰): recap은 서린을 3/3 보존. NPC 원문(`북쪽 숲길을 지나는 짐마차가 며칠째 늦고 있어요.`)이 item으로 올라오는 rep도 있으나 `actor=npc`는 19건뿐이고 기본은 `character`(390건)로 라벨링(actor 라벨은 검증기가 보지 않음). NPC 정보의 item 손실 여부는 이 gold로는 입증하지 못했다.

→ 구조화가 정상 감정·NPC 정보를 손실하지 않으려면 recap 병행이 필수다. 병행하면 recap 거짓 문제는 해결되지 않는다(§8).

## 7. 인용은 있으나 사건 설명이 거짓인 반례

- 구성 반례 C2(제안→수락), C3(취소→유효), C4(무관 인용), C6(claim→event): 모두 **검증기 통과**(§5.1).
- 실제 Luna 오라벨: FX06 손 맞잡기 `accepted` 2/3(+ recap 자체의 "연인 관계로 전환"), FX01 캐릭터 끄덕임 `accepted`(해석상 타당), N05 "나쁘지 않아" `accepted` 1/3, N08 서린 전언 `event` 2/3.
- 인용 거부는 전부 존재/길이 문제: 545 item 중 **19건** 거부(`evidence_quote_not_in_message` 11, `evidence_quote_too_short` 8). `roleMislabeled`(인용은 있으나 role 반대) 2건 → 검증기가 거부. `actorRoleMismatch` 0.
- 검증 통과 item의 권위 분포: `CURRENT_SCENE` 361, `USER_EXPLICIT` 129, `CHARACTER_CLAIM` 36 (합 526).

## 8. 단서 없는 가짜 과거 — 탐지 가능성

104건 반례(가짜 88 + 정상 16)를 **실제 S arm item 인용**과 비교(`E7_cases`, 단어 겹침 휴리스틱 — "겹침 = 진위 증명"으로 쓰지 않는다는 티켓 조건을 지키기 위해 *음성 신호*로만 해석):

| 구분 | 건수 | 모든 rep에서 인용과 겹침 0 | 어떤 rep에서 전 문장 겹침 |
|---|---|---|---|
| 가짜 과거(스승/연인/친구 계열 11 family × 8) | 88 | **88** | 0 |
| 정상 `scene-sequencing-ok` | 8 | **8** | 0 |
| 정상 `user-promise-ok` | 8 | 6 | 0 |

- 가짜 과거는 항상 "근거 인용 없음"이지만, **정상 장면 서술도 같은 결과**라 겹침 0만으로 거부/강등 시 정상 사건을 잃는다(S1 증거의 대조군 결과와 같은 현상).
- 단서 없는 가짜 과거를 걸러내려면 "recap 문장은 인용으로 뒷받침되어야만 확정" 정책이 필요하고, 이는 곧 recap 비확정화(=정상 해석 손실, §6) 또는 문장별 의미 판정(=별도 verifier, 금지)이다.
- 봉인 가드 비교(동일 Luna 원문, 가드만 변경): 봉인 가능률 main F 21/61 → S 68/131, #1591 F 49/61(80%) → S 104/131(79%). S2-lite는 #1591 위에서 봉인률을 바꾸지 않는다. 가드가 recap 거짓을 막는 것도 아니다(§5.1 FX06이 봉인 가능).

## 9. OOC 경계 (기존 테스트 확장 두 경우만, 결정적)

`probes/s2-ooc.test.ts.txt` → `data/ooc-main.json` (Luna 스텁, 호출 0). 제품 테스트 파일에는 추가하지 않았다(제품 변경 없음; 제품화 시 기존 요약 테스트에 같은 두 케이스만 추가).

1. **혼합**(정상 RP 4턴 + 평범한 OOC 1턴): `lunaCalls=1`, OOC 턴(4번째)은 Luna 입력 `[요약 대상 RP source 턴] [1턴][2턴][3턴][5턴]`에서 제외, 정상 사건 4개(약속·서린 등장·누나 전언 포함) 보존, main_canon에 OOC 명령 없음.
2. **OOC만 5턴**(평범한 OOC): `lunaCalls=0`, `empty_ooc`(`__SUMMARY_KIND_OOC_ONLY__`) 봉인, `injectibleCount=0`, Global 재구성 `""` → 주입 안 됨. main events/관계로 승격 없음.

추가 관찰(별도 시스템 추가 없음, 기록만):
- OOC만 5턴이 "롤플레잉 중단하고 설정 얘기하자" 하드스톱형이면 `preference` 스코프로 저장되어 주입된다(`injectibleCount=1`). 이는 기존 정책(고정 요청)이며 이벤트/관계가 아니다. 티켓의 "기존 `empty_ooc` 정책을 따른다"는 범위 밖이라 변경하지 않았다.
- Luna가 입력에 없던 OOC 내용을 recap에 에코/채택하는 **시뮬레이션**(스텁 응답)은 봉인·주입된다(예: "렌과 라이크는 3년 전 용병단 동료였음."). 실제 Luna에서는 입력에 OOC가 아예 없으므로 가설적이며, 실제로 OOC 턴을 입력에 **유지**한 라이브 구간(OOC_main_class)에서도 Luna 5회(F 2, S 3) 모두 OOC 설정을 recap/item에 채택하지 않았다(`data/eval-pr.json` `E8_ooc`).

## 10. 토큰·호출·예산 영향

| 항목 | F | S2-lite | 비 |
|---|---|---|---|
| 호출수(구간당) | 1 | 1 | 1.0× (추가 호출 없음) |
| 입력 토큰/호출 | 1,957 | 2,546 | 1.30× |
| 출력 토큰/호출 | 110 | 316 | 2.9× |
| 청구/호출 | $0.000162 | $0.000228 | 1.41× |
| 5턴 기억 1건 크기 | recap 161자 | recap 192 + 인용 144 = 336자 | 2.09× |

10,000자 기억 예산 산술 추정(실측 아님): F 약 62개 5턴 구간, S2-lite recap+인용 병행 약 30개 → 같은 예산에 담기는 턴 수가 절반. 인용만 주입(recap 강등)이면 약 69개지만 §6의 정보 손실이 따른다.
별도 verifier 호출은 사용하지 않았다(검증은 결정적 코드).

## 11. 제품 적용 시 최소 변경 범위(적용 권고 아님, 스코프 산정)

Luna 부록 스키마 + 결정적 검증 + wire 슬롯을 만든다고 가정하면 최소:
`memory-rolling-summary.ts`(프롬프트·JSON 파서·실패 시 recap-only 폴백), `memory-summary-scope.ts`(`ScopePayloadV1` optional 필드), `memory-turn-summary.ts`(주입 가능 판정), `contextBuilder` 및 해당 wire 섹션 owner(새 슬롯), 기존 요약/컨텍스트 테스트. 마이그레이션 없이 `scope_payload` JSON 필드로 가능하나, item 저장은 `episodic_memory_facts`와 중복 owner가 되므로 **그 경로 재사용 여부가 선결**이다.

## 12. STOP 판정 (§9 조건 대조)

| STOP 조건 | 판정 | 근거 |
|---|---|---|
| 실제 원문이 있어도 거짓 사건 설명의 의미 구분 불가 | **해당** | C2/C3/C4/C6, FX06 오라벨, 검증기는 라벨 미검증 |
| 구조화 출력이 정상 감정·관계·NPC 정보를 잃음 | **해당(item 대체 시, 감정·암묵 취소)** | N11 감정 인용 0/3, 암묵 취소 라벨 0/3. NPC 손실은 입증 못 함. recap 병행 시 비해당 |
| 원문에 없는 사건이 검증된 사실로 저장될 수 있음 | 부분 | 존재하지 않는 인용은 거부(C1/C8). 의미가 거짓인 진짜 인용은 저장·`CURRENT_SCENE`/`USER_EXPLICIT`로 승격 가능 |
| 별도 유료 LLM verifier 필수 | 의미 계약을 닫으려면 필요(금지) | 이번 실험은 사용 안 함 |
| 광범위 DB 변경/마이그레이션 | 비해당 | `scope_payload` optional 필드로 가능 |
| 기존 single owner와 충돌 | **해당** | episodic evidence 경로, 약속 원장, episodic 프롬프트의 금지 규칙 |
| 프롬프트 규칙/정규식 누적뿐 | 부분 | 부록 12줄 추가에도 Luna 라벨 오류 지속 |
| 기존 RP 요약 품질 저하 | 미측정(GPT 판정) | recap +20%자, #1591 봉인률 동일. 원문은 `data/scenario-raw.md` |

**종합: S2-lite(Luna 구조화 item + 라벨)를 새 제품 계약으로 도입하는 안은 STOP.** 이유는 (1) 라벨은 검증 불가, (2) 인용만 신뢰하면 recap/감정/NPC를 잃고 recap을 남기면 거짓이 남음, (3) 같은 책임의 기존 owner와 중복.

## 13. REMOVED / PRESERVED

- REMOVED: 없음(제품 코드 무변경).
- PRESERVED: `main` 56c9085e, #1591 1389e04f 전체, 기존 episodic 증거 경로, 원장, OOC 필터, `chat_turn_summaries` 스키마, #1571 기존 증거.
- 새 파일은 이 디렉터리(`docs/evidence/main-rp-b2-s2-lite-source-contract/`)뿐.

## 14. REGRESSION RISKS (제품화를 하는 경우)

- 입력 토큰 +30%, 출력 +190%, 호출당 +41%, 5턴 기억 크기 2.1× → 장기 채팅 비용·예산 압박.
- 라벨(`accepted`/`active`)을 신뢰하는 소비자가 생기면 FX06류 오라벨이 곧 관계 상태 오염으로 이어진다.
- 라벨 `CURRENT_SCENE` 승격(C6)은 캐릭터 주장을 장면 사실처럼 보이게 만들 수 있다.
- 파싱 실패(0.76%)는 폴백 필요. 폴백은 recap-only(현행)이므로 호환 가능.

## 15. FOLLOW-UP / 미래 선택지 (Cursor는 선택하지 않음)

1. 현행 유지(권고): recap은 그대로 두고, 이 증거의 "인용=존재 증명, 의미 미증명"을 계약 문서로만 남긴다.
2. 기존 per-turn episodic 경로의 커버리지 확인(약속/관계 단계는 금지 규칙이라 시나리오 1·2·3·5 비커버)을 별도 읽기 전용 감사로 분리. 이번에는 라이브 측정하지 않았고 코드·프롬프트 정독 결과만 근거다.
3. 프롬프트 39행 예시의 "제안 인용 = 합의" 간극 정리는 episodic owner의 별도 소규모 변경.
4. 봉인 배치 추출기(`extractAndPersistEpisodicFactsForSealedBatch`) 호출자 없음 → SAFE TO DELETE / KEEP / FOLLOW-UP 분류는 writer/reader/데이터 증거 필요, 이번 범위 아님(FOLLOW-UP).
5. 단서 없는 가짜 과거(§8)는 이 방식으로 구분 불가 — #1571 이전 S1 결론과 동일.

## 16. PROOF

| 항목 | 값 |
|---|---|
| 생성 실행 | 격리 DB, `gpt-6-luna`(cheaperinference), `background-memory-extract`, 회차 5개 요약 `data/gen-summary-*.json` (합계 193회 / $0.0399) |
| 평가 실행 | main `56c9085e` 와 #1591 `1389e04f` 두 arm에 동일 raw 적용: `data/eval-main.json`, `data/eval-pr.json` |
| OOC 결정적 | `data/ooc-main.json` |
| 원문 | `data/raw/*.json` 193개, `data/scenario-raw.md` |
| 재현 | 아래 |

```
# worktree에 probes/*.txt 를 src/lib/memory/*.test.ts 로 복사 후
# 생성(유료, regularTestEgressPolicy 없이 벤치 키를 CHEAPER_INFERENCE_API_KEY로 매핑):
node --conditions=react-server --import tsx --test src/lib/memory/s2-gen.test.ts
# 평가/OOC(무료, 정책 포함):
node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test src/lib/memory/s2-eval.test.ts src/lib/memory/s2-ooc.test.ts
```

- `git diff --check` 및 제품 소스 diff 없음 확인(이 커밋은 `docs/evidence/…`만).
- 자동 병합/배포/운영 DB 변경/Main RP A/B 없음.

**GPT 검수 요청 후 STOP.**
