import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION, currentBlueprintGenerationValidity } from "./blueprintValidity";
import { ensureTrpgTables } from "./schema";
import {
  casPublishWorldBlueprintArtifact,
  loadValidWorldBlueprintPlan,
  loadWorldBlueprintArtifactRow,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { parseTrpgScenarioPlan } from "./scenarioPlan";
import { refreshWorldBlueprintArtifact } from "@/lib/derivedCache/worldBlueprintPregen";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignContext } from "./campaignContext";
import { ensureCampaignDirectorContext } from "./sandboxDirector";

const playablePlan = parseTrpgScenarioPlan({
  startingSituation: "폐도시에 들어간다",
  centralConflict: "코어와 인간 세력",
  goal: "원인을 밝힌다",
  secret: "WORLDSECRET",
  endingConditions: ["코어를 봉쇄한다"],
  clues: ["통신 기록"],
  endingCandidates: ["봉쇄"],
  gmDirection: "탐험",
})!;

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0,
      trpg_visibility TEXT NOT NULL DEFAULT 'private',
      genres TEXT NOT NULL DEFAULT '[]',
      cover_url TEXT NOT NULL DEFAULT '',
      shared_from_nickname TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureTrpgTables(db);
  return db;
}

function sharedMemoryDbs(): { db1: Database.Database; db2: Database.Database } {
  const uri = `file:blueprint-convergence-${Date.now()}-${Math.random()}?mode=memory&cache=shared`;
  const db1 = new Database(uri);
  const db2 = new Database(uri);
  db1.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0,
      trpg_visibility TEXT NOT NULL DEFAULT 'private',
      genres TEXT NOT NULL DEFAULT '[]',
      cover_url TEXT NOT NULL DEFAULT '',
      shared_from_nickname TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureTrpgTables(db1);
  return { db1, db2 };
}

function insertWorld(db: Database.Database, content = "본문"): number {
  const result = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres, cover_url)
       VALUES (2, '북부', '요약', ?, 1, 'public', '[]', '')`
    )
    .run(content);
  return Number(result.lastInsertRowid);
}

async function withSandboxDirectorEnabled<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
  process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = enabled ? "1" : "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    else process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = prev;
  }
}

function mockBlueprintComplete(goal: string) {
  return async () => ({
    text: JSON.stringify({
      startingSituation: playablePlan.startingSituation,
      centralConflict: playablePlan.centralConflict,
      goal,
      secret: playablePlan.secret,
      endingConditions: playablePlan.endingConditions,
      clues: playablePlan.clues,
      endingCandidates: playablePlan.endingCandidates,
      gmDirection: playablePlan.gmDirection,
    }),
    latencyMs: 1,
    model: TRPG_SCENARIO_DRAFT_MODEL,
  });
}

function gmText(): string {
  return buildTrpgGmStructuredWireText("ok", {
    players: [],
    location: "x",
    next_round_context: "y",
    campaign_finished: false,
    storyPhase: "DEVELOPMENT",
  });
}

function planWithGoal(goal: string) {
  return parseTrpgScenarioPlan({ ...playablePlan, goal })!;
}

const POISON_PLAN_JSON = "{not a valid scenario plan";

function insertPoisonArtifact(
  db: Database.Database,
  worldId: number,
  snapshot: ReturnType<typeof loadWorldSnapshotForBlueprint>,
  poisonJson = POISON_PLAN_JSON
): void {
  const validity = currentBlueprintGenerationValidity(snapshot!);
  db.prepare(
    `INSERT INTO trpg_world_blueprint_artifacts (
        world_id, source_fingerprint, derivation_version, generator_model, schema_version,
        director_plan_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    worldId,
    validity.sourceFingerprint,
    validity.derivationVersion,
    validity.generatorModel,
    validity.schemaVersion,
    poisonJson
  );
}

function createCampaign(db: Database.Database, worldId: number, suffix: string): number {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    worldId,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: `렌-${suffix}`, stats: EVEN_STATS });
  return campaignId;
}

