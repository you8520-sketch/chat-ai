import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STAGE_PREFIX = "_full_migrate_";
const INTERNAL_TABLES = new Set([
  "_schema_flags",
  "_remote_schema_lock",
  "_remote_schema_state",
  "app_meta",
]);
const CLEAR_ONLY_TABLES = new Set([
  "sessions",
  "web_push_subscriptions",
  "web_push_outbox",
  "web_push_user_events",
]);

type Scalar = string | number | null | { $blob: string };
type ExportRow = Record<string, Scalar>;
type TableInfo = { name: string; pk: number };
type MigrationBody =
  | { action: "stage-reset"; expectedTables: string[] }
  | { action: "stage-table-start"; table: string }
  | { action: "stage-insert"; table: string; rows: ExportRow[] }
  | { action: "finalize"; expectedCounts: Record<string, number>; confirmation: string }
  | { action: "cleanup-stage-table"; table: string }
  | { action: "cleanup-stage" };

function authorized(request: Request): boolean {
  const expected = process.env.FULL_DB_MIGRATION_TOKEN?.trim() ?? "";
  const provided = request.headers.get("x-full-db-migration-token") ?? "";
  if (expected.length < 32 || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_RE.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

function allTables(): string[] {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  )
    .map((row) => row.name)
    .filter((name) => IDENTIFIER_RE.test(name) && !name.startsWith(STAGE_PREFIX));
}

function migratableTables(): string[] {
  return allTables().filter(
    (name) => !INTERNAL_TABLES.has(name) && !CLEAR_ONLY_TABLES.has(name),
  );
}

function tableColumns(table: string): TableInfo[] {
  const db = getDb();
  return (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
    name: string;
    pk: number;
  }>).map((row) => ({ name: row.name, pk: Number(row.pk) }));
}

function tableCount(table: string): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as {
    count: number;
  };
  return Number(row.count);
}

function encodeValue(value: unknown): Scalar {
  if (Buffer.isBuffer(value)) return { $blob: value.toString("base64") };
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error(`Unsupported database value: ${typeof value}`);
}

function decodeValue(value: Scalar): string | number | null | Buffer {
  if (
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    typeof value.$blob === "string"
  ) {
    return Buffer.from(value.$blob, "base64");
  }
  return value as string | number | null;
}

function stageName(table: string): string {
  return `${STAGE_PREFIX}${table}`;
}

function validateMigrationTable(table: unknown): string {
  if (typeof table !== "string" || !migratableTables().includes(table)) {
    throw new Error(`Unknown migration table: ${String(table)}`);
  }
  return table;
}

function schemaFingerprint(tables: string[]): string {
  const schema = tables.map((table) => ({ table, columns: tableColumns(table).map((c) => c.name) }));
  return crypto.createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

function ensureExpectedTables(expected: unknown): string[] {
  if (!Array.isArray(expected) || expected.some((name) => typeof name !== "string")) {
    throw new Error("Invalid expected table list");
  }
  const actual = migratableTables();
  const supplied = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(supplied)) {
    const missing = actual.filter((name) => !supplied.includes(name));
    const extra = supplied.filter((name) => !actual.includes(name));
    throw new Error(`Schema mismatch; missing=${missing.join(",")}; extra=${extra.join(",")}`);
  }
  return actual;
}

function insertStageRows(table: string, rows: ExportRow[]): number {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  if (rows.length > 500) throw new Error("A migration batch may contain at most 500 rows");
  const columns = tableColumns(table).map((column) => column.name);
  const expectedKey = JSON.stringify([...columns].sort());
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid row");
    if (JSON.stringify(Object.keys(row).sort()) !== expectedKey) {
      throw new Error(`Column mismatch for ${table}`);
    }
  }
  const quoted = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const statement = getDb().prepare(
    `INSERT INTO ${quoteIdentifier(stageName(table))} (${quoted}) VALUES (${placeholders})`,
  );
  const write = getDb().transaction((batch: ExportRow[]) => {
    let inserted = 0;
    for (const row of batch) {
      const result = statement.run(...columns.map((column) => decodeValue(row[column])));
      inserted += Number(result.changes);
    }
    return inserted;
  });
  return write(rows);
}

