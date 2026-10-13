import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clipTrpgHeadTail } from "./clip";

describe("clipTrpgHeadTail", () => {
  it("returns short text unchanged apart from whitespace normalization", () => {
    assert.equal(clipTrpgHeadTail("  한 줄 \n 장면  ", 20), "한 줄 장면");
    assert.equal(clipTrpgHeadTail("", 20), "");
  });

  it("keeps both ends within the budget and drops only the middle", () => {
    const text = `HEAD_MARK${"가".repeat(500)}TAIL_MARK`;
    const clipped = clipTrpgHeadTail(text, 100);
    assert.equal(Array.from(clipped).length, 100);
    assert.ok(clipped.startsWith("HEAD_MARK"));
    assert.ok(clipped.endsWith("TAIL_MARK"));
    assert.ok(clipped.includes("…"));
  });

  it("counts code points, not UTF-16 units", () => {
    const clipped = clipTrpgHeadTail(`${"😀".repeat(200)}끝`, 50);
    assert.equal(Array.from(clipped).length, 50);
    assert.ok(clipped.endsWith("끝"));
  });

  it("returns nothing for a non-positive budget", () => {
    assert.equal(clipTrpgHeadTail("장면", 0), "");
    assert.equal(clipTrpgHeadTail("장면", -3), "");
  });

  it("composes: clipping an already clipped scene to a tighter budget matches clipping the original", () => {
    const original = `HEAD_${"나".repeat(3000)}_TAIL`;
    const once = clipTrpgHeadTail(original, 900);
    assert.equal(clipTrpgHeadTail(once, 700), clipTrpgHeadTail(original, 700));
  });
});
