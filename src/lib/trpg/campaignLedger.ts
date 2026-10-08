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
};

function bodyMentionsDestination(body: string, destination: string): boolean {
  if (actionReferencesOpenRoute(body, [destination]) != null) return true;
  const text = body.replace(/\s+/g, " ").trim().toLowerCase();
  return tokenizeSceneLabel(destination).some((token) => token.length >= 2 && text.includes(token));
}

/** True when this locked action already authorizes relocating to `destination`. */
export function submissionAuthorizesLocation(body: string, destination: string): boolean {
  const dest = destination.trim();
  if (!dest) return false;
  if (declaresTraversalIntent(body)) return true;
  // Particle-attached Korean labels ("주점으로") miss exact token overlap.
  return bodyMentionsDestination(body, dest);
}

/**
 * Location persist bind — campaignLedger owner.
 * Opening may set the starting place. After that, a GM location change sticks
 * only when a locked submission already declared traversal or named that place.
 * World-forced relocation has no separate persist owner today (T9/L5).
 */
export function bindGmLocationToSubmittedMovement(opts: {
  opening: boolean;
  currentLocation: string;
  currentNextRoundContext: string;
  proposedLocation: string;
  delta: TrpgStateDelta;
  submissions: readonly TrpgLocationPersistSubmission[];
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
  const allowed = new Set<number>();
  for (const sub of opts.submissions) {
    if (submissionAuthorizesLocation(sub.body, proposed || current)) {
      allowed.add(sub.participantId);
    }
  }
  const players = (opts.delta.players ?? []).map((patch) => {
    if (patch.location == null) return patch;
    const dest = patch.location.trim();
    if (!dest || dest === current || allowed.has(patch.participantId)) return patch;
    const { location: _dropped, ...rest } = patch;
    return rest;
  });
  const locationAccepted = !proposed || proposed === current || allowed.size > 0;
  return {
    location: locationAccepted && proposed ? proposed : current,
    nextRoundContext: locationAccepted ? opts.delta.nextRoundContext : opts.currentNextRoundContext,
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
