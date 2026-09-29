import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeVirtualReadingViewportY,
  resolveChatReadingProgressDocumentY,
} from "./chatLiveFollowReadingProgress";

describe("computeVirtualReadingViewportY", () => {
  it("maps horizontal progress to fractional vertical position within a line", () => {
    const start = computeVirtualReadingViewportY({
      lineTop: 400,
      lineHeight: 26,
      endX: 100,
      contentLeft: 100,
      usableLineWidth: 500,
    });
    const mid = computeVirtualReadingViewportY({
      lineTop: 400,
      lineHeight: 26,
      endX: 350,
      contentLeft: 100,
      usableLineWidth: 500,
    });
    const end = computeVirtualReadingViewportY({
      lineTop: 400,
      lineHeight: 26,
      endX: 600,
      contentLeft: 100,
      usableLineWidth: 500,
    });

    assert.equal(start.linePhase, 0);
    assert.equal(start.viewportY, 400);
    assert.ok(mid.linePhase > 0.45 && mid.linePhase < 0.55);
    assert.equal(end.linePhase, 1);
    assert.equal(end.viewportY, 426);
    assert.ok(mid.viewportY > start.viewportY && mid.viewportY < end.viewportY);
  });

  it("stays continuous across a wrap when line top advances by one line height", () => {
    const beforeWrap = computeVirtualReadingViewportY({
      lineTop: 400,
      lineHeight: 26,
      endX: 600,
      contentLeft: 100,
      usableLineWidth: 500,
    });
    const afterWrap = computeVirtualReadingViewportY({
      lineTop: 426,
      lineHeight: 26,
      endX: 100,
      contentLeft: 100,
      usableLineWidth: 500,
    });
    assert.equal(beforeWrap.viewportY, 426);
    assert.equal(afterWrap.viewportY, 426);
    assert.equal(afterWrap.linePhase, 0);
  });
});

describe("resolveChatReadingProgressDocumentY", () => {
  it("returns null without DOM", () => {
    assert.equal(
      resolveChatReadingProgressDocumentY({
        scrollY: 0,
        quoteRoot: null,
        fallbackSentinel: null,
      }),
      null
    );
  });
});
