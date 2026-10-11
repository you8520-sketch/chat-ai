# RFC — TRPG vNext: AI 서사 중심 게임 엔진 (PHASE 0, rev 2)

- Tracking: #1541 (관련 #1494 #1517 #1451 #1450 #1435 #1481 #1463)
- 분류: ARCHITECTURE / DOCUMENTATION — **PHASE 0 (설계 + 기준선만)**
- rev 2 = GPT review `5482598511` 반영. 방향(아키텍처 B)은 승인됨. 아래 계약은 **구현 청사진**이며 runtime 코드·provider 호출·DB 쓰기·과금 변경은 포함하지 않는다.
- 사실의 원천은 현재 main production 경로다. Baseline `796d279f`; 이후 main(`06bc210d`)의 3개 커밋은 TRPG 파일을 바꾸지 않았다(`git diff --name-only 796d279f origin/main` 에 trpg 경로 0건).
- RP 문장 품질은 **UNVERIFIED** 이며 이 문서에서 점수화하지 않는다.

증거: `baseline/README.md`, `baseline/baseline-796d279f.json`, `scripts/trpg-vnext-baseline.ts`, `fixtures/action-corpus.json`(text-only baseline, 변경 없음), `fixtures/action-context-pairs.json`(신규), `fixtures/outcome-contract-cases.json`(신규).

---

## 0. 결론과 리뷰 반영표

한 줄 원칙: **해석은 열고, 권한은 닫는다.** 서버는 *이미 확립된 근거*가 있을 때만 HP/상태/아이템을 확정하고, GM은 확정된 결과를 소설로 쓴다. GM의 숫자·id·cause 문자열·서사는 어떤 경우에도 권한이 아니다.

| GPT 요구 | 반영 위치 |
|---|---|
| 1. provenance는 자기선언 불가, 같은 라운드 정당 피해 허용, 신규 GM 위협만 즉시 피해 금지, 멱등성 | §6 Server Outcome Contract |
| 2. 문맥 의존 라벨, `needsRoll` ≠ 성공, Reader 실패는 자동 성공/피해 아님 | §7 + `fixtures/action-context-pairs.json` |
| 3. 고정 N턴 time_pressure 제거 | §8 (규범에서 삭제, 비규범 진단 지표로만 언급) |
| 4. 기억은 latest-wins가 아님, 이벤트 identity/supersession, 2인간 가시성 | §9 |
| 5. shadow만으로 정당성 판정 불가 → 라벨된 H1–H10 + 기존 encounter 케이스, trust 테스트 선행 | §11, `fixtures/outcome-contract-cases.json` |
| 정책: 1b / Reader 과금 / 유료 배치 / flag 삭제 / #1523 병합은 **미승인** | §16 |

---

## 1. RFC 가정 vs 현재 main — 검증 결과

재조사는 새 계약이 의존하는 지점만 수행했다. **STOP 사유(새 canonical owner, 기존 path와 모순)는 발견되지 않았다.** 다만 rev 1의 일부 서술이 틀렸거나 과했으므로 정정한다.

### 1.1 정정 (rev 1 → rev 2)

| # | rev 1 서술 | main 사실 (근거) | 조치 |
|---|---|---|---|
| C1 | `scenario_hazard` 를 "작가가 시나리오에 정의" | 시나리오에는 **구조화된 hazard가 없다.** 구조화된 것은 NPC(`TrpgScenarioNpc`: `npcKey`/`role: supporting\|boss`/`stats`, 최대 8, `scenarioTypes.ts`)뿐이고, `TrpgScenarioPlan`(`scenarioPlan.ts`)의 `majorEvents/boss/specialRules` 등은 **자유 텍스트**다. | AUTHORED provenance는 *현재는 authored NPC만* 근거가 된다. 함정/지형 위험은 ESTABLISHED(§6) 경로로만 근거화. 작가용 hazard 필드는 SEPARATE FOLLOW-UP. |
| C2 | ledger의 NPC 목록을 "존재하는 NPC" 근거로 사용 가능 | `campaignLedger.npcs`(`trpg_campaign_state.npcs_json`)는 캠페인 생성 시 authored NPC *이름*으로 시드되지만(`engineCreate.ts`), 이후 GM delta `npcsAdd/npcsRemove` 로 쓰여진다(`campaignLedger.ts`) → 작가 출처와 GM 출처가 섞인 자기선언 목록이다. | NPC 존재 근거는 **시나리오 템플릿의 authored NPC**(`npcKey`) 또는 **서버 검증을 통과한 ledger threat**만. |
| C2b | authored NPC 는 캠페인 생성 시 스냅샷된다 | 전체 NPC 데이터(`npcKey/role/stats`)는 **매 라운드 시나리오 템플릿에서 live 로 읽는다**(`engineAdvance.loadCampaignScenarioNpcs(templateId)`). 스냅샷이 아니므로 작가가 템플릿을 수정하면 캠페인 중 바뀔 수 있다. | AUTHORED 근거는 threat ledger 가 첫 사용 시 `npcKey/role/severityCeiling` 을 **ledger 에 복사(additive JSON)** 해 고정한다. 템플릿 변경 시 영향은 Slice 1a 에서 확인할 항목. |
| C3 | `localScene.threatsAdd` 로 위협 등록 | GM의 `localScene` delta는 `sanitizeLocalSceneProgressDelta` 로 **형식만** 정리되어 그대로 적용된다(`engineAdvance.commitPendingGmResult`). 위협을 같은 경로로 받으면 자기승인이다. | 위협은 *제안(proposal)* 으로만 받고 서버가 별도 검증(§6.4). |
| C4 | "충돌 행동은 서버 순서로" | `resolutionOrder`(`roundPresentation.ts`)는 **연출 순서**다. 같은 대상/아이템 충돌을 판정하는 owner는 main에 없다. | 충돌 arbitration은 *신규 계약*(§6.7)이며 Slice 1b/1c 설계 항목. |
| C5 | `no_check` = 굴림 없음 | GM wire(`gmPrompt.formatTrpgActionCheckWire`)는 `routine_competence/flavor/ordinary_free/support_setup/ordinary_item_use` 에서 "**realize the submitted action normally**" 라고 쓴다 → `no_check` 가 성공 보증으로 읽힌다. | §7.2 계약에서 분리(같은 wire owner를 *교체*, 문장 추가 아님). |
| C6 | 기억 이벤트 identity 문제 | `memoryEventFingerprint` 는 `campaign|type|actors|정규화 fact` 이며 **라운드 미포함**, `persistMemoryEvents` 는 `INSERT OR IGNORE ... UNIQUE(campaign_id, fingerprint)`. 같은 문장의 재획득/재화해 이벤트는 **조용히 버려진다**(baseline P3b). | §9.3 |
| C7 | GM가 누가 비밀을 아는지 안다 | `formatEventLine` 은 `- R<round>: <fact>` 만 출력한다. GM 기억 블록에 scope/knower 표시가 **없다**(baseline P3b). 프롬프트 한 줄("Do not reveal actor_only facts as if other PCs know them", `gmPrompt.ts`)이 유일한 장치. | §9.4 |
| C8 | retry/regen 멱등성은 이미 증명됨 | 증명 테스트 `gmProviderRetry` F/G/H 가 baseline에서 **실패** 중. 코드 경로는 존재(§6.6). | §11 선행 게이트 |

