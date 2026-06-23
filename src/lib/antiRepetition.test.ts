import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectStreamingLoop, isHtmlVisualCardGenerationActive } from "@/lib/antiRepetition";

describe("isHtmlVisualCardGenerationActive", () => {
  it("detects open html fence", () => {
    assert.equal(isHtmlVisualCardGenerationActive('prose\n```html<div style="x">'), true);
  });

  it("returns false after html fence closes", () => {
    assert.equal(
      isHtmlVisualCardGenerationActive('```html<div></div>\n```\n'),
      false
    );
  });
});

describe("detectStreamingLoop", () => {
  it("skips loop detection while html visual card is generating", () => {
    const repetitive =
      "가".repeat(2000) +
      '\n```html<div style="background-color:#f8f9fa">box</div><div style="background-color:#f8f9fa">box2</div>';
    assert.equal(isHtmlVisualCardGenerationActive(repetitive), true);
    assert.equal(detectStreamingLoop(repetitive), false);
  });
});
