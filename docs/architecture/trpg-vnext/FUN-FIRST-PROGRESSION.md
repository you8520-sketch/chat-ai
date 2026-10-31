# TRPG R0 — Fun-first progression contract

- 상태: **R0 DESIGN + LOCAL EVIDENCE**; R1 구현·로컬 플레이는 같은 브랜치의 제품 PR에서 이어졌다 (병합/배포 없음)
- 기준 main: `9d190989b9ab6c14c03e5a3fe1a833b7a2de6866`
- 관련: #45, #1786, P3-61, 기존 `docs/architecture/trpg-vnext/RFC.md`
- 증거: `hav-rp-evidence-private`의 `cases/trpg-r0-2026-10-31-fun-progression/` (Draft PR)
- 이 문서는 구현 청사진이며, 병합·배포·운영 DB 변경을 포함하지 않는다.

---

## 0. R0 정정 (R1 구현 기준)

R0 원본 PR(#1793/#54)은 보존하고, 아래 판단만 R1 증거와 이 문서에서 정정한다. 유료 실험을 다시 돌려 원본을 대체하지 않았다.

1. **완료 플래그 성공과 최종 위치 일치 실패는 다른 사건이다.**
   - R0 로컬 완주는 `effectiveCampaignFinished=true` / `CAMPAIGN_COMPLETE`였다.
   - 그러나 final-state의 시트/지도 위치는 `등대 기계실`이었고, 마지막 GM 서술은 부두를 떠났다고 말했다.
   - 즉 “완료 플래그 성공”은 맞고, “최종 위치/서술 일치”는 실패다. 성공 실행으로 대체 설명하지 않는다.
2. **JEV binary ending 혼동행렬**: TP=1, FN=1, TN=18, FP=0.
   - accuracy 95%, 종료 감지 recall 50%.
   - 유일한 FN은 긴 봇 복합문(farewell)이다. human 19/19만 보고 “종료 감지 95%”라고 일반화하지 않는다.
3. **C10/C19는 문장 전체 negated가 아니다.**
   - 부정된 named act와 뒤따르는 긍정 행동을 분리한다. 예: “칼을 뽑지 않고 두 손을 펼쳐 보인다” → negated(칼을 뽑지 않고) + committed(두 손을 펼쳐 보인다).
   - R1 `actionContract.ts`는 act별 `commitment`로 이 구분을 보존한다.
4. **benchmark adapter와 운영 판정을 구분한다.**
   - R0 JEV 20-case의 `currentAction`/`currentEnding`은 비교용 adapter다. production classifier가 아니다.
   - R1의 운영 판정은 `actionContract.ts`(제안/계획), `endingDecision.ts`(종료), `progression.ts`(성장)다.
5. **탐색 실행 원본은 미보존이다.**
   - R0 탐색 실행 디렉터리는 `--fresh`로 덮어써져 원본이 없다.
   - 완주 실행 원본으로 대체하지 않고 “미확보”로 기록한다.
6. **비용은 소계다.**
   - `$0.246311`은 기록된 R0 GM/JEV 소계다.
   - background memory 호출은 `api_cost_ledger`에서 R0/R1 window row를 찾지 못했다. 테스트 harness가 `NODE_TEST_CONTEXT`로 ledger 기록을 생략했기 때문이다.
   - 따라서 “총비용 확정”이라고 보고하지 않는다. 기록된 GM+bot+JEV 소계만 보고한다.
7. **증거 PR 본문 인코딩**은 UTF-8로 다시 작성한다.

---

## 1. 왜 재구축하는가

### 1.1 #45에서 확인된 것

- 운영 #45는 R13 퇴장, goal claim, host confirm까지 성공했다.
- R14 GM은 `campaign_finished`를 세우지 않았거나, 세웠더라도 서버 effective predicate가 거절했다.
- 최종 상태는 R15 `ACTION_INPUT`이었고, 두 목표는 모두 completed, 렌은 `시설 밖`, 봇 둘은 `출입문`이었다.
- **저장된 클라이언트 자료만으로는 “GM이 종료를 요청했는지”와 “서버가 거절했는지”를 구분할 수 없다.**
  - exact system/user prompt: 미확보
  - provider finish reason: 미확보
  - parsed/stored `campaign_finished` / `effectiveCampaignFinished`: 미확보
  - effective finish=false: 확정
- 따라서 “GM boolean 하나를 빠뜨렸다”는 단일 원인으로 단정하지 않는다.

### 1.2 로컬에서 재현된 것

캠페인 15 `등대의 마지막 불빛` (로컬 전용, 5 action rounds + opening):

- R4: GM structured `campaign_finished=true`, `effectiveCampaignFinished=false`.
  - 목표가 아직 `claimed`/active였고 host confirm 전이었다.
- R5: host confirm 후 명시적 작별 행동을 커밋하자 `campaign_finished=true`, `effectiveCampaignFinished=true`, `CAMPAIGN_COMPLETE`.
- 즉 **GM 요청과 서버 확정은 다른 사건**이며, 클라이언트 snapshot은 둘을 구분해 주지 않는다.

### 1.3 재미/정확성에서 확인된 것

- 현재 분류기는 `문 앞에서 기다린다`를 challenge로, `그가 칼을 들고 다가온다`를 force attempt로, `받아 든다`를 item take로 읽지 못했다.
- JEV 20-case:
  - action 18/20 (90%) vs 현재 13/20 (65%)
  - commitment 18/20 (90%) vs 현재 17/20 (85%)
  - ending 3-way 6/20 (30%) → 사용 불가
  - ending binary 19/20 (95%), human 19/19, 긴 봇 복합문 0/1
- 현재 서버는 HP/AP/아이템/주사위를 소유하지만, **전투/성장을 표시하는 전용 JSX는 없다.** 시트 JSX가 HP/상태/소지품/메커니즘 줄을 표시하고, 액션 카드가 d20을 표시하는 정도다.
- XP/레벨업/능력치 성장 owner는 **NOT FOUND**다. `level`은 시트 표시 필드일 뿐 성장 로직이 없다.

---

## 2. 설계 원칙

1. **한 번의 의도 → 한 번의 확정 → 한 번의 GM 서사.**
   자유서술을 여러 번 재해석하거나, 같은 행동을 확인창으로 반복하지 않는다.
2. **해석은 열고, 권한은 닫는다.**
   의미 해석은 제안일 뿐이고, 합법성·AP·주사위·HP·소지품·DB는 서버가 소유한다.
3. **인간과 봇은 같은 실행 계약을 쓴다.**
   봇은 자기 행동을 제안하고, 인간과 동일한 `ActionProposal → ActionPlan → Resolve → Commit` 경로를 탄다.
4. **목표 완료는 캠페인 종료가 아니다.**
   명시적 종료 의도 또는 시나리오 완료 조건 + 서버 조건이 함께 성립할 때만 종료한다.
5. **기존 phase/저장 구조를 재사용한다.**
   새 Journal, 새 상태기계, 병렬 영구 실행 경로를 만들지 않는다.
6. **선택을 대신 만들지 않는다.**
   인간의 미선택 행동·대사·이동·아이템 수령을 GM이 완료형으로 서술하지 않는다.

---

## 3. 최소 진행 계약

### 3.1 타입 (개념)

```ts
type ActionAct =
  | { kind: "move"; destination: string; polarity: "committed" | "conditional" | "negated" | "mentioned" }
  | { kind: "observe"; target?: string }
  | { kind: "talk"; target?: string; quotedOnly: boolean }
  | { kind: "wait"; target?: string }
  | { kind: "item_take"; item: string }
  | { kind: "item_use"; item: string }
  | { kind: "force"; target?: string }
  | { kind: "social"; target?: string }
  | { kind: "other"; text: string };

type ActionProposal = {
  acts: ActionAct[];
  endingIntent: "none" | "farewell" | "scene_close";
  ambiguity: { needsClarification: boolean; question?: string };
  confidence: number;
  sourceText: string;
};

type ActionPlan = {
  ordered: Array<{ act: ActionAct; apCost: number; legal: boolean; reason?: string }>;
  checks: Array<{ actIndex: number; statKey: string; dc: number }>;
  rejected: Array<{ actIndex: number; reason: string }>;
};
```

`ActionProposal`는 저장하지 않아도 된다. 저장이 필요하면 `trpg_action_submissions`의 기존 body/action_type/idempotency 컬럼을 재사용하고, 별도 JSON 테이블을 만들지 않는다.

### 3.2 파이프라인

1. **Input**
   - 인간: 원문 `body` + 선택한 UI 명령(탐험/아이템)을 그대로 보존.
   - 봇: 자기 행동 제안 + 동일한 typed command.
2. **Proposal (one pass)**
   - 문장을 한 번만 해석한다.
   - 여러 act를 순서대로 분리한다.
   - 조건부/부정/인용/타인 행동을 별도 polarity로 표시한다.
   - 종료 의도는 binary로 표시한다.
3. **Plan (server)**
   - 이동 가능 경로/문/AP를 확인한다.
   - 아이템 소유/제공/수령 조건을 확인한다.
   - 주사위가 필요한 act만 check로 만든다.
   - **복합 행동을 “문장에 두 행동이 있다”는 이유로 일괄 거부하지 않는다.**
     - 이동 + 아이템: 이동 후 아이템 순서로 AP를 지불하고, AP가 부족하면 부족한 act만 구체적 이유로 보류/거부한다.
     - 이동 + 대화: 대화는 method note로 유지한다.
     - 이동 + 퇴장: 퇴장은 명시적 종료 의도와 함께 처리한다.
4. **Resolve (server)**
   - act별 d20/DC/tier, HP/AP/conditions/inventory/location을 기존 owner로 확정한다.
   - 서버 결과는 하나의 canonical `amount`/`hpAfter`/`apAfter`로 투영한다.
5. **Commit**
   - 확정된 act/result만 `trpg_action_submissions`, `trpg_dice_rolls`, `trpg_mechanics_resolutions`, `trpg_character_sheets`, `trpg_campaign_state`에 기록한다.
6. **Narrate (GM)**
   - GM은 확정된 결과를 서사로만 쓴다.
   - NPC 목적/관계/분위기/다음 전개는 GM 소유.
   - 확정되지 않은 행동, 미선택 선택지, 수치 변경을 만들지 않는다.

---

## 4. 종료 계약

### 4.1 현재 문제

현재 `resolveEffectiveCampaignFinished`는 `gmRequested`를 **필수**로 받는다.

- v1: party escape fact + no pending goal confirmation
- v2: no active goal + at least one completed goal + typed ending or party occupies goal rooms

따라서:

- 목표가 모두 completed여도 GM boolean이 없으면 끝나지 않는다.
- GM boolean이 있어도 goal claim/confirm이나 동료 위치가 맞지 않으면 끝나지 않는다.
- 종료가 결정된 장면에서도 일반 `ACTION_INPUT` 라운드가 다시 열릴 수 있다.

### 4.2 새 계약

**종료는 “GM boolean”이 아니라 “서버가 확정한 ending decision”이다.**

```ts
type EndingDecision =
  | { kind: "none" }
  | { kind: "end"; reason: "explicit_farewell" | "scenario_complete" | "both"; conditionId?: string };
```

판정 순서:

1. **명시적 종료 의도** (`endingIntent=farewell|scene_close`)
   - 또는 시나리오 `endingConditions` / typed ending condition 충족.
2. **필수 목표 상태**
   - active 필수 목표가 없어야 한다.
   - pending claim은 **같은 종료 처리 안에서** host confirm 또는 명시적 decline으로 해소한다.
   - 선택적 선물/잡담/미수령 아이템은 종료를 붙잡지 않는다.
3. **동료/좌석**
   - 시나리오가 “전원 퇴장”을 명시한 경우에만 전원 퇴장을 요구한다.
   - 그 외에는 동료가 문 안쪽에 남아 있어도 종료할 수 있다.
4. **종료 장면 전환**
   - `EndingDecision=end`이면 새 일반 `ACTION_INPUT`을 만들지 않는다.
   - 같은 commit에서 `CAMPAIGN_COMPLETE`로 finalize하고, GM에는 ending mode로 한 번만 호출한다.
   - GM `campaign_finished`는 **요청 신호**로만 사용한다. 서버가 이미 end로 결정한 장면을 GM boolean 누락으로 다시 열지 않는다.
5. **마지막 서사**
   - 다음 행동 질문/선택지 금지.
   - 새 목표 등록 금지.
   - 미선택 선물 수령/이동/대사를 완료형으로 쓰지 않는다.
   - 플레이어가 명시적으로 말한 작별만 사용한다.

### 4.3 기존 구조에 편입

- 새 phase를 추가하지 않는다. 기존 `ROUND_COMPLETE` / `CAMPAIGN_COMPLETE`를 쓴다.
- 새 테이블을 만들지 않는다. `trpg_campaign_state`, `trpg_gm_messages.structured_json`, `trpg_rounds`를 재사용한다.
- `structured_json`에는 최소한 다음을 남긴다.
  - `campaign_finished` (GM 요청)
  - `effectiveCampaignFinished` (서버 확정)
  - `endingDecision` (reason/conditionId)
- 클라이언트 snapshot에도 `endingDecision` 또는 `campaignCompleteReason`을 노출해, “GM 요청”과 “서버 확정”을 구분한다.

---

## 5. JEV 채택 범위

상세 비교: `JEV-20-CASE-COMPARISON.md` (원본은 evidence PR #54).

### 5.1 채택

- JEV는 **action/commitment proposal**로만 쓴다.
- 한 번의 호출로 `ActionProposal`을 만들고, 서버가 legal/AP/dice를 확정한다.
- JEV를 추가 차단기로 두지 않는다.
- 대체 대상:
  - `actionSemantics.ts`의 `classifyActionClause` / `committedActionText` / `hasChallengeSignal` / `classifyChallengeKind`
  - `movementDeclaration.ts`의 `parseMovementDeclaration` lexical goal 판정
  - `actionCheck.ts`의 challenge/talk/flavor/routine 의미 게이팅
- 유지 대상:
  - `dice.ts`, `stats.ts`, `actionTypes.ts`
  - `explorationMap.ts`, `explorationStore.ts`
  - `engineSheets.ts`, `inventory.ts`, `itemAcceptance.ts`
  - auth/billing/idempotency/lease

### 5.2 미채택

- JEV 3-way ending label (30%).
- JEV를 최종 종료 owner로 쓰는 것.
- JEV binary ending도 human 명시적 작별에만 보조 신호로 사용한다. 긴 봇 복합문은 서버 text/contract로 보정한다.

### 5.3 품질 기준

- 20-case gold set에서 action/commitment가 현재보다 낮아지면 채택하지 않는다.
- 낮은 confidence 또는 상충하는 서버 사실이 있으면:
  - 한 번의 짧은 clarification, 또는
  - 보수적 no-op(움직이지 않음/소비하지 않음)으로 처리하고,
  - 정상 플레이를 막는 hard gate로 만들지 않는다.

---

## 6. JSX / 화면 계약

### 6.1 서버 투영

새 JSX는 서버 snapshot의 다음 투영만 받는다.

```ts
type TrpgGameView = {
  party: Array<{
    participantId: number;
    name: string;
    level: number;          // display only; no growth owner
    hp: number;
    maxHp: number;
    ap: number;             // exploration AP
    location: string;
    conditions: string[];
    stats: Record<string, number>;
    inventory: Array<{ key: string; name: string; quantity: number; equipped: boolean; slot: string | null }>;
  }>;
  rolls: Array<{ participantId: number; d20: number; statKey: string; modifier: number; finalScore: number; dc: number; tier: string; success: boolean }>;
  encounter: null | {
    id: string;
    name: string;
    kind: "enemy" | "hazard";
    strikes: Array<{
      d20: number;
      dc: number;
      hit: boolean;
      damageClass: string;
      diceExpression: string;
      diceRolls: number[];
      amount: number;       // canonical HP loss, not raw die total
      hpBefore: number;
      hpAfter: number;
    }>;
    ended: boolean;
  };
  goal: Array<{ id: string; title: string; status: "active" | "completed"; claimed: boolean }>;
  ending: { complete: boolean; reason?: string };
};
```

### 6.2 재사용

- `src/components/JsxComponentSandbox.tsx`: 기존 sandbox, host bridge, `setTrpgActionDraft` / `setTrpgSelectedStat`를 그대로 재사용한다.
- `src/lib/trpg/sheetSurface.ts`: 시트 투영 owner.
- `src/lib/trpg/sheetJsxSource.ts`: 기존 시트 JSX 소스. HP/스탯/상태/소지품/메커니즘 줄을 이미 표시한다.
- `src/app/trpg/TrpgCampaignRoom.tsx`: 액션 카드/d20 표시 owner.
- `src/lib/trpg/actionCardUi.ts`: d20 tone/outcome 표시.

### 6.3 새로 필요한 것

- `encounter` 투영을 시트/전투 패널에 바인딩하는 props.
- `amount`(canonical HP loss)와 `diceRolls`/`diceExpression`을 분리해 표시.
- `ending.complete`일 때 다음 행동 composer를 숨기고, 마지막 서사만 표시.

### 6.4 절대 하지 않는 것

- 생성 JSX가 HP/AP/d20/DC/아이템 수량을 임의로 만들지 않는다.
- JSX가 `dice.total`을 HP loss로 표시하지 않는다.
  - 현재 서버 packet은 `dice.total`(2)을 출력하지만 실제 적용은 `amount`(4)다. `LIGHT 1d4`에서 `hpUnit(maxHp)=2`가 곱해져 HP 40→36이 됐다.
  - UI/서버 packet 모두 `amount` 또는 `hpBefore → hpAfter`를 단일 진실로 써야 한다.

---

## 7. 재사용 / 교체 / 삭제 지도

전체 표는 `OWNER-MAP.md`에 있다. 요약:

### 재사용 (그대로)

- 주사위/능력치: `dice.ts`, `stats.ts`, `actionTypes.ts`, `roundAdjudication.ts`
- 지도/AP: `explorationMap.ts`, `explorationStore.ts`, `explorationPublic.ts`
- 시트/소지품: `engineSheets.ts`, `inventory.ts`, `itemAcceptance.ts`
- 인증/과금/중복: `requireApi.ts`, `engineAdvance.ts`의 `upsertLockedAction`/lease, billing owners
- GM 경계: `gmPrompt.ts`, `gmCall.ts`, `gmStructuredOutput.ts`
- JSX: `JsxComponentSandbox.tsx`, `sheetSurface.ts`, `sheetJsxSource.ts`, `TrpgCampaignRoom.tsx`

### 교체 (의미 해석만)

- `actionSemantics.ts`의 regex/lexicon clause classification
- `movementDeclaration.ts`의 lexical movement parsing
- `actionCheck.ts`의 challenge/talk/flavor/routine semantic gating
- `uncommittedActionWire`/`canonicalRemainderLock`는 유지하되 typed proposal에서 파생

### 통합/삭제 후보

- 종료/목표/장면 판정 중복:
  - `campaignGoals.ts`의 goal completion
  - `campaignContext.ts`의 story phase
  - `localSceneProgress.ts`의 local scene
  - `engineAdvance.ts`의 `resolveEffectiveCampaignFinished` / `campaignFinishWouldStand`
  - `gmPrompt.ts`의 `TRPG_GM_ENDING_FINISH_HEAD`
- 새 owner: `campaignState` 하나가 “필수 목표 + 시나리오 조건 + ending decision”을 소유하고, 나머지는 projection으로 만든다.
- 삭제는 새 owner의 acceptance test가 통과한 뒤에만 한다. 이번 PR에서는 삭제하지 않는다.

### 보호 규칙

- auth/billing/idempotency/lease/중복 지급 방지는 **삭제 대상이 아니다.**
- 자연어 보정용으로 누적된 regex/lexicon/fallback만 교체 대상이다.
- `upsertLockedAction`의 기존 제출 확인은 유지하되, exploration pricing보다 **먼저** 실행해야 한다.
  - 로컬 R1/R2 중복 제출은 “이미 제출했습니다”가 아니라 “이동력이 부족합니다”로 실패했다. 중복 방지가 pricing 뒤에 있기 때문이다.

---

## 8. 적용/롤아웃

1. **Shadow mode**
   - `ActionProposal`을 서버에서 만들되, 기존 `actionSemantics`/`actionCheck` 결과를 그대로 사용한다.
   - 20-case + 실제 캠페인 로그에서 차이를 기록한다.
2. **Canary**
   - 새 캠페인 또는 host opt-in에만 typed proposal 경로를 켠다.
   - 기존 캠페인은 현재 경로 유지. in-flight 상태를 재작성하지 않는다.
3. **Cutover**
   - action/commitment JEV가 gold set에서 현재보다 낮지 않고,
   - local 5-turn play에서 AP/HP/아이템/종료가 모두 맞고,
   - duplicate submit가 pricing 전에 차단되면,
   - 기존 semantic owner를 제거한다.
4. **No permanent dual operation**
   - 한 릴리스 안에서 shadow → canary → cutover.
   - 구/신 경로를 영구 병행하지 않는다.

---

## 9. 검증 계획

### 정확성

- 이동/AP: map command, AP 부족, locked route, departure
- 주사위: d20/stat/DC/tier, nat1/nat20
- 소지품: offer → accept → use/consume, no duplicate grant
- 인간/봇: same proposal path, bot lock matches server location
- 중복 실행/청구: duplicate submit rejected before exploration pricing; one charge per round
- 종료 후 재접속: `CAMPAIGN_COMPLETE` persists; no composer; no next question

### 재미

- NPC가 자기 목적에 따라 움직이는가
- 사용자 선택이 다음 상황/관계를 바꾸는가
- 탐험 → 전투/문제 해결이 자연스러운가
- 성공/실패가 다른 결과를 만드는가
- 마지막에 새로운 선택을 강요하지 않는가
- 반복/정체가 없는가

Cursor는 점수를 매기지 않는다. 실제 원문만 제출한다.

---

## 10. 로컬 검증 결과 (campaign 15)

- 시나리오: `등대의 마지막 불빛` (4 rooms, 1 NPC, 1 enemy encounter, 1 goal)
- 플레이: opening + 5 action rounds
- 결과: `CAMPAIGN_COMPLETE`, `storyPhase=FINISHED` — **완료 플래그 성공**
- **위치 일치 실패**: 마지막 서술은 부두를 떠났지만 final-state 시트/지도는 `등대 기계실`이었다. 완료 플래그와 최종 위치 일치는 별개다.
- 목표: 1 completed (basis host)
- HP: 40 → 36 (threat strike HIT, `LIGHT 1d4` total 2, amount 4)
- 소지품: `등대 기름` 소비, `놋쇠 열쇠` 유지, `낡은 손전등` 유지
- AP: 각 라운드 3, 이동/조사 비용 정상
- 중복 제출: 5회 모두 차단, GM 호출/과금 없음
  - R3–R5: “이미 제출했습니다.”
  - R1–R2: “이동력이 부족합니다.” (중복 확인이 pricing 뒤에 있는 문제)
- 새로고침: final snapshot `CAMPAIGN_COMPLETE` 유지 (플래그 기준)
- GM 호출: 6 (opening + 5), bot 0, retry 0
- 토큰: 59,838 input / 13,682 output
- 비용: $0.128248 (약 174.6원 @1361.2) — **기록된 GM 소계**, background memory 비용 제외
- 지연: 240,362 ms total, 평균 40.1s/call

> 정정: 이 실행의 “성공”은 완료 플래그 기준이다. 최종 위치/서술 일치는 실패했으며, R0 원본은 미보존 탐색 실행과 마찬가지로 성공 실행으로 대체하지 않는다. JEV binary 혼동행렬과 recall은 §0을 따른다.

### 재미 원문에서 확인된 것

- NPC agency: 우철은 딸을 기다리는 자기 목적을 가지고 등대 불을 막고, 플레이어가 장부를 존중하자 협조하며, 마지막에는 딸을 보내 준다.
- Choice impact: 장부를 살핀 선택이 난파선 경로와 열쇠/기름을 열었고, 등대 불을 밝힌 선택이 encounter를 끝내고 항구를 구했다.
- Exploration → problem: 오두막 단서 → 난파선 아이템 → 잠긴 등대 → 그림자 threat strike.
- Success/failure divergence: 조사 3회 성공(18/17/16) → 단서/아이템/경로; threat strike HIT(12 vs DC 12) → HP 40→36.
- Natural ending: 마지막 GM 문장은 “여정을 마무리했다.”로 끝나고 다음 행동 질문이 없다.
- 성장: XP/레벨업 owner가 없어 이번 플레이에 포함하지 않았다. 다음 연결 단계는 `level` 표시 필드가 아니라 별도 progression owner를 만드는 것이며, 이번 계약에는 넣지 않는다.
- 로컬 한계: 로컬 등록 캐릭터 `렌 id=9820011`은 description/greeting/system_prompt가 비어 있어 이름과 최소 로컬 전용 persona만 사용했다. 운영 캐릭터 데이터는 복사하지 않았다.
- 봇 한계: 이번 완주 플레이는 human + GM NPC로 진행해 유료 bot 호출은 0회다. 봇의 동일 실행 경로는 코드 map/설계로만 다뤘고 실제 봇 플레이로 검증하지 않았다.
- #45 재연 한계: #45 R13/R14 작별 원문은 감사와 JEV 20-case에 포함했지만, 별도 로컬 GM 캠페인으로 재연하지는 않았다. 로컬 완주 플레이는 같은 “작별로 닫는” 계약을 다른 시나리오에서 검증한 것이다.

---

## 11. 비용/지연 비교

| 항목 | 현재 로컬 (campaign 15) | 새 계약 목표 |
|---|---:|---:|
| GM calls (5-turn arc) | 6 | 5 (opening + 4 action + ending) |
| bot calls | 0 | 0 |
| input tokens | 59,838 | ~50k (semantic pass 1회, 중복 재해석 제거) |
| output tokens | 13,682 | ~13k |
| latency | 240s | ~200s |
| finish repair round | 1 (R4→R5) | 0 (ending decision at the right commit) |
| semantic owners | regex/lexicon 3 files + JEV 후보 | typed proposal 1 + server validator |

숫자는 **측정된 현재**와 **설계 목표**다. 새 구조가 구현되어 측정된 것이 아니다. 재구축의 근거는 비용 절감 하나가 아니라, 종료 재개/재해석/분류 오류를 없애는 구조적 효과다.

---

## 12. 이번 PR의 범위

> 이 절은 R0 원본 PR(#1793) 기준 범위다. R1 구현은 같은 브랜치의 별도 제품 PR에서 `actionContract.ts`, `endingDecision.ts`, `progression.ts`, 전투/성장 JSX를 추가했다.

- 포함:
  - 이 설계 문서
  - `OWNER-MAP.md`
  - JEV 20-case fixture + comparison script
  - local play fixture + harness
  - local play raw evidence (private repo)
- 제외:
  - 제품 runtime 코드 변경
  - 스키마 변경
  - 운영 DB 변경
  - 병합/배포
  - 기존 코드 대량 삭제
  - XP/레벨업/전투 JSX 구현

**STOP** — GPT가 실제 원문, JEV 비교, 교체/삭제 범위를 검수한 뒤 다음 단계를 결정한다.
