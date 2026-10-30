import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { parseGenresJson } from "@/lib/characterGenres";
import { deductPointsOnDb, getPointBalanceOnDb } from "@/lib/points";
import { paidCreatorRewardSpend, resolveCreatorRewardRate } from "@/lib/creatorPoints";
import { creditTrpgRoundCreatorRewards, loadTrpgCharacterRoyaltyTargets } from "./creatorRewards";
import { trpgInsufficientBalanceMessage } from "./billingMode";
import {
  isTrpgValuePricingEnabled,
  quoteTrpgRoundEconomics,
  scaleCreatorShares,
  toBillingBreakdown,
} from "./economics";
import { logTrpgRoundEconomics, observeTrpgRoundEconomics } from "./roundEconomics";
import {
  loadBillableRoundUsage,
  loadBillableRerollUsage,
  loadRerollUsageEntries,
  loadRoundUsageEntries,
  tagBotRoundUsage,
  tagGmRoundUsage,
  toModelUsageCalls,
  type TrpgRoundUsageEntry,
} from "./roundUsage";
import { isTrpgActionType, pickStatForAction, resolveServerHumanActionType } from "./actionTypes";
import { TrpgAdventureCanonError } from "./adventure";
import { logTrpgMechanicsCheckTelemetry } from "./mechanicsObservability";
import {
  computeTrpgRoundPoints,
  splitTrpgRoundCost,
  TRPG_BOT_USAGE_FALLBACK,
  TRPG_GM_USAGE_FALLBACK,
  type TrpgModelUsage,
} from "./billing";
import {
  aiParticipantIdSet,
  buildAiPartyCharacterContextBlock,
  characterTagsByParticipant,
  loadTrpgAiCharacterContexts,
  readCharacterRowFields,
} from "./aiCharacterContext";
import {
  buildTrpgBotActionUserBlock,
  orderTrpgBotsForRound,
  parseTrpgBotAction,
  prepareTrpgBotActionBody,
  sanitizeBotActionText,
  TRPG_BOT_INTENT_OPEN,
  TRPG_BOT_SYSTEM,
} from "./botActions";
import { actionReferencesOpenRoute } from "./actionCheckContext";
import { gmAiActionText, isLockedSpokenLine, resolveTrpgCanonicalAttempt, stayWatchingInPlace } from "./canonicalAttempt";
import {
  acceptedSceneLocationFromBoundState,
  applyCampaignLedger,
  bindGmLocationToSubmittedMovement,
  clipTrpgChars,
  countQuestAddsOverCap,
  loadCampaignLedger,
  loadStoredGoalsJson,
  persistAcceptedRoundLocationIfAbsent,
  persistCampaignLedger,
  settleLedgerForCommit,
} from "./campaignLedger";
import {
  emitBotExplorationLockDiagnosticSafe,
  explorationRejectCode,
  type BotExplorationLockOutcome,
} from "./botExplorationLockDiagnostic";
import {
  canonicalRoomId,
  composeExplorationSentences,
  displayExplorationAp,
  explorationCommandsFromMovementBody,
  explorationOwnsWorldFlags,
  explorationRoomNames,
  filterExplorationFlagsAdd,
  filterExplorationFlagsRemove,
  legalExplorationCommands,
  legacyPartyEscapeFact,
  roomNameAfterCommands,
  splitV2ExplorationMethod,
  type ExplorationState,
} from "./explorationMap";
import type { ExplorationCommand } from "./explorationPublic";
import {
  declaredMovementGoals,
  describeMovementGoal,
  finishedResultClauses,
  omitClausesAwayFromHere,
  omitLiveMovementClauses,
  omitUnconfirmedAuthorityClauses,
} from "./movementDeclaration";
import {
  explorationBriefForBot,
  explorationPromptForRound,
  ensureExplorationMap,
  loadExplorationState,
  planExplorationCommit,
  prepareLockedExploration,
  readExplorationCommands,
  saveExplorationState,
  type ExplorationCommitAdjustment,
} from "./explorationStore";
import { goalClaimSource } from "./goalClaimProvenance";
import { resolveTrpgRoll, rollServerD20 } from "./dice";
import { assertCanStart } from "./engineCreate";
import { callTrpgBot, callTrpgGm, type TrpgGmStreamCallbacks } from "./gmCall";
import {
  buildAiCharacterImageTagCatalog,
  enforceGmSceneAssetMarkers,
  uniqueCharacterAssetTags,
} from "./gmSceneAssets";
import { formatTrpgPlayerPersonaBlock, parseHumanPersona } from "./hostPersona";
import { playableScenarioAssets, buildScenarioAssetTagPrompt } from "./scenarioAssets";
import {
  applyNpcSpeakerImageFallback,
  buildGmSceneAssetPrompt,
  collectUsedNpcKeys,
  npcsWithImages,
} from "./scenarioNpcAssets";
import { loadCampaignScenarioAssets, loadScenarioTemplate } from "./scenarioTemplates";
import {
  activeGoalTitles,
  goalsAwaitingHostConfirmation,
  summarizeGoalTransition,
  type TrpgGoal,
  type TrpgGoalRoundFacts,
} from "./campaignGoals";
import {
  applyCampaignStoryProgress,
  applyLocalSceneProgressToContext,
  loadCampaignContext,
  persistCampaignContext,
  resolvedCampaignPlan,
  serializeCampaignDirectorInstructions,
  serializeCampaignDirectorState,
  serializeDirectorDeltaContract,
} from "./campaignContext";
import {
  hasLocalSceneProgressDelta,
  resolveRoutineTraversalSceneTransition,
  serializeLocalSceneDeltaContract,
  serializeLocalSceneStateForGm,
} from "./localSceneProgress";
import { assertGmCompletionCanCommit, assessGmCompletionIntegrity, completionIntegrityStatusLabel } from "./gmCompletionIntegrity";
import {
  buildTrpgGmUserBlock,
  formatTrpgItemOfferBlock,
  formatTrpgRegenerateCommittedFacts,
  formatTrpgSheetCanon,
  parseTrpgGmOutput,
  settleFinishedSceneNarration,
  shouldRequestTrpgPlayerGoalRegistration,
  TRPG_GM_SYSTEM,
  type ParsedTrpgGmOutput,
} from "./gmPrompt";
import {
  ensureDeltaPlayer,
  formatAcceptedItemsAction,
  foldAcceptedInventoryGrants,
  grantAcceptedItems,
  loadCommittedItemOffersByParticipant,
  loadTrpgSeatItemOffers,
  parseStoredAcceptedItems,
  parseTrpgAcceptItemsRequest,
  resolveTrpgItemAcceptance,
  restoreCommittedHumanItemFacts,
  serializeAcceptedItems,
  stripUnacceptedItemProposals,
  type TrpgAcceptedItems,
} from "./itemAcceptance";
import { serializeTrpgScenarioPlanForGm } from "./scenarioPlan";
import { parseScenarioNpcs, type TrpgScenarioNpc } from "./scenarioTypes";
import { ensureCampaignDirectorContext } from "./sandboxDirector";
import { loadTrpgSnapshot } from "./engineSnapshot";
import {
  diagnoseAdvanceTrpgCampaign,
  getAdvanceDiagState,
  isTrpgSnapshotDiagnosticsEnabled,
  noteAdvanceDiag,
} from "./snapshotDiagnostics";
import { buildCampaignMemoryPrompt, buildCampaignMemoryQuery, buildTrpgBotMemoryBlock, buildTrpgBotRecentContinuity, loadCompletedMemoryRounds } from "./memory";
import {
  buildBotCompactContinuity,
  buildHorizonPromptSections,
  loadMemoryEvents,
  logTrpgMemoryUsage,
} from "./memoryHorizon";
import { sealDroppedTrpgRounds, type TrpgMemoryCall } from "./memorySeal";
import { botGenerationInFlight, refreshBotGenerationHeartbeat, releaseBotGeneration, tryClaimBotGeneration } from "./botGenerationLease";
import {
  beginGmGenerationLease,
  finalizeGmRoundForGeneration,
  finalizeRerollForGeneration,
  gmGenerationInFlight as gmLeaseInFlight,
  gmGenerationOwnsToken,
  GM_HEARTBEAT_REFRESH_INTERVAL_MS,
  isRerollGmGeneration,
  isRerollGenerationBilled,
  logStaleOwnerDiscard,
  markGmGenerationCommitted,
  refreshGmGenerationHeartbeat,
  resolveGmLeaseState,
  StaleGmGenerationOwnerError,
  tryClaimLegacyErrorRecoverySalvage,
  tryAbortUncommittedRerollLease,
  tryClaimStaleGmRecovery,
  tryPersistGmRoundFailure,
  tryRevertStaleRerollGeneration,
  tryTerminalizeStaleOrphan,
} from "./gmGenerationLease";
import {
  botRecoveryEligible,
  clearBotErrorFromErrorJson,
  resolveTrpgRoundWork,
  roundHasBotGenerateFailed,
  setBotErrorInErrorJson,
  tryClaimBotExplicitRetryGeneration,
  tryClaimBotRecoveryGeneration,
} from "./botGenerationRecovery";
import { allRequiredHumanActionsLocked } from "./roundLock";
import { anchorTrpgProcessTimer, ensureTrpgProcessStage } from "./processTimer";
import { tryAcquireGmLock, tryBeginGmGeneration, tryBeginNarrationReroll, type TrpgActorReady } from "./roundLock";
import { loadSheetSnapshots, persistSheets } from "./engineSheets";
import { inventoryUnits } from "./inventory";
import {
  applyMechanicsOnCommit,
  completeRoundMechanics,
  ensurePreActionMechanics,
  type MechanicsRoundDeps,
} from "./mechanicsRound";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import { regenerateOutputInvertsCommittedCanon, UnadoptedTrpgRegenerateError } from "./regenerateCanon";
import { acceptEncountersEnded, governedEncounters } from "./encounterStrikes";
import { evaluateThreatShadow, formatThreatShadowLog, threatShadowHasSignal } from "./threatShadow";
import { loadEndedEncounterIds, loadMechanicsResolution, markMechanicsApplied } from "./mechanicsStore";
import {
  applyPostGmOngoingSeeds,
  derivePostGmOngoingSeeds,
  logPostGmOngoingCandidates,
  logPostGmOngoingObservability,
  withoutHpHarmSeeds,
  type PostGmOngoingSeed,
} from "./postGmOngoing";
import {
  classifyTrpgBillingErrorCode,
  type TrpgBillingSubstage,
} from "./billingFailure";
import {
  clearPendingGmResult,
  hasPendingGmResult,
  hasPendingGmResultForGeneration,
  loadPendingGmResult,
  parsedFromPending,
  savePendingGmResult,
  savePendingGmResultForGeneration,
} from "./pendingGmResult";
import { attachTrpgCallFailureMeta, buildTrpgRoundErrorJson, type TrpgFailureStage } from "./startFailure";
import {
  computeResolutionOrder,
  formatResolutionOrderBlock,
  parseResolutionOrder,
  sortByResolutionOrder,
} from "./initiative";
import { statModifier } from "./stats";
import {
  loadCampaign,
  loadLatestRound,
  loadParticipants,
  loadScenario,
  parseBotPersona,
  parseJson,
  setRoundPhase,
  type TrpgCampaignRow,
  type TrpgParticipantRow,
  type TrpgRoundRow,
} from "./store";
import {
  adjudicateLockedHumanSubmissions,
  adjudicateSubmissionForParticipant,
  collectAcceptedRoutineTraversalRoutes,
  ensureRoundAdjudicationContext,
  finalizeRoundAdjudication,
  loadFrozenAdjudicationDecision,
} from "./roundAdjudication";
import { parseTrpgInputOrigin, type TrpgInputOrigin } from "./replySuggestions";
import { DEFAULT_TRPG_BILLING_MODE, TRPG_ACTION_MAX_CHARS, TRPG_BOT_SCENE_MAX_CHARS, TRPG_GM_MODEL, type TrpgActionSource, type TrpgBillingMode, type TrpgRoundPhase } from "./types";
import { isTrpgRoundPhase, isTrpgSuccessTier, TRPG_LEDGER_QUEST_MAX } from "./types";
import {
  clearGmNarrationDraft,
  clearGmNarrationDraftForGeneration,
  type GmProviderTimings,
} from "./gmNarrationDraft";
import { GmNarrationDraftCoalescer } from "./gmNarrationDraftCoalescer";
import type { TrpgCampaignSnapshot } from "./snapshot";
import type { MechanicsResolution } from "./mechanicsTypes";

export type TrpgEngineDeps = {
  gmCall?: (opts: {
    system: string;
    user: string;
    stream?: TrpgGmStreamCallbacks;
  }) => Promise<{
    text: string;
    usage?: TrpgModelUsage;
    providerTimings?: GmProviderTimings;
    finishReason?: string | null;
    semanticDone?: boolean;
  }>;
  botCall?: (system: string, user: string) => Promise<{ text: string; usage?: TrpgModelUsage }>;
  memoryCall?: TrpgMemoryCall;
  rollD20?: () => number;
  skipBilling?: boolean;
  /** Test-only. Throws after entering this billing substage. */
  billingFault?: TrpgBillingSubstage | "after_first_deduction";
} & MechanicsRoundDeps;

function newRequestId(): string {
  return randomBytes(12).toString("hex");
}

function asPhase(value: string): TrpgRoundPhase {
  return isTrpgRoundPhase(value) ? value : "ERROR_RECOVERY";
}

function persistGmRoundFailure(
  db: Database.Database,
  roundId: number,
  error: unknown,
  requestId?: string
): void {
  const failure = buildTrpgRoundErrorJson({
    error,
    reachedOpeningRound: true,
    gmUsageCount: loadRoundUsageEntries(db, roundId).length,
    model: TRPG_GM_MODEL,
  });
  const errorJson = JSON.stringify(failure);
  if (requestId) {
    if (!tryPersistGmRoundFailure(db, roundId, requestId, errorJson)) {
      logStaleOwnerDiscard(roundId, requestId, "failure");
    }
    return;
  }
  db.prepare(
    `UPDATE trpg_rounds
     SET phase='ERROR_RECOVERY',
         error_json=?,
         gm_generation_id=NULL,
         lock_holder_request_id=NULL,
         gm_generation_started_at=NULL,
         gm_generation_heartbeat_at=NULL,
         updated_at=datetime('now')
     WHERE id=?`
  ).run(errorJson, roundId);
}

function mustSnapshot(db: Database.Database, campaignId: number, userId: number): TrpgCampaignSnapshot {
  const snap = loadTrpgSnapshot(db, campaignId, userId);
  if (!snap) throw new Error("캠페인을 찾을 수 없습니다.");
  return snap;
}

