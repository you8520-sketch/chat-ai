import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { computeAppearanceLockHash } from "@/lib/officialSupply/appearance";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import {
  applyLockedSnapshot,
  assertBackupMatchesLiveSource,
  inspectLockedSnapshot,
  isLockedSnapshotApplyAuthorized,
  isProtectedSqlitePath,
  isRailwayProductionApplyEnvironment,
  isRailwayProductionSqlitePath,
  loadApprovedWolfgangV4Source,
  openOfficialSupplyReadonlyDatabase,
  WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET,
} from "@/lib/officialSupply/lockedSnapshotReconcileOperator";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import type { OfficialAppearanceLock, OfficialAssetPlan, OfficialCharacterDraft } from "@/lib/officialSupply/types";
import {
  buildClusterBRofanStyleSeed,
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { getDatabasePath } from "@/lib/dataDir";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "src/lib/officialSupply/pilot/fixtures/pilot-rf-v4-02-locked-2026-09-27.json"
);
const SHA = "34608ea5a742119bc2922584fb079dac8f26266b";
const SIBLING_KEY = "pilot-rf-v4-99";
const ENV = { NEXTAUTH_URL: "https://hav.chat", OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" } as NodeJS.ProcessEnv;

function applyEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...ENV,
    OFFICIAL_LOCKED_SNAPSHOT_APPLY: "1",
    RAILWAY_GIT_COMMIT_SHA: SHA,
    ...overrides,
  };
}

type StaleFixture = {
  expectedTextLockHash: string;
  expectedAppearanceLockHash: string;
  representative: {
    resultUrl: string;
    attempts: number;
    model: string;
    width: number;
    height: number;
    spentUsd: number;
    moderation: { status: "checked"; adultFlagged: boolean; moderationReject: boolean; reason: string };
  };
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  assetPlan: OfficialAssetPlan;
};

function loadFixture(): StaleFixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as StaleFixture;
}

function snapshot(store: OfficialSupplyStore, draftKey: string): unknown {
  return {
    character: store.database
      .prepare(
        `SELECT draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
                appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof,
                anchor_approved_by, staging_claim, staged_character_id
           FROM official_supply_characters WHERE draft_key=?`
      )
      .get(draftKey),
    assets: store.database.prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY id").all(draftKey),
  };
}

function seedStyleAndBatch(store: OfficialSupplyStore): void {
  store.createBatch(PILOT_STYLE_PROOF_V4_BATCH_KEY, ROFAN_V4_PRODUCTION_BATCH_CONFIG);
  store.proposeStyle({
    styleKey: PILOT_STYLE_PROOF_V4_STYLE_KEY,
    genre: "로맨스 판타지",
    candidates: [
      { ...testStyleCandidate("c1"), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA },
      { ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA },
      testStyleCandidate("c3"),
    ],
    proofAssetLimit: 3,
  });
  store.approveStyleCandidate(
    PILOT_STYLE_PROOF_V4_STYLE_KEY,
    PILOT_STYLE_PROOF_CANDIDATE_ID,
    buildClusterBRofanStyleSeed(ENV),
    "owner"
  );
}

