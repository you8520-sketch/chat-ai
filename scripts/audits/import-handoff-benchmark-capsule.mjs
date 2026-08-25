#!/usr/bin/env node
/**
 * Import handoff-benchmark-capsule.json into an isolated local benchmark DB.
 *
 * Usage:
 *   CAPSULE_PATH=./handoff-benchmark-capsule.json \
 *   TARGET_DATA_DIR=./data/handoff-benchmark-import \
 *   npx tsx scripts/audits/import-handoff-benchmark-capsule.mjs
 *
 * Creates a disposable benchmark user (fixed local email — not from production).
 * NEVER imported by production runtime.
 */

import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import {
  ADMIN_STATUS_AFFECTS_PERSONA_PROMPT,
  BENCHMARK_USER_CONTEXT_FIELDS,
  CAPSULE_SCHEMA_VERSION,
  CHARACTER_PROMPT_FIELDS,
  PERSONA_PROMPT_FIELDS,
  buildBenchmarkUserContextHash,
  buildCharacterPromptHash,
  buildPersonaPromptHash,
  loadKeywordLorebookEntries,
  parseArgs,
  pickFields,
  tableExists,
} from "./handoff-benchmark-capsule-lib.mjs";

const { env } = parseArgs(process.argv.slice(2));

const BENCHMARK_USER_EMAIL = "handoff-benchmark-capsule@local.invalid";

function stubServerOnly() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "server-only") return {};
    return originalLoad(request, parent, isMain);
  };
}

async function bootstrapTargetDb(targetDataDir) {
  fs.mkdirSync(targetDataDir, { recursive: true });
  process.env.DATA_DIR = targetDataDir;
  process.env.NODE_ENV = "development";
  stubServerOnly();
  const { getDb } = await import("../../src/lib/db.ts");
  return getDb();
}

function readCapsule(capsulePath) {
  const resolved = path.resolve(capsulePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`CAPSULE_PATH not found: ${resolved}`);
  }
  const capsule = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (capsule.schema_version !== CAPSULE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported capsule schema_version=${capsule.schema_version} (expected ${CAPSULE_SCHEMA_VERSION})`
    );
  }
  return { capsule, resolved };
}

function insertKeywordLorebook(db, entriesJson) {
  if (!entriesJson || !String(entriesJson).trim()) return null;
  if (!tableExists(db, "keyword_lorebooks")) {
    throw new Error("Target DB missing keyword_lorebooks table");
  }
  const result = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json)
       VALUES (0, 'benchmark-capsule-lorebook', '', ?)`
    )
    .run(entriesJson);
  return Number(result.lastInsertRowid);
}

function insertCharacter(db, character, lorebookId) {
  const columns = [...CHARACTER_PROMPT_FIELDS];
  const values = columns.map((col) => {
    if (col === "lorebook_id") return lorebookId;
    return character[col] ?? (col === "participant_min_age" || col === "nsfw" ? null : "");
  });
  const placeholders = columns.map(() => "?").join(", ");
  const result = db
    .prepare(`INSERT INTO characters (${columns.join(", ")}) VALUES (${placeholders})`)
    .run(...values);
  return Number(result.lastInsertRowid);
}

function ensureBenchmarkUser(db, benchmarkUserContext) {
  const existing = db
    .prepare("SELECT id, nickname, is_adult FROM users WHERE email = ?")
    .get(BENCHMARK_USER_EMAIL);
  const nickname = benchmarkUserContext?.nickname ?? "벤치마크";
  const isAdult = Number(benchmarkUserContext?.is_adult ?? 0) ? 1 : 0;
  if (existing) {
    db.prepare("UPDATE users SET nickname = ?, is_adult = ?, is_admin = 0 WHERE id = ?").run(
      nickname,
      isAdult,
      existing.id
    );
    return existing.id;
  }
  const result = db
    .prepare(
      `INSERT INTO users (email, nickname, pw_hash, is_admin, is_adult, nsfw_on, points)
       VALUES (?, ?, ?, 0, ?, 0, 0)`
    )
    .run(BENCHMARK_USER_EMAIL, nickname, "benchmark-capsule-no-login", isAdult);
  return Number(result.lastInsertRowid);
}

function insertPersona(db, userId, persona) {
  const result = db
    .prepare(
      `INSERT INTO user_personas (user_id, name, memo, gender, description, secret_description)
       VALUES (?, ?, '', ?, ?, ?)`
    )
    .run(
      userId,
      persona.name ?? "",
      persona.gender ?? "other",
      persona.description ?? "",
      persona.secret_description ?? ""
    );
  return Number(result.lastInsertRowid);
}