/** An explicit adventure that cannot be played stops the start before any round, GM call, or charge. */
function rethrowAdventureCanonError(error: unknown, campaignId: number): void {
  if (!(error instanceof TrpgAdventureCanonError)) return;
  console.warn("[trpg-adventure] invalid canon; start blocked", { campaignId, issues: error.issues });
  throw error;
}

export async function startTrpgCampaign(
  db: Database.Database,
  opts: { campaignId: number; userId: number; deps?: TrpgEngineDeps }
): Promise<TrpgCampaignSnapshot> {
  assertCanStart(db, opts.campaignId, opts.userId);
  try {
    await ensureCampaignDirectorContext(db, opts.campaignId);
  } catch (error) {
    rethrowAdventureCanonError(error, opts.campaignId);
    console.warn("[trpg-director] context failed; continuing with existing GM", error);
  }
  try {
    ensureExplorationMap(db, opts.campaignId);
  } catch (error) {
    rethrowAdventureCanonError(error, opts.campaignId);
    console.warn("[trpg-exploration] map failed; continuing without a map", error);
  }
  const latest = loadLatestRound(db, opts.campaignId);
  const rid = newRequestId();
  let roundId: number;
  if (latest?.phase === "ERROR_RECOVERY" && latest.round_number === 0) {
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='ROLLING', lock_holder_request_id=?, gm_generation_id=?, error_json=NULL,
           gm_generation_started_at=NULL, gm_generation_heartbeat_at=NULL,
           gm_committed_generation_id=NULL, updated_at=datetime('now')
       WHERE id=?`
    ).run(rid, rid, latest.id);
    roundId = latest.id;
  } else {
    roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, lock_holder_request_id, gm_generation_id)
           VALUES (?, 0, 'ROLLING', ?, ?)`
        )
        .run(opts.campaignId, rid, rid).lastInsertRowid
    );
  }

  try {
    beginGmGenerationLease(db, roundId, rid);
    const gm = await runGmForRound(db, {
      campaignId: opts.campaignId,
      roundId,
      opening: true,
      requestId: rid,
      deps: { ...opts.deps, skipBilling: true },
    });
    const campaign = loadCampaign(db, opts.campaignId)!;
    await finalizeCommittedGmRound(
      db,
      campaign,
      {
        roundId,
        roundNumber: 0,
        leaseOwnerId: rid,
        committedGenerationId: rid,
        campaignFinished: gm.campaignFinished,
      },
      opts.deps
    );
  } catch (e) {
    if (!(e instanceof StaleGmGenerationOwnerError)) {
      persistGmRoundFailure(db, roundId, e, rid);
    }
    throw e;
  }
  return mustSnapshot(db, opts.campaignId, opts.userId);
}

export async function regenerateTrpgNarration(
  db: Database.Database,
  opts: { campaignId: number; userId: number; roundNumber?: number; deps?: TrpgEngineDeps }
): Promise<TrpgCampaignSnapshot> {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.host_user_id !== opts.userId) {
    throw new Error("방장만 장면을 리롤할 수 있습니다.");
  }
  if (campaign.status === "CAMPAIGN_COMPLETE") {
    throw new Error("끝난 캠페인은 리롤할 수 없습니다.");
  }
  const target = db
    .prepare(
      `SELECT r.id, r.round_number, r.phase
       FROM trpg_rounds r
       JOIN trpg_gm_messages g ON g.round_id = r.id
       WHERE r.campaign_id=? AND (? IS NULL OR r.round_number=?)
       ORDER BY r.round_number DESC
       LIMIT 1`
    )
    .get(opts.campaignId, opts.roundNumber ?? null, opts.roundNumber ?? null) as
    | { id: number; round_number: number; phase: string }
    | undefined;
  if (!target) throw new Error("리롤할 장면이 없습니다.");
  const laterLocked = db
    .prepare(
      `SELECT 1
       FROM trpg_action_submissions s
       JOIN trpg_rounds r ON r.id = s.round_id
       WHERE r.campaign_id=? AND r.round_number > ? AND s.locked=1
       LIMIT 1`
    )
    .get(opts.campaignId, target.round_number) as { 1: number } | undefined;
  if (laterLocked) {
    throw new Error("다음 행동이 이미 제출되어 장면을 리롤할 수 없습니다.");
  }
  const priorReroll = db
    .prepare(`SELECT gm_reroll_billed_generation_id FROM trpg_rounds WHERE id=?`)
    .get(target.id) as { gm_reroll_billed_generation_id: string | null } | undefined;
  if (priorReroll?.gm_reroll_billed_generation_id) {
    db.prepare(`UPDATE trpg_rounds SET gm_reroll_usage_json=NULL WHERE id=?`).run(target.id);
  }
  const rid = newRequestId();
  if (!tryBeginNarrationReroll(db, target.id, rid)) {
    throw new Error("이미 장면을 다시 쓰고 있습니다.");
  }
  ensureTrpgProcessStage(db, target.id, "reroll");
  beginGmGenerationLease(db, target.id, rid, { preserveCommittedGenerationId: true });
  try {
    await runGmForRound(db, {
      campaignId: campaign.id,
      roundId: target.id,
      opening: target.round_number === 0,
      regenerate: true,
      requestId: rid,
      deps: opts.deps,
    });
    if (
      !billRerollGenerationExactlyOnce(db, campaign, target.id, rid, rid, opts.deps)
    ) {
      logStaleOwnerDiscard(target.id, rid, "billing");
      throw new StaleGmGenerationOwnerError();
    }
    if (!finalizeRerollForGeneration(db, target.id, rid, rid)) {
      logStaleOwnerDiscard(target.id, rid, "finalize");
      throw new StaleGmGenerationOwnerError();
    }
  } catch (e) {
    if (e instanceof StaleGmGenerationOwnerError) {
      throw e;
    }
    const failure = JSON.stringify(
      buildTrpgRoundErrorJson({
        error: e,
        reachedOpeningRound: true,
        gmUsageCount: loadRoundUsageEntries(db, target.id).length,
        model: TRPG_GM_MODEL,
      })
    );
    const info = db
      .prepare(
        `UPDATE trpg_rounds
         SET phase='ROUND_COMPLETE', lock_holder_request_id=NULL, gm_generation_id=NULL,
             gm_generation_started_at=NULL, gm_generation_heartbeat_at=NULL,
             error_json=?, updated_at=datetime('now')
         WHERE id=? AND gm_generation_id=?`
      )
      .run(failure, target.id, rid);
    if (info.changes === 0) {
      logStaleOwnerDiscard(target.id, rid, "failure");
    }
    throw e;
  }
  return mustSnapshot(db, opts.campaignId, opts.userId);
}

export function submitTrpgAction(
  db: Database.Database,
  opts: {
    campaignId: number;
    userId: number;
    body: string;
    actionType?: string | null;
    selectedStat?: string | null;
    idempotencyKey?: string | null;
    inputOrigin?: TrpgInputOrigin | null;
    explorationCommands?: unknown;
    acceptItems?: unknown;
  }
): void {
  const parts = loadParticipants(db, opts.campaignId);
  const me = parts.find((p) => p.user_id === opts.userId);
  if (!me) throw new Error("이 캠페인의 참가자가 아닙니다.");
  if (me.can_act !== 1 || me.status !== "active") throw new Error("지금은 행동할 수 없습니다.");
  const round = loadLatestRound(db, opts.campaignId);
  if (!round || round.phase !== "ACTION_INPUT") {
    throw new Error("지금은 행동을 제출할 수 없습니다.");
  }
  const commands = readExplorationCommands(opts.explorationCommands);
  const accepted = resolveTrpgItemAcceptance(
    loadTrpgSeatItemOffers(db, opts.campaignId, round.round_number, me.id),
    parseTrpgAcceptItemsRequest(opts.acceptItems)
  );
  const typed = opts.body.replace(/\s+/g, " ").trim();
  if (!typed && commands.length === 0 && !accepted) throw new Error("행동을 입력하세요.");
  const text = typed || (accepted && commands.length === 0 ? formatAcceptedItemsAction(accepted.items) : "");
  assertTrpgActionMaxChars(text);
  const actionType = resolveServerHumanActionType(text);
  const origin = parseTrpgInputOrigin(opts.inputOrigin);
  const mapped = loadExplorationState(db, opts.campaignId);
  // Absent explorationCommands is a general submit. v2 does not turn that into an
  // exploration submit when the body also carries a non-move action.
  const explicitExploration = commands.length > 0;
  const inferredMoves =
    !explicitExploration && mapped ? explorationCommandsFromMovementBody(mapped.map, text) : [];
  if (mapped?.version === 2 && inferredMoves.length > 0 && omitLiveMovementClauses(text)) {
    throw new Error(
      "탐험 대기열이 비어 있어 이 제출은 일반 행동입니다. 이동과 다른 행동을 한 번에 보내지 않습니다. 이동은 탐험 대기열에 넣고, 구매는 대기열을 비운 뒤 따로 보내세요. 입력은 그대로 두었습니다."
    );
  }
  const pricedCommands = explicitExploration ? commands : inferredMoves;
  if (pricedCommands.length > 0) {
    db.transaction(() => {
      const prepared = prepareLockedExploration(db, {
        campaignId: opts.campaignId,
        roundId: round.id,
        participantId: me.id,
        commands: pricedCommands,
        freeText: text,
      });
      assertTrpgActionMaxChars(prepared.body);
      upsertLockedAction(
        db,
        round.id,
        me.id,
        prepared.body,
        prepared.actionType,
        null,
        "human",
        opts.idempotencyKey,
        origin,
        accepted
      );
      saveExplorationState(db, opts.campaignId, prepared.state);
    })();
  } else {
    upsertLockedAction(
      db,
      round.id,
      me.id,
      text,
      actionType,
      null,
      "human",
      opts.idempotencyKey,
      origin,
      accepted
    );
  }
  const humanActors = actorsForRound(db, parts, round.id).filter((a) => a.kind === "human");
  if (allRequiredHumanActionsLocked(humanActors)) {
    anchorTrpgProcessTimer(db, round.id);
  }
}

