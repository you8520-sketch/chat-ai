import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrpgBotActionUserBlock, sanitizeBotActionText } from "./botActions";
import { splitTrpgRoundCost } from "./billing";
import { buildTrpgMemoryPromptBlock, shouldSealTrpgMemory } from "./memory";

describe("TRPG bot actions", () => {
  it("includes locked human actions so the bot acts after the users", () => {
    const block = buildTrpgBotActionUserBlock({
      characterName: "유나",
      personaPrompt: "질투 많은 반말",
      previousGmNarration: "여관 문이 열린다.",
      humanActions: [{ playerName: "렌", text: "*문을 밀며* \"누구냐.\"" }],
    });
    assert.match(block, /HUMAN ACTIONS THIS ROUND/);
    assert.match(block, /렌/);
    assert.match(block, /여관 문이 열린다/);
    assert.match(block, /Do not roll dice/);
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

describe("TRPG campaign memory", () => {
  it("seals on completed rounds, not chat message counts", () => {
    assert.equal(shouldSealTrpgMemory(3, 0), false);
    assert.equal(shouldSealTrpgMemory(4, 0), true);
    assert.equal(shouldSealTrpgMemory(4, 4), false);
    assert.equal(shouldSealTrpgMemory(8, 4), true);
  });

  it("injects structured HP/location as authority over summaries", () => {
    const block = buildTrpgMemoryPromptBlock({
      structured: {
        roundNumber: 2,
        location: "여관",
        sheets: [{ name: "렌", hp: 10, maxHp: 25, conditions: ["부상"] }],
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
    assert.match(block, /문을 밀어 연다/);
    assert.doesNotMatch(block, /OOC|PARTY/);
  });
});
