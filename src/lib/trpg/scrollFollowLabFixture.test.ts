import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildScrollFollowLabSnapshot,
  scrollFollowLabPresentationSeed,
  scrollFollowLabSeenLogKeys,
  SCROLL_FOLLOW_LAB_BOT1_ID,
  SCROLL_FOLLOW_LAB_BOT2_ID,
  SCROLL_FOLLOW_LAB_HUMAN_ID,
} from "./scrollFollowLabFixture";

describe("scroll follow lab fixture", () => {
  it("seeds bot1 actor-action at presentationIndex 1", () => {
    const seed = scrollFollowLabPresentationSeed("bot1");
    assert.equal(seed.mode, "cinematic");
    assert.equal(seed.phase, "actor-action");
    assert.equal(seed.presentationIndex, 1);
  });

  it("seeds bot2 actor-action at presentationIndex 2 with bot1 consumed", () => {
    const seed = scrollFollowLabPresentationSeed("bot2");
    assert.equal(seed.presentationIndex, 2);
    const seen = scrollFollowLabSeenLogKeys(2, "bot2");
    assert.ok(seen.includes(`a:2:${SCROLL_FOLLOW_LAB_BOT1_ID}`));
    assert.ok(!seen.includes(`a:2:${SCROLL_FOLLOW_LAB_BOT2_ID}`));
  });

  it("snapshot has no GM draft — GM browser scroll is out of scope", () => {
    const snap = buildScrollFollowLabSnapshot();
    assert.equal(snap.gmNarrationDraft, null);
  });

  it("lab page is not a production surface", () => {
    const page = readFileSync("src/app/trpg/scroll-follow-lab/page.tsx", "utf8");
    assert.match(page, /process\.env\.NODE_ENV === "production"/);
    assert.match(page, /notFound\(\)/);
    assert.doesNotMatch(page, /canAccessTrpg/);
  });

  it("lab client does not persist stream interval prefs or GM test seam", () => {
    const client = readFileSync("src/app/trpg/scroll-follow-lab/TrpgScrollFollowLabClient.tsx", "utf8");
    assert.doesNotMatch(client, /saveTrpgStreamIntervalMs/);
    assert.doesNotMatch(client, /labForceGmReveal/);
    assert.match(client, /labStreamIntervalMs=\{40\}/);
    assert.match(client, /labFreezePresentationAdvance/);
    assert.match(client, /data-trpg-scroll-follow-lab-trailing-space/);
  });
});