function upsertLockedAction(
  db: Database.Database,
  roundId: number,
  participantId: number,
  body: string,
  actionType: string,
  selectedStat: string | null,
  source: TrpgActionSource,
  idempotencyKey?: string | null,
  inputOrigin: TrpgInputOrigin = "manual",
  accepted: TrpgAcceptedItems | null = null
): void {
  const existing = db
    .prepare(`SELECT id, locked FROM trpg_action_submissions WHERE round_id=? AND participant_id=?`)
    .get(roundId, participantId) as { id: number; locked: number } | undefined;
  if (existing?.locked === 1) {
    if (source === "human") throw new Error("이미 제출했습니다.");
    return;
  }
  const origin = source === "human" ? inputOrigin : "manual";
  const acceptedJson = source === "human" ? serializeAcceptedItems(accepted) : null;
  if (existing) {
    db.prepare(
      `UPDATE trpg_action_submissions
       SET body=?, action_type=?, selected_stat=?, locked=1, source=?, idempotency_key=?, input_origin=?, accepted_items_json=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(body, actionType, selectedStat, source, idempotencyKey ?? null, origin, acceptedJson, existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO trpg_action_submissions
      (round_id, participant_id, body, action_type, selected_stat, locked, source, idempotency_key, input_origin, accepted_items_json)
     VALUES (?,?,?,?,?,1,?,?,?,?)`
  ).run(roundId, participantId, body, actionType, selectedStat, source, idempotencyKey ?? null, origin, acceptedJson);
}

export type AdvanceTrpgCampaignOpts = {
  campaignId: number;
  userId: number;
  deps?: TrpgEngineDeps;
  /** Diagnostic-only caller label; ignored when TRPG_SNAPSHOT_DIAGNOSTICS !== "1". */
  source?: string;
};

async function finalizeCommittedGmRound(
  db: Database.Database,
  campaign: TrpgCampaignRow,
  opts: {
    roundId: number;
    roundNumber: number;
    leaseOwnerId: string;
    committedGenerationId: string;
    campaignFinished: boolean;
  },
  deps?: TrpgEngineDeps
): Promise<void> {
  if (
    !finalizeGmRoundForGeneration(db, {
      campaignId: campaign.id,
      roundId: opts.roundId,
      roundNumber: opts.roundNumber,
      leaseOwnerId: opts.leaseOwnerId,
      committedGenerationId: opts.committedGenerationId,
      campaignFinished: opts.campaignFinished,
    })
  ) {
    logStaleOwnerDiscard(opts.roundId, opts.leaseOwnerId, "finalize");
    throw new StaleGmGenerationOwnerError();
  }
  await sealDroppedTrpgRounds(db, campaign.id, deps?.memoryCall);
}

type ReconcileGmResult = {
  round: TrpgRoundRow;
  reclaimed: boolean;
};

async function reconcileStaleGmGenerationIfNeeded(
  db: Database.Database,
  opts: AdvanceTrpgCampaignOpts,
  campaign: TrpgCampaignRow,
  round: TrpgRoundRow
): Promise<ReconcileGmResult> {
  const resolution = resolveGmLeaseState(db, round.id, round.phase, round.gm_generation_id);
  switch (resolution.status) {
    case "inactive":
    case "healthy":
      return { round, reclaimed: false };
    case "stale_pending": {
      const { leaseOwnerId, provenanceGenerationId } = resolution;
      const recoveryId = newRequestId();
      if (
        !tryClaimStaleGmRecovery(
          db,
          round.id,
          leaseOwnerId,
          provenanceGenerationId,
          recoveryId,
          "pending"
        )
      ) {
        return { round, reclaimed: false };
      }
      try {
        const gm = applyPendingGmResult(db, {
          campaignId: campaign.id,
          roundId: round.id,
          leaseOwnerId: recoveryId,
          provenanceGenerationId,
          deps: opts.deps,
        });
        await finalizeCommittedGmRound(
          db,
          campaign,
          {
            roundId: round.id,
            roundNumber: round.round_number,
            leaseOwnerId: recoveryId,
            committedGenerationId: provenanceGenerationId,
            campaignFinished: gm.campaignFinished,
          },
          opts.deps
        );
      } catch (e) {
        if (!(e instanceof StaleGmGenerationOwnerError)) {
          persistGmRoundFailure(db, round.id, e, recoveryId);
        }
      }
      return { round: loadLatestRound(db, opts.campaignId) ?? round, reclaimed: true };
    }
    case "stale_committed": {
      const { leaseOwnerId, provenanceGenerationId } = resolution;
      const recoveryId = newRequestId();
      try {
        if (isRerollGmGeneration(db, round.id)) {
          // A preserved prior scene has a committed id that this lease did not
          // produce, so it has no reroll usage to bill. A committed reroll whose
          // lease moved to recovery still has usage under the committed id.
          const preservedPriorScene =
            provenanceGenerationId !== leaseOwnerId &&
            !isRerollGenerationBilled(db, round.id, provenanceGenerationId) &&
            loadBillableRerollUsage(db, round.id, provenanceGenerationId).length === 0;
          if (preservedPriorScene) {
            tryAbortUncommittedRerollLease(db, round.id, leaseOwnerId);
            return { round: loadLatestRound(db, opts.campaignId) ?? round, reclaimed: true };
          }
          if (
            !tryClaimStaleGmRecovery(
              db,
              round.id,
              leaseOwnerId,
              provenanceGenerationId,
              recoveryId,
              "committed"
            )
          ) {
            return { round, reclaimed: false };
          }
          if (!isRerollGenerationBilled(db, round.id, provenanceGenerationId)) {
            if (
              !billRerollGenerationExactlyOnce(
                db,
                campaign,
                round.id,
                recoveryId,
                provenanceGenerationId,
                opts.deps
              )
            ) {
              throw new StaleGmGenerationOwnerError();
            }
          }
          if (!finalizeRerollForGeneration(db, round.id, recoveryId, provenanceGenerationId)) {
            throw new StaleGmGenerationOwnerError();
          }
        } else {
          const kind = round.phase === "APPLYING_STATE" ? "applying_state" : "committed";
          if (
            !tryClaimStaleGmRecovery(
              db,
              round.id,
              leaseOwnerId,
              provenanceGenerationId,
              recoveryId,
              kind
            )
          ) {
            return { round, reclaimed: false };
          }
          const row = db
            .prepare(`SELECT structured_json FROM trpg_gm_messages WHERE round_id=?`)
            .get(round.id) as { structured_json: string | null } | undefined;
          const campaignFinished = campaignFinishedForRecovery(db, campaign.id, row?.structured_json);
          await finalizeCommittedGmRound(
            db,
            campaign,
            {
              roundId: round.id,
              roundNumber: round.round_number,
              leaseOwnerId: recoveryId,
              committedGenerationId: provenanceGenerationId,
              campaignFinished,
            },
            opts.deps
          );
        }
      } catch (e) {
        if (!(e instanceof StaleGmGenerationOwnerError)) {
          persistGmRoundFailure(db, round.id, e, recoveryId);
        }
      }
      return { round: loadLatestRound(db, opts.campaignId) ?? round, reclaimed: true };
    }
    case "stale_reroll_orphan": {
      if (!round.gm_generation_id) return { round, reclaimed: false };
      tryRevertStaleRerollGeneration(db, round.id, round.gm_generation_id);
      return { round: loadLatestRound(db, opts.campaignId) ?? round, reclaimed: true };
    }
    case "stale_orphan": {
      tryTerminalizeStaleOrphan(db, round.id);
      return { round: loadLatestRound(db, opts.campaignId) ?? round, reclaimed: true };
    }
  }
}

async function advanceTrpgCampaignCore(
  db: Database.Database,
  opts: AdvanceTrpgCampaignOpts
): Promise<TrpgCampaignSnapshot> {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  const parts = loadParticipants(db, opts.campaignId);
  if (!parts.some((p) => p.user_id === opts.userId) && campaign.host_user_id !== opts.userId) {
    throw new Error("이 캠페인의 참가자가 아닙니다.");
  }
  const round = loadLatestRound(db, opts.campaignId);
  if (!round) {
    noteAdvanceDiag({ phaseBefore: "NONE", workTypeBefore: "idle" });
    return mustSnapshot(db, opts.campaignId, opts.userId);
  }
  const { round: reconciledRound, reclaimed } = await reconcileStaleGmGenerationIfNeeded(
    db,
    opts,
    campaign,
    round
  );
  if (reclaimed) {
    return mustSnapshot(db, opts.campaignId, opts.userId);
  }
  const phase = asPhase(reconciledRound.phase);
  const advanceDiag = getAdvanceDiagState();
  if (advanceDiag) {
    advanceDiag.phaseBefore = phase;
    advanceDiag.gmGenerationInFlight = gmLeaseInFlight(db, reconciledRound);
    advanceDiag.botGenerationInFlight = botGenerationInFlight(db, reconciledRound);
  }

  if (phase === "ERROR_RECOVERY" && campaign.host_user_id === opts.userId && reconciledRound.round_number > 0) {
    if (hasPendingGmResult(db, reconciledRound.id)) {
      const pending = loadPendingGmResult(db, reconciledRound.id);
      let leaseOwnerId = reconciledRound.gm_generation_id;
      if (!leaseOwnerId) {
        const recoveryId = newRequestId();
        if (!tryClaimLegacyErrorRecoverySalvage(db, reconciledRound.id, recoveryId)) {
          return mustSnapshot(db, opts.campaignId, opts.userId);
        }
        leaseOwnerId = recoveryId;
      }
      const provenanceId = pending?.generationId ?? leaseOwnerId;
      try {
        const gm = applyPendingGmResult(db, {
          campaignId: campaign.id,
          roundId: reconciledRound.id,
          leaseOwnerId,
          provenanceGenerationId: provenanceId,
          deps: opts.deps,
        });
        await finalizeCommittedGmRound(
          db,
          campaign,
          {
            roundId: reconciledRound.id,
            roundNumber: reconciledRound.round_number,
            leaseOwnerId,
            committedGenerationId: provenanceId,
            campaignFinished: gm.campaignFinished,
          },
          opts.deps
        );
      } catch (e) {
        if (!(e instanceof StaleGmGenerationOwnerError)) {
          persistGmRoundFailure(db, reconciledRound.id, e, leaseOwnerId ?? undefined);
        }
      }
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    const rid = newRequestId();
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='ROLLING', lock_holder_request_id=?, gm_generation_id=NULL, error_json=NULL,
           gm_generation_started_at=NULL, gm_generation_heartbeat_at=NULL,
           gm_committed_generation_id=NULL, updated_at=datetime('now')
       WHERE id=?`
    ).run(rid, reconciledRound.id);
    if (!tryBeginGmGeneration(db, reconciledRound.id, rid)) {
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    beginGmGenerationLease(db, reconciledRound.id, rid);
    try {
      const gm = await runGmForRound(db, {
        campaignId: campaign.id,
        roundId: reconciledRound.id,
        opening: false,
        requestId: rid,
        deps: opts.deps,
      });
      await finalizeCommittedGmRound(
        db,
        campaign,
        {
          roundId: reconciledRound.id,
          roundNumber: reconciledRound.round_number,
          leaseOwnerId: rid,
          committedGenerationId: rid,
          campaignFinished: gm.campaignFinished,
        },
        opts.deps
      );
    } catch (e) {
      if (!(e instanceof StaleGmGenerationOwnerError)) {
        persistGmRoundFailure(db, reconciledRound.id, e, rid);
      }
    }
    return mustSnapshot(db, opts.campaignId, opts.userId);
  }

  const actors = actorsForRound(db, parts, reconciledRound.id);
  const humanActors = actors.filter((a) => a.kind === "human");
  const botActors = actors.filter((a) => a.kind === "ai_character");
  const work = resolveTrpgRoundWork({
    phase,
    humans: humanActors,
    bots: botActors,
    errorJson: reconciledRound.error_json,
    recoveryAttempts: reconciledRound.bot_generation_recovery_attempts,
  });
  noteAdvanceDiag({ workTypeBefore: work.type });

  if (work.type === "generate_bots") {
    ensureTrpgProcessStage(db, reconciledRound.id, "bots");
    const rid = newRequestId();
    const recoveryAttempt =
      roundHasBotGenerateFailed(reconciledRound.error_json) &&
      botRecoveryEligible(
        reconciledRound.bot_generation_recovery_attempts,
        roundHasBotGenerateFailed(reconciledRound.error_json)
      );
    const claim = recoveryAttempt
      ? tryClaimBotRecoveryGeneration(db, reconciledRound.id, rid)
      : tryClaimBotGeneration(db, reconciledRound.id, rid);
    if (!claim.claimed) {
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    if (!recoveryAttempt) {
      /* stage + started_at already anchored above for human-submit processing */
    }
    try {
      const adjudicationCtx = ensureRoundAdjudicationContext(db, {
        campaignId: campaign.id,
        roundId: reconciledRound.id,
        roundNumber: reconciledRound.round_number,
        deps: opts.deps,
      });
      adjudicateLockedHumanSubmissions(db, {
        campaignId: campaign.id,
        roundId: reconciledRound.id,
        pre: adjudicationCtx.pre,
        deps: opts.deps,
      });
      await generateBotActions(db, {
        campaign,
        roundId: reconciledRound.id,
        botIds: work.botIds,
        deps: opts.deps,
        requestId: rid,
        adjudicationPre: adjudicationCtx.pre,
      });
      releaseBotGeneration(db, reconciledRound.id, rid);
      db.prepare(`UPDATE trpg_rounds SET error_json=? WHERE id=?`).run(
        clearBotErrorFromErrorJson(reconciledRound.error_json),
        reconciledRound.id
      );
    } catch (e) {
      releaseBotGeneration(db, reconciledRound.id, rid);
      db.prepare(`UPDATE trpg_rounds SET error_json=? WHERE id=?`).run(
        setBotErrorInErrorJson(reconciledRound.error_json, (e as Error).message),
        reconciledRound.id
      );
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    return advanceTrpgCampaignCore(db, opts);
  }

  if (work.type === "acquire_gm_lock") {
    const rid = newRequestId();
    if (!tryAcquireGmLock(db, reconciledRound.id, rid)) {
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    ensureTrpgProcessStage(db, reconciledRound.id, "rolls");
    finalizeRoundAdjudication(db, campaign.id, reconciledRound.id, opts.deps);
    if (!tryBeginGmGeneration(db, reconciledRound.id, rid)) {
      return mustSnapshot(db, opts.campaignId, opts.userId);
    }
    beginGmGenerationLease(db, reconciledRound.id, rid);
    ensureTrpgProcessStage(db, reconciledRound.id, "gm");
    try {
      const gm = await runGmForRound(db, {
        campaignId: campaign.id,
        roundId: reconciledRound.id,
        opening: false,
        requestId: rid,
        deps: opts.deps,
      });
      await finalizeCommittedGmRound(
        db,
        campaign,
        {
          roundId: reconciledRound.id,
          roundNumber: reconciledRound.round_number,
          leaseOwnerId: rid,
          committedGenerationId: rid,
          campaignFinished: gm.campaignFinished,
        },
        opts.deps
      );
    } catch (e) {
      if (!(e instanceof StaleGmGenerationOwnerError)) {
        persistGmRoundFailure(db, reconciledRound.id, e, rid);
      }
    }
  }

  return mustSnapshot(db, opts.campaignId, opts.userId);
}

export async function advanceTrpgCampaign(
  db: Database.Database,
  opts: AdvanceTrpgCampaignOpts
): Promise<TrpgCampaignSnapshot> {
  if (!isTrpgSnapshotDiagnosticsEnabled()) {
    return advanceTrpgCampaignCore(db, opts);
  }
  return diagnoseAdvanceTrpgCampaign(
    { campaignId: opts.campaignId, source: opts.source },
    () => advanceTrpgCampaignCore(db, opts)
  );
}

/** Host explicit retry for pending AI companions after automatic recovery is exhausted. */
export async function retryTrpgBots(
  db: Database.Database,
  opts: { campaignId: number; userId: number; deps?: TrpgEngineDeps }
): Promise<TrpgCampaignSnapshot> {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.host_user_id !== opts.userId) {
    throw new Error("방장만 동료 행동을 다시 생성할 수 있습니다.");
  }
  const round = loadLatestRound(db, opts.campaignId);
  if (!round) throw new Error("진행 중인 라운드가 없습니다.");
  if (botGenerationInFlight(db, round)) {
    return mustSnapshot(db, opts.campaignId, opts.userId);
  }
  const parts = loadParticipants(db, opts.campaignId);
  const actors = actorsForRound(db, parts, round.id);
  const work = resolveTrpgRoundWork({
    phase: round.phase as TrpgRoundPhase,
    humans: actors.filter((a) => a.kind === "human"),
    bots: actors.filter((a) => a.kind === "ai_character"),
    errorJson: round.error_json,
    recoveryAttempts: round.bot_generation_recovery_attempts,
  });
  if (work.type !== "bot_retry_required") {
    throw new Error("지금은 동료 행동을 다시 생성할 수 없습니다.");
  }
  const rid = newRequestId();
  const claim = tryClaimBotExplicitRetryGeneration(db, round.id, rid);
  if (!claim.claimed) {
    return mustSnapshot(db, opts.campaignId, opts.userId);
  }
    try {
      const adjudicationCtx = ensureRoundAdjudicationContext(db, {
        campaignId: campaign.id,
        roundId: round.id,
        roundNumber: round.round_number,
        deps: opts.deps,
      });
      adjudicateLockedHumanSubmissions(db, {
        campaignId: campaign.id,
        roundId: round.id,
        pre: adjudicationCtx.pre,
        deps: opts.deps,
      });
      await generateBotActions(db, {
        campaign,
        roundId: round.id,
        botIds: work.botIds,
        deps: opts.deps,
        requestId: rid,
        adjudicationPre: adjudicationCtx.pre,
      });
    releaseBotGeneration(db, round.id, rid);
    db.prepare(`UPDATE trpg_rounds SET error_json=? WHERE id=?`).run(
      clearBotErrorFromErrorJson(round.error_json),
      round.id
    );
  } catch (e) {
    releaseBotGeneration(db, round.id, rid);
    db.prepare(`UPDATE trpg_rounds SET error_json=? WHERE id=?`).run(
      setBotErrorInErrorJson(round.error_json, (e as Error).message),
      round.id
    );
    return mustSnapshot(db, opts.campaignId, opts.userId);
  }
  return advanceTrpgCampaign(db, { ...opts, source: "retry_bots" });
}

function actorsForRound(
  db: Database.Database,
  parts: TrpgParticipantRow[],
  roundId: number
): TrpgActorReady[] {
  const submitted = new Set(
    (
      db
        .prepare(`SELECT participant_id FROM trpg_action_submissions WHERE round_id=? AND locked=1`)
        .all(roundId) as { participant_id: number }[]
    ).map((r) => r.participant_id)
  );
  return parts.map((p) => ({
    id: p.id,
    kind: p.kind === "ai_character" ? "ai_character" : "human",
    canAct: p.can_act === 1 && p.status === "active",
    submitted: submitted.has(p.id),
  }));
}

function assertTrpgActionMaxChars(text: string): void {
  if (Array.from(text).length > TRPG_ACTION_MAX_CHARS) throw new Error("행동이 너무 깁니다.");
}

function normalizedRemainder(text: string): string {
  return text.replace(/[\s“”"'`.!?。…,;]/g, "");
}

/**
 * Movement-free local prose and a standalone quote, after a rejected move is removed.
 * A quote stays whole only when every clause in it is still local. Markers are not action text.
 */
function localRemainderText(opts: {
  body: string;
  here: string;
  colocatedNames: readonly string[];
  foreignPlaces: readonly string[];
  otherNames: readonly string[];
}): { act: string; finishedResults: string } {
  const quotes: string[] = [];
  const rest: string[] = [];
  for (const raw of opts.body.split(/\n+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (isLockedSpokenLine(trimmed)) quotes.push(trimmed);
    else rest.push(trimmed);
  }
  const place = {
    here: opts.here,
    colocatedNames: opts.colocatedNames,
    foreignPlaces: opts.foreignPlaces,
  };
  const source = rest.join("\n");
  const finishedResults = omitClausesAwayFromHere({
    body: omitLiveMovementClauses(finishedResultClauses(source, opts.otherNames).join(" ")),
    ...place,
  });
  const keptRest = omitClausesAwayFromHere({
    body: omitLiveMovementClauses(omitUnconfirmedAuthorityClauses(source, opts.otherNames)),
    ...place,
  });
  const keptQuotes = quotes.filter((line) => {
    const inner = line.replace(/^[“"]|[”"]$/g, "").trim();
    if (!inner || declaredMovementGoals(inner).length > 0) return false;
    const filtered = omitClausesAwayFromHere({
      body: omitLiveMovementClauses(inner),
      ...place,
    });
    return filtered.length > 0 && normalizedRemainder(filtered) === normalizedRemainder(inner);
  });
  return {
    act: [keptRest, ...keptQuotes].filter(Boolean).join("\n").trim(),
    finishedResults,
  };
}

function independentBotRemainder(opts: {
  body: string;
  here: string;
  rooms: readonly string[];
  party: ReadonlyArray<{ name: string; location: string }>;
  actorName: string;
}): { text: string; finishedResults: string } {
  const parsed = parseTrpgBotAction(opts.body);
  const colocatedNames = opts.party.filter((seat) => seat.location === opts.here).map((seat) => seat.name);
  const otherNames = opts.party.map((seat) => seat.name).filter((name) => name && name !== opts.actorName);
  const foreignPlaces = [
    ...opts.rooms.filter((room) => room !== opts.here),
    ...opts.party.filter((seat) => seat.location !== opts.here).map((seat) => seat.name),
    ...declaredMovementGoals(opts.body)
      .map((goal) => describeMovementGoal(goal).place)
      .filter((place): place is string => Boolean(place && place !== opts.here)),
  ];
  const pieces = [parsed.prose, parsed.intent].map((piece) =>
    localRemainderText({
      body: piece,
      here: opts.here,
      colocatedNames,
      foreignPlaces,
      otherNames,
    })
  );
  return {
    text: pieces
      .map((piece) => piece.act)
      .filter(Boolean)
      .join("\n")
      .trim(),
    finishedResults: [...new Set(pieces.map((piece) => piece.finishedResults).filter(Boolean))].join(" "),
  };
}

/**
 * The surviving local act, in the existing prose + <<<INTENT>>> shape.
 * Quote-only lines stay in the prose so the action card and locked speech keep them.
 * The intent is that act, or the speech itself when no other act survived.
 * A finished result stays in the prose and is not the intent. A rejected move is already gone.
 */
function canonicalRemainderLock(remainder: string, finishedResults: string): string {
  const quotes: string[] = [];
  const acts: string[] = [];
  for (const raw of remainder.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (isLockedSpokenLine(line)) quotes.push(line);
    else acts.push(line);
  }
  const act = acts.join("\n").trim();
  const spoken = quotes.join("\n");
  const choice = act || spoken;
  if (!choice) return "";
  const visible = [act, finishedResults.trim(), spoken].filter(Boolean).join("\n");
  const locked = sanitizeBotActionText(`${visible}\n\n${TRPG_BOT_INTENT_OPEN}\n${choice}`);
  if (Array.from(locked).length <= TRPG_ACTION_MAX_CHARS) return locked;
  const compact = sanitizeBotActionText(`${TRPG_BOT_INTENT_OPEN}\n${choice}`);
  return Array.from(compact).length <= TRPG_ACTION_MAX_CHARS ? compact : "";
}

async function generateBotActions(
  db: Database.Database,
  opts: {
    campaign: TrpgCampaignRow;
    roundId: number;
    botIds: number[];
    deps?: TrpgEngineDeps;
    requestId: string;
    adjudicationPre?: MechanicsResolution;
  }
): Promise<void> {
  const roundNumber = (
    db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(opts.roundId) as { round_number: number }
  ).round_number;
  const adjudicationPre =
    opts.adjudicationPre ??
    ensureRoundAdjudicationContext(db, {
      campaignId: opts.campaign.id,
      roundId: opts.roundId,
      roundNumber,
      deps: opts.deps,
    }).pre;
  const prev = previousNarration(db, opts.campaign.id);
  const humans = db
    .prepare(
      `SELECT s.body, p.display_name AS name
       FROM trpg_action_submissions s
       JOIN trpg_participants p ON p.id = s.participant_id
       WHERE s.round_id=? AND p.kind='human' AND s.locked=1`
    )
    .all(opts.roundId) as { body: string; name: string }[];
  const botCall =
    opts.deps?.botCall ??
    (async (system: string, user: string) => callTrpgBot({ system, user }));
  const parts = loadParticipants(db, opts.campaign.id);
  const pending = opts.botIds
    .map((id) => parts.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const ordered = orderTrpgBotsForRound({
    bots: pending.map((p) => ({ id: p.id, name: p.display_name })),
    humanActions: humans.map((h) => ({ playerName: h.name, text: h.body })),
    previousGmNarration: prev,
  });
  const earlier: Array<{ name: string; text: string }> = [];
  const completedRounds = loadCompletedMemoryRounds(db, opts.campaign.id);
  const continuity = buildBotCompactContinuity(completedRounds, prev);
  const botQueryBase = buildCampaignMemoryQuery(db, opts.campaign.id, {
    actionText: humans.map((h) => `${h.name}: ${h.body}`).join("\n"),
    sceneText: prev,
    viewerKind: "bot",
  });
  const allMemoryEvents = loadMemoryEvents(db, opts.campaign.id);
  const recentContinuity = buildTrpgBotRecentContinuity(loadCompletedMemoryRounds(db, opts.campaign.id));
  const campaignWorld = opts.campaign.world_brief ?? "";

  for (const turn of ordered) {
    refreshBotGenerationHeartbeat(db, opts.roundId, opts.requestId);
    const bot = parts.find((p) => p.id === turn.id);
    if (!bot) continue;
    let description = "";
    let greeting = "";
    let systemPrompt = "";
    let exampleDialog = "";
    let gender: ReturnType<typeof readCharacterRowFields>["gender"] = "other";
    if (bot.character_id) {
      try {
        const fields = readCharacterRowFields(
          db.prepare(`SELECT * FROM characters WHERE id=?`).get(bot.character_id)
        );
        description = fields.description;
        greeting = fields.greeting;
        exampleDialog = fields.exampleDialog;
        systemPrompt = fields.systemPrompt;
        gender = fields.gender;
      } catch {
        const persona = parseBotPersona(bot.persona_json);
        description = persona?.description ?? "";
        greeting = persona?.greeting ?? "";
        systemPrompt = persona?.systemPrompt ?? "";
      }
    } else {
      const persona = parseBotPersona(bot.persona_json);
      description = persona?.description ?? "";
      greeting = persona?.greeting ?? "";
      systemPrompt = persona?.systemPrompt ?? "";
    }
    const botHorizon = buildHorizonPromptSections({
      events: allMemoryEvents,
      query: { ...botQueryBase, viewerName: bot.display_name, viewerKind: "bot" },
    });
    logTrpgMemoryUsage({
      campaignId: opts.campaign.id,
      round: botQueryBase.currentRound,
      memoryEventsTotal: allMemoryEvents.length,
      anchorsInjected: 0,
      historicalRecalled: 0,
      historicalRecalledChars: 0,
      botRecalled: botHorizon.botCount,
    });
    const sheets = loadSheetSnapshots(db, opts.campaign.id);
    const self = sheets.find((sheet) => sheet.participantId === bot.id);
    const user = buildTrpgBotActionUserBlock({
      characterName: bot.display_name,
      gender,
      description,
      greeting,
      systemPrompt,
      exampleDialog,
      campaignWorld,
      previousGmNarration: continuity.previousScene || clipTrpgChars(prev, TRPG_BOT_SCENE_MAX_CHARS),
      recentContinuity,
      campaignMemory: buildTrpgBotMemoryBlock({
        ledger: loadCampaignLedger(db, opts.campaign.id),
        sheets: sheets.map((s) => ({
          name: s.name,
          hp: s.hp,
          maxHp: s.maxHp,
          conditions: s.conditions,
        })),
      }),
      explorationBrief: explorationBriefForBot(db, {
        campaignId: opts.campaign.id,
        participantId: bot.id,
        roundNumber,
      }),
      longTermMemories: botHorizon.botMemories,
      compactContinuity: continuity.compact,
      humanActions: humans.map((h) => ({ playerName: h.name, text: h.body })),
      companionActions: earlier,
      speakIndex: earlier.length + 1,
      speakCount: ordered.length,
      relationshipBrief: opts.campaign.relationship_brief ?? "",
    });
    const { text, usage } = await botCall(TRPG_BOT_SYSTEM, user);
    const body = prepareTrpgBotActionBody(
      text,
      `${bot.display_name}은 상황을 살피며 한 발 다가선다.`
    );
    const latestMap = loadExplorationState(db, opts.campaign.id);
    const declared = latestMap ? explorationCommandsFromMovementBody(latestMap.map, body) : [];
    const declaredRoomIds = moveCommandRoomIds(declared);
    let spoken = body;
    let lockOutcome: BotExplorationLockOutcome = "original-locked";
    let fallbackBranch = "no-declared-moves";
    let firstRejectCode: string | null = null;
    let retryRejectCode: string | null = null;
    let legalRoomIds: string[] = [];
    if (declared.length > 0) {
      try {
        spoken = db.transaction(() => {
          const prepared = prepareLockedExploration(db, {
            campaignId: opts.campaign.id,
            roundId: opts.roundId,
            participantId: bot.id,
            commands: declared,
            freeText: body,
          });
          assertTrpgActionMaxChars(prepared.body);
          upsertLockedAction(db, opts.roundId, bot.id, prepared.body, prepared.actionType, null, "bot_model");
          saveExplorationState(db, opts.campaign.id, prepared.state);
          return prepared.body;
        })();
        lockOutcome = "move-locked";
        fallbackBranch = "full-lock";
        legalRoomIds = declaredRoomIds;
      } catch (error) {
        if (!explorationMoveWasRejected(error)) throw error;
        firstRejectCode = explorationRejectCode(error);
        const fromRoomId = self?.location ?? "";
        const priced = latestMap
          ? legalExplorationCommands({
              state: latestMap,
              fromRoomId,
              commands: declared,
              apRemaining: displayExplorationAp(latestMap, bot.id, roundNumber),
            })
          : [];
        legalRoomIds = moveCommandRoomIds(priced);
        const remainder = independentBotRemainder({
          body,
          here: latestMap ? roomNameAfterCommands(latestMap.map, fromRoomId, priced) : fromRoomId,
          rooms: latestMap ? explorationRoomNames(latestMap.map) : [],
          party: sheets.map((sheet) => ({ name: sheet.name, location: sheet.location })),
          actorName: bot.display_name,
        });
        const usableRemainder =
          remainder.text && Array.from(remainder.text).length <= TRPG_ACTION_MAX_CHARS ? remainder.text : "";
        const moveLine =
          priced.length > 0 && latestMap ? composeExplorationSentences(latestMap.map, fromRoomId, priced) : "";
        const combined =
          moveLine && usableRemainder ? `${moveLine} ${usableRemainder}` : moveLine || usableRemainder;
        const retryFreeText =
          usableRemainder && Array.from(combined).length <= TRPG_ACTION_MAX_CHARS ? usableRemainder : "";
        if (priced.length > 0) {
          fallbackBranch = "partial-retry";
          try {
            spoken = db.transaction(() => {
              const prepared = prepareLockedExploration(db, {
                campaignId: opts.campaign.id,
                roundId: opts.roundId,
                participantId: bot.id,
                commands: priced,
                freeText: retryFreeText,
              });
              if (Array.from(prepared.body).length > TRPG_ACTION_MAX_CHARS) {
                throw new Error("행동이 너무 깁니다.");
              }
              upsertLockedAction(db, opts.roundId, bot.id, prepared.body, prepared.actionType, null, "bot_model");
              saveExplorationState(db, opts.campaign.id, prepared.state);
              return prepared.body;
            })();
            lockOutcome = "move-locked";
          } catch (retryError) {
            if (!explorationMoveWasRejected(retryError)) throw retryError;
            fallbackBranch = "retry-throw";
            retryRejectCode = explorationRejectCode(retryError);
            lockOutcome = "stay-fallback";
            spoken = stayWatchingInPlace(bot.display_name);
            upsertLockedAction(db, opts.roundId, bot.id, spoken, "free", null, "bot_model");
          }
        } else if (
          usableRemainder &&
          (!latestMap || explorationCommandsFromMovementBody(latestMap.map, usableRemainder).length === 0)
        ) {
          const locked = canonicalRemainderLock(usableRemainder, remainder.finishedResults);
          if (locked) {
            fallbackBranch = "priced-empty-remainder";
            lockOutcome = "original-locked";
            spoken = locked;
            upsertLockedAction(db, opts.roundId, bot.id, spoken, parseTrpgBotAction(spoken).actionType, null, "bot_model");
          } else {
            fallbackBranch = "priced-empty";
            lockOutcome = "stay-fallback";
            spoken = stayWatchingInPlace(bot.display_name);
            upsertLockedAction(db, opts.roundId, bot.id, spoken, "free", null, "bot_model");
          }
        } else {
          fallbackBranch = "priced-empty";
          lockOutcome = "stay-fallback";
          spoken = stayWatchingInPlace(bot.display_name);
          upsertLockedAction(db, opts.roundId, bot.id, spoken, "free", null, "bot_model");
        }
      }
    } else {
      upsertLockedAction(db, opts.roundId, bot.id, spoken, parseTrpgBotAction(spoken).actionType, null, "bot_model");
    }
    if (latestMap) {
      emitBotExplorationLockDiagnosticSafe(latestMap.map, text, {
        campaignId: opts.campaign.id,
        roundId: opts.roundId,
        participantId: bot.id,
        fromLocationLabel: self?.location ?? "",
        declaredRoomIdsRaw: declaredRoomIds,
        legalRoomIdsRaw: legalRoomIds,
        firstRejectCode,
        fallbackBranch,
        outcome: lockOutcome,
        retryRejectCode,
      });
    }
    adjudicateSubmissionForParticipant(db, {
      campaignId: opts.campaign.id,
      roundId: opts.roundId,
      participantId: bot.id,
      pre: adjudicationPre,
      deps: opts.deps,
    });
    appendRoundUsage(db, opts.roundId, tagBotRoundUsage(usage ?? TRPG_BOT_USAGE_FALLBACK));
    refreshBotGenerationHeartbeat(db, opts.roundId, opts.requestId);
    earlier.push({ name: bot.display_name, text: spoken });
  }
}

function loadCampaignScenarioNpcs(db: Database.Database, templateId: number | null | undefined): TrpgScenarioNpc[] {
  if (!templateId) return [];
  const row = loadScenarioTemplate(db, templateId);
  if (!row) return [];
  return parseScenarioNpcs(parseJson(row.npcs_json, [] as unknown[]));
}

function loadCampaignGmNarrations(db: Database.Database, campaignId: number, excludeRoundId?: number): string[] {
  const rows = (
    excludeRoundId
      ? db.prepare(
          `SELECT g.narration FROM trpg_gm_messages g
           JOIN trpg_rounds r ON r.id = g.round_id
           WHERE r.campaign_id=? AND r.id<>?
           ORDER BY r.round_number ASC`
        ).all(campaignId, excludeRoundId)
      : db.prepare(
          `SELECT g.narration FROM trpg_gm_messages g
           JOIN trpg_rounds r ON r.id = g.round_id
           WHERE r.campaign_id=?
           ORDER BY r.round_number ASC`
        ).all(campaignId)
  ) as Array<{ narration: string }>;
  return rows.map((row) => row.narration).filter(Boolean);
}

function previousNarration(db: Database.Database, campaignId: number): string {
  const row = db
    .prepare(
      `SELECT g.narration FROM trpg_gm_messages g
       JOIN trpg_rounds r ON r.id = g.round_id
       WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
    )
    .get(campaignId) as { narration: string } | undefined;
  return row?.narration ?? "";
}

function persistRolls(
  db: Database.Database,
  campaignId: number,
  roundId: number,
  deps?: TrpgEngineDeps
): void {
  finalizeRoundAdjudication(db, campaignId, roundId, deps);
}

function loadCampaignGenres(db: Database.Database, campaign: TrpgCampaignRow): string[] {
  const seen: string[] = [];
  const add = (raw: unknown) => {
    for (const genre of parseGenresJson(raw)) {
      if (!seen.includes(genre)) seen.push(genre);
    }
  };
  if (campaign.template_id) {
    const row = loadScenarioTemplate(db, campaign.template_id);
    if (row) add(row.genres);
  }
  if (campaign.source_world_id) {
    const hasWorlds = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='worlds'`)
      .get() as { ok: number } | undefined;
    if (hasWorlds) {
      const world = db
        .prepare(`SELECT genres FROM worlds WHERE id=?`)
        .get(campaign.source_world_id) as { genres?: string } | undefined;
      if (world) add(world.genres);
    }
  }
  return seen;
}

async function runGmForRound(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    opening: boolean;
    regenerate?: boolean;
    requestId?: string;
    deps?: TrpgEngineDeps;
  }
): Promise<{ campaignFinished: boolean }> {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  const scenario = loadScenario(db, opts.campaignId);
  const campaignContext = loadCampaignContext(db, opts.campaignId);
  const encounterAuthority = governedEncounters(campaignContext).length > 0;
  const storedSnapshot = parseJson(
    (db.prepare(`SELECT input_snapshot_json FROM trpg_rounds WHERE id=?`).get(opts.roundId) as
      | { input_snapshot_json: string | null }
      | undefined)?.input_snapshot_json,
    {} as { resolutionOrder?: unknown }
  );
  const resolutionOrder = parseResolutionOrder(storedSnapshot);
  const explorationForMethod = opts.regenerate ? null : loadExplorationState(db, opts.campaignId);
  const partyNames = loadRoundPartyNames(db, opts.roundId);
  const actions = sortByResolutionOrder(
    loadActionsForGm(db, opts.roundId, scenario.statDefs),
    resolutionOrder
  ).map((action) => {
    const split = splitV2ExplorationMethod(
      explorationForMethod,
      opts.roundId,
      action.participantId,
      action.body
    );
    if (!split) return action;
    const method =
      action.participantKind === "ai_character"
        ? omitUnconfirmedAuthorityClauses(
            split.method,
            partyNames.filter((seat) => seat.id !== action.participantId).map((seat) => seat.name)
          )
        : split.method;
    return { ...action, explorationCommandText: split.commandText, explorationMethod: method };
  });
  const latestScene = previousNarration(db, opts.campaignId);
  const mechanics = opts.opening
    ? null
    : opts.regenerate
      ? loadMechanicsResolution(db, opts.roundId)
      : await completeRoundMechanics(db, {
          campaignId: opts.campaignId,
          roundId: opts.roundId,
          opening: false,
          previousScene: latestScene,
          deps: opts.deps,
        });
  const memory = buildCampaignMemoryPrompt(db, opts.campaignId, {
    actionText: actions.map((action) => `${action.name}: ${action.body}`).join("\n"),
    sceneText: latestScene,
    viewerKind: "gm",
  });
  const participants = loadParticipants(db, opts.campaignId);
  const playerPersonas = participants
    .filter((p) => p.kind === "human")
    .map((p) => {
      const persona = parseHumanPersona(p.persona_json);
      if (persona) return formatTrpgPlayerPersonaBlock(persona, p.id);
      return `[PLAYER PERSONA participantId=${p.id} name=${p.display_name}]\n이름/호칭: ${p.display_name}`;
    })
    .join("\n\n");
  const sheets = loadSheetSnapshots(db, opts.campaignId);
  const sheetCanon = formatTrpgSheetCanon({
    defs: scenario.statDefs,
    sheets: sheets.map((s) => ({ name: s.name, stats: s.stats })),
  });
  const scenarioAssets = loadCampaignScenarioAssets(db, campaign.template_id);
  const scenarioNpcs = loadCampaignScenarioNpcs(db, campaign.template_id);
  const aiContexts = loadTrpgAiCharacterContexts(db, participants);
  const aiPartyCharacterContext = buildAiPartyCharacterContextBlock(aiContexts);
  const characterAssetCatalog = buildAiCharacterImageTagCatalog(
    aiContexts.map((row) => ({
      participantId: row.participantId,
      name: row.name,
      tags: uniqueCharacterAssetTags(row.assets),
    }))
  );
  const resolvedPlan = resolvedCampaignPlan(campaignContext);
  const scenarioPlanBlock = serializeTrpgScenarioPlanForGm(resolvedPlan, {
    npcs: scenarioNpcs,
    storyProgress: campaignContext?.storyProgress,
  });
  const localSceneProgress = campaignContext?.localSceneProgress;
  const localSceneBlock = localSceneProgress ? serializeLocalSceneStateForGm(localSceneProgress) : "";
  const localSceneDeltaContract = serializeLocalSceneDeltaContract();
  const committedNarration = opts.regenerate
    ? ((
        db.prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`).get(opts.roundId) as
          | { narration: string }
          | undefined
      )?.narration ?? "")
    : "";
  const roundNumberForOffers = (
    db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(opts.roundId) as
      | { round_number: number }
      | undefined
  )?.round_number;
  const itemOfferBlock =
    opts.opening || opts.regenerate || roundNumberForOffers == null
      ? ""
      : formatTrpgItemOfferBlock(
          participants
            .filter((p) => p.kind === "human")
            .map((p) => {
              const offered = loadTrpgSeatItemOffers(db, opts.campaignId, roundNumberForOffers, p.id)?.items ?? [];
              const taken = new Set(actions.find((action) => action.participantId === p.id)?.acceptedItems ?? []);
              return {
                participantId: p.id,
                name: p.display_name,
                items: offered.filter((name) => !taken.has(name)),
              };
            })
        );
  const committedItemOffers = opts.regenerate ? loadCommittedItemOffersByParticipant(db, opts.roundId) : null;
  const committedFacts = opts.regenerate
    ? formatTrpgRegenerateCommittedFacts({
        sheets: sheets.map((sheet) => ({
          name: sheet.name,
          hp: sheet.hp,
          location: sheet.location,
          conditions: sheet.conditions,
          inventory: inventoryUnits(sheet.inventory),
        })),
        ledger: loadCampaignLedger(db, opts.campaignId),
        itemOffers: participants
          .filter((p) => committedItemOffers?.has(p.id))
          .map((p) => ({ name: p.display_name, items: committedItemOffers?.get(p.id) ?? [] })),
      })
    : "";
  const goalLedger = loadCampaignLedger(db, opts.campaignId);
  const storyDirectorBlock = resolvedPlan
    ? [
        serializeCampaignDirectorInstructions(true),
        serializeDirectorDeltaContract({
          storyPhase: campaignContext?.storyPhase ?? "INTRO",
        }),
        serializeCampaignDirectorState(campaignContext),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const endingFinishWouldStand = campaignFinishWouldStand({
    exploration: loadExplorationState(db, opts.campaignId),
    participantIds: sheets.map((sheet) => sheet.participantId),
    locations: sheets.map((sheet) => sheet.location),
    goals: goalLedger.goals,
  });
  const requestPlayerGoalRegistration = shouldRequestTrpgPlayerGoalRegistration({
    opening: opts.opening,
    regenerate: opts.regenerate,
    campaignComplete: campaign.status === "CAMPAIGN_COMPLETE",
    activeGoalCount: activeGoalTitles(goalLedger.goals).length,
    endingFinishWouldStand,
  });
  const committedFinishStands =
    opts.regenerate === true &&
    (campaign.status === "CAMPAIGN_COMPLETE" ||
      readStoredGmFinish(
        (
          db.prepare(`SELECT structured_json FROM trpg_gm_messages WHERE round_id=?`).get(opts.roundId) as
            | { structured_json: string | null }
            | undefined
        )?.structured_json
      ).effectiveCampaignFinished === true);
  const user = buildTrpgGmUserBlock({
    worldBrief: campaign.world_brief,
    gmSecret: campaign.gm_secret ?? "",
    memoryBlock: memory,
    opening: opts.opening,
    regenerate: opts.regenerate === true,
    requestPlayerGoalRegistration,
    endingFinishWouldStand,
    committedFinishStands,
    committedNarration,
    committedFacts,
    playerPersonas,
    sheetCanon,
    genres: loadCampaignGenres(db, campaign),
    relationshipBrief: campaign.relationship_brief ?? "",
    aiPartyCharacterContext,
    characterAssetCatalog,
    scenarioAssetPrompt: buildGmSceneAssetPrompt({
      scenarioAssetPrompt: buildScenarioAssetTagPrompt(scenarioAssets),
      npcs: scenarioNpcs,
    }),
    scenarioPlanBlock,
    storyDirectorBlock,
    localSceneBlock,
    localSceneDeltaContract,
    resolutionOrderBlock: formatResolutionOrderBlock(resolutionOrder),
    mechanicsPacket: mechanics?.packet ?? "",
    explorationBlock: opts.regenerate
      ? ""
      : explorationPromptForRound(db, {
          campaignId: opts.campaignId,
          roundId: opts.roundId,
          opening: opts.opening,
          actors: actions.map((action) => ({
            participantId: action.participantId,
            name: action.name,
            tier: action.tier,
          })),
        }),
    actions,
    itemOfferBlock,
  });
  const gmCall = opts.deps?.gmCall ?? callTrpgGm;
  let stage: TrpgFailureStage = "provider_call";
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let providerTimings: GmProviderTimings | undefined;
  let draftCoalescer: GmNarrationDraftCoalescer | undefined;
  const streamCallbacks: TrpgGmStreamCallbacks | undefined = opts.requestId
    ? {
        onProviderTimings: (timings) => {
          providerTimings = timings;
        },
        onNarrationChunk: (narrationText) => {
          draftCoalescer?.noteNarration(narrationText);
        },
      }
    : undefined;
  if (opts.requestId) {
    draftCoalescer = new GmNarrationDraftCoalescer({
      db,
      roundId: opts.roundId,
      generationId: opts.requestId,
      providerTimings: () => providerTimings,
      onStaleDiscard: () => logStaleOwnerDiscard(opts.roundId, opts.requestId!, "draft"),
    });
    heartbeatTimer = setInterval(() => {
      if (!refreshGmGenerationHeartbeat(db, opts.roundId, opts.requestId!)) {
        logStaleOwnerDiscard(opts.roundId, opts.requestId!, "heartbeat");
      }
    }, GM_HEARTBEAT_REFRESH_INTERVAL_MS);
  }
  try {
    const { text, usage, finishReason, semanticDone } = await gmCall({ system: TRPG_GM_SYSTEM, user, stream: streamCallbacks });
    draftCoalescer?.flush();
    if (opts.requestId) {
      if (
        !appendGmRoundUsageForGeneration(
          db,
          opts.roundId,
          opts.requestId,
          tagGmRoundUsage(usage ?? TRPG_GM_USAGE_FALLBACK, opts.requestId),
          {
          trackRerollUsage: opts.regenerate === true,
        }
        )
      ) {
        logStaleOwnerDiscard(opts.roundId, opts.requestId, "usage");
        throw new StaleGmGenerationOwnerError();
      }
    } else {
      appendRoundUsage(db, opts.roundId, tagGmRoundUsage(usage ?? TRPG_GM_USAGE_FALLBACK, "legacy-gm"));
    }
    const integrity = assessGmCompletionIntegrity(text, { finishReason });
    console.info("[TRPG][gm] completion_integrity", {
      status: completionIntegrityStatusLabel(integrity),
      finishReason: finishReason ?? null,
      semanticDone: semanticDone === true,
      outputTokens: usage?.outputTokens ?? null,
    });
    assertGmCompletionCanCommit(text, { finishReason }, integrity);
    stage = "gm_output_parse";
    const parsed = parseTrpgGmOutput(text);
    if (parsed.diagnostics?.questsAddRejected) {
      console.info("[TRPG][gm] quest_add_rejected", { count: parsed.diagnostics.questsAddRejected });
    }
    if (parsed.diagnostics?.npcsRejected) {
      console.info("[TRPG][gm] npc_rejected", { count: parsed.diagnostics.npcsRejected });
    }
    stage = "asset_tagging";
    const usedNpcKeys = collectUsedNpcKeys(loadCampaignGmNarrations(db, opts.campaignId, opts.regenerate ? opts.roundId : undefined));
    const npcImageKeys = new Set(npcsWithImages(scenarioNpcs).map((npc) => npc.npcKey));
    parsed.narration = applyNpcSpeakerImageFallback(parsed.narration, {
      npcs: scenarioNpcs,
      usedNpcKeys,
    });
    parsed.narration = enforceGmSceneAssetMarkers(parsed.narration, {
      aiParticipantIds: aiParticipantIdSet(aiContexts),
      characterTagsByParticipant: characterTagsByParticipant(aiContexts),
      scenarioTags: new Set(playableScenarioAssets(scenarioAssets).map((asset) => asset.tag.trim()).filter(Boolean)),
      npcImageKeys,
      usedNpcKeys,
    }).text;
    stage = "state_validation";
    mergeMechanicsOwnedDelta(sheets, parsed.delta, mechanics, { encounterAuthority });
    const postGmOngoingSeeds =
      opts.opening || opts.regenerate
        ? []
        : derivePostGmOngoingSeeds({
            startingSheets: sheets,
            delta: parsed.delta,
            hpHarmAuthority: encounterAuthority ? "server" : "gm",
          });
    logPostGmOngoingCandidates(postGmOngoingSeeds);
    if (!opts.regenerate) {
      if (opts.requestId) {
        if (
          !savePendingGmResultForGeneration(
            db,
            opts.roundId,
            opts.requestId,
            parsed,
            postGmOngoingSeeds,
            opts.requestId
          )
        ) {
          logStaleOwnerDiscard(opts.roundId, opts.requestId, "pending");
          throw new StaleGmGenerationOwnerError();
        }
      } else {
        savePendingGmResult(db, opts.roundId, parsed, postGmOngoingSeeds);
      }
    }
    return commitPendingGmResult(db, {
      campaign,
      roundId: opts.roundId,
      opening: opts.opening,
      regenerate: opts.regenerate === true,
      parsed,
      postGmOngoingSeeds,
      deps: opts.deps,
      leaseOwnerId: opts.requestId,
      provenanceGenerationId: opts.requestId,
    });
  } catch (error) {
    if (!(error instanceof StaleGmGenerationOwnerError)) {
      if (opts.requestId) {
        clearGmNarrationDraftForGeneration(db, opts.roundId, opts.requestId);
      } else {
        clearGmNarrationDraft(db, opts.roundId);
      }
    }
    throw attachTrpgCallFailureMeta(error, { stage });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

function applyPendingGmResult(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    leaseOwnerId: string;
    provenanceGenerationId?: string;
    deps?: TrpgEngineDeps;
  }
): { campaignFinished: boolean } {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  const pending = loadPendingGmResult(db, opts.roundId);
  if (!pending) throw new Error("재사용할 GM 결과가 없습니다.");
  const provenanceId = opts.provenanceGenerationId ?? pending.generationId ?? opts.leaseOwnerId;
  if (pending.generationId && pending.generationId !== provenanceId) {
    throw new Error("pending GM result generation mismatch");
  }
  return commitPendingGmResult(db, {
    campaign,
    roundId: opts.roundId,
    opening: false,
    regenerate: false,
    parsed: parsedFromPending(pending),
    postGmOngoingSeeds: pending.postGmOngoingSeeds,
    deps: opts.deps,
    leaseOwnerId: opts.leaseOwnerId,
    provenanceGenerationId: provenanceId,
  });
}

/** Shadow-only: never throws, never touches state. Returns nothing the commit can depend on. */
function observeThreatShadow(build: () => string | null): void {
  try {
    const line = build();
    if (line) console.info(line);
  } catch (error) {
    console.warn("[trpg-threat-shadow] evaluation_failed", error instanceof Error ? error.message : error);
  }
}

function moveCommandRoomIds(commands: readonly ExplorationCommand[]): string[] {
  return commands.filter((command) => command.op === "move").map((command) => command.roomId);
}

function explorationMoveWasRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("행동력") ||
    message.includes("연결되지 않은") ||
    message.includes("통로") ||
    message.includes("지도와 맞지") ||
    message.includes("탐험 지도가 없습니다") ||
    message.includes("빗장") ||
    message.includes("탐험 명령") ||
    message.includes("너무 깁")
  );
}

function dropUnpricedExplorationMoves(
  parsed: ParsedTrpgGmOutput,
  results: ExplorationCommitAdjustment["results"],
  currentLocation: string
): void {
  const allowed = new Map<number, string>();
  for (const result of results) {
    const place = result.location?.trim();
    if (place) allowed.set(result.participantId, place);
  }
  for (const patch of parsed.delta.players) {
    if (typeof patch.location !== "string") continue;
    if (patch.location.trim() === allowed.get(patch.participantId)) continue;
    delete patch.location;
  }
  const proposed = (parsed.location || parsed.delta.location || "").trim();
  const current = currentLocation.trim();
  if (!proposed || proposed === current) return;
  if ([...allowed.values()].includes(proposed)) return;
  parsed.location = current;
  parsed.delta.location = current;
}

function applyExplorationToParsed(
  parsed: ParsedTrpgGmOutput,
  adjustment: ExplorationCommitAdjustment,
  sheetIds: readonly number[]
): void {
  if (adjustment.openingLocation) {
    parsed.location = adjustment.openingLocation;
    parsed.delta.location = adjustment.openingLocation;
    for (const participantId of sheetIds) {
      ensureDeltaPlayer(parsed.delta, participantId).location = adjustment.openingLocation;
    }
  }
  const eventRewards = adjustment.state.version === 2;
  const flags = new Set(parsed.delta.flagsAdd ?? []);
  for (const result of adjustment.results) {
    const patch = ensureDeltaPlayer(parsed.delta, result.participantId);
    if (result.location) patch.location = result.location;
    // A v2 exploration command resolves movement, search, and events. Text submitted with it
    // is how they explore. Grants come only from the server result, including move-only,
    // a failed or empty search, a first entry, and a repeat entry.
    if (eventRewards && result.commands.length > 0) {
      const grantNow = new Set(result.items.map((item) => item.trim()).filter(Boolean));
      delete patch.inventoryAdd;
      if (patch.inventoryRemove?.length && grantNow.size > 0) {
        const kept = patch.inventoryRemove.filter((name) => !grantNow.has(name.trim()));
        if (kept.length) patch.inventoryRemove = kept;
        else delete patch.inventoryRemove;
      }
    }
    if (result.items.length) {
      const have = new Set(patch.inventoryAdd ?? []);
      for (const item of result.items) {
        if (have.has(item)) continue;
        patch.inventoryAdd = [...(patch.inventoryAdd ?? []), item];
        have.add(item);
      }
    }
    for (const flag of result.flags) {
      if (flags.has(flag)) continue;
      parsed.delta.flagsAdd = [...(parsed.delta.flagsAdd ?? []), flag];
      flags.add(flag);
    }
  }
}

function acceptedItemsBySeat(
  db: Database.Database,
  campaignId: number,
  roundNumber: number,
  submissions: ReadonlyArray<{ participantId: number; acceptedItemsJson: string | null }>,
  humanSeatIds: ReadonlySet<number>
): Map<number, string[]> {
  const bySeat = new Map<number, string[]>();
  for (const sub of submissions) {
    if (!humanSeatIds.has(sub.participantId)) continue;
    const stored = parseStoredAcceptedItems(sub.acceptedItemsJson);
    if (!stored) continue;
    const offers = loadTrpgSeatItemOffers(db, campaignId, roundNumber, sub.participantId);
    if (!offers || offers.fromRound !== stored.fromRound) continue;
    const valid = stored.items.filter((name) => offers.items.includes(name));
    if (valid.length > 0) bySeat.set(sub.participantId, valid);
  }
  return bySeat;
}

/**
 * GM `campaignFinished` is the request. This is the decision both the normal commit and
 * APPLYING_STATE recovery finalize with. The prompt uses the same predicate when a map
 * ending fact exists (v1 escape, or a v2 seat in a goal-role room after the last goal closed).
 * A GM flag alone does not complete an open goal. No-map campaigns keep the previous
 * flag-only commit and do not receive an ending-ready head.
 */
function resolveEffectiveCampaignFinished(opts: {
  gmRequested: boolean;
  exploration: ExplorationState | null;
  participantIds: readonly number[];
  locations?: readonly string[];
  goals: readonly TrpgGoal[];
}): boolean {
  if (!opts.gmRequested) return false;
  if (opts.exploration?.version === 1) {
    if (!legacyPartyEscapeFact(opts.exploration, opts.participantIds)) return false;
    return !goalsAwaitingHostConfirmation(opts.goals);
  }
  if (opts.exploration?.version === 2) {
    if (opts.goals.some((goal) => goal.status === "active")) return false;
    if (!opts.goals.some((goal) => goal.status === "completed")) return false;
    return seatOccupiesAdventureGoal(opts.exploration, opts.locations ?? []);
  }
  return true;
}

function seatOccupiesAdventureGoal(state: ExplorationState, locations: readonly string[]): boolean {
  const goals = state.map.rooms.filter((room) => room.role === "goal");
  if (goals.length === 0) return false;
  return locations.some((location) => {
    const roomId = canonicalRoomId(state.map, location);
    return goals.some((room) => room.id === roomId);
  });
}

/** Prompt fact: a finish request on this round would complete the campaign. Same owner as v1/v2 commit. */
function campaignFinishWouldStand(opts: {
  exploration: ExplorationState | null;
  participantIds: readonly number[];
  locations?: readonly string[];
  goals: readonly TrpgGoal[];
}): boolean {
  if (!opts.exploration) return false;
  return resolveEffectiveCampaignFinished({ ...opts, gmRequested: true });
}

function readStoredGmFinish(raw: string | null | undefined): {
  gmRequested: boolean;
  effectiveCampaignFinished: boolean | null;
} {
  const parsed = parseJson(raw, {} as {
    campaign_finished?: boolean;
    campaignFinished?: boolean;
    effectiveCampaignFinished?: unknown;
  });
  return {
    gmRequested: parsed.campaign_finished === true || parsed.campaignFinished === true,
    effectiveCampaignFinished:
      typeof parsed.effectiveCampaignFinished === "boolean" ? parsed.effectiveCampaignFinished : null,
  };
}

/** Stored effective flag from this commit. Older rows omit it and are recomputed from the committed rows. */
function campaignFinishedForRecovery(db: Database.Database, campaignId: number, raw: string | null | undefined): boolean {
  const stored = readStoredGmFinish(raw);
  if (stored.effectiveCampaignFinished != null) return stored.effectiveCampaignFinished;
  if (!stored.gmRequested) return false;
  const recoverySheets = loadSheetSnapshots(db, campaignId);
  return resolveEffectiveCampaignFinished({
    gmRequested: stored.gmRequested,
    exploration: loadExplorationState(db, campaignId),
    participantIds: recoverySheets.map((sheet) => sheet.participantId),
    locations: recoverySheets.map((sheet) => sheet.location),
    goals: loadCampaignLedger(db, campaignId).goals,
  });
}

function commitPendingGmResult(
  db: Database.Database,
  opts: {
    campaign: TrpgCampaignRow;
    roundId: number;
    opening: boolean;
    regenerate: boolean;
    parsed: ParsedTrpgGmOutput;
    postGmOngoingSeeds?: readonly PostGmOngoingSeed[];
    deps?: TrpgEngineDeps;
    leaseOwnerId?: string;
    provenanceGenerationId?: string;
  }
): { campaignFinished: boolean } {
  const leaseOwnerId = opts.leaseOwnerId;
  const provenanceId = opts.provenanceGenerationId ?? leaseOwnerId;
  if (leaseOwnerId && !gmGenerationOwnsToken(db, opts.roundId, leaseOwnerId)) {
    logStaleOwnerDiscard(opts.roundId, leaseOwnerId, "commit");
    throw new StaleGmGenerationOwnerError();
  }
  const campaign = opts.campaign;
  const parsed = opts.parsed;
  const scenario = loadScenario(db, campaign.id);
  const sheets = loadSheetSnapshots(db, campaign.id);
  const mechanics = loadMechanicsResolution(db, opts.roundId);
  const currentLedger = loadCampaignLedger(db, campaign.id);
  const loadedGoalsJson = loadStoredGoalsJson(db, campaign.id);
  const campaignContext = loadCampaignContext(db, campaign.id);
  const openRoutes = campaignContext?.localSceneProgress.openRoutes ?? [];
  const lockedSubs = db
    .prepare(
      `SELECT s.id, s.participant_id AS participantId, s.body, s.action_type AS actionType, s.source,
              s.accepted_items_json AS acceptedItemsJson, r.tier
       FROM trpg_action_submissions s
       LEFT JOIN trpg_dice_rolls r ON r.submission_id = s.id
       WHERE s.round_id=? AND s.locked=1 ORDER BY s.id ASC`
    )
    .all(opts.roundId) as Array<{
    id: number;
    participantId: number;
    body: string;
    actionType: string | null;
    source: string | null;
    acceptedItemsJson: string | null;
    tier: string | null;
  }>;
  const humanSeatIds = new Set(
    loadParticipants(db, campaign.id)
      .filter((participant) => participant.kind === "human")
      .map((participant) => participant.id)
  );
  const roundNumber = (
    db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(opts.roundId) as { round_number: number }
  ).round_number;
  stripUnacceptedItemProposals(parsed.delta, humanSeatIds);
  const explorationCommit = opts.regenerate
    ? null
    : planExplorationCommit(db, {
        campaignId: campaign.id,
        roundId: opts.roundId,
        opening: opts.opening,
        actors: lockedSubs.map((sub) => ({
          participantId: sub.participantId,
          name: "",
          tier: sub.tier,
        })),
        sheetIds: sheets.map((sheet) => sheet.participantId),
      });
  if (explorationCommit) {
    applyExplorationToParsed(
      parsed,
      explorationCommit,
      sheets.map((sheet) => sheet.participantId)
    );
  }
  if (!opts.regenerate) {
    grantAcceptedItems(parsed.delta, acceptedItemsBySeat(db, campaign.id, roundNumber, lockedSubs, humanSeatIds));
  }
  const explorationState = opts.regenerate ? null : loadExplorationState(db, campaign.id);
  if (explorationState) {
    if (!opts.opening) {
      dropUnpricedExplorationMoves(parsed, explorationCommit?.results ?? [], currentLedger.location);
    }
  }
  if (explorationState && explorationOwnsWorldFlags(explorationState)) {
    const ownedFlags = [
      ...currentLedger.worldFlags,
      ...(explorationCommit?.results.flatMap((result) => result.flags) ?? []),
    ];
    if (parsed.delta.flagsAdd?.length) {
      const kept = filterExplorationFlagsAdd(parsed.delta.flagsAdd, ownedFlags);
      if (kept.length) parsed.delta.flagsAdd = kept;
      else delete parsed.delta.flagsAdd;
    }
    if (parsed.delta.flagsRemove?.length) {
      const kept = filterExplorationFlagsRemove(parsed.delta.flagsRemove);
      if (kept.length) parsed.delta.flagsRemove = kept;
      else delete parsed.delta.flagsRemove;
    }
  }
  const proposedFromPlayers =
    (parsed.delta.players ?? []).map((patch) => patch.location?.trim() ?? "").find(Boolean) ?? "";
  const boundLocation = bindGmLocationToSubmittedMovement({
    opening: opts.opening,
    currentLocation: currentLedger.location,
    proposedLocation: parsed.location || parsed.delta.location || proposedFromPlayers,
    delta: {
      ...parsed.delta,
      nextRoundContext: parsed.nextRoundContext || parsed.delta.nextRoundContext,
    },
    submissions: lockedSubs.map((sub) => {
      const decision = loadFrozenAdjudicationDecision(db, opts.roundId, sub.id);
      const acceptedRoute =
        decision && !decision.needsCheck && decision.reason === "routine_traversal"
          ? actionReferencesOpenRoute(sub.body, openRoutes)
          : null;
      return {
        participantId: sub.participantId,
        body: sub.body,
        tier: sub.tier,
        acceptedRoute,
        serverMovedTo: explorationCommit?.results.find((result) => result.participantId === sub.participantId)?.location,
      };
    }),
    sheetLocations: sheets.map((sheet) => ({
      participantId: sheet.participantId,
      location: sheet.location,
    })),
  });
  const governedCampaign = governedEncounters(campaignContext).length > 0;
  const applied = mergeMechanicsOwnedDelta(sheets, boundLocation.delta, mechanics, {
    encounterAuthority: governedCampaign,
  });
  foldAcceptedInventoryGrants(parsed.delta);
  const nextSheets = applied.ok ? applied.next : sheets;
  const persistMechanics = applied.ok || mechanics?.complete === true;
  const resolvedPlan = resolvedCampaignPlan(campaignContext);
  const endedProposals = parsed.delta.encountersEnded;
  const encounterEnding =
    governedCampaign && !opts.opening && !opts.regenerate
      ? acceptEncountersEnded({
          proposed: endedProposals,
          encounters: governedEncounters(campaignContext),
          alreadyEnded: loadEndedEncounterIds(db, campaign.id, roundNumber),
          seatLocations: [...sheets, ...nextSheets].map((sheet) => sheet.location),
        })
      : { accepted: [] as string[], rejected: [] };
  const postGmOngoingSeeds = governedCampaign
    ? withoutHpHarmSeeds(opts.postGmOngoingSeeds ?? [])
    : (opts.postGmOngoingSeeds ?? []);
  let postGmOngoingResult = { candidates: 0, promoted: 0, deduped: 0 };
  let stage: TrpgFailureStage = "ledger_apply";
  const endLocationBySeat = new Map(
    (persistMechanics ? nextSheets : sheets).map((sheet) => [sheet.participantId, sheet.location])
  );
  const goalFacts: TrpgGoalRoundFacts = {
    round: roundNumber,
    seats: sheets.map((sheet) => ({
      participantId: sheet.participantId,
      human: humanSeatIds.has(sheet.participantId),
      startLocation: sheet.location,
      endLocation: endLocationBySeat.get(sheet.participantId) ?? sheet.location,
    })),
    authoredEncounterIds: governedEncounters(campaignContext).map((encounter) => encounter.id),
    endedEncounterIds: loadEndedEncounterIds(db, campaign.id, roundNumber),
    acceptedEncounterIds: encounterEnding.accepted,
  };
  const explorationStateForFinish = explorationCommit?.state ?? loadExplorationState(db, campaign.id);
  const campaignFinished = resolveEffectiveCampaignFinished({
    gmRequested: parsed.campaignFinished === true,
    exploration: explorationStateForFinish,
    participantIds: sheets.map((sheet) => sheet.participantId),
    locations: (persistMechanics ? nextSheets : sheets).map((sheet) => sheet.location),
    goals: currentLedger.goals,
  });
  const storedFinish = opts.regenerate
    ? readStoredGmFinish(
        (
          db.prepare(`SELECT structured_json FROM trpg_gm_messages WHERE round_id=?`).get(opts.roundId) as
            | { structured_json: string | null }
            | undefined
        )?.structured_json
      )
    : null;
  const finishStands =
    campaignFinished || campaign.status === "CAMPAIGN_COMPLETE" || storedFinish?.effectiveCampaignFinished === true;
  if (finishStands) {
    parsed.narration = settleFinishedSceneNarration(parsed.narration);
    delete parsed.delta.questsAdd;
    delete boundLocation.delta.questsAdd;
  }
  const { encountersEnded: _proposedEnding, ...deltaWithoutEnding } = parsed.delta;
  const committedDelta = encounterEnding.accepted.length
    ? { ...deltaWithoutEnding, encountersEnded: encounterEnding.accepted }
    : deltaWithoutEnding;
  const effectiveToStore =
    opts.regenerate && storedFinish?.effectiveCampaignFinished === true ? true : campaignFinished;
  const ledgerDelta = {
    ...boundLocation.delta,
    location: boundLocation.location || scenario.startLocation,
    nextRoundContext: boundLocation.nextRoundContext,
    campaignFinished,
  };
  const goalContext = {
    round: roundNumber,
    facts: goalFacts,
    claimSource: provenanceId ? goalClaimSource(provenanceId, parsed.narration) : undefined,
  };
  const questsDroppedAtCap = countQuestAddsOverCap(currentLedger, ledgerDelta, goalContext);
  if (questsDroppedAtCap > 0) {
    console.info("[TRPG][gm] quest_add_capped", { dropped: questsDroppedAtCap, max: TRPG_LEDGER_QUEST_MAX });
  }
  const ledger = applyCampaignLedger(currentLedger, ledgerDelta, goalContext);
  const goalTransition = summarizeGoalTransition(currentLedger.goals, ledger.goals, roundNumber);
  if (goalTransition.created || goalTransition.completed.length || goalTransition.retired) {
    console.info("[TRPG][goal] lifecycle", {
      round: roundNumber,
      ...goalTransition,
      criteriaProposed: parsed.delta.questCriteria?.length ?? 0,
    });
  }
  if (opts.opening && goalTransition.activeAfter === 0) {
    console.warn("[TRPG][goal] missing_after_opening", { round: roundNumber });
  }
  // Deterministic progression floor (accepted routine traversal + GM omission).
  // Canonical owner: localSceneProgress. The server authors no new fiction — it
  // only promotes an already-accepted canonical route label when unambiguous.
  const resolveEffectiveLocalSceneDelta = () => {
    const gmLocalSceneDelta = parsed.delta.localScene;
    if (
      gmLocalSceneDelta?.sceneTransitionTo != null ||
      opts.opening ||
      opts.regenerate ||
      !campaignContext
    ) {
      return gmLocalSceneDelta;
    }
    const acceptedRoutineRoutes = collectAcceptedRoutineTraversalRoutes({
      db,
      roundId: opts.roundId,
      openRoutes: campaignContext.localSceneProgress.openRoutes,
    });
    const fallback = resolveRoutineTraversalSceneTransition({
      gmEmittedTransition: false,
      acceptedRoutineRoutes,
    });
    if (fallback == null) return gmLocalSceneDelta;
    console.info(
      `[trpg-local-scene-progression] ROUTE_TRAVERSAL_ACCEPTED=${acceptedRoutineRoutes.length} GM_SCENE_TRANSITION_PRESENT=false SERVER_FALLBACK_TRANSITION_USED=true round=${roundNumber}`
    );
    return { ...(gmLocalSceneDelta ?? {}), sceneTransitionTo: fallback };
  };
  if (opts.regenerate) {
    const storedStructured = db
      .prepare(`SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=?`)
      .get(opts.roundId) as { narration: string | null; structured_json: string | null } | undefined;
    let committedDelta: ParsedTrpgGmOutput["delta"] | undefined;
    if (storedStructured?.structured_json) {
      try {
        const stored = JSON.parse(storedStructured.structured_json) as { delta?: ParsedTrpgGmOutput["delta"] };
        if (stored.delta?.players) committedDelta = stored.delta;
      } catch {
        committedDelta = undefined;
      }
    }
    restoreCommittedHumanItemFacts(parsed.delta, committedDelta, humanSeatIds);
    const canon = regenerateOutputInvertsCommittedCanon({
      delta: parsed.delta,
      location: parsed.location ?? undefined,
      sheets,
      ledger: currentLedger,
      committedDelta,
      narration: parsed.narration,
      committedNarration: storedStructured?.narration ?? undefined,
      campaignFinished,
      endedEncounterIds: loadEndedEncounterIds(db, campaign.id, roundNumber),
      storyPhase: campaignContext?.storyPhase,
    });
    if (canon.invert) {
      stage = "gm_persist";
      console.info("[TRPG][gm] regenerate_unadopted", { reasons: canon.reasons });
      throw new UnadoptedTrpgRegenerateError(canon.reasons);
    }
  }
  try {
    db.transaction(() => {
      if (leaseOwnerId && provenanceId) {
        if (!markGmGenerationCommitted(db, opts.roundId, leaseOwnerId, provenanceId)) {
          throw new StaleGmGenerationOwnerError();
        }
      }
      stage = "gm_persist";
      clearGmNarrationDraft(db, opts.roundId);
      db.prepare(
        `INSERT INTO trpg_gm_messages (round_id, narration, structured_json) VALUES (?,?,?)
         ON CONFLICT(round_id) DO UPDATE SET narration=excluded.narration, structured_json=excluded.structured_json`
      ).run(
        opts.roundId,
        parsed.narration,
        JSON.stringify({ ...parsed, effectiveCampaignFinished: effectiveToStore })
      );
      if (opts.regenerate) return;
      if (persistMechanics) {
        persistSheets(db, nextSheets);
        applyMechanicsOnCommit(db, mechanics);
        if (applied.ok && !opts.opening) {
          postGmOngoingResult = applyPostGmOngoingSeeds(db, {
            campaignId: campaign.id,
            roundNumber,
            seeds: postGmOngoingSeeds,
          });
        }
        if (mechanics) markMechanicsApplied(db, mechanics);
        db.prepare(
          `INSERT OR IGNORE INTO trpg_state_change_log (campaign_id, round_id, idempotency_key, applied_json)
           VALUES (?,?,?,?)`
        ).run(campaign.id, opts.roundId, `delta:${opts.roundId}`, JSON.stringify(committedDelta));
      }
      const settled = settleLedgerForCommit(
        db,
        campaign.id,
        { ledger: currentLedger, goalsJson: loadedGoalsJson },
        (stored) => applyCampaignLedger(stored, ledgerDelta, goalContext),
        ledger
      );
      persistCampaignLedger(db, campaign.id, roundNumber, settled.ledger, settled.expectedGoalsJson);
      persistAcceptedRoundLocationIfAbsent(
        db,
        opts.roundId,
        acceptedSceneLocationFromBoundState({
          campaignLocation: ledger.location,
          sheetLocations: (persistMechanics ? nextSheets : sheets).map((sheet) => sheet.location),
        })
      );
      const effectiveLocalSceneDelta = resolveEffectiveLocalSceneDelta();
      const hasLocalSceneDelta = hasLocalSceneProgressDelta(effectiveLocalSceneDelta);
      if (campaignContext && (hasLocalSceneDelta || resolvedPlan)) {
        let ctx = campaignContext;
        if (hasLocalSceneDelta) {
          ctx = applyLocalSceneProgressToContext(ctx, effectiveLocalSceneDelta);
        }
        if (resolvedPlan) {
          stage = "story_progress";
          ctx = applyCampaignStoryProgress(ctx, {
            storyPhase: parsed.delta.storyPhase,
            threadsAdd: parsed.delta.threadsAdd,
            threadsResolve: parsed.delta.threadsResolve,
            endingConditionId: parsed.delta.endingConditionId,
            campaignFinished,
            occurredMajorEventIndices: parsed.delta.occurredMajorEventIndices,
            revealedClueIndices: parsed.delta.revealedClueIndices,
          });
        }
        persistCampaignContext(db, ctx);
      }
      if (explorationCommit) saveExplorationState(db, campaign.id, explorationCommit.state);
      setRoundPhase(db, opts.roundId, "APPLYING_STATE");
      if (!opts.opening) {
        stage = "billing";
        maybeBillRound(db, campaign, opts.roundId, opts.deps);
      }
      clearPendingGmResult(db, opts.roundId);
      stage = "round_complete";
    }).immediate();
    if (encounterEnding.accepted.length || encounterEnding.rejected.length) {
      console.info("[trpg-encounter-ended]", {
        proposed: endedProposals?.length ?? 0,
        accepted: encounterEnding.accepted,
        rejected: encounterEnding.rejected,
      });
    }
    if (!opts.regenerate && !opts.opening) {
      logPostGmOngoingObservability({
        seeds: postGmOngoingSeeds,
        promoted: postGmOngoingResult.promoted,
        deduped: postGmOngoingResult.deduped,
      });
      observeThreatShadow(() => {
        const report = evaluateThreatShadow({
          roundId: opts.roundId,
          roundNumber,
          startSheets: sheets,
          appliedSheets: persistMechanics ? nextSheets : sheets,
          gmDelta: boundLocation.delta,
          mechanics,
          actors: lockedSubs.map((sub) => ({
            participantId: sub.participantId,
            actionType: sub.actionType && isTrpgActionType(sub.actionType) ? sub.actionType : null,
            body: sub.body,
            tier: isTrpgSuccessTier(sub.tier) ? sub.tier : null,
            source: sub.source,
          })),
          authoredNpcNames: loadCampaignScenarioNpcs(db, campaign.template_id).map((npc) => npc.name),
          ledgerNpcNames: currentLedger.npcs,
        });
        return threatShadowHasSignal(report) ? formatThreatShadowLog(report) : null;
      });
    }
    return { campaignFinished };
  } catch (error) {
    throw attachTrpgCallFailureMeta(error, { stage });
  }
}

function appendGmRoundUsageForGeneration(
  db: Database.Database,
  roundId: number,
  generationId: string,
  usage: TrpgRoundUsageEntry,
  opts?: { trackRerollUsage?: boolean }
): boolean {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT usage_json, gm_reroll_usage_json FROM trpg_rounds WHERE id=? AND gm_generation_id=?`)
      .get(roundId, generationId) as
      | { usage_json: string | null; gm_reroll_usage_json: string | null }
      | undefined;
    if (!row) return false;
    const next = [...parseJson(row.usage_json, [] as TrpgRoundUsageEntry[]), usage];
    const info = db
      .prepare(`UPDATE trpg_rounds SET usage_json=? WHERE id=? AND gm_generation_id=?`)
      .run(JSON.stringify(next), roundId, generationId);
    if (info.changes !== 1) return false;
    if (!opts?.trackRerollUsage) return true;
    const rerollNext = [...parseJson(row.gm_reroll_usage_json, [] as TrpgRoundUsageEntry[]), usage];
    const rerollInfo = db
      .prepare(`UPDATE trpg_rounds SET gm_reroll_usage_json=? WHERE id=? AND gm_generation_id=?`)
      .run(JSON.stringify(rerollNext), roundId, generationId);
    return rerollInfo.changes === 1;
  })();
}

