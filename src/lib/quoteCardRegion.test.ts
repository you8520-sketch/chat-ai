import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAspectCaptureRect, computeFreeCaptureRect } from "@/lib/quoteCardRegion";
import { quoteCardDimensions } from "@/lib/quoteCardImage";

describe("computeFreeCaptureRect", () => {
  it("uses free rectangle and suggests orientation from drag shape", () => {
    const portrait = computeFreeCaptureRect(10, 10, 60, 200);
    assert.ok(portrait);
    assert.equal(portrait.orientation, "portrait");
    assert.equal(portrait.width, 50);
    assert.equal(portrait.height, 190);

    const landscape = computeFreeCaptureRect(0, 0, 300, 50);
    assert.ok(landscape);
    assert.equal(landscape.orientation, "landscape");
  });
});

describe("computeAspectCaptureRect", () => {
  it("locks portrait 2:3 when dragging vertically", () => {
    const rect = computeAspectCaptureRect(100, 100, 100, 400);
    assert.ok(rect);
    assert.equal(rect.orientation, "portrait");
    assert.equal(rect.width / rect.height, 2 / 3);
  });

  it("locks landscape 3:2 when dragging horizontally", () => {
    const rect = computeAspectCaptureRect(50, 50, 350, 80);
    assert.ok(rect);
    assert.equal(rect.orientation, "landscape");
    assert.equal(rect.width / rect.height, 3 / 2);
  });
});

describe("quoteCardDimensions", () => {
  it("exports fixed 2:3 and 3:2 cards", () => {
    const portrait = quoteCardDimensions("portrait");
    const landscape = quoteCardDimensions("landscape");
    assert.equal(portrait.width / portrait.height, 2 / 3);
    assert.equal(landscape.width / landscape.height, 3 / 2);
  });
});
