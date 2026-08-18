import assert from "node:assert/strict";
import fs from "node:fs";
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
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import {
  adaptTrpgReplySuggestionChatBody,
  buildReplySuggestionPublicContext,
  extractReplySuggestionCompletionText,
  parseReplySuggestions,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  TRPG_REPLY_SUGGESTION_AIM_MAX_CHARS,
  TRPG_REPLY_SUGGESTION_AIM_MIN_CHARS,
  TRPG_REPLY_SUGGESTION_MAX_TOKENS,
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
    assert.equal(TRPG_REPLY_SUGGESTION_MAX_TOKENS, 1000);
  });

  it("asks Flash for 지문 and 대사 in the 80–120 character band", () => {
    const { system } = buildReplySuggestionPublicContext({
      scene: "폐역",
      persona: null,
      recentActions: [],
      self: null,
      party: [],
    });
    assert.match(system, /stage \(지문\)/);
    assert.match(system, /speech \(대사\)/);
    assert.match(system, /Do not output speech-only/);
    assert.match(
      system,
      new RegExp(`${TRPG_REPLY_SUGGESTION_AIM_MIN_CHARS}–${TRPG_REPLY_SUGGESTION_AIM_MAX_CHARS}`)
    );
    const sample = system.match(/\{"suggestions":\[.*\]\}/);
    assert.ok(sample, "system prompt must include a JSON few-shot");
    const parsed = parseReplySuggestions(sample[0]);
    for (const row of parsed) {
      const n = Array.from(row.text).length;
      assert.ok(
        n >= TRPG_REPLY_SUGGESTION_AIM_MIN_CHARS && n <= TRPG_REPLY_SUGGESTION_AIM_MAX_CHARS,
        `few-shot "${row.text}" is ${n} chars`
      );
      assert.ok(row.stage, "few-shot must include 지문");
      assert.ok(row.speech, "few-shot must include 대사");
    }
  });

  it("parses exactly three valid action types", () => {
    const parsed = parseReplySuggestions(validJson);
    assert.equal(parsed.length, 3);
    assert.deepEqual(
      parsed.map((row) => row.actionType),
      ["investigate", "persuade", "free"]
    );
    assert.equal(parsed[0]?.stage, "경첩부터 살핀다.");
    assert.equal(parsed[0]?.speech, "");
    assert.throws(() => parseReplySuggestions(JSON.stringify({ suggestions: [{ actionType: "fly", text: "x" }] })));
  });

  it("parses stage and speech and composes tap-to-fill text", () => {
    const parsed = parseReplySuggestions(
      JSON.stringify({
        suggestions: [
          {
            actionType: "investigate",
            stage: "문을 바로 열지 않고 경첩과 바닥의 먼지를 손가락으로 훑는다.",
            speech: "잠깐. 손대지 마. 내가 먼저 볼게.",
          },
          {
            actionType: "stealth",
            지문: "벽에 붙어 발소리를 죽인 채 모퉁이를 살핀다.",
            대사: "",
          },
          {
            actionType: "persuade",
            text: "한 손을 들어 상대를 멈춘다. 「잠깐. 서로 총부터 내려놓고 얘기하지.」",
          },
        ],
      })
    );
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0]?.stage, "문을 바로 열지 않고 경첩과 바닥의 먼지를 손가락으로 훑는다.");
    assert.equal(parsed[0]?.speech, "잠깐. 손대지 마. 내가 먼저 볼게.");
    assert.equal(
      parsed[0]?.text,
      "문을 바로 열지 않고 경첩과 바닥의 먼지를 손가락으로 훑는다. 「잠깐. 손대지 마. 내가 먼저 볼게.」"
    );
    assert.equal(parsed[1]?.stage, "벽에 붙어 발소리를 죽인 채 모퉁이를 살핀다.");
    assert.equal(parsed[1]?.speech, "");
    assert.equal(parsed[1]?.text, "벽에 붙어 발소리를 죽인 채 모퉁이를 살핀다.");
    assert.equal(parsed[2]?.stage, "한 손을 들어 상대를 멈춘다.");
    assert.equal(parsed[2]?.speech, "잠깐. 서로 총부터 내려놓고 얘기하지.");
  });

  it("renders 지문 and 대사 as separate lines in the room list", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /item\.stage/);
    assert.match(room, /item\.speech/);
    assert.match(room, /「\{item\.speech\}」/);
  });

  it("scrolls the room down to the suggestion list when examples appear", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /bottomRef/);
    assert.match(room, /scrollToLatest/);
    assert.match(room, /suggestionsAnchorRef/);
    assert.match(room, /scrollIntoView/);
    assert.match(room, /block: "end"/);
    assert.match(room, /role="switch"/);
    assert.match(room, /행동 예시 켜짐/);
    assert.match(room, /행동 예시 꺼짐/);
    assert.doesNotMatch(room, /✨ 행동 예시/);
    const client = fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(client, /shouldAutoRequestTrpgActionSuggestions/);
    assert.match(client, /saveTrpgActionSuggestionsEnabled/);
  });

  it("keeps Flash suggestion true OFF instead of the RP adapter that strips reasoning_effort", () => {
    const raw = {
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL,
      messages: [{ role: "user", content: "장면" }],
      reasoning_effort: "high",
    };
    const isolated = adaptTrpgReplySuggestionChatBody(raw);
    const rp = adaptCheaperInferenceChatBody(raw);
    assert.deepEqual(isolated.thinking, { type: "disabled" });
    assert.equal(isolated.reasoning_effort, "none");
    assert.deepEqual(rp.thinking, { type: "disabled" });
    assert.equal(rp.reasoning_effort, undefined);
    assert.equal(raw.reasoning_effort, "high", "input must not be mutated");
  });

  it("reads suggestion JSON from content parts or reasoning_content", () => {
    assert.equal(
      extractReplySuggestionCompletionText({
        choices: [{ message: { content: [{ type: "text", text: validJson }] } }],
      }),
      validJson
    );
    assert.equal(
      extractReplySuggestionCompletionText({
        choices: [{ message: { content: "", reasoning_content: validJson } }],
      }),
      validJson
    );
    assert.equal(extractReplySuggestionCompletionText({ choices: [{ message: { content: null } }] }), "");
  });

  it("accepts action_type aliases and fewer than three valid rows", () => {
    const parsed = parseReplySuggestions(
      JSON.stringify({
        suggestions: [
          { action_type: "investigate", text: "경첩부터 살핀다." },
          { actionType: "설득", text: "잠깐, 총부터 내려놓자." },
        ],
      })
    );
    assert.deepEqual(
      parsed.map((row) => row.actionType),
      ["investigate", "persuade"]
    );
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
