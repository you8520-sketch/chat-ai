import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { distanceFromBottom, isNearBottom, TRPG_FOLLOW_LATEST_THRESHOLD_PX } from "./followLatest";

describe("TRPG follow-latest scroll", () => {
  it("treats distance <= 120px as near bottom", () => {
    assert.equal(TRPG_FOLLOW_LATEST_THRESHOLD_PX, 120);
    assert.equal(
      distanceFromBottom({ scrollHeight: 2000, scrollTop: 1880, clientHeight: 100 }),
      20
    );
    assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1880, clientHeight: 100 }), true);
    assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1700, clientHeight: 100 }), false);
    assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1780, clientHeight: 100 }), true);
  });

  it("does not use delayed force-scroll or ResizeObserver auto-scroll", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /isNearBottom/);
    assert.match(room, /followLatest/);
    assert.match(room, /최신으로/);
    assert.doesNotMatch(room, /100, 250, 500, 1000, 1500, 2500/);
    assert.doesNotMatch(room, /ResizeObserver/);
  });
});
