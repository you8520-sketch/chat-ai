import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withAssetSize } from "@/lib/characterAssets";
import {
  applyScenarioAssetTagsToTurnText,
  buildScenarioAssetTagPrompt,
  normalizeScenarioAssets,
  playableScenarioAssets,
} from "./scenarioAssets";

describe("TRPG scenario assets", () => {
  it("accepts any cover and extra orientation (landscape/portrait/square)", () => {
    const cover = withAssetSize({ url: "/cover.webp", tag: "표지" }, 800, 1200);
    const wide = withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900);
    const tall = withAssetSize({ url: "/tall.webp", tag: "초상" }, 800, 1200);
    const square = withAssetSize({ url: "/sq.webp", tag: "광장" }, 1000, 1000);
    assert.doesNotThrow(() => normalizeScenarioAssets([cover, wide, tall, square]));
  });

  it("playable pool includes every valid orientation", () => {
    const assets = normalizeScenarioAssets([
      withAssetSize({ url: "/cover.webp", tag: "표지" }, 800, 1200),
      withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900),
      withAssetSize({ url: "/tall.webp", tag: "초상" }, 800, 1200),
      withAssetSize({ url: "/sq.webp", tag: "광장" }, 1000, 1000),
    ]);
    assert.deepEqual(
      playableScenarioAssets(assets).map((a) => a.tag),
      ["표지", "대합실", "초상", "광장"]
    );
  });

  it("prompts the GM with all scene tags (no landscape restriction wording)", () => {
    const prompt = buildScenarioAssetTagPrompt([
      withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900),
      withAssetSize({ url: "/tall.webp", tag: "초상" }, 800, 1200),
    ]);
    assert.match(prompt, /대합실/);
    assert.match(prompt, /초상/);
    assert.match(prompt, /at most once this turn/);
    assert.doesNotMatch(prompt, /landscape/i);
  });

  it("attaches a matching tag when a character reacts and skips it later in the turn", () => {
    const assets = [withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900)];
    const used = new Set<string>();
    const first = applyScenarioAssetTagsToTurnText("대합실 안이 차갑다.", assets, used);
    assert.match(first, /\[태그: 대합실\]/);
    const second = applyScenarioAssetTagsToTurnText("대합실을 다시 본다.", assets, used);
    assert.equal(second.includes("[태그: 대합실]"), false);
  });
});