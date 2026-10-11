# RFC — TRPG vNext: AI 서사 중심 게임 엔진 (PHASE 0)

- Tracking: #1541 (관련 #1494 #1517 #1451 #1450 #1435 #1481 #1463)
- 분류: ARCHITECTURE / FEATURE REDESIGN — **PHASE 0 (설계 + 기준선만)**
- Base: main `796d279f`. runtime 변경 0, provider 호출 0, DB 쓰기 0.
- 사실의 원천은 현재 main의 production 실행 경로다. 과거 채팅/PR 설명이 아니다.
- RP 문장 품질은 이 문서에서 **점수화하지 않는다** (§12 에서 GPT/사용자 평가 프로토콜만 정의).

재현 가능한 증거: `baseline/README.md`, `baseline/baseline-796d279f.json`, `scripts/trpg-vnext-baseline.ts`, `fixtures/action-corpus.json`.

---

## 0. 결론 (TL;DR)

1. **권고 = 아키텍처 B**: 검증된 인프라(서버 d20, 락/동시성, 시트·원장 저장, 과금 분배, seal 파이프라인, localSceneProgress)는 재사용하고, **판정 / 결과 승인 / 서사 계약**만 다시 설계한다.
2. 현재 결함의 공통 뿌리는 하나다: **"GM이 같은 응답에 쓴 숫자/문자열을 서버가 근거 없이 상태로 승인한다"** (H1 H4 H5 H6 H7, 아이템 H8). 동시에 **"칩/regex가 의미 없이 굴림을 강제한다"** (no_roll 20건 중 칩 20/20 오롤, free 7/20 오롤).
3. 해법의 중심 아이디어: **해석은 열고(AI/문맥), 승인은 닫는다(서버 + 사전 provenance)**. 서버가 *먼저* 결과(피해 등급·대가·진행)를 승인하고, GM은 승인된 결과를 한국어 소설로 쓴다.
4. 새 provider 호출 없이 가능한 첫 단계가 있다(§6). 별도 모델 호출(Attempt Reader)은 **과금 구조 결정이 필요**하므로 STOP/승인 항목이다(§13).
5. 실제 GM 문장 품질은 **UNVERIFIED** — 승인된 유료 호출 + GPT/사용자 평가 전에는 어떤 슬라이스도 "품질 개선"이라고 주장하지 않는다.

---

## 1. BEFORE — 현재 production 경로 (main `796d279f`)

```
submit (인간 행동 + 클라이언트 칩 actionType)
  → adjudicateLockedHumanSubmissions      roundAdjudication.ts  (결정 freeze + 서버 d20)
      └ adjudicateCanonicalSubmission → resolveTrpgActionCheckDecision (actionCheck.ts, regex)
  → generateBotActions                     engineAdvance.ts      (봇: <<<ACTION_TYPE>>> / <<<INTENT>>> 자기선언)
  → finalizeRoundAdjudication
  → runGmForRound                          engineAdvance.ts      (GM 1회 호출, json_schema 구조화 출력)
  → commitPendingGmResult                  engineAdvance.ts
      bindGmLocationToSubmittedMovement
      mergeMechanicsOwnedDelta             mechanicsMerge.ts     (HP/아이템/상태 병합)
      persistSheets + ledger + trpg_gm_messages.structured_json + trpg_state_change_log.applied_json
  → finalizeCommittedGmRound               (과금 + sealDroppedTrpgRounds)
```

사용 모델 (코드 기준): GM·봇 = `gemini-3.8-flash` (Cheaper Inference), 답장 제안 = `gpt-6-luna`, 기억 seal = `gpt-6-luna` 기본, referee/시나리오 초안 = `deepseek-v4-flash-0731`. referee(`FLASH_REFEREE`)는 기본 OFF, `ENEMY_HP_ENGINE = false`.
→ 이 RFC는 위 모델만 전제로 한다. 다른 모델은 조사하지 않았다.

기억 계층: RAW 3라운드 → seal 요약(백그라운드 모델) → episodic event(`memoryHorizon`, seal 출력에서만 생성) → 원장 → `localSceneProgress`.

---

## 2. PROBLEM — 재현된 문제 (baseline 수치)

