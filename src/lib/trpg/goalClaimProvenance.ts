import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { TrpgGoal, TrpgGoalClaimSource } from "./campaignGoals";
import { clipTrpgChars } from "./clip";
import { loadCommittedProvenanceGenerationId } from "./gmGenerationLease";
import { TRPG_LEDGER_ITEM_MAX_CHARS } from "./types";

function narrationDigest(narration: string): string {
  return createHash("sha256").update(narration).digest("hex").slice(0, 32);
}

/** Recorded on a goal when the GM claims its resolution: which committed message the claim came from. */
export function goalClaimSource(generationId: string, narration: string): TrpgGoalClaimSource {
  return { generationId, narrationDigest: narrationDigest(narration) };
}

/**
 * Whether a claim still describes the committed GM message of its round. A reroll replaces the message and
 * its generation and does not re-apply the ledger, so an older claim stops matching; a claim an older build
 * rewrote has no source and never matches. All three must hold: the same committed generation, the same
 * narration, and a structured `questsClaimDone` that still names the goal.
 */
export function claimMatchesCommittedMessage(db: Database.Database, campaignId: number, goal: TrpgGoal): boolean {
  const source = goal.claimSource;
  if (!source || goal.claimedRound == null) return false;
  const round = db
    .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`)
    .get(campaignId, goal.claimedRound) as { id: number } | undefined;
  if (!round) return false;
  if (loadCommittedProvenanceGenerationId(db, round.id) !== source.generationId) return false;
  const message = db
    .prepare(`SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=?`)
    .get(round.id) as { narration: string; structured_json: string | null } | undefined;
  if (!message || narrationDigest(message.narration) !== source.narrationDigest) return false;
  let claimed: unknown;
  try {
    claimed = (JSON.parse(message.structured_json ?? "null") as { delta?: { questsClaimDone?: unknown } } | null)?.delta
      ?.questsClaimDone;
  } catch {
    return false;
  }
  return (
    Array.isArray(claimed) &&
    claimed.some((title) => typeof title === "string" && clipTrpgChars(title, TRPG_LEDGER_ITEM_MAX_CHARS) === goal.title)
  );
}
