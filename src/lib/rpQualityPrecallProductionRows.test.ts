import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  identityHashesFromRows,
  paidRunnerIdentityHashesMatchProof,
} from "../../scripts/lib/rpQualityPaidRunnerPrepare";
import {
  PRECALL_CHARACTER_COLUMNS,
  PrecallRowsStop,
  loadPrecallProductionRows,
} from "../../scripts/lib/rpQualityPrecallProductionRows";

const DEPLOY_SHA = "a1".repeat(20);
const PR_HEAD = "b2".repeat(20);
const RAW_GREETING =
  "SYNTHETIC-GREETING-ALPHA 창문 너머로 늦은 오후의 빛이 길게 들어와 책상 위에 번졌다. SYNTHETIC-GREETING-OMEGA";
const RAW_SYSTEM = "SYNTHETIC-SYSTEM-PROMPT-LINE 라이크는 말수가 적고 상대의 말을 끝까지 듣는다.";
const RAW_NOTE = "SYNTHETIC-USER-NOTE-SENTENCE 조용한 분위기를 선호한다.";
const RAW_LORE = "SYNTHETIC-LOREBOOK-CONTENT-SENTENCE 도시의 야경은 늘 비에 젖어 있다.";
const RAW_EXTRA_COLUMN = "SYNTHETIC-UNUSED-COLUMN-VALUE";
const RAW_EMAIL = "synthetic-admin@example.invalid";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function runPrecallRunner(args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    execFile(
      process.execPath,
      ["--no-warnings", "--conditions=react-server", "--import", "tsx", "scripts/rp-quality-precall-final-wire.ts", ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          RAILWAY_GIT_COMMIT_SHA: DEPLOY_SHA,
          OPENROUTER_API_KEY: "sk-test-not-a-real-key-0000",
          DATA_DIR: "/must-not-be-used",
        },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      },
      (error, stdout, stderr) =>
        resolve({ stdout, stderr, code: error ? ((error as { code?: number }).code ?? 1) : 0 })
    );
  });
}

function buildSyntheticDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY, name TEXT, description TEXT, system_prompt TEXT, world TEXT,
      example_dialog TEXT, greeting TEXT, gender TEXT, content_kind TEXT, speech_profile TEXT,
      speech_personality TEXT, speech_traits TEXT, narration_style_instructions TEXT,
      jsx_components_json TEXT, creator_compiled_description_json TEXT, creator_canon_plan_json TEXT,
      adult_consent_modes_json TEXT, status_widget_json TEXT, status_widget_allow_user_override INTEGER,
      genres TEXT, assets TEXT, simulation_cast TEXT, setting_chunks TEXT, setting_chunks_en TEXT,
      prompt_translation_hash TEXT, appearance_raw TEXT, appearance_compiled TEXT, updated_at TEXT,
      unused_secret_column TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, nickname TEXT, user_note TEXT, sub_until TEXT, sub_plan TEXT,
      account_kind TEXT, is_admin INTEGER, email TEXT
    );
    CREATE TABLE user_status_widget_presets (id INTEGER PRIMARY KEY, user_id INTEGER, widget_json TEXT);
    CREATE TABLE user_personas (
      id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, gender TEXT, description TEXT,
      active_status_widget_preset_id INTEGER
    );
    CREATE TABLE character_lorebook_attachments (character_id INTEGER);
    CREATE TABLE global_lorebook_entries (
      id INTEGER PRIMARY KEY, name TEXT, triggers_json TEXT, content TEXT, depth INTEGER,
      enabled INTEGER, sort_order INTEGER
    );
    CREATE TABLE billing_fx_daily_snapshots (date_key TEXT, base_usd_krw REAL, source TEXT, fetched_at TEXT);
  `);
  db.prepare(
    `INSERT INTO characters (id, name, description, system_prompt, world, greeting, gender, content_kind,
       setting_chunks, status_widget_allow_user_override, genres, assets, unused_secret_column)
     VALUES (18, '라이크', '설명', ?, '세계관', ?, 'male', 'character', '', 1, '[]', '[]', ?)`
  ).run(RAW_SYSTEM, RAW_GREETING, RAW_EXTRA_COLUMN);
  db.prepare(
    "INSERT INTO users (id, nickname, user_note, account_kind, is_admin, email) VALUES (1, '관리자', ?, '', 1, ?)"
  ).run(RAW_NOTE, RAW_EMAIL);
  db.prepare(
    "INSERT INTO user_personas (id, user_id, name, gender, description) VALUES (5, 1, '렌', 'male', '조용한 사람')"
  ).run();
  db.prepare(
    "INSERT INTO global_lorebook_entries VALUES (1, '도시', '[\"야경\"]', ?, 1, 1, 1)"
  ).run(RAW_LORE);
  db.prepare("INSERT INTO billing_fx_daily_snapshots VALUES ('2026-10-08', 1300, 'api_daily', '2026-10-07T18:00:00.000Z')").run();
  db.close();
}

describe("rp quality PRECALL production rows boundary", () => {
  let dir = "";
  let dbFile = "";

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "precall-rows-test-"));
    dbFile = path.join(dir, "app.db");
    buildSyntheticDb(dbFile);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("selects a fixed column list, never SELECT *, and leaves the DB file byte-identical", () => {
    const before = sha256(readFileSync(dbFile).toString("base64"));
    const loaded = loadPrecallProductionRows({ dbPath: dbFile, deployedGitSha: DEPLOY_SHA, env: {} });
    assert.equal(sha256(readFileSync(dbFile).toString("base64")), before);
    const keys = Object.keys(loaded.rows.character);
    assert.ok(!keys.includes("unused_secret_column"));
    assert.ok(keys.every((key) => (PRECALL_CHARACTER_COLUMNS as readonly string[]).includes(key)));
    assert.equal(JSON.stringify(loaded.rows).includes(RAW_EXTRA_COLUMN), false);
    assert.equal(JSON.stringify(loaded.rows).includes(RAW_EMAIL), false);
    assert.equal(loaded.proof.greetingSha256, sha256(RAW_GREETING));
    const rowHashes = identityHashesFromRows(loaded.rows);
    assert.equal(
      paidRunnerIdentityHashesMatchProof(rowHashes, {
        greetingSha256: loaded.proof.greetingSha256,
        systemPromptSha256: loaded.proof.systemPromptSha256,
        worldSha256: loaded.proof.worldSha256,
        settingChunksSha256: loaded.proof.settingChunksSha256,
        personaPublicSha256: loaded.proof.personaPublicSha256,
      }),
      true
    );
    assert.equal(loaded.proof.deployedGitSha, DEPLOY_SHA);
    assert.equal(loaded.dbReadOnly && loaded.queryOnly && loaded.singleReadTransaction, true);
  });

  it("refuses an invalid deploy SHA and a wrong target without leaking row content", () => {
    assert.throws(
      () => loadPrecallProductionRows({ dbPath: dbFile, deployedGitSha: "short", env: {} }),
      (error: unknown) => error instanceof PrecallRowsStop && error.code === "DEPLOY_SHA_INVALID"
    );
    const wrong = path.join(dir, "wrong.db");
    buildSyntheticDb(wrong);
    const db = new DatabaseSync(wrong);
    db.exec("UPDATE characters SET name = '다른캐릭터'");
    db.close();
    assert.throws(
      () => loadPrecallProductionRows({ dbPath: wrong, deployedGitSha: DEPLOY_SHA, env: {} }),
      (error: unknown) =>
        error instanceof PrecallRowsStop &&
        error.code === "CHARACTER_IDENTITY_MISMATCH" &&
        !error.message.includes("다른캐릭터")
    );
  });

  it("overlay refuses expectedDeploySha === prHead; deployed reseals same SHA without a fake PR head", async () => {
    const sameSha = await runPrecallRunner([
      "--verification-mode",
      "overlay",
      "--expected-deploy-sha",
      DEPLOY_SHA,
      "--pr-head",
      DEPLOY_SHA,
      "--db-path",
      dbFile,
    ]);
    const sameReport = JSON.parse(sameSha.stdout) as { ok: boolean; code: string };
    assert.equal(sameReport.ok, false);
    assert.equal(sameReport.code, "EXPECTED_SHA_IS_PR_HEAD_NOT_PRODUCTION");
    assert.equal(sameSha.code, 2);

    const withPrHead = await runPrecallRunner([
      "--verification-mode",
      "deployed",
      "--expected-deploy-sha",
      DEPLOY_SHA,
      "--pr-head",
      PR_HEAD,
      "--db-path",
      dbFile,
    ]);
    const forbidden = JSON.parse(withPrHead.stdout) as { ok: boolean; code: string };
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.code, "DEPLOYED_MODE_FORBIDS_PR_HEAD");

    const deployed = await runPrecallRunner([
      "--verification-mode",
      "deployed",
      "--expected-deploy-sha",
      DEPLOY_SHA,
      "--main-sha",
      DEPLOY_SHA,
      "--live-transport-included",
      "--db-path",
      dbFile,
    ]);
    const report = JSON.parse(deployed.stdout) as Record<string, any>;
    assert.equal(report.ok, true, deployed.stdout.slice(0, 400));
    assert.equal(report.verificationMode, "deployed");
    assert.equal(report.codeSource, "container_tree");
    assert.equal(report.assemblySourceSha, DEPLOY_SHA);
    assert.equal(report.paidRunnerPreapproval.assemblySourceSha, DEPLOY_SHA);
    assert.equal(report.providerPosts, 0);
    assert.equal(JSON.stringify(report).includes('"requestBody"'), false);
  });

  it("runner end-to-end: 12 plans, metadata only, zero unexpected egress, DB untouched", async () => {
    const before = readFileSync(dbFile).toString("base64");
    const run = await runPrecallRunner([
      "--expected-deploy-sha",
      DEPLOY_SHA,
      "--pr-head",
      PR_HEAD,
      "--db-path",
      dbFile,
    ]);
    assert.equal(run.stderr.includes("SYNTHETIC-"), false);
    const report = JSON.parse(run.stdout) as Record<string, any>;
    assert.equal(report.ok, true, run.stdout.slice(0, 400));
    assert.equal(run.code, 0);
    assert.equal(report.finalWire.plans.length, 12);
    assert.equal(report.providerPosts, 0);
    assert.equal(report.egress.unexpectedAttempts, 0);
    assert.equal(report.egress.transmitted, 0);
    assert.equal(report.dbWrites, 0);
    assert.equal(report.scratchDataDir.filesFromModuleInit, 0);
    assert.equal(report.scores, null);
    assert.equal(report.rawSourceTextPrinted, false);
    assert.equal(report.productionDbAccess.rawRowsLeftProcess, false);
    for (const plan of report.finalWire.plans) assert.equal(plan.adapter.maxTokensPresent, false);
    for (const raw of [RAW_GREETING, RAW_SYSTEM, RAW_NOTE, RAW_LORE, RAW_EXTRA_COLUMN, RAW_EMAIL]) {
      for (let offset = 0; offset + 24 <= raw.length; offset += 12) {
        assert.equal(run.stdout.includes(raw.slice(offset, offset + 24)), false, "raw source in output");
      }
    }
    assert.equal(readFileSync(dbFile).toString("base64"), before);
    assert.equal(report.paidRunnerPreapproval.manifest.calls.length, 12);
    assert.equal(report.paidRunnerPreapproval.approvalStatus, "NOT_APPROVED");
    assert.equal(report.paidRunnerPreapproval.sealedBodiesExported, false);
    assert.equal(report.paidRunnerPreapproval.providerPosts, 0);
    assert.equal(JSON.stringify(report).includes('"requestBody"'), false);
    assert.equal(report.paidRunnerPreapproval.decision.decision, "BLOCKED_DEPLOYMENT");
  });
});
