import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withAssetSize, type CharacterAsset } from "@/lib/characterAssets";
import { INLINE_ASSET_TURN_LIMIT } from "@/lib/chatAssetPresentation";
import { splitChatRichBlocks } from "@/lib/chatRichContent";
import {
  attachMatchingAssetTags,
  consumeAssetTagsOnce,
  displayBodyEmotionTags,
  lastPortraitEmotionAsset,
  planInlineAssetBody,
  prepareBodyEmotionTags,
  splitProseForInlineAssets,
} from "@/lib/inlineTaggedAssets";

const wide = withAssetSize({ url: "/wide.webp", tag: "폐역", chat: true }, 1600, 900);
const tall = withAssetSize({ url: "/tall.webp", tag: "미소", chat: true }, 800, 1200);
const square = withAssetSize({ url: "/square.webp", tag: "정면", chat: true }, 1000, 1000);
const assets: CharacterAsset[] = [wide, tall, square];
const extraWide = [1, 2, 3, 4].map((n) =>
  withAssetSize({ url: `/w${n}.webp`, tag: `장면${n}`, chat: true }, 1600, 900)
);

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

  it("removes every marker (inline before a trailing tag) when assets are off", () => {
    const source = "문이 열린다.\n[태그: 폐역]\n그녀가 웃는다.\n[태그: 미소]";
    const body = displayBodyEmotionTags(source, assets, { assetsEnabled: false });
    assert.equal(body.includes("[태그:"), false);
    assert.match(body, /문이 열린다/);
    assert.match(body, /그녀가 웃는다/);
  });

  it("inserts a matching unused landscape tag when a character reacts", () => {
    const used = new Set<string>();
    const out = attachMatchingAssetTags("폐역 대합실에서 숨을 고른다.", [wide], used);
    assert.match(out.text, /\[태그: 폐역\]/);
    assert.equal(used.has("폐역"), true);
  });
});

describe("inline asset turn-level planning", () => {
  it("renders portrait, square and landscape inline under the 'any' policy", () => {
    const body = planInlineAssetBody("[태그: 폐역]\n[태그: 미소]\n[태그: 정면]", assets, {
      orientationPolicy: "any",
    });
    assert.match(body, /\[태그: 폐역\]/);
    assert.match(body, /\[태그: 미소\]/);
    assert.match(body, /\[태그: 정면\]/);
    const parts = splitProseForInlineAssets(body, assets, { orientationPolicy: "any" });
    const urls = parts.filter((p) => p.kind === "image").map((p) => (p.kind === "image" ? p.asset.url : ""));
    assert.deepEqual(urls, ["/wide.webp", "/tall.webp", "/square.webp"]);
  });

  it("keeps the landscape-only policy for the left-desktop inline lane", () => {
    const body = planInlineAssetBody("[태그: 폐역]\n[태그: 미소]\n[태그: 정면]", assets, {
      orientationPolicy: "landscape",
    });
    assert.match(body, /\[태그: 폐역\]/);
    assert.equal(body.includes("[태그: 미소]"), false);
    assert.equal(body.includes("[태그: 정면]"), false);
  });

  it("suppresses duplicate resolved assets while preserving chronological order", () => {
    const body = planInlineAssetBody(
      "[태그: 폐역]\n중간\n[태그: 폐역]\n[태그: 미소]",
      assets,
      { orientationPolicy: "any" }
    );
    assert.equal((body.match(/\[태그: 폐역\]/g) ?? []).length, 1);
    assert.match(body, /\[태그: 미소\]/);
    assert.ok(body.indexOf("[태그: 폐역]") < body.indexOf("[태그: 미소]"));
  });

  it("renders only the first 3 unique assets when 4+ markers resolve", () => {
    const text = extraWide.map((a) => `[태그: ${a.tag}]`).join("\n");
    const body = planInlineAssetBody(text, [...extraWide], { orientationPolicy: "any" });
    const tags = body.match(/\[태그: ([^\]]+)\]/g) ?? [];
    assert.equal(tags.length, INLINE_ASSET_TURN_LIMIT);
    assert.match(body, /장면1/);
    assert.equal(body.includes("장면4"), false);
  });

  it("does not synthesize an image for an unresolved marker", () => {
    const body = planInlineAssetBody("[태그: 없는태그]", assets, { orientationPolicy: "any" });
    assert.equal(body.includes("[태그:"), false);
    const parts = splitProseForInlineAssets(body, assets, { orientationPolicy: "any" });
    assert.equal(parts.some((p) => p.kind === "image"), false);
  });

  it("keeps the whole turn <= 3 even when prose is split across rich blocks", () => {
    // Simulate ChatRichBlocks splitting one assistant message into multiple novel blocks
    // separated by a markdown/HTML block: one whole-message plan feeds every block.
    const message =
      "도입.\n[태그: 장면1]\n\n```html\n<div>status</div>\n```\n\n" +
      "전개.\n[태그: 장면2]\n[태그: 장면3]\n\n표:\n[태그: 장면4]";
    const planned = planInlineAssetBody(message, extraWide, { orientationPolicy: "any" });
    assert.equal((planned.match(/\[태그: /g) ?? []).length, INLINE_ASSET_TURN_LIMIT);
    // Render the planned body as two independent blocks (fresh per-block `seen`).
    const midway = Math.floor(planned.length / 2);
    const blocks = [planned.slice(0, midway), planned.slice(midway)];
    let rendered = 0;
    const urls: string[] = [];
    for (const block of blocks) {
      const parts = splitProseForInlineAssets(block, extraWide, {
        orientationPolicy: "any",
        oncePerAsset: true,
      });
      for (const part of parts) {
        if (part.kind === "image") {
          rendered += 1;
          urls.push(part.asset.url);
        }
      }
    }
    assert.equal(rendered, INLINE_ASSET_TURN_LIMIT);
    assert.equal(new Set(urls).size, urls.length);
  });
});