### 1.2 확인된 사실 (재사용)

- 커밋은 단일 `db.transaction`: GM generation lease(`markGmGenerationCommitted`) → `trpg_gm_messages` upsert → **`if (opts.regenerate) return;`**(상태 변경 전 종료) → `persistSheets` + `applyMechanicsOnCommit` + `markMechanicsApplied` + `trpg_state_change_log`(`INSERT OR IGNORE`, key=`delta:<roundId>`) → ledger/localScene/story → billing(`trpg_rounds.billed`).
- `applyPersistedMechanicsEffects` 는 `resolution.applied` 면 즉시 return, ongoing add는 `(campaign, participant, stackKey, sourceRound)` 로 중복 방지.
- 라운드당 mechanics resolution 1행(`trpg_mechanics_resolutions`, `ON CONFLICT(round_id)`), d20은 `trpg_dice_rolls`, 결정 freeze는 adjudication snapshot, 제출은 `locked=1` 만 읽음.
- `buildTrpgGmUserBlock` 은 이미 `mechanicsPacket` 입력을 가진다(새 프롬프트 섹션 불필요).
- `local_scene_progress_json` 은 JSON 컬럼. 스키마는 `addColumn` 헬퍼로 additive 확장하는 관례.
- 모델: GM·봇 `gemini-3.8-flash`, 답장 제안·seal `gpt-6-luna`, referee/시나리오 초안 `deepseek-v4-flash-0731`(referee 기본 OFF, `ENEMY_HP_ENGINE=false`).

---

## 2. BEFORE — 현재 production 경로

```
submit (인간 행동 + 클라이언트 칩 actionType)
  → adjudicateLockedHumanSubmissions   roundAdjudication.ts  (locked=1 제출, 결정 freeze, 서버 d20)
      └ resolveTrpgActionCheckDecision actionCheck.ts        (regex, 칩은 일부 타입에서 굴림 강제)
  → generateBotActions                 engineAdvance.ts      (봇: <<<ACTION_TYPE>>> / <<<INTENT>>> 자기선언)
  → finalizeRoundAdjudication
  → runGmForRound                      (GM 1회, json_schema 구조화 출력: 서사 + 숫자/상태 delta)
  → commitPendingGmResult              (§1.2 단일 트랜잭션; mergeMechanicsOwnedDelta 가 GM delta를 병합)
  → finalizeCommittedGmRound           (과금 + sealDroppedTrpgRounds)
```
기억: RAW 3라운드 → seal 요약 → episodic event(`memoryHorizon`, seal 출력에서만 생성) → 원장 → `localSceneProgress`.

## 3. PROBLEM (baseline, 모두 provider 0)

| # | 문제 | 증거 |
|---|---|---|
| P1 | 근거 없는 GM HP 변경이 확정 | H1 30→8, H4 30→12, H5(incomplete) 30→8, H6 10→30 |
| P2 | GM 문자열이 서버 DOT를 자가 승인 | H7 `중독` → POISON seed (`derivePostGmOngoingSeeds`) |
| P3 | 아이템 무검증 | H8 |
| P4 | 정당한 피해와 근거 없는 피해를 서버가 구분 불가 | H1 vs H3 동일 경로. H2: GM이 숫자를 빼면 정당 피해도 사라짐 |
| P5 | 의미 없는 굴림 강제 / 문맥 무시 | no_roll 20건: 칩 attack 20/20 오롤, free 7/20 오롤. 같은 문장·다른 장면 4쌍 중 현재 owner가 달라지는 것은 1쌍(CP01, localScene 경로 덕분) |
| P6 | 모호·고위험 입력 되묻기 없음 | C01, CP07 |
| P7 | 기억 identity/시점 | 같은 문장 재획득 이벤트 drop, GM 기억 블록에 knower 표시 없음, `knownParticipantIds` 미사용, recall 시간순 아님, 획득+분실 동시 recall |
| P8 | 테스트 신뢰도 | 32 실패, `postGmOngoingTrust.test.ts` 파싱 불가, retry 멱등성 테스트 F/G/H 실패 |

## 4. ROOT CAUSE

R1. **상태 변경 provenance 부재.** `mergeMechanicsOwnedDelta` 의 `GM_LEGACY` 는 "분류되지 않은 현재 행동 HP"를 *허용 기본값*으로 둔다. NPC 공격/월드 위험을 서버가 미리 알고 있는 데이터(검증된 위협)가 없으니 숫자의 출처가 GM뿐이다.
R2. **"무엇을 시도했나"의 owner 중복**: 칩, regex(`actionSemantics`/`actionCheck`), 봇 자기선언, `mechanicsIntent`. 칩이 굴림을 강제하고, regex는 장면 사실을 못 쓴다(현재 owner 입력은 `localScene` 뿐). #1517/#1523 에서 같은 방향 수정이 반복됨 → regex/예외 추가는 해법이 아니다(Attack the Premise).
R3. **결과 → 서사 순서가 역전**: GM이 서사와 결과 숫자를 *동시에* 생산하고 서버는 사후 병합.
R4. **기억은 seal 시점 1회 추출 + 점수순 recall + 텍스트 fingerprint identity.**

## 5. OWNER MAP

