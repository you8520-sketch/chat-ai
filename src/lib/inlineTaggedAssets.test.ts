import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withAssetSize, type CharacterAsset } from "@/lib/characterAssets";
import {
  attachMatchingAssetTags,
  consumeAssetTagsOnce,
  displayBodyEmotionTags,
  lastPortraitEmotionAsset,
  prepareBodyEmotionTags,
  splitProseForInlineAssets,
} from "@/lib/inlineTaggedAssets";

const wide = withAssetSize({ url: "/wide.webp", tag: "폐역", chat: true }, 1600, 900);
const tall = withAssetSize({ url: "/tall.webp", tag: "미소", chat: true }, 800, 1200);
const assets: CharacterAsset[] = [wide, tall];

describe("inline tagged assets", () => {
  it("keeps landscape tags in the body and drops portrait tags", () => {
    const body = prepareBodyEmotionTags("문이 열린다.\n[태그: 폐역]\n그녀가 웃는다.\n[태그: 미소]", assets);
    assert.match(body, /\[태그: 폐역\]/);
    assert.equal(body.includes("[태그: 미소]"), false);
  });

  it("splits landscape tags into inline images during streaming", () => {
    const parts = splitProseForInlineAssets("앞.\n[태그: 폐역]\n뒤", assets, { streaming: true });
    assert.equal(parts.some((p) => p.kind === "image" && p.asset.url === "/wide.webp"), true);
    assert.equal(parts.some((p) => p.kind === "text" && p.text.includes("앞")), true);
  });

  it("does not paint a trailing incomplete landscape tag while streaming", () => {
    const parts = splitProseForInlineAssets("앞.\n[태그: 폐", assets, { streaming: true });
    assert.equal(parts.some((p) => p.kind === "image"), false);
    assert.equal(parts.map((p) => (p.kind === "text" ? p.text : "")).join(""), "앞.");
  });

  it("uses the last portrait tag for the left rail", () => {
    const asset = lastPortraitEmotionAsset("본문\n[태그: 폐역]\n[태그: 미소]", assets);
    assert.equal(asset?.url, "/tall.webp");
  });

  it("keeps each scenario asset once per turn", () => {
    const used = new Set<string>();
    const first = consumeAssetTagsOnce("복도.\n[태그: 폐역]\n[태그: 폐역]", [wide], used);
    assert.equal((first.text.match(/\[태그: 폐역\]/g) ?? []).length, 1);
    const second = consumeAssetTagsOnce("다시.\n[태그: 폐역]", [wide], used);
    assert.equal(second.text.includes("[태그: 폐역]"), false);
  });

  it("hides landscape tags when the chat asset toggle is off", () => {
    const source = "문이 열린다.\n[태그: 폐역]";
    assert.match(displayBodyEmotionTags(source, assets, { assetsEnabled: true }), /\[태그: 폐역\]/);
    assert.equal(
      displayBodyEmotionTags(source, assets, { assetsEnabled: false }).includes("[태그:"),
      false
    );
  });

  it("inserts a matching unused landscape tag when a character reacts", () => {
    const used = new Set<string>();
    const out = attachMatchingAssetTags("폐역 대합실에서 숨을 고른다.", [wide], used);
    assert.match(out.text, /\[태그: 폐역\]/);
    assert.equal(used.has("폐역"), true);
  });
});
