import type Database from "better-sqlite3";
import { isTrpgActionType, type TrpgActionType } from "./actionTypes";
import { loadSheetSnapshots } from "./engineSheets";
import { nextTrpgRoundWork, type TrpgRoundWork } from "./roundLock";
import { buildPartySheetHud } from "./sheetView";
import { DEFAULT_TRPG_SHEET_WIDGET } from "./defaultSheet";
import { loadTrpgPartyChat } from "./partyChat";
import { trpgInvitePath } from "./invite";
import { parseHumanPersona } from "./hostPersona";
import { splitTrpgRoundCost } from "./billing";
import { isTrpgLobbyStatus } from "./billingMode";
import { parseBillingBreakdown } from "./economics";
import {
  loadCampaign,
  loadLatestRound,
  loadParticipants,
  loadScenario,
  parseJson,
  type TrpgParticipantRow,
} from "./store";
import { purgeUnstartedSoloDrafts } from "./engineDelete";
import { loadCampaignContext } from "./campaignContext";
import { parseResolutionOrder, sortByResolutionOrder } from "./initiative";
import { loadTrpgAiCharacterContexts, toPublicAiCharacterAssets } from "./aiCharacterContext";
import { loadCampaignScenarioAssets } from "./scenarioTemplates";
import {
  isListedTrpgCampaign,
  type TrpgCampaignSnapshot,
  type TrpgPublicLog,
  type TrpgPublicParticipant,
  type TrpgPublicRoll,
  type TrpgReadyState,
} from "./snapshot";
import { loadLastSafeRestRounds, loadLatestCompleteMechanics, loadOngoingEffects } from "./mechanicsStore";
import { evaluateSafeRestEligibility, sameRoundHasCombatAction } from "./mechanicsValidate";
import { formatMechanicsHudLines, recoveryHintKo } from "./sheetHud";
import { hasPendingGmResult } from "./pendingGmResult";
import { parseTrpgStartFailureJson, sanitizeTrpgFailureHint } from "./startFailure";
import {
  DEFAULT_TRPG_BILLING_MODE,
  TRPG_BOT_GROSS_MARGIN,
  TRPG_GM_GROSS_MARGIN,
  isTrpgRoundPhase,
  type TrpgBillingMode,
  type TrpgParticipantKind,
  type TrpgParticipantStatus,
  type TrpgRoundPhase,
  type TrpgSuccessTier,
} from "./types";

function sheetConfirmed(revision: number | undefined): boolean {
  // Picking a companion writes a sheet (revision may still be 0). That is enough to start.
  return revision != null;
}

function asPhase(value: string): TrpgRoundPhase {
  return isTrpgRoundPhase(value) ? value : "ERROR_RECOVERY";
}

function asStatus(value: string): TrpgParticipantStatus {
  if (
    value === "active" ||
    value === "incapacitated" ||
    value === "spectating" ||
    value === "disconnected"
  ) {
    return value;
  }
  return "active";
}

function isSuccessTier(tier: TrpgSuccessTier): boolean {
  return (
    tier === "PARTIAL_SUCCESS" ||
    tier === "SUCCESS" ||
    tier === "GREAT_SUCCESS" ||
    tier === "CRITICAL_SUCCESS"
  );
}

function submittedIds(db: Database.Database, roundId: number): Set<number> {
  return new Set(
    (
      db
        .prepare(`SELECT participant_id FROM trpg_action_submissions WHERE round_id=? AND locked=1`)
        .all(roundId) as { participant_id: number }[]
    ).map((r) => r.participant_id)
  );
}

function readyOf(
  p: TrpgParticipantRow,
  submitted: boolean,
  work: TrpgRoundWork
): TrpgReadyState {
  const status = asStatus(p.status);
  if (status === "disconnected") return "disconnected";
  if (status === "incapacitated") return "incapacitated";
  if (status === "spectating") return "spectating";
  if (p.kind === "ai_character") {
    if (submitted) return "submitted";
    if (work.type === "wait_host_fill") return "host_fill";
    return "bot_pending";
  }
  return submitted ? "submitted" : "writing";
}

function asKind(value: string): TrpgParticipantKind {
  return value === "ai_character" ? "ai_character" : "human";
}

