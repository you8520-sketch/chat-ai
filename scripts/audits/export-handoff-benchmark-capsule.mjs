#!/usr/bin/env node
/**
 * Read-only export of prompt-relevant character + admin-owned persona for handoff benchmark.
 *
 * Usage:
 *   SOURCE_DB_PATH=/path/to/production-copy.db \
 *   SOURCE_CHARACTER_ID=18 \
 *   SOURCE_PERSONA_ID=42 \
 *   npx tsx scripts/audits/export-handoff-benchmark-capsule.mjs
 *
 * Optional:
 *   SOURCE_ADMIN_USER_ID=7
 *   OUTPUT_PATH=./handoff-benchmark-capsule.json
 *   ADMIN_EMAILS=admin@example.com   (for admin resolution when is_admin=0)
 *
 * NEVER imported by production runtime. Do NOT commit the exported capsule.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import {
  ADMIN_STATUS_AFFECTS_PERSONA_PROMPT,
  BENCHMARK_USER_CONTEXT_FIELDS,
  CAPSULE_SCHEMA_VERSION,
  CHARACTER_LISTABILITY_FIELDS,
  CHARACTER_ROW_PROMPT_FIELDS,
  LISTABLE_WHERE_SQL,
  PERSONA_PROMPT_FIELDS,
  buildBenchmarkUserContextHash,
  buildCharacterPromptHash,
  buildPersonaPromptHash,
  isAdminUser,
  isCharacterListable,
  loadKeywordLorebookEntries,
  parseArgs,
  pickFields,
  requirePositiveInt,
  tableExists,
} from "./handoff-benchmark-capsule-lib.mjs";

const { env } = parseArgs(process.argv.slice(2));

function resolveOutputPath() {
  const raw = env.OUTPUT_PATH ?? env.output_path ?? "handoff-benchmark-capsule.json";
  return path.resolve(raw);
}

function main() {
  const sourceDbPath = env.SOURCE_DB_PATH ?? env.source_db_path;
  if (!sourceDbPath) {
    console.error("SOURCE_DB_PATH is required");
    process.exit(1);
  }
  const resolvedDb = path.resolve(sourceDbPath);
  if (!fs.existsSync(resolvedDb)) {
    console.error(`SOURCE_DB_PATH not found: ${resolvedDb}`);
    process.exit(1);
  }

  const characterId = requirePositiveInt(
    env.SOURCE_CHARACTER_ID ?? env.source_character_id,
    "SOURCE_CHARACTER_ID"
  );
  const personaId = requirePositiveInt(
    env.SOURCE_PERSONA_ID ?? env.source_persona_id,
    "SOURCE_PERSONA_ID"
  );
  const optionalAdminUserId =
    env.SOURCE_ADMIN_USER_ID ?? env.source_admin_user_id
      ? requirePositiveInt(
          env.SOURCE_ADMIN_USER_ID ?? env.source_admin_user_id,
          "SOURCE_ADMIN_USER_ID"
        )
      : null;

  const db = new Database(resolvedDb, { readonly: true, fileMustExist: true });

  try {
    if (!tableExists(db, "characters") || !tableExists(db, "user_personas") || !tableExists(db, "users")) {
      throw new Error("Source DB missing required tables (characters, user_personas, users)");
    }

    const characterSelect = [
      "id",
      "lorebook_id",
      ...CHARACTER_ROW_PROMPT_FIELDS,
      ...CHARACTER_LISTABILITY_FIELDS,
    ].join(", ");
    const characterRow = db
      .prepare(`SELECT ${characterSelect} FROM characters WHERE id = ?`)
      .get(characterId);
    if (!characterRow) {
      throw new Error(`Character ${characterId} not found in ${resolvedDb}`);
    }

    const listableCheck = db
      .prepare(`SELECT id FROM characters WHERE id = ? AND ${LISTABLE_WHERE_SQL}`)
      .get(characterId);
    if (!listableCheck) {
      throw new Error(
        `Character ${characterId} fails current home/discovery listability predicate (${LISTABLE_WHERE_SQL})`
      );
    }
    if (!isCharacterListable(characterRow)) {
      throw new Error(`Character ${characterId} listability in-memory check failed`);
    }

    const personaRow = db
      .prepare(
        `SELECT id, user_id, ${PERSONA_PROMPT_FIELDS.join(", ")} FROM user_personas WHERE id = ?`
      )
      .get(personaId);
    if (!personaRow) {
      throw new Error(`Persona ${personaId} not found in ${resolvedDb}`);
    }

    const ownerUserId = personaRow.user_id;
    if (optionalAdminUserId != null && ownerUserId !== optionalAdminUserId) {
      throw new Error(
        `Persona ${personaId} is owned by user ${ownerUserId}, not SOURCE_ADMIN_USER_ID=${optionalAdminUserId}`
      );
    }

    const ownerRow = db
      .prepare("SELECT id, is_admin, nickname, is_adult FROM users WHERE id = ?")
      .get(ownerUserId);
    if (!ownerRow) {
      throw new Error(`Persona owner user ${ownerUserId} not found`);
    }

    const ownerEmailRow = db
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(ownerUserId);
    const adminResolved = isAdminUser(
      { is_admin: ownerRow.is_admin, email: ownerEmailRow?.email ?? "" },
      env
    );
    if (!adminResolved) {
      throw new Error(
        `Persona ${personaId} owner (user_id=${ownerUserId}) is not an administrator per isAdminUser(is_admin | ADMIN_EMAILS)`
      );
    }

    const keywordLorebookEntriesJson = loadKeywordLorebookEntries(db, characterRow.lorebook_id);
    const characterPromptSha = buildCharacterPromptHash(characterRow, keywordLorebookEntriesJson);
    const personaPromptSha = buildPersonaPromptHash(personaRow);
    const benchmarkUserContext = pickFields(ownerRow, BENCHMARK_USER_CONTEXT_FIELDS);
    const benchmarkUserContextSha = buildBenchmarkUserContextHash(ownerRow);

    const capsule = {
      schema_version: CAPSULE_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      admin_status_affects_persona_prompt: ADMIN_STATUS_AFFECTS_PERSONA_PROMPT,
      provenance: {
        source_db_path_basename: path.basename(resolvedDb),
        source_character_id: characterId,
        source_persona_id: personaId,
        source_lorebook_id: characterRow.lorebook_id ?? null,
        source_character_prompt_sha256: characterPromptSha,
        source_persona_prompt_sha256: personaPromptSha,
        source_benchmark_user_context_sha256: benchmarkUserContextSha,
      },
      safety_checks: {
        character_listable: true,
        persona_admin_owned: true,
        privacy: {
          excluded: [
            "email",
            "password_hash",
            "sessions",
            "points",
            "billing",
            "chats",
            "messages",
            "other_personas",
            "other_users",
          ],
        },
      },
      benchmark_user_context: benchmarkUserContext,
      character: pickFields(characterRow, CHARACTER_ROW_PROMPT_FIELDS),
      persona: pickFields(personaRow, PERSONA_PROMPT_FIELDS),
      keyword_lorebook:
        keywordLorebookEntriesJson != null && String(keywordLorebookEntriesJson).trim()
          ? { entries_json: keywordLorebookEntriesJson }
          : null,
    };

    const outputPath = resolveOutputPath();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(capsule, null, 2)}\n`, "utf8");

    console.log(JSON.stringify({
      ok: true,
      output_path: outputPath,
      ADMIN_STATUS_AFFECTS_PERSONA_PROMPT,
      source_character_id: characterId,
      source_persona_id: personaId,
      source_lorebook_id: characterRow.lorebook_id ?? null,
      source_character_prompt_sha256: characterPromptSha,
      source_persona_prompt_sha256: personaPromptSha,
      character_listable: true,
      persona_admin_owned: true,
    }, null, 2));
  } finally {
    db.close();
  }
}

main();