### 5.1 BEFORE
| 책임 | 현재 owner (LOC) | 문제 |
|---|---|---|
| 입력 의미 | `actionSemantics`(89) `actionCheck`(354) `actionTypes`(199) `canonicalAttempt`(47) `mechanicsIntent`(164) + 봇 마커 | 4중 owner, 장면 사실 미사용 |
| 굴림/스탯/결정 freeze | `roundAdjudication`(528) | **건전** |
| 월드 결과 승인 | `mechanicsResolve`(1255) `mechanicsMerge`(283) `mechanicsValidate`(531) `postGmOngoing`(272) | `GM_LEGACY` 무근거 수용, 상태→DOT 자가승인 |
| GM 서사 | `gmPrompt`(390) `runGmForRound` | 결과 동시 생산 |
| 기억 | `memory`(377) `memorySeal`(99) `memoryHorizon`(610) | §9 |
| 장면 진행 | `localSceneProgress`(348) `campaignContext` | 위협/시계 없음 |
| 저장/원장/과금 | `engineSheets` `mechanicsStore` `commitPendingGmResult` `billing`(85) | **건전** |

### 5.2 AFTER (한 책임 = 한 canonical owner; **새 owner 신설 없음**)
| 책임 | AFTER owner |
|---|---|
| 시도 해석 | `actionCheck` 재정렬(칩=힌트, 장면 근거 사용) + 선택적 Reader(1d) |
| 굴림 | `roundAdjudication` (불변) |
| 결과 승인 | `mechanicsResolve` 의 기존 `directEffect/directClass` 계산. 입력 공급원만 *서버 생성 ThreatEvent* 로 교체 |
| 위협/시계 | `localSceneProgress` V2 (additive JSON) |
| 서사 | `gmPrompt` — 기존 `mechanicsPacket` 으로 승인 결과 수신 |
| 기억 | `memoryHorizon` 확장(additive 컬럼), 병렬 기억 DB 금지 |

---

## 6. Server Outcome Contract

> **새 HP 엔진은 만들지 않는다.** 기존 `resolveRoundMechanics` 가 이미 `directEffect/directClass → 권위 HP`(`FLASH_REFEREE`, H9)를 계산한다. 이 계약은 (a) 그 입력을 누가 *제공할 자격이 있는지*, (b) 같은 결과가 *정확히 한 번* 적용되는 방법만 정한다.

### 6.1 다섯 범주 (서버가 부여, GM이 지정할 수 없음)

| 범주 | 정의 | 같은 라운드 피해 | 근거 |
|---|---|---|---|
| **AUTHORED** | 시나리오 작가가 정의한 대상(현재: authored NPC). 템플릿은 live 로 읽히므로 ledger 에 복사해 고정(C2b) | 트리거가 있으면 가능 | 시나리오 템플릿 NPC (`npcKey`, `role`, `stats`) → ledger 복사본 |
| **ESTABLISHED** | 이전에 *커밋된* 라운드에서 서버 검증을 통과해 ledger에 `active` 로 올라간 위협/장애물/함정 | 트리거가 있으면 가능 | threat ledger (§6.3) |
| **CURRENT_CHECK** | 이번 라운드 판정에서 서버가 만든 결과 | 가능 (단, 대상이 AUTHORED/ESTABLISHED 일 때만 HP) | frozen decision + `trpg_dice_rolls` |
| **GM_PROPOSAL** | GM이 서사/구조화 출력에서 새로 제안한 위협 | **불가** (검증 + 상태 확정 *이전*) | 없음 → archive |
| **UNGROUNDED** | 위 범주에 대응되지 않는 hp/conditions/inventory/threat | **거절** | 없음 → archive |

기존 `ONGOING`(틱/회복, `SERVER_PREACTION/RECOVERY`)은 변경 없이 유지.

### 6.2 권한이 아닌 것 (명시)
다음은 **어떤 조합이어도** 서버 권한을 만들지 못한다: GM의 `threat id`, `cause` 문자열(`enemy_counter` 등), `ref`, 서사 문장, 서사 속 NPC 이름, 같은 응답의 hp 숫자·이유, **인간 플레이어 본문이 단언한 사실**(예: "그가 칼을 들고 다가온다")과 **AI 봇 본문**(봇은 GM과 같은 모델 계열 출력이므로 자기승인 고리를 만든다).

### 6.3 Threat ledger (`localSceneProgress` V2, additive)
```ts
type Threat = {
  id: string;                 // 서버만 발급: `thr:<campaignId>:<establishedRound>:<seq>`
  kind: "npc" | "hazard";
  label: string;              // ≤ 기존 ITEM 상한
  origin: { class: "AUTHORED"; npcKey: string } | { class: "ESTABLISHED"; promotedAtRound: number };
  status: "proposed" | "active" | "resolved" | "dismissed";
  canHarm: boolean;           // proposed 동안 false
  engagedWith: number[];      // 대상 binding (participantId). hazard는 location 기준 scene-wide 가능
  severityCeiling: "CHIP" | "LIGHT" | "MEDIUM" | "HEAVY" | "SEVERE" | "CRITICAL"; // 서버 산정(role/kind), GM 텍스트 무관
  clock?: { segments: number; filled: number };  // §8
};
```
저장 위치는 기존 `local_scene_progress_json`(JSON 컬럼) — 새 테이블/파괴적 마이그레이션 없음. `parseLocalSceneProgress` 의 버전 분기로 V1 행은 `threats: []` 로 읽는다.

### 6.4 제안 → 검증 → 확정 (GM_PROPOSAL 수명주기)

GM은 `threatProposals[{ kind, label }]` 만 낼 수 있다(id·status·canHarm·severity 필드 없음). 서버 검증기(결정론, LLM 없음, `localSceneProgress` owner 내 단일 함수):

1. **형식·크기** 검증: 폐쇄 enum, 길이/개수 상한(기존 `TRPG_LOCAL_SCENE_*` 상한 재사용). 위반 → 폐기 + 로그.
2. **동일성 해소**: 정규화 label이 (a) authored NPC 이름/`npcKey`, (b) 이미 active 인 threat 와 겹치면(`namesOverlap` 재사용) **새 위협이 아니다** → 기존 AUTHORED/ESTABLISHED 항목으로 취급하고 새 id를 만들지 않는다.
3. 어느 것과도 겹치지 않으면 `status: proposed, canHarm: false` 로 **기록만** 한다. 이 상태에서는 피해·DOT·아이템 어떤 트리거의 대상도 아니다.
4. **확정(proposed → active)** 조건은 둘 다 필요:
   - 이후 라운드에서 **인간** 제출이 그 위협을 참조(`namesOverlap`)하고 clarify/부정이 아님 — 플레이어가 허구를 받아들였다는 신호. (AI 봇 본문은 확정 근거 아님, §6.2)
   - 서버가 `engagedWith` 를 산정: 확정에 기여한 인간 + 같은 `location` 의 참가자. GM이 임의 대상을 지정할 수 없다.
