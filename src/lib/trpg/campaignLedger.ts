import type Database from "better-sqlite3";
import { tokenizeSceneLabel } from "./actionCheckContext";
import {
  DIRECTIONAL_QUALIFIERS,
  declaredMovementGoals,
  describeMovementGoal,
  isPlacePartWord,
  spatialPolarity,
} from "./movementDeclaration";
import {
  activeGoalTitles,
  applyGoalDelta,
  completeVerifiedGoals,
  parseGoalsJson,
  reconcileGoals,
  seedPlanGoal,
  serializeGoals,
  type TrpgGoal,
  type TrpgGoalRoundFacts,
} from "./campaignGoals";
import { clipTrpgChars } from "./clip";
import { parseJson } from "./store";
import {
  TRPG_LEDGER_FLAG_MAX,
  TRPG_LEDGER_ITEM_MAX_CHARS,
  TRPG_LEDGER_NPC_MAX,
  TRPG_LEDGER_QUEST_MAX,
  TRPG_NEXT_ROUND_CONTEXT_MAX_CHARS,
  type TrpgStateDelta,
} from "./types";

export { clipTrpgChars };

export type TrpgCampaignLedger = {
  location: string;
  nextRoundContext: string;
  /** Active goal titles. Projection of `goals`; never written on its own. */
  quests: string[];
  goals: TrpgGoal[];
  npcs: string[];
  worldFlags: string[];
};

function clipItem(raw: string): string {
  return clipTrpgChars(raw, TRPG_LEDGER_ITEM_MAX_CHARS);
}

function mergeFactsCounted(
  current: string[],
  add: string[] | undefined,
  remove: string[] | undefined,
  maxItems: number
): { next: string[]; overflow: number } {
  const drop = new Set((remove ?? []).map(clipItem).filter(Boolean));
  const next: string[] = [];
  const seen = new Set<string>();
  let overflow = 0;
  const addStart = current.length;
  [...current, ...(add ?? [])].forEach((item, index) => {
    const t = clipItem(item);
    if (!t || drop.has(t) || seen.has(t)) return;
    seen.add(t);
    if (next.length < maxItems) next.push(t);
    else if (index >= addStart) overflow += 1;
  });
  return { next, overflow };
}

function mergeFacts(current: string[], add: string[] | undefined, remove: string[] | undefined, maxItems: number): string[] {
  return mergeFactsCounted(current, add, remove, maxItems).next;
}

/** How many new quests `applyCampaignLedger` will drop only because the ledger is at its quest cap. */
export function countQuestAddsOverCap(
  current: TrpgCampaignLedger,
  delta: Pick<TrpgStateDelta, "questsAdd" | "questsRemove">
): number {
  return mergeFactsCounted(current.quests, delta.questsAdd, delta.questsRemove, TRPG_LEDGER_QUEST_MAX).overflow;
}

export function emptyCampaignLedger(): TrpgCampaignLedger {
  return { location: "", nextRoundContext: "", quests: [], goals: [], npcs: [], worldFlags: [] };
}

export type TrpgLocationPersistSubmission = {
  participantId: number;
  body: string;
  tier?: string | null;
  acceptedRoute?: string | null;
};

export type TrpgLocationPersistSheet = {
  participantId: number;
  location: string;
};

/** Interior/exterior suffixes refine a named place; they are not the place. */
const INTERIOR_SUFFIXES = new Set(["내부", "안쪽", "바깥", "바깥쪽", "속", "실내", "실외"]);

function tokenCoversPlace(token: string, place: string): boolean {
  return token === place || token.startsWith(place);
}

function precedingQualifier(tokens: readonly string[], place: string): string | undefined {
  const index = tokens.findIndex((token) => tokenCoversPlace(token, place));
  return index > 0 ? tokens[index - 1] : undefined;
}

function scenePlaceToken(tokens: readonly string[]): string | undefined {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token && !INTERIOR_SUFFIXES.has(token)) return token;
  }
  return undefined;
}

function destCoreLength(tokens: readonly string[]): number {
  return tokens.filter((token) => !INTERIOR_SUFFIXES.has(token)).length;
}

