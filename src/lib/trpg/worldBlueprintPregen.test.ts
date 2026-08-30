import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
  currentBlueprintGenerationValidity,
  isStoredBlueprintValidForCurrentGeneration,
} from "./blueprintValidity";
import { ensureTrpgTables } from "./schema";
import {
  casPublishWorldBlueprintArtifact,
  copyWorldBlueprintPlan,
  loadValidWorldBlueprintPlan,
  loadWorldBlueprintArtifactRow,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import { hashWorldSnapshot } from "./scenarioDraft";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { parseTrpgScenarioPlan, TRPG_SCENARIO_PLAN_SCHEMA_VERSION } from "./scenarioPlan";
import {
  enqueueWorldBlueprintPregenJob,
  shouldEnqueueWorldBlueprintPregen,
} from "@/lib/derivedCache/worldBlueprintPregen";
import { ensureDerivedCacheJobsTable } from "@/lib/derivedCache/jobs";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignContext, persistCampaignContext } from "./campaignContext";
import { ensureCampaignDirectorContext, isTrpgSandboxDirectorEnabled } from "./sandboxDirector";
import { rowToWorldListItem } from "@/lib/worlds";
import { loadTrpgCatalog } from "./catalog";

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
  ensureDerivedCacheJobsTable(db);
  return db;
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