5. 확정은 *다음 라운드 시작 이후*에만 유효(§6.5 freeze). 즉 새 제안은 **최소 한 라운드 뒤** 서버 트리거 대상이 된다.
6. `dismissed`: 장면 전환 시 `sceneTransitionTo` 로 자동 정리(기존 localScene 전환 규칙 재사용).

환각된 NPC 공격(O07)은 3단계에 머문다: 서사에는 나올 수 있으나 HP/상태는 변하지 않는다.

### 6.5 Freeze 경계와 같은 라운드 규칙
- 서버 트리거는 **라운드 잠금 시점의 ledger 스냅샷**(`ledgerRevision`)과 locked 제출·frozen decision·저장된 d20 만 입력으로 계산한다. GM 출력은 입력이 아니다.
- 그러므로 GM이 라운드 N 응답에서 만든 제안은 라운드 N 의 계산에 영향을 줄 수 없다(**신규 위협 즉시 피해 불가**). 반대로 AUTHORED/ESTABLISHED 위협은 스냅샷에 이미 있으므로 **같은 라운드** 피해가 가능하다(**정당한 반격/기존 함정**, H3/H2/O02/O05).

### 6.6 서버 트리거 (전부 서버 소유, 폐쇄 집합)
| 트리거 | 조건 | 결과 |
|---|---|---|
| **T1 반격** | 이번 라운드 FAILURE/CRITICAL_FAILURE 판정, 시도가 active 위협(AUTHORED/ESTABLISHED)과 결합(`binding` 모호하면 HP 이벤트 없음) | 대상=시도자 또는 위협의 `engagedWith`, 등급=`min(tier→class, severityCeiling)` |
| **T2 노출** | 위험 시도가 active hazard를 참조하고 판정 실패 | 동일 |
| **T3 시계 완료** | 이번 라운드의 근거 있는 tick으로 위협 clock 마지막 칸이 참 | 1회 이벤트 (§8) |
| **T4 지속 효과** | 기존 ongoing tick/회복 | 변경 없음 |

- **성공 판정은 반격 트리거가 아니다**(O04): 근거 있는 대상이 있어도 트리거 없이 GM 숫자만으로는 HP가 움직이지 않는다.
- 플레이어 본문이 단언한 위험(예: ledger에 없는 "무너지는 잔해")은 HP 이벤트를 만들지 못한다. 비-HP 대가(fail-forward, §8)만 가능.
- 이벤트 등급→수치 환산은 기존 mechanics owner(`directClass`)가 수행. GM hp는 **archive-only 제안**으로 `structured_json` 에 보존하고 shadow 비교 대상일 뿐이다.

### 6.7 ThreatEvent 와 단일 적용 계약
```ts
type ThreatEvent = {
  eventKey: string;      // 결정론: `${campaignId}:${roundId}:${trigger}:${triggerRef}:${targetParticipantId}`
  trigger: "T1" | "T2" | "T3" | "T4";
  triggerRef: string;    // submissionId | threatId | effectId  (GM 제공 값 아님)
  threatId: string | null;
  targetParticipantId: number;
  class: "CHIP" | "LIGHT" | "MEDIUM" | "HEAVY" | "SEVERE" | "CRITICAL";
  hpBefore: number; hpAfter: number;     // 절대값. 재적용은 no-op
  ledgerRevision: number;
};
```
- 저장: 기존 `MechanicsResolution`(라운드당 1행) 내부 JSON `threatEvents[]` — 새 테이블 없음.
- **중복 commit**: 기존 GM generation lease + `resolution.applied` early-return + 단일 트랜잭션. 이벤트는 `hpBefore/hpAfter` 절대값이므로 재적용해도 같은 결과(현재 `resolveParticipantHp` 가 commit 시점 `sheet.hp` 를 start로 쓰는 점은 구현 시 *저장된 hpBefore* 로 교체 — Slice 1b 확인 항목).
- **retry(provider 5xx/billing)**: 이벤트는 provider 호출 *이전*에 locked 입력·저장된 d20·ledger 스냅샷으로 생성되어 resolution에 저장된다. retry 는 저장본을 로드하고 재굴림/재계산하지 않는다. (증명 테스트 `gmProviderRetry` F/G/H 는 현재 실패 — §11 게이트.)
- **regeneration**: 기존 `if (opts.regenerate) return;` 로 상태 불변. 재생성 GM 은 *저장된* resolution 에서 같은 승인 결과 packet 을 받는다.
- **동시 actor(2H+2AI)**: 입력은 `locked=1` 집합 하나. 대상별 분리. **(target, round) 당 직접 HP 이벤트 최대 1개**(최고 등급, 동률은 `triggerRef` 오름차순). 나머지 실패는 비-HP 대가로 전환되어 `suppressedEvents` 에 기록(HP 누적 폭주 방지).
- **동일 대상/아이템 충돌**: 현재 owner 없음(C4). 계약: 저장된 판정 결과(tier, 동률은 submissionId)로 서버가 *결정론적으로* 한 명을 정하고, 아이템 보유자는 최대 1명, 다른 참가자의 반응/행동 권한은 침범하지 않는다. 세부 순서 규칙은 Slice 1b에서 fixture(O14/O15, CP05)로 확정.

### 6.8 GM 서사 계약
GM은 기존 `mechanicsPacket` 으로 "승인된 결과(대상·등급·비-HP 대가)"를 받고 한국어 소설로 쓴다. 숫자를 새로 만들지 않는다. 승인된 피해와 서사가 어긋나는 경우(서사에서 빗나감 vs 서버는 피해)는 **상태가 우선**이며, 어긋남 자체는 실제 출력 QA(GPT)의 평가 항목이다. 반대로 GM이 서사에서 근거 없는 피해를 쓰면 HP는 변하지 않고, packet 은 "이번 라운드 HP 변화 없음" 을 명시해 근접 실패/압박으로 쓰게 한다(**새 프롬프트 문장이 아니라 `mechanicsPacket` 내용 교체**; 프롬프트 최종 조립은 Slice 1b에서 `contextBuilder` 계열 owner 확인 후 중복을 삭제하며 반영).

### 6.9 근거 없는 상태 변경 (conditions / inventory)
- `conditions`: GM 문자열이 DOT seed 가 되는 경로(`derivePostGmOngoingSeeds`)를 닫는다. 지속 효과는 T1/T2 + 근거 있는 hazard 로만 기존 ongoing-effect owner 가 생성(O11).
- `inventoryAdd`: 근거(작가 지급 보상 / 근거 있는 interact 성공 / 참가자 간 이전) 정의가 없다 → **정책 결정 필요**(O12). 승인 전 1b 에서도 아이템은 **현행 유지 + shadow 로그만**.
- 소비/제거(`consumeItems`, `inventoryRemove`)는 기존 owner 유지.