/** Atomically bill a narration reroll generation exactly once by provenance token. */
export function billRerollGenerationExactlyOnce(
  db: Database.Database,
  campaign: TrpgCampaignRow,
  roundId: number,
  leaseOwnerId: string,
  provenanceGenerationId: string,
  deps?: TrpgEngineDeps
): boolean {
  if (isRerollGenerationBilled(db, roundId, provenanceGenerationId)) {
    return gmGenerationOwnsToken(db, roundId, leaseOwnerId);
  }

  if (deps?.skipBilling) {
    const info = db
      .prepare(
        `UPDATE trpg_rounds
         SET gm_reroll_billed_generation_id=?
         WHERE id=?
           AND gm_generation_id=?
           AND gm_committed_generation_id=?
           AND (gm_reroll_billed_generation_id IS NULL OR gm_reroll_billed_generation_id != ?)`
      )
      .run(provenanceGenerationId, roundId, leaseOwnerId, provenanceGenerationId, provenanceGenerationId);
    return info.changes === 1;
  }

  try {
    return db.transaction(() => {
      const row = db
        .prepare(
          `SELECT gm_generation_id, gm_committed_generation_id, gm_reroll_billed_generation_id, gm_reroll_usage_json
           FROM trpg_rounds WHERE id=?`
        )
        .get(roundId) as {
        gm_generation_id: string | null;
        gm_committed_generation_id: string | null;
        gm_reroll_billed_generation_id: string | null;
        gm_reroll_usage_json: string | null;
      };
      if (!row) return false;
      if (row.gm_generation_id !== leaseOwnerId) return false;
      if (row.gm_committed_generation_id !== provenanceGenerationId) return false;
      if (row.gm_reroll_billed_generation_id === provenanceGenerationId) return true;

      const actualUsage = loadRerollUsageEntries(db, roundId);
      const billableUsage = loadBillableRerollUsage(db, roundId, provenanceGenerationId);
      if (billableUsage.length === 0) {
        return false;
      }
      chargeTrpgCalls(db, campaign, roundId, billableUsage, {
        addToBilled: true,
        skip: false,
        billingFault: deps?.billingFault,
        actualCalls: actualUsage,
      });

      const info = db
        .prepare(
          `UPDATE trpg_rounds
           SET gm_reroll_billed_generation_id=?
           WHERE id=?
             AND gm_generation_id=?
             AND gm_committed_generation_id=?
             AND (gm_reroll_billed_generation_id IS NULL OR gm_reroll_billed_generation_id != ?)`
        )
        .run(provenanceGenerationId, roundId, leaseOwnerId, provenanceGenerationId, provenanceGenerationId);
      return info.changes === 1;
    })();
  } catch (error) {
    if (error instanceof StaleGmGenerationOwnerError) return false;
    throw error;
  }
}

