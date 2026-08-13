import type Database from "better-sqlite3";
import { isTrpgActionType, type TrpgActionType } from "./actionTypes";
import { loadSheetSnapshots } from "./engineSheets";
import { nextTrpgRoundWork, type TrpgRoundWork } from "./roundLock";
import { buildPartySheetHud } from "./sheetView";
import { DEFAULT_TRPG_SHEET_WIDGET } from "./defaultSheet";
import { loadTrpgPartyChat } from "./partyChat";
import { trpgInvitePath } from "./invite";
import { parseHumanPersona } from "./hostPersona";
import {
  loadCampaign,
  loadLatestRound,
  loadParticipants,
  loadScenario,
  parseJson,
  type TrpgParticipantRow,
} from "./store";
import { purgeUnstartedSoloDrafts } from "./engineDelete";
import {
  isListedTrpgCampaign,
  type TrpgCampaignSnapshot,
  type TrpgPublicLog,
  type TrpgPublicParticipant,
  type TrpgPublicRoll,
  type TrpgReadyState,
} from "./snapshot";
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

function sheetConfirmed(revision: number | undefined, isBot: boolean): boolean {
  if (revision == null) return false;
  return isBot ? revision >= 1 : true;
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

function revealOthers(phase: TrpgRoundPhase | "NONE"): boolean {
  return phase !== "ACTION_INPUT" && phase !== "BOT_ACTION" && phase !== "NONE";
}

function loadRolls(db: Database.Database, roundId: number): TrpgPublicRoll[] {
  return (
    db
      .prepare(
        `SELECT r.d20, r.stat_key, r.final_score, r.dc, r.tier, s.participant_id, p.display_name AS name
         FROM trpg_dice_rolls r
         JOIN trpg_action_submissions s ON s.id = r.submission_id
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE r.round_id=?`
      )
      .all(roundId) as Array<{
      d20: number;
      stat_key: string;
      final_score: number;
      dc: number;
      tier: string;
      participant_id: number;
      name: string;
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
    };
  });
}

function loadActions(
  db: Database.Database,
  roundId: number,
  viewerParticipantId: number | null,
  revealed: boolean
): Array<{ participantId: number; name: string; body: string; revealed: boolean }> {
  return (
    db
      .prepare(
        `SELECT s.participant_id, p.display_name AS name, s.body, s.locked
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE s.round_id=?`
      )
      .all(roundId) as Array<{ participant_id: number; name: string; body: string; locked: number }>
  ).map((row) => {
    const show = revealed || row.participant_id === viewerParticipantId;
    return {
      participantId: row.participant_id,
      name: row.name,
      body: show ? row.body : "",
      revealed: show,
    };
  });
}

export function listTrpgCampaigns(db: Database.Database, userId: number): TrpgCampaignSnapshot[] {
  purgeUnstartedSoloDrafts(db, userId);
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
  if (currentRolls.length === 0 && round && round.round_number > 0) {
    const prevId = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`)
      .get(campaignId, round.round_number - 1) as { id: number } | undefined;
    if (prevId) currentRolls.push(...loadRolls(db, prevId.id));
  }
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
    sheetConfirmed: sheetConfirmed(revisions.get(p.id), p.kind === "ai_character"),
  }));

  const log = loadLog(db, campaignId, viewer?.id ?? null);
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
    billingMode: (campaign.billing_mode as TrpgBillingMode) || DEFAULT_TRPG_BILLING_MODE,
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
    currentNarration,
    log,
    workType: work.type,
    lastBilledPoints: lastBilled?.billed_points ?? null,
    gmGrossMargin: TRPG_GM_GROSS_MARGIN,
    botGrossMargin: TRPG_BOT_GROSS_MARGIN,
    partyChat: opts?.includePartyChat === false ? [] : loadTrpgPartyChat(db, campaignId, viewerUserId),
  };
}


function loadLog(
  db: Database.Database,
  campaignId: number,
  viewerParticipantId: number | null
): TrpgPublicLog[] {
  const rounds = db
    .prepare(
      `SELECT id, round_number, phase FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number ASC`
    )
    .all(campaignId) as Array<{ id: number; round_number: number; phase: string }>;
  return rounds.map((row) => {
    const phase = asPhase(row.phase);
    const gm = db
      .prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`)
      .get(row.id) as { narration: string } | undefined;
    return {
      roundNumber: row.round_number,
      rolls: loadRolls(db, row.id),
      narration: gm?.narration ?? null,
      actions: loadActions(db, row.id, viewerParticipantId, revealOthers(phase) || phase === "ROUND_COMPLETE"),
    };
  });
}