function loadResolutionOrder(db: Database.Database, roundId: number) {
  const row = db.prepare(`SELECT input_snapshot_json FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { input_snapshot_json: string | null }
    | undefined;
  return parseResolutionOrder(parseJson(row?.input_snapshot_json, {} as { resolutionOrder?: unknown }));
}

function loadRolls(db: Database.Database, roundId: number): TrpgPublicRoll[] {
  const order = loadResolutionOrder(db, roundId);
  return sortByResolutionOrder(
    (
    db
      .prepare(
        `SELECT r.d20, r.stat_key, r.final_score, r.dc, r.tier, s.participant_id, s.body, s.action_type,
                p.display_name AS name, p.kind
         FROM trpg_dice_rolls r
         JOIN trpg_action_submissions s ON s.id = r.submission_id
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE r.round_id=?
         ORDER BY s.id ASC`
      )
      .all(roundId) as Array<{
      d20: number;
      stat_key: string;
      final_score: number;
      dc: number;
      tier: string;
      participant_id: number;
      body: string;
      action_type: string | null;
      name: string;
      kind: string;
    }>
  ).map((row) => {
    const tier = row.tier as TrpgSuccessTier;
    return {
      participantId: row.participant_id,
      name: row.name,
      d20: row.d20,
      statKey: row.stat_key,
      finalScore: row.final_score,
      dc: row.dc,
      tier,
      success: isSuccessTier(tier),
      actionBody: row.body,
      actionType: row.action_type && isTrpgActionType(row.action_type) ? row.action_type : null,
      kind: asKind(row.kind),
    };
  }),
    order
  );
}

function loadActions(
  db: Database.Database,
  roundId: number,
  viewerParticipantId: number | null
): Array<{
  participantId: number;
  name: string;
  body: string;
  revealed: boolean;
  kind: TrpgParticipantKind;
  actionType: TrpgActionType | null;
}> {
  return (
    db
      .prepare(
        `SELECT s.participant_id, p.display_name AS name, p.kind, s.body, s.locked, s.action_type
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE s.round_id=?`
      )
      .all(roundId) as Array<{
      participant_id: number;
      name: string;
      kind: string;
      body: string;
      locked: number;
      action_type: string | null;
    }>
  ).map((row) => {
    const show = row.locked === 1 || row.participant_id === viewerParticipantId;
    return {
      participantId: row.participant_id,
      name: row.name,
      body: show ? row.body : "",
      revealed: show,
      kind: asKind(row.kind),
      actionType: row.action_type && isTrpgActionType(row.action_type) ? row.action_type : null,
    };
  });
}

export function listTrpgCampaigns(db: Database.Database, userId: number): TrpgCampaignSnapshot[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT c.id
       FROM trpg_campaigns c
       JOIN trpg_participants p ON p.campaign_id = c.id
       WHERE p.user_id=? AND p.kind='human'
       ORDER BY c.updated_at DESC
       LIMIT 40`
    )
    .all(userId) as Array<{ id: number }>;
  return rows
    .map((row) => loadTrpgSnapshot(db, row.id, userId, { includePartyChat: false }))
    .filter((s): s is TrpgCampaignSnapshot => s != null && isListedTrpgCampaign(s));
}

