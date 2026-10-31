# TRPG R0 — current owner / reuse / replace map

기준: main `9d190989b9ab6c14c03e5a3fe1a833b7a2de6866` (2026-10-31)  
범위: 실제 writer/reader와 호출 경로. 파일을 삭제하지 않고, 새 계약에서의 처리만 표시한다.

상태 표기:
- **REUSE**: 그대로 사용
- **WRAP**: 유지하되 새 typed proposal 뒤에서 호출
- **REPLACE**: 의미 해석만 새 owner로 교체
- **CONSOLIDATE**: 중복 owner를 하나로 통합
- **PROTECT**: 무결성/과금/인증 때문에 유지
- **NOT FOUND**: 구현 없음

---

## 1. 주사위 / 능력치

| 책임 | writer | reader / 호출 경로 | 상태 |
|---|---|---|---|
| d20/DC/tier 계산 | `src/lib/trpg/dice.ts` `resolveTrpgRoll`, `rollServerD20` | `roundAdjudication.ts` `adjudicateCanonicalSubmission` → `trpg_dice_rolls` | REUSE |
| 능력치 보정 | `src/lib/trpg/stats.ts` `statModifier` | `roundAdjudication.ts`, `sheetSurface.ts` | REUSE |
| action type/stat 선택 | `src/lib/trpg/actionTypes.ts` `pickStatForActionDetailed` | `roundAdjudication.ts` | REUSE (입력 라벨만 새 proposal에서) |
| 액션 카드 d20 표시 | `src/lib/trpg/actionCardUi.ts`, `src/app/trpg/TrpgRollResultLane.tsx` | `TrpgCampaignRoom.tsx` | REUSE |

## 2. 지도 / AP / 이동

| 책임 | writer | reader / 호출 경로 | 상태 |
|---|---|---|---|
| map compile | `explorationMap.ts` `compileAdventureMap`, `adventureExplorationState` | `explorationStore.ensureExplorationMap` | REUSE |
| AP/move price | `explorationMap.ts` `priceExplorationCommands` | `explorationStore.prepareLockedExploration` → `submitTrpgAction` | REUSE |
| command legality | `explorationMap.ts` `legalExplorationCommands` | `submitTrpgAction` / bot move plan | REUSE |
| settlement | `explorationMap.ts` `settleExplorationActor` | `explorationStore.planExplorationCommit` → `engineAdvance` commit | REUSE |
| state persistence | `explorationStore.ts` `loadExplorationState` / `saveExplorationState` | `trpg_campaign_context.exploration_json` | REUSE |
| free-text movement inference | `explorationMap.ts` `explorationCommandsFromMovementBody` + `movementDeclaration.ts` | bot structured/fallback path only | REPLACED for human submit (`actionContract.ts` proposal → plan). Bot structured move plan remains the bot's explicit command channel. |
| public projection | `explorationPublic.ts`, `explorationStore.projectExplorationForViewer` | snapshot | REUSE |

로컬 검증: move 1 + search 1 = AP 2/3, locked route, item reward, hazard, encounter strike 모두 기존 owner로 동작했다.

## 3. 시트 / HP / 소지품

| 책임 | writer | reader / 호출 경로 | 상태 |
|---|---|---|---|
| sheet snapshot | `engineSheets.ts` `loadSheetSnapshots` | `engineAdvance`, `roundAdjudication`, GM prompt | REUSE |
| sheet persist | `engineSheets.ts` `persistSheets` | `engineAdvance` commit | REUSE |
| inventory model | `inventory.ts` add/remove/consume/stack | `engineSheets`, `sheetSurface` | REUSE |
| item offers/accept | `itemAcceptance.ts` `resolveTrpgItemAcceptance` / `grantAcceptedItems` / `stripUnacceptedItemProposals` | `submitTrpgAction`, `commitPendingGmResult` | REUSE / PROTECT |
| sheet display | `sheetSurface.ts` `buildTrpgSheetSurface`, `sheetJsxSource.ts` | `TrpgCampaignRoom.tsx`, `JsxComponentSandbox.tsx` | REUSE |
| HP damage | `mechanicsResolve.ts` `resolveRoundMechanics`, `encounterStrikes.ts` `resolveThreatStrikes` | `mechanicsRound.ts` → commit | REUSE / PROTECT |
| level/XP/growth | `progression.ts` `grantTrpgCampaignCompletionXp` / `spendTrpgStatPoint`, `trpg_character_sheets.xp/stat_points`, `trpg_campaigns.completion_xp_awarded` | completion finalize + `POST /api/trpg/campaigns/[id]/growth` | **IMPLEMENTED (R1, campaign-sheet only)** |
| combat JSX | `snapshot.ts` `TrpgPublicCombat`, `engineSnapshot.ts` projection, `sheetSurface.ts` / `sheetJsxSource.ts` combat block | sheet JSX | **IMPLEMENTED (R1 minimal)** |

