import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getDefaultChatAsset,
  isPortraitDisplayAsset,
  isWideInlineAsset,
  parseAssets,
  reorderCharacterAssets,
  toggleCharacterAssetViewerBlur,
  updateCharacterAssetTag,
  withAssetSize,
} from "@/lib/characterAssets";

describe("asset orientation", () => {
  it("treats width > height as landscape inline", () => {
    assert.equal(isWideInlineAsset({ width: 1600, height: 900 }), true);
    assert.equal(isPortraitDisplayAsset({ width: 1600, height: 900 }), false);
  });

  it("treats tall and square as portrait display", () => {
    assert.equal(isWideInlineAsset({ width: 800, height: 1200 }), false);
    assert.equal(isWideInlineAsset({ width: 800, height: 800 }), false);
    assert.equal(isPortraitDisplayAsset({ orientation: "portrait" }), true);
  });

  it("treats unknown size as portrait so existing assets keep the left rail", () => {
    assert.equal(isWideInlineAsset({}), false);
    assert.equal(isPortraitDisplayAsset({}), true);
  });

  it("persists measured size through parseAssets", () => {
    const assets = parseAssets(
      JSON.stringify([{ url: "/uploads/wide.webp", tag: "거리", width: 1920, height: 1080 }])
    );
    assert.equal(assets[0]?.orientation, "landscape");
    assert.equal(isWideInlineAsset(assets[0]!), true);
  });

  it("picks a portrait default and skips landscape covers", () => {
    const assets = [
      withAssetSize({ url: "/wide.webp", tag: "거리" }, 1600, 900),
      withAssetSize({ url: "/tall.webp", tag: "미소" }, 800, 1200),
    ];
    const def = getDefaultChatAsset(assets);
    assert.equal(def?.url, "/tall.webp");
  });
});

describe("asset management metadata preservation", () => {
  it("preserves visualSubjectKey through tag, reorder, blur, and JSON roundtrip", () => {
    const subjectKey = "simvis_123e4567-e89b-42d3-a456-426614174000";
    let assets = [
      { url: "/a.webp", tag: "기본", visualSubjectKey: subjectKey, viewerBlur: false },
      { url: "/b.webp", tag: "미소", visualSubjectKey: subjectKey, viewerBlur: true },
    ];
    assets = updateCharacterAssetTag(assets, 1, "전투");
    assets = toggleCharacterAssetViewerBlur(assets, 1);
    assets = reorderCharacterAssets(assets, 1, 0);
    assert.equal(assets[0]?.visualSubjectKey, subjectKey);
    assert.equal(assets[0]?.tag, "전투");
    assert.equal(assets[0]?.viewerBlur, false);

    const reloaded = parseAssets(JSON.stringify(assets));
    assert.equal(reloaded.every((asset) => asset.visualSubjectKey === subjectKey), true);
  });
});
