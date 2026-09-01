import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { GREETING_LIMIT, SPEECH_EXAMPLES_LIMIT, AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import {
  buildAiPartyCharacterContextBlock,
  type TrpgAiCharacterContext,
} from "./aiCharacterContext";
import {
  buildTrpgBotActionUserBlock,
  prepareTrpgBotActionBody,
  TRPG_BOT_SYSTEM,
} from "./botActions";
import {
  parseTrpgBotAction,
  sanitizeBotActionText,
  TRPG_BOT_INTENT_OPEN,
} from "./botActionParse";
import { adaptTrpgBotChatBody, adaptTrpgGmChatBody } from "./gmClient";
import { buildTrpgGmUserBlock } from "./gmPrompt";
import {
  TRPG_BOT_MAX_TOKENS,
  TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS,
  TRPG_GM_MAX_TOKENS,
  TRPG_GM_MODEL,
  TRPG_BOT_MODEL,
} from "./types";

function nearMaxField(prefix: string, limit: number, sentinel: string): string {
  const pad = "가".repeat(Math.max(0, limit - Array.from(sentinel).length - Array.from(prefix).length - 1));
  return `${prefix}${pad}\n${sentinel}`;
}

describe("TRPG no redundant runtime truncation", () => {
  it("A: bot user block preserves full character card near authoring limits", () => {
    const description = nearMaxField("DESC_", PROFILE_BIOGRAPHY_LIMIT, "END_DESCRIPTION");
    const greeting = nearMaxField("GREET_", GREETING_LIMIT, "END_GREETING");
    const exampleDialog = nearMaxField("EX_", SPEECH_EXAMPLES_LIMIT, "END_EXAMPLE");
    const systemPrompt = nearMaxField("SYS_", AI_LEARNING_LIMIT, "END_SYSTEM");
    const block = buildTrpgBotActionUserBlock({
      characterName: "유나",
      description,
      greeting,
      exampleDialog,
      systemPrompt,
      previousGmNarration: "골목",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: "문을 연다." }],
    });
    assert.match(block, /END_DESCRIPTION/);
    assert.match(block, /END_GREETING/);
    assert.match(block, /END_EXAMPLE/);
    assert.match(block, /END_SYSTEM/);
  });

  it("B: full campaign world_brief reaches bot prompt (WORLD_END_CANARY)", () => {
    const worldBrief = `${"세".repeat(2500)}\nWORLD_END_CANARY`;
    const block = buildTrpgBotActionUserBlock({
      characterName: "유나",
      description: "동료",
      greeting: "…",
      systemPrompt: "반말",
      campaignWorld: worldBrief,
      previousGmNarration: "골목",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: "문을 연다." }],
    });
    assert.match(block, /WORLD_END_CANARY/);
    assert.ok(block.includes("세".repeat(2500)));
  });

  it("C: engineAdvance does not clip bot card fields at runtime", () => {
    const src = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.doesNotMatch(src, /TRPG_BOT_CARD_FIELD_MAX_CHARS/);
    assert.doesNotMatch(src, /TRPG_BOT_CARD_PROMPT_MAX_CHARS/);
    assert.doesNotMatch(src, /clipTrpgChars\(fields\.description/);
    assert.doesNotMatch(src, /clipTrpgChars\(opts\.campaign\.world_brief/);
  });

  it("D: bot systemPrompt sentinel preserved (no 3500 runtime cap)", () => {
    const systemPrompt = `${"나".repeat(3600)}TAIL_SYSTEM_SENTINEL`;
    const block = buildTrpgBotActionUserBlock({
      characterName: "유나",
      description: "동료",
      greeting: "…",
      systemPrompt,
      previousGmNarration: "골목",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: "문을 연다." }],
    });
    assert.match(block, /TAIL_SYSTEM_SENTINEL/);
  });

  it("E/F: parser preserves long completed bot prose through END_OF_BOT_SCENE", () => {
    const prose = `${"그는 천천히 숨을 고른다. ".repeat(80).trim()} END_OF_BOT_SCENE`;
    assert.ok(Array.from(prose).length > 800);
    const raw = `${prose}\n\n<<<ACTION_TYPE>>>\ninvestigate\n\n${TRPG_BOT_INTENT_OPEN}\n주변을 살핀다.`;
    const parsed = parseTrpgBotAction(raw);
    assert.match(parsed.prose, /END_OF_BOT_SCENE/);
    assert.ok(Array.from(parsed.prose).length > 800);
    const sanitized = sanitizeBotActionText(raw);
    assert.match(sanitized, /END_OF_BOT_SCENE/);
    const prepared = prepareTrpgBotActionBody(raw, "fallback");
    assert.match(prepared, /END_OF_BOT_SCENE/);
    assert.doesNotMatch(parsed.prose, /END_OF_BOT_SCEN$/);
  });

  it("G: full AI intent preserved without 120-char hard cap", () => {
    const longIntent = "의".repeat(500);
    const raw = `짧은 행동.\n\n${TRPG_BOT_INTENT_OPEN}\n${longIntent}`;
    const parsed = parseTrpgBotAction(raw);
    assert.equal(parsed.intent, longIntent);
    assert.ok(Array.from(parsed.intent).length > 120);
  });

  it("H: GM AI party block preserves authored character canon without runtime cap", () => {
    const row: TrpgAiCharacterContext = {
      participantId: 12,
      characterId: 15,
      creatorUserId: null,
      name: "태현",
      gender: "male",
      assets: [],
      description: nearMaxField("D_", PROFILE_BIOGRAPHY_LIMIT, "GM_DESC_END"),
      greeting: nearMaxField("G_", GREETING_LIMIT, "GM_GREET_END"),
      exampleDialog: nearMaxField("E_", SPEECH_EXAMPLES_LIMIT, "GM_EXAMPLE_END"),
      systemPrompt: nearMaxField("S_", 4000, "GM_SYSTEM_END"),
    };
    const block = buildAiPartyCharacterContextBlock([row]);
    assert.match(block, /GM_DESC_END/);
    assert.match(block, /GM_GREET_END/);
    assert.match(block, /GM_EXAMPLE_END/);
    assert.match(block, /GM_SYSTEM_END/);
    const charSection = block.slice(block.indexOf("[AI CHARACTER participantId=12]"));
    assert.ok(Array.from(charSection).length > 5000);
  });

  it("I: campaign world authoritative in bot block; character world excluded from GM block", () => {
    const gmBlock = buildAiPartyCharacterContextBlock([
      {
        participantId: 12,
        characterId: 15,
        creatorUserId: null,
        name: "태현",
        gender: "male",
        assets: [],
        description: "요원",
        greeting: "",
        exampleDialog: "",
        systemPrompt: "",
      },
    ]);
    assert.doesNotMatch(gmBlock, /CHARACTER_WORLD_SHOULD_NOT_APPEAR/);
    const gmUser = buildTrpgGmUserBlock({
      worldBrief: "CAMPAIGN_WORLD_CANON",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      aiPartyCharacterContext: gmBlock,
      actions: [],
    });
    assert.match(gmUser, /\[WORLD\]\nCAMPAIGN_WORLD_CANON/);
    const botUser = buildTrpgBotActionUserBlock({
      characterName: "태현",
      description: "요원",
      greeting: "",
      systemPrompt: "",
      campaignWorld: "CAMPAIGN_WORLD_CANON FULL",
      previousGmNarration: "골목",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: "문을 연다." }],
    });
    assert.match(botUser, /CAMPAIGN WORLD[\s\S]*CAMPAIGN_WORLD_CANON FULL/);
  });

  it("J: GM/Bot transport max_tokens equals Gemini 3.7 Flash model capability max", () => {
    assert.equal(TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS, 65_536);
    assert.equal(TRPG_GM_MAX_TOKENS, TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS);
    assert.equal(TRPG_BOT_MAX_TOKENS, TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS);
    assert.equal(TRPG_GM_MODEL, TRPG_BOT_MODEL);

    const gmBody = adaptTrpgGmChatBody({
      model: TRPG_GM_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: true,
      max_tokens: TRPG_GM_MAX_TOKENS,
    });
    assert.equal(gmBody.max_tokens, 65_536);

    const botBody = adaptTrpgBotChatBody({
      model: TRPG_BOT_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: false,
      max_tokens: TRPG_BOT_MAX_TOKENS,
    });
    assert.equal(botBody.max_tokens, 65_536);
  });

  it("K: callTrpgGm/callTrpgBot assemble model-max max_tokens (no omission default)", () => {
    const gmCallSrc = readFileSync("src/lib/trpg/gmCall.ts", "utf8");
    assert.match(gmCallSrc, /max_tokens:\s*TRPG_GM_MAX_TOKENS/);
    assert.match(gmCallSrc, /max_tokens:\s*TRPG_BOT_MAX_TOKENS/);
    assert.doesNotMatch(gmCallSrc, /max_tokens:\s*12288/);
    assert.doesNotMatch(gmCallSrc, /max_tokens:\s*2048/);
  });

  it("TRPG_BOT_SYSTEM uses scope-based beat contract, not numeric length range", () => {
    assert.match(TRPG_BOT_SYSTEM, /one coherent finished PC action beat/i);
    assert.match(TRPG_BOT_SYSTEM, /Do not expand into a full GM scene/i);
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /300–800/);
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /aim about 550/);
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /^Length:/m);
  });

  it("aiCharacterContext serializes without clip helpers", () => {
    const src = readFileSync("src/lib/trpg/aiCharacterContext.ts", "utf8");
    assert.doesNotMatch(src, /clipTrpgPreservedLines/);
    assert.doesNotMatch(src, /clipTrpgChars/);
    assert.doesNotMatch(src, /TRPG_GM_AI_CHARACTER_CONTEXT_MAX_CHARS/);
  });
});
