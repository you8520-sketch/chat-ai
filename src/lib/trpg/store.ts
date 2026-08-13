import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { DEFAULT_TRPG_SHEET_WIDGET } from "./defaultSheet";
import { DEFAULT_TRPG_DICE_RULES, type TrpgDiceRules, type TrpgRoundPhase, type TrpgStatDefinition } from "./types";
import { DEFAULT_TRPG_POINT_POOL, DEFAULT_TRPG_STAT_DEFS } from "./stats";

export function newTrpgInviteCode(): string {
  return randomBytes(4).toString("hex");
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type TrpgCampaignRow = {
  id: number;
  host_user_id: number;
  source_character_id: number | null;
  source_world_id: number | null;
  title: string;
  max_slots: number;
  billing_mode: string;
  gm_model: string;
  status: string;
  invite_code: string | null;
  world_brief: string;
};

export type TrpgParticipantRow = {
  id: number;
  campaign_id: number;
  slot_index: number;
  kind: string;
  user_id: number | null;
  character_id: number | null;
  display_name: string;
  can_act: number;
  status: string;
};

export type TrpgRoundRow = {
  id: number;
  campaign_id: number;
  round_number: number;
  phase: string;
  lock_holder_request_id: string | null;
  gm_generation_id: string | null;
  billed: number;
  error_json: string | null;
};

export function loadCampaign(db: Database.Database, id: number): TrpgCampaignRow | null {
  return (
    (db.prepare(`SELECT * FROM trpg_campaigns WHERE id=?`).get(id) as TrpgCampaignRow | undefined) ??
    null
  );
}

export function loadCampaignByInvite(db: Database.Database, code: string): TrpgCampaignRow | null {
  return (
    (db
      .prepare(`SELECT * FROM trpg_campaigns WHERE invite_code=?`)
      .get(code) as TrpgCampaignRow | undefined) ?? null
  );
}

export function loadParticipants(db: Database.Database, campaignId: number): TrpgParticipantRow[] {
  return db
    .prepare(`SELECT * FROM trpg_participants WHERE campaign_id=? ORDER BY slot_index ASC`)
    .all(campaignId) as TrpgParticipantRow[];
}

export function loadLatestRound(db: Database.Database, campaignId: number): TrpgRoundRow | null {
  return (
    (db
      .prepare(
        `SELECT id, campaign_id, round_number, phase, lock_holder_request_id, gm_generation_id,
                COALESCE(billed,0) AS billed, error_json
         FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`
      )
      .get(campaignId) as TrpgRoundRow | undefined) ?? null
  );
}

export function loadScenario(db: Database.Database, campaignId: number): {
  statDefs: TrpgStatDefinition[];
  pointPool: number;
  diceRules: TrpgDiceRules;
  startLocation: string;
  startInventory: string[];
} {
  const row = db
    .prepare(
      `SELECT stat_definitions_json, point_pool, dice_rules_json, start_location, start_inventory_json
       FROM trpg_scenarios WHERE campaign_id=?`
    )
    .get(campaignId) as
    | {
        stat_definitions_json: string;
        point_pool: number;
        dice_rules_json: string;
        start_location: string;
        start_inventory_json: string;
      }
    | undefined;
  if (!row) {
    return {
      statDefs: DEFAULT_TRPG_STAT_DEFS,
      pointPool: DEFAULT_TRPG_POINT_POOL,
      diceRules: DEFAULT_TRPG_DICE_RULES,
      startLocation: "",
      startInventory: [],
    };
  }
  return {
    statDefs: parseJson(row.stat_definitions_json, DEFAULT_TRPG_STAT_DEFS),
    pointPool: row.point_pool,
    diceRules: parseJson(row.dice_rules_json, DEFAULT_TRPG_DICE_RULES),
    startLocation: row.start_location,
    startInventory: parseJson(row.start_inventory_json, [] as string[]),
  };
}

export function insertCampaign(db: Database.Database, opts: {
  hostUserId: number;
  title: string;
  sourceCharacterId: number | null;
  sourceWorldId: number | null;
  worldBrief: string;
  maxSlots: number;
}): number {
  const invite = newTrpgInviteCode();
  const info = db
    .prepare(
      `INSERT INTO trpg_campaigns
        (host_user_id, source_character_id, source_world_id, title, max_slots, billing_mode, gm_model, status, invite_code, world_brief)
       VALUES (?,?,?,?,?,'split_even','deepseek-v4-pro','CHARACTER_SETUP',?,?)`
    )
    .run(
      opts.hostUserId,
      opts.sourceCharacterId,
      opts.sourceWorldId,
      opts.title,
      opts.maxSlots,
      invite,
      opts.worldBrief
    );
  const campaignId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO trpg_scenarios
      (campaign_id, stat_definitions_json, point_pool, dice_rules_json, widget_template_json, start_location, start_inventory_json)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    campaignId,
    JSON.stringify(DEFAULT_TRPG_STAT_DEFS),
    DEFAULT_TRPG_POINT_POOL,
    JSON.stringify(DEFAULT_TRPG_DICE_RULES),
    JSON.stringify(DEFAULT_TRPG_SHEET_WIDGET),
    "",
    JSON.stringify([])
  );
  db.prepare(
    `INSERT INTO trpg_campaign_state (campaign_id, round_number, location) VALUES (?,0,?)`
  ).run(campaignId, "");
  db.prepare(`INSERT INTO trpg_campaign_memories (campaign_id) VALUES (?)`).run(campaignId);
  return campaignId;
}

export function insertParticipant(db: Database.Database, opts: {
  campaignId: number;
  slotIndex: number;
  kind: "human" | "ai_character";
  userId: number | null;
  characterId: number | null;
  displayName: string;
}): number {
  const info = db
    .prepare(
      `INSERT INTO trpg_participants (campaign_id, slot_index, kind, user_id, character_id, display_name)
       VALUES (?,?,?,?,?,?)`
    )
    .run(opts.campaignId, opts.slotIndex, opts.kind, opts.userId, opts.characterId, opts.displayName);
  return Number(info.lastInsertRowid);
}

export function setRoundPhase(db: Database.Database, roundId: number, phase: TrpgRoundPhase): void {
  db.prepare(`UPDATE trpg_rounds SET phase=?, updated_at=datetime('now') WHERE id=?`).run(phase, roundId);
}