export function loadTrpgSnapshot(
  db: Database.Database,
  campaignId: number,
  viewerUserId: number,
  opts?: { includePartyChat?: boolean }
): TrpgCampaignSnapshot | null {
  const campaign = loadCampaign(db, campaignId);
  if (!campaign) return null;
  if (campaign.host_user_id === viewerUserId && isTrpgLobbyStatus(campaign.status) && !loadLatestRound(db, campaignId)) {
    const humans = db
      .prepare(`SELECT COUNT(*) AS n FROM trpg_participants WHERE campaign_id=? AND kind='human'`)
      .get(campaignId) as { n: number };
    if (humans.n <= 1) {
      purgeUnstartedSoloDrafts(db, viewerUserId, campaignId);
    }
  }
  const parts = loadParticipants(db, campaignId);
  const viewer = parts.find((p) => p.kind === "human" && p.user_id === viewerUserId);
  if (!viewer && campaign.host_user_id !== viewerUserId) return null;

  const scenario = loadScenario(db, campaignId);
  const round = loadLatestRound(db, campaignId);
  const phase: TrpgRoundPhase | "NONE" = round ? asPhase(round.phase) : "NONE";
  const locked = round ? submittedIds(db, round.id) : new Set<number>();
  const actors = parts.map((p) => ({
    id: p.id,
    kind: (p.kind === "ai_character" ? "ai_character" : "human") as TrpgParticipantKind,
    canAct: p.can_act === 1 && p.status === "active",
    submitted: locked.has(p.id),
  }));
  const work = nextTrpgRoundWork({
    phase: phase === "NONE" ? "CHARACTER_SETUP" : phase,
    humans: actors.filter((a) => a.kind === "human"),
    bots: actors.filter((a) => a.kind === "ai_character"),
    botGenerateFailed: round?.error_json?.includes('"bot"') === true,
  });

  const widgetRow = db
    .prepare(`SELECT widget_template_json FROM trpg_scenarios WHERE campaign_id=?`)
    .get(campaignId) as { widget_template_json: string } | undefined;
  const widget = parseJson(widgetRow?.widget_template_json, DEFAULT_TRPG_SHEET_WIDGET);
  const sheets = buildPartySheetHud({
    viewerParticipantId: viewer?.id ?? -1,
    sheets: loadSheetSnapshots(db, campaignId),
    widget,
  });

  const currentRolls = round ? loadRolls(db, round.id) : [];
  let currentNarration: string | null = null;
  if (round) {
    const gm = db
      .prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`)
      .get(round.id) as { narration: string } | undefined;
    currentNarration = gm?.narration ?? null;
    if (!currentNarration) {
      const prev = db
        .prepare(
          `SELECT g.narration FROM trpg_gm_messages g
           JOIN trpg_rounds r ON r.id = g.round_id
           WHERE r.campaign_id=? AND r.round_number < ?
           ORDER BY r.round_number DESC LIMIT 1`
        )
        .get(campaignId, round.round_number) as { narration: string } | undefined;
      currentNarration = prev?.narration ?? null;
    }
  }

  const mySub = round && viewer
    ? (db
        .prepare(
          `SELECT body, action_type, selected_stat, locked
           FROM trpg_action_submissions WHERE round_id=? AND participant_id=?`
        )
        .get(round.id, viewer.id) as
        | { body: string; action_type: string | null; selected_stat: string | null; locked: number }
        | undefined)
    : undefined;

  const revisions = new Map(
    (
      db
        .prepare(`SELECT participant_id, revision FROM trpg_character_sheets WHERE campaign_id=?`)
        .all(campaignId) as Array<{ participant_id: number; revision: number }>
    ).map((row) => [row.participant_id, row.revision])
  );
  const lastBilled = db
    .prepare(
      `SELECT billed_points FROM trpg_rounds
       WHERE campaign_id=? AND COALESCE(billed,0)=1 AND COALESCE(billed_points,0)>0
       ORDER BY round_number DESC LIMIT 1`
    )
    .get(campaignId) as { billed_points: number } | undefined;

  const participants: TrpgPublicParticipant[] = parts.map((p) => ({
    id: p.id,
    slotIndex: p.slot_index,
    kind: (p.kind === "ai_character" ? "ai_character" : "human") as TrpgParticipantKind,
    userId: p.user_id,
    characterId: p.character_id,
    displayName: p.display_name,
    canAct: p.can_act === 1,
    status: asStatus(p.status),
    ready: readyOf(p, locked.has(p.id), work),
    hasSheet: sheets.some((s) => s.participantId === p.id),
    sheetConfirmed: sheetConfirmed(revisions.get(p.id)),
  }));

  const log = loadLog(db, campaignId, viewer?.id ?? null, {
    viewerUserId,
    hostUserId: campaign.host_user_id,
    mode: (campaign.billing_mode as TrpgBillingMode) || DEFAULT_TRPG_BILLING_MODE,
    humanUserIds: parts.filter((p) => p.kind === "human" && p.user_id).map((p) => p.user_id!),
  });
  const myActionType =
    mySub?.action_type && isTrpgActionType(mySub.action_type) ? mySub.action_type : null;

  return {
    id: campaign.id,
    title: campaign.title,
    inviteCode: campaign.invite_code ?? "",
    invitePath: campaign.invite_code ? trpgInvitePath(campaign.invite_code) : "",
    hostUserId: campaign.host_user_id,
    sourceCharacterId: campaign.source_character_id,
    worldBrief: campaign.world_brief,
    relationshipBrief: campaign.relationship_brief ?? "",
    billingMode: (campaign.billing_mode as TrpgBillingMode) || DEFAULT_TRPG_BILLING_MODE,
    billingModeLocked:
      !isTrpgLobbyStatus(campaign.status) &&
      ((campaign.billing_mode as TrpgBillingMode) || DEFAULT_TRPG_BILLING_MODE) === "host_pays",
    campaignStatus: campaign.status,
    maxSlots: campaign.max_slots,
    pointPool: scenario.pointPool,
    statDefs: scenario.statDefs,
    diceRules: scenario.diceRules,
    suggestedPcStats: scenario.defaultPcStats,
    viewerParticipantId: viewer?.id ?? null,
    viewerPersonaId: parseHumanPersona(viewer?.persona_json)?.personaId ?? null,
    viewerIsHost: campaign.host_user_id === viewerUserId,
    needsHostFill: work.type === "wait_host_fill",
    hostFillBotIds: work.type === "wait_host_fill" ? work.botIds : [],
    round: {
      id: round?.id ?? null,
      number: round?.round_number ?? 0,
      phase,
    },
    participants,
    sheets,
    myDraft: viewer
      ? {
          body: mySub?.body ?? "",
          actionType: myActionType as TrpgActionType | null,
          selectedStat: mySub?.selected_stat ?? null,
          locked: mySub?.locked === 1,
        }
      : null,
    currentRolls,
    resolutionOrder: (() => {
      const current = round ? loadResolutionOrder(db, round.id) : [];
      if (current.length > 0) return current;
      if (!round || round.round_number <= 0) return [];
      const prevId = db
        .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`)
        .get(campaignId, round.round_number - 1) as { id: number } | undefined;
      return prevId ? loadResolutionOrder(db, prevId.id) : [];
    })(),
    currentNarration,
    log,
    workType: work.type,
    lastBilledPoints: lastBilled?.billed_points ?? null,
    partyHumanCount: parts.filter((p) => p.kind === "human").length,
    partyBotCount: parts.filter((p) => p.kind === "ai_character").length,
    gmGrossMargin: TRPG_GM_GROSS_MARGIN,
    botGrossMargin: TRPG_BOT_GROSS_MARGIN,
    partyChat: opts?.includePartyChat === false ? [] : loadTrpgPartyChat(db, campaignId, viewerUserId),
    canRerollRoundNumber: resolveCanRerollRoundNumber(db, {
      campaignId,
      hostUserId: campaign.host_user_id,
      viewerUserId,
      campaignStatus: campaign.status,
    }),
    narrationRerolling: Boolean(
      db
        .prepare(
          `SELECT 1 FROM trpg_rounds
           WHERE campaign_id=? AND phase='GENERATING_NARRATION' AND round_number < ?`
        )
        .get(campaignId, round?.round_number ?? 0)
    ),
    scenarioAssets: loadCampaignScenarioAssets(db, campaign.template_id),
    aiCharacterAssets: toPublicAiCharacterAssets(loadTrpgAiCharacterContexts(db, parts)),
    storyPhase: loadCampaignContext(db, campaignId)?.storyPhase,
    gmFailureHint:
      campaign.host_user_id === viewerUserId && phase === "ERROR_RECOVERY"
        ? sanitizeTrpgFailureHint(parseTrpgStartFailureJson(round?.error_json))
        : null,
    gmFailureKind:
      campaign.host_user_id === viewerUserId && phase === "ERROR_RECOVERY"
        ? parseTrpgStartFailureJson(round?.error_json)?.kind ?? null
        : null,
    gmFailureBillingSubstage:
      campaign.host_user_id === viewerUserId && phase === "ERROR_RECOVERY"
        ? parseTrpgStartFailureJson(round?.error_json)?.billingSubstage ?? null
        : null,
    gmFailureBillingErrorCode:
      campaign.host_user_id === viewerUserId && phase === "ERROR_RECOVERY"
        ? parseTrpgStartFailureJson(round?.error_json)?.billingErrorCode ?? null
        : null,
    hasPendingGmResult:
      campaign.host_user_id === viewerUserId && round?.id
        ? hasPendingGmResult(db, round.id)
        : false,
    ongoingEffects: loadOngoingEffects(db, campaignId).map((effect) => ({
      participantId: effect.participantId,
      label: effect.label,
      kind: effect.kind,
      severity: effect.severity,
      remainingTicks: effect.remainingTicks,
      recoveryHint: recoveryHintKo(effect),
    })),
    mechanicsLines: (() => {
      const latest = loadLatestCompleteMechanics(db, campaignId);
      if (!latest) return [];
      return parts.flatMap((part) =>
        formatMechanicsHudLines(latest, part.id).map((text) => ({
          participantId: part.id,
          text,
        }))
      );
    })(),
    safeRest: (() => {
      const self = sheets.find((card) => card.isSelf)?.sheet;
      if (!self) return { available: false, healAmount: 0, blockedReason: "incapacitated" as const };
      const combatActions = round
        ? (
            db
              .prepare(
                `SELECT action_type FROM trpg_action_submissions WHERE round_id=? AND locked=1`
              )
              .all(round.id) as Array<{ action_type: string | null }>
          ).map((row) => ({
            actionType: row.action_type && isTrpgActionType(row.action_type) ? row.action_type : null,
          }))
        : [];
      const lastRests = loadLastSafeRestRounds(db, campaignId);
      return evaluateSafeRestEligibility({
        hp: self.hp,
        maxHp: self.maxHp,
        scene: currentNarration ?? "",
        sameRoundCombat: sameRoundHasCombatAction(combatActions),
        lastSafeRestRound: lastRests[String(self.participantId)] ?? null,
        currentRound: round?.round_number ?? 0,
      });
    })(),
    showRecoveryHint: phase === "ACTION_INPUT" && (round?.round_number ?? 0) <= 2,
  };
}

