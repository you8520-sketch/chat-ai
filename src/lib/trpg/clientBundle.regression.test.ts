import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("TRPG client bundle stays free of node:crypto", () => {
  it("parses bot actions without importing store or campaignLedger", () => {
    const parse = read("src/lib/trpg/botActionParse.ts");
    assert.match(parse, /from "\.\/clip"/);
    assert.doesNotMatch(parse, /campaignLedger/);
    assert.doesNotMatch(parse, /from ["']\.\/store["']/);
    assert.doesNotMatch(parse, /from ["']node:crypto["']/);
    const clip = read("src/lib/trpg/clip.ts");
    assert.doesNotMatch(clip, /from ["'].*store["']/);
    assert.doesNotMatch(clip, /from ["']node:crypto["']/);
    const room = read("src/app/trpg/TrpgCampaignRoom.tsx");
    assert.match(room, /from ["']@\/lib\/trpg\/botActionParse["']/);
    assert.doesNotMatch(room, /from ["']@\/lib\/trpg\/botActions["']/);
    assert.doesNotMatch(room, /campaignLedger/);
    assert.doesNotMatch(room, /from ["']@\/lib\/trpg\/store["']/);
  });
});
