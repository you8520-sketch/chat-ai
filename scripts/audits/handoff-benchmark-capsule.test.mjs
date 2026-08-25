#!/usr/bin/env node
/**
 * Synthetic round-trip + negative fidelity tests for handoff benchmark capsule.
 * Run: npx tsx scripts/audits/handoff-benchmark-capsule.test.mjs
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import Module from "module";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import {
  ADMIN_STATUS_AFFECTS_PERSONA_PROMPT,
  buildCharacterPromptHash,
  buildPersonaPromptHash,
} from "./handoff-benchmark-capsule-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TMP = path.join(ROOT, "tmp", "handoff-benchmark-capsule-test");

function stubServerOnly() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "server-only") return {};
    return originalLoad(request, parent, isMain);
  };
}

async function seedSourceDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "development";
  stubServerOnly();
  const { getDb } = await import("../../src/lib/db.ts");
  const db = getDb();

  const userResult = db
    .prepare(
      `INSERT INTO users (email, nickname, pw_hash, is_admin, is_adult, nsfw_on, points)
       VALUES (?, ?, ?, 1, 1, 1, 0)`
    )
    .run("capsule-test-admin@local.invalid", "테스트관리자", "test-hash");
  const adminUserId = Number(userResult.lastInsertRowid);

  const loreResult = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json)
       VALUES (?, 'test-lore', '', ?)`
    )
    .run(
      adminUserId,
      JSON.stringify([{ key: "test-key", keyword: "별빛", content: "로어북 테스트 내용" }])
    );
  const lorebookId = Number(loreResult.lastInsertRowid);

  const charResult = db
    .prepare(
      `INSERT INTO characters (
         name, official, description, greeting, system_prompt, world, example_dialog,
         gender, genres, assets, content_kind, simulation_cast,
         setting_chunks, setting_chunks_en, speech_profile,
         creator_compiled_description_json, appearance_raw, appearance_compiled,
         adult_dialogue_profile, adult_status, adult_consent_modes_json,
         status_widget_json, status_window_prompt, status_widget_allow_user_override,
         lorebook_id, nsfw, creator_id, visibility, moderation_status
       ) VALUES (
         ?, 1, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?, 'public', 'approved'
       )`
    )
    .run(
      "캡슐테스트캐릭",
      "성격 설명",
      "안녕하세요.",
      "[성격]\n테스트 시스템 프롬프트",
      "테스트 세계관",
      "*별빛* \"대사 예시\"",
      "female",
      '["로맨스"]',
      "[]",
      "character",
      "",
      "[]",
      "[]",
      "",
      "",
      "",
      "",
      "auto",
      "adult",
      "[]",
      "",
      "",
      1,
      lorebookId,
      1,
      adminUserId
    );
  const characterId = Number(charResult.lastInsertRowid);

  const personaResult = db
    .prepare(
      `INSERT INTO user_personas (user_id, name, memo, gender, description, secret_description)
       VALUES (?, ?, '', ?, ?, ?)`
    )
    .run(adminUserId, "테스트페르소나", "male", "공개 설명", "비밀 설명 항목");
  const personaId = Number(personaResult.lastInsertRowid);

  return { adminUserId, characterId, personaId, lorebookId, dbPath: path.join(dataDir, "app.db") };
}

function runScript(script, env) {
  return spawnSync("npx", ["tsx", script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function parseJsonReport(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf("\n{");
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  return JSON.parse(jsonText);
}

function writeMutatedCapsule(sourcePath, destPath, mutate) {
  const capsule = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  mutate(capsule);
  fs.writeFileSync(destPath, `${JSON.stringify(capsule, null, 2)}\n`, "utf8");
}

function assertImportFidelityFailure(label, capsulePath, targetDir, expectedFalseFlag) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  const preseed = runScript("scripts/audits/handoff-benchmark-capsule-preseed-target.mjs", {
    TARGET_DATA_DIR: targetDir,
  });
  assert.equal(preseed.status, 0, `${label} preseed failed:\n${preseed.stderr}\n${preseed.stdout}`);

  const importRun = runScript("scripts/audits/import-handoff-benchmark-capsule.mjs", {
    CAPSULE_PATH: capsulePath,
    TARGET_DATA_DIR: targetDir,
  });
  assert.notEqual(importRun.status, 0, `${label} expected importer to fail`);
  const report = parseJsonReport(importRun.stdout);
  assert.equal(report.ok, false, `${label} report.ok should be false`);
  assert.equal(report[expectedFalseFlag], false, `${label} ${expectedFalseFlag} should be false`);
}

async function main() {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  const sourceDir = path.join(TMP, "source");
  const importDir = path.join(TMP, "import");
  const capsulePath = path.join(TMP, "synthetic-capsule.json");

  const seeded = await seedSourceDb(sourceDir);

  const exportRun = runScript("scripts/audits/export-handoff-benchmark-capsule.mjs", {
    SOURCE_DB_PATH: seeded.dbPath,
    SOURCE_CHARACTER_ID: String(seeded.characterId),
    SOURCE_PERSONA_ID: String(seeded.personaId),
    OUTPUT_PATH: capsulePath,
  });
  assert.equal(exportRun.status, 0, `export failed:\n${exportRun.stderr}\n${exportRun.stdout}`);
  assert.ok(fs.existsSync(capsulePath), "capsule file missing");

  const exported = JSON.parse(fs.readFileSync(capsulePath, "utf8"));
  assert.equal(exported.character.lorebook_id, undefined, "capsule character must not include lorebook_id");
  assert.equal(exported.provenance.source_lorebook_id, seeded.lorebookId);

  const preseed = runScript("scripts/audits/handoff-benchmark-capsule-preseed-target.mjs", {
    TARGET_DATA_DIR: importDir,
  });
  assert.equal(preseed.status, 0, `preseed failed:\n${preseed.stderr}\n${preseed.stdout}`);
  const preseedReport = parseJsonReport(preseed.stdout);
  assert.ok(preseedReport.preseed_lorebook_id >= 1);

  const importRun = runScript("scripts/audits/import-handoff-benchmark-capsule.mjs", {
    CAPSULE_PATH: capsulePath,
    TARGET_DATA_DIR: importDir,
  });
  assert.equal(importRun.status, 0, `import failed:\n${importRun.stderr}\n${importRun.stdout}`);

  const report = parseJsonReport(importRun.stdout);
  assert.equal(report.REAL_CHARACTER_PROMPT_DATA_EXACT, true);
  assert.equal(report.REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT, true);
  assert.equal(report.BENCHMARK_USER_CONTEXT_EXACT, true);
  assert.equal(report.ok, true);
  assert.equal(report.ADMIN_STATUS_AFFECTS_PERSONA_PROMPT, ADMIN_STATUS_AFFECTS_PERSONA_PROMPT);
  assert.notEqual(report.SOURCE_LOREBOOK_ID, report.IMPORTED_LOREBOOK_ID);
  assert.equal(report.SOURCE_LOREBOOK_ID, seeded.lorebookId);

  const importDb = new Database(path.join(importDir, "app.db"), { readonly: true });
  const importedChar = importDb
    .prepare("SELECT * FROM characters WHERE id = ?")
    .get(report.imported_character_id);
  const importedPersona = importDb
    .prepare("SELECT name, gender, description, secret_description FROM user_personas WHERE id = ?")
    .get(report.imported_persona_id);
  const importedLore = importDb
    .prepare("SELECT entries_json FROM keyword_lorebooks WHERE id = ?")
    .get(importedChar.lorebook_id);
  importDb.close();

  const sourceDb = new Database(seeded.dbPath, { readonly: true });
  const sourceChar = sourceDb.prepare("SELECT * FROM characters WHERE id = ?").get(seeded.characterId);
  const sourcePersona = sourceDb
    .prepare("SELECT name, gender, description, secret_description FROM user_personas WHERE id = ?")
    .get(seeded.personaId);
  const sourceLore = sourceDb
    .prepare("SELECT entries_json FROM keyword_lorebooks WHERE id = ?")
    .get(sourceChar.lorebook_id);
  sourceDb.close();

  assert.notEqual(sourceChar.lorebook_id, importedChar.lorebook_id);
  assert.equal(sourceLore?.entries_json, importedLore?.entries_json);
  assert.equal(
    buildCharacterPromptHash(importedChar, importedLore?.entries_json),
    buildCharacterPromptHash(sourceChar, sourceLore?.entries_json)
  );
  assert.equal(buildPersonaPromptHash(importedPersona), buildPersonaPromptHash(sourcePersona));

  const changedCharacterPath = path.join(TMP, "changed-character.json");
  writeMutatedCapsule(capsulePath, changedCharacterPath, (capsule) => {
    capsule.character.name = `${capsule.character.name}-mutated`;
  });
  assertImportFidelityFailure(
    "changed character prompt field",
    changedCharacterPath,
    path.join(TMP, "neg-character"),
    "REAL_CHARACTER_PROMPT_DATA_EXACT"
  );

  const changedPersonaPath = path.join(TMP, "changed-persona.json");
  writeMutatedCapsule(capsulePath, changedPersonaPath, (capsule) => {
    capsule.persona.description = `${capsule.persona.description}-mutated`;
  });
  assertImportFidelityFailure(
    "changed persona prompt field",
    changedPersonaPath,
    path.join(TMP, "neg-persona"),
    "REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT"
  );

  const changedUserContextPath = path.join(TMP, "changed-user-context.json");
  writeMutatedCapsule(capsulePath, changedUserContextPath, (capsule) => {
    capsule.benchmark_user_context.nickname = `${capsule.benchmark_user_context.nickname}-mutated`;
  });
  assertImportFidelityFailure(
    "changed benchmark user context field",
    changedUserContextPath,
    path.join(TMP, "neg-user-context"),
    "BENCHMARK_USER_CONTEXT_EXACT"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        SOURCE_LOREBOOK_ID: report.SOURCE_LOREBOOK_ID,
        IMPORTED_LOREBOOK_ID: report.IMPORTED_LOREBOOK_ID,
        REAL_CHARACTER_PROMPT_DATA_EXACT: true,
        REAL_ADMIN_PERSONA_PROMPT_DATA_EXACT: true,
        BENCHMARK_USER_CONTEXT_EXACT: true,
        negative_fidelity_detected: [
          "character_prompt_field",
          "persona_prompt_field",
          "benchmark_user_context_field",
        ],
      },
      null,
      2
    )
  );
  console.log("handoff-benchmark-capsule.test.mjs: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