function loadImportedCharacterRow(db, characterId) {
  const cols = CHARACTER_PROMPT_FIELDS.join(", ");
  return db.prepare(`SELECT ${cols} FROM characters WHERE id = ?`).get(characterId);
}

function loadImportedPersonaRow(db, personaId) {
  const cols = PERSONA_PROMPT_FIELDS.join(", ");
  return db.prepare(`SELECT ${cols} FROM user_personas WHERE id = ?`).get(personaId);
}

function loadImportedBenchmarkUserRow(db, userId) {
  const cols = BENCHMARK_USER_CONTEXT_FIELDS.join(", ");
  return db.prepare(`SELECT ${cols} FROM users WHERE id = ?`).get(userId);
}

async function main() {
  const capsulePath = env.CAPSULE_PATH ?? env.capsule_path ?? "handoff-benchmark-capsule.json";
  const targetDataDir = path.resolve(
    env.TARGET_DATA_DIR ?? env.target_data_dir ?? "data/handoff-benchmark-import"
  );

  const { capsule, resolved: capsuleFile } = readCapsule(capsulePath);

  if (capsule.admin_status_affects_persona_prompt !== ADMIN_STATUS_AFFECTS_PERSONA_PROMPT) {
    throw new Error(
      "Capsule admin_status_affects_persona_prompt disagrees with current audit lib constant"
    );
  }

  const db = await bootstrapTargetDb(targetDataDir);

  const keywordEntries = capsule.keyword_lorebook?.entries_json ?? null;
  const lorebookId = insertKeywordLorebook(db, keywordEntries);
  const importedCharacterId = insertCharacter(db, capsule.character, lorebookId);
  const benchmarkUserId = ensureBenchmarkUser(db, capsule.benchmark_user_context);
  const importedPersonaId = insertPersona(db, benchmarkUserId, capsule.persona);

  const importedCharacterRow = loadImportedCharacterRow(db, importedCharacterId);
  const importedPersonaRow = loadImportedPersonaRow(db, importedPersonaId);
  const importedUserRow = loadImportedBenchmarkUserRow(db, benchmarkUserId);

  const importedKeywordJson = loadKeywordLorebookEntries(db, importedCharacterRow.lorebook_id);
  const importedCharacterSha = buildCharacterPromptHash(importedCharacterRow, importedKeywordJson);
  const importedPersonaSha = buildPersonaPromptHash(importedPersonaRow);
  const importedUserContextSha = buildBenchmarkUserContextHash(importedUserRow);

  const sourceCharacterSha = capsule.provenance?.source_character_prompt_sha256;
  const sourcePersonaSha = capsule.provenance?.source_persona_prompt_sha256;
  const sourceUserContextSha = capsule.provenance?.source_benchmark_user_context_sha256;

  const REAL_CHARACTER_PROMPT_DATA_EXACT = importedCharacterSha === sourceCharacterSha;
  const REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT = importedPersonaSha === sourcePersonaSha;
  const BENCHMARK_USER_CONTEXT_EXACT =
    sourceUserContextSha == null || importedUserContextSha === sourceUserContextSha;

  const report = {
    ok: REAL_CHARACTER_PROMPT_DATA_EXACT && REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT,
    capsule_path: capsuleFile,
    target_data_dir: targetDataDir,
    target_db_path: path.join(targetDataDir, "app.db"),
    ADMIN_STATUS_AFFECTS_PERSONA_PROMPT,
    imported_character_id: importedCharacterId,
    imported_persona_id: importedPersonaId,
    imported_benchmark_user_id: benchmarkUserId,
    CHARACTER_PROMPT_SOURCE_SHA: sourceCharacterSha,
    CHARACTER_PROMPT_IMPORTED_SHA: importedCharacterSha,
    PERSONA_PROMPT_SOURCE_SHA: sourcePersonaSha,
    PERSONA_PROMPT_IMPORTED_SHA: importedPersonaSha,
    BENCHMARK_USER_CONTEXT_SOURCE_SHA: sourceUserContextSha ?? null,
    BENCHMARK_USER_CONTEXT_IMPORTED_SHA: importedUserContextSha,
    REAL_CHARACTER_PROMPT_DATA_EXACT,
    REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT,
    BENCHMARK_USER_CONTEXT_EXACT,
    normalization:
      "SHA-256 of sorted-key JSON after SQLite null/string/int normalization (see handoff-benchmark-capsule-lib.mjs)",
    provenance: capsule.provenance,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!REAL_CHARACTER_PROMPT_DATA_EXACT || !REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