function resolveCanRerollRoundNumber(
  db: Database.Database,
  opts: {
    campaignId: number;
    hostUserId: number;
    viewerUserId: number;
    campaignStatus: string;
  }
): number | null {
  if (opts.hostUserId !== opts.viewerUserId) return null;
  if (opts.campaignStatus === "CAMPAIGN_COMPLETE") return null;
  const latestGm = db
    .prepare(
      `SELECT r.id, r.round_number, r.phase
       FROM trpg_rounds r
       JOIN trpg_gm_messages g ON g.round_id = r.id
       WHERE r.campaign_id=?
       ORDER BY r.round_number DESC
       LIMIT 1`
    )
    .get(opts.campaignId) as { id: number; round_number: number; phase: string } | undefined;
  if (!latestGm) return null;
  if (asPhase(latestGm.phase) === "GENERATING_NARRATION") return null;
  const laterLocked = db
    .prepare(
      `SELECT 1
       FROM trpg_action_submissions s
       JOIN trpg_rounds r ON r.id = s.round_id
       WHERE r.campaign_id=? AND r.round_number > ? AND s.locked=1
       LIMIT 1`
    )
    .get(opts.campaignId, latestGm.round_number) as { 1: number } | undefined;
  if (laterLocked) return null;
  return latestGm.round_number;
}