describe("world blueprint canonical convergence", () => {
  it("T3 same-generation late writer cannot overwrite valid canonical artifact", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    const planA = planWithGoal("CANONICAL_A");
    const planB = planWithGoal("LATE_B");

    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planA,
      }),
      true
    );
    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planB,
      }),
      false
    );
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "CANONICAL_A");
  });

  it("T3b two SQLite connections — first publish wins, second same-generation publish no-ops", () => {
    const { db1, db2 } = sharedMemoryDbs();
    const worldId = insertWorld(db1);
    const snap = loadWorldSnapshotForBlueprint(db1, worldId)!;
    const planA = planWithGoal("CONN_A");
    const planB = planWithGoal("CONN_B");
    const publish = (db: Database.Database, plan: ReturnType<typeof planWithGoal>) =>
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan,
      });

    assert.equal(publish(db1, planA), true);
    assert.equal(publish(db2, planB), false);
    assert.equal(loadValidWorldBlueprintPlan(db2, worldId, snap)?.goal, "CONN_A");
  });

  it("T5 worker pregen completes before campaign → warm artifact copied with zero campaign provider calls", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const campaignId = createCampaign(db, worldId, "warm");

      let workerCalls = 0;
      await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        {
          complete: async () => {
            workerCalls += 1;
            return (await mockBlueprintComplete("PREGEN_PLAN")()) as never;
          },
        }
      );
      assert.equal(workerCalls, 1);

      await ensureCampaignDirectorContext(db, campaignId);
      const artifact = loadValidWorldBlueprintPlan(db, worldId, snap)!;
      assert.equal(artifact.goal, "PREGEN_PLAN");
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan?.goal, "PREGEN_PLAN");
    });
  });

  it("T9 valid artifact baseline → campaign provider 0", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });

      const campaignId = createCampaign(db, worldId, "warm");
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          gmCall: async () => ({ text: gmText() }),
        },
      });
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan?.goal, playablePlan.goal);
    });
  });

  it("T10 same-generation malformed artifact → valid publish repairs → reader returns plan", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    insertPoisonArtifact(db, worldId, snap);

    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap), null);

    const repaired = casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: planWithGoal("REPAIRED"),
    });

    assert.equal(repaired, true);
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "REPAIRED");
  });

  it("T11 repaired artifact → later same-generation valid writer returns false", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    insertPoisonArtifact(db, worldId, snap);

    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planWithGoal("REPAIRED"),
      }),
      true
    );

    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planWithGoal("LATE_OVERWRITE"),
      }),
      false
    );
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "REPAIRED");
  });

  it("T12 poison artifact → worker repairs → campaigns copy repaired artifact", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      insertPoisonArtifact(db, worldId, snap);

      let workerCalls = 0;
      await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        {
          complete: async () => {
            workerCalls += 1;
            return (await mockBlueprintComplete("PLAN_A")()) as never;
          },
        }
      );
      assert.equal(workerCalls, 1);
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "PLAN_A");

      const campaignA = createCampaign(db, worldId, "A");
      await ensureCampaignDirectorContext(db, campaignA);
      const campaignB = createCampaign(db, worldId, "B");
      await ensureCampaignDirectorContext(db, campaignB);

      assert.equal(loadCampaignContext(db, campaignA)?.directorPlan?.goal, "PLAN_A");
      assert.equal(loadCampaignContext(db, campaignB)?.directorPlan?.goal, "PLAN_A");
    });
  });

  it("T13 two SQLite connections repair same invalid artifact → one winner", () => {
    const { db1, db2 } = sharedMemoryDbs();
    const worldId = insertWorld(db1);
    const snap = loadWorldSnapshotForBlueprint(db1, worldId)!;
    insertPoisonArtifact(db1, worldId, snap);

    const publish = (db: Database.Database, goal: string) =>
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planWithGoal(goal),
      });

    assert.equal(publish(db1, "REPAIR_A"), true);
    assert.equal(publish(db2, "REPAIR_B"), false);
    assert.equal(loadValidWorldBlueprintPlan(db2, worldId, snap)?.goal, "REPAIR_A");
  });

  it("T14 obsolete generation identity matrix — stale fingerprint blocked, old derivation replaced", () => {
    const db = memoryDb();
    const worldId = insertWorld(db, "v1");
    const snapV1 = loadWorldSnapshotForBlueprint(db, worldId)!;
    insertPoisonArtifact(db, worldId, snapV1, POISON_PLAN_JSON);

    db.prepare(`UPDATE worlds SET content='v2', updated_at=datetime('now') WHERE id=?`).run(worldId);
    const snapV2 = loadWorldSnapshotForBlueprint(db, worldId)!;

    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snapV1.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planWithGoal("stale"),
      }),
      false
    );

    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snapV2.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planWithGoal("current-v2"),
      }),
      true
    );
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snapV2)?.goal, "current-v2");
  });
});

describe("canonical convergence reproduction (before-fix semantics)", () => {
  it("R1 — late same-generation CAS publish would have overwritten without WHERE guard", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: planWithGoal("FIRST"),
    });
    const second = casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: planWithGoal("SECOND"),
    });
    assert.equal(second, false, "after fix: second same-generation publish is rejected");
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "FIRST");
  });

  it("R2 — same-generation poison artifact is repairable after identity-only preservation fix", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    insertPoisonArtifact(db, worldId, snap);

    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap), null);
    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planWithGoal("REPAIRED"),
      }),
      true
    );
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "REPAIRED");
  });
});