| # | 문제 | 증거 |
|---|---|---|
| P1 | GM 숫자가 근거 없이 HP 확정 | H1 30→8, H4 30→12, H5 incomplete 경로 30→8, H6 10→30 무료 전회복 |
| P2 | GM 문자열이 서버 DOT를 자가 승인 | H7 `중독` → `derivePostGmOngoingSeeds` POISON seed → 이후 라운드 틱 |
| P3 | 아이템도 같은 구조 | H8 `inventoryAdd` 무검증 수용 |
| P4 | 정당한 피해의 근거가 서버에 없음 | H2/H3 — 서버가 H1과 H3을 구분 불가 |
| P5 | 의미 없이 굴림 강제 | no_roll 20건: 칩 `attack` → 20/20 오롤, `free` → 7/20 오롤(`기다린다`, `문을 닫는다`, `목록을 읽는다`…) |
| P6 | 모호한 고위험 입력 되묻기 없음 | C01 `그를 처리한다.` — clarify owner 부재 |
| P7 | 장기 기억: 시간순 아님, 상태 해소 없음, 인간 시점 없음 | R100 recall 순서 R45,R12,R60,R30,R3 · 열쇠 획득/분실 동시 recall · `knownParticipantIds` 미사용 |
| P8 | 테스트 신뢰도 | 32 실패, `postGmOngoingTrust.test.ts` 파싱 불가 (P2 owner의 유일한 trust 테스트) |

---

## 3. ROOT CAUSE

R1. **상태 변경의 provenance 개념이 없다.** `mergeMechanicsOwnedDelta`는 `GM_LEGACY`(= 분류되지 않은 현재 행동 HP)를 "허용 기본값"으로 둔다(`gmHpValid` 이면 수용, incomplete 경로는 `clampHp(gmHp)` 무조건 대입). NPC 공격/월드 위험을 서버가 사전에 승인하는 데이터(위협 원장)가 없으니, 숫자의 출처가 GM뿐이다.

R2. **"무엇을 시도했는가"의 owner가 4곳이다.** 클라이언트 칩(`actionType`), regex(`actionSemantics`/`actionCheck`), 봇 자기선언(`<<<ACTION_TYPE>>>`), `mechanicsIntent`. 칩은 `EXPLICIT_ALWAYS_ROLL_TYPES`(attack/defend/persuade/stealth)로 굴림을 *강제*하고, regex는 부정·인용·완료·단순 명사에 취약하다. #1517/#1523을 포함해 같은 방향 수정이 반복됐다 → **Attack the Premise**: regex를 더 강화하는 것이 해법이 아니다.

R3. **서사 → 결과 순서가 반대다.** 현재는 GM이 서사를 쓰며 결과(숫자)를 *같이* 내보내고 서버가 사후 병합한다. 목표 루프는 "승인된 결과 → 서사"다.

R4. **기억 이벤트는 seal 시점 1회 추출 + 점수순 recall**이다. 상태 갱신(supersede)·시점 필터(인간)·시간순 포맷 owner가 없다.

---

## 4. OWNER MAP

### 4.1 BEFORE (책임 → 현재 owner → 문제)

| 책임 | 현재 owner(들) (LOC) | 문제 |
|---|---|---|
| 입력 의미 해석 | `actionSemantics.ts`(89) `actionCheck.ts`(354) `actionTypes.ts`(199 칩/스탯 선호) `canonicalAttempt.ts`(47) `mechanicsIntent.ts`(164) + 봇 마커(`engineAdvance.generateBotActions`) | **4중 owner**, regex, 칩 강제 롤 |
| 굴림 필요/스탯/위험 | `actionCheck.resolveTrpgActionCheckDecision` → `roundAdjudication.adjudicateCanonicalSubmission`(528) | 결정 freeze + 서버 d20은 **건전** (보존) |
| 월드 결과 승인 (HP/상태/아이템) | `mechanicsResolve.ts`(1255) · `mechanicsMerge.ts`(283) · `mechanicsValidate.ts`(531, `hasActivePhysicalThreat` regex) · `postGmOngoing.ts`(272) · `sheetView.applyValidatedStateDelta` | HP owner 4종 중 `GM_LEGACY`가 **무근거 수용**; 상태→DOT 자가 승인 |
| GM 서사 | `gmPrompt.ts`(390, `TRPG_GM_SYSTEM`, `buildTrpgGmUserBlock`) · `runGmForRound` | 결과를 같이 생산 |
| 기억 | `memory.ts`(377) `memorySeal.ts`(99) `memoryHorizon.ts`(610) | §9 |
| 장면 진행 | `localSceneProgress.ts`(348) `campaignContext.ts` (`local_scene_progress_json`) | 위협/시계 개념 없음 |
| 봇 행동 | `engineAdvance.generateBotActions` | 인간과 다른 입력 경로 |
| 저장/원장 | `engineSheets.ts` `sheetHud.ts` `mechanicsStore.ts` `commitPendingGmResult` | **건전** (보존) |
| 과금 | `billing.ts`(85, `computeTrpgRoundPoints` = 실제 호출 합) · `finalizeCommittedGmRound` | **건전** (보존). 호출을 추가하면 과금이 바뀐다 |
| UI | `src/app/trpg/TrpgCommandDock.tsx` `[id]/TrpgRoomClient.tsx` | 칩 중심 |

