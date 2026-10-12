import { clipTrpgChars } from "./clip";
import {
  TRPG_LEDGER_ITEM_MAX_CHARS,
  TRPG_LEDGER_QUEST_MAX,
  type TrpgGoalCriterion,
  type TrpgStateDelta,
} from "./types";

export type { TrpgGoalCriterion };

/**
 * Goal state. `trpg_campaign_state.goals_json` is the only owner of goal id/status/criterion/evidence and
 * `campaignLedger` is its only writer. `quests_json` is the active-title projection kept for existing
 * readers; it is never written independently.
 *
 * `completed` is set by the server from a verified fact only. `retired` means the goal left play without
 * credit (GM removal, or removed while an older build ran); it is never read as completion.
 */
export type TrpgGoalStatus = "active" | "completed" | "retired";
export type TrpgGoalSource = "plan" | "gm" | "legacy";

export type TrpgGoalEvidence =
  | { kind: "reach_location"; round: number; participantId: number; location: string }
  | { kind: "end_encounter"; round: number; encounterId: string };

export type TrpgGoal = {
  id: string;
  title: string;
  status: TrpgGoalStatus;
  source: TrpgGoalSource;
  createdRound: number;
  criterion?: TrpgGoalCriterion;
  /** The GM said this goal is resolved. Unverified: it never changes `status`. */
  claimedRound?: number;
  closedRound?: number;
  evidence?: TrpgGoalEvidence;
};

export type TrpgGoalSeatFact = {
  participantId: number;
  human: boolean;
  startLocation: string;
  endLocation: string;
};

/** Server-held facts of the round being committed. */
export type TrpgGoalRoundFacts = {
  round: number;
  seats: readonly TrpgGoalSeatFact[];
  authoredEncounterIds: readonly string[];
  endedEncounterIds: readonly string[];
  acceptedEncounterIds: readonly string[];
};

export type TrpgPublicGoal = {
  id: string;
  title: string;
  status: "active" | "completed";
  claimed: boolean;
};

export const TRPG_GOALS_VERSION = 1;
export const TRPG_GOAL_CLOSED_KEEP = 12;
const TRPG_GOAL_RECENT_DONE_SHOWN = 3;
const CRITERION_PLACE_MAX_CHARS = 80;
const CRITERION_ENCOUNTER_ID_MAX_CHARS = 64;

export type PlaceMatcher = (place: string, location: string) => boolean;

function clipTitle(raw: string): string {
  return clipTrpgChars(raw, TRPG_LEDGER_ITEM_MAX_CHARS);
}

