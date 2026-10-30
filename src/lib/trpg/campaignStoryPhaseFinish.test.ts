import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { applyCampaignStoryProgress } from "./campaignContext";
import { finalizeGmRoundForGeneration } from "./gmGenerationLease";
import { applyStoryPhaseTransition, TRPG_STORY_PHASE_ADVANCE } from "./scenarioPlan";
import type { TrpgCampaignContext } from "./campaignContext";
import { emptyLocalSceneProgress } from "./localSceneProgress";
import { emptyStoryProgress } from "./storyProgress";

function epilogueContext(): TrpgCampaignContext {
  return {
    campaignId: 1,
    sourceMode: "scenario",
    worldSnapshot: null,
    scenarioSnapshot: null,
    directorPlan: {
      version: 1,
      startingSituation: "",
      centralConflict: "",
      goal: "탈출",
      secret: "",
      clues: [],
      majorEvents: [],
      climax: "",
      endingConditions: ["일행이 출구에 도착해 센터를 벗어난다."],
      factionChanges: [],
      npcs: [],
    },
    storyPhase: "EPILOGUE",
    activeThreads: [],
    resolvedThreads: [],
    endingStatus: { finished: false },
    directorError: "",
    localSceneProgress: emptyLocalSceneProgress(),
    storyProgress: emptyStoryProgress(),
  };
}

describe("TRPG story phase FINISHED vs campaign completion (#1704)", () => {
  it("rejects EPILOGUE→FINISHED without campaign_finished and keeps endingStatus unfinished", () => {
    const ctx = applyCampaignStoryProgress(epilogueContext(), {
      storyPhase: "FINISHED",
      campaignFinished: false,
    });
    assert.equal(ctx.storyPhase, "EPILOGUE");
    assert.equal(ctx.endingStatus.finished, false);
    assert.equal(applyStoryPhaseTransition("EPILOGUE", "FINISHED"), "EPILOGUE");
  });

  it("allows EPILOGUE→FINISHED when campaign_finished is true", () => {
    const ctx = applyCampaignStoryProgress(epilogueContext(), {
      storyPhase: "FINISHED",
      campaignFinished: true,
      endingConditionId: "일행이 출구에 도착해 센터를 벗어난다.",
    });
    assert.equal(ctx.storyPhase, "FINISHED");
    assert.equal(ctx.endingStatus.finished, true);
    assert.equal(ctx.endingStatus.endingConditionText, "일행이 출구에 도착해 센터를 벗어난다.");
  });

  it("finalizeGmRoundForGeneration: unfinished campaign still opens ACTION_INPUT after FINISHED delta rejected", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE trpg_campaigns (id INTEGER PRIMARY KEY, host_user_id INTEGER, title TEXT, status TEXT, updated_at TEXT);
      CREATE TABLE trpg_rounds (
        id INTEGER PRIMARY KEY,
        campaign_id INTEGER,
        round_number INTEGER,
        phase TEXT,
        gm_generation_id TEXT,
        gm_committed_generation_id TEXT,
        lock_holder_request_id TEXT,
        gm_generation_started_at TEXT,
        gm_generation_heartbeat_at TEXT,
        updated_at TEXT
      );
    `);
    db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title, status) VALUES (1, 1, 't', 'ACTION_INPUT')`).run();
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id, gm_committed_generation_id)
           VALUES (1, 6, 'APPLYING_STATE', 'tok', 'tok')`
        )
        .run().lastInsertRowid
    );
    assert.equal(
      finalizeGmRoundForGeneration(db, {
        campaignId: 1,
        roundId,
        roundNumber: 6,
        leaseOwnerId: "tok",
        committedGenerationId: "tok",
        campaignFinished: false,
      }),
      true
    );
    const campaign = db.prepare(`SELECT status FROM trpg_campaigns WHERE id=1`).get() as { status: string };
    const nextRound = db.prepare(`SELECT round_number, phase FROM trpg_rounds WHERE campaign_id=1 ORDER BY id DESC LIMIT 1`).get() as {
      round_number: number;
      phase: string;
    };
    assert.equal(campaign.status, "ACTION_INPUT");
    assert.equal(nextRound.round_number, 7);
    assert.equal(nextRound.phase, "ACTION_INPUT");
    db.close();
  });

  it("finalizeGmRoundForGeneration: campaign_finished true completes campaign without next ACTION_INPUT", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE trpg_campaigns (id INTEGER PRIMARY KEY, host_user_id INTEGER, title TEXT, status TEXT, updated_at TEXT);
      CREATE TABLE trpg_rounds (
        id INTEGER PRIMARY KEY,
        campaign_id INTEGER,
        round_number INTEGER,
        phase TEXT,
        gm_generation_id TEXT,
        gm_committed_generation_id TEXT,
        lock_holder_request_id TEXT,
        gm_generation_started_at TEXT,
        gm_generation_heartbeat_at TEXT,
        updated_at TEXT
      );
    `);
    db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title, status) VALUES (1, 1, 't', 'ACTION_INPUT')`).run();
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id, gm_committed_generation_id)
           VALUES (1, 6, 'APPLYING_STATE', 'tok', 'tok')`
        )
        .run().lastInsertRowid
    );
    assert.equal(
      finalizeGmRoundForGeneration(db, {
        campaignId: 1,
        roundId,
        roundNumber: 6,
        leaseOwnerId: "tok",
        committedGenerationId: "tok",
        campaignFinished: true,
      }),
      true
    );
    const campaign = db.prepare(`SELECT status FROM trpg_campaigns WHERE id=1`).get() as { status: string };
    const rounds = db.prepare(`SELECT round_number, phase FROM trpg_rounds WHERE campaign_id=1 ORDER BY round_number`).all() as Array<{
      round_number: number;
      phase: string;
    }>;
    assert.equal(campaign.status, "CAMPAIGN_COMPLETE");
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]?.phase, "ROUND_COMPLETE");
    db.close();
  });

  it("INTRO→DEVELOPMENT contract stays optional and names round-trip exclusion", () => {
    const intro = TRPG_STORY_PHASE_ADVANCE.INTRO;
    assert.match(intro.when, /mere round-trip or wait with no new fact/);
    assert.equal(applyStoryPhaseTransition("INTRO", "DEVELOPMENT"), "DEVELOPMENT");
    assert.equal(applyStoryPhaseTransition("INTRO", "INTRO"), "INTRO");
  });
});
