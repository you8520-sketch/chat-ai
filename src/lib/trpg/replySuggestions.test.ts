import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { persistCampaignContext, emptyCampaignContext } from "./campaignContext";
import { ensureTrpgTables } from "./schema";
import { loadCampaign } from "./store";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { TRPG_GM_MODEL } from "./types";
import {
  parseReplySuggestions,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  TRPG_REPLY_SUGGESTION_MODEL,
} from "./replySuggestions";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "폐역에 찬 바람이 돈다."): string {
  return `<<<NARRATION>>>
${narration}
<<<DELTA>>>
{"players":[],"location":"폐역","next_round_context":"기다릴지","campaign_finished":false}`;
}

const validJson = JSON.stringify({
  suggestions: [
    { actionType: "investigate", text: "경첩부터 살핀다." },
    { actionType: "persuade", text: "잠깐, 총부터 내려놓자." },
    { actionType: "free", text: "한 발 물러선다." },
  ],
});

const playablePlan = {
  startingSituation: "폐도시에 들어간다",
  centralConflict: "코어와 인간 세력",
  goal: "원인을 밝힌다",
  secret: "SECRET_PLAN_CANARY",
  endingConditions: ["SECRET_ENDING_CANARY"],
  clues: ["숨겨진 단서"],
  endingCandidates: ["SECRET_ENDING_CANARY"],
  gmDirection: "탐험",
};

async function startedCampaign(db: Database.Database, extras?: { templateId?: number; secondUser?: boolean }) {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    templateId: extras?.templateId,
    hostPersona: {
      personaId: 9,
      name: "렌",
      description: "PERSONA_DESC_MARK 차갑고 짧게 말한다.",
      gender: "other",
      speechExamples: "PERSONA_SPEECH_MARK 됐어. 내가 볼게.",
    },
  });
  if (extras?.secondUser) {
    const camp = loadCampaign(db, campaignId)!;
    joinTrpgCampaign(db, { code: camp.invite_code!, userId: 2, nickname: "태현" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "태현", stats: EVEN_STATS });
  }
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const deps: TrpgEngineDeps = { skipBilling: true, gmCall: async () => ({ text: gmText() }) };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return campaignId;
}

