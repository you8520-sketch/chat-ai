import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TABLES = [
  "trpg_campaigns",
  "trpg_scenarios",
  "trpg_participants",
  "trpg_character_sheets",
  "trpg_character_stats",
  "trpg_rounds",
  "trpg_action_submissions",
  "trpg_dice_rolls",
  "trpg_gm_messages",
  "trpg_campaign_state",
  "trpg_campaign_memories",
  "trpg_round_summaries",
  "trpg_state_change_log",
  "trpg_scenario_templates",
  "trpg_creator_earnings",
  "trpg_party_messages",
  "character_image_album",
] as const;

type TableName = (typeof TABLES)[number];
type ExportValue = string | number | null;
type ExportRow = Record<string, ExportValue>;
type MigrationPayload = {
  version?: unknown;
  tables?: Partial<Record<TableName, unknown>>;
};

const SAFE_COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function authorized(request: Request): boolean {
  const expected = process.env.CONTENT_MIGRATION_TOKEN?.trim() ?? "";
  const provided = request.headers.get("x-trpg-migration-secret") ?? "";
  if (expected.length < 32 || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function rowsFor(payload: MigrationPayload, table: TableName): ExportRow[] {
  const rows = payload.tables?.[table];
  if (!Array.isArray(rows)) throw new Error(`Missing table export: ${table}`);
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`Invalid rows for ${table}`);
  }
  return rows as ExportRow[];
}

function validatePayload(payload: MigrationPayload) {
  if (payload.version !== 1 || !payload.tables || typeof payload.tables !== "object") {
    throw new Error("Invalid TRPG migration payload");
  }
  for (const table of TABLES) rowsFor(payload, table);

  const campaigns = rowsFor(payload, "trpg_campaigns");
  if (
    campaigns.length !== 1 ||
    Number(campaigns[0]?.id) !== 9 ||
    Number(campaigns[0]?.host_user_id) !== 1 ||
    Number(campaigns[0]?.source_world_id) !== 1
  ) {
    throw new Error("Unexpected campaign export");
  }
  if (rowsFor(payload, "trpg_participants").length !== 3) {
    throw new Error("Expected 3 TRPG participants");
  }
  if (rowsFor(payload, "trpg_character_sheets").length !== 3) {
    throw new Error("Expected 3 TRPG character sheets");
  }
  if (rowsFor(payload, "trpg_character_stats").length !== 18) {
    throw new Error("Expected 18 TRPG character stats");
  }
  if (rowsFor(payload, "trpg_rounds").length !== 5) {
    throw new Error("Expected 5 TRPG rounds");
  }
  if (rowsFor(payload, "trpg_action_submissions").length !== 9) {
    throw new Error("Expected 9 TRPG action submissions");
  }
  if (rowsFor(payload, "trpg_scenario_templates").length !== 0) {
    throw new Error("Unexpected scenario templates");
  }
}

function insertRows(table: TableName, rows: ExportRow[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const targetColumns = new Set(
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  let inserted = 0;
  for (const row of rows) {
    const columns = Object.keys(row).filter(
      (column) => SAFE_COLUMN_RE.test(column) && targetColumns.has(column),
    );
    if (columns.length === 0) throw new Error(`No compatible columns for ${table}`);
    const quoted = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const result = db
      .prepare(`INSERT OR IGNORE INTO "${table}" (${quoted}) VALUES (${placeholders})`)
      .run(...columns.map((column) => row[column]));
    inserted += Number(result.changes);
  }
  return inserted;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = (await request.json()) as MigrationPayload;
    validatePayload(payload);
    const db = getDb();
    const targetCampaigns = db.prepare("SELECT COUNT(*) AS count FROM trpg_campaigns").get() as {
      count: number;
    };
    if (Number(targetCampaigns.count) !== 0) {
      throw new Error("Target TRPG campaigns table is not empty");
    }
    const host = db.prepare("SELECT id FROM users WHERE id=1").get();
    const world = db.prepare("SELECT id FROM worlds WHERE id=1").get();
    if (!host || !world) throw new Error("Required migrated user/world is missing");

    const inserted: Record<string, number> = {};
    db.transaction(() => {
      for (const table of TABLES) {
        inserted[table] = insertRows(table, rowsFor(payload, table));
      }
    })();

    const verified = {
      campaigns: Number(
        (db.prepare("SELECT COUNT(*) AS count FROM trpg_campaigns WHERE id=9").get() as { count: number })
          .count,
      ),
      participants: Number(
        (db.prepare("SELECT COUNT(*) AS count FROM trpg_participants WHERE campaign_id=9").get() as {
          count: number;
        }).count,
      ),
      rounds: Number(
        (db.prepare("SELECT COUNT(*) AS count FROM trpg_rounds WHERE campaign_id=9").get() as {
          count: number;
        }).count,
      ),
    };
    if (verified.campaigns !== 1 || verified.participants !== 3 || verified.rounds !== 5) {
      throw new Error("TRPG migration verification failed");
    }
    return NextResponse.json({ ok: true, inserted, verified });
  } catch (error) {
    console.error("[trpg-migration] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Migration failed" },
      { status: 500 },
    );
  }
}
