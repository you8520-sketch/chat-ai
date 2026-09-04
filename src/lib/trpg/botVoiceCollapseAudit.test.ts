import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
} from "@/lib/chatModels";
import { buildTrpgBotActionUserBlock, TRPG_BOT_SYSTEM } from "./botActions";
import { TRPG_BOT_ACTION_TYPE_OPEN, TRPG_BOT_INTENT_OPEN, parseTrpgBotAction } from "./botActionParse";
import { adaptTrpgBotChatBody, trpgProviderRequestContract } from "./gmClient";
import { BOT_MAX_PROVIDER_ATTEMPTS, resolveTrpgCheaperInferenceModel } from "./gmCall";
import { buildTrpgBotRecentContinuity } from "./memory";
import { TRPG_BOT_MAX_TOKENS, TRPG_BOT_MODEL, TRPG_GM_MODEL } from "./types";

const AUDIT_STRINGS = [
  "영웅 놀이",
  "영웅놀이",
  "영웅",
  "몸값",
  "장례식",
  "업고 가",
  "버리고 가",
  "손해",
  "물고 끌고",
] as const;

function repoContains(needle: string): { count: number; botPromptHits: number } {
  const files = [
    "src/lib/trpg/botActions.ts",
    "src/lib/trpg/gmPrompt.ts",
    "src/lib/trpg/memory.ts",
    "src/lib/trpg/memoryHorizon.ts",
    "src/lib/trpg/types.ts",
  ];
  let count = 0;
  let botPromptHits = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const matches = text.split(needle).length - 1;
    count += matches;
    if (file.includes("botActions") && matches > 0) botPromptHits += matches;
  }
  return { count, botPromptHits };
}

