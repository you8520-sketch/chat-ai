import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildEmotionTagPrompt,
  resolveEmotionTag,
  sanitizeEmotionTagInText,
} from "@/lib/emotionTag";
import { findAssetByTag } from "@/lib/characterAssets";

describe("resolveEmotionTag", () => {
  const allowed = ["진지함", "부끄러움", "무표정"];

  it("accepts exact allowed tag only", () => {
    assert.equal(resolveEmotionTag("부끄러움", allowed), "부끄러움");
  });

  it("rejects tags not in uploaded asset list (no partial match)", () => {
    assert.equal(resolveEmotionTag("슬픔", allowed), null);
    assert.equal(resolveEmotionTag("진지", allowed), null);
    assert.equal(resolveEmotionTag("표정", allowed), null);
  });
});

describe("sanitizeEmotionTagInText", () => {
  it("strips invented tag and keeps prose", () => {
    const out = sanitizeEmotionTagInText("본문입니다.\n[태그: 슬픔]", ["부끄러움", "무표정"]);
    assert.equal(out, "본문입니다.");
  });

  it("keeps allowed exact tag", () => {
    const out = sanitizeEmotionTagInText("본문.\n[태그: 부끄러움]", ["부끄러움", "무표정"]);
    assert.equal(out, "본문.\n[태그: 부끄러움]");
  });
});

describe("buildEmotionTagPrompt", () => {
  it("lists unique tags and requires scene-matched choice", () => {
    const block = buildEmotionTagPrompt(["진지함", "부끄러움", "침대에 누움", "진지함"]);
    assert.match(block, /진지함, 부끄러움, 침대에 누움/);
    assert.match(block, /final moment of this turn/);
    assert.match(block, /FORBIDDEN: any tag not in the list/);
    assert.match(block, /\[태그: tagname\]/);
  });
});

describe("findAssetByTag", () => {
  it("picks among duplicate tag names (not always first)", () => {
    const assets = [
      { url: "/a.png", tag: "진지함", chat: true },
      { url: "/b.png", tag: "진지함", chat: true },
      { url: "/c.png", tag: "무표정", chat: true },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const hit = findAssetByTag(assets, "진지함");
      assert.ok(hit);
      seen.add(hit.url);
    }
    assert.equal(seen.size, 2);
    assert.ok(seen.has("/a.png"));
    assert.ok(seen.has("/b.png"));
  });

  it("returns null when tag not in pool", () => {
    const assets = [{ url: "/a.png", tag: "부끄러움", chat: true }];
    assert.equal(findAssetByTag(assets, "슬픔"), null);
  });
});
