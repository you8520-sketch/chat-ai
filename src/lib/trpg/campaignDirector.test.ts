import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import {
  applyCampaignStoryProgress,
  loadCampaignContext,
  resolvedCampaignPlan,
} from "./campaignContext";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { insertParticipant, loadCampaign } from "./store";
import { TRPG_BOT_MODEL, TRPG_GM_MODEL, TRPG_MAX_BOTS } from "./types";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "문이 열린다."): string {
  return `<<<NARRATION>>>
${narration}
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false,"storyPhase":"DEVELOPMENT","threadsAdd":["실종 탐사대"]}`;
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

describe("TRPG sandbox director and plan security", () => {
  it("generates a world-only blueprint once and never again on refresh or next round", async () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '눈', '얼음 마법이 흔하다.', 1, 'public')`
    ).run();
    let directorCalls = 0;
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      directorCall: async () => {
        directorCalls += 1;
        return {
          text: JSON.stringify({
            title: "블루프린트",
            startingSituation: "눈보라 속 성채",
            centralConflict: "얼음 마법의 확산",
            goal: "보급로를 연다",
            secret: "BLUEPRINTSECRET",
            endingConditions: ["성채와 연락한다"],
            clues: ["얼어붙은 전령"],
          }),
          latencyMs: 1,
          model: TRPG_SCENARIO_DRAFT_MODEL,
        };
      },
      gmCall: async ({ user }) => {
        gmCalls += 1;
        assert.match(user, /\[SCENARIO PLAN\]/);
        assert.match(user, /BLUEPRINTSECRET/);
        return { text: gmText(`장면 ${gmCalls}`) };
      },
    };
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      worldId: 1,
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const snap = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(directorCalls, 1);
    assert.equal(gmCalls, 1);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.equal(snap.storyPhase, "DEVELOPMENT");
    const ctx = loadCampaignContext(db, campaignId);
    assert.equal(ctx?.sourceMode, "sandbox");
    assert.match(ctx?.directorPlan?.secret ?? "", /BLUEPRINTSECRET/);
    const usageJson = db.prepare(`SELECT usage_json FROM trpg_rounds WHERE campaign_id=? ORDER BY id ASC LIMIT 1`).get(campaignId) as
      | { usage_json?: string | null }
      | undefined;
    assert.equal(JSON.stringify(usageJson ?? {}).includes("deepseek-v4-flash-0731"), false);

    db.prepare(`UPDATE worlds SET content='나중에 바뀐 세계관CHANGEDWORLD' WHERE id=1`).run();
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 민다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(directorCalls, 1);
    assert.equal(gmCalls, 2);
    assert.doesNotMatch(loadCampaign(db, campaignId)?.world_brief ?? "", /CHANGEDWORLD/);
    assert.doesNotMatch(JSON.stringify(loadCampaignContext(db, campaignId)?.worldSnapshot), /CHANGEDWORLD/);
    db.close();
  });

  it("does not call the director for scenario campaigns and keeps secrets off bot seats", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역",
      content: "유령 기차를 기다린다.",
      visibility: "public",
      scenarioPlan: playablePlan,
    });
    let directorCalls = 0;
    const seen: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      directorCall: async () => {
        directorCalls += 1;
        return { text: "{}", latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
      },
      gmCall: async ({ user }) => {
        seen.push(`gm:${user}`);
        assert.match(user, /SECRETPLAN/);
        return { text: gmText() };
      },
      botCall: async (_system, user) => {
        seen.push(`bot:${user}`);
        assert.doesNotMatch(user, /SECRETPLAN/);
        assert.doesNotMatch(user, /endingCandidates|GM만 아는 비밀/);
        return { text: "모자를 고쳐 쓴다." };
      },
    };
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "유나",
    });
    writeSheet(db, campaignId, botId, "유나", EVEN_STATS, "");
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(directorCalls, 0);
    assert.equal(seen.filter((row) => row.startsWith("bot:")).length, 1);
    assert.ok(seen.some((row) => row.startsWith("gm:") && row.includes("SECRETPLAN")));
    assert.equal(loadCampaignContext(db, campaignId)?.sourceMode, "scenario");
    db.close();
  });

  it("copies authored scenario plans onto directorPlan so endingConditionId resolves", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역",
      content: "유령 기차를 기다린다.",
      visibility: "public",
      scenarioPlan: playablePlan,
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      directorCall: async () => {
        throw new Error("scenario campaigns must not call the sandbox director");
      },
      gmCall: async () => ({
        text: `<<<NARRATION>>>
문이 열린다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false,"storyPhase":"DEVELOPMENT","endingConditionId":"0"}`,
      }),
    };
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const ctx = loadCampaignContext(db, campaignId);
    assert.equal(ctx?.sourceMode, "scenario");
    assert.equal(ctx?.directorPlan?.goal, playablePlan.goal);
    assert.deepEqual(ctx?.directorPlan?.endingConditions, playablePlan.endingConditions);
    assert.equal(resolvedCampaignPlan(ctx)?.secret, playablePlan.secret);
    assert.equal(ctx?.endingStatus.endingConditionId, "0");
    assert.equal(ctx?.endingStatus.endingConditionText, "코어를 봉쇄한다");

    const byText = applyCampaignStoryProgress(ctx!, {
      endingConditionId: "코어를 봉쇄한다",
    });
    assert.equal(byText.endingStatus.endingConditionText, "코어를 봉쇄한다");
    db.close();
  });

  it("rejects a valid JSON blueprint that is missing goal or ending conditions", async () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '얼음 마법', 1, 'public')`
    ).run();
    let directorCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      directorCall: async () => {
        directorCalls += 1;
        return {
          text: JSON.stringify({
            title: "불완전",
            startingSituation: "눈보라 속 성채",
            centralConflict: "얼음 마법의 확산",
            secret: "INCOMPLETESECRET",
          }),
          latencyMs: 1,
          model: TRPG_SCENARIO_DRAFT_MODEL,
        };
      },
      gmCall: async ({ user }) => {
        assert.doesNotMatch(user, /\[SCENARIO PLAN\]/);
        assert.doesNotMatch(user, /INCOMPLETESECRET/);
        assert.doesNotMatch(user, /DIRECTOR DELTA CONTRACT/);
        return { text: gmText("세계관만으로 시작한다.") };
      },
    };
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      worldId: 1,
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const snap = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(directorCalls, 1);
    assert.match(snap.currentNarration ?? "", /세계관만으로/);
    assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
    assert.match(loadCampaignContext(db, campaignId)?.directorError ?? "", /required story fields|목표|종료/);
    db.close();
  });

  it("adds the storyPhase JSON contract once when a plan exists and never for legacy campaigns", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역",
      content: "유령 기차를 기다린다.",
      visibility: "public",
      scenarioPlan: playablePlan,
    });
    const planned: string[] = [];
    const plannedDeps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async ({ user }) => {
        planned.push(user);
        return { text: gmText() };
      },
    };
    const plannedId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    saveTrpgSheet(db, { campaignId: plannedId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId: plannedId, userId: 1, deps: plannedDeps });
    assert.equal(planned.length, 1);
    assert.equal((planned[0]?.match(/\[DIRECTOR DELTA CONTRACT\]/g) ?? []).length, 1);
    assert.equal((planned[0]?.match(/"storyPhase"/g) ?? []).length, 1);
    assert.match(planned[0] ?? "", /threadsAdd/);
    assert.match(planned[0] ?? "", /threadsResolve/);
    assert.match(planned[0] ?? "", /endingConditionId/);

    const legacy: string[] = [];
    const legacyDeps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async ({ user }) => {
        legacy.push(user);
        return { text: gmText() };
      },
    };
    const legacyId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId: legacyId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId: legacyId, userId: 1, deps: legacyDeps });
    assert.equal(legacy.length, 1);
    assert.doesNotMatch(legacy[0] ?? "", /DIRECTOR DELTA CONTRACT/);
    assert.doesNotMatch(legacy[0] ?? "", /"storyPhase"/);
    db.close();
  });

  it("falls back to world-only GM play when the director fails", async () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '얼음 마법', 1, 'public')`
    ).run();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      directorCall: async () => {
        throw new Error("director down");
      },
      gmCall: async ({ user }) => {
        assert.doesNotMatch(user, /\[SCENARIO PLAN\]/);
        return { text: gmText("세계관만으로 시작한다.") };
      },
    };
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      worldId: 1,
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const snap = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.match(snap.currentNarration ?? "", /세계관만으로/);
    assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
    assert.match(loadCampaignContext(db, campaignId)?.directorError ?? "", /director down/);
    db.close();
  });

  it("keeps 0/1/2 bot-seat calls independent of director and uses the original models", async () => {
    assert.equal(TRPG_MAX_BOTS, 2);
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(TRPG_SCENARIO_DRAFT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);

    const db = memoryDb();
    const botUsers: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      directorCall: async () => {
        throw new Error("should not run without a world");
      },
      gmCall: async () => ({ text: gmText() }),
      botCall: async (_system, user) => {
        botUsers.push(user);
        return { text: user.includes("[NAME]\n유나") ? "유나-먼저" : "카이-다음" };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const yuna = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "유나",
    });
    const kai = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "카이",
    });
    writeSheet(db, campaignId, yuna, "유나", EVEN_STATS, "");
    writeSheet(db, campaignId, kai, "카이", EVEN_STATS, "");
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botUsers.length, 0);
    submitTrpgAction(db, { campaignId, userId: 1, body: "화물칸을 연다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botUsers.length, 2);
    assert.match(botUsers[0] ?? "", /\[NAME\]\n유나/);
    assert.match(botUsers[1] ?? "", /\[NAME\]\n카이/);
    db.close();
  });
});
