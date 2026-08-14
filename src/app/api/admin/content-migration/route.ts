import crypto from "node:crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isVercelPublicBlobUrl } from "@/lib/uploadUrls";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE_BASE_URL =
  "https://chat-ai-production-3e84.up.railway.app/uploads";
const SOURCE_EXPORT_URL = `${SOURCE_BASE_URL}/migrate-seven-20260814.json`;
const EXPECTED_NAMES = [
  "라이크",
  "플러드",
  "솔",
  "권태현",
  "로코",
  "강이현",
  "이혁",
] as const;
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const SAFE_COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPECTED_USER_COUNT = 41;

type ExportRow = Record<string, string | number | null>;
type RailwayExport = {
  version: number;
  names: string[];
  users: ExportRow[];
  worlds: ExportRow[];
  characters: ExportRow[];
};

function authorized(request: Request): boolean {
  const expected = process.env.CONTENT_MIGRATION_TOKEN?.trim() ?? "";
  const provided = request.headers.get("x-content-migration-token") ?? "";
  if (!expected || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

async function readSourceExport(): Promise<RailwayExport> {
  const response = await fetch(SOURCE_EXPORT_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Source export request failed with ${response.status}`);
  }
  const data = (await response.json()) as RailwayExport;
  const actualNames = data.characters.map((row) => String(row.name)).sort();
  const expectedNames = [...EXPECTED_NAMES].sort();
  if (
    data.version !== 1 ||
    data.characters.length !== 7 ||
    data.worlds.length !== 3 ||
    JSON.stringify(actualNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error("Source export validation failed");
  }
  return data;
}

function referencedAssetNames(data: RailwayExport): string[] {
  const json = JSON.stringify(data);
  return [
    ...new Set(
      [...json.matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
}

async function migrateAsset(filename: string) {
  if (!SAFE_FILENAME_RE.test(filename)) throw new Error("Invalid asset filename");
  const response = await fetch(`${SOURCE_BASE_URL}/${filename}`, {
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Source asset request failed with ${response.status}`);
  }
  const blob = await put(`uploads/${filename}`, response.body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: response.headers.get("content-type") ?? undefined,
    cacheControlMaxAge: 31_536_000,
  });
  return { filename, url: blob.url };
}

function insertRows(
  table: "users" | "worlds" | "characters",
  rows: ExportRow[],
): number {
  const db = getDb();
  const tableColumns = new Set(
    (
      db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
  let inserted = 0;
  for (const row of rows) {
    const columns = Object.keys(row).filter(
      (column) => SAFE_COLUMN_RE.test(column) && tableColumns.has(column),
    );
    if (columns.length === 0) throw new Error(`No columns found for ${table}`);
    const quoted = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO "${table}" (${quoted}) VALUES (${placeholders})`,
      )
      .run(...columns.map((column) => row[column]));
    inserted += Number(result.changes);
  }
  return inserted;
}

function replaceAssetUrls(
  data: RailwayExport,
  assetUrls: Record<string, string>,
): RailwayExport {
  const required = referencedAssetNames(data);
  for (const filename of required) {
    const url = assetUrls[filename];
    if (!url || !isVercelPublicBlobUrl(url)) {
      throw new Error(`Missing or invalid Blob URL for ${filename}`);
    }
  }
  const rewritten = JSON.stringify(data).replace(
    /\/uploads\/([A-Za-z0-9._-]+)/g,
    (_match, filename: string) => assetUrls[filename],
  );
  return JSON.parse(rewritten) as RailwayExport;
}

async function migrateDatabase(assetUrls: Record<string, string>) {
  const source = await readSourceExport();
  const data = replaceAssetUrls(source, assetUrls);
  const db = getDb();

  const existing = db
    .prepare("SELECT COUNT(*) AS count FROM characters")
    .get() as { count: number };
  if (Number(existing.count) !== 0) {
    throw new Error("Target characters table is not empty");
  }

  const usersInserted = insertRows("users", data.users);
  const worldsInserted = insertRows("worlds", data.worlds);
  const charactersInserted = insertRows("characters", data.characters);

  const migratedNames = (
    db
      .prepare(
        `SELECT name FROM characters WHERE name IN (${EXPECTED_NAMES.map(() => "?").join(",")}) ORDER BY name`,
      )
      .all(...EXPECTED_NAMES) as Array<{ name: string }>
  ).map((row) => row.name);
  if (migratedNames.length !== EXPECTED_NAMES.length) {
    throw new Error("Character verification failed after insert");
  }

  return {
    usersInserted,
    worldsInserted,
    charactersInserted,
    assetsReferenced: referencedAssetNames(data).length,
    names: migratedNames,
  };
}

function migrateUsers(rows: ExportRow[]) {
  if (rows.length !== EXPECTED_USER_COUNT) {
    throw new Error(`Expected ${EXPECTED_USER_COUNT} users, received ${rows.length}`);
  }

  const ids = rows.map((row) => Number(row.id));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Every user must have a valid positive integer id");
  }
  if (new Set(ids).size !== EXPECTED_USER_COUNT) {
    throw new Error("User ids must be unique");
  }

  const usersInserted = insertRows("users", rows);
  const db = getDb();
  const verified = db
    .prepare(
      `SELECT COUNT(*) AS count FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .get(...ids) as { count: number };
  const usersVerified = Number(verified.count);
  if (usersVerified !== EXPECTED_USER_COUNT) {
    throw new Error(
      `User verification failed: expected ${EXPECTED_USER_COUNT}, found ${usersVerified}`,
    );
  }

  return { usersInserted, usersVerified };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      action?: unknown;
      filename?: unknown;
      assetUrls?: unknown;
      users?: unknown;
    };
    if (body.action === "asset") {
      const result = await migrateAsset(String(body.filename ?? ""));
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "database") {
      const assetUrls =
        body.assetUrls && typeof body.assetUrls === "object"
          ? (body.assetUrls as Record<string, string>)
          : {};
      const result = await migrateDatabase(assetUrls);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "users") {
      if (!Array.isArray(body.users)) {
        return NextResponse.json({ error: "Invalid users payload" }, { status: 400 });
      }
      const result = migrateUsers(body.users as ExportRow[]);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[content-migration] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Migration failed" },
      { status: 500 },
    );
  }
}
