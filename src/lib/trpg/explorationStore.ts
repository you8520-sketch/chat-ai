/**
 * Canonical owner of exploration persistence, AP spend, and one-shot reveals.
 * Location, inventory, and flags are written by the existing commit owners;
 * this module only decides the facts those owners receive.
 */
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { adventureHasMap, evaluateAdventure, TrpgAdventureCanonError } from "./adventure";
import { loadCampaignLedger } from "./campaignLedger";
import { parseTrpgScenarioPlan } from "./scenarioPlan";
import {
  adventureExplorationState,
  canonicalRoomId,
  composeExplorationSentences,
  displayExplorationAp,
  emptyExplorationState,
  explorationDiscoveries,
  explorationHasMap,
  explorationOwnsWorldFlags,
  explorationRoomFacts,
  explorationStartName,
  formatExplorationBotBrief,
  formatExplorationGmBlock,
  legalExplorationMovePlans,
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

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The campaign's frozen plan, raw, with the same precedence as `resolvedCampaignPlan`:
 * the director plan copied at start, else the scenario snapshot. Raw so an adventure the
 * lenient reader dropped is reported instead of silently becoming "no map".
 */
function frozenCampaignPlan(
  row: { director_plan_json?: string | null; scenario_snapshot_json?: string | null }
): Record<string, unknown> | null {
  const director = parseJsonObject(row.director_plan_json);
  if (director && parseTrpgScenarioPlan(director)) return director;
  const snapshot = parseJsonObject(row.scenario_snapshot_json);
  const plan = snapshot?.plan;
  return plan && typeof plan === "object" && !Array.isArray(plan) ? (plan as Record<string, unknown>) : null;
}

/**
 * Builds the campaign's exploration state once from the frozen plan. A multi-place adventure
 * compiles to a v2 map; a single place with events compiles to a one-room v2 state, so its
 * events run through the same search and commit owners without a map. A single place without
 * events, or no adventure, means no state. Only a legacy `exploration: true` plan without an
 * adventure still gets the v1 facility map. Template edits never reach a started campaign
 * because both the plan copy and this state are written once.
 */
export function ensureExplorationMap(db: Database.Database, campaignId: number): void {
  const existing = db
    .prepare(`SELECT exploration_json, director_plan_json, scenario_snapshot_json FROM trpg_campaign_context WHERE campaign_id=?`)
    .get(campaignId) as
    | { exploration_json?: string | null; director_plan_json?: string | null; scenario_snapshot_json?: string | null }
    | undefined;
  if (!existing) return;
  if (existing.exploration_json) return;
  const plan = frozenCampaignPlan(existing);
  if (!plan) return;
  const seed = randomBytes(8).toString("hex");
  if (plan.adventure != null) {
    const { adventure, issues } = evaluateAdventure(plan.adventure);
    if (!adventure) throw new TrpgAdventureCanonError(issues);
    if (adventure.events.length > 0 || adventureHasMap(adventure)) {
      saveExplorationState(db, campaignId, adventureExplorationState(adventure, seed));
    }
    return;
  }
  if (plan.exploration !== true) return;
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
  const location = sheetLocation(db, opts.participantId);
  const fromRoomId = canonicalRoomId(state.map, location) ?? location;
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
  /** v1 only: the result flags are server-owned ledger flags. */
  ownsWorldFlags: boolean;
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
  const ownsWorldFlags = explorationOwnsWorldFlags(state);
  if (opts.opening) {
    return { openingLocation: explorationStartName(state), results: [], state, ownsWorldFlags };
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
  return { openingLocation: null, results, state: current, ownsWorldFlags };
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
  const settled = commit?.state ?? state;
  const startName = explorationStartName(state);
  const seats = loadExplorationSeats(db, opts.campaignId).map((seat) => {
    const start = opts.opening ? startName : seat.location.trim() || startName;
    const end = opts.opening ? startName : (endById.get(seat.participantId) ?? start);
    const facts = explorationRoomFacts(settled, end);
    return { name: seat.name, start, end, exits: facts.exits, lockedExits: facts.lockedExits, summary: facts.summary };
  });
  const legacy = explorationOwnsWorldFlags(state)
    ? {
        alarm: settled.alarmFlagged,
        risk: settled.risk,
        flags: [
          ...new Set([
            ...loadCampaignLedger(db, opts.campaignId).worldFlags,
            ...(commit?.results.flatMap((result) => result.flags) ?? []),
          ]),
        ],
      }
    : undefined;
  return formatExplorationGmBlock({
    opening: opts.opening,
    startName,
    seats,
    resultLines: commit?.results.flatMap((result) => result.lines) ?? [],
    discoveries: legacy ? undefined : explorationDiscoveries(state),
    legacy,
  });
}

/** The companion's map facts, from the same room projection the GM block uses. */
export function explorationBriefForBot(
  db: Database.Database,
  opts: { campaignId: number; participantId: number; roundNumber: number }
): string {
  const state = loadExplorationState(db, opts.campaignId);
  if (!state) return "";
  const seats = loadExplorationSeats(db, opts.campaignId);
  const self = seats.find((seat) => seat.participantId === opts.participantId);
  if (!self) return "";
  const startName = explorationStartName(state);
  const facts = explorationRoomFacts(state, self.location.trim() || startName);
  const legacy = explorationOwnsWorldFlags(state);
  const ap = displayExplorationAp(state, opts.participantId, opts.roundNumber);
  return formatExplorationBotBrief({
    roomId: self.location,
    startName,
    neighbors: facts.exits,
    lockedExits: legacy ? undefined : facts.lockedExits,
    summary: facts.summary,
    discoveries: legacy ? undefined : explorationDiscoveries(state),
    ap,
    party: seats.map((seat) => ({ name: seat.name, location: seat.location })),
    legacy: legacy ? { alarm: state.alarmFlagged } : undefined,
    movePlans: explorationHasMap(state.map)
      ? legalExplorationMovePlans({
          state,
          fromRoomId: self.location.trim() || startName,
          apRemaining: ap,
        })
      : undefined,
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
