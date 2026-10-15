/**
 * Canonical owner of exploration persistence, AP spend, and one-shot reveals.
 * Location, inventory, and flags are written by the existing commit owners;
 * this module only decides the facts those owners receive.
 */
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { loadCampaignLedger } from "./campaignLedger";
import { loadCampaignContext, resolvedCampaignPlan } from "./campaignContext";
import {
  EXPLORATION_ENTRANCE,
  composeExplorationSentences,
  emptyExplorationState,
  formatExplorationGmBlock,
  parseExplorationState,
  projectPublicExploration,
  settleExplorationActor,
  spendExplorationAp,
  type ExplorationActorResult,
  type ExplorationState,
} from "./explorationMap";
import { parseExplorationCommands, type ExplorationCommand, type PublicExploration } from "./explorationPublic";

export function loadExplorationState(db: Database.Database, campaignId: number): ExplorationState | null {
  const row = db
    .prepare(`SELECT exploration_json FROM trpg_campaign_context WHERE campaign_id=?`)
    .get(campaignId) as { exploration_json?: string | null } | undefined;
  if (!row?.exploration_json) return null;
  return parseExplorationState(row.exploration_json);
}

export function saveExplorationState(db: Database.Database, campaignId: number, state: ExplorationState): void {
  db.prepare(`UPDATE trpg_campaign_context SET exploration_json=?, updated_at=datetime('now') WHERE campaign_id=?`).run(
    JSON.stringify(state),
    campaignId
  );
}

export function ensureExplorationMap(db: Database.Database, campaignId: number): void {
  const existing = db
    .prepare(`SELECT exploration_json FROM trpg_campaign_context WHERE campaign_id=?`)
    .get(campaignId) as { exploration_json?: string | null } | undefined;
  if (!existing) return;
  if (existing.exploration_json) return;
  const plan = resolvedCampaignPlan(loadCampaignContext(db, campaignId));
  if (plan?.exploration !== true) return;
  const seed = randomBytes(8).toString("hex");
  saveExplorationState(db, campaignId, emptyExplorationState(seed));
}

function sheetLocation(db: Database.Database, participantId: number): string {
  const row = db
    .prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`)
    .get(participantId) as { location?: string | null } | undefined;
  return row?.location?.trim() ?? "";
}

function roundNumberOf(db: Database.Database, roundId: number): number {
  const row = db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { round_number: number }
    | undefined;
  return row?.round_number ?? 0;
}

export function prepareLockedExploration(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    participantId: number;
    commands: readonly ExplorationCommand[];
    freeText: string;
  }
): { body: string; actionType: "free" | "investigate"; state: ExplorationState } {
  const state = loadExplorationState(db, opts.campaignId);
  if (!state) throw new Error("탐험 지도가 없습니다.");
  const fromRoomId = sheetLocation(db, opts.participantId);
  const roundNumber = roundNumberOf(db, opts.roundId);
  const next = spendExplorationAp({
    state,
    participantId: opts.participantId,
    roundNumber,
    roundId: opts.roundId,
    fromRoomId,
    commands: opts.commands,
  });
  const sentences = composeExplorationSentences(state.map, fromRoomId, opts.commands);
  const body = [sentences, opts.freeText.trim()].filter(Boolean).join(" ");
  const actionType = opts.commands.some((command) => command.op === "search") ? "investigate" : "free";
  return { body, actionType, state: next };
}

export type ExplorationCommitAdjustment = {
  openingLocation: string | null;
  results: ExplorationActorResult[];
  state: ExplorationState;
};

export function planExplorationCommit(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    opening: boolean;
    actors: ReadonlyArray<{ participantId: number; name: string; tier: string | null }>;
    sheetIds: readonly number[];
  }
): ExplorationCommitAdjustment | null {
  const state = loadExplorationState(db, opts.campaignId);
  if (!state) return null;
  if (opts.opening) {
    return { openingLocation: EXPLORATION_ENTRANCE, results: [], state };
  }
  const names = new Map(opts.actors.map((actor) => [actor.participantId, actor.name]));
  const tiers = new Map(opts.actors.map((actor) => [actor.participantId, actor.tier]));
  let current = state;
  const results: ExplorationActorResult[] = [];
  const pending = current.pending
    .filter((row) => row.roundId === opts.roundId)
    .sort((a, b) => a.participantId - b.participantId);
  for (const row of pending) {
    const settled = settleExplorationActor({
      state: current,
      pending: row,
      name: names.get(row.participantId) ?? `participant ${row.participantId}`,
      tier: tiers.get(row.participantId) ?? null,
    });
    current = settled.state;
    if (settled.result.lines.length || settled.result.location || settled.result.items.length || settled.result.flags.length) {
      results.push(settled.result);
    }
  }
  if (!results.length && current === state) return null;
  return { openingLocation: null, results, state: current };
}

function loadExplorationSeats(
  db: Database.Database,
  campaignId: number
): Array<{ participantId: number; name: string; location: string }> {
  return db
    .prepare(
      `SELECT p.id AS participantId, s.name, s.location
       FROM trpg_character_sheets s
       JOIN trpg_participants p ON p.id = s.participant_id
       WHERE s.campaign_id=?
       ORDER BY p.slot_index ASC`
    )
    .all(campaignId) as Array<{ participantId: number; name: string; location: string }>;
}

export function explorationPromptForRound(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    opening: boolean;
    actors: ReadonlyArray<{ participantId: number; name: string; tier: string | null }>;
  }
): string {
  const state = loadExplorationState(db, opts.campaignId);
  if (!state) return "";
  const commit = opts.opening
    ? null
    : planExplorationCommit(db, {
        campaignId: opts.campaignId,
        roundId: opts.roundId,
        opening: false,
        actors: opts.actors,
        sheetIds: [],
      });
  const endById = new Map(
    (commit?.results ?? [])
      .filter((result) => result.location)
      .map((result) => [result.participantId, result.location as string])
  );
  const seats = loadExplorationSeats(db, opts.campaignId).map((seat) => {
    const start = opts.opening ? EXPLORATION_ENTRANCE : seat.location.trim() || EXPLORATION_ENTRANCE;
    return {
      name: seat.name,
      start,
      end: opts.opening ? EXPLORATION_ENTRANCE : (endById.get(seat.participantId) ?? start),
    };
  });
  return formatExplorationGmBlock({
    opening: opts.opening,
    seats,
    resultLines: commit?.results.flatMap((result) => result.lines) ?? [],
    alarm: commit?.state.alarmFlagged ?? state.alarmFlagged,
    risk: commit?.state.risk ?? state.risk,
    flags: [
      ...new Set([
        ...loadCampaignLedger(db, opts.campaignId).worldFlags,
        ...(commit?.results.flatMap((result) => result.flags) ?? []),
      ]),
    ],
  });
}

export function projectExplorationForViewer(
  db: Database.Database,
  opts: {
    campaignId: number;
    viewerParticipantId: number | null;
    viewerLocation: string;
    roundNumber: number;
  }
): PublicExploration | null {
  const state = loadExplorationState(db, opts.campaignId);
  if (!state) return null;
  return projectPublicExploration({
    state,
    viewerParticipantId: opts.viewerParticipantId,
    viewerLocation: opts.viewerLocation,
    roundNumber: opts.roundNumber,
  });
}

export function readExplorationCommands(raw: unknown): ExplorationCommand[] {
  return parseExplorationCommands(raw);
}
