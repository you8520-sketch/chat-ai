import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  applyLocalSceneProgressDelta,
  emptyLocalSceneProgress,
  parseLocalSceneProgress,
  parseLocalSceneProgressDelta,
  serializeLocalSceneStateForGm,
} from "./localSceneProgress";
import {
  applyLocalSceneProgressToContext,
  emptyCampaignContext,
  loadCampaignContext,
  persistCampaignContext,
} from "./campaignContext";
import { parseTrpgGmOutput } from "./gmPrompt";
import { applyCampaignLedger, emptyCampaignLedger } from "./campaignLedger";
import { ensureTrpgTables } from "./schema";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

describe("TRPG local scene progress", () => {
  it("L1 route discovery persists open route across rounds (omission is not deletion)", () => {
    let state = emptyLocalSceneProgress();
    state = applyLocalSceneProgressDelta(state, {
      objectiveSet: "건물 탈출 경로 확보",
      openRoutesAdd: ["우측 환풍구"],
    });
    const next = applyLocalSceneProgressDelta(state, {
      remainingBlockersAdd: ["환풍구 앞 기생종 압박"],
    });
    assert.deepEqual(next.openRoutes, ["우측 환풍구"]);
    assert.deepEqual(next.remainingBlockers, ["환풍구 앞 기생종 압박"]);
  });

  it("L2 new pressure keeps existing route and adds blocker", () => {
    const state = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "탈출",
      openRoutesAdd: ["환풍구"],
    });
    const pressured = applyLocalSceneProgressDelta(state, {
      remainingBlockersAdd: ["기생종 접근"],
    });
    assert.deepEqual(pressured.openRoutes, ["환풍구"]);
    assert.deepEqual(pressured.remainingBlockers, ["기생종 접근"]);
  });

  it("L3 resolved obstacle persists into next round", () => {
    const state = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      resolvedObstaclesAdd: ["정면 균사벽 일부 제거"],
    });
    const next = applyLocalSceneProgressDelta(state, {});
    assert.deepEqual(next.resolvedObstacles, ["정면 균사벽 일부 제거"]);
  });

  it("L4 explicit causal reversal removes a route", () => {
    const state = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["환풍구"],
    });
    const reversed = applyLocalSceneProgressDelta(state, {
      openRoutesRemove: ["환풍구"],
      remainingBlockersAdd: ["건물 붕괴로 환풍구 봉쇄"],
    });
    assert.deepEqual(reversed.openRoutes, []);
    assert.deepEqual(reversed.remainingBlockers, ["건물 붕괴로 환풍구 봉쇄"]);
  });

  it("L5 player stays — local scene does not force location change", () => {
    const ledger = applyCampaignLedger(emptyCampaignLedger(), {
      players: [],
      location: "편의점",
      localScene: {
        openRoutesAdd: ["환풍구"],
        sceneStateSet: "transition_ready",
      },
    });
    assert.equal(ledger.location, "편의점");
    const progress = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["환풍구"],
      sceneStateSet: "transition_ready",
    });
    assert.equal(progress.sceneState, "transition_ready");
    assert.deepEqual(progress.openRoutes, ["환풍구"]);
  });

  it("L6 complex encounter stays active unless explicitly transition_ready", () => {
    const boss = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "보스 격파",
      remainingBlockersAdd: ["보스 HP 잔존"],
    });
    const unchanged = applyLocalSceneProgressDelta(boss, {
      remainingBlockersAdd: ["광역 위협"],
    });
    assert.equal(unchanged.sceneState, "active");
    assert.deepEqual(unchanged.remainingBlockers, ["보스 HP 잔존", "광역 위협"]);
  });

  it("L7 quiet social does not fabricate threats on empty delta", () => {
    const social = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "정보 교환",
      sceneStateSet: "active",
    });
    const next = applyLocalSceneProgressDelta(social, undefined);
    assert.deepEqual(next.remainingBlockers, []);
    assert.deepEqual(next.openRoutes, []);
  });

  it("L8 scene transition reset clears prior routes and resolved obstacles", () => {
    const sceneA = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "편의점 탈출",
      openRoutesAdd: ["환풍구"],
      resolvedObstaclesAdd: ["균사벽 제거"],
    });
    const sceneB = applyLocalSceneProgressDelta(sceneA, {
      objectiveSet: "유지보수 터널 안전 통과",
    });
    assert.equal(sceneB.objective, "유지보수 터널 안전 통과");
    assert.deepEqual(sceneB.openRoutes, []);
    assert.deepEqual(sceneB.resolvedObstacles, []);
  });

  it("L9 omission is not deletion for open routes", () => {
    const state = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["환풍구"],
    });
    const next = applyLocalSceneProgressDelta(state, {
      remainingBlockersAdd: ["기생종"],
    });
    assert.deepEqual(next.openRoutes, ["환풍구"]);
  });

  it("L10 regen applies only the accepted canonical delta once", () => {
    const original = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["정면"],
    });
    const accepted = applyLocalSceneProgressDelta(original, {
      openRoutesRemove: ["정면"],
      openRoutesAdd: ["환풍구"],
    });
    assert.deepEqual(accepted.openRoutes, ["환풍구"]);
    assert.notDeepEqual(accepted.openRoutes, original.openRoutes);
  });

  it("L11 stale commit with no localScene delta leaves accepted state unchanged", () => {
    const current = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "탈출",
      openRoutesAdd: ["환풍구"],
      resolvedObstaclesAdd: ["문 파괴"],
    });
    const unchanged = applyLocalSceneProgressDelta(current, undefined);
    assert.deepEqual(unchanged.resolvedObstacles, ["문 파괴"]);
    assert.deepEqual(unchanged.openRoutes, ["환풍구"]);
  });

  it("parses GM delta localScene through canonical parse path", () => {
    const parsed = parseTrpgGmOutput(`<<<NARRATION>>>
환풍구가 보인다.
<<<DELTA>>>
{"players":[],"location":"복도","localScene":{"objectiveSet":"탈출","openRoutesAdd":["환풍구"],"resolvedObstaclesAdd":["균사벽 제거"]}}`);
    assert.equal(parsed.delta.localScene?.objectiveSet, "탈출");
    assert.deepEqual(parsed.delta.localScene?.openRoutesAdd, ["환풍구"]);
  });

  it("malformed local scene values fail safe without throwing", () => {
    assert.deepEqual(parseLocalSceneProgress({ version: 99 }).objective, "");
    assert.equal(parseLocalSceneProgressDelta({ sceneStateSet: "invalid" }), undefined);
    const clipped = parseLocalSceneProgressDelta({
      openRoutesAdd: ["a".repeat(200), "valid"],
    })?.openRoutesAdd?.[0];
    assert.ok(clipped && clipped.length <= 80);
  });

  it("old campaign NULL local_scene_progress_json loads as empty state", () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaign_context (campaign_id) VALUES (?)`).run(42);
    const ctx = loadCampaignContext(db, 42);
    assert.ok(ctx);
    assert.equal(ctx!.localSceneProgress.objective, "");
    assert.deepEqual(ctx!.localSceneProgress.openRoutes, []);
  });

  it("persists and reloads local scene progress through campaign context", () => {
    const db = memoryDb();
    const ctx = applyLocalSceneProgressToContext(emptyCampaignContext(7), {
      objectiveSet: "탈출",
      openRoutesAdd: ["환풍구"],
    });
    persistCampaignContext(db, ctx);
    const loaded = loadCampaignContext(db, 7);
    assert.equal(loaded?.localSceneProgress.objective, "탈출");
    assert.deepEqual(loaded?.localSceneProgress.openRoutes, ["환풍구"]);
  });

  it("serializeLocalSceneStateForGm renders compact Korean block", () => {
    const block = serializeLocalSceneStateForGm(
      applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
        objectiveSet: "건물 탈출",
        openRoutesAdd: ["환풍구"],
        resolvedObstaclesAdd: ["균사벽 제거"],
        remainingBlockersAdd: ["기생종"],
        sceneStateSet: "transition_ready",
      })
    );
    assert.match(block, /\[LOCAL SCENE STATE\]/);
    assert.match(block, /현재 목표/);
    assert.match(block, /환풍구/);
    assert.match(block, /transition_ready/);
  });

  it("dedupes duplicate list entries from model output", () => {
    const delta = parseLocalSceneProgressDelta({
      openRoutesAdd: ["환풍구", "환풍구", "정면"],
    });
    assert.deepEqual(delta?.openRoutesAdd, ["환풍구", "정면"]);
    const applied = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["환풍구", "환풍구"],
    });
    assert.deepEqual(applied.openRoutes, ["환풍구"]);
  });
});