function appendRoundUsage(db: Database.Database, roundId: number, usage: TrpgRoundUsageEntry): void {
  const next = [...loadRoundUsageEntries(db, roundId), usage];
  db.prepare(`UPDATE trpg_rounds SET usage_json=? WHERE id=?`).run(JSON.stringify(next), roundId);
}

function maybeBillRound(
  db: Database.Database,
  campaign: TrpgCampaignRow,
  roundId: number,
  deps?: TrpgEngineDeps
): void {
  const row = db.prepare(`SELECT COALESCE(billed,0) AS billed FROM trpg_rounds WHERE id=?`).get(roundId) as {
    billed: number;
  };
  if (row.billed === 1) return;
  const actualCalls = loadRoundUsageEntries(db, roundId);
  const billableCalls = loadBillableRoundUsage(db, roundId);
  chargeTrpgCalls(db, campaign, roundId, billableCalls.length ? billableCalls : [{ ...TRPG_GM_USAGE_FALLBACK }], {
    addToBilled: false,
    skip: deps?.skipBilling === true,
    billingFault: deps?.billingFault,
    actualCalls,
  });
}

function throwBillingFault(
  substage: TrpgBillingSubstage,
  fault: TrpgEngineDeps["billingFault"],
  message: string
): void {
  if (fault === substage) throw new Error(message);
}

