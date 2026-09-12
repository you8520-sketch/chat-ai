import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INLINE_ASSET_TURN_LIMIT,
  inlineOrientationPolicy,
  resolveChatAssetPresentation,
} from "@/lib/chatAssetPresentation";

describe("effective chat asset presentation (stored mode × viewport)", () => {
  it("matches the canonical matrix", () => {
    assert.equal(resolveChatAssetPresentation("left", true), "left");
    assert.equal(resolveChatAssetPresentation("left", false), "background");
    assert.equal(resolveChatAssetPresentation("inline", true), "inline");
    assert.equal(resolveChatAssetPresentation("inline", false), "inline");
    assert.equal(resolveChatAssetPresentation("off", true), "off");
    assert.equal(resolveChatAssetPresentation("off", false), "off");
  });

  it("never lets the viewport turn the stored mode into another mode", () => {
    // stored left stays left on desktop; only the *effective* value changes on mobile.
    assert.equal(resolveChatAssetPresentation("left", true), "left");
    assert.notEqual(resolveChatAssetPresentation("left", false), "left");
  });

  it("selects the inline orientation policy per effective presentation", () => {
    assert.equal(inlineOrientationPolicy("left"), "landscape");
    // mobile `left` (background) keeps the pre-B1 landscape inline lane.
    assert.equal(inlineOrientationPolicy("background"), "landscape");
    assert.equal(inlineOrientationPolicy("inline"), "any");
    assert.equal(inlineOrientationPolicy("off"), "landscape");
  });

  it("caps inline assets per turn at 3", () => {
    assert.equal(INLINE_ASSET_TURN_LIMIT, 3);
  });
});
