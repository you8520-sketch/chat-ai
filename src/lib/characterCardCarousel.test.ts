import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextCarouselIndex, shouldRunCarousel } from "@/lib/characterCardCarousel";

describe("characterCardCarousel", () => {
  it("stays static for a single image and cycles 1s-length lists", () => {
    assert.equal(nextCarouselIndex(0, 1), 0);
    assert.equal(nextCarouselIndex(0, 3), 1);
    assert.equal(nextCarouselIndex(2, 3), 0);
  });

  it("pauses on hover, focus, offscreen, hidden tab, and reduced motion", () => {
    const running = {
      urlCount: 3,
      reducedMotion: false,
      hovering: false,
      focused: false,
      visible: true,
      documentVisible: true,
    };
    assert.equal(shouldRunCarousel(running), true);
    assert.equal(shouldRunCarousel({ ...running, urlCount: 1 }), false);
    assert.equal(shouldRunCarousel({ ...running, reducedMotion: true }), false);
    assert.equal(shouldRunCarousel({ ...running, hovering: true }), false);
    assert.equal(shouldRunCarousel({ ...running, focused: true }), false);
    assert.equal(shouldRunCarousel({ ...running, visible: false }), false);
    assert.equal(shouldRunCarousel({ ...running, documentVisible: false }), false);
  });
});