---

## 7. Action Semantics Contract

### 7.1 fixture 구조 (baseline 보존 + context-paired)
- `action-corpus.json` 32건은 **text-only baseline probe** 로 보존한다. 보편 oracle 이 아니다. 문맥 의존 행(A11, A15, A18, R06, R11)은 `action-context-pairs.json` 의 `relatesTo` 로 연결된다.
- `action-context-pairs.json`: 10개 pair 그룹 / 22 멤버(CP05 는 4명 제출을 담은 다중 제출 1멤버). 축: 안전/위험 장소(CP01), 존재/부재 대상(CP02), 발언/시도(CP03), 부정·완료 서술(CP04), 2H+2AI 충돌(CP05), 타 행위자 통제(CP06), 모호·고위험 + Reader 실패(CP07), 같은 자세·다른 위험(CP08, CP09), 단언된 사실(CP10).
- **모든 새 라벨은 `proposed-not-approved`, `gate:false`.** GPT/사용자 승인 전에는 강제 회귀 게이트가 아니다.
- 측정(참고용, 라벨 미승인): 비교 가능한 18 멤버 중 현재 owner 일치 11. 같은 문장·다른 기대 4쌍(CP01, CP02, CP08, CP09) 중 현재 owner 결과가 갈리는 것은 1쌍. 현재 owner 는 장면 사실(`facts`)을 입력으로 받을 수 없고 `localScene` 만 받는다.

### 7.2 `needsRoll` ≠ `actionSucceeded`
```ts
type Attempt = {
  participantId: number;
  kind: "talk" | "observe" | "move" | "interact" | "risky" | "contested" | "harm_other" | "unclear";
  stake: "none" | "low" | "high";
  rollNeed: "not_required" | "required" | "clarify" | "deferred";
  binding: { entity: string | null; grounded: boolean };   // §6.3 목록과 대조한 결과
  source: "deterministic" | "reader";
};
type ActionResolution = { check: "none" | "rolled" | "pending"; tier?: Tier; effectGrant: "none" };
```
- `rollNeed=not_required` 는 *실패 게이트가 없다*는 뜻일 뿐 **성공을 보증하지 않는다.** 분류기는 `actionSucceeded` 를 출력하지 않는다. 성공은 서버 판정의 `tier` 로만 존재한다.
- `not_required | deferred` 의 `effectGrant` 는 항상 `none`: HP/상태/아이템/NPC 순응/타 참가자 반응을 서버가 부여하지 않는다. GM은 *행위자 본인 범위 + 확립된 세계 상태* 안에서만 서술한다.
- 타 행위자 통제 금지(CP06): 손을 잡는다 = 시도 사실. 상대(인간/AI)의 반응은 상대의 행동이다.
- 존재하지 않는 대상(CP02b)·단언된 사실(CP10b): 굴림 없음, 피해 없음, **위협/NPC/아이템 생성 없음**.
- GM wire(`formatTrpgActionCheckWire`)의 "realize the submitted action normally" 는 이 계약과 충돌 → Slice 1c 에서 **같은 함수의 문구를 교체**(추가 아님).

### 7.3 Reader 실패 계약 (1d 도입 시)
| 실패 유형 | stake < high | stake ≥ high |
|---|---|---|
| 파싱 실패 / 타임아웃 / enum 위반 | `not_required`, `effectGrant: none` | `deferred`: 굴림 없음, 피해 없음, 성공 부여 없음, 플레이어에게 확인 요청 |
- Reader 출력은 닫힌 enum 이고 HP/아이템 권한이 없다. Reader 실패가 자동 성공/자동 피해/강제 굴림로 변하지 않는다.

### 7.4 regex 확장 금지와 현실적 한계
- 추가 regex·예외 목록은 만들지 않는다. 장면 근거가 있는 축(대상 존재, 장애물, hazard 상태)은 **ledger/authored NPC 와의 폐쇄 목록 대조**(`binding.grounded`)로 푼다 — 동사 패턴 매칭이 아니다.
- 발언 vs 시도, 부정, 완료 서술 같은 **언어 이해**는 결정론으로 끝까지 풀 수 없다. 해법 후보는 둘이며 둘 다 승인 대기: (a) Reader(과금 승인), (b) 입력 UI에서 대사/행동을 사용자가 명시 선택(결정론; UI PR에서 현 `TrpgCommandDock` 확인 후 확정). 둘 다 없는 동안 이 축은 **현행 한계로 남는다고 명시**하고 조용히 개선했다고 주장하지 않는다.
- 칩 `actionType` 은 **힌트**로 강등(`EXPLICIT_ALWAYS_ROLL_TYPES` 강제 제거는 Slice 1c, baseline: 칩 attack → no_roll 20/20 오롤).

---

## 8. Narrative Progression Contract

- **삭제**: rev 1 의 "3라운드 정체 → time_pressure +1 자동 증가"는 규범에서 제거한다. 고정 N턴 에스컬레이션은 없다.
- 비규범 예시(진단 전용): "장면 진전이 오래 없다"는 신호는 *관측 지표*로 GPT/사용자 리뷰에 올릴 수 있을 뿐 자동 압박·장면 전환을 일으키지 않는다. 개선 수단은 GM이 *기회(새 경로/단서)를 제시*하는 것이며 clock tick 이 아니다.
- **Clock 은 확립된 사실에 묶인다.** 생성 근거: (a) 다단계 장애물(`remainingBlockers`), (b) 근거 있는 위협의 접근/행동, (c) 플레이어 선택이 연 대가, (d) 시나리오가 정의한 세계 변화(`majorEvents`). tick 근거: 그 대상에 맞선 실패/대가, 대상에 직접 영향을 주는 플레이어 선택, 서버 검증을 거쳐 확정된 세계 변화. 시간 경과만으로는 tick 하지 않는다.
- `kind: "progress"` clock 완료 → `openRoutes`/`resolvedObstacles` 갱신. `kind: "threat"` clock 완료 → T3 이벤트 1회(§6.6).
- **결과 계약은 전투 전용이 아니다.** 탐험·대화·일상도 같은 enum 을 쓴다: `reveal_cost | position_lost | resource_spent | new_complication | partial_success_with_cost | opening`(HP 이벤트는 §6 근거가 있을 때만). 결과 선택은 roundId 시드로 결정론적(재생성 시 동일).
- **무굴림 행동도 이야기를 진전시킨다.** 장면 진행 상태(`openRoutes`, `resolvedObstacles`, `objective`, 위치)는 *비권한(narrative-only)* 상태라서 현행대로 GM delta 를 sanitize 해 적용한다. 서버 검증이 붙는 것은 **피해 능력이 있는 위협과 HP/상태/아이템** 뿐이다 (서사 진행과 기계 권한을 분리).
- 강제 경로 없음: `openRoutes` 는 노드로 취급(복수 경로 허용), 서버가 단일 정답 경로나 강제 장면 전환을 요구하지 않는다.

