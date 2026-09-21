import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNotificationPanelPosition,
  panelFitsHorizontally,
} from "./notificationPanelPosition";

describe("notification panel positioning", () => {
  const anchor = { right: 308, bottom: 56 };

  for (const viewportWidth of [320, 360, 375, 1440]) {
    it(`keeps panel inside ${viewportWidth}px viewport`, () => {
      const position = computeNotificationPanelPosition({
        anchor: { right: Math.min(anchor.right, viewportWidth - 12), bottom: anchor.bottom },
        viewportWidth,
        viewportHeight: 800,
      });
      assert.equal(panelFitsHorizontally(position, viewportWidth), true);
      assert.ok(position.left >= 12);
      assert.ok(position.left + position.width <= viewportWidth - 12);
    });
  }

  it("does not force width wider than the available viewport on 320px screens", () => {
    const position = computeNotificationPanelPosition({
      anchor: { right: 320, bottom: 56 },
      viewportWidth: 320,
      viewportHeight: 640,
    });
    assert.equal(position.width, 296);
    assert.equal(position.left, 12);
    assert.equal(position.left + position.width, 308);
  });
});
