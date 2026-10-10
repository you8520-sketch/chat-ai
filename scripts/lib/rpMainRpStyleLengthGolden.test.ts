import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { RP_QUALITY_PRECALL_PLANNED_CALLS } from "@/lib/rpQualityPrecall";
import {
  MainRpStyleLengthFixtureError,
  assertMainRpStyleLengthIdentity,
} from "@/lib/rpMainRpStyleLengthFixture";
import { runRpActiveModelQualityLive } from "./rpActiveModelQualityLive";
import { loadPrecallProductionRows, PrecallRowsStop } from "./rpQualityPrecallProductionRows";
import {
  assembleMainRpStyleLengthSnapshot,
  dryRunMainRpStyleLengthEvaluation,
  evaluateOwnedProductionRequestParity,
  persistMainRpStyleLengthGolden,
  publicGoldenStdout,
  reloadMainRpStyleLengthGolden,
  sealedSnapshotFingerprint,
  type OwnedProductionRequestParity,
} from "./rpMainRpStyleLengthGolden";

const DEPLOY_SHA = "e1fdab509d2e9713be617025f77ea40a5bfb85f5";

function evaluateOwnedParityInIsolatedProcess(input: {
  dbPath: string;
  deployedGitSha: string;
  callerEnv: Record<string, string | undefined>;
  processRailwaySha: string | null;
  version: number;
  root: string;
}): OwnedProductionRequestParity {
  const probe = path.join(input.root, "runtime-sha-probe.mts");
  const payload = {
    dbPath: input.dbPath,
    deployedGitSha: input.deployedGitSha,
    env: input.callerEnv,
    version: input.version,
    root: input.root,
  };
  const outFile = path.join(input.root, "runtime-sha-probe.json");
  writeFileSync(
    probe,
    `import { writeFileSync } from "node:fs";
import { evaluateOwnedProductionRequestParity } from ${JSON.stringify(
      path.resolve("scripts/lib/rpMainRpStyleLengthGolden.ts")
    )};
const result = evaluateOwnedProductionRequestParity(${JSON.stringify(payload)});
writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(result));
`
  );
  const childEnv = { ...process.env };
  if (input.processRailwaySha == null) delete childEnv.RAILWAY_GIT_COMMIT_SHA;
  else childEnv.RAILWAY_GIT_COMMIT_SHA = input.processRailwaySha;
  execFileSync(
    process.execPath,
    [
      "--no-warnings",
      "--conditions=react-server",
      "--import",
      "tsx",
      "--import",
      "./src/lib/test/regularTestEgressPolicy.ts",
      probe,
    ],
    { encoding: "utf8", cwd: process.cwd(), env: childEnv }
  );
  return JSON.parse(readFileSync(outFile, "utf8")) as OwnedProductionRequestParity;
}