describe("non-prose rich blocks do not consume the inline quota", () => {
  const make = (n: string) =>
    withAssetSize({ url: `/${n}.webp`, tag: `장면${n}`, chat: true }, 1600, 900);
  const A = make("A");
  const B = make("B");
  const C = make("C");
  const D = make("D");
  const X = make("X");
  const pool: CharacterAsset[] = [A, B, C, D, X];

  function renderNovelBlocks(displayed: string): string[] {
    const rendered: string[] = [];
    for (const block of splitChatRichBlocks(displayed)) {
      if (block.kind !== "novel") continue;
      const parts = splitProseForInlineAssets(block.text, pool, {
        orientationPolicy: "any",
        oncePerAsset: true,
      });
      for (const part of parts) {
        if (part.kind === "image") rendered.push(part.asset.tag);
      }
    }
    return rendered;
  }

  it("ignores a marker inside an HTML/status block and keeps that block intact", () => {
    const html = `<div style="max-width:450px">\n[태그: 장면X]\n</div>`;
    const message =
      `도입.\n[태그: 장면A]\n\n\`\`\`html\n${html}\n\`\`\`\n\n` +
      `후반.\n[태그: 장면B]\n[태그: 장면C]\n[태그: 장면D]`;

    const displayed = displayBodyEmotionTags(message, pool, {
      assetsEnabled: true,
      orientationPolicy: "any",
    });

    // Canonical partition still sees the real HTML block, byte-identical.
    const blocks = splitChatRichBlocks(displayed);
    assert.deepEqual(blocks.map((b) => b.kind), ["novel", "html", "novel"]);
    assert.equal(blocks[1]!.kind === "html" ? blocks[1]!.text : null, html);
    assert.match(blocks[1]!.text, /\[태그: 장면X\]/);

    // X (non-prose) does not consume quota; prose A/B/C chosen, D capped out.
    assert.deepEqual(renderNovelBlocks(displayed), ["장면A", "장면B", "장면C"]);
  });

  it("ignores a marker inside a markdown-table block for the quota", () => {
    const table = `| stat | val |\n|:---:|:---:|\n| 태그 | [태그: 장면X] |`;
    const message =
      `앞.\n[태그: 장면A]\n\n${table}\n\n` +
      `뒤.\n[태그: 장면B]\n[태그: 장면C]\n[태그: 장면D]`;

    const displayed = displayBodyEmotionTags(message, pool, {
      assetsEnabled: true,
      orientationPolicy: "any",
    });
    const blocks = splitChatRichBlocks(displayed);
    assert.ok(blocks.some((b) => b.kind === "markdown-table"));
    assert.deepEqual(renderNovelBlocks(displayed), ["장면A", "장면B", "장면C"]);
  });

  it("keeps the HTML marker untouched while dropping the capped prose marker", () => {
    const html = `<div>[태그: 장면X]</div>`;
    const raw = `[태그: 장면A]\n\`\`\`html\n${html}\n\`\`\`\n[태그: 장면B]\n[태그: 장면C]\n[태그: 장면D]`;
    const displayed = displayBodyEmotionTags(raw, pool, {
      assetsEnabled: true,
      orientationPolicy: "any",
    });
    assert.match(displayed, /\[태그: 장면A\]/);
    assert.match(displayed, /\[태그: 장면B\]/);
    assert.match(displayed, /\[태그: 장면C\]/);
    assert.equal(displayed.includes("[태그: 장면D]"), false);
    assert.match(displayed, /\[태그: 장면X\]/);
    assert.deepEqual(renderNovelBlocks(displayed), ["장면A", "장면B", "장면C"]);
  });
});