/** Opposite directions always conflict, even when dest adds parent-location tokens. */
function qualifiersConflict(
  sourceQualifier: string | undefined,
  destTokens: readonly string[],
  place: string
): boolean {
  const destQualifier = precedingQualifier(destTokens, place);
  if (!destQualifier || !sourceQualifier) return false;
  if (
    destQualifier === sourceQualifier ||
    destQualifier.startsWith(sourceQualifier) ||
    sourceQualifier.startsWith(destQualifier)
  ) {
    return false;
  }
  const bothDirectional =
    DIRECTIONAL_QUALIFIERS.has(destQualifier) && DIRECTIONAL_QUALIFIERS.has(sourceQualifier);
  // Bare dest (qualifier + place) is a sibling swap. Extra parent tokens may
  // refine the same place. Opposite directions always conflict.
  return bothDirectional || destCoreLength(destTokens) <= 2;
}

/**
 * Presence matcher: `destination` is the same place as `source`, possibly with extra
 * parent-location tokens or an interior suffix. Encounter strikes and encounter endings use it to
 * decide who stands in an approved threat's place, so it stays strict and is NOT the movement
 * authorization matcher (see `movementGoalNamesDestination`).
 */
export function destinationRefinesDeclared(source: string, destination: string): boolean {
  const dest = destination.trim();
  if (!dest) return false;
  const destTokens = tokenizeSceneLabel(dest);
  const place = scenePlaceToken(destTokens);
  if (!place) return false;
  const sourceTokens = tokenizeSceneLabel(source);
  if (!sourceTokens.some((token) => tokenCoversPlace(token, place))) return false;
  if (qualifiersConflict(precedingQualifier(sourceTokens, place), destTokens, place)) return false;
  return true;
}

function movementAttemptFailed(tier: string | null | undefined): boolean {
  switch (tier) {
    case "CRITICAL_FAILURE":
    case "SEVERE_FAILURE":
    case "FAILURE":
      return true;
    default:
      return false;
  }
}

/**
 * Movement matcher: the GM-proposed `destination` is the place a player declared as the goal of a
 * motion. Identity is the declared place name as a whole label token: the label may add parent tokens
 * before it (등대 → 곶 끝의 등대) and only structural sub-area tokens after it (외곽, 내부, 2층, 청사),
 * never another noun (등대 마을, 등대 선술집). It never crosses an explicit inside/outside boundary the
 * player declared (세관 앞 → 세관 내부), nor a conflicting qualifier (북쪽 창고 → 남쪽 창고).
 */
export function movementGoalNamesDestination(goalPhrase: string, destination: string): boolean {
  const goal = describeMovementGoal(goalPhrase);
  if (!goal.place) return false;
  const destTokens = tokenizeSceneLabel(destination);
  const place = goal.place;
  const isTheNamedPlace = destTokens.some(
    (token, index) => token === place && destTokens.slice(index + 1).every(isPlacePartWord)
  );
  if (!isTheNamedPlace) return false;
  const destPolarity = spatialPolarity(destination.split(/\s+/));
  if (goal.polarity && destPolarity && goal.polarity !== destPolarity) return false;
  return !qualifiersConflict(goal.qualifier, destTokens, place);
}

/** True when this locked action already authorizes relocating to `destination`. */
export function submissionAuthorizesLocation(
  submission: TrpgLocationPersistSubmission,
  destination: string
): boolean {
  const dest = destination.trim();
  if (!dest) return false;
  if (movementAttemptFailed(submission.tier)) return false;
  const declaredGoals = [
    ...(submission.acceptedRoute ? [submission.acceptedRoute] : []),
    ...declaredMovementGoals(submission.body),
  ];
  return declaredGoals.some((goal) => movementGoalNamesDestination(goal, dest));
}