function loadLog(
  db: Database.Database,
  campaignId: number,
  viewerParticipantId: number | null,
  billing: {
    viewerUserId: number;
    hostUserId: number;
    mode: TrpgBillingMode;
    humanUserIds: number[];
  }
): TrpgPublicLog[] {
  const rounds = db
    .prepare(
      `SELECT id, round_number, phase, COALESCE(billed,0) AS billed, COALESCE(billed_points,0) AS billed_points,
              billing_breakdown_json
       FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number ASC`
    )
    .all(campaignId) as Array<{
    id: number;
    round_number: number;
    phase: string;
    billed: number;
    billed_points: number;
    billing_breakdown_json?: string | null;
  }>;
  return rounds.map((row) => {
    const gm = db
      .prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`)
      .get(row.id) as { narration: string } | undefined;
    const billedPoints = gm?.narration || row.billed === 1 ? row.billed_points : null;
    const breakdown = parseBillingBreakdown(row.billing_breakdown_json);
    const viewerSharePoints =
      billedPoints == null
        ? null
        : breakdown?.perUserShares.find((share) => share.userId === billing.viewerUserId)?.total ??
          splitTrpgRoundCost({
            totalPoints: billedPoints,
            humanUserIds: billing.humanUserIds,
            hostUserId: billing.hostUserId,
            mode: billing.mode,
          }).find((share) => share.userId === billing.viewerUserId)?.points ??
          0;
    const hint = breakdown?.valuePricingEnabled
      ? "GM/AI 이용료 포함 · 제작자 지원 포함"
      : breakdown
        ? "GM/AI 이용료 포함"
        : undefined;
    return {
      roundNumber: row.round_number,
      rolls: loadRolls(db, row.id),
      narration: gm?.narration ?? null,
      actions: loadActions(db, row.id, viewerParticipantId),
      billedPoints,
      viewerSharePoints,
      humanCount: breakdown?.humanCount,
      botCount: breakdown?.botCount,
      billingHint: hint,
      billingMode: billing.mode,
    };
  });
}