### 4.2 AFTER (한 책임 = 한 canonical owner)

| 책임 | AFTER owner | 비고 |
|---|---|---|
| 시도 해석 | **Attempt owner** = 기존 `actionCheck`를 *재정렬* (칩은 힌트일 뿐 강제 아님) + 선택적 Attempt Reader (§6.2) | `actionSemantics`/`canonicalAttempt`/`mechanicsIntent`/봇 마커를 흡수·삭제 후보 |
| 굴림 | `roundAdjudication` (불변) | |
| 결과 승인 | **Outcome owner** = `mechanicsResolve`의 기존 `directEffect/directClass` 계산 + **서버가 만든 threat event** 입력 | GM 숫자는 archive-only 제안 |
| 위협/시계 | `localSceneProgress` V2 (additive JSON) | 새 DB/테이블 없음 |
| 서사 | `gmPrompt` — 승인된 결과를 *입력*으로 받음 | 출력 글자 상한 변경 없음 |
| 기억 | `memoryHorizon` 확장 | 병렬 기억 DB 금지 |

---

## 5. 목표 계약 (RECOMMENDED TARGET)

### 5.1 정규 루프

```
input
 → ① Attempt   (의도 해석: kind / stake / needsRoll / clarify)         [해석: 열림]
 → ② Check     (필요 시 서버 d20, 결정 freeze)                          [서버]
 → ③ Outcome   (서버가 승인: 성공 등급 → fail-forward 선택 + threat event → HP/아이템/시계)
 → ④ Narrate   (GM이 승인된 결과를 한국어 소설로. 숫자는 새로 만들지 않음)
 → ⑤ Remember  (scene progress + 기억 이벤트)
```

### 5.2 원칙

- **해석은 열고, 승인은 닫는다.** AI/문맥은 의미를 자유롭게 이해하되, HP·주사위·아이템 영속은 *닫힌 enum + 사전 provenance*로만 서버가 확정한다.
- NPC 공격/월드 위험의 HP 효과는 **사전 승인된 scene/hazard provenance**가 있을 때만. GM이 같은 응답에 쓴 숫자·이유는 신뢰하지 않는다.
- 인간 PC의 정당한 행동 권한(이동/공격/사용)은 **훼손하지 않는다** (STOP 조건).

### 5.3 타입 (설계 스케치 — 구현 아님)

```ts
// ① 서버가 보관하는 인간/봇 공통 시도
type Attempt = {
  participantId: number;
  kind: "talk" | "observe" | "move" | "interact" | "risky" | "contested" | "harm_other" | "unclear";
  stake: "none" | "low" | "high";
  needsRoll: boolean;      // 기본 false. 칩이 아니라 stake/불확실성에서 도출
  clarify: boolean;        // stake=high && kind=unclear 일 때만 true (1회, 짧게)
  source: "deterministic" | "reader";
};

// ③ 서버 소유 위협 이벤트 — GM 숫자가 아니라 이것만이 HP를 움직인다
type ThreatEvent = {
  id: string;
  target: number | "scene";
  severity: "CHIP" | "LIGHT" | "MEDIUM" | "HEAVY" | "SEVERE" | "CRITICAL"; // 기존 referee directClass 어휘 재사용 (서버가 수치로 환산)
  provenance:
    | { kind: "scenario_hazard"; ref: string }        // 작가가 시나리오에 정의
    | { kind: "active_threat"; ref: string }          // 이전에 커밋된 라운드에서 ledger에 올라간 위협
    | { kind: "attempt_consequence"; roundId: number } // 실패 판정의 서버 선택 결과
    | { kind: "ongoing_effect"; effectId: number };   // 기존 tick owner
};
```