function validateExpectedCounts(value: unknown, tables: string[]): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid expected counts");
  }
  const input = value as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const count = Number(input[table]);
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid count for ${table}`);
    counts[table] = count;
  }
  const extras = Object.keys(input).filter((table) => !tables.includes(table));
  if (extras.length) throw new Error(`Unexpected count tables: ${extras.join(",")}`);
  if ((counts.users ?? 0) < 41) throw new Error("Source snapshot has fewer than 41 users");
  if (counts.characters !== 7) throw new Error("Source snapshot must contain exactly 7 characters");
  if ((counts.worlds ?? 0) < 5) throw new Error("Source snapshot has fewer than 5 worlds");
  if ((counts.user_personas ?? 0) < 51) throw new Error("Source snapshot has fewer than 51 personas");
  if ((counts.chats ?? 0) < 667 || (counts.messages ?? 0) < 3465) {
    throw new Error("Source snapshot is missing Railway chat history");
  }
  if (counts.trpg_campaigns !== 1) throw new Error("Source snapshot must contain one TRPG campaign");
  return counts;
}

function cleanupStageTables(tables: string[]) {
  const db = getDb();
  for (const table of tables) db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(stageName(table))}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "manifest";
    const everyTable = allTables();
    const migrationTables = migratableTables();

    if (mode === "manifest") {
      const counts = Object.fromEntries(everyTable.map((table) => [table, tableCount(table)]));
      return NextResponse.json({
        ok: true,
        schemaFingerprint: schemaFingerprint(migrationTables),
        allTables: everyTable,
        migratableTables: migrationTables,
        clearOnlyTables: [...CLEAR_ONLY_TABLES].filter((table) => everyTable.includes(table)),
        internalTables: [...INTERNAL_TABLES].filter((table) => everyTable.includes(table)),
        counts,
        columns: Object.fromEntries(
          everyTable.map((table) => [table, tableColumns(table).map((column) => column.name)]),
        ),
      });
    }

    if (mode === "export") {
      const table = url.searchParams.get("table") ?? "";
      if (!everyTable.includes(table)) throw new Error("Unknown export table");
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
      const rows = getDb()
        .prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY rowid LIMIT ? OFFSET ?`)
        .all(limit, offset) as Array<Record<string, unknown>>;
      return NextResponse.json({
        ok: true,
        table,
        offset,
        rows: rows.map((row) =>
          Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encodeValue(value)])),
        ),
      });
    }

    throw new Error("Unknown mode");
  } catch (error) {
    console.error("[full-db-migration:get] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Migration request failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as MigrationBody;
    const tables = migratableTables();

    if (body.action === "stage-reset") {
      ensureExpectedTables(body.expectedTables);
      return NextResponse.json({ ok: true, expectedTables: tables.length });
    }

    if (body.action === "stage-table-start") {
      const table = validateMigrationTable(body.table);
      const columns = tableColumns(table).map((column) => quoteIdentifier(column.name)).join(", ");
      getDb().exec(
        `DROP TABLE IF EXISTS ${quoteIdentifier(stageName(table))}; ` +
          `CREATE TABLE ${quoteIdentifier(stageName(table))} AS ` +
          `SELECT ${columns} FROM ${quoteIdentifier(table)} WHERE 0`,
      );
      return NextResponse.json({ ok: true, table });
    }

    if (body.action === "stage-insert") {
      const table = validateMigrationTable(body.table);
      const inserted = insertStageRows(table, body.rows);
      return NextResponse.json({
        ok: true,
        table,
        inserted,
        stagedCount: tableCount(stageName(table)),
      });
    }

    if (body.action === "cleanup-stage") {
      cleanupStageTables(tables);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "cleanup-stage-table") {
      const table = validateMigrationTable(body.table);
      getDb().exec(`DROP TABLE IF EXISTS ${quoteIdentifier(stageName(table))}`);
      return NextResponse.json({ ok: true, table });
    }

    if (body.action === "finalize") {
      if (body.confirmation !== "REPLACE_VERCEL_WITH_RAILWAY") {
        throw new Error("Missing destructive migration confirmation");
      }
      const expected = validateExpectedCounts(body.expectedCounts, tables);
      for (const table of tables) {
        const staged = tableCount(stageName(table));
        if (staged !== expected[table]) {
          throw new Error(`Staging count mismatch for ${table}: ${staged} != ${expected[table]}`);
        }
      }

      const db = getDb();
      const replace = db.transaction(() => {
        db.exec("PRAGMA defer_foreign_keys = ON");
        for (const table of [...CLEAR_ONLY_TABLES, ...tables]) {
          if (allTables().includes(table)) db.exec(`DELETE FROM ${quoteIdentifier(table)}`);
        }
        try {
          db.exec("DELETE FROM sqlite_sequence");
        } catch {
          // Databases without AUTOINCREMENT do not have sqlite_sequence.
        }
        for (const table of tables) {
          const columns = tableColumns(table).map((column) => quoteIdentifier(column.name)).join(", ");
          db.exec(
            `INSERT INTO ${quoteIdentifier(table)} (${columns}) ` +
              `SELECT ${columns} FROM ${quoteIdentifier(stageName(table))}`,
          );
        }
      });
      replace();

      const actual = Object.fromEntries(tables.map((table) => [table, tableCount(table)]));
      const mismatches = tables.filter((table) => actual[table] !== expected[table]);
      if (mismatches.length) throw new Error(`Final count mismatch: ${mismatches.join(",")}`);
      const admin = db.prepare("SELECT id, email, nickname, is_admin FROM users WHERE id=1").get();
      const notice = db.prepare("SELECT * FROM home_popup_notices ORDER BY id LIMIT 1").get();
      return NextResponse.json({ ok: true, counts: actual, admin, notice });
    }

    throw new Error("Unknown migration action");
  } catch (error) {
    console.error("[full-db-migration:post] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Migration request failed" },
      { status: 500 },
    );
  }
}
