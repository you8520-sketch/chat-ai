import type Database from "better-sqlite3";
import { actionReferencesOpenRoute, declaresTraversalIntent, tokenizeSceneLabel } from "./actionCheckContext";
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
  quests: string[];
  npcs: string[];
  worldFlags: string[];
};

function clipItem(raw: string): string {
  return clipTrpgChars(raw, TRPG_LEDGER_ITEM_MAX_CHARS);
}

function mergeFacts(current: string[], add: string[] | undefined, remove: string[] | undefined, maxItems: number): string[] {
  const drop = new Set((remove ?? []).map(clipItem).filter(Boolean));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of [...current, ...(add ?? [])]) {
    const t = clipItem(item);
    if (!t || drop.has(t) || seen.has(t)) continue;
    seen.add(t);
    next.push(t);
    if (next.length >= maxItems) break;
  }
  return next;
}

export function emptyCampaignLedger(): TrpgCampaignLedger {
  return { location: "", nextRoundContext: "", quests: [], npcs: [], worldFlags: [] };
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

function tokenCoversPlace(token: string, place: string): boolean {
  return token === place || token.startsWith(place);
}

function precedingQualifier(tokens: readonly string[], place: string): string | undefined {
  const index = tokens.findIndex((token) => tokenCoversPlace(token, place));
  return index > 0 ? tokens[index - 1] : undefined;
}

function destinationMatchesDeclared(source: string, destination: string): boolean {
  const dest = destination.trim();
  if (!dest) return false;
  if (actionReferencesOpenRoute(source, [dest]) != null) return true;
  const destTokens = tokenizeSceneLabel(dest);
  const place = destTokens.at(-1);
  if (!place) return false;
  const sourceTokens = tokenizeSceneLabel(source);
  if (!sourceTokens.some((token) => tokenCoversPlace(token, place))) return false;
  const destQualifier = precedingQualifier(destTokens, place);
  const sourceQualifier = precedingQualifier(sourceTokens, place);
  if (
    destQualifier &&
    sourceQualifier &&
    destQualifier !== sourceQualifier &&
    !destQualifier.startsWith(sourceQualifier) &&
    !sourceQualifier.startsWith(destQualifier)
  ) {
    return false;
  }
  return true;
}

function sameSceneLabel(left: string, right: string): boolean {
  const a = tokenizeSceneLabel(left);
  const b = tokenizeSceneLabel(right);
  return a.length > 0 && a.length === b.length && a.every((token, index) => token === b[index]);
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

/** True when this locked action already authorizes relocating to `destination`. */
export function submissionAuthorizesLocation(
  submission: TrpgLocationPersistSubmission,
  destination: string
): boolean {
  const dest = destination.trim();
  if (!dest) return false;
  if (movementAttemptFailed(submission.tier)) return false;
  if (submission.acceptedRoute) {
    return sameSceneLabel(submission.acceptedRoute, dest);
  }
  if (!destinationMatchesDeclared(submission.body, dest)) return false;
  return declaresTraversalIntent(submission.body);
}

/**
 * Location persist bind — campaignLedger owner.
 * Opening may set the starting place. After that, a GM location change sticks
 * only when that participant has a server-confirmed dest: the frozen
 * acceptedRoute label, or a declared traversal whose body names that dest,
 * and not a failure tier. Compare each sheet's previous location, not the
 * shared ledger. World-forced relocation has no separate persist owner today
 * (T9/L5).
 */
export function bindGmLocationToSubmittedMovement(opts: {
  opening: boolean;
  currentLocation: string;
  currentNextRoundContext: string;
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
  const players = (opts.delta.players ?? []).map((patch) => {
    if (patch.location == null) return patch;
    const dest = patch.location.trim();
    const previous = previousLocation(patch.participantId);
    if (!dest || dest === previous) return patch;
    const sub = byParticipant.get(patch.participantId);
    if (sub && submissionAuthorizesLocation(sub, dest)) return patch;
    if (sub && proposed && proposed !== dest && submissionAuthorizesLocation(sub, proposed)) {
      return { ...patch, location: proposed };
    }
    const { location: _dropped, ...rest } = patch;
    return rest;
  });
  const campaignMoved = Boolean(proposed && proposed !== current);
  const campaignAuthorized =
    campaignMoved && opts.submissions.some((sub) => submissionAuthorizesLocation(sub, proposed));
  return {
    location: campaignAuthorized ? proposed : current,
    nextRoundContext: campaignAuthorized || !campaignMoved
      ? opts.delta.nextRoundContext
      : opts.currentNextRoundContext,
    delta: { ...opts.delta, players },
  };
}

export function applyCampaignLedger(current: TrpgCampaignLedger, delta: TrpgStateDelta): TrpgCampaignLedger {
  const location = (delta.location ?? current.location).trim();
  const nextRoundContext =
    delta.nextRoundContext != null
      ? clipTrpgChars(delta.nextRoundContext, TRPG_NEXT_ROUND_CONTEXT_MAX_CHARS)
      : current.nextRoundContext;
  return {
    location,
    nextRoundContext,
    quests: mergeFacts(current.quests, delta.questsAdd, delta.questsRemove, TRPG_LEDGER_QUEST_MAX),
    npcs: mergeFacts(current.npcs, delta.npcsAdd, delta.npcsRemove, TRPG_LEDGER_NPC_MAX),
    worldFlags: mergeFacts(current.worldFlags, delta.flagsAdd, delta.flagsRemove, TRPG_LEDGER_FLAG_MAX),
  };
}

export function loadCampaignLedger(db: Database.Database, campaignId: number): TrpgCampaignLedger {
  const row = db
    .prepare(
      `SELECT location, quests_json, npcs_json, world_flags_json, next_round_context
       FROM trpg_campaign_state WHERE campaign_id=?`
    )
    .get(campaignId) as
    | {
        location: string;
        quests_json: string;
        npcs_json: string;
        world_flags_json: string;
        next_round_context?: string | null;
      }
    | undefined;
  if (!row) return emptyCampaignLedger();
  return {
    location: row.location ?? "",
    nextRoundContext: row.next_round_context ?? "",
    quests: parseJson(row.quests_json, [] as string[]),
    npcs: parseJson(row.npcs_json, [] as string[]),
    worldFlags: parseJson(row.world_flags_json, [] as string[]),
  };
}

export function persistCampaignLedger(
  db: Database.Database,
  campaignId: number,
  roundNumber: number,
  ledger: TrpgCampaignLedger
): void {
  db.prepare(
    `UPDATE trpg_campaign_state
     SET location=?, quests_json=?, npcs_json=?, world_flags_json=?, next_round_context=?,
         round_number=?, updated_at=datetime('now')
     WHERE campaign_id=?`
  ).run(
    ledger.location,
    JSON.stringify(ledger.quests),
    JSON.stringify(ledger.npcs),
    JSON.stringify(ledger.worldFlags),
    ledger.nextRoundContext,
    roundNumber,
    campaignId
  );
}