**GM 자기승인 우회 차단 규칙 (핵심)**: GM이 서사 중 새 위협을 도입하면 `localScene.threatsAdd` 로 ledger에 올라가지만 *그 응답에서는 피해를 주지 못한다* (soft move = 전조/경고). 피해는 **다음 라운드에서 해당 위협에 맞선 시도가 실패하거나 시계가 찰 때** 서버가 `active_threat` provenance로 승인한다. 그래서 GM이 "위협 추가 + 같은 응답 피해"로 H1을 우회할 수 없다.

### 5.4 기존 코드 재사용 경로 (추가 provider 호출 0)

`resolveRoundMechanics`는 이미 `flash.effects[{participantId, directEffect, directClass, cause}]` 입력을 받아 권위 HP(`FLASH_REFEREE`)를 계산한다 (H9: 서버 피해 26이 GM 29보다 우선). 현재 이 입력의 공급원은 **기본 OFF인 LLM referee**다. vNext는 공급원을 *서버가 만든 ThreatEvent*로 바꾼다. 즉 **새 HP 엔진을 만들지 않고** 입력 공급원만 교체한다.

### 5.5 Fail-forward + 시계 (원칙만 차용, 브랜드·수치·규칙문 복제 없음)

- 성공 = 반응/대가/기회 중 하나 (예: 길이 열림, 시선을 끎, 자원 소모). 실패 = **세계가 변한다**(멈추지 않음).
- 서버는 등급별 **결과 메뉴(enum)** 에서 하나를 결정론적으로 고른다(roundId seed → 재생성 시 동일):
  `reveal_cost | position_lost | time_pressure(clock+1) | resource_spent | new_complication | harm(severity) | partial_success_with_cost`
- 시계(`clocks[]`): `{id, label, segments, filled, kind: "threat" | "progress"}`. `threat` 가 차면 서버가 `active_threat` 피해/장면 전환을 승인. `progress` 가 차면 `openRoutes` 추가 → 장면 소진 시 흐름(`transition_ready`).
- 일상 대화/관찰/일상 이동은 굴림 없음 (§5.3 `needsRoll=false` 기본).
- 전투·추격·조사·관계가 **같은 원칙**(위 enum + clock)을 공유. 전투 전용 HP 엔진 신설은 SEPARATE FOLLOW-UP.
- 50턴 이상 루프 방지: scene당 `progress` 시계가 없으면 서버가 3라운드 정체 시 `time_pressure` 를 자동 +1 (구체 수치는 Slice 2에서 fixture로 확정; 여기서는 *정체 → 압력* 규칙만 계약).
- 노드 기반 자유 탐색: `openRoutes` 를 노드로 취급(이미 존재). 강제 경로 없음.

`TrpgLocalSceneProgressV1`(objective/resolvedObstacles/openRoutes/remainingBlockers/sceneState)은 `local_scene_progress_json` **JSON 컬럼**에 저장된다(`campaignContext.ts`). `parseLocalSceneProgress` 가 version 분기를 이미 가지므로 V2(`clocks`, `threats`) 는 **additive**, SQL 마이그레이션 불필요(파괴적 마이그레이션 없음). 컬럼/롤백 경로 재확인은 Slice 2 시작 조건.

---

## 6. 판정 계층 설계

### 6.1 Slice 1c — 결정론적 Attempt (호출 0)

- 칩 `actionType`을 **힌트**로 강등: `EXPLICIT_ALWAYS_ROLL_TYPES` 강제 제거 (baseline: 칩 attack → no_roll 20/20 오롤).
- `needsRoll` 은 stake(위험·불확실성·대립) 에서 도출. corpus(`fixtures/action-corpus.json`) 를 회귀 게이트로 사용: 완료 상태/부정/인용/단순 명사/관찰/대화/일상 이동 = no_roll.
- 한계(정직): regex 로는 한국어 부정·인용·복합문 한계가 남는다. free 모드 7/20 오롤은 R2의 증거이므로 **regex 추가 보강은 "같은 방향 수정"** 이다 → 결정론 계층은 *안전 기본값(no_roll, no harm)* 을 갖고, 모호한 stake≥high 는 Reader 또는 clarify 로 넘긴다.

### 6.2 Slice 1d — Attempt Reader (선택, **승인 필요**)

