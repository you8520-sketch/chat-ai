import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCampaignLedger, emptyCampaignLedger } from "./campaignLedger";

describe("TRPG campaign ledger", () => {
  it("adds and removes quests, NPCs, and flags without dropping unrelated facts", () => {
    const first = applyCampaignLedger(emptyCampaignLedger(), {
      players: [],
      location: "여관",
      nextRoundContext: "문을 밀지 창을 볼지",
      questsAdd: ["밀서 찾기"],
      npcsAdd: ["여관주인"],
      flagsAdd: ["문_열림"],
    });
    assert.equal(first.location, "여관");
    assert.match(first.nextRoundContext, /문을 밀지/);
    const next = applyCampaignLedger(first, {
      players: [],
      questsAdd: ["밀서 찾기", "뒷문 열쇠"],
      flagsRemove: ["문_열림"],
      flagsAdd: ["열쇠_획득"],
      npcsRemove: ["없는NPC"],
    });
    assert.deepEqual(next.quests, ["밀서 찾기", "뒷문 열쇠"]);
    assert.deepEqual(next.npcs, ["여관주인"]);
    assert.deepEqual(next.worldFlags, ["열쇠_획득"]);
    assert.equal(next.nextRoundContext, first.nextRoundContext);
  });
});