describe("world Blueprint pregeneration readiness", () => {
  it("hashWorldSnapshot includes updatedAt but generator user prompt does not", () => {
    const a = hashWorldSnapshot({ name: "n", summary: "s", content: "c", updatedAt: "t1" });
    const b = hashWorldSnapshot({ name: "n", summary: "s", content: "c", updatedAt: "t2" });
    assert.notEqual(a, b);
  });

  it("validity owner invalidates on derivation version and world hash", () => {
    const snapshot = {
      id: 1,
      name: "n",
      summary: "s",
      content: "c",
      updatedAt: "t",
      hash: hashWorldSnapshot({ name: "n", summary: "s", content: "c", updatedAt: "t" }),
    };
    const stored = currentBlueprintGenerationValidity(snapshot);
    assert.equal(isStoredBlueprintValidForCurrentGeneration(stored, snapshot), true);
    const changed = { ...snapshot, hash: hashWorldSnapshot({ name: "n2", summary: "s", content: "c", updatedAt: "t" }) };
    assert.equal(isStoredBlueprintValidForCurrentGeneration(stored, changed), false);
    const bumped = {
      ...stored,
      derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION + 1,
    };
    assert.equal(isStoredBlueprintValidForCurrentGeneration(bumped, snapshot), false);
  });

  it("stale CAS publish cannot overwrite a newer world revision artifact", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, updated_at)
       VALUES (2, '북부', '요약', '본문', 1, 'public', datetime('now'))`
    ).run();
    const snapV1 = loadWorldSnapshotForBlueprint(db, 1)!;
    const publishedV1 = casPublishWorldBlueprintArtifact(db, {
      worldId: 1,
      expectedSourceWorldHash: snapV1.hash,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: playablePlan,
    });
    assert.equal(publishedV1, true);

    db.prepare(`UPDATE worlds SET content='본문CHANGED', updated_at=datetime('now') WHERE id=1`).run();
    const stalePublish = casPublishWorldBlueprintArtifact(db, {
      worldId: 1,
      expectedSourceWorldHash: snapV1.hash,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: { ...playablePlan, goal: "stale" },
    });
    assert.equal(stalePublish, false);
    const row = loadWorldBlueprintArtifactRow(db, 1)!;
    assert.match(row.director_plan_json, /원인을 밝힌다/);
    assert.doesNotMatch(row.director_plan_json, /stale/);
  });

  it("duplicate same-revision enqueue is idempotent", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '요약', '본문', 1, 'public')`
    ).run();
    return withSandboxDirectorEnabled(true, async () => {
      const first = enqueueWorldBlueprintPregenJob(db, 1);
      const second = enqueueWorldBlueprintPregenJob(db, 1);
      assert.equal(first, true);
      assert.equal(second, false);
      const count = db
        .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE job_kind='trpg_sandbox_blueprint_pregen'`)
        .get() as { c: number };
      assert.equal(count.c, 1);
    });
  });

  it("campaign copies valid artifact without provider call", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      db.prepare(
        `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
         VALUES (2, '북부', '요약', '본문', 1, 'public')`
      ).run();
      const snap = loadWorldSnapshotForBlueprint(db, 1)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId: 1,
        expectedSourceWorldHash: snap.hash,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });

      let directorCalls = 0;
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        directorCall: async () => {
          directorCalls += 1;
          throw new Error("must not call provider when artifact exists");
        },
        gmCall: async () => ({
          text: `<<<NARRATION>>>\nok\n<<<DELTA>>>\n{"players":[],"location":"x","next_round_context":"y","campaign_finished":false,"storyPhase":"DEVELOPMENT"}`,
        }),
      };
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId: 1,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(directorCalls, 0);
      const ctx = loadCampaignContext(db, campaignId);
      assert.equal(ctx?.directorPlan?.goal, playablePlan.goal);
      assert.notEqual(ctx?.directorPlan, loadValidWorldBlueprintPlan(db, 1, snap));
      assert.deepEqual(ctx?.directorPlan, copyWorldBlueprintPlan(playablePlan));
    });
  });

  it("campaign runtime mutation does not affect world artifact", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      db.prepare(
        `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
         VALUES (2, '북부', '요약', '본문', 1, 'public')`
      ).run();
      const snap = loadWorldSnapshotForBlueprint(db, 1)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId: 1,
        expectedSourceWorldHash: snap.hash,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId: 1,
      });
      await ensureCampaignDirectorContext(db, campaignId);
      const ctx = loadCampaignContext(db, campaignId)!;
      ctx.directorPlan!.goal = "MUTATED";
      persistCampaignContext(db, ctx);
      const artifact = loadValidWorldBlueprintPlan(db, 1, snap);
      assert.equal(artifact?.goal, playablePlan.goal);
    });
  });

  it("feature flag off makes zero pregen enqueue and zero director generation", async () => {
    await withSandboxDirectorEnabled(false, async () => {
      assert.equal(isTrpgSandboxDirectorEnabled(), false);
      assert.equal(
        shouldEnqueueWorldBlueprintPregen({
          previousTrpgEnabled: false,
          nextTrpgEnabled: true,
          nameChanged: false,
          summaryChanged: false,
          contentChanged: true,
        }),
        false
      );
      const db = memoryDb();
      db.prepare(
        `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
         VALUES (2, '북부', '요약', '본문', 1, 'public')`
      ).run();
      let directorCalls = 0;
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId: 1,
      });
      await ensureCampaignDirectorContext(db, campaignId, {
        directorCall: async () => {
          directorCalls += 1;
          return { text: "{}", latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
        },
      });
      assert.equal(directorCalls, 0);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
    });
  });

  it("public world and TRPG catalog projections expose zero Blueprint fields", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '요약', '본문', 1, 'public')`
    ).run();
    const snap = loadWorldSnapshotForBlueprint(db, 1)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId: 1,
      expectedSourceWorldHash: snap.hash,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: { ...playablePlan, secret: "LEAKME" },
    });
    const row = db.prepare(`SELECT * FROM worlds WHERE id=1`).get() as Record<string, unknown>;
    const listItem = rowToWorldListItem(row as never);
    const catalog = loadTrpgCatalog(db, 1);
    const serialized = JSON.stringify({ listItem, catalog });
    assert.doesNotMatch(serialized, /LEAKME/);
    assert.doesNotMatch(serialized, /director_plan/);
    assert.doesNotMatch(serialized, /endingConditions/);
    assert.doesNotMatch(serialized, /WORLDSECRET/);
  });

  it("stored artifact records generator model and schema version", () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO worlds (creator_id, name, summary, content) VALUES (2,'n','s','c')`).run();
    const snap = loadWorldSnapshotForBlueprint(db, 1)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId: 1,
      expectedSourceWorldHash: snap.hash,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: playablePlan as never,
    });
    const row = loadWorldBlueprintArtifactRow(db, 1)!;
    assert.equal(row.generator_model, TRPG_SCENARIO_DRAFT_MODEL);
    assert.equal(row.schema_version, TRPG_SCENARIO_PLAN_SCHEMA_VERSION);
  });
});