function attachBillingFailure(error: unknown, substage: TrpgBillingSubstage): Error {
  return attachTrpgCallFailureMeta(error, {
    stage: "billing",
    billingSubstage: substage,
    billingErrorCode: classifyTrpgBillingErrorCode({ substage, error }),
  });
}

function chargeTrpgCalls(
  db: Database.Database,
  campaign: TrpgCampaignRow,
  roundId: number,
  calls: TrpgRoundUsageEntry[],
  opts: {
    addToBilled: boolean;
    skip: boolean;
    billingFault?: TrpgEngineDeps["billingFault"];
    actualCalls?: TrpgRoundUsageEntry[];
  }
): void {
  if (opts.skip) {
    if (!opts.addToBilled) {
      db.prepare(`UPDATE trpg_rounds SET billed=1, billed_points=0 WHERE id=?`).run(roundId);
    }
    return;
  }
  let substage: TrpgBillingSubstage = "pricing_quote";
  try {
    throwBillingFault(substage, opts.billingFault, "billing fault: pricing_quote");
    const addPoints = computeTrpgRoundPoints(toModelUsageCalls(calls));
    if (addPoints <= 0) {
      if (!opts.addToBilled) {
        db.prepare(`UPDATE trpg_rounds SET billed=1, billed_points=0 WHERE id=?`).run(roundId);
      }
      return;
    }
    const parts = loadParticipants(db, campaign.id);
    const humans = parts.filter((p) => p.kind === "human" && p.user_id).map((p) => p.user_id!);
    const botCount = parts.filter((p) => p.kind === "ai_character").length;
    const authorUserId = campaign.author_user_id ?? null;
    const authorRate = authorUserId ? resolveCreatorRewardRate(authorUserId) : 0;
    const characterCreators = loadTrpgCharacterRoyaltyTargets(db, campaign.id);
    const valuePricing = isTrpgValuePricingEnabled();
    const quote = quoteTrpgRoundEconomics({
      modelSubtotal: addPoints,
      humanUserIds: humans,
      hostUserId: campaign.host_user_id,
      billingMode: campaign.billing_mode as TrpgBillingMode,
      authorUserId,
      authorRate,
      characterSeats: characterCreators,
      botCount,
      valuePricingEnabled: valuePricing,
    });
    const payers = valuePricing
      ? quote.perUserShares.map((row) => ({ userId: row.userId, points: row.total, quote: row }))
      : splitTrpgRoundCost({
          totalPoints: addPoints,
          humanUserIds: humans,
          hostUserId: campaign.host_user_id,
          mode: campaign.billing_mode as TrpgBillingMode,
        }).map((share) => ({ userId: share.userId, points: share.points, quote: null }));
    const billingMode = (campaign.billing_mode as TrpgBillingMode) || DEFAULT_TRPG_BILLING_MODE;
    substage = "payer_preflight";
    throwBillingFault(substage, opts.billingFault, "billing fault: payer_preflight");
    for (const share of payers) {
      if (share.points <= 0) continue;
      if (getPointBalanceOnDb(db, share.userId).total < share.points) {
        throw new Error(
          trpgInsufficientBalanceMessage({
            billingMode,
            hostUserId: campaign.host_user_id,
            shortUserId: share.userId,
          })
        );
      }
    }
    let paidPointsSpent = 0;
    let freePointsSpent = 0;
    let deductedPayers = 0;
    substage = "point_deduction";
    throwBillingFault(substage, opts.billingFault, "billing fault: point_deduction");
    for (const share of payers) {
      if (share.points <= 0) continue;
      substage = "point_deduction";
      if (opts.billingFault === "after_first_deduction" && deductedPayers >= 1) {
        throw new Error("billing fault: after_first_deduction");
      }
      const result = deductPointsOnDb(db, share.userId, share.points, `trpg-round:${roundId}`);
      deductedPayers += 1;
      const paidSpend = paidCreatorRewardSpend(result.slices);
      paidPointsSpent += paidSpend;
      freePointsSpent += result.slices.reduce((sum, slice) => {
        return slice.pointType === "PAID" ? sum : sum + Number(slice.amount ?? 0);
      }, 0);
      substage = "creator_reward";
      if (valuePricing) {
        const paidRatio = share.points > 0 ? paidSpend / share.points : 0;
        creditTrpgRoundCreatorRewards(db, {
          campaignId: campaign.id,
          roundId,
          consumerUserId: share.userId,
          paidSpend,
          authorUserId,
          authorRate,
          characterCreators,
          shares: scaleCreatorShares(share.quote?.creatorShares ?? [], paidRatio),
        });
        throwBillingFault(substage, opts.billingFault, "billing fault: creator_reward");
        continue;
      }
      if (paidSpend > 0) {
        creditTrpgRoundCreatorRewards(db, {
          campaignId: campaign.id,
          roundId,
          consumerUserId: share.userId,
          paidSpend,
          authorUserId,
          authorRate,
          characterCreators,
        });
      }
      throwBillingFault(substage, opts.billingFault, "billing fault: creator_reward");
    }
    const billedTotal = valuePricing ? quote.roundTotal : addPoints;
    const actualCreatorCpCredited = (
      db
        .prepare(`SELECT COALESCE(SUM(reward_amount),0) AS n FROM trpg_creator_earnings WHERE round_id=?`)
        .get(roundId) as { n: number }
    ).n;
    substage = "economics_observation";
    throwBillingFault(substage, opts.billingFault, "billing fault: economics_observation");
    const breakdownBase = toBillingBreakdown(quote);
    const actualProviderCalls = opts.actualCalls ?? calls;
    const economics = observeTrpgRoundEconomics({
      breakdown: breakdownBase,
      billingMode,
      paidPointsSpent,
      freePointsSpent,
      actualCreatorCpCredited,
      calls: toModelUsageCalls(calls),
      actualProviderCalls: toModelUsageCalls(actualProviderCalls),
    });
    logTrpgRoundEconomics(economics);
    const breakdown = JSON.stringify({ ...breakdownBase, economics });
    substage = "billing_persist";
    throwBillingFault(substage, opts.billingFault, "billing fault: billing_persist");
    if (opts.addToBilled) {
      db.prepare(
        `UPDATE trpg_rounds
         SET billed=1, billed_points=COALESCE(billed_points,0)+?, billing_breakdown_json=?
         WHERE id=?`
      ).run(billedTotal, breakdown, roundId);
      return;
    }
    db.prepare(`UPDATE trpg_rounds SET billed=1, billed_points=?, billing_breakdown_json=? WHERE id=?`).run(
      billedTotal,
      breakdown,
      roundId
    );
  } catch (error) {
    throw attachBillingFailure(error, substage);
  }
}