describe("TRPG reply suggestions", () => {
  beforeEach(() => {
    resetTrpgReplySuggestionCooldownForTests();
  });

  it("reuses the registered Flash constant and never the Pro GM/Bot model", () => {
    assert.equal(TRPG_REPLY_SUGGESTION_MODEL, TRPG_SCENARIO_DRAFT_MODEL);
    assert.equal(TRPG_REPLY_SUGGESTION_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);
    assert.notEqual(TRPG_REPLY_SUGGESTION_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.notEqual(TRPG_REPLY_SUGGESTION_MODEL, TRPG_GM_MODEL);
  });

  it("parses exactly three valid action types", () => {
    const parsed = parseReplySuggestions(validJson);
    assert.equal(parsed.length, 3);
    assert.deepEqual(
      parsed.map((row) => row.actionType),
      ["investigate", "persuade", "free"]
    );
    assert.throws(() => parseReplySuggestions(JSON.stringify({ suggestions: [{ actionType: "fly", text: "x" }] })));
  });

  it("allows only the acting human in ACTION_INPUT and rejects a locked draft", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db, { secondUser: true });
    await assert.rejects(
      () => requestTrpgReplySuggestions(db, { campaignId, userId: 99, complete: async () => ({ text: validJson }) }),
      /참가자/
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 민다." });
    await assert.rejects(
      () => requestTrpgReplySuggestions(db, { campaignId, userId: 1, complete: async () => ({ text: validJson }) }),
      /이미 제출/
    );
    db.close();
  });

  it("calls the model once, without fallback, and keeps timeout at one call", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let calls = 0;
    await assert.rejects(
      () =>
        requestTrpgReplySuggestions(db, {
          campaignId,
          userId: 1,
          complete: async () => {
            calls += 1;
            throw new Error("timeout");
          },
        }),
      /timeout/
    );
    assert.equal(calls, 1);
    resetTrpgReplySuggestionCooldownForTests();
    const ok = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        calls += 1;
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    assert.equal(calls, 2);
    assert.equal(ok.suggestions.length, 3);
    db.close();
  });

  it("includes recent own manual style and persona, but not other humans, bots, or party OOC", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db, { secondUser: true });
    const host = db
      .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`)
      .get(campaignId) as { id: number };
    db.prepare(
      `INSERT INTO trpg_party_messages (campaign_id, participant_id, user_id, body) VALUES (?,?,?,?)`
    ).run(campaignId, host.id, 1, "PARTY_OOC_CANARY 오늘 뭐 먹지");
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "OWN_MANUAL_STYLE 문을 어깨로 밀어 본다.",
      inputOrigin: "manual",
    });
    submitTrpgAction(db, {
      campaignId,
      userId: 2,
      body: "OTHER_HUMAN_CANARY 내가 먼저 뛰어든다.",
    });
    const deps: TrpgEngineDeps = { skipBilling: true, gmCall: async () => ({ text: gmText("다음 장면") }), rollD20: () => 12 };
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const captured: string[] = [];
    const result = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async ({ user }) => {
        captured.push(user);
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    assert.equal(result.suggestions.length, 3);
    assert.match(captured[0] ?? "", /OWN_MANUAL_STYLE/);
    assert.match(captured[0] ?? "", /PERSONA_DESC_MARK/);
    assert.match(captured[0] ?? "", /PERSONA_SPEECH_MARK/);
    assert.doesNotMatch(captured[0] ?? "", /OTHER_HUMAN_CANARY/);
    assert.doesNotMatch(captured[0] ?? "", /PARTY_OOC_CANARY/);
    db.close();
  });

  it("keeps GM/plan/NPC secrets out of the suggestion model input", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역",
      content: "유령 기차를 기다린다.",
      visibility: "public",
      secretContent: "SECRET_GM_CANARY",
      scenarioPlan: playablePlan,
      npcs: [
        {
          name: "역무원",
          description: "낡은 제복",
          greeting: "표를 보여.",
          systemPrompt: "SECRET_NPC_CANARY",
          stats: null,
        },
      ],
    });
    const campaignId = await startedCampaign(db, { templateId });
    db.prepare(`UPDATE trpg_campaigns SET gm_secret=? WHERE id=?`).run("SECRET_GM_CANARY", campaignId);
    const ctx = emptyCampaignContext(campaignId);
    ctx.directorPlan = {
      version: 1,
      startingSituation: "x",
      centralConflict: "y",
      goal: "z",
      secret: "SECRET_PLAN_CANARY",
      endingConditions: ["SECRET_ENDING_CANARY"],
      majorEvents: [],
      clues: ["hidden"],
      forbiddenEvents: [],
      boss: "",
      specialRules: [],
      difficulty: "normal",
      climax: "",
      endingCandidates: ["SECRET_ENDING_CANARY"],
      factionChanges: [],
      gmDirection: "",
      playLength: "medium",
      provenance: null,
    };
    persistCampaignContext(db, ctx);
    const captured: string[] = [];
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async ({ system, user }) => {
        captured.push(system, user);
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    const blob = captured.join("\n");
    assert.doesNotMatch(blob, /SECRET_GM_CANARY/);
    assert.doesNotMatch(blob, /SECRET_PLAN_CANARY/);
    assert.doesNotMatch(blob, /SECRET_ENDING_CANARY/);
    assert.doesNotMatch(blob, /SECRET_NPC_CANARY/);
    db.close();
  });

  it("stores reply_suggestion origin without changing source=human", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "추천을 조금 고쳐서 문을 연다.",
      inputOrigin: "reply_suggestion",
    });
    const row = db
      .prepare(
        `SELECT source, input_origin FROM trpg_action_submissions s
         JOIN trpg_rounds r ON r.id = s.round_id
         WHERE r.campaign_id=?`
      )
      .get(campaignId) as { source: string; input_origin: string };
    assert.equal(row.source, "human");
    assert.equal(row.input_origin, "reply_suggestion");
    db.close();
  });

  it("rejects a second in-flight request", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        await hold;
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    await assert.rejects(
      () => requestTrpgReplySuggestions(db, { campaignId, userId: 1, complete: async () => ({ text: validJson }) }),
      /이미 행동 예시/
    );
    release();
    assert.equal((await first).suggestions.length, 3);
    db.close();
  });
});
