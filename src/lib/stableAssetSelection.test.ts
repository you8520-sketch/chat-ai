import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findAssetByTagStable,
  findAssetsByTag,
  isWideInlineAsset,
  withAssetSize,
  type CharacterAsset,
} from "@/lib/characterAssets";
import {
  assetSelectionKeyForMessage,
  displayBodyEmotionTags,
  lastPortraitEmotionAsset,
  prepareBodyEmotionTags,
  splitProseForInlineAssets,
} from "@/lib/inlineTaggedAssets";

function portraitAsset(url: string, tag: string): CharacterAsset {
  return withAssetSize({ url, tag, chat: true }, 800, 1200);
}

function landscapeAsset(url: string, tag: string): CharacterAsset {
  return withAssetSize({ url, tag, chat: true }, 1600, 900);
}

describe("stable asset selection", () => {
  it("A. portrait stability — same selectionKey always picks same portrait", () => {
    const assets = [
      portraitAsset("/p1.webp", "부끄러움"),
      portraitAsset("/p2.webp", "부끄러움"),
      portraitAsset("/p3.webp", "부끄러움"),
    ];
    const key = "request:A";
    const text = "본문\n[태그: 부끄러움]";
    let first: string | undefined;
    for (let i = 0; i < 100; i++) {
      const picked = lastPortraitEmotionAsset(text, assets, key)?.url;
      assert.ok(picked);
      if (!first) first = picked;
      assert.equal(picked, first);
    }
  });

  it("B. inline stability — same selectionKey always picks same landscape URL", () => {
    const assets = [
      landscapeAsset("/w1.webp", "폐역"),
      landscapeAsset("/w2.webp", "폐역"),
      landscapeAsset("/w3.webp", "폐역"),
    ];
    const key = "request:inline";
    const text = "앞.\n[태그: 폐역]\n뒤";
    let first: string | undefined;
    for (let i = 0; i < 100; i++) {
      const parts = splitProseForInlineAssets(text, assets, { assetSelectionKey: key });
      const img = parts.find((p) => p.kind === "image");
      assert.ok(img && img.kind === "image");
      if (!first) first = img.asset.url;
      assert.equal(img.asset.url, first);
    }
  });

  it("C. message variation preserved — different selectionKeys can pick different assets", () => {
    const assets = [
      portraitAsset("/p1.webp", "무표정"),
      portraitAsset("/p2.webp", "무표정"),
      portraitAsset("/p3.webp", "무표정"),
    ];
    const text = "[태그: 무표정]";
    const picks = new Set(
      ["request:1", "request:2", "request:3", "request:4", "request:5", "request:6"].map(
        (key) => lastPortraitEmotionAsset(text, assets, key)?.url
      )
    );
    assert.ok(picks.size >= 2, `expected variation across keys, got ${[...picks].join(",")}`);
  });

  it("D. mixed orientation — portrait and inline pools stay separate", () => {
    const assets = [
      portraitAsset("/pa.webp", "감정"),
      portraitAsset("/pb.webp", "감정"),
      landscapeAsset("/lc.webp", "감정"),
      landscapeAsset("/ld.webp", "감정"),
    ];
    const key = "request:mixed";
    const portraitUrls = new Set<string>();
    const inlineUrls = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const portrait = lastPortraitEmotionAsset("[태그: 감정]", assets, key)?.url;
      assert.ok(portrait);
      portraitUrls.add(portrait);
      const parts = splitProseForInlineAssets("[태그: 감정]", assets, { assetSelectionKey: key });
      const inline = parts.find((p) => p.kind === "image");
      assert.ok(inline && inline.kind === "image");
      inlineUrls.add(inline.asset.url);
      assert.equal(isWideInlineAsset({ url: portrait, width: 800, height: 1200 }), false);
      assert.equal(isWideInlineAsset(inline.asset), true);
    }
    assert.equal(portraitUrls.size, 1);
    assert.equal(inlineUrls.size, 1);
    for (const url of portraitUrls) {
      assert.match(url, /^\/p[ab]\.webp$/);
    }
    for (const url of inlineUrls) {
      assert.match(url, /^\/l[c-d]\.webp$/);
    }
  });

  it("E. stream prefix growth — growing text keeps same portrait URL", () => {
    const assets = [
      portraitAsset("/p1.webp", "부끄러움"),
      portraitAsset("/p2.webp", "부끄러움"),
      portraitAsset("/p3.webp", "부끄러움"),
    ];
    const key = "request:stream-grow";
    const steps = [
      "[태그: 부끄러움]",
      "[태그: 부끄러움] 그가",
      "[태그: 부끄러움] 그가 웃었다.",
      "[태그: 부끄러움] 그가 웃었다.\n긴 후속 본문이 이어진다.",
    ];
    const first = lastPortraitEmotionAsset(steps[0]!, assets, key)?.url;
    assert.ok(first);
    for (const text of steps) {
      assert.equal(lastPortraitEmotionAsset(text, assets, key)?.url, first);
    }
  });

  it("F. stream → done — requestId key matches message id fallback for same turn", () => {
    const assets = [portraitAsset("/p1.webp", "웃음"), portraitAsset("/p2.webp", "웃음")];
    const requestId = "cr_stream_done";
    const streamKey = assetSelectionKeyForMessage({ requestId }, 0);
    const doneKey = assetSelectionKeyForMessage({ requestId, id: 42 }, 0);
    const text = "[태그: 웃음]";
    assert.equal(streamKey, doneKey);
    assert.equal(
      lastPortraitEmotionAsset(text, assets, streamKey)?.url,
      lastPortraitEmotionAsset(text, assets, doneKey)?.url
    );
  });

  it("G. two different tags — portrait switches when a new completed tag appears", () => {
    const assets = [
      portraitAsset("/neutral.webp", "무표정"),
      portraitAsset("/smile.webp", "웃음"),
    ];
    const key = "request:two-tags";
    const first = lastPortraitEmotionAsset("[태그: 무표정]", assets, key)?.url;
    assert.equal(first, "/neutral.webp");
    const second = lastPortraitEmotionAsset("[태그: 무표정]\n...\n[태그: 웃음]", assets, key)?.url;
    assert.equal(second, "/smile.webp");
  });

  it("H. single asset tag — regression for one asset per tag", () => {
    const assets = [landscapeAsset("/only.webp", "폐역"), portraitAsset("/solo.webp", "미소")];
    const key = "request:single";
    const inline = splitProseForInlineAssets("[태그: 폐역]", assets, { assetSelectionKey: key }).find(
      (p) => p.kind === "image"
    );
    assert.ok(inline && inline.kind === "image");
    assert.equal(inline.asset.url, "/only.webp");
    assert.equal(lastPortraitEmotionAsset("[태그: 미소]", assets, key)?.url, "/solo.webp");
  });

  it("I. asset OFF — tags hidden and no inline assets", () => {
    const assets = [landscapeAsset("/wide.webp", "폐역")];
    const source = "문\n[태그: 폐역]";
    assert.equal(displayBodyEmotionTags(source, assets, { assetsEnabled: false }).includes("[태그:"), false);
    assert.equal(
      splitProseForInlineAssets(source, assets, { assetSelectionKey: "request:off" }).some(
        (p) => p.kind === "image"
      ),
      true
    );
    assert.equal(
      splitProseForInlineAssets(source, [], { assetSelectionKey: "request:off" }).some(
        (p) => p.kind === "image"
      ),
      false
    );
  });

  it("prepareBodyEmotionTags keeps tag when any inline candidate exists (not random lottery)", () => {
    const assets = [
      portraitAsset("/p.webp", "감정"),
      landscapeAsset("/l1.webp", "감정"),
      landscapeAsset("/l2.webp", "감정"),
    ];
    let sawTag = true;
    for (let i = 0; i < 30; i++) {
      const body = prepareBodyEmotionTags("앞\n[태그: 감정]\n뒤", assets);
      sawTag = body.includes("[태그: 감정]");
      if (!sawTag) break;
    }
    assert.equal(sawTag, true);
    assert.equal(findAssetsByTag(assets, "감정").some(isWideInlineAsset), true);
  });

  it("assetSelectionKeyForMessage prefers requestId over message id", () => {
    assert.equal(
      assetSelectionKeyForMessage({ requestId: "cr_1", id: 9 }, 3),
      "request:cr_1"
    );
    assert.equal(assetSelectionKeyForMessage({ id: 9 }, 3), "message:9");
    assert.equal(assetSelectionKeyForMessage({}, 3), "row:3");
  });

  it("findAssetByTagStable is deterministic for direct calls", () => {
    const assets = [
      landscapeAsset("/a.webp", "scene"),
      landscapeAsset("/b.webp", "scene"),
      landscapeAsset("/c.webp", "scene"),
    ];
    const first = findAssetByTagStable(assets, "scene", "request:direct", "inline")?.url;
    assert.ok(first);
    for (let i = 0; i < 100; i++) {
      assert.equal(
        findAssetByTagStable(assets, "scene", "request:direct", "inline")?.url,
        first
      );
    }
  });
});
