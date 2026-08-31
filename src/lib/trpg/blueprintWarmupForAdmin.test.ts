import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { ensureDerivedCacheJobsTable } from "@/lib/derivedCache/jobs";
import {
  AdminBlueprintWarmupInputError,
  parseAdminBlueprintWarmupWorldId,
  warmWorldBlueprintForAdmin,
} from "./blueprintWarmupForAdmin";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION } from "./blueprintValidity";
import { ensureTrpgTables } from "./schema";
import {
  casPublishWorldBlueprintArtifact,
  loadValidWorldBlueprintPlan,
  loadWorldBlueprintArtifactRow,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import { parseTrpgScenarioPlan, TRPG_SCENARIO_PLAN_SCHEMA_VERSION } from "./scenarioPlan";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";

const playablePlan = parseTrpgScenarioPlan({
  startingSituation: "폐도시에 들어간다",
  centralConflict: "코어와 인간 세력",
  goal: "WARM_GOAL",
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

function insertWorld(
  db: Database.Database,
  opts: {
    name?: string;
    summary?: string;
    content?: string;
    trpgEnabled?: number;
    updatedAt?: string;
  } = {}
): number {
  const result = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres, cover_url, updated_at)
       VALUES (2, ?, ?, ?, ?, 'public', '[]', '', COALESCE(?, datetime('now')))`
    )
    .run(
      opts.name ?? "북부",
      opts.summary ?? "요약",
      opts.content ?? "본문",
      opts.trpgEnabled ?? 1,
      opts.updatedAt ?? null
    );
  return Number(result.lastInsertRowid);
}

function publishValidArtifact(db: Database.Database, worldId: number): void {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;
  const ok = casPublishWorldBlueprintArtifact(db, {
    worldId,
    expectedSourceFingerprint: snapshot.sourceFingerprint,
    expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
    plan: playablePlan,
  });
  assert.equal(ok, true);
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

describe("admin blueprint warmup input parsing", () => {
  it("W2 rejects malformed worldId values", () => {
    assert.throws(() => parseAdminBlueprintWarmupWorldId(null), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId([]), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId({}), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId({ worldId: 0 }), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId({ worldId: -1 }), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId({ worldId: 1.5 }), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId({ worldId: "1" }), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId({ worldIds: [1] }), AdminBlueprintWarmupInputError);
    assert.throws(() => parseAdminBlueprintWarmupWorldId({ worldId: [1] }), AdminBlueprintWarmupInputError);
    assert.equal(parseAdminBlueprintWarmupWorldId({ worldId: 1 }), 1);
  });
});

describe("admin blueprint warmup orchestration", () => {
  it("W3 missing world → 404 input error / provider 0", async () => {
    const db = memoryDb();
    let providerCalls = 0;
    await assert.rejects(
      () =>
        warmWorldBlueprintForAdmin(db, 999, {
          complete: async () => {
            providerCalls += 1;
            return (await mockBlueprintComplete("X")()) as never;
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AdminBlueprintWarmupInputError);
        assert.equal(error.httpStatus, 404);
        return true;
      }
    );
    assert.equal(providerCalls, 0);
  });

  it("W4 TRPG-disabled world → reject / provider 0", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db, { trpgEnabled: 0 });
    let providerCalls = 0;
    await assert.rejects(
      () =>
        warmWorldBlueprintForAdmin(db, worldId, {
          complete: async () => {
            providerCalls += 1;
            return (await mockBlueprintComplete("X")()) as never;
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AdminBlueprintWarmupInputError);
        assert.equal(error.httpStatus, 400);
        return true;
      }
    );
    assert.equal(providerCalls, 0);
  });

  it("W5 already-valid world → already_warm / provider 0", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    publishValidArtifact(db, worldId);
    let providerCalls = 0;
    const result = await warmWorldBlueprintForAdmin(db, worldId, {
      complete: async () => {
        providerCalls += 1;
        return (await mockBlueprintComplete("SHOULD_NOT_RUN")()) as never;
      },
    });
    assert.deepEqual(result, { ok: true, status: "already_warm", worldId });
    assert.equal(providerCalls, 0);
  });

  it("W6 cold TRPG world → one canonical refresh → valid current artifact", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db, { content: "COLD_BODY" });
    let providerCalls = 0;
    const result = await warmWorldBlueprintForAdmin(db, worldId, {
      complete: async () => {
        providerCalls += 1;
        return (await mockBlueprintComplete("WARMED_GOAL")()) as never;
      },
    });
    assert.deepEqual(result, { ok: true, status: "warmed", worldId });
    assert.equal(providerCalls, 1);
    const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;
    const plan = loadValidWorldBlueprintPlan(db, worldId, snapshot);
    assert.ok(plan);
    assert.equal(plan.goal, "WARMED_GOAL");
  });

  it("W7 generation failure → artifact remains missing / no retry", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    let providerCalls = 0;
    const result = await warmWorldBlueprintForAdmin(db, worldId, {
      complete: async () => {
        providerCalls += 1;
        throw new Error("provider-secret-timeout upstream raw body");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, "failed");
      assert.equal(result.worldId, worldId);
      assert.equal(result.error, "Blueprint generation failed.");
      assert.doesNotMatch(result.error, /provider-secret/);
    }
    assert.equal(providerCalls, 1);
    assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
  });

  it("W8 source changes during generation → stale candidate cannot publish warm", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db, { content: "A" });
    const snapA = loadWorldSnapshotForBlueprint(db, worldId)!;
    let providerCalls = 0;

    const result = await warmWorldBlueprintForAdmin(db, worldId, {
      complete: async () => {
        providerCalls += 1;
        db.prepare(`UPDATE worlds SET content='B', updated_at=datetime('now') WHERE id=?`).run(worldId);
        return (await mockBlueprintComplete("STALE_A")()) as never;
      },
    });

    assert.equal(result.ok, false);
    const snapB = loadWorldSnapshotForBlueprint(db, worldId)!;
    assert.notEqual(snapB.sourceFingerprint, snapA.sourceFingerprint);
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snapB), null);
    assert.equal(providerCalls, 1);
  });

  it("W9 response metadata does not expose world or Blueprint sensitive content", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db, {
      name: "SECRET_WORLD_NAME",
      summary: "secret summary",
      content: "secret content body",
    });
    const result = await warmWorldBlueprintForAdmin(db, worldId, {
      complete: mockBlueprintComplete("SAFE_GOAL") as never,
    });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /SECRET_WORLD_NAME/);
    assert.doesNotMatch(serialized, /secret summary/);
    assert.doesNotMatch(serialized, /secret content body/);
    assert.doesNotMatch(serialized, /director_plan_json/);
    assert.doesNotMatch(serialized, /WORLDSECRET/);
    assert.doesNotMatch(serialized, /startingSituation/);
    assert.deepEqual(Object.keys(result).sort(), ["ok", "status", "worldId"]);
  });

  it("W10 billing owners are not invoked by admin warmup helper", () => {
    const helper = readFileSync("src/lib/trpg/blueprintWarmupForAdmin.ts", "utf8");
    const route = readFileSync("src/app/api/admin/trpg-blueprint-warmup/route.ts", "utf8");
    for (const source of [helper, route]) {
      assert.doesNotMatch(source, /computeTrpgRoundPoints/);
      assert.doesNotMatch(source, /deductPoints|spendPoints|grantFreePoints/);
      assert.doesNotMatch(source, /INSERT INTO point_logs/);
    }
    assert.match(helper, /refreshWorldBlueprintArtifact/);
    assert.doesNotMatch(helper, /generateWorldSandboxBlueprint/);
  });

  it("concurrent duplicate warmups converge on one canonical artifact state", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    let providerCalls = 0;
    const complete = async () => {
      providerCalls += 1;
      return (await mockBlueprintComplete("CONVERGED")()) as never;
    };

    const [first, second] = await Promise.all([
      warmWorldBlueprintForAdmin(db, worldId, { complete }),
      warmWorldBlueprintForAdmin(db, worldId, { complete }),
    ]);

    const successes = [first, second].filter((result) => result.ok);
    assert.ok(successes.length >= 1);
    const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;
    const plan = loadValidWorldBlueprintPlan(db, worldId, snapshot);
    assert.ok(plan);
    assert.equal(plan.goal, "CONVERGED");
    assert.ok(providerCalls >= 1);
  });
});

describe("trpg blueprint admin warmup route", () => {
  it("W1 uses requireAdminUser and rejects non-admin with 403 (source contract)", () => {
    const route = readFileSync("src/app/api/admin/trpg-blueprint-warmup/route.ts", "utf8");
    assert.match(route, /requireAdminUser\(\)/);
    assert.match(route, /status: 403/);
    assert.match(route, /관리자 권한이 필요합니다/);
    assert.match(route, /export async function POST/);
    assert.match(route, /warmWorldBlueprintForAdmin/);
    assert.match(route, /Cache-Control.*no-store/);
    assert.doesNotMatch(route, /FULL_DB_MIGRATION_TOKEN/);
    assert.doesNotMatch(route, /generateWorldSandboxBlueprint/);
    assert.doesNotMatch(route, /ensureCampaignDirectorContext/);
    assert.doesNotMatch(route, /GET\s*\(/);
  });
});