function legacyId(title: string, taken: ReadonlySet<string>): string {
  let hash = 2166136261;
  for (const ch of title) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const base = `legacy-${hash.toString(36)}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

function nextGoalId(goals: readonly TrpgGoal[], round: number): string {
  const prefix = `goal-${round}-`;
  let n = 1;
  for (const goal of goals) {
    if (goal.id.startsWith(prefix)) n += 1;
  }
  let id = `${prefix}${n}`;
  const taken = new Set(goals.map((goal) => goal.id));
  while (taken.has(id)) {
    n += 1;
    id = `${prefix}${n}`;
  }
  return id;
}

export function normalizeGoalCriterion(raw: unknown): TrpgGoalCriterion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type === "reach_location") {
    const place = typeof obj.place === "string" ? clipTrpgChars(obj.place, CRITERION_PLACE_MAX_CHARS) : "";
    return place ? { type: "reach_location", place } : null;
  }
  if (obj.type === "end_encounter") {
    const encounterId =
      typeof obj.encounterId === "string" ? clipTrpgChars(obj.encounterId, CRITERION_ENCOUNTER_ID_MAX_CHARS) : "";
    return encounterId ? { type: "end_encounter", encounterId } : null;
  }
  return null;
}

function parseGoal(raw: unknown): TrpgGoal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const title = typeof obj.title === "string" ? clipTitle(obj.title) : "";
  if (!id || !title) return null;
  const status: TrpgGoalStatus =
    obj.status === "completed" ? "completed" : obj.status === "retired" ? "retired" : "active";
  const source: TrpgGoalSource = obj.source === "plan" ? "plan" : obj.source === "gm" ? "gm" : "legacy";
  const createdRound = Number.isInteger(obj.createdRound) ? (obj.createdRound as number) : 0;
  const goal: TrpgGoal = { id, title, status, source, createdRound };
  const criterion = normalizeGoalCriterion(obj.criterion);
  if (criterion) goal.criterion = criterion;
  if (Number.isInteger(obj.claimedRound)) goal.claimedRound = obj.claimedRound as number;
  if (Number.isInteger(obj.closedRound)) goal.closedRound = obj.closedRound as number;
  const evidence = obj.evidence as Record<string, unknown> | undefined;
  if (status === "completed" && evidence && typeof evidence === "object") {
    if (
      evidence.kind === "reach_location" &&
      Number.isInteger(evidence.round) &&
      Number.isInteger(evidence.participantId) &&
      typeof evidence.location === "string"
    ) {
      goal.evidence = {
        kind: "reach_location",
        round: evidence.round as number,
        participantId: evidence.participantId as number,
        location: evidence.location,
      };
    } else if (
      evidence.kind === "end_encounter" &&
      Number.isInteger(evidence.round) &&
      typeof evidence.encounterId === "string"
    ) {
      goal.evidence = { kind: "end_encounter", round: evidence.round as number, encounterId: evidence.encounterId };
    }
  }
  return goal;
}

/** `null` means "no goal state stored" (legacy row or unreadable value); the caller then lifts `quests_json`. */
export function parseGoalsJson(raw: string | null | undefined): TrpgGoal[] | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.version !== TRPG_GOALS_VERSION || !Array.isArray(obj.goals)) return null;
  const goals: TrpgGoal[] = [];
  const ids = new Set<string>();
  for (const item of obj.goals) {
    const goal = parseGoal(item);
    if (!goal || ids.has(goal.id)) continue;
    ids.add(goal.id);
    goals.push(goal);
  }
  return goals;
}

function pruneClosed(goals: readonly TrpgGoal[]): TrpgGoal[] {
  const closed = goals.filter((goal) => goal.status !== "active");
  if (closed.length <= TRPG_GOAL_CLOSED_KEEP) return [...goals];
  const dropIds = new Set(closed.slice(0, closed.length - TRPG_GOAL_CLOSED_KEEP).map((goal) => goal.id));
  return goals.filter((goal) => !dropIds.has(goal.id));
}

export function serializeGoals(goals: readonly TrpgGoal[]): string {
  return JSON.stringify({ version: TRPG_GOALS_VERSION, goals: pruneClosed(goals) });
}

export function activeGoalTitles(goals: readonly TrpgGoal[]): string[] {
  return goals.filter((goal) => goal.status === "active").map((goal) => goal.title);
}

/**
 * Makes goal state agree with `quests_json`, the only goal data an older build can change.
 * - no stored goal state: every quest string becomes an active goal with no criterion and no evidence;
 * - an active goal whose title an older build removed is retired, never completed;
 * - a quest string no active goal carries (added by an older build) becomes a legacy active goal.
 */
export function reconcileGoals(
  stored: readonly TrpgGoal[] | null | undefined,
  quests: readonly string[],
  round: number
): TrpgGoal[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const raw of quests) {
    const title = clipTitle(raw);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
    if (titles.length >= TRPG_LEDGER_QUEST_MAX) break;
  }
  const goals = (stored ?? []).map((goal) =>
    goal.status === "active" && !seen.has(goal.title)
      ? { ...goal, status: "retired" as const, closedRound: round }
      : goal
  );
  const carried = new Set(goals.filter((goal) => goal.status === "active").map((goal) => goal.title));
  const taken = new Set(goals.map((goal) => goal.id));
  for (const title of titles) {
    if (carried.has(title)) continue;
    const id = legacyId(title, taken);
    taken.add(id);
    goals.push({ id, title, status: "active", source: "legacy", createdRound: round });
  }
  return goals;
}

function criterionIsCheckable(criterion: TrpgGoalCriterion, facts: TrpgGoalRoundFacts, matches: PlaceMatcher): boolean {
  if (criterion.type === "reach_location") {
    return !facts.seats.some((seat) => seat.human && matches(criterion.place, seat.endLocation));
  }
  return (
    facts.authoredEncounterIds.includes(criterion.encounterId) &&
    !facts.endedEncounterIds.includes(criterion.encounterId) &&
    !facts.acceptedEncounterIds.includes(criterion.encounterId)
  );
}

export type TrpgGoalDelta = Pick<TrpgStateDelta, "questsAdd" | "questsRemove" | "questsClaimDone" | "questCriteria">;

/**
 * Same add/remove/dedupe/cap semantics `quests_json` always had (existing first, exact clipped-title removal
 * also blocks a same-delta add, new quests past the cap are dropped), applied to goal records.
 */
export function applyGoalDelta(
  goals: readonly TrpgGoal[],
  delta: TrpgGoalDelta,
  ctx: { round: number; facts?: TrpgGoalRoundFacts; placeMatches: PlaceMatcher }
): TrpgGoal[] {
  const drop = new Set((delta.questsRemove ?? []).map(clipTitle).filter(Boolean));
  const claim = new Set((delta.questsClaimDone ?? []).map(clipTitle).filter(Boolean));
  const next: TrpgGoal[] = goals.map((goal) => {
    if (goal.status !== "active") return goal;
    if (drop.has(goal.title)) return { ...goal, status: "retired" as const, closedRound: ctx.round };
    if (claim.has(goal.title) && goal.claimedRound == null) return { ...goal, claimedRound: ctx.round };
    return goal;
  });
  const criteria = new Map<string, TrpgGoalCriterion>();
  for (const entry of delta.questCriteria ?? []) {
    const title = clipTitle(entry.title);
    if (title && !criteria.has(title)) criteria.set(title, entry.criterion);
  }
  const carried = new Set(next.filter((goal) => goal.status === "active").map((goal) => goal.title));
  let activeCount = carried.size;
  for (const raw of delta.questsAdd ?? []) {
    const title = clipTitle(raw);
    if (!title || drop.has(title) || carried.has(title)) continue;
    if (activeCount >= TRPG_LEDGER_QUEST_MAX) continue;
    carried.add(title);
    activeCount += 1;
    const goal: TrpgGoal = {
      id: nextGoalId(next, ctx.round),
      title,
      status: "active",
      source: "gm",
      createdRound: ctx.round,
    };
    const criterion = criteria.get(title);
    if (criterion && ctx.facts && criterionIsCheckable(criterion, ctx.facts, ctx.placeMatches)) {
      goal.criterion = criterion;
    }
    next.push(goal);
  }
  return next;
}

/** Opening only: the author-written 플레이어 목표 becomes the first goal. Narrative: no criterion. */
export function seedPlanGoal(goals: readonly TrpgGoal[], planGoal: string, round: number): TrpgGoal[] {
  if (goals.some((goal) => goal.source === "plan")) return [...goals];
  const firstSentence = planGoal.trim().split(/(?<=[.!?。…])\s+|\n+/)[0] ?? "";
  const title = clipTitle(firstSentence);
  if (!title) return [...goals];
  if (goals.some((goal) => goal.status === "active" && goal.title === title)) return [...goals];
  if (goals.filter((goal) => goal.status === "active").length >= TRPG_LEDGER_QUEST_MAX) return [...goals];
  return [...goals, { id: nextGoalId(goals, round), title, status: "active", source: "plan", createdRound: round }];
}

/**
 * Server-verified completion. Only a typed criterion checked against server facts of a LATER round than the
 * goal's creation can complete a goal. A GM claim, a removal, a successful roll or an unchanged place never do.
 * - reach_location: a human seat was NOT at the place when the round began and its server-bound location now is.
 * - end_encounter: the server accepted the authored encounter's end this round.
 */
export function completeVerifiedGoals(
  goals: readonly TrpgGoal[],
  facts: TrpgGoalRoundFacts,
  placeMatches: PlaceMatcher
): TrpgGoal[] {
  return goals.map((goal) => {
    if (goal.status !== "active" || !goal.criterion || goal.createdRound >= facts.round) return goal;
    const criterion = goal.criterion;
    if (criterion.type === "reach_location") {
      const arrived = facts.seats.find(
        (seat) =>
          seat.human && !placeMatches(criterion.place, seat.startLocation) && placeMatches(criterion.place, seat.endLocation)
      );
      if (!arrived) return goal;
      return {
        ...goal,
        status: "completed" as const,
        closedRound: facts.round,
        evidence: {
          kind: "reach_location" as const,
          round: facts.round,
          participantId: arrived.participantId,
          location: arrived.endLocation,
        },
      };
    }
    if (!facts.acceptedEncounterIds.includes(criterion.encounterId)) return goal;
    return {
      ...goal,
      status: "completed" as const,
      closedRound: facts.round,
      evidence: { kind: "end_encounter" as const, round: facts.round, encounterId: criterion.encounterId },
    };
  });
}

/** Player-safe projection: no criterion, no evidence, no source. */
export function publicGoals(goals: readonly TrpgGoal[] | undefined): TrpgPublicGoal[] {
  const list = goals ?? [];
  const active = list
    .filter((goal) => goal.status === "active")
    .map((goal) => ({ id: goal.id, title: goal.title, status: "active" as const, claimed: goal.claimedRound != null }));
  const done = list
    .filter((goal) => goal.status === "completed")
    .slice(-TRPG_GOAL_RECENT_DONE_SHOWN)
    .map((goal) => ({ id: goal.id, title: goal.title, status: "completed" as const, claimed: false }));
  return [...active, ...done];
}

/** GM/bot memory lines for goal state that the plain `quests:` projection cannot carry. */
export function goalMemoryLines(goals: readonly TrpgGoal[] | undefined): string[] {
  const list = goals ?? [];
  const done = list
    .filter((goal) => goal.status === "completed")
    .slice(-TRPG_GOAL_RECENT_DONE_SHOWN)
    .map((goal) => goal.title);
  const claimed = list.filter((goal) => goal.status === "active" && goal.claimedRound != null).map((goal) => goal.title);
  return [
    done.length ? `goals_done: ${done.join("; ")}` : "",
    claimed.length ? `goals_claimed_unverified: ${claimed.join("; ")}` : "",
  ].filter(Boolean);
}

export type TrpgGoalTransitionSummary = {
  created: number;
  withCriterion: number;
  completed: string[];
  retired: number;
  activeAfter: number;
};

/** Counts and ids only, for logs. Never titles. */
export function summarizeGoalTransition(
  before: readonly TrpgGoal[] | undefined,
  after: readonly TrpgGoal[],
  round: number
): TrpgGoalTransitionSummary {
  const known = new Map((before ?? []).map((goal) => [goal.id, goal]));
  const created = after.filter((goal) => !known.has(goal.id) && goal.createdRound === round);
  return {
    created: created.length,
    withCriterion: created.filter((goal) => goal.criterion).length,
    completed: after
      .filter((goal) => goal.status === "completed" && known.get(goal.id)?.status !== "completed")
      .map((goal) => goal.id),
    retired: after.filter((goal) => goal.status === "retired" && known.get(goal.id)?.status === "active").length,
    activeAfter: after.filter((goal) => goal.status === "active").length,
  };
}