- 인간 제출을 **한 번에 배치**로 읽는 소형 구조화 호출. 출력은 §5.3 `Attempt` 의 **닫힌 enum만**(자유 텍스트 필드 없음, `needsRoll`/`kind`/`stake`/`clarify`). 파싱 실패·타임아웃·enum 위반 → **fail closed** = `needsRoll=false, harm 없음` (HP/아이템 권한은 어떤 경우에도 Reader 에 없다).
- 지연: 봇 생성(`generateBotActions`)과 **병렬** 실행하면 임계 경로 증가 없음(Reader 지연 < 봇 지연일 때). 운영 P50/P95는 **UNKNOWN**(텔레메트리 미조회).
- 과금: `computeTrpgRoundPoints` 는 *실제 모델 호출의 합*이다 → Reader 호출은 사용자 과금에 포함된다. **과금 구조 변경 = STOP 항목**. 옵션: (a) Reader 비용을 라운드 요금에 포함(요금 상승), (b) 플랫폼 부담(마진 영향), (c) Reader 미도입 + 결정론 + clarify.

---

## 7. ARCHITECTURE COMPARISON

| 축 | A. 유지 + owner 통합 | **B. 인프라 재사용 + 판정/결과/서사 계약 재설계 (권고)** | C. 메커닉 전면 교체 |
|---|---|---|---|
| RP 품질 | 변화 없음 (GM 입력 동일) | GM 이 *승인된 결과* 를 입력으로 받음 → 인과 일관 기대 (UNVERIFIED) | 가능성 최대이나 근거 없음 |
| 기억/멀티플레이 | 별도 작업 | 위협/시계/기억을 기존 JSON·`memoryHorizon` 확장 | 새 모델 → 기억 재작성 |
| 난이도 / 삭제 가능 legacy | 낮음 / 거의 없음 | 중간 / 칩 강제 롤, GM_LEGACY, 상태→DOT 자가승인, `hasActivePhysicalThreat` regex, referee LLM 경로 | 최대 / 전체 mechanics 3.5k LOC 교체 |
| 서버 무결성 | H1·H4·H5·H6·H7 **미해결** (owner 가 provenance 부재를 해결 못 함) | provenance 로 해결 + 서버 d20/원장 유지 | 해결하나 새 결함 위험 |
| 지연/비용 | 0 | Slice 1a–c: 호출 0. Reader 선택 시 +1 소형 호출(병렬) | 미정 |
| 실패/복구/동시성 | 유지 | 락·freeze·regenerate·billing retry 유지 | 전부 재검증 |
| 초심자 UX | 칩 유지 | 칩 비강제 + clarify | 새 UX |
| 회귀 위험 | 낮음 (그러나 문제 잔존) | 중간 — shadow 모드로 관리 | 높음 |

근거 (코드/테스트):
- **A 부적합**: H1(소리 듣기 30→8)과 H3(정당한 반격 30→22)이 *같은 코드 경로*. 통합만으로는 둘을 구분할 데이터가 없다. 의미 판정은 #1517/#1523 에서 같은 방향 수정이 반복됨 → Attack the Premise.
- **C 부적합 (증거 부족)**: 교체 대상 `mechanics*.ts` 3,554 LOC + `actionCheck` 354 + `roundAdjudication` 528, 해당 owner 를 참조하는 테스트 파일 39개. 그러나 *건전한* 부분(서버 d20 freeze, 틱/회복 owner H10, 서버 피해 우선 H9, 시트·원장 저장, 과금 분배, 락)까지 폐기해야 한다. 더 단순하고 더 고품질이라는 코드/테스트 증거가 없다 → 권고하지 않는다.
- **B 선택**: 결함은 "승인 근거 부재 + 판정 owner 중복" 두 곳에 국한되고, 필요한 실행기(`directEffect/directClass` → 권위 HP)는 이미 존재한다(§5.4).

---

## 8. REMOVED / CONSOLIDATED CANDIDATES

분류 규칙: SAFE TO DELETE / KEEP / FOLLOW-UP (writer·reader·기존 데이터·롤백 증거 없이는 삭제 금지).