function loadRoundPartyNames(db: Database.Database, roundId: number): Array<{ id: number; name: string }> {
  return db
    .prepare(
      `SELECT p.id, p.display_name AS name
       FROM trpg_rounds r
       JOIN trpg_participants p ON p.campaign_id = r.campaign_id
       WHERE r.id=?`
    )
    .all(roundId) as Array<{ id: number; name: string }>;
}

function loadActionsForGm(
  db: Database.Database,
  roundId: number,
  defs: { key: string; label: string }[]
) {
  const partyNames = loadRoundPartyNames(db, roundId);
  return (
    db
      .prepare(
        `SELECT s.id AS submission_id, s.participant_id, p.display_name AS name, p.kind, s.body, s.action_type, s.accepted_items_json, r.stat_key, r.d20, r.final_score, r.dc, r.tier,
                (
                  SELECT st.value FROM trpg_character_stats st
                  JOIN trpg_character_sheets sh ON sh.id = st.sheet_id
                  WHERE sh.participant_id = s.participant_id AND st.stat_key = r.stat_key
                ) AS stat_value
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         LEFT JOIN trpg_dice_rolls r ON r.submission_id = s.id
         WHERE s.round_id=? AND s.locked=1
         ORDER BY s.id ASC`
      )
      .all(roundId) as Array<{
      submission_id: number;
      participant_id: number;
      name: string;
      kind: string;
      body: string;
      action_type: string | null;
      accepted_items_json: string | null;
      stat_key: string | null;
      stat_value: number | null;
      d20: number | null;
      final_score: number | null;
      dc: number | null;
      tier: string | null;
    }>
  ).map((a) => {
    const participantKind = (a.kind === "ai_character" ? "ai_character" : "human") as "human" | "ai_character";
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind,
      submissionBody: a.body,
      actionType: a.action_type,
    });
    const frozen = loadFrozenAdjudicationDecision(db, roundId, a.submission_id);
    if (!frozen) {
      throw new Error(`Missing frozen adjudication decision for submission ${a.submission_id}`);
    }
    const statKey = a.stat_key ?? "dex";
    const def = defs.find((d) => d.key === statKey);
    return {
      participantId: a.participant_id,
      name: a.name,
      participantKind,
      body:
        participantKind === "ai_character"
          ? gmAiActionText(resolved.canonicalAttempt, resolved.presentationProse, {
              otherNames: partyNames.filter((seat) => seat.id !== a.participant_id).map((seat) => seat.name),
            })
          : resolved.canonicalAttempt,
      needsCheck: frozen.needsCheck,
      checkReason: frozen.reason,
      statKey,
      statLabel: def?.label,
      statValue: a.stat_value,
      d20: a.d20,
      finalScore: a.final_score,
      dc: a.dc,
      tier: a.tier,
      acceptedItems:
        participantKind === "human" ? parseStoredAcceptedItems(a.accepted_items_json)?.items : undefined,
    };
  });
}