function insertLockedCharacter(
  store: OfficialSupplyStore,
  draft: OfficialCharacterDraft,
  appearance: OfficialAppearanceLock,
  plan: OfficialAssetPlan,
  opts: { generatedRep?: StaleFixture["representative"] } = {}
): void {
  const appearanceHash = computeAppearanceLockHash(appearance);
  store.database
    .prepare(
      `INSERT INTO official_supply_characters
       (draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
        appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof)
       VALUES (?, ?, ?, ?, 'asset_plan_locked', ?, ?, ?, ?, ?, 1)`
    )
    .run(
      draft.draftKey,
      PILOT_STYLE_PROOF_V4_BATCH_KEY,
      draft.worldKey,
      draft.styleKey,
      JSON.stringify(draft),
      computeTextLockHash(draft),
      JSON.stringify(appearance),
      appearanceHash,
      JSON.stringify(plan)
    );
  const insert = store.database.prepare(
    `INSERT INTO official_supply_assets
     (draft_key, slot_key, kind, status, attempts, result_url, width, height, model, spent_usd,
      has_unknown_cost, appearance_lock_hash, moderation_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  );
  for (const slot of plan.slots) {
    const isRep = slot.kind === "representative" && opts.generatedRep;
    insert.run(
      draft.draftKey,
      slot.slotKey,
      slot.kind,
      isRep ? "generated" : "planned",
      isRep ? opts.generatedRep!.attempts : 0,
      isRep ? opts.generatedRep!.resultUrl : null,
      isRep ? opts.generatedRep!.width : null,
      isRep ? opts.generatedRep!.height : null,
      isRep ? opts.generatedRep!.model : null,
      isRep ? opts.generatedRep!.spentUsd : 0,
      appearanceHash,
      isRep ? JSON.stringify(opts.generatedRep!.moderation) : null
    );
  }
}

function vacuumInto(store: OfficialSupplyStore, destination: string): void {
  if (fs.existsSync(destination)) fs.rmSync(destination);
  store.database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
}

describe("Wolfgang v4 locked snapshot operator", () => {
  const originalFetch = globalThis.fetch;
  let store: OfficialSupplyStore;
  let fixture: StaleFixture;

  before(() => {
    globalThis.fetch = async (input) => {
      throw new Error(`unexpected fetch ${String(input)}`);
    };
  });
  after(() => {
    globalThis.fetch = originalFetch;
    uninstallIsolatedTestDatabase();
  });
  beforeEach(() => {
    uninstallIsolatedTestDatabase();
    installIsolatedTestDatabase();
    store = new OfficialSupplyStore();
    fixture = loadFixture();
    seedStyleAndBatch(store);
    insertLockedCharacter(store, fixture.draft, fixture.appearance, fixture.assetPlan, {
      generatedRep: fixture.representative,
    });
    insertLockedCharacter(
      store,
      { ...fixture.draft, draftKey: SIBLING_KEY, name: "형제 대조 캐릭터" },
      fixture.appearance,
      fixture.assetPlan
    );
    store.decideStyleProof(PILOT_STYLE_PROOF_V4_STYLE_KEY, "approve", "owner");
  });

  it("maps only the approved Wolfgang source onto v4-02", () => {
    const source = loadApprovedWolfgangV4Source();
    assert.equal(source.nextDraft.draftKey, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    assert.equal(source.nextDraft.styleKey, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.styleKey);
    assert.equal(computeTextLockHash(source.nextDraft), WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash);
    assert.equal(source.nextPlan.slots.length, 14);
    assert.equal(isRailwayProductionSqlitePath("/data/app.db"), true);
    assert.equal(isRailwayProductionSqlitePath(getDatabasePath()), false);
    assert.equal(isRailwayProductionApplyEnvironment({}), false);
    assert.equal(isRailwayProductionApplyEnvironment({ RAILWAY_ENVIRONMENT_NAME: "production" }), true);
  });

  it("inspects the 2026-09-27 mismatch with a read-only handle and writes nothing", () => {
    const beforeTarget = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    const beforeSibling = snapshot(store, SIBLING_KEY);
    const report = inspectLockedSnapshot({
      dbPath: getDatabasePath(),
      expectedSha: SHA,
      runtimeSha: SHA,
      env: ENV,
    });
    assert.equal(report.mode, "inspect");
    assert.equal(report.wrote, false);
    assert.equal(report.storeInstantiated, false);
    assert.equal(report.verdict, "ready_for_cas");
    assert.equal(report.textMatchesOld, true);
    assert.equal(report.textMatchesApproved, false);
    assert.equal(report.imageSubjectsPresent, 0);
    assert.ok(report.staleNeedles.includes("압송"));
    assert.equal(report.publicCopyLengths.tagline, 27);
    assert.equal(report.approvedCopyLengths.tagline, 37);
    assert.equal(report.draftJsonSha256, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedOldDraftJsonSha256);
    assert.equal(report.assetPlanJsonSha256, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedOldAssetPlanJsonSha256);
    assert.equal(report.assetCount, 14);
    assert.equal(report.assemblies.ok, 14);
    assert.equal(report.assemblies.failed, 0);
    assert.equal(report.backupPlan.owner, "VACUUM INTO");
    assert.deepEqual(snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey), beforeTarget);
    assert.deepEqual(snapshot(store, SIBLING_KEY), beforeSibling);
    const readonly = openOfficialSupplyReadonlyDatabase(getDatabasePath());
    try {
      assert.throws(
        () => readonly.exec("CREATE TABLE inspect_must_not_write (id INTEGER)"),
        /read-only|query_only|readonly/i
      );
    } finally {
      readonly.close();
    }
  });

  it("does not create official-supply schema when inspecting an empty database", () => {
    const empty = path.join(path.dirname(getDatabasePath()), "empty-inspect.db");
    const created = new Database(empty);
    created.close();
    const before = fs.readFileSync(empty);
    assert.throws(
      () => inspectLockedSnapshot({ dbPath: empty, expectedSha: SHA, runtimeSha: SHA, env: ENV }),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_schema_missing"
    );
    const opened = openOfficialSupplyReadonlyDatabase(empty);
    try {
      const tables = opened
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'official_supply_%'")
        .all() as Array<{ name: string }>;
      assert.deepEqual(tables, []);
    } finally {
      opened.close();
    }
    assert.deepEqual(fs.readFileSync(empty), before);
  });

  it("inspect stays read-only even when the apply env is stale", () => {
    assert.equal(isLockedSnapshotApplyAuthorized(["inspect"], { [ "OFFICIAL_LOCKED_SNAPSHOT_APPLY"]: "1" }), false);
    assert.equal(isLockedSnapshotApplyAuthorized(["apply"], { OFFICIAL_LOCKED_SNAPSHOT_APPLY: "1" }), true);
    const before = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    const report = inspectLockedSnapshot({
      dbPath: getDatabasePath(),
      expectedSha: SHA,
      runtimeSha: SHA,
      env: { ...ENV, OFFICIAL_LOCKED_SNAPSHOT_APPLY: "1" },
    });
    assert.equal(report.mode, "inspect");
    assert.equal(report.wrote, false);
    assert.deepEqual(snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey), before);
  });

  it("fails closed on SHA, stage, rep, started slot, style, and preimage drift", () => {
    const before = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    const expectStop = (code: string, run: () => void) => {
      assert.throws(run, (error: OfficialSupplyGateError) => error.code === code);
      assert.deepEqual(snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey), before);
    };
    expectStop("locked_snapshot_sha_mismatch", () =>
      inspectLockedSnapshot({
        dbPath: getDatabasePath(),
        expectedSha: SHA,
        runtimeSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        env: ENV,
      })
    );
    expectStop("character_stage", () => {
      store.database
        .prepare("UPDATE official_supply_characters SET stage='anchor_approved' WHERE draft_key=?")
        .run(WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      try {
        inspectLockedSnapshot({ dbPath: getDatabasePath(), expectedSha: SHA, runtimeSha: SHA, env: ENV });
      } finally {
        store.database
          .prepare("UPDATE official_supply_characters SET stage='asset_plan_locked' WHERE draft_key=?")
          .run(WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      }
    });
    expectStop("locked_snapshot_rep_drift", () => {
      store.database
        .prepare("UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key='rep'")
        .run("/uploads/other.webp", WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      try {
        inspectLockedSnapshot({ dbPath: getDatabasePath(), expectedSha: SHA, runtimeSha: SHA, env: ENV });
      } finally {
        store.database
          .prepare("UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key='rep'")
          .run(fixture.representative.resultUrl, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      }
    });
    expectStop("locked_snapshot_assets_drift", () => {
      store.database
        .prepare("UPDATE official_supply_assets SET attempts=1 WHERE draft_key=? AND slot_key='emo1'")
        .run(WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      try {
        inspectLockedSnapshot({ dbPath: getDatabasePath(), expectedSha: SHA, runtimeSha: SHA, env: ENV });
      } finally {
        store.database
          .prepare("UPDATE official_supply_assets SET attempts=0 WHERE draft_key=? AND slot_key='emo1'")
          .run(WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      }
    });
    expectStop("locked_snapshot_style", () => {
      store.database
        .prepare("UPDATE official_supply_styles SET stage='candidate_approved' WHERE style_key=?")
        .run(PILOT_STYLE_PROOF_V4_STYLE_KEY);
      try {
        inspectLockedSnapshot({ dbPath: getDatabasePath(), expectedSha: SHA, runtimeSha: SHA, env: ENV });
      } finally {
        store.database
          .prepare("UPDATE official_supply_styles SET stage='style_locked' WHERE style_key=?")
          .run(PILOT_STYLE_PROOF_V4_STYLE_KEY);
      }
    });
    expectStop("locked_snapshot_preimage_mismatch", () => {
      store.database
        .prepare("UPDATE official_supply_characters SET text_lock_hash=? WHERE draft_key=?")
        .run("0".repeat(64), WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      try {
        inspectLockedSnapshot({ dbPath: getDatabasePath(), expectedSha: SHA, runtimeSha: SHA, env: ENV });
      } finally {
        store.database
          .prepare("UPDATE official_supply_characters SET text_lock_hash=? WHERE draft_key=?")
          .run(fixture.expectedTextLockHash, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
      }
    });
  });

  it("isolated apply calls only the merged CAS and leaves 14 asset rows and the sibling unchanged", () => {
    const beforeAssets = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    const beforeSibling = snapshot(store, SIBLING_KEY);
    const backupPath = path.join(path.dirname(getDatabasePath()), "wolfgang-cas-backup.db");
    vacuumInto(store, backupPath);
    const first = applyLockedSnapshot({
      dbPath: getDatabasePath(),
      expectedSha: SHA,
      runtimeSha: SHA,
      backupPath,
      argv: ["apply"],
      env: applyEnv(),
    });
    assert.equal(first.storeWriter, "OfficialSupplyStore.reconcileLockedSnapshot");
    assert.equal(first.result.status, "updated");
    assert.equal(first.result.textLockHash, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash);
    const after = store.database
      .prepare("SELECT text_lock_hash, length(draft_json) AS n FROM official_supply_characters WHERE draft_key=?")
      .get(WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey) as { text_lock_hash: string };
    assert.equal(after.text_lock_hash, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash);
    assert.deepEqual(
      (snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey) as { assets: unknown }).assets,
      (beforeAssets as { assets: unknown }).assets
    );
    assert.deepEqual(snapshot(store, SIBLING_KEY), beforeSibling);
    const currentBackup = path.join(path.dirname(getDatabasePath()), "wolfgang-cas-backup-current.db");
    vacuumInto(store, currentBackup);
    const second = applyLockedSnapshot({
      dbPath: getDatabasePath(),
      expectedSha: SHA,
      runtimeSha: SHA,
      backupPath: currentBackup,
      argv: ["apply"],
      env: applyEnv(),
    });
    assert.equal(second.result.status, "already_current");
    assert.equal(second.wrote, false);
  });

  it("refuses production /data/app.db apply and missing backups without writing", () => {
    const before = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    assert.throws(
      () =>
        applyLockedSnapshot({
          dbPath: "/data/app.db",
          expectedSha: SHA,
          runtimeSha: SHA,
          backupPath: path.join(path.dirname(getDatabasePath()), "missing.db"),
          argv: ["apply"],
          env: applyEnv(),
        }),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_production_apply_blocked"
    );
    assert.throws(
      () =>
        applyLockedSnapshot({
          dbPath: getDatabasePath(),
          expectedSha: SHA,
          runtimeSha: SHA,
          backupPath: path.join(path.dirname(getDatabasePath()), "missing.db"),
          argv: ["apply"],
          env: applyEnv(),
        }),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_backup_missing"
    );
    assert.deepEqual(snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey), before);
  });

  it("rejects aliases to a protected sqlite path and Railway production apply", () => {
    const root = path.join(path.dirname(getDatabasePath()), "protected-alias");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    const protectedPath = path.join(root, "data", "app.db");
    const aliasPath = path.join(root, "alias", "app.db");
    fs.mkdirSync(path.dirname(protectedPath), { recursive: true });
    fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
    fs.writeFileSync(protectedPath, "sqlite-stub");
    fs.symlinkSync(protectedPath, aliasPath);
    assert.equal(isProtectedSqlitePath(aliasPath, protectedPath), true);
    fs.linkSync(protectedPath, path.join(root, "hard-app.db"));
    assert.equal(isProtectedSqlitePath(path.join(root, "hard-app.db"), protectedPath), true);
    assert.equal(isProtectedSqlitePath(getDatabasePath(), protectedPath), false);
    const before = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    assert.throws(
      () =>
        applyLockedSnapshot({
          dbPath: getDatabasePath(),
          expectedSha: SHA,
          runtimeSha: SHA,
          backupPath: path.join(path.dirname(getDatabasePath()), "unused.db"),
          argv: ["apply"],
          env: applyEnv({ RAILWAY_ENVIRONMENT_NAME: "production" }),
        }),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_production_apply_blocked"
    );
    assert.deepEqual(snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey), before);
  });

  it("pins the observed old draft/plan SHA and stops on hook, plan, or partial drift", () => {
    const before = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    const expectStop = (mutate: () => void) => {
      mutate();
      assert.throws(
        () => inspectLockedSnapshot({ dbPath: getDatabasePath(), expectedSha: SHA, runtimeSha: SHA, env: ENV }),
        (error: OfficialSupplyGateError) => error.code === "locked_snapshot_preimage_mismatch"
      );
      store.database
        .prepare(
          "UPDATE official_supply_characters SET draft_json=?, asset_plan_json=?, text_lock_hash=? WHERE draft_key=?"
        )
        .run(
          JSON.stringify(fixture.draft),
          JSON.stringify(fixture.assetPlan),
          fixture.expectedTextLockHash,
          WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
        );
      assert.deepEqual(snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey), before);
    };
    const hooked = { ...fixture.draft, hook: { ...fixture.draft.hook, rpHook: `${fixture.draft.hook.rpHook}·변경` } };
    assert.equal(computeTextLockHash(hooked), fixture.expectedTextLockHash);
    expectStop(() => {
      store.database
        .prepare("UPDATE official_supply_characters SET draft_json=? WHERE draft_key=?")
        .run(JSON.stringify(hooked), WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    });
    expectStop(() => {
      const changedPlan = {
        slots: fixture.assetPlan.slots.map((slot) => (slot.slotKey === "emo1" ? { ...slot, tag: "바뀐 계획" } : slot)),
      };
      store.database
        .prepare("UPDATE official_supply_characters SET asset_plan_json=? WHERE draft_key=?")
        .run(JSON.stringify(changedPlan), WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    });
    const approved = loadApprovedWolfgangV4Source();
    expectStop(() => {
      store.database
        .prepare("UPDATE official_supply_characters SET draft_json=?, text_lock_hash=? WHERE draft_key=?")
        .run(
          JSON.stringify(approved.nextDraft),
          WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash,
          WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
        );
    });
    const driftedApproved = {
      ...approved.nextDraft,
      hook: { ...approved.nextDraft.hook, rpHook: `${approved.nextDraft.hook.rpHook}·변경` },
    };
    assert.equal(computeTextLockHash(driftedApproved), WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash);
    expectStop(() => {
      store.database
        .prepare("UPDATE official_supply_characters SET draft_json=?, asset_plan_json=?, text_lock_hash=? WHERE draft_key=?")
        .run(
          JSON.stringify(driftedApproved),
          JSON.stringify(approved.nextPlan),
          WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash,
          WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
        );
    });
    store.database
      .prepare("UPDATE official_supply_characters SET draft_json=?, asset_plan_json=?, text_lock_hash=? WHERE draft_key=?")
      .run(
        JSON.stringify(approved.nextDraft),
        JSON.stringify(approved.nextPlan),
        WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash,
        WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
      );
    const current = inspectLockedSnapshot({ dbPath: getDatabasePath(), expectedSha: SHA, runtimeSha: SHA, env: ENV });
    assert.equal(current.verdict, "already_current");
    store.database
      .prepare("UPDATE official_supply_characters SET draft_json=?, asset_plan_json=?, text_lock_hash=? WHERE draft_key=?")
      .run(
        JSON.stringify(fixture.draft),
        JSON.stringify(fixture.assetPlan),
        fixture.expectedTextLockHash,
        WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
      );
  });

  it("rejects an integrity-ok backup that is not the live pre-CAS snapshot", () => {
    const before = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    const other = path.join(path.dirname(getDatabasePath()), "unrelated-ok.db");
    const unrelated = new Database(other);
    unrelated.exec("CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t (id) VALUES (1)");
    unrelated.close();
    assert.throws(
      () => assertBackupMatchesLiveSource(other, getDatabasePath()),
      (error: OfficialSupplyGateError) =>
        error.code === "locked_snapshot_schema_missing" || error.code === "locked_snapshot_backup_mismatch"
    );
    assert.throws(
      () => assertBackupMatchesLiveSource(getDatabasePath(), getDatabasePath()),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_backup_invalid"
    );
    const matching = path.join(path.dirname(getDatabasePath()), "matching-backup.db");
    vacuumInto(store, matching);
    assertBackupMatchesLiveSource(matching, getDatabasePath());
    assert.deepEqual(snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey), before);
  });

  it("requires an independent full deploy SHA on apply", () => {
    const before = snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    const backupPath = path.join(path.dirname(getDatabasePath()), "sha-backup.db");
    vacuumInto(store, backupPath);
    assert.throws(
      () =>
        applyLockedSnapshot({
          dbPath: getDatabasePath(),
          expectedSha: "",
          runtimeSha: SHA,
          backupPath,
          argv: ["apply"],
          env: applyEnv({ RAILWAY_GIT_COMMIT_SHA: SHA }),
        }),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_sha_mismatch"
    );
    assert.throws(
      () =>
        applyLockedSnapshot({
          dbPath: getDatabasePath(),
          expectedSha: SHA,
          runtimeSha: SHA,
          backupPath,
          argv: ["apply"],
          env: applyEnv({ RAILWAY_GIT_COMMIT_SHA: undefined }),
        }),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_sha_mismatch"
    );
    assert.throws(
      () =>
        applyLockedSnapshot({
          dbPath: getDatabasePath(),
          expectedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          runtimeSha: SHA,
          backupPath,
          argv: ["apply"],
          env: applyEnv(),
        }),
      (error: OfficialSupplyGateError) => error.code === "locked_snapshot_sha_mismatch"
    );
    const ok = applyLockedSnapshot({
      dbPath: getDatabasePath(),
      expectedSha: SHA,
      runtimeSha: SHA,
      backupPath,
      argv: ["apply"],
      env: applyEnv(),
    });
    assert.equal(ok.result.status, "updated");
    assert.deepEqual(
      (snapshot(store, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey) as { assets: unknown }).assets,
      (before as { assets: unknown }).assets
    );
  });

  it("CLI defaults to NOT_RUN and cannot apply without the apply argv", () => {
    const result = spawnSync(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "scripts/official-supply-reconcile-locked-snapshot.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DATA_DIR: "", OFFICIAL_LOCKED_SNAPSHOT_DB: "", OFFICIAL_LOCKED_SNAPSHOT_APPLY: "1" },
      }
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /NOT_RUN/);
  });
});