/**
 * Location persist bind — campaignLedger owner.
 * Opening may set the starting place. After that, a GM location change sticks
 * only when that participant has a server-confirmed dest: the frozen
 * acceptedRoute label or a goal-marked place in a live motion clause of that
 * participant's own submission (`movementGoalNamesDestination`), and not a
 * failure tier. Compare each sheet's previous location, not the shared ledger.
 * World-forced relocation has no separate persist owner today (T9/L5).
 *
 * The next-round hook is free GM text that may assert where people are. It is stored verbatim only
 * when every place the GM claimed was approved: no seat's claimed place was refused or replaced,
 * and, when the campaign place moved, the move was authorized and every seat ended at it. Otherwise
 * it is cleared (never replaced by an older round's hook). The facts of that round are not lost: they
 * travel through the typed delta (quests / npcs / flags) and the round narration, which this binder
 * does not touch. No sentence of the hook is parsed.
 */
export function bindGmLocationToSubmittedMovement(opts: {
  opening: boolean;
  currentLocation: string;
  proposedLocation: string;
  delta: TrpgStateDelta;
  submissions: readonly TrpgLocationPersistSubmission[];
  sheetLocations?: readonly TrpgLocationPersistSheet[];
}): { location: string; nextRoundContext: string | undefined; delta: TrpgStateDelta } {
  if (opts.opening) {
    return {
      location: opts.proposedLocation.trim() || opts.currentLocation,
      nextRoundContext: opts.delta.nextRoundContext,
      delta: opts.delta,
    };
  }
  const current = opts.currentLocation.trim();
  const proposed = opts.proposedLocation.trim();
  const sheetById = new Map(
    (opts.sheetLocations ?? []).map((row) => [row.participantId, row.location.trim()])
  );
  const previousLocation = (participantId: number) => sheetById.get(participantId) || current;
  const byParticipant = new Map(opts.submissions.map((sub) => [sub.participantId, sub]));
  let refusedSeatPlace = false;
  const players: NonNullable<TrpgStateDelta["players"]> = (opts.delta.players ?? []).map((patch) => {
    if (patch.location == null) return patch;
    const dest = patch.location.trim();
    const previous = previousLocation(patch.participantId);
    if (!dest || dest === previous) return patch;
    const sub = byParticipant.get(patch.participantId);
    if (sub && submissionAuthorizesLocation(sub, dest)) return patch;
    refusedSeatPlace = true;
    if (sub && proposed && proposed !== dest && submissionAuthorizesLocation(sub, proposed)) {
      return { ...patch, location: proposed };
    }
    const { location: _dropped, ...rest } = patch;
    return rest;
  });
  const campaignMoved = Boolean(proposed && proposed !== current);
  const campaignAuthorized =
    campaignMoved && opts.submissions.some((sub) => submissionAuthorizesLocation(sub, proposed));
  const location = campaignAuthorized ? proposed : current;
  const seatIds = new Set([
    ...sheetById.keys(),
    ...byParticipant.keys(),
    ...players.map((patch) => patch.participantId),
  ]);
  const everySeatAtLedgerPlace = [...seatIds].every((participantId) => {
    const patch = players.find((row) => row.participantId === participantId);
    return (patch?.location?.trim() || previousLocation(participantId)) === location;
  });
  const hookAssertsApprovedPlaces =
    !refusedSeatPlace && (campaignMoved ? campaignAuthorized && everySeatAtLedgerPlace : true);
  return {
    location,
    nextRoundContext: hookAssertsApprovedPlaces ? opts.delta.nextRoundContext : "",
    delta: { ...opts.delta, players },
  };
}

export type TrpgLedgerGoalContext = {
  round: number;
  /** Absent: typed criteria cannot be checked, so none is attached and nothing completes. */
  facts?: TrpgGoalRoundFacts;
  /** Opening only: the scenario's author-written player goal. */
  planGoal?: string;
};

