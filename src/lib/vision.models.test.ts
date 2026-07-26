import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "fs";
import {
  OPENROUTER_GEMINI_20_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";

/** Lightweight check that vision.ts wires Gemini 2.0 → Qwen3-VL fallback (no API call). */
describe("asset vision model wiring", () => {
  it("uses Gemini 2.0 primary and Qwen3-VL fallback constants", () => {
    assert.equal(OPENROUTER_GEMINI_20_FLASH_MODEL, "google/gemini-2.0-flash-001");
    assert.equal(OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL, "qwen/qwen3-vl-8b-instruct");

    const src = fs.readFileSync(new URL("./vision.ts", import.meta.url), "utf8");
    assert.match(src, /OPENROUTER_GEMINI_20_FLASH_MODEL/);
    assert.match(src, /OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL/);
    assert.match(src, /첨부된 이미지를 직접 보고/);
    assert.match(src, /상상하거나 만들어 내지 않는다/);
    assert.match(src, /미분류/);
    assert.doesNotMatch(src, /demoTag|EMOTION_TAGS\[/);
  });

  it("moderation fallback is Qwen3-VL-8B", () => {
    const src = fs.readFileSync(new URL("./assetModeration.ts", import.meta.url), "utf8");
    assert.match(src, /OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL/);
    assert.doesNotMatch(src, /OPENROUTER_GEMINI_31_FLASH_MODEL/);
  });
});
