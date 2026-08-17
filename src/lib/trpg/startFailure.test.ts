import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL } from "@/lib/chatModels";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { loadCampaignContext } from "./campaignContext";
import { isTrpgSandboxDirectorEnabled } from "./sandboxDirector";
import { classifyTrpgStartFailure, parseTrpgStartFailureJson } from "./startFailure";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "문이 열린다."): string {
  return `<<<NARRATION>>>
${narration}
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false}`;
}

const playablePlan = {
  startingSituation: "폐도시에 들어간다",
  centralConflict: "코어와 인간 세력",
  goal: "원인을 밝힌다",
  secret: "지휘관대체SECRETPLAN",
  endingConditions: ["코어를 봉쇄한다"],
  clues: ["통신 기록"],
  endingCandidates: ["봉쇄"],
  gmDirection: "탐험",
};

describe("TRPG start failure classification", () => {
  it("classifies API/setup failures as A before an opening round exists", () => {
    assert.equal(
      classifyTrpgStartFailure({ error: new Error("모든 참가자의 시트를 만들어야 합니다.") }).class,
      "A"
    );
    assert.equal(
      classifyTrpgStartFailure({ error: new Error("TRPG는 관리자만 사용할 수 있습니다.") }).class,
      "A"
    );
    assert.equal(classifyTrpgStartFailure({ error: new Error("로그인이 필요합니다.") }).class, "A");
  });

  it("classifies provider failures as B and post-GM persist failures as C", () => {
    assert.equal(
      classifyTrpgStartFailure({
        error: new Error("[TRPG] 401: OPENROUTER"),
        reachedOpeningRound: true,
      }).class,
      "B"
    );
    assert.equal(
      classifyTrpgStartFailure({
        error: new Error("The operation was aborted due to timeout"),
        reachedOpeningRound: true,
      }).class,
      "B"
    );
    assert.equal(
      classifyTrpgStartFailure({
        error: new Error("no such table: trpg_gm_messages"),
        reachedOpeningRound: true,
        gmUsageCount: 1,
      }).class,
      "C"
    );
  });

  it("starts a world-only campaign and an authored scenario campaign", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      directorCall: async () => {
        throw new Error("director must not run");
      },
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText(`장면 ${gmCalls}`) };
      },
    };
    const worldId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId: worldId, userId: 1, name: "렌", stats: EVEN_STATS });
    const world = await startTrpgCampaign(db, { campaignId: worldId, userId: 1, deps });
    assert.equal(world.round.phase, "ACTION_INPUT");
    assert.equal(loadCampaignContext(db, worldId)?.directorPlan, null);

    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역",
      content: "유령 기차를 기다린다.",
      visibility: "public",
      scenarioPlan: playablePlan,
    });
    const authoredId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    saveTrpgSheet(db, { campaignId: authoredId, userId: 1, name: "렌", stats: EVEN_STATS });
    const authored = await startTrpgCampaign(db, { campaignId: authoredId, userId: 1, deps });
    assert.equal(authored.round.phase, "ACTION_INPUT");
    assert.equal(gmCalls, 2);
    assert.equal(loadCampaignContext(db, authoredId)?.directorPlan?.secret, "지휘관대체SECRETPLAN");
    db.close();
  });

  it("keeps missing sheets as class A and does not insert round 0", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    await assert.rejects(
      () => startTrpgCampaign(db, { campaignId, userId: 1, deps: { skipBilling: true } }),
      /시트를 만들어야/
    );
    const rounds = db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as {
      n: number;
    };
    assert.equal(rounds.n, 0);
    db.close();
  });

  it("records opening GM provider failure as ERROR_RECOVERY class B", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await assert.rejects(
      () =>
        startTrpgCampaign(db, {
          campaignId,
          userId: 1,
          deps: {
            skipBilling: true,
            gmCall: async () => {
              throw new Error("[TRPG] 502: provider down");
            },
          },
        }),
      /provider down/
    );
    const row = db
      .prepare(`SELECT phase, error_json, usage_json FROM trpg_rounds WHERE campaign_id=? AND round_number=0`)
      .get(campaignId) as { phase: string; error_json: string; usage_json: string | null };
    assert.equal(row.phase, "ERROR_RECOVERY");
    const failure = parseTrpgStartFailureJson(row.error_json);
    assert.equal(failure?.class, "B");
    assert.match(failure?.error ?? "", /provider down/);
    assert.equal(row.usage_json, null);
    db.close();
  });

  it("records post-GM persist failure as ERROR_RECOVERY class C", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await assert.rejects(
      () =>
        startTrpgCampaign(db, {
          campaignId,
          userId: 1,
          deps: {
            skipBilling: true,
            gmCall: async () => {
              db.exec("DROP TABLE trpg_gm_messages");
              return { text: gmText() };
            },
          },
        }),
      /trpg_gm_messages/
    );
    const row = db
      .prepare(`SELECT phase, error_json, usage_json FROM trpg_rounds WHERE campaign_id=? AND round_number=0`)
      .get(campaignId) as { phase: string; error_json: string; usage_json: string | null };
    assert.equal(row.phase, "ERROR_RECOVERY");
    assert.equal(parseTrpgStartFailureJson(row.error_json)?.class, "C");
    assert.match(row.usage_json ?? "", /deepseek-v4-pro|modelId/);
    db.close();
  });

  it("retries an ERROR_RECOVERY opening start without a second round 0", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) throw new Error("[TRPG] 503: busy");
        return { text: gmText("다시 시작했다.") };
      },
    };
    await assert.rejects(() => startTrpgCampaign(db, { campaignId, userId: 1, deps }), /busy/);
    const snap = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 2);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.match(snap.currentNarration ?? "", /다시 시작했다/);
    const rounds = db
      .prepare(`SELECT round_number, phase, error_json FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number`)
      .all(campaignId) as Array<{ round_number: number; phase: string; error_json: string | null }>;
    assert.equal(rounds.filter((row) => row.round_number === 0).length, 1);
    assert.equal(rounds[0]?.phase, "ROUND_COMPLETE");
    assert.equal(rounds[0]?.error_json, null);
    db.close();
  });

  it("does not call flash 0731 when Sandbox Director is disabled", async () => {
    const prev = process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    const db = memoryDb();
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '얼음 마법', 1, 'public')`
    ).run();
    let directorCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      directorCall: async () => {
        directorCalls += 1;
        return { text: "{}", latencyMs: 1, model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL };
      },
      gmCall: async () => ({ text: gmText() }),
    };
    try {
      assert.equal(isTrpgSandboxDirectorEnabled(), false);
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId: 1,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(directorCalls, 0);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
    } finally {
      if (prev === undefined) delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
      else process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = prev;
      db.close();
    }
  });
});
