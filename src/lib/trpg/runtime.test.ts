import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
} from "@/lib/points";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { buildTrpgBotActionUserBlock, sanitizeBotActionText } from "./botActions";
import { computeTrpgRoundPoints, splitTrpgRoundCost } from "./billing";
import { buildTrpgMemoryPromptBlock, roundsDueForSeal } from "./memory";
import { TRPG_BOT_GROSS_MARGIN, TRPG_GM_GROSS_MARGIN } from "./types";

describe("TRPG bot actions", () => {
  it("includes locked human actions so the bot acts after the users", () => {
    const block = buildTrpgBotActionUserBlock({
      characterName: "유나",
      description: "질투 많은 반말",
      greeting: "…뭐야, 또 왔어?",
      systemPrompt: "질투 많은 반말. 상대를 놓치지 않으려 한다.",
      previousGmNarration: "여관 문이 열린다.",
      campaignMemory: "[CAMPAIGN STATE]\nlocation=여관",
      humanActions: [{ playerName: "렌", text: "*문을 밀며* \"누구냐.\"" }],
    });
    assert.match(block, /HUMAN ACTIONS THIS ROUND/);
    assert.match(block, /CHARACTER CARD/);
    assert.match(block, /렌/);
    assert.match(block, /여관 문이 열린다/);
    assert.doesNotMatch(block, /Flash/i);
  });

  it("clips empty bot drafts", () => {
    assert.equal(sanitizeBotActionText("   "), "");
    assert.ok(sanitizeBotActionText("가".repeat(500)).length <= 400);
  });
});

describe("TRPG billing split", () => {
  it("splits among humans only and gives remainder to the host", () => {
    const shares = splitTrpgRoundCost({
      totalPoints: 10,
      humanUserIds: [1, 2, 3],
      hostUserId: 1,
    });
    assert.deepEqual(shares, [
      { userId: 1, points: 4 },
      { userId: 2, points: 3 },
      { userId: 3, points: 3 },
    ]);
    assert.equal(shares.reduce((s, x) => s + x.points, 0), 10);
  });

  it("charges a solo host the full round", () => {
    assert.deepEqual(
      splitTrpgRoundCost({ totalPoints: 80, humanUserIds: [9], hostUserId: 9 }),
      [{ userId: 9, points: 80 }]
    );
  });
});

describe("TRPG round token billing", () => {
  it("bills GM and bot seats at the same Pro 65% margin", () => {
    assert.equal(TRPG_GM_GROSS_MARGIN, 0.65);
    assert.equal(TRPG_BOT_GROSS_MARGIN, 0.65);
    assert.equal(TRPG_GM_GROSS_MARGIN, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN);
    assert.equal(TRPG_BOT_GROSS_MARGIN, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN);
  });

  it("adds the bot-seat Pro call on top of the GM Pro call", () => {
    const gm = {
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 8_000,
      outputTokens: 1_200,
    };
    const bot = {
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 2_500,
      outputTokens: 400,
    };
    const gmOnly = computeTrpgRoundPoints([gm]);
    const botOnly = computeTrpgRoundPoints([bot]);
    const both = computeTrpgRoundPoints([gm, bot]);
    assert.ok(gmOnly > 0);
    assert.ok(botOnly > 0);
    assert.equal(both, gmOnly + botOnly);
    assert.ok(both > gmOnly);
  });
});

describe("TRPG campaign memory", () => {
  it("seals rounds that have fallen out of the raw window", () => {
    assert.deepEqual(roundsDueForSeal([0, 1, 2], -1), []);
    assert.deepEqual(roundsDueForSeal([0, 1, 2, 3], -1), [0]);
    assert.deepEqual(roundsDueForSeal([0, 1, 2, 3], 0), []);
    assert.deepEqual(roundsDueForSeal([0, 1, 2, 3, 4], 0), [1]);
  });

  it("injects structured HP/items/next-decision as authority over summaries", () => {
    const block = buildTrpgMemoryPromptBlock({
      structured: {
        roundNumber: 2,
        location: "여관",
        nextRoundContext: "문을 밀지 창을 볼지",
        sheets: [{ name: "렌", hp: 10, maxHp: 25, conditions: ["부상"], inventory: ["열쇠"] }],
        quests: ["밀서 찾기"],
        npcs: ["여관주인"],
        worldFlags: ["문_열림"],
      },
      sealedSummary: "첫 밤에 문이 열렸다.",
      recentRounds: [
        {
          roundNumber: 2,
          actions: [{ actorName: "렌", text: "문을 밀어 연다." }],
          gmNarration: "경첩이 운다.",
        },
      ],
    });
    assert.match(block, /STRUCTURED STATE/);
    assert.match(block, /HP 10\/25/);
    assert.match(block, /열쇠/);
    assert.match(block, /문을 밀지/);
    assert.match(block, /문을 밀어 연다/);
    assert.doesNotMatch(block, /OOC|PARTY/);
  });
});