중요: `sheetSurface.level`와 `sheetJsxSource`의 `Lv {level}`는 표시 필드다. 성장 로직이 아니다.

## 4. 인증 / 과금 / 중복 실행

| 책임 | writer | reader / 호출 경로 | 상태 |
|---|---|---|---|
| API auth | `requireApi.ts` `requireTrpgApi` | all `src/app/api/trpg/**` | PROTECT |
| idempotent action lock | `engineAdvance.ts` `upsertLockedAction` | `submitTrpgAction` | PROTECT, but move before exploration pricing |
| round billing | `engineAdvance.ts` billing helpers, `roundUsage.ts`, `billing*.ts` | `advanceTrpgCampaign` | PROTECT |
| lease/generation | `engineAdvance.ts` `beginGmGenerationLease`, `gm_generation_id` | GM generation/commit | PROTECT |
| duplicate grant | `itemAcceptance.ts`, `engineSheets.ts` | commit | PROTECT |

로컬 관찰: R3–R5 중복 제출은 “이미 제출했습니다.”로 차단됐다. R1–R2는 exploration command 재가격이 먼저 실행돼 “이동력이 부족합니다.”로 실패했다. **중복 확인이 pricing보다 먼저** 와야 한다.

## 5. GM 프롬프트 / 출력 / commit

| 책임 | writer | reader / 호출 경로 | 상태 |
|---|---|---|---|
| system prompt | `gmPrompt.ts` `TRPG_GM_SYSTEM` | `gmCall.callTrpgGm` | REUSE (종료 head는 통합) |
| user block | `gmPrompt.ts` `buildTrpgGmUserBlock` | `engineAdvance.runGmForRound` | REUSE |
| provider call | `gmCall.ts` `callTrpgGm` | `runGmForRound` | REUSE |
| structured parse | `gmStructuredOutput.ts` `parseTrpgGmStructuredJson` / `isTrpgGmStructuredShape` | `gmPrompt.parseTrpgGmOutput` | REUSE |
| GM commit | `engineAdvance.ts` `commitPendingGmResult` | `finalizeCommittedGmRound` | REUSE, but ending decision moves before reopen |
| finish prompt head | `gmPrompt.ts` `TRPG_GM_ENDING_FINISH_HEAD`, `formatTrpgGmRoundHead` | `buildTrpgGmUserBlock` | CONSOLIDATE with ending decision |
| location binding | `campaignLedger.ts` `bindGmLocationToSubmittedMovement` | commit | REUSE |
| mechanics merge | `mechanicsMerge.ts` `mergeMechanicsOwnedDelta` | commit | REUSE |

## 6. 목표 / 장면 / 종료

| 책임 | writer | reader / 호출 경로 | 상태 |
|---|---|---|---|
| goal lifecycle | `campaignGoals.ts` `reconcileGoals`, `applyGoalTransition`, `completeVerifiedGoals`, `answerGoalClaim` | `campaignLedger.applyCampaignLedger`, `goalConfirm.answerTrpgGoalClaim` | CONSOLIDATE |
| goal persistence | `campaignLedger.ts` `persistCampaignLedger`, `trpg_campaign_state.goals_json` | commit / goal confirm | REUSE |
| goal claim host answer | `goalConfirm.ts` `answerTrpgGoalClaim` + `endingDecision.ts` `finalizeHostConfirmedEnding` | `api/trpg/campaigns/[id]/goal-claim` | **IMPLEMENTED (R1 inline ending; no extra action)** |
| story phase | `campaignContext.ts` `applyCampaignStoryProgress` + `scenarioPlan.ts` `applyStoryPhaseTransition` | `runGmForRound` / commit | CONSOLIDATE |
| local scene | `localSceneProgress.ts` `applyLocalSceneProgressDelta`, `resolveRoutineTraversalSceneTransition` | `campaignContext.applyLocalSceneProgressToContext`, GM prompt | CONSOLIDATE |
| finish predicate | `engineAdvance.ts` `evaluateTrpgEndingDecision` / `endingDecision.ts` is the new owner; `resolveEffectiveCampaignFinished`, `campaignFinishWouldStand` remain as legacy fallback for rounds without a human plan | `runGmForRound` / `commitPendingGmResult` | **REPLACED for new rounds; legacy fallback preserved** |
| finish recovery | `engineAdvance.ts` `campaignFinishedForRecovery`, `readStoredGmFinish` | recovery | REUSE (reads new decision) |
| scenario ending conditions | `scenarioPlan.ts` `effectiveEndingConditionsForGm`, `endingConditions` | GM prompt | REUSE (server evaluates) |
| client complete flag | `engineSnapshot.ts` / snapshot | UI | ADD `campaignCompleteReason` / `endingDecision` projection |