| 대상 | 분류 | 근거 / 조건 |
|---|---|---|
| `EXPLICIT_ALWAYS_ROLL_TYPES` 칩 강제 롤 (`actionCheck.ts`) | FOLLOW-UP (Slice 1c) | no_roll 20/20 오롤. #1523 과 같은 owner → #1523 흡수 여부는 GPT 결정 |
| `GM_LEGACY` HP 수용 + incomplete 경로 `clampHp(gmHp)` | FOLLOW-UP (Slice 1b, **승인 필요**) | 합법 전투 피해 동작 변경. shadow 로 먼저 측정 |
| `derivePostGmOngoingSeeds` 의 GM condition → DOT | FOLLOW-UP (Slice 1b) | H7. 기존 활성 effect 데이터 영향 조사 필요 |
| `mechanicsValidate.hasActivePhysicalThreat` regex | FOLLOW-UP | ledger threat 로 대체 후 삭제 후보 |
| `mechanicsReferee.ts`(128, LLM referee, 기본 OFF) | FOLLOW-UP | 운영 env 에서 OFF 인지 **미확인(UNKNOWN)** → 확인 전 삭제 금지 |
| `ENEMY_HP_ENGINE=false` 와 dead enemy HP 분기 | KEEP | 신규 NPC 전투(SEPARATE FOLLOW-UP) 결정 전까지 |
| `actionSemantics`/`canonicalAttempt`/`mechanicsIntent`/봇 마커 중복 | FOLLOW-UP (Slice 1c) | Attempt 단일 owner 로 흡수 |
| 낡은 "Pro" 주석/테스트 | SAFE TO DELETE(주석) / FOLLOW-UP(테스트) | 해당 슬라이스가 건드릴 때 정리 |
| `postGmOngoingTrust.test.ts` 파싱 오류 | **REQUIRED CLEANUP (Slice 1b 선행)** | owner 를 바꾸기 전에 trust 테스트가 먼저 살아 있어야 함 |

## 9. 장기 기억 — 감사와 확장 계획 (병렬 기억 DB 신설 없음)

감사 결과(§baseline P3): (a) 시간순 아님 (b) supersede 없음 (c) 인간 참가자 시점 없음, `knownParticipantIds` 미사용 (d) 이벤트는 seal 이후에만 → R5 에서 직전 3라운드 사실은 RAW 의존.

`memoryHorizon` 확장안 (additive):
1. **표시 순서**: 선택된 top-K를 `round` 오름차순으로 포맷 (선택은 점수순 유지).
2. **상태 해소**: `(type, entity-key)` 단위 latest-wins 표시 (획득→분실 시 "분실"만 현재 상태로, 이전은 이력). 컬럼 추가 없이 fingerprint/entity 로 계산 가능한지 Slice 3에서 확인.
3. **시점**: `TrpgMemoryQuery.viewerKind` 를 `gm | bot` → `gm | bot | human(participantId)` 로 확장하고 `knownParticipantIds` 를 가시성 판정에 사용 (`eventVisibleToViewer` 단일 owner 유지). 2인간+2AI 에서 서로 다른 지식 보장.
4. **관계 상태**: relationship 이벤트를 쌍(pair) 단위 최신 상태 한 줄로 요약.

### 검증 계획 (turn 5 / 20 / 50 / 100)

| 시점 | 확인 | 방법 (호출 없음) |
|---|---|---|
| T5 | 직전 3라운드(RAW) 사실 누락 없음, 시간 순서 | scripted event stream + `buildHorizonPromptSections` |
| T20 | 약속/아이템 recall, 시간순 | 위와 동일 |
| T50 | 관계 변화 순서(신뢰→배신), 아이템 최신 상태 | supersede 후 단일 현재 상태 |
| T100 | 장기 목표/약속 recall, 폐기된 사실이 현재로 보이지 않음 | 위와 동일 |
| 2H+2AI | actor_only 비밀이 타 좌석에 안 보임, 공개 폭로 후 모두 보임 | viewer 별 recall 비교 |

seal *추출* 품질(LLM 이 올바른 이벤트를 뽑는가)은 실제 모델 출력이 필요 → §12 유료 평가에서만 확인 가능. 현재 baseline 은 **검색/가시성/순서**만 증명한다.

---

## 10. 초보자 UX (SEPARATE FOLLOW-UP, 설계만)

- 입력은 **행동/대사 두 가지 텍스트만**. 스탯/행동유형 칩 강제 없음 (`TrpgCommandDock` 재사용, JSX 재활용).
- 모호하고 위험이 큰 입력(`clarify=true`)만 짧은 확인 1회 ("A로 이해했어요 / B로 이해했어요" 두 선택).
- 결과 표시: 숫자 대신 "성공 / 대가가 따른 성공 / 상황이 바뀜" + 한 줄 이유. 주사위·시트는 **고급 보기(선택)**.
- UI PR 은 별도: BEFORE/AFTER 이미지 **원본을 GitHub 에 커밋**하고 미리보기 첨부, #1521 에서 검증된 Base64 UTF-8 전송 재사용. 영상 검증은 생략.
- 이 문서의 UI 세부(컴포넌트 구조)는 UI PR 직전에 현재 `TrpgCommandDock`/`TrpgRoomClient` 를 다시 읽고 확정한다 (Phase 0 에서는 코드 조사하지 않음).

