import type Database from "better-sqlite3";
import { parseJson } from "./store";
import {
  TRPG_LEDGER_FLAG_MAX,
  TRPG_LEDGER_ITEM_MAX_CHARS,
  TRPG_LEDGER_NPC_MAX,
  TRPG_LEDGER_QUEST_MAX,
  TRPG_NEXT_ROUND_CONTEXT_MAX_CHARS,
  type TrpgStateDelta,
} from "./types";

export type TrpgCampaignLedger = {
  location: string;
  nextRoundContext: string;
  quests: string[];
  npcs: string[];
  worldFlags: string[];
};

export function clipTrpgChars(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("").trimEnd();
}

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
