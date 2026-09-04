import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadCampaignContext, persistCampaignContext, emptyCampaignContext, applyLocalSceneProgressToContext } from "./campaignContext";
import {
  markGmGenerationCommitted,
  tryTerminalizeStaleOrphan,
} from "./gmGenerationLease";
import { ensureTrpgTables } from "./schema";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

function gmWithLocalScene(localScene: Record<string, unknown>, narration = "장면이 전개된다."): string {
  return buildTrpgGmStructuredWireText(narration, {
  players: [],
  location: "복도",
  next_round_context: "다음 수",
  campaign_finished: false,
  localScene,
});
}

async function setupSoloWithContext(db: Database.Database, deps: TrpgEngineDeps) {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  await startTrpgCampaign(db, {
    campaignId,
    userId: 1,
    deps: {
      ...deps,
      gmCall: deps.gmCall ?? (async () => ({ text: gmWithLocalScene({ objectiveSet: "시작" }) })),
    },
  });
  return campaignId;
}

function seedStuckGmRound(db: Database.Database, campaignId: number): { roundId: number; requestId: string } {
  const requestId = "req-stuck";
  const roundId = Number(
    db
      .prepare(
        `INSERT INTO trpg_rounds (campaign_id, round_number, phase, lock_holder_request_id, gm_generation_id)
         VALUES (?, 1, 'GENERATING_NARRATION', ?, ?)`
      )
      .run(campaignId, requestId, requestId).lastInsertRowid
  );
  db.prepare(
    `UPDATE trpg_rounds
     SET gm_generation_started_at=datetime('now','-500 seconds'),
         gm_generation_heartbeat_at=datetime('now','-500 seconds'),
         updated_at=datetime('now','-500 seconds')
     WHERE id=?`
  ).run(roundId);
  return { roundId, requestId };
}

describe("TRPG local scene progress commit boundary", () => {
  it("campaign context row exists after startTrpgCampaign (CAMPAIGN_CONTEXT_ROW_GUARANTEED_BEFORE_GM)", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmWithLocalScene({ objectiveSet: "탈출" }) }),
    };
    const campaignId = await setupSoloWithContext(db, deps);
    const ctx = loadCampaignContext(db, campaignId);
    assert.ok(ctx, "ensureCampaignDirectorContext must persist trpg_campaign_context before GM");
    db.close();
  });

  it("C1 accepted commit persists local scene exactly once", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) {
          return { text: gmWithLocalScene({ objectiveSet: "탈출" }, "문이 열린다.") };
        }
        return {
          text: gmWithLocalScene({
            objectiveSet: "건물 탈출",
            openRoutesAdd: ["우측 환풍구"],
            resolvedObstaclesAdd: ["균사벽 제거"],
          }),
        };
      },
    };
    const campaignId = await setupSoloWithContext(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "환풍구를 살핀다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const loaded = loadCampaignContext(db, campaignId);
    assert.equal(loaded?.localSceneProgress.objective, "건물 탈출");
    assert.deepEqual(loaded?.localSceneProgress.openRoutes, ["우측 환풍구"]);
    assert.deepEqual(loaded?.localSceneProgress.resolvedObstacles, ["균사벽 제거"]);
    db.close();
  });

  it("C2 duplicate list items in one commit are deduped, not doubled", async () => {
    const db = memoryDb();
    const ctx = applyLocalSceneProgressToContext(emptyCampaignContext(1), {
      openRoutesAdd: ["환풍구"],
    });
    persistCampaignContext(db, ctx);
    const merged = applyLocalSceneProgressToContext(ctx, {
      openRoutesAdd: ["환풍구", "후문"],
    });
    assert.deepEqual(merged.localSceneProgress.openRoutes, ["환풍구", "후문"]);
    db.close();
  });

  it("C3 regen updates narration only — local scene follows existing regen owner (no state commit)", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) {
          return { text: gmWithLocalScene({ objectiveSet: "탈출" }, "원본 장면.") };
        }
        if (gmCalls === 2) {
          return {
            text: gmWithLocalScene(
              { objectiveSet: "탈출", openRoutesAdd: ["환풍구"] },
              "첫 라운드."
            ),
          };
        }
        return {
          text: gmWithLocalScene(
            { sceneTransitionTo: "완전히 다른 장면", openRoutesAdd: ["정면"] },
            "리롤 장면."
          ),
        };
      },
    };
    const campaignId = await setupSoloWithContext(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "조사한다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const beforeRegen = loadCampaignContext(db, campaignId)?.localSceneProgress;
    assert.deepEqual(beforeRegen?.openRoutes, ["환풍구"]);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    const afterRegen = loadCampaignContext(db, campaignId)?.localSceneProgress;
    assert.deepEqual(afterRegen?.openRoutes, ["환풍구"]);
    assert.notEqual(afterRegen?.objective, "완전히 다른 장면");
    db.close();
  });

  it("C4 stale generation lease rejects commit before local scene can mutate", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    persistCampaignContext(
      db,
      applyLocalSceneProgressToContext(emptyCampaignContext(campaignId), {
        objectiveSet: "탈출",
        openRoutesAdd: ["환풍구"],
      })
    );
    const before = loadCampaignContext(db, campaignId)?.localSceneProgress;
    const { roundId, requestId: tokenA } = seedStuckGmRound(db, campaignId);
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    const tokenB = "token-b-new";
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='GENERATING_NARRATION', gm_generation_id=?, lock_holder_request_id=?,
           gm_generation_heartbeat_at=datetime('now'), gm_generation_started_at=datetime('now')
       WHERE id=?`
    ).run(tokenB, tokenB, roundId);
    assert.equal(markGmGenerationCommitted(db, roundId, tokenA, tokenA), false);
    const after = loadCampaignContext(db, campaignId)?.localSceneProgress;
    assert.deepEqual(after, before);
    db.close();
  });
});