export function applyCampaignLedger(
  current: TrpgCampaignLedger,
  delta: TrpgStateDelta,
  goalContext: TrpgLedgerGoalContext = { round: 0 }
): TrpgCampaignLedger {
  const location = (delta.location ?? current.location).trim();
  const nextRoundContext =
    delta.nextRoundContext != null
      ? clipTrpgChars(delta.nextRoundContext, TRPG_NEXT_ROUND_CONTEXT_MAX_CHARS)
      : current.nextRoundContext;
  const { round, facts } = goalContext;
  let goals = reconcileGoals(current.goals, current.quests, round);
  if (goalContext.planGoal) goals = seedPlanGoal(goals, goalContext.planGoal, round);
  goals = applyGoalDelta(goals, delta, { round, facts, placeMatches: destinationRefinesDeclared });
  if (facts) goals = completeVerifiedGoals(goals, facts, destinationRefinesDeclared);
  return {
    location,
    nextRoundContext,
    quests: activeGoalTitles(goals),
    goals,
    npcs: mergeFacts(current.npcs, delta.npcsAdd, delta.npcsRemove, TRPG_LEDGER_NPC_MAX),
    worldFlags: mergeFacts(current.worldFlags, delta.flagsAdd, delta.flagsRemove, TRPG_LEDGER_FLAG_MAX),
  };
}

export function loadCampaignLedger(db: Database.Database, campaignId: number): TrpgCampaignLedger {
  const row = db
    .prepare(
      `SELECT location, quests_json, goals_json, npcs_json, world_flags_json, next_round_context, round_number
       FROM trpg_campaign_state WHERE campaign_id=?`
    )
    .get(campaignId) as
    | {
        location: string;
        quests_json: string;
        goals_json?: string | null;
        round_number?: number | null;
        npcs_json: string;
        world_flags_json: string;
        next_round_context?: string | null;
      }
    | undefined;
  if (!row) return emptyCampaignLedger();
  const goals = reconcileGoals(
    parseGoalsJson(row.goals_json),
    parseJson(row.quests_json, [] as string[]),
    row.round_number ?? 0
  );
  return {
    location: row.location ?? "",
    nextRoundContext: row.next_round_context ?? "",
    quests: activeGoalTitles(goals),
    goals,
    npcs: parseJson(row.npcs_json, [] as string[]),
    worldFlags: parseJson(row.world_flags_json, [] as string[]),
  };
}

/**
 * Scene location metadata for one round. Records the already-bound campaign
 * place only when every persisted sheet agrees. Split-party or empty campaign
 * place is omitted — this does not re-authorize movement.
 */
export function acceptedSceneLocationFromBoundState(opts: {
  campaignLocation: string;
  sheetLocations: readonly string[];
}): string | null {
  const campaign = opts.campaignLocation.trim();
  if (!campaign) return null;
  for (const loc of opts.sheetLocations) {
    const sheet = loc.trim();
    if (sheet && sheet !== campaign) return null;
  }
  return campaign;
}

/** First commit only. NULL stays NULL (legacy / ambiguous / regenerate). */
export function persistAcceptedRoundLocationIfAbsent(
  db: Database.Database,
  roundId: number,
  location: string | null
): void {
  const accepted = location?.trim() ?? "";
  if (!accepted) return;
  db.prepare(
    `UPDATE trpg_rounds SET accepted_location=? WHERE id=? AND accepted_location IS NULL`
  ).run(accepted, roundId);
}

export function loadAcceptedRoundLocation(
  db: Database.Database,
  roundId: number
): string | null {
  const row = db
    .prepare(`SELECT accepted_location FROM trpg_rounds WHERE id=?`)
    .get(roundId) as { accepted_location: string | null } | undefined;
  const value = row?.accepted_location?.trim() ?? "";
  return value || null;
}

export function persistCampaignLedger(
  db: Database.Database,
  campaignId: number,
  roundNumber: number,
  ledger: TrpgCampaignLedger
): void {
  const goals = reconcileGoals(ledger.goals, ledger.quests, roundNumber);
  db.prepare(
    `UPDATE trpg_campaign_state
     SET location=?, quests_json=?, goals_json=?, npcs_json=?, world_flags_json=?, next_round_context=?,
         round_number=?, updated_at=datetime('now')
     WHERE campaign_id=?`
  ).run(
    ledger.location,
    JSON.stringify(activeGoalTitles(goals)),
    serializeGoals(goals),
    JSON.stringify(ledger.npcs),
    JSON.stringify(ledger.worldFlags),
    ledger.nextRoundContext,
    roundNumber,
    campaignId
  );
}