describe("TRPG bot voice collapse audit (Phase 1 static)", () => {
  it("STATIC: hero-play literals absent from bot prompt sources", () => {
    assert.equal(repoContains("영웅 놀이").botPromptHits, 0);
    assert.equal(repoContains("영웅놀이").botPromptHits, 0);
    const heroPlayRepoWide = readFileSync("src/lib/trpg/botActions.ts", "utf8").includes("영웅");
    assert.equal(heroPlayRepoWide, false);
  });

  it("MODEL: TRPG_BOT_MODEL is Luna; previous production bot was DeepSeek V4 Pro", () => {
    assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.notEqual(TRPG_BOT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  });

  it("MODEL REQUEST: bot uses temperature 0.85, max_tokens 2048, reasoning none, no retry", () => {
    const body = adaptTrpgBotChatBody({
      model: TRPG_BOT_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: false,
      temperature: 0.85,
      max_tokens: TRPG_BOT_MAX_TOKENS,
    });
    assert.equal(body.temperature, 0.85);
    assert.equal(body.max_tokens, TRPG_BOT_MAX_TOKENS);
    assert.equal(body.stream, false);
    assert.equal(body.frequency_penalty, undefined);
    assert.equal(body.presence_penalty, undefined);
    const contract = trpgProviderRequestContract(body);
    assert.equal(contract.reasoningEffort, "none");
    assert.equal(BOT_MAX_PROVIDER_ATTEMPTS, 1);
  });

  it("CROSS-BOT: Bot2 sees Bot1 INTENT only, never prose/dice/result", () => {
    const bot1Body = `유나가 창가에 붙는다.\n\n"영웅 놀이는 그만."\n\n${TRPG_BOT_ACTION_TYPE_OPEN}\ninvestigate\n${TRPG_BOT_INTENT_OPEN}\n유나는 렌의 앞을 막으며 창밖을 살피려 했다.`;
    const user2 = buildTrpgBotActionUserBlock({
      characterName: "카이",
      description: "동료",
      greeting: "가자",
      systemPrompt: "조용히",
      gender: "male",
      campaignWorld: "폐허",
      previousGmNarration: "골목",
      campaignMemory: "[CAMPAIGN STATE]\nx=1",
      humanActions: [{ playerName: "렌", text: "문을 연다" }],
      companionActions: [{ name: "유나", text: bot1Body }],
      speakIndex: 2,
      speakCount: 2,
    });
    assert.doesNotMatch(user2, /영웅 놀이/);
    assert.doesNotMatch(user2, /창가에 붙는다/);
    assert.match(user2, /유나는 렌의 앞을 막으며/);
    assert.doesNotMatch(user2, /d20=/);
    assert.doesNotMatch(user2, /tier=/);
  });

  it("CONTINUITY: recent continuity compacts to INTENT not full prose", () => {
    const block = buildTrpgBotRecentContinuity([
      {
        roundNumber: 1,
        actions: [
          {
            actorName: "권태현",
            text: `권태현이 입꼬리를 비틀었다.\n\n"영웅 놀이는 나중에."\n\n${TRPG_BOT_ACTION_TYPE_OPEN}\nattack\n${TRPG_BOT_INTENT_OPEN}\n권태현은 렌 앞을 막으려 했다.`,
          },
        ],
        gmNarration: "불길이 밀려왔다.",
      },
      {
        roundNumber: 2,
        actions: [{ actorName: "렌", text: "앞으로 간다" }],
        gmNarration: "연기가 가득 찼다.",
      },
    ]);
    assert.doesNotMatch(block, /영웅 놀이/);
    assert.doesNotMatch(block, /입꼬리/);
    assert.match(block, /권태현은 렌 앞을 막으려 했다/);
  });

  it("OWNER AUDIT: prompt owners remain deduped (#710 preserved)", () => {
    const user = buildTrpgBotActionUserBlock({
      characterName: "권태현",
      description: "수호대장",
      greeting: "…",
      systemPrompt: "냉소적",
      gender: "male",
      campaignWorld: "엘라리아",
      previousGmNarration: "전투",
      campaignMemory: "[CAMPAIGN STATE]\nx=1",
      humanActions: [{ playerName: "렌", text: "돌진" }],
      speakIndex: 1,
      speakCount: 1,
    });
    const combined = `${TRPG_BOT_SYSTEM}\n${user}`;
    assert.equal((combined.match(/300–800/g) ?? []).length, 1);
    assert.equal((user.match(/\[LENGTH\]/g) ?? []).length, 0);
    assert.equal((user.match(/\[SPEAK ORDER\]/g) ?? []).length, 1);
    assert.equal((TRPG_BOT_SYSTEM.match(/Do not declare a finished result/g) ?? []).length, 1);
    assert.equal((TRPG_BOT_SYSTEM.match(new RegExp(TRPG_BOT_ACTION_TYPE_OPEN, "g")) ?? []).length, 1);
    assert.equal((combined.match(/LEXICAL|ANTI.?REPEAT|do not repeat/gi) ?? []).length, 0);
  });

  it("CHARACTER CARDS: 권태현/강이현 archetypes overlap but cards differ", () => {
    const tae = readFileSync("docs/audits/trpg-bot-voice-collapse-audit/fixtures.json", "utf8");
    assert.match(tae, /권태현/);
    assert.match(tae, /강이현/);
    assert.match(tae, /마체테|수호대/);
    assert.match(tae, /장미단/);
  });
});

describe("TRPG bot voice collapse audit (parse contract helpers)", () => {
  it("parseTrpgBotAction separates prose from metadata", () => {
    const raw = `권태현이 마체테를 세웠다.\n\n"그만."\n\n${TRPG_BOT_ACTION_TYPE_OPEN}\ndefend\n${TRPG_BOT_INTENT_OPEN}\n권태현은 렌 앞을 가로막으려 했다.`;
    const parsed = parseTrpgBotAction(raw);
    assert.match(parsed.prose, /마체테/);
    assert.equal(parsed.actionType, "defend");
    assert.match(parsed.intent, /가로막/);
  });
});
