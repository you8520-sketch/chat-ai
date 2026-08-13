import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("TRPG client bundle stays free of node:crypto", () => {
  it("does not pull store.ts into bot action parsing used by the campaign room", () => {
    const bot = read("src/lib/trpg/botActions.ts");
    assert.match(bot, /from "\.\/clip"/);
    assert.doesNotMatch(bot, /campaignLedger/);
    assert.doesNotMatch(bot, /from ["']\.\/store["']/);
    assert.doesNotMatch(bot, /from ["']node:crypto["']/);
    const clip = read("src/lib/trpg/clip.ts");
    assert.doesNotMatch(clip, /from ["'].*store["']/);
    assert.doesNotMatch(clip, /from ["']node:crypto["']/);
    const room = read("src/app/trpg/TrpgCampaignRoom.tsx");
    assert.match(room, /parseTrpgBotAction/);
    assert.doesNotMatch(room, /campaignLedger/);
    assert.doesNotMatch(room, /from ["']@\/lib\/trpg\/store["']/);
  });
});