---

## 11. 품질 회귀 매트릭스

레이어: **F** = 결정론 fixture(호출 0, CI 가능), **M** = 실제 모델 출력(승인 필요, GPT/사용자 평가).

| 시나리오 | F | M | 합격 기준(F) |
|---|---|---|---|
| 1U+1AI 기본 라운드 | ✔ | ✔ | 한 라운드 commit, 시트/원장 일관 |
| 2U+2AI | ✔ | ✔ | 4좌석 모두 행동 권한 유지, 지식 분리 |
| 충돌 행동(같은 대상/아이템) | ✔ | ✔ | 서버가 우선권 결정, 아이템 중복 지급 없음 |
| 전투 농담/대사 | ✔(P2 corpus) | ✔ | 오롤 0 |
| 위치 분리 | ✔ | ✔ | `bindGmLocationToSubmittedMovement` 유지 |
| 캐릭터별 기억 차이 | ✔(§9) | ✔ | 비밀 누출 0 |
| **GM 거짓 HP 변경** | ✔(H1 H4 H5 H6) | — | enforce 후 HP 불변 |
| **GM 정당 피해 누락** | ✔(H2) | ✔ | 서버 승인 피해 적용 |
| 안전 이동 | ✔ | — | 굴림 0 |
| 한국어 행동 오독 | ✔(corpus 32) | — | corpus 일치율 게이트 (임계값은 GPT 확정) |
| 5~50턴 진행 / 장기 목표·약속·관계 recall | ✔(§9) | ✔ | §9 표 |
| 재접속 / 재생성 / provider 실패 | ✔(기존 gmProviderRetry 계열) | — | 기존 테스트 복구 후 유지 |

## 12. 실제 GM 출력 평가 (SEPARATE, 승인 후)

평가 항목: 자연스러운 한국어, 캐릭터 말투, 대사·심리·환경 균형, 캐릭터별 행동 권한, 인과, 기억 정확성, 진행, 장면/위치 연속성, 세계관 분위기, 출력 길이/밀도.
- **출력 글자 상한을 새로 두거나 줄이지 않는다.**
- 현재 배포 모델/캐릭터/관리자 페르소나 조건에서만 실제 출력을 생성한다. **Cursor 는 점수를 매기지 않고** 원본을 PR 에 제출 → GPT/사용자 평가.
- **제안 규모 (미승인, 승인 전 호출 0)**: 3 시나리오 × 4라운드(2인간+2AI) × 2 변형(main vs 후보) = GM 24회 + 봇 48회 + 50라운드 기억 캠페인 1개 × 2 변형 = GM 100 + 봇 200 (각 변형당 GM 50 + 봇 100, + seal 약 34회, 모델 단가 UNKNOWN).
- 참고 단가 추정 (`publishedModelPricing` 의 `gemini-3.8-flash` 기준 입력 $0.375 / 출력 $1.875 per 1M, `billing.ts` fallback 토큰 GM 10,000/3,500 · 봇 2,500/400): GM 1회 ≈ $0.0103, 봇 1회 ≈ $0.0017 → 위 규모 ≈ **$2 미만(참고 단가 기준 추정, 측정치 아님)**. `gpt-6-luna` 단가는 코드에서 확인하지 못해 UNKNOWN.

---

## 13. COST / LATENCY

| 항목 | 현재 | Slice 1a–1c | Slice 1d (Reader 도입 시) |
|---|---|---|---|
| 라운드당 provider 호출 (2H+2AI) | GM 1 + 봇 2 (+ 백그라운드 seal) | **동일 (추가 0)** | +1 소형(병렬) |
| 참고 단가 추정 | GM $0.0103 + 봇 2×$0.0017 ≈ $0.0137 | 동일 | Reader 입력 ~1,200 / 출력 ~150 토큰 가정 시 ≈ +$0.0007 (모델 미확정 — 추정) |
| 지연 | 직렬: 봇 → GM. 운영 P50/P95 **UNKNOWN** | 동일 (결정론 연산만) | 봇과 병렬이면 임계 경로 0 증가 가능 |
| 사용자 과금 | `computeTrpgRoundPoints` = 실제 호출 합 | 동일 | **변경됨 → STOP/승인** |

---

## 14. PRESERVED (재사용 — 검증 후)

