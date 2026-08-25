import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withAssetSize } from "@/lib/characterAssets";
import {
  TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR,
  applyScenarioAssetTagsToTurnText,
  assertScenarioAssetOrientations,
  buildScenarioAssetTagPrompt,
  normalizeScenarioAssets,
  playableScenarioAssets,
} from "./scenarioAssets";

describe("TRPG scenario assets", () => {
  it("allows any cover orientation and rejects tall extras", () => {
    const cover = withAssetSize({ url: "/cover.webp", tag: "표지" }, 800, 1200);
    const wide = withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900);
    assert.doesNotThrow(() => assertScenarioAssetOrientations([cover, wide]));
    assert.throws(
      () => assertScenarioAssetOrientations([cover, withAssetSize({ url: "/tall.webp", tag: "초상" }, 800, 1200)]),
      (err: unknown) => err instanceof Error && err.message === TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR
    );
  });

  it("playable pool is landscape only", () => {
    const assets = normalizeScenarioAssets([
      withAssetSize({ url: "/cover.webp", tag: "표지" }, 800, 1200),
      withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900),
    ]);
    assert.deepEqual(
      playableScenarioAssets(assets).map((a) => a.tag),
      ["대합실"]
    );
  });

  it("prompts the GM to insert each landscape tag at most once", () => {
    const prompt = buildScenarioAssetTagPrompt([
      withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900),
    ]);
    assert.match(prompt, /대합실/);
    assert.match(prompt, /at most once this turn/);
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