중복/모순 top 5:

1. **종료**: `resolveEffectiveCampaignFinished` + `campaignFinishWouldStand` + `TRPG_GM_ENDING_FINISH_HEAD` + `campaignGoals` completion + `campaignContext` story phase + `localSceneProgress`가 각자 “끝”을 판단한다.
2. **목표**: `campaignGoals` lifecycle, `campaignLedger` reconciliation, `goalConfirm` host answer가 목표 상태를 나눠 쓴다.
3. **의미 해석**: `actionSemantics` clause classification, `movementDeclaration` lexical movement, `actionCheck` challenge/talk/flavor gating이 같은 문장을 서로 다르게 읽는다.
4. **장면 단계**: `scenarioPlan` story phase, `campaignContext` applied story progress, `localSceneProgress` local scene transition이 겹친다.
5. **인간/봇 실행**: `submitTrpgAction`(human)과 `generateBotActions`/`adjudicateSubmissionForParticipant`(bot)이 다른 lock/parse 경로를 갖고, bot structured move와 sheet location이 어긋날 수 있다.

## 7. JSX / 화면

| 책임 | writer | reader / 호출 경로 | 상태 |
|---|---|---|---|
| sandbox | `src/components/JsxComponentSandbox.tsx` | room UI | REUSE |
| host bridge | `src/lib/jsxComponent/hostBridge.ts` | sandbox | REUSE |
| sheet surface | `sheetSurface.ts` | sheet JSX | REUSE |
| sheet JSX source | `sheetJsxSource.ts` | `JsxComponentSandbox` | REUSE |
| d20 lane | `src/app/trpg/TrpgRollResultLane.tsx`, `actionCardUi.ts` | `TrpgCampaignRoom.tsx` | REUSE |
| combat panel | — | no dedicated combat JSX | **NOT FOUND** |
| ending UI | — | final narration only; composer remains keyed to draft | **PARTIAL** |

## 8. 보호 규칙 vs 자연어 보정

### 유지해야 하는 보호 규칙

- auth/billing/idempotency/lease: `requireTrpgApi`, `upsertLockedAction`, billing helpers, generation lease.
- item acceptance/ownership: `resolveTrpgItemAcceptance`, `grantAcceptedItems`, `stripUnacceptedItemProposals`.
- encounter authority: `governedEncounters`, `resolveThreatStrikes`, `acceptEncountersEnded`.
- sheet/HP ownership: `loadSheetSnapshots`, `persistSheets`, `mergeMechanicsOwnedDelta`.
- location authority: `bindGmLocationToSubmittedMovement`.

### 교체 대상 (자연어 보정 누적)

- `actionSemantics.ts`의 `CONDITIONAL_CONNECTIVE`, `NEGATED_PREDICATE`, `CHALLENGE`, `INVESTIGATION`, `HAZARD_ENGAGEMENT`, `ITEM_TAKE_PREDICATE` 등 regex/lexicon.
- `movementDeclaration.ts`의 `parseMovementDeclaration` lexical goal extraction.
- `actionCheck.ts`의 `isTalkOnlyAction`, `isHarmlessFlavorAction`, `hasChallengeSignal` 기반 semantic gating.
- `engineAdvance.ts`의 `canonicalRemainderLock`/`uncommittedActionWire`는 유지하되 typed proposal에서 파생.

## 9. 새 계약에서의 owner

| 새 책임 | owner (제안) | 기존 저장 |
|---|---|---|
| `ActionProposal` | 새 `src/lib/trpg/actionProposal.ts` (JEV/규칙 기반) | 저장하지 않음; 필요 시 기존 submission body |
| `ActionPlan` | 새 `src/lib/trpg/actionPlan.ts` (server-only) | `trpg_action_submissions`, `trpg_dice_rolls` |
| `EndingDecision` | 새 `src/lib/trpg/endingDecision.ts` (server-only) | `trpg_campaign_state`, `trpg_gm_messages.structured_json` |
| `TrpgGameView` | 새 projection (snapshot 확장) | 기존 snapshot + mechanics/exploration |
| goal/scene projection | `campaignGoals` + `campaignContext` + `localSceneProgress`를 projection으로 축소 | 기존 테이블 |

새 테이블/Journal/parallel state machine은 만들지 않는다.

---

## 10. 결론

- 재사용: dice/stats, map/AP, sheet/inventory, auth/billing/idempotency, JSX sandbox, GM boundary.
- 교체: 자연어 의미 해석(regex/lexicon)과 종료 boolean 의존.
- 통합: goal/scene/ending의 5개 중복 판정.
- 미구현: XP/레벨업/능력치 성장, 전투 전용 JSX.
- 이번 PR은 문서·fixture·local harness만 포함하고, 위 owner를 실제로 삭제/수정하지 않는다.
