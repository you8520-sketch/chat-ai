import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { buildTrpgSheetWidget } from "./defaultSheet";
import { parseTrpgInviteInput } from "./invite";
import { DEFAULT_TRPG_DICE_RULES, type TrpgDiceRules, type TrpgRoundPhase, type TrpgStatDefinition } from "./types";
import { DEFAULT_TRPG_STAT_DEFS, pointPoolFor, resolveCampaignStatDefs } from "./stats";

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
  template_id: number | null;
  author_user_id: number | null;
  gm_secret: string | null;
  relationship_brief: string | null;
};

export type TrpgBotPersona = {
  description: string;
  greeting: string;
  systemPrompt: string;
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
  persona_json: string | null;
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
  const normalized = parseTrpgInviteInput(code);
  if (!normalized) return null;
  return (
    (db
      .prepare(`SELECT * FROM trpg_campaigns WHERE lower(invite_code)=?`)
      .get(normalized) as TrpgCampaignRow | undefined) ?? null
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
  defaultPcStats: Record<string, number> | null;
} {
  const row = db
    .prepare(
      `SELECT stat_definitions_json, point_pool, dice_rules_json, start_location, start_inventory_json,
              COALESCE(default_pc_stats_json, '') AS default_pc_stats_json
       FROM trpg_scenarios WHERE campaign_id=?`
    )
    .get(campaignId) as
    | {
        stat_definitions_json: string;
        point_pool: number;
        dice_rules_json: string;
        start_location: string;
        start_inventory_json: string;
        default_pc_stats_json: string;
      }
    | undefined;
  if (!row) {
    return {
      statDefs: DEFAULT_TRPG_STAT_DEFS,
      pointPool: pointPoolFor(DEFAULT_TRPG_STAT_DEFS),
      diceRules: DEFAULT_TRPG_DICE_RULES,
      startLocation: "",
      startInventory: [],
      defaultPcStats: null,
    };
  }
  const parsedStats = parseJson(row.default_pc_stats_json, null as Record<string, number> | null);
  const statDefs = resolveCampaignStatDefs(parseJson(row.stat_definitions_json, DEFAULT_TRPG_STAT_DEFS));
  return {
    statDefs,
    pointPool: pointPoolFor(statDefs),
    diceRules: parseJson(row.dice_rules_json, DEFAULT_TRPG_DICE_RULES),
    startLocation: row.start_location,
    startInventory: parseJson(row.start_inventory_json, [] as string[]),
    defaultPcStats:
      parsedStats && typeof parsedStats === "object" && !Array.isArray(parsedStats) ? parsedStats : null,
  };
}

export function insertCampaign(db: Database.Database, opts: {
  hostUserId: number;
  title: string;
  sourceCharacterId: number | null;
  sourceWorldId: number | null;
  worldBrief: string;
  maxSlots: number;
  templateId?: number | null;
  authorUserId?: number | null;
  startLocation?: string;
  startInventory?: string[];
  defaultPcStats?: Record<string, number> | null;
  gmSecret?: string | null;
  statDefs?: TrpgStatDefinition[];
  pointPool?: number;
}): number {
  const invite = newTrpgInviteCode();
  const statDefs = opts.statDefs && opts.statDefs.length > 0 ? opts.statDefs : DEFAULT_TRPG_STAT_DEFS;
  const pointPool = opts.pointPool ?? pointPoolFor(statDefs);
  const info = db
    .prepare(
      `INSERT INTO trpg_campaigns
        (host_user_id, source_character_id, source_world_id, title, max_slots, billing_mode, gm_model, status, invite_code, world_brief, template_id, author_user_id, gm_secret)
       VALUES (?,?,?,?,?,'split_even','deepseek-v4-pro-0813','CHARACTER_SETUP',?,?,?,?,?)`
    )
    .run(
      opts.hostUserId,
      opts.sourceCharacterId,
      opts.sourceWorldId,
      opts.title,
      opts.maxSlots,
      invite,
      opts.worldBrief,
      opts.templateId ?? null,
      opts.authorUserId ?? null,
      opts.gmSecret ?? ""
    );
  const campaignId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO trpg_scenarios
      (campaign_id, stat_definitions_json, point_pool, dice_rules_json, widget_template_json, start_location, start_inventory_json, default_pc_stats_json)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    campaignId,
    JSON.stringify(statDefs),
    pointPool,
    JSON.stringify(DEFAULT_TRPG_DICE_RULES),
    JSON.stringify(buildTrpgSheetWidget(statDefs)),
    opts.startLocation ?? "",
    JSON.stringify(opts.startInventory ?? []),
    opts.defaultPcStats ? JSON.stringify(opts.defaultPcStats) : ""
  );
  db.prepare(
    `INSERT INTO trpg_campaign_state (campaign_id, round_number, location, npcs_json) VALUES (?,0,?,?)`
  ).run(campaignId, opts.startLocation ?? "", JSON.stringify([]));
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
  persona?: object | null;
}): number {
  const info = db
    .prepare(
      `INSERT INTO trpg_participants (campaign_id, slot_index, kind, user_id, character_id, display_name, persona_json)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(
      opts.campaignId,
      opts.slotIndex,
      opts.kind,
      opts.userId,
      opts.characterId,
      opts.displayName,
      opts.persona ? JSON.stringify(opts.persona) : ""
    );
  return Number(info.lastInsertRowid);
}

export function parseBotPersona(raw: string | null | undefined): TrpgBotPersona | null {
  const parsed = parseJson(raw, null as TrpgBotPersona | null);
  if (!parsed || typeof parsed !== "object") return null;
  return {
    description: String(parsed.description ?? ""),
    greeting: String(parsed.greeting ?? ""),
    systemPrompt: String(parsed.systemPrompt ?? ""),
  };
}

export function setRoundPhase(db: Database.Database, roundId: number, phase: TrpgRoundPhase): void {
  db.prepare(`UPDATE trpg_rounds SET phase=?, updated_at=datetime('now') WHERE id=?`).run(phase, roundId);
}
