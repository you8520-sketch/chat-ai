import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "@/lib/chatModels";
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
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", actionType: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
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
    assert.equal(TRPG_REPLY_SUGGESTION_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.notEqual(TRPG_REPLY_SUGGESTION_MODEL, TRPG_SCENARIO_DRAFT_MODEL);
    assert.notEqual(TRPG_REPLY_SUGGESTION_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.notEqual(TRPG_REPLY_SUGGESTION_MODEL, TRPG_GM_MODEL);
    assert.equal(TRPG_REPLY_SUGGESTION_MAX_TOKENS, 1000);
  });

  it("asks Flash for 지문 and 대사 in the 80–120 character band", () => {
    assert.equal(TRPG_REPLY_SUGGESTION_AIM_MIN_CHARS, 80);
    assert.equal(TRPG_REPLY_SUGGESTION_AIM_MAX_CHARS, 120);
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
    assert.match(system, /stance: good, neutral, evil/);
    assert.match(system, /attack, defend, investigate, persuade, support, free/);
    assert.doesNotMatch(system, /actionType must be one of: attack, defend, investigate, persuade, stealth/);
    assert.match(
      system,
      new RegExp(`${TRPG_REPLY_SUGGESTION_AIM_MIN_CHARS}–${TRPG_REPLY_SUGGESTION_AIM_MAX_CHARS}`)
    );
    const sample = system.match(/\{"suggestions":\[.*\]\}/);
    assert.ok(sample, "system prompt must include a JSON few-shot");
    const parsed = parseReplySuggestions(sample[0]);
    assert.deepEqual(
      parsed.map((row) => row.stance),
      ["good", "neutral", "evil"]
    );
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
      parsed.map((row) => row.stance),
      ["good", "neutral", "evil"]
    );
    assert.deepEqual(
      parsed.map((row) => row.actionType),
      ["support", "investigate", "persuade"]
    );
    assert.equal(parsed[1]?.stage, "경첩부터 살핀다.");
    assert.equal(parsed[1]?.speech, "");
    assert.throws(() => parseReplySuggestions(JSON.stringify({ suggestions: [{ stance: "good", actionType: "fly", text: "x" }] })));
  });

  it("parses stage and speech and composes tap-to-fill text", () => {
    const parsed = parseReplySuggestions(
      JSON.stringify({
        suggestions: [
          {
            stance: "neutral",
            actionType: "investigate",
            stage: "문을 바로 열지 않고 경첩과 바닥의 먼지를 손가락으로 훑는다.",
            speech: "잠깐. 손대지 마. 내가 먼저 볼게.",
          },
          {
            stance: "good",
            actionType: "support",
            지문: "다친 동료를 자기 뒤로 물린 채 문 너머를 향해 손바닥을 든다.",
            대사: "",
          },
          {
            stance: "evil",
            actionType: "persuade",
            text: "한 손을 들어 상대를 멈춘다. 「잠깐. 서로 총부터 내려놓고 얘기하지.」",
          },
        ],
      })
    );
    assert.equal(parsed.length, 3);
    assert.deepEqual(
      parsed.map((row) => row.stance),
      ["good", "neutral", "evil"]
    );
    assert.equal(parsed[1]?.stage, "문을 바로 열지 않고 경첩과 바닥의 먼지를 손가락으로 훑는다.");
    assert.equal(parsed[1]?.speech, "잠깐. 손대지 마. 내가 먼저 볼게.");
    assert.equal(
      parsed[1]?.text,
      "문을 바로 열지 않고 경첩과 바닥의 먼지를 손가락으로 훑는다. 「잠깐. 손대지 마. 내가 먼저 볼게.」"
    );
    assert.equal(parsed[0]?.stage, "다친 동료를 자기 뒤로 물린 채 문 너머를 향해 손바닥을 든다.");
    assert.equal(parsed[0]?.speech, "");
    assert.equal(parsed[0]?.text, "다친 동료를 자기 뒤로 물린 채 문 너머를 향해 손바닥을 든다.");
    assert.equal(parsed[2]?.stage, "한 손을 들어 상대를 멈춘다.");
    assert.equal(parsed[2]?.speech, "잠깐. 서로 총부터 내려놓고 얘기하지.");
  });

  it("renders 지문 and 대사 as separate lines in the room list", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /item\.stage/);
    assert.match(room, /item\.speech/);
    assert.match(room, /「\{item\.speech\}」/);
    assert.match(room, /replyStanceLabelKo/);
    assert.match(room, /data-trpg-reply-stance/);
  });

  it("scrolls the room down to the suggestion list when examples appear", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /bottomRef/);
    assert.match(room, /scrollToLatest/);
    assert.match(room, /followLatestRef/);
    assert.match(room, /scrollIntoView/);
    assert.match(room, /block: "nearest"/);
    assert.match(room, /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return/);
    assert.match(room, /role="switch"/);
    assert.match(room, /행동 예시 켜짐/);
    assert.match(room, /행동 예시 꺼짐/);
    assert.doesNotMatch(room, /✨ 행동 예시/);
    assert.doesNotMatch(room, /100, 250, 500, 1000, 1500, 2500/);
    const client = fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(client, /shouldAutoRequestTrpgActionSuggestions/);
    assert.match(client, /saveTrpgActionSuggestionsEnabled/);
    assert.match(client, /loadTrpgActionSuggestionsCache/);
    assert.match(client, /saveTrpgActionSuggestionsCache/);
    assert.match(client, /retrySuggestions/);
    assert.match(room, /onRetrySuggestions/);
    assert.match(room, />\s*다시 시도\s*</);
    assert.match(client, /endless auto-retry\/flicker loop/);
    assert.doesNotMatch(
      client,
      /setSuggestionsError\(message\);[\s\S]{0,200}autoRequestedRoundRef\.current = null;/
    );
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

  it("accepts action_type aliases when the exact three stances are present", () => {
    const parsed = parseReplySuggestions(
      JSON.stringify({
        suggestions: [
          { stance: "neutral", action_type: "investigate", text: "경첩부터 살핀다." },
          { stance: "evil", actionType: "설득", text: "잠깐, 총부터 내려놓자." },
          { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
        ],
      })
    );
    assert.deepEqual(
      parsed.map((row) => row.actionType),
      ["support", "investigate", "persuade"]
    );
  });

  it("rejects fewer than three unique stances", () => {
    assert.throws(
      () =>
        parseReplySuggestions(
          JSON.stringify({
            suggestions: [
              { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
              { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
            ],
          })
        ),
      /행동 예시를 읽지 못했습니다/
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

  it("failover-capable provider round retries once through OpenRouter on transport failure", async () => {
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

  it("lets a refreshed client join the in-flight request", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let completeCalls = 0;
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        completeCalls += 1;
        await hold;
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    const refreshed = requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        completeCalls += 1;
        return { text: validJson };
      },
    });
    assert.equal(completeCalls, 1);
    release();
    const [originalResult, refreshedResult] = await Promise.all([first, refreshed]);
    assert.equal(originalResult.suggestions.length, 3);
    assert.deepEqual(refreshedResult.suggestions, originalResult.suggestions);
    assert.equal(completeCalls, 1);
    db.close();
  });

  it("recovers a completed result after the original browser request disconnects", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let completeCalls = 0;
    const originalResult = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        completeCalls += 1;
        return { text: validJson };
      },
    });
    const replacementResult = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        completeCalls += 1;
        return { text: validJson };
      },
    });
    assert.equal(completeCalls, 1);
    assert.deepEqual(replacementResult.suggestions, originalResult.suggestions);
    db.close();
  });

  it("allows an explicit retry immediately after a failed automatic request", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let completeCalls = 0;
    await assert.rejects(
      () =>
        requestTrpgReplySuggestions(db, {
          campaignId,
          userId: 1,
          complete: async () => {
            completeCalls += 1;
            throw new Error("body completion deadline exceeded");
          },
        }),
      /다시 시도/
    );
    const retried = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        completeCalls += 1;
        return { text: validJson };
      },
    });
    assert.equal(completeCalls, 2);
    assert.equal(retried.suggestions.length, 3);
    db.close();
  });
});
