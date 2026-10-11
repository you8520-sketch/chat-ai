import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { CHAT_FONT_OPTIONS, CHAT_FONT_SIZE_PRESETS } from "@/lib/chatDisplayPrefs";
import { studioInputClass, studioType } from "@/lib/studioDesign";

const ROOT = process.cwd();
const FONT_CSS_URL = "/fonts/pretendard/pretendard-variable-dynamic-subset.css";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("brand typography", () => {
  it("root layout loads the self-hosted Pretendard stylesheet that exists in public/", () => {
    assert.ok(read("src/app/layout.tsx").includes(`href="${FONT_CSS_URL}"`));
    assert.ok(existsSync(path.join(ROOT, "public", FONT_CSS_URL)));
  });

  it("preloaded font subsets exist and are declared by the stylesheet", () => {
    const layout = read("src/app/layout.tsx");
    const list = layout.match(/PRETENDARD_PRELOAD_SUBSETS = \[([^\]]+)\]/);
    assert.ok(list);
    const css = read(`public${FONT_CSS_URL}`);
    const subsets = list[1].split(",").map((n) => n.trim());
    assert.ok(subsets.length > 0);
    for (const n of subsets) {
      assert.ok(existsSync(path.join(ROOT, "public/fonts/pretendard", `PretendardVariable.subset.${n}.woff2`)), n);
      assert.ok(css.includes(`PretendardVariable.subset.${n}.woff2`), n);
    }
  });

  it("every font file referenced by the Pretendard stylesheet is shipped", () => {
    const css = read(`public${FONT_CSS_URL}`);
    const urls = [...css.matchAll(/url\((\/fonts\/pretendard\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 50);
    assert.ok(css.includes("font-family: 'Pretendard Variable'"));
    for (const url of urls) {
      assert.ok(existsSync(path.join(ROOT, "public", url)), `missing ${url}`);
    }
  });

  it("body font stack leads with the loaded family and keeps Korean system fallbacks", () => {
    const css = read("src/app/globals.css");
    const body = css.match(/body\s*\{[\s\S]*?font-family:\s*([^;]+);/);
    assert.ok(body);
    const stack = body[1].replace(/\s+/g, " ").trim();
    assert.ok(stack.startsWith('"Pretendard Variable", Pretendard'));
    for (const family of ['"Apple SD Gothic Neo"', '"Noto Sans KR"', '"Malgun Gothic"']) {
      assert.ok(stack.includes(family), family);
    }
  });

  it("helper-scale text and placeholders stay readable", () => {
    for (const key of ["caption", "helper", "counter"] as const) {
      assert.doesNotMatch(studioType[key], /text-zinc-(500|600|700)\b/, key);
      assert.doesNotMatch(studioType[key], /text-\[(9|10|11)px\]/, key);
    }
    assert.match(studioInputClass, /placeholder:text-zinc-400/);
  });

  it("chat reading presets are not touched by the brand type scale", () => {
    assert.deepEqual(
      CHAT_FONT_SIZE_PRESETS.map((p) => [p.id, p.scale]),
      [
        ["small", 0.875],
        ["medium", 1],
        ["large", 1.125],
        ["xlarge", 1.25],
      ],
    );
    const sans = CHAT_FONT_OPTIONS.find((f) => f.id === "sans");
    assert.ok(sans?.css.startsWith("'Pretendard Variable', 'Pretendard'"));
    const mono = CHAT_FONT_OPTIONS.find((f) => f.id === "mono");
    assert.equal(mono?.css, "'Pretendard', ui-monospace, monospace");
  });
});
