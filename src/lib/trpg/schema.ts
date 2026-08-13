import type Database from "better-sqlite3";

/** TRPG tables are additive. Regular chats/messages are unchanged. */
export function ensureTrpgTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trpg_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_user_id INTEGER NOT NULL,
      source_character_id INTEGER,
      source_world_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      max_slots INTEGER NOT NULL DEFAULT 4,
      billing_mode TEXT NOT NULL DEFAULT 'split_even',
      gm_model TEXT NOT NULL DEFAULT 'deepseek-v4-pro',
      status TEXT NOT NULL DEFAULT 'CHARACTER_SETUP',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trpg_campaigns_host
      ON trpg_campaigns(host_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS trpg_scenarios (
      campaign_id INTEGER PRIMARY KEY,
      stat_definitions_json TEXT NOT NULL,
      point_pool INTEGER NOT NULL DEFAULT 30,
      dice_rules_json TEXT NOT NULL,
      widget_template_json TEXT NOT NULL,
      start_location TEXT NOT NULL DEFAULT '',
      start_inventory_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trpg_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      slot_index INTEGER NOT NULL,
      kind TEXT NOT NULL,
      user_id INTEGER,
      character_id INTEGER,
      display_name TEXT NOT NULL DEFAULT '',
      can_act INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(campaign_id, slot_index)
    );
    CREATE INDEX IF NOT EXISTS idx_trpg_participants_campaign
      ON trpg_participants(campaign_id, slot_index);

    CREATE TABLE IF NOT EXISTS trpg_character_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      hp INTEGER NOT NULL,
      max_hp INTEGER NOT NULL,
      conditions_json TEXT NOT NULL DEFAULT '[]',
      inventory_json TEXT NOT NULL DEFAULT '[]',
      location TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trpg_character_stats (
      sheet_id INTEGER NOT NULL,
      stat_key TEXT NOT NULL,
      value INTEGER NOT NULL,
      PRIMARY KEY (sheet_id, stat_key)
    );

    -- One linear timeline per campaign. Duplicate round_number = fork, which is forbidden.
    CREATE TABLE IF NOT EXISTS trpg_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      phase TEXT NOT NULL,
      lock_holder_request_id TEXT,
      gm_generation_id TEXT UNIQUE,
      input_snapshot_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(campaign_id, round_number)
    );
    CREATE INDEX IF NOT EXISTS idx_trpg_rounds_campaign
      ON trpg_rounds(campaign_id, round_number DESC);

    CREATE TABLE IF NOT EXISTS trpg_action_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      action_type TEXT,
      selected_stat TEXT,
      target TEXT,
      locked INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(round_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS trpg_dice_rolls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL UNIQUE,
      d20 INTEGER NOT NULL,
      stat_key TEXT,
      stat_modifier INTEGER NOT NULL DEFAULT 0,
      equipment_modifier INTEGER NOT NULL DEFAULT 0,
      condition_modifier INTEGER NOT NULL DEFAULT 0,
      support_modifier INTEGER NOT NULL DEFAULT 0,
      environment_modifier INTEGER NOT NULL DEFAULT 0,
      final_score INTEGER NOT NULL,
      dc INTEGER NOT NULL,
      tier TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trpg_gm_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL UNIQUE,
      narration TEXT NOT NULL,
      structured_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trpg_campaign_state (
      campaign_id INTEGER PRIMARY KEY,
      round_number INTEGER NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT '',
      quests_json TEXT NOT NULL DEFAULT '[]',
      npcs_json TEXT NOT NULL DEFAULT '[]',
      world_flags_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trpg_campaign_memories (
      campaign_id INTEGER PRIMARY KEY,
      recent_summary TEXT NOT NULL DEFAULT '',
      sealed_round_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trpg_round_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      round_start INTEGER NOT NULL,
      round_end INTEGER NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(campaign_id, round_start)
    );

    CREATE TABLE IF NOT EXISTS trpg_state_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      round_id INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      applied_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const addColumn = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  addColumn("trpg_campaigns", "invite_code", "TEXT");
  addColumn("trpg_campaigns", "world_brief", "TEXT NOT NULL DEFAULT ''");
  addColumn("trpg_campaigns", "template_id", "INTEGER");
  addColumn("trpg_campaigns", "author_user_id", "INTEGER");
  addColumn("trpg_rounds", "billed", "INTEGER NOT NULL DEFAULT 0");
  addColumn("trpg_rounds", "error_json", "TEXT");
  addColumn("trpg_rounds", "billed_points", "INTEGER NOT NULL DEFAULT 0");
  addColumn("trpg_rounds", "usage_json", "TEXT");
  addColumn("trpg_campaign_state", "next_round_context", "TEXT NOT NULL DEFAULT ''");
  addColumn("trpg_participants", "persona_json", "TEXT NOT NULL DEFAULT ''");
  addColumn("trpg_scenarios", "default_pc_stats_json", "TEXT NOT NULL DEFAULT ''");
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_trpg_campaigns_invite
     ON trpg_campaigns(invite_code) WHERE invite_code IS NOT NULL AND invite_code != ''`
  );

  if (tableExists(db, "worlds")) {
    addColumn("worlds", "trpg_enabled", "INTEGER NOT NULL DEFAULT 0");
    addColumn("worlds", "trpg_visibility", "TEXT NOT NULL DEFAULT 'private'");
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_worlds_trpg_public
       ON worlds(trpg_enabled, trpg_visibility, updated_at)`
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS trpg_scenario_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      world_id INTEGER,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private',
      start_location TEXT NOT NULL DEFAULT '',
      start_inventory_json TEXT NOT NULL DEFAULT '[]',
      default_pc_stats_json TEXT NOT NULL DEFAULT '',
      npcs_json TEXT NOT NULL DEFAULT '[]',
      character_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trpg_scenario_templates_creator
      ON trpg_scenario_templates(creator_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trpg_scenario_templates_public
      ON trpg_scenario_templates(visibility, updated_at DESC);

    CREATE TABLE IF NOT EXISTS trpg_creator_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      consumer_user_id INTEGER NOT NULL,
      creator_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      character_id INTEGER,
      points_spent INTEGER NOT NULL,
      reward_amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(round_id, consumer_user_id, creator_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_trpg_creator_earnings_round
      ON trpg_creator_earnings(round_id, consumer_user_id);
  `);
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}