---

## 9. Memory Contract (기존 `memoryHorizon` + 서버 canonical state 재사용, 병렬 DB 없음)

### 9.1 다섯 층 구분
| 층 | 소유 | 예 |
|---|---|---|
| 현재 확정된 세계 상태 | **서버 canonical state** (sheet inventory/hp/conditions/location, ledger, localScene, ongoing effects) | 지금 열쇠를 가졌는가 |
| 과거에 발생한 사건 | `trpg_memory_events` (append-only 이력) | R12 획득, R45 분실 |
| 인물별 지식·비밀 | 이벤트 `scope` + `known_participant_ids_json` | 렌만 아는 배신 |
| 정정·무효화된 사실 | 이벤트 `status`/`supersedes` (additive) | 서버가 거절한 GM 서술 |
| 관계 변화와 감정 영향 | relationship/betrayal/reveal 이벤트 *체인* | 신뢰→배신→화해 |

**현재 상태는 이벤트 순위가 아니라 서버 canonical state 에서 읽는다.** 이벤트는 이력과 맥락이며 current-state 를 덮어쓰지 못한다.

### 9.2 사례 (계약 수준)
**아이템 획득 → 분실 → 재획득**
- canonical: 시트 인벤토리(서버 수락 결과)가 *현재 보유 여부*의 유일한 근거.
- 이력: R12 획득, R45 분실, R70 재획득 — **세 이벤트 모두 보존**. recall 은 시간순으로 "R12 획득 → R45 분실 → R70 재획득" 을 보여주고 현재 상태 줄은 canonical 에서 가져온다. latest-wins 로 이전 이력을 지우지 않는다.
- 현재 결함: 같은 문장이면 fingerprint 충돌로 R70 이벤트가 버려진다(P3b).

**신뢰 → 배신 → 화해**
- 이벤트 체인: 신뢰(R3, public) → 배신(R30, `actor_only`, known=[렌]) → 폭로(R60, `reveal`, audience=전원) → 화해(R85).
- 쌍(pair) 단위 *현재 관계 요약*은 최신 이벤트 한 줄이 아니라 **전환점 체인 + 마지막 상태**: "신뢰(R3) → 배신(R30, 공개 R60) → 화해(R85)". 화해가 배신의 인과·감정(예: 상처, 조건부 신뢰)을 지우지 않도록 감정 영향은 이벤트 `fact`(기존 180자 상한 안)에 서술한다.

**정정/무효**
- seal 은 GM *서사*에서 사건을 추출한다. 서버가 거절한 상태 변경(예: H8 `용의 심장`)도 서사에 있으면 이벤트로 추출될 수 있다. 계약: seal 입력에 *서버 수락 결과 diff* 를 함께 주고, canonical 과 충돌하는 추출 이벤트는 `status: contradicted` 로 저장(이력으로는 남되 current-state 근거·"현재 사실" recall 에서 제외)한다. 구현 가능 여부는 Slice 3 에서 seal 입력 owner 를 확인.

### 9.3 이벤트 identity / supersession
- 현재 identity = `fingerprint`(campaign|type|정렬 actors|정규화 fact), 라운드 미포함, `INSERT OR IGNORE`.
- 계약: **신규 행**의 fingerprint 에 `|r<roundStart>` 를 포함해 같은 문장의 재발생을 별개 이벤트로 보존한다. 기존 행은 건드리지 않는다(UNIQUE 제약 재구성이나 테이블 재생성 없음 → 파괴적 마이그레이션 아님).
- additive 컬럼 후보(`addColumn` 관례): `status TEXT DEFAULT 'valid'`, `supersedes_event_id INTEGER NULL`. **superseded ≠ 삭제**: recall 은 supersede 된 이벤트를 "이력"으로 표시하고 current-state 줄에서만 제외.

### 9.4 가시성 / 2인간 + 2AI / GM 공개 서술 경계
- viewer 확장: `gm | bot(participantId) | human(participantId)`. `eventVisibleToViewer` 단일 owner 가 `scope` + **`knownParticipantIds`** 를 모두 사용(현재는 후자 미사용).
- `known` 산정 정정: 현재는 *actors 의 display_name 일치자*만. `party_observed` 는 *그 장소에 있던 참가자*, `actor_only` 는 행위자(+전달받은 자), `public_world` 는 전원.
- **GM 서사는 공개 채널**(방의 모든 인간이 읽음). 따라서 `actor_only` 내용을 서사에 직접 서술하는 것은 곧 *공개(reveal)* 다. 계약: (1) GM 기억 블록은 줄마다 scope/knower 를 표시한다(`[비밀: 렌만 앎]`) — 지금의 `- R30: …` 로는 구분 불가(C7); (2) GM 은 비밀을 NPC/AI 행동에 반영할 수 있으나 서술로 밝히면 reveal 이벤트로 기록되고 audience=서술을 본 전원이 된다; (3) AI 봇은 이미 viewer 별 recall 이라 타 좌석 비밀을 받지 않는다.
- 한계(정직): (2) 는 *사후 기록*이다. 서사에 비밀이 유출되는 것을 구조적으로 막지 못한다. 그래서 유출률은 **실제 출력 QA 항목**이며 이 PR은 개선을 주장하지 않는다.

### 9.5 검증 계획 (turn 5 / 20 / 50 / 100, 호출 없음)
| 시점 | 확인 |
|---|---|
| T5 | RAW 창 밖 이벤트 없음 → recall 비어도 current-state 는 canonical 에서 정확 |
| T20 | 약속/아이템 시간순 recall |
| T50 | 아이템 획득→분실 이력 전부 + 현재=분실, 신뢰→배신 체인 |
| T100 | 재획득(동일 문장) 보존, 화해 후에도 배신 체인 보존, 정정 이벤트가 current 로 보이지 않음 |
| 2H+2AI | 비밀 viewer 별 비가시 → 폭로 후 가시, GM 블록 knower 표시 |
seal *추출* 정확성은 실제 모델 출력이 필요 → §14 유료 평가에서만 확인 가능.

