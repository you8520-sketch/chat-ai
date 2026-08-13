import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
} from "@/lib/points";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { buildTrpgBotActionUserBlock, orderTrpgBotsForRound, sanitizeBotActionText } from "./botActions";
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
      exampleDialog: '"그 사람이랑 왜 얘기해."',
      world: "폐여관",
      previousGmNarration: "여관 문이 열린다.",
      campaignMemory: "[CAMPAIGN STATE]\nlocation=여관",
      humanActions: [{ playerName: "렌", text: "*문을 밀며* \"누구냐.\"" }],
    });
    assert.match(block, /HUMAN ACTIONS THIS ROUND/);
    assert.match(block, /CHARACTER CARD/);
    assert.match(block, /EXAMPLE DIALOG/);
    assert.match(block, /질투 많은 반말/);
    assert.match(block, /렌/);
    assert.match(block, /여관 문이 열린다/);
    assert.match(block, /EARLIER COMPANION ACTIONS THIS ROUND/);
    assert.match(block, /700/);
    assert.match(block, /1600/);
    assert.doesNotMatch(block, /Flash/i);
    const second = buildTrpgBotActionUserBlock({
      characterName: "카이",
      description: "쿨한 동료",
      greeting: "가자.",
      systemPrompt: "짧게 끊는다.",
      previousGmNarration: "여관 문이 열린다.",
      campaignMemory: "[CAMPAIGN STATE]",
      humanActions: [{ playerName: "렌", text: "문을 민다." }],
      companionActions: [{ name: "유나", text: "유나가 먼저 말린다." }],
      speakIndex: 2,
      speakCount: 2,
    });
    assert.match(second, /유나가 먼저 말린다/);
    assert.match(second, /companion 2 of 2/);
    const withBonds = buildTrpgBotActionUserBlock({
      characterName: "유나",
      description: "질투",
      greeting: "뭐야",
      systemPrompt: "반말",
      previousGmNarration: "여관",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: "문을 민다." }],
      relationshipBrief: "렌과 유나는 소꿉친구",
    });
    assert.match(withBonds, /PARTY RELATIONSHIPS/);
    assert.match(withBonds, /소꿉친구/);
  });

  it("orders companions by who the human addressed, then scene recency", () => {
    const tae = { id: 1, name: "권태현" };
    const hyun = { id: 2, name: "강이현" };
    assert.deepEqual(
      orderTrpgBotsForRound({
        bots: [tae, hyun],
        humanActions: [{ playerName: "렌", text: "이현한테 물어본다." }],
        previousGmNarration: "태현이 먼저 나섰다.",
      }).map((b) => b.name),
      ["강이현", "권태현"]
    );
    assert.deepEqual(
      orderTrpgBotsForRound({
        bots: [tae, hyun],
        humanActions: [{ playerName: "렌", text: "화물칸을 연다." }],
        previousGmNarration: "태현이 어깨를 잡았다. 이현은 약 쪽을 본다.",
      }).map((b) => b.name),
      ["강이현", "권태현"]
    );
  });

  it("clips empty bot drafts", () => {
    assert.equal(sanitizeBotActionText("   "), "");
    assert.ok(sanitizeBotActionText("가".repeat(3000)).length <= 2400);
    const withBreaks = sanitizeBotActionText(`첫째 문장.\n\n둘째 문장.\n\n<<<INTENT>>>\n문을 민다.`);
    assert.match(withBreaks, /첫째 문장\.\n\n둘째 문장/);
    assert.match(withBreaks, /<<<INTENT>>>/);
    assert.match(withBreaks, /문을 민다/);
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
