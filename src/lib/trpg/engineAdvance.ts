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
import { isTrpgActionType, pickStatForAction } from "./actionTypes";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
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
  characterTagsByParticipant,
  loadTrpgAiCharacterContexts,
  readCharacterRowFields,
} from "./aiCharacterContext";
import {
  buildTrpgBotActionUserBlock,
  orderTrpgBotsForRound,
  parseTrpgBotAction,
  prepareTrpgBotActionBody,
  TRPG_BOT_SYSTEM,
} from "./botActions";
import { applyCampaignLedger, clipTrpgChars, loadCampaignLedger, persistCampaignLedger } from "./campaignLedger";
import { resolveTrpgRoll, rollServerD20 } from "./dice";
import { assertCanStart } from "./engineCreate";
import { callTrpgBot, callTrpgGm, type TrpgGmStreamCallbacks } from "./gmCall";
import {
  buildAiCharacterImageTagCatalog,
  buildAiPartyIdentityBlock,
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
  serializeLocalSceneDeltaContract,
  serializeLocalSceneStateForGm,
} from "./localSceneProgress";
import { assertGmCompletionCanCommit, assessGmCompletionIntegrity, completionIntegrityStatusLabel } from "./gmCompletionIntegrity";
import { buildTrpgGmUserBlock, formatTrpgSheetCanon, parseTrpgGmOutput, TRPG_GM_SYSTEM, type ParsedTrpgGmOutput } from "./gmPrompt";
import { serializeTrpgScenarioPlanForGm } from "./scenarioPlan";
import { parseScenarioNpcs, type TrpgScenarioNpc } from "./scenarioTypes";
import { ensureCampaignDirectorContext, type TrpgDirectorDeps } from "./sandboxDirector";
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
import {
  applyMechanicsOnCommit,
  completeRoundMechanics,
  ensurePreActionMechanics,
  type MechanicsRoundDeps,
} from "./mechanicsRound";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import { loadMechanicsResolution, markMechanicsApplied } from "./mechanicsStore";
import {
  applyPostGmOngoingSeeds,
  derivePostGmOngoingSeeds,
  logPostGmOngoingCandidates,
  logPostGmOngoingObservability,
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
  ensureRoundAdjudicationContext,
  finalizeRoundAdjudication,
} from "./roundAdjudication";
import { parseTrpgInputOrigin, type TrpgInputOrigin } from "./replySuggestions";
import { DEFAULT_TRPG_BILLING_MODE, TRPG_ACTION_MAX_CHARS, TRPG_BOT_CARD_FIELD_MAX_CHARS, TRPG_BOT_CARD_PROMPT_MAX_CHARS, TRPG_BOT_SCENE_MAX_CHARS, TRPG_GM_MODEL, type TrpgActionSource, type TrpgBillingMode, type TrpgRoundPhase } from "./types";
import { isTrpgRoundPhase } from "./types";
import {
  clearGmNarrationDraft,
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
  directorCall?: TrpgDirectorDeps["directorCall"];
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
    gmUsageCount: loadRoundUsage(db, roundId).length,
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

export async function startTrpgCampaign(
  db: Database.Database,
  opts: { campaignId: number; userId: number; deps?: TrpgEngineDeps }
): Promise<TrpgCampaignSnapshot> {
  assertCanStart(db, opts.campaignId, opts.userId);
  try {
    await ensureCampaignDirectorContext(db, opts.campaignId, { directorCall: opts.deps?.directorCall });
  } catch (error) {
    console.warn("[trpg-director] context failed; continuing with existing GM", error);
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
  const rid = newRequestId();
  if (!tryBeginNarrationReroll(db, target.id, rid)) {
    throw new Error("이미 장면을 다시 쓰고 있습니다.");
  }
  ensureTrpgProcessStage(db, target.id, "reroll");
  beginGmGenerationLease(db, target.id, rid);
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
        gmUsageCount: loadRoundUsage(db, target.id).length,
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
  const text = opts.body.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("행동을 입력하세요.");
  if (Array.from(text).length > TRPG_ACTION_MAX_CHARS) throw new Error("행동이 너무 깁니다.");
  const actionType = opts.actionType && isTrpgActionType(opts.actionType) ? opts.actionType : "free";
  upsertLockedAction(
    db,
    round.id,
    me.id,
    text,
    actionType,
    opts.selectedStat ?? null,
    "human",
    opts.idempotencyKey,
    parseTrpgInputOrigin(opts.inputOrigin)
  );
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
  inputOrigin: TrpgInputOrigin = "manual"
): void {
  const existing = db
    .prepare(`SELECT id, locked FROM trpg_action_submissions WHERE round_id=? AND participant_id=?`)
    .get(roundId, participantId) as { id: number; locked: number } | undefined;
  if (existing?.locked === 1) {
    if (source === "human") throw new Error("이미 제출했습니다.");
    return;
  }
  const origin = source === "human" ? inputOrigin : "manual";
  if (existing) {
    db.prepare(
      `UPDATE trpg_action_submissions
       SET body=?, action_type=?, selected_stat=?, locked=1, source=?, idempotency_key=?, input_origin=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(body, actionType, selectedStat, source, idempotencyKey ?? null, origin, existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO trpg_action_submissions
      (round_id, participant_id, body, action_type, selected_stat, locked, source, idempotency_key, input_origin)
     VALUES (?,?,?,?,?,1,?,?,?)`
  ).run(roundId, participantId, body, actionType, selectedStat, source, idempotencyKey ?? null, origin);
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
          const parsed = parseJson(row?.structured_json, {} as {
            campaign_finished?: boolean;
            campaignFinished?: boolean;
          });
          const campaignFinished =
            parsed.campaign_finished === true || parsed.campaignFinished === true;
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
  const campaignWorld = clipTrpgChars(opts.campaign.world_brief ?? "", TRPG_BOT_CARD_FIELD_MAX_CHARS);

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
        description = clipTrpgChars(fields.description, TRPG_BOT_CARD_FIELD_MAX_CHARS);
        greeting = clipTrpgChars(fields.greeting, TRPG_BOT_CARD_FIELD_MAX_CHARS);
        exampleDialog = clipTrpgChars(fields.exampleDialog, TRPG_BOT_CARD_FIELD_MAX_CHARS);
        systemPrompt = clipTrpgChars(fields.systemPrompt, TRPG_BOT_CARD_PROMPT_MAX_CHARS);
        gender = fields.gender;
      } catch {
        const persona = parseBotPersona(bot.persona_json);
        description = clipTrpgChars(persona?.description ?? "", TRPG_BOT_CARD_FIELD_MAX_CHARS);
        greeting = clipTrpgChars(persona?.greeting ?? "", TRPG_BOT_CARD_FIELD_MAX_CHARS);
        systemPrompt = clipTrpgChars(persona?.systemPrompt ?? "", TRPG_BOT_CARD_PROMPT_MAX_CHARS);
      }
    } else {
      const persona = parseBotPersona(bot.persona_json);
      description = clipTrpgChars(persona?.description ?? "", TRPG_BOT_CARD_FIELD_MAX_CHARS);
      greeting = clipTrpgChars(persona?.greeting ?? "", TRPG_BOT_CARD_FIELD_MAX_CHARS);
      systemPrompt = clipTrpgChars(persona?.systemPrompt ?? "", TRPG_BOT_CARD_PROMPT_MAX_CHARS);
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
        sheets: loadSheetSnapshots(db, opts.campaign.id).map((s) => ({
          name: s.name,
          hp: s.hp,
          maxHp: s.maxHp,
          conditions: s.conditions,
        })),
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
    upsertLockedAction(db, opts.roundId, bot.id, body, parseTrpgBotAction(body).actionType, null, "bot_model");
    adjudicateSubmissionForParticipant(db, {
      campaignId: opts.campaign.id,
      roundId: opts.roundId,
      participantId: bot.id,
      pre: adjudicationPre,
      deps: opts.deps,
    });
    appendRoundUsage(db, opts.roundId, usage ?? TRPG_BOT_USAGE_FALLBACK);
    refreshBotGenerationHeartbeat(db, opts.roundId, opts.requestId);
    earlier.push({ name: bot.display_name, text: body });
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
  const storedSnapshot = parseJson(
    (db.prepare(`SELECT input_snapshot_json FROM trpg_rounds WHERE id=?`).get(opts.roundId) as
      | { input_snapshot_json: string | null }
      | undefined)?.input_snapshot_json,
    {} as { resolutionOrder?: unknown }
  );
  const resolutionOrder = parseResolutionOrder(storedSnapshot);
  const actions = sortByResolutionOrder(loadActionsForGm(db, opts.roundId, scenario.statDefs), resolutionOrder);
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
  const aiPartyIdentities = buildAiPartyIdentityBlock(aiContexts);
  const characterAssetCatalog = buildAiCharacterImageTagCatalog(
    aiContexts.map((row) => ({
      participantId: row.participantId,
      name: row.name,
      tags: uniqueCharacterAssetTags(row.assets),
    }))
  );
  const campaignContext = loadCampaignContext(db, opts.campaignId);
  const resolvedPlan = resolvedCampaignPlan(campaignContext);
  const scenarioPlanBlock = serializeTrpgScenarioPlanForGm(resolvedPlan, { npcs: scenarioNpcs });
  const completedRounds = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM trpg_rounds
         WHERE campaign_id=? AND phase IN ('ROUND_COMPLETE','CAMPAIGN_COMPLETE')`
      )
      .get(opts.campaignId) as { n: number } | undefined
  )?.n ?? 0;
  const storyDirectorBlock = resolvedPlan
    ? [
        serializeCampaignDirectorInstructions(true),
        serializeDirectorDeltaContract({
          storyPhase: campaignContext?.storyPhase ?? "INTRO",
          completedRounds,
        }),
        serializeCampaignDirectorState(campaignContext),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const localSceneProgress = campaignContext?.localSceneProgress;
  const localSceneBlock = localSceneProgress ? serializeLocalSceneStateForGm(localSceneProgress) : "";
  const localSceneDeltaContract = serializeLocalSceneDeltaContract();
  const user = buildTrpgGmUserBlock({
    worldBrief: campaign.world_brief,
    gmSecret: campaign.gm_secret ?? "",
    memoryBlock: memory,
    opening: opts.opening,
    regenerate: opts.regenerate === true,
    playerPersonas,
    sheetCanon,
    genres: loadCampaignGenres(db, campaign),
    relationshipBrief: campaign.relationship_brief ?? "",
    aiPartyIdentities,
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
    actions,
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
    const integrity = assessGmCompletionIntegrity(text, { finishReason, semanticDone });
    console.info("[TRPG][gm] completion_integrity", {
      status: completionIntegrityStatusLabel(integrity),
      finishReason: finishReason ?? null,
      semanticDone: semanticDone === true,
      outputTokens: usage?.outputTokens ?? null,
    });
    assertGmCompletionCanCommit(text, { finishReason, semanticDone });
    if (opts.requestId) {
      if (
        !appendGmRoundUsageForGeneration(db, opts.roundId, opts.requestId, usage ?? TRPG_GM_USAGE_FALLBACK, {
          trackRerollUsage: opts.regenerate === true,
        })
      ) {
        logStaleOwnerDiscard(opts.roundId, opts.requestId, "usage");
        throw new StaleGmGenerationOwnerError();
      }
    } else {
      appendRoundUsage(db, opts.roundId, usage ?? TRPG_GM_USAGE_FALLBACK);
    }
    stage = "gm_output_parse";
    const parsed = parseTrpgGmOutput(text);
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
    mergeMechanicsOwnedDelta(sheets, parsed.delta, mechanics);
    const postGmOngoingSeeds =
      opts.opening || opts.regenerate
        ? []
        : derivePostGmOngoingSeeds({
            startingSheets: sheets,
            delta: parsed.delta,
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
      clearGmNarrationDraft(db, opts.roundId);
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
  const applied = mergeMechanicsOwnedDelta(sheets, parsed.delta, mechanics);
  const nextSheets = applied.ok ? applied.next : sheets;
  const persistMechanics = applied.ok || mechanics?.complete === true;
  const roundNumber = (
    db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(opts.roundId) as { round_number: number }
  ).round_number;
  const campaignContext = loadCampaignContext(db, campaign.id);
  const resolvedPlan = resolvedCampaignPlan(campaignContext);
  const postGmOngoingSeeds = opts.postGmOngoingSeeds ?? [];
  let postGmOngoingResult = { candidates: 0, promoted: 0, deduped: 0 };
  let stage: TrpgFailureStage = "ledger_apply";
  const ledger = applyCampaignLedger(loadCampaignLedger(db, campaign.id), {
    ...parsed.delta,
    location: parsed.location || parsed.delta.location || nextSheets[0]?.location || scenario.startLocation,
    nextRoundContext: parsed.nextRoundContext || parsed.delta.nextRoundContext,
    campaignFinished: parsed.campaignFinished,
  });
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
      ).run(opts.roundId, parsed.narration, JSON.stringify(parsed));
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
        ).run(campaign.id, opts.roundId, `delta:${opts.roundId}`, JSON.stringify(parsed.delta));
      }
      persistCampaignLedger(db, campaign.id, roundNumber, ledger);
      const hasLocalSceneDelta = hasLocalSceneProgressDelta(parsed.delta.localScene);
      if (campaignContext && (hasLocalSceneDelta || resolvedPlan)) {
        let ctx = campaignContext;
        if (hasLocalSceneDelta) {
          ctx = applyLocalSceneProgressToContext(ctx, parsed.delta.localScene);
        }
        if (resolvedPlan) {
          stage = "story_progress";
          ctx = applyCampaignStoryProgress(ctx, {
            storyPhase: parsed.delta.storyPhase,
            threadsAdd: parsed.delta.threadsAdd,
            threadsResolve: parsed.delta.threadsResolve,
            endingConditionId: parsed.delta.endingConditionId,
            campaignFinished: parsed.campaignFinished,
          });
        }
        persistCampaignContext(db, ctx);
      }
      setRoundPhase(db, opts.roundId, "APPLYING_STATE");
      if (!opts.opening) {
        stage = "billing";
        maybeBillRound(db, campaign, opts.roundId, opts.deps);
      }
      clearPendingGmResult(db, opts.roundId);
      stage = "round_complete";
    })();
    if (!opts.regenerate && !opts.opening) {
      logPostGmOngoingObservability({
        seeds: postGmOngoingSeeds,
        promoted: postGmOngoingResult.promoted,
        deduped: postGmOngoingResult.deduped,
      });
    }
    return { campaignFinished: parsed.campaignFinished === true };
  } catch (error) {
    throw attachTrpgCallFailureMeta(error, { stage });
  }
}

function appendGmRoundUsageForGeneration(
  db: Database.Database,
  roundId: number,
  generationId: string,
  usage: TrpgModelUsage,
  opts?: { trackRerollUsage?: boolean }
): boolean {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT usage_json, gm_reroll_usage_json FROM trpg_rounds WHERE id=? AND gm_generation_id=?`)
      .get(roundId, generationId) as
      | { usage_json: string | null; gm_reroll_usage_json: string | null }
      | undefined;
    if (!row) return false;
    const next = [...parseJson(row.usage_json, [] as TrpgModelUsage[]), usage];
    const info = db
      .prepare(`UPDATE trpg_rounds SET usage_json=? WHERE id=? AND gm_generation_id=?`)
      .run(JSON.stringify(next), roundId, generationId);
    if (info.changes !== 1) return false;
    if (!opts?.trackRerollUsage) return true;
    const rerollNext = [...parseJson(row.gm_reroll_usage_json, [] as TrpgModelUsage[]), usage];
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

      const usage = parseJson(row.gm_reroll_usage_json, [] as TrpgModelUsage[]);
      chargeTrpgCalls(db, campaign, roundId, usage.length ? usage : [TRPG_GM_USAGE_FALLBACK], {
        addToBilled: true,
        skip: false,
        billingFault: deps?.billingFault,
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

function loadRoundUsage(db: Database.Database, roundId: number): TrpgModelUsage[] {
  const row = db.prepare(`SELECT usage_json FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { usage_json: string | null }
    | undefined;
  return parseJson(row?.usage_json, [] as TrpgModelUsage[]);
}

function appendRoundUsage(db: Database.Database, roundId: number, usage: TrpgModelUsage): void {
  const next = [...loadRoundUsage(db, roundId), usage];
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
  const calls = loadRoundUsage(db, roundId);
  chargeTrpgCalls(db, campaign, roundId, calls.length ? calls : [TRPG_GM_USAGE_FALLBACK], {
    addToBilled: false,
    skip: deps?.skipBilling === true,
    billingFault: deps?.billingFault,
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
  calls: TrpgModelUsage[],
  opts: { addToBilled: boolean; skip: boolean; billingFault?: TrpgEngineDeps["billingFault"] }
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
    const addPoints = computeTrpgRoundPoints(calls);
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
    const economics = observeTrpgRoundEconomics({
      breakdown: breakdownBase,
      billingMode,
      paidPointsSpent,
      freePointsSpent,
      actualCreatorCpCredited,
      calls,
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

function loadActionsForGm(
  db: Database.Database,
  roundId: number,
  defs: { key: string; label: string }[]
) {
  return (
    db
      .prepare(
        `SELECT s.participant_id, p.display_name AS name, s.body, s.action_type, r.stat_key, r.d20, r.final_score, r.dc, r.tier,
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
      participant_id: number;
      name: string;
      body: string;
      action_type: string | null;
      stat_key: string | null;
      stat_value: number | null;
      d20: number | null;
      final_score: number | null;
      dc: number | null;
      tier: string | null;
    }>
  ).map((a) => {
    const actionType = a.action_type && isTrpgActionType(a.action_type) ? a.action_type : "free";
    const parsed = parseTrpgBotAction(a.body);
    const needsCheck = resolveTrpgActionCheckDecision({
      body: parsed.prose || a.body,
      actionType,
      intent: parsed.intent,
    }).needsCheck;
    const statKey = a.stat_key ?? "dex";
    const def = defs.find((d) => d.key === statKey);
    return {
      participantId: a.participant_id,
      name: a.name,
      body: parsed.prose || a.body,
      intent: parsed.intent,
      needsCheck,
      statKey,
      statLabel: def?.label,
      statValue: a.stat_value,
      d20: a.d20,
      finalScore: a.final_score,
      dc: a.dc,
      tier: a.tier,
    };
  });
}