---

## 10. Architecture Comparison (변경 없음, 요약)

| 축 | A. 통합만 | **B. 인프라 재사용 + 계약 재설계 (승인됨)** | C. 전면 교체 |
|---|---|---|---|
| 서버 무결성 | H1/H4/H5/H6/H7 미해결(H1·H3 동일 경로) | provenance 로 해결, d20/원장/락 유지 | 해결하나 건전한 부분까지 폐기 |
| 지연/비용 | 0 | Slice 1a–1c 호출 0 | 미정 |
| 회귀 위험 | 낮음(문제 잔존) | 중간 — 라벨된 H/O 케이스로 관리 | 높음 |
| 근거 | — | `directEffect/directClass` 재사용(H9) | mechanics 3,554 LOC + 39 테스트 파일 폐기, 더 단순하다는 증거 없음 |

## 11. Regression Plan

### 11.1 함께 만족해야 하는 조건 (→ 케이스)
| 조건 | 케이스 |
|---|---|
| 근거 없는 HP 변경 거절 | H1 H4 H5 H6 · O01 O06 O07 O08 O09 O20 |
| 정당한 반격 피해 유지 | H3 · O02 O05 O10 |
| GM 숫자 누락 시 서버 승인 피해 유지 | H2 · O02 O05 |
| 서버 피해를 GM이 낮추거나 치유 못함 | H9 · O03 |
| 무근거 상태이상·아이템 거절 | H7 H8 · O11 O12 |
| 기존 회복·DOT·소비 유지 | H10 · O13 (`hpDamageOwnership.repro.test.ts` L1–L4, ONGOING-1..3, M7, M8) |
| 2U+2AI 대상별 분리 | O14 O15 CP05 |
| 실패·재시도·재생성·중복 commit 단일 적용 | O16 O17 O18 O19 |
| 행동 분류가 자동 성공으로 변질되지 않음 | CP01–CP10 의 `effectGrant: none`, O20 |

### 11.2 라벨링 선행
baseline H-probe 의 H2/H3 장면에는 provenance(authored 적/active 위협)가 **없다**. 따라서 1b enforce 전에 반드시 (1) H1–H10 에 §6.1 범주를 라벨하고, (2) *기존 encounter 대표 케이스*(O02, O05, O10, O14, O15)를 실제 authored NPC/ledger 로 구성해 통과시켜야 한다. **shadow 비교만으로는 GM HP 변경의 정당성을 판정할 수 없다**(독립 provenance 가 없기 때문) — shadow 는 *불일치 분포 관측*용이고 합격 기준이 아니다.

### 11.3 기존 main 실패 32건 분류 (이 PR 범위 밖, 수정 안 함)
| 분류 | 항목 | 이 설계와의 관계 |
|---|---|---|
| **GATE-1** 파싱 불가 | `postGmOngoingTrust.test.ts` (`gmText(participantId?: number, conditions?[], {` 구문 오류, `ae26a4b5` 이후) | **Slice 1a/1b 필수 선행.** GM 조건 → DOT owner 의 유일한 trust 테스트. 수정·검증은 해당 슬라이스의 테스트 게이트에서 하며 본 docs PR 에서 하지 않는다. |
| **GATE-2** 멱등성 증명 | `gmProviderRetry` F/G/H (`empty completion`/ERROR_RECOVERY, 원인 미분류) | §6.7 retry/billing 단일 적용 주장의 증명 테스트 → 1b 전에 원인 분류·복구 필요. |
| 관련 | engine 봇 좌석 테스트(mock 내부 assertion drift) | 1c 가 봇 입력 경로를 건드릴 때 정리 |
| 무관 | UI/스크롤/lobby/시나리오/모델 라우팅/가격 등 나머지 | 이 계열 작업과 분리 |
전체 목록은 실행 아티팩트(`trpg-baseline-796d279f.txt`, 2049 tests / 2016 pass / 32 fail / 1 skipped). 이번 PR은 runtime/test 를 바꾸지 않으므로 숫자는 동일해야 한다.

---

## 12. REMOVED / CONSOLIDATED CANDIDATES
(writer·reader·기존 데이터·롤백 증거 없이는 삭제 금지)

| 대상 | 분류 | 조건 |
|---|---|---|
| `EXPLICIT_ALWAYS_ROLL_TYPES` 칩 강제 롤 | FOLLOW-UP (1c) | #1523 과 같은 owner. 유효 변경은 흡수, 독립 병합 안 함 |
| `GM_LEGACY` HP 수용 + incomplete 경로 `clampHp(gmHp)` | FOLLOW-UP (1b, **정책 승인 필요**) | 라벨된 H/O 통과 후 |
| `derivePostGmOngoingSeeds` GM condition → DOT | FOLLOW-UP (1b) | 활성 effect 영향 조사 |
| `mechanicsValidate.hasActivePhysicalThreat` regex | FOLLOW-UP | ledger threat 로 대체 후 삭제 후보 |
| `mechanicsReferee.ts` (LLM referee, 기본 OFF) | FOLLOW-UP | 운영 flag **UNKNOWN** → 확인 전 삭제 금지 |
| `ENEMY_HP_ENGINE=false` 분기 | KEEP | 신규 NPC 전투 결정 전까지 |
| 입력 해석 중복(`actionSemantics` `canonicalAttempt` `mechanicsIntent` 봇 마커) | FOLLOW-UP (1c) | 단일 Attempt owner |
| `formatTrpgActionCheckWire` 의 "realize … normally" | REPLACE (1c) | §7.2 |
| 낡은 "Pro" 주석/테스트 | SAFE TO DELETE(주석) / FOLLOW-UP(테스트) | 해당 슬라이스가 건드릴 때 |

## 13. PRESERVED
인증/권한, 과금 분배(`splitTrpgRoundCost`, AI 봇 무과금), 락/동시성/freeze, 서버 d20, 서버 틱·회복 owner(H10), 서버 권위 피해 우선(H9), 단일 commit 트랜잭션과 lease, `regenerate` 상태 불변, `persistSheets` + 원장 + `structured_json` + `state_change_log`, seal 파이프라인, `localSceneProgress`, GM json_schema 구조화 출력, `actor_only` 가시성 필터, #1521 Base64 이미지 전송. **출력 글자 상한은 새로 두거나 줄이지 않는다.**

