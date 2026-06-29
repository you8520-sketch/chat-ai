import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHARACTER_DESCRIPTION_COLLAPSE_MIN_HEIGHT_PX,
  CHARACTER_DESCRIPTION_PREVIEW_RATIO,
  descriptionNeedsExpand,
  resolveDescriptionCollapsedMaxHeight,
} from "@/lib/descriptionPreview";

describe("descriptionPreview", () => {
  it("uses quarter height ratio by default", () => {
    assert.equal(CHARACTER_DESCRIPTION_PREVIEW_RATIO, 0.25);
    assert.equal(resolveDescriptionCollapsedMaxHeight(400), 100);
    assert.equal(resolveDescriptionCollapsedMaxHeight(401, 0.25), 100.25);
  });

  it("needs expand when full height exceeds minimum", () => {
    assert.equal(descriptionNeedsExpand(CHARACTER_DESCRIPTION_COLLAPSE_MIN_HEIGHT_PX), false);
    assert.equal(descriptionNeedsExpand(CHARACTER_DESCRIPTION_COLLAPSE_MIN_HEIGHT_PX + 1), true);
  });
});