function buildSyntheticDb(file: string, opts?: { characterId?: number; personaName?: string }): void {
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
      nsfw INTEGER, official INTEGER
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
       setting_chunks, status_widget_allow_user_override, genres, assets, nsfw, official)
     VALUES (?, '라이크', '설명', '시스템', '세계관', '인사', 'male', 'character', '', 1, '[]', '[]', 1, 0)`
  ).run(opts?.characterId ?? 18);
  db.prepare(
    "INSERT INTO users (id, nickname, user_note, account_kind, is_admin, email) VALUES (1, '관리자', '', '', 1, 'hidden@example.invalid')"
  ).run();
  db.prepare(
    "INSERT INTO user_personas (id, user_id, name, gender, description) VALUES (1, 1, ?, 'male', '조용한 사람')"
  ).run(opts?.personaName ?? "렌");
  db.prepare("INSERT INTO billing_fx_daily_snapshots VALUES ('2026-10-08', 1300, 'api_daily', '2026-10-07T18:00:00.000Z')").run();
  db.close();
}

describe("MAIN_RP_STYLE_LENGTH golden operator", () => {
  let dir = "";

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "golden-op-"));
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("assembles, persists, and reloads the same 라이크18/렌 snapshot", async () => {
    const dbFile = path.join(dir, "app.db");
    buildSyntheticDb(dbFile);
    const before = readFileSync(dbFile);
    const loaded = loadPrecallProductionRows({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      env: {},
    });
    const assembled = assembleMainRpStyleLengthSnapshot({
      rows: loaded.rows,
      deployedGitSha: DEPLOY_SHA,
      version: 1,
      listing: { nsfwListing: 1, officialListing: 0, greetingChars: 2 },
      personaPublicChars: loaded.proof.personaPublicChars,
      fixtureKind: "CURRENT_LIVE",
      adminVerified:
        Number(loaded.rows.user.id) > 0 &&
        Number(loaded.proof.personaId) > 0 &&
        loaded.proof.personaName === "렌" &&
        loaded.proof.characterId === 18,
    });
    assert.equal(assembled.publicManifest.characterId, 18);
    assert.equal(assembled.publicManifest.personaId, 1);
    assert.equal(assembled.publicManifest.personaName, "렌");
    assert.equal(assembled.publicManifest.sealedRequestCount, RP_QUALITY_PRECALL_PLANNED_CALLS);
    assert.deepEqual(assembled.publicManifest.models, [...MAIN_RP_MODEL_IDS]);
    assert.equal(assembled.publicManifest.qualityScores, null);
    const root = path.join(dir, "private");
    const persisted = persistMainRpStyleLengthGolden({
      root,
      version: 1,
      sealed: assembled.sealed,
      publicManifest: { ...assembled.publicManifest, privateStore: `${root}/v1` },
    });
    const reloaded = reloadMainRpStyleLengthGolden({ root, version: 1 });
    assert.equal(reloaded.sealedSha256, persisted.sealedSha256);
    assert.equal(sealedSnapshotFingerprint(reloaded.sealed), persisted.sealedSha256);
    assert.deepEqual(reloaded.sealed, assembled.sealed);
    assert.equal(readFileSync(dbFile).equals(before), true);
    const stdout = publicGoldenStdout({
      action: "reload",
      publicManifest: reloaded.publicManifest,
      sealedSha256: reloaded.sealedSha256,
    });
    assert.doesNotMatch(stdout, /hidden@example.invalid|시스템|세계관|조용한 사람/);
    assert.match(stdout, /MAIN_RP_STYLE_LENGTH/);
    const dry = await dryRunMainRpStyleLengthEvaluation({
      mode: "GOLDEN_SNAPSHOT",
      version: 1,
      root,
    });
    assert.equal(dry.seal.ok, true);
    assert.equal(dry.requestBodiesPresent, true);
    assert.equal(dry.sealedCalls.length, RP_QUALITY_PRECALL_PLANNED_CALLS);
    assert.equal(dry.providerPosts, 0);
    assert.equal(dry.transportPosts, 12);
    assert.equal(dry.networkAttempts, 0);
    assert.equal(dry.dbWrites, 0);
    assert.equal(dry.publicManifest.characterId, 18);
    assert.equal(dry.publicManifest.personaId, 1);
    assert.equal(dry.sealedSha256, persisted.sealedSha256);
    for (const call of dry.sealedCalls) {
      assert.ok(call.requestBody && Object.keys(call.requestBody).length > 0);
      assert.equal(call.finalWireFingerprint.length, 64);
    }
    const report = await runRpActiveModelQualityLive({
      credentials: { cheaperinference: "", openrouter: "" },
      runId: "unit-style-length",
      source: "GOLDEN_SNAPSHOT",
      goldenRoot: root,
      goldenVersion: 1,
    });
    assert.equal(report.providerCalls, 0);
    assert.equal(report.qualityScoreGenerated, false);
    if (!("fixtureKind" in report.source)) throw new Error("expected golden source");
    assert.equal(report.source.fixtureKind, "GOLDEN_SNAPSHOT");
    assert.equal(report.source.characterId, 18);
    assert.equal(report.source.personaName, "렌");
    assert.equal(report.source.sealedSha256, persisted.sealedSha256);
  });

  it("rejects historical id=10 rows before assembly", () => {
    assert.throws(
      () =>
        assertMainRpStyleLengthIdentity({
          characterId: 10,
          characterName: "라이크",
          personaName: "렌",
          fixtureKind: "CURRENT_LIVE",
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "HISTORICAL_ID10_REJECTED"
    );
  });

  it("re-checks live admin uniqueness and rejects CURRENT_LIVE without a DB", async () => {
    const dbFile = path.join(dir, "live-unique.db");
    buildSyntheticDb(dbFile);
    const loaded = loadPrecallProductionRows({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      env: {},
    });
    const assembled = assembleMainRpStyleLengthSnapshot({
      rows: loaded.rows,
      deployedGitSha: DEPLOY_SHA,
      version: 2,
      listing: { nsfwListing: 1, officialListing: 0, greetingChars: 2 },
      personaPublicChars: loaded.proof.personaPublicChars,
      fixtureKind: "CURRENT_LIVE",
      adminVerified: true,
    });
    const root = path.join(dir, "private-live");
    persistMainRpStyleLengthGolden({
      root,
      version: 2,
      sealed: assembled.sealed,
      publicManifest: { ...assembled.publicManifest, privateStore: `${root}/v2` },
    });
    await assert.rejects(
      () =>
        dryRunMainRpStyleLengthEvaluation({
          mode: "CURRENT_LIVE",
          version: 2,
          root,
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "SOURCE_DRIFT"
    );
    const db = new DatabaseSync(dbFile);
    db.prepare(
      "INSERT INTO user_personas (id, user_id, name, gender, description) VALUES (2, 1, '렌', 'male', '두번째')"
    ).run();
    db.close();
    await assert.rejects(
      () =>
        dryRunMainRpStyleLengthEvaluation({
          mode: "CURRENT_LIVE",
          version: 2,
          root,
          dbPath: dbFile,
          deployedGitSha: DEPLOY_SHA,
          env: {},
        }),
      (error: unknown) => error instanceof PrecallRowsStop && error.code === "PERSONA_COUNT_INVALID"
    );
    assert.throws(
      () =>
        assembleMainRpStyleLengthSnapshot({
          rows: loaded.rows,
          deployedGitSha: DEPLOY_SHA,
          version: 3,
          listing: { nsfwListing: 1, officialListing: 0, greetingChars: 2 },
          fixtureKind: "CURRENT_LIVE",
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "ADMIN_UNVERIFIED"
    );
  });

  it("proves production-request parity only from the golden reload and a fresh DB assembly", () => {
    const dbFile = path.join(dir, "owned-parity.db");
    buildSyntheticDb(dbFile);
    const loaded = loadPrecallProductionRows({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      env: {},
    });
    const assembled = assembleMainRpStyleLengthSnapshot({
      rows: loaded.rows,
      deployedGitSha: DEPLOY_SHA,
      version: 9,
      listing: { nsfwListing: 1, officialListing: 0, greetingChars: 2 },
      personaPublicChars: loaded.proof.personaPublicChars,
      fixtureKind: "CURRENT_LIVE",
      adminVerified: true,
    });
    const root = path.join(dir, "owned-root");
    persistMainRpStyleLengthGolden({
      root,
      version: 9,
      sealed: assembled.sealed,
      publicManifest: { ...assembled.publicManifest, privateStore: `${root}/v9` },
    });
    const matched = evaluateOwnedProductionRequestParity({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      env: {},
      version: 9,
      root,
    });
    assert.equal(matched.productionRequestParity, "NOT_COMPARABLE");
    assert.equal(matched.fixtureFingerprintParity, "MATCH");
    assert.equal(matched.providerSemanticParity, "NOT_IN_SCOPE");
    assert.equal(matched.qualityScoreEligible, false);
    assert.equal(matched.railwayProductionDb, false);
    assert.equal(matched.runtimeDeployShaObserved, false);
    assert.ok(matched.reasons.includes("db_path_is_not_railway_production"));
    assert.ok(matched.reasons.includes("runtime_deploy_sha_unobserved"));
    const stale = evaluateOwnedProductionRequestParity({
      dbPath: dbFile,
      deployedGitSha: "4d83c100666878cca747408ae72a18f3360310ac",
      env: {},
      version: 9,
      root,
    });
    assert.equal(stale.productionRequestParity, "NOT_COMPARABLE");
    assert.equal(stale.fixtureFingerprintParity, "STALE_PRODUCTION_SNAPSHOT");
    assert.equal(stale.qualityScoreEligible, false);
    const otherDb = path.join(dir, "owned-other.db");
    buildSyntheticDb(otherDb);
    const other = new DatabaseSync(otherDb);
    other.prepare("UPDATE characters SET greeting = '다른 인사' WHERE id = 18").run();
    other.close();
    const drifted = evaluateOwnedProductionRequestParity({
      dbPath: otherDb,
      deployedGitSha: DEPLOY_SHA,
      env: {},
      version: 9,
      root,
    });
    assert.equal(drifted.productionRequestParity, "NOT_COMPARABLE");
    assert.equal(drifted.fixtureFingerprintParity, "MISMATCH");
    assert.equal(drifted.qualityScoreEligible, false);
  });

  it("does not grant operational MATCH from a synthetic DB or a spoofed older SHA", () => {
    const dbFile = path.join(dir, "owned-spoof.db");
    buildSyntheticDb(dbFile);
    const loaded = loadPrecallProductionRows({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      env: {},
    });
    const assembled = assembleMainRpStyleLengthSnapshot({
      rows: loaded.rows,
      deployedGitSha: DEPLOY_SHA,
      version: 10,
      listing: { nsfwListing: 1, officialListing: 0, greetingChars: 2 },
      personaPublicChars: loaded.proof.personaPublicChars,
      fixtureKind: "CURRENT_LIVE",
      adminVerified: true,
    });
    const root = path.join(dir, "owned-spoof-root");
    persistMainRpStyleLengthGolden({
      root,
      version: 10,
      sealed: assembled.sealed,
      publicManifest: { ...assembled.publicManifest, privateStore: `${root}/v10` },
    });
    const forgedInput = evaluateOwnedProductionRequestParity({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      env: { RAILWAY_GIT_COMMIT_SHA: DEPLOY_SHA },
      version: 10,
      root,
    });
    assert.equal(forgedInput.productionRequestParity, "NOT_COMPARABLE");
    assert.equal(forgedInput.fixtureFingerprintParity, "MATCH");
    assert.equal(forgedInput.railwayProductionDb, false);
    assert.equal(forgedInput.runtimeDeployShaObserved, false);
    assert.ok(forgedInput.reasons.includes("runtime_deploy_sha_unobserved"));
    assert.equal(forgedInput.qualityScoreEligible, false);
    const newerRuntimeSha = "b15e87e75b61d5ae4f84203865a6597df9916064";
    const missingRuntime = evaluateOwnedParityInIsolatedProcess({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      callerEnv: { RAILWAY_GIT_COMMIT_SHA: DEPLOY_SHA },
      processRailwaySha: null,
      version: 10,
      root,
    });
    assert.equal(missingRuntime.productionRequestParity, "NOT_COMPARABLE");
    assert.equal(missingRuntime.runtimeDeployShaObserved, false);
    assert.ok(missingRuntime.reasons.includes("runtime_deploy_sha_unobserved"));
    assert.equal(missingRuntime.qualityScoreEligible, false);
    const spoofedOldSha = evaluateOwnedParityInIsolatedProcess({
      dbPath: dbFile,
      deployedGitSha: DEPLOY_SHA,
      callerEnv: { RAILWAY_GIT_COMMIT_SHA: DEPLOY_SHA },
      processRailwaySha: newerRuntimeSha,
      version: 10,
      root,
    });
    assert.notEqual(spoofedOldSha.productionRequestParity, "MATCH");
    assert.equal(spoofedOldSha.productionRequestParity, "NOT_COMPARABLE");
    assert.equal(spoofedOldSha.fixtureFingerprintParity, "MATCH");
    assert.equal(spoofedOldSha.runtimeDeployShaObserved, true);
    assert.ok(spoofedOldSha.reasons.includes("caller_deploy_sha_does_not_match_runtime"));
    assert.ok(spoofedOldSha.reasons.includes("stale_production_snapshot"));
    assert.equal(spoofedOldSha.qualityScoreEligible, false);
  });
});