## 14. Real GM output 평가 (SEPARATE, 미승인)
평가 항목: 자연스러운 한국어, 캐릭터 말투, 대사·심리·환경 균형, 캐릭터별 행동 권한, 인과, 기억 정확성(§9.4 비밀 유출 포함), 진행, 장면/위치 연속성, 세계관 분위기, 출력 길이/밀도. Cursor 는 점수를 매기지 않고 원본을 PR 에 제출 → GPT/사용자 평가.
- 규모(미승인): 3 시나리오 × 4라운드(2H+2AI) × 2 변형 = GM 24 + 봇 48, 50라운드 기억 캠페인 × 2 변형 = GM 100 + 봇 200 (+ seal 약 34회). 합계 전경 호출 ≈ 372. 참고 단가(`publishedModelPricing` `gemini-3.8-flash` 입력 $0.375 / 출력 $1.875 per 1M, `billing.ts` fallback 토큰) 추정 < $2 는 **미검증**(`gpt-6-luna` 단가 UNKNOWN).
- **순서**: 먼저 추가 provider 호출이 없는 슬라이스(1a–1c, 기존 활성 모델 경로 그대로)로 증명한 뒤 평가를 요청한다.

## 15. COST / LATENCY
| 항목 | 현재 | Slice 1a–1c | Slice 1d(Reader) |
|---|---|---|---|
| 라운드당 호출 (2H+2AI) | GM 1 + 봇 2 (+ 백그라운드 seal) | **동일** | +1 소형(병렬 가능) |
| 사용자 과금 | `computeTrpgRoundPoints` = 실제 호출 합 | 동일 | **변경 → 별도 과금 승인** |
| 지연 | 운영 P50/P95 **UNKNOWN** | 결정론 연산 추가만 | 봇과 병렬이면 임계 경로 증가 없음(가정) |

## 16. 정책 승인이 여전히 필요한 항목 (STOP gates, 모두 미승인)
1. **1b GM_LEGACY HP 수용 폐기/enforce.**
2. **과금되는 Attempt Reader 호출(1d).**
3. **유료 실제 출력 배치(§14).**
4. **운영 flag(`FLASH_REFEREE` 등) 삭제 및 `mechanicsReferee.ts` 삭제.**
5. **#1523 병합** (자동 병합 금지, 1c 가 유효 변경 흡수).
6. **아이템 grant provenance 정책**(O12).
7. 새 라벨의 강제 게이트 승격(`proposed-not-approved` → 승인).
8. 실제 RP 문장 품질은 UNVERIFIED.
추가로 owner/원인 미확정, 파괴적 DB 마이그레이션, 인증/과금 변경, 합법 인간 PC 행동 권한 훼손, 무관한 대형 변경이 필요해지면 즉시 STOP 하고 증거와 옵션만 보고한다.

## 17. REGRESSION RISKS
1. enforce 후 합법 전투 피해 소실 → 라벨된 O02/O05/O10 통과 전 enforce 금지.
2. 서사는 명중인데 서버는 비피해(또는 반대) → packet 에 "승인 결과/HP 변화 없음" 명시, 어긋남은 실제 출력 QA 대상.
3. 새 위협 확정 지연(한 라운드)이 전투 템포를 늦춤 → authored NPC 는 즉시 대상이 되므로 보스전 템포 영향 없음. 즉흥 적 등장만 지연.
4. 인간 본문 참조를 확정 근거로 쓰므로 플레이어가 허구 위협을 "받아들여" 피해 가능 → 피해는 여전히 서버 트리거(T1–T3) 필요, 상한은 서버 산정.
5. `namesOverlap` 기반 binding 의 오탐/누락 → 모호하면 HP 이벤트 없음(보수적).
6. 기억 fingerprint 변경이 신규 행만 적용 → 기존 중복 판정은 그대로, 마이그레이션 위험 낮음.
7. 기존 32 실패 + GATE-1/2 → 슬라이스마다 변경 전/후 실패 집합 diff 로 "신규 실패 0" 증명.

## 18. IMPLEMENTATION PLAN (각각 작은 Draft PR, GPT 검수·승인 후 병합; 실제 원인에 필요한 최소 변경과 직접 회귀만)

| Slice | 내용 | provider | 선행 의존 |
|---|---|---|---|
| **0 (#1544)** | RFC rev 2 + fixtures + baseline runner. runtime 0 | 0 | — |
| **1a** | (i) **GATE-1 확인**: `postGmOngoingTrust.test.ts` 파싱 복구·실행 확인(해당 PR 테스트 게이트), (ii) 서버 threat ledger/ThreatEvent 데이터 설계, (iii) **shadow 비교** (GM hp ≠ 서버 승인 분포 관측; 합격 기준 아님) | 0 | GATE-1 |
| **1b** | 서버 승인 결과 적용(T1–T4), GM hp archive-only, 근거 없는 conditions 거절, `GM_LEGACY`/incomplete 경로 정리 | 0 | **정책 승인 §16-1**, GATE-1·GATE-2, 11.2 라벨된 H/O 케이스 통과 |
| **1c** | 행동 해석 owner 통합: 칩 강제 롤 제거, `binding.grounded`, wire 문구 교체, **#1523 유효 변경 흡수**(#1523 독립 병합 없음) | 0 | 1a(ledger 정의), 라벨 승인 |
| **1d** | 선택: Attempt Reader | +1 소형 | **별도 과금 승인 §16-2**, 1c |
| **2** | 장면 진행: clocks(근거 기반)·결과 다양성, localScene V2 | 0 | 1b(위협 근거), JSON 롤백 경로 확인 |
| **3** | 기억: identity(round 포함), status/supersedes, 가시성, GM 블록 knower 표시 | 0 (seal 추출 품질은 §14) | — |
| **4** | 초보자 UX + 실제 2H+2AI RP 품질 검증 | 유료(승인) | §14 승인, 1c/1d 결정 |

초보자 UX 는 별도 PR(입력은 행동/대사 텍스트, 칩 비강제, clarify 1회 확인, 결과 표시는 "성공/대가가 따른 성공/상황이 바뀜", 주사위·시트는 고급 보기, BEFORE/AFTER 이미지 원본 커밋 + Base64 전송, 영상 생략). UI 세부는 UI PR 직전에 현 `TrpgCommandDock`/`TrpgRoomClient` 를 다시 읽고 확정한다.

## 19. Change budget
MUST FIX NOW: 계약 정정·검증 가능한 fixture·기준선. REQUIRED CLEANUP: §12 중복 owner 정리 계획, GATE-1/2 기록. SAFE OPTIONAL: Reader, 낡은 주석. SEPARATE FOLLOW-UP: 기억 구현 상세, GM 문체, 초보자 UI, 신규 NPC 전투, 작가용 hazard 필드.