인증/권한, 과금 분배(`splitTrpgRoundCost`, AI 봇 무과금), 락/동시성/freeze, 서버 d20(`adjudicateLockedHumanSubmissions`), 서버 틱·회복 owner(H10), 서버 권위 피해 우선(H9), `persistSheets` + 원장 + `structured_json` + `state_change_log`, regenerate/recover/billing retry, seal 파이프라인, `localSceneProgress`, GM json_schema 구조화 출력, 가시성 필터(`actor_only`), #1521 Base64 이미지 전송.

## 15. REGRESSION RISKS

1. GM_LEGACY 폐기 시 합법 전투 피해가 사라짐 → shadow 로 *GM hp ≠ 서버 승인* 분포를 먼저 측정, enforce 는 승인 후.
2. 칩 강제 롤 제거 시 기존 UI 의 "공격 칩 = 항상 굴림" 기대와 충돌 → 칩은 힌트로 유지, stake 높으면 여전히 굴림.
3. 위협 soft-move 규칙이 전투 템포를 늦출 수 있음 → 시나리오 `scenario_hazard` provenance 로 첫 라운드 피해 허용(작가 정의).
4. 시계 정체 압력이 *강제 경로*로 느껴질 위험 → 노드 기반 `openRoutes` 유지, 강제 장면 전환 없음.
5. 기억 supersede 오류가 사실을 숨김 → 이력 보존, 현재 상태만 우선 표시.
6. 테스트 baseline 이 이미 32 실패 → 슬라이스마다 "신규 실패 0" 을 변경 전/후 diff 로 증명.

## 16. PHASED PR PLAN (각각 작은 Draft, GPT 검수·승인 후 병합)

| Slice | 내용 | provider | 선행 |
|---|---|---|---|
| **0 (이 PR)** | RFC + fixtures + baseline runner. runtime 변경 0 | 0 | — |
| 1a | 서버 threat event + **shadow 비교 로깅**(GM hp vs 서버 승인), 동작 변경 없음 | 0 | `postGmOngoingTrust.test.ts` 복구 |
| 1b | enforce: GM hp archive-only, 상태→DOT 자가승인 제거, 아이템 provenance | 0 | **정책 승인** + shadow 데이터 |
| 1c | Attempt 결정론: 칩 강제 롤 제거, corpus 게이트, #1517/#1523 owner 통합 | 0 | #1523 처리 방침 |
| 1d | (선택) Attempt Reader | +1 소형 | **과금 구조 승인** |
| 2 | `localSceneProgress` V2(clocks/threats) + fail-forward 메뉴 | 0 | JSON 컬럼 롤백 경로 확인 |
| 3 | 기억: 시간순/supersede/인간 시점 | 0 | — |
| 4 | 초보자 UX + 2H+2AI 실제 문장 게이트 | 유료(승인) | §12 승인 |

`#1523`(자동 판정) 은 **자동 병합하지 않는다.** Slice 1c 가 같은 owner 를 다루므로 흡수/대체는 GPT 가 결정한다.

---

## 17. STOP CONDITIONS / 승인이 필요한 결정

1. **GM_LEGACY HP 수용 폐기** — 합법 전투 동작 변경 (정책). shadow 데이터 후 결정.
2. **Attempt Reader 호출의 과금 처리** — 과금 구조 변경 (a/b/c 옵션, §6.2).
3. **유료 실제 출력 평가** — 호출 수·예상 비용(§12) 승인 필요.
4. **실제 RP 문장 품질: UNVERIFIED.** 어떤 슬라이스도 승인된 평가 없이는 품질 개선을 주장하지 않는다.
5. 운영에서 referee(`FLASH_REFEREE`) 가 OFF 인지 **미확인** — `mechanicsReferee.ts` 삭제 전 확인 필수.
6. `corpus` 라벨은 Cursor 제안 — GPT/사용자 확정 전 게이트로 쓰지 않는다.
7. 위 외에 owner/원인 미확정, 파괴적 DB 마이그레이션, 인증/과금 변경, 합법 행동 권한 훼손, 무관한 대형 변경이 필요해지면 즉시 STOP 하고 증거와 옵션만 보고한다.

## 18. Change budget 분류

- MUST FIX NOW: 현재 시스템 조사 + 목표 계약 + 실측 baseline (이 문서).
- REQUIRED CLEANUP: §8 중복/충돌 owner 통합 계획.
- SAFE OPTIONAL: Reader(1d), 낡은 주석 정리.
- SEPARATE FOLLOW-UP: 기억 구현 상세, GM 문체, 초보자 UI, 신규 NPC 전투.
