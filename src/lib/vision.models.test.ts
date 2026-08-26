import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "fs";
import {
  OPENROUTER_GEMINI_20_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";
import { buildAssetVisionPrompt } from "@/lib/assetVisionPolicy";

/** Lightweight check that vision.ts wires Gemini 2.0 → Qwen3-VL fallback (no API call). */
describe("asset vision model wiring", () => {
  it("uses Gemini 2.0 primary and Qwen3-VL fallback constants", () => {
    assert.equal(OPENROUTER_GEMINI_20_FLASH_MODEL, "google/gemini-2.0-flash-001");
    assert.equal(OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL, "qwen/qwen3-vl-8b-instruct");

    const src = fs.readFileSync(new URL("./vision.ts", import.meta.url), "utf8");
    assert.match(src, /OPENROUTER_GEMINI_20_FLASH_MODEL/);
    assert.match(src, /OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL/);
    assert.match(src, /buildAssetVisionPrompt/);
    assert.match(src, /미분류/);
    assert.match(src, /normalizeVisionModerationFlags/);
    assert.doesNotMatch(src, /demoTag|EMOTION_TAGS\[/);
  });

  it("single asset vision policy — reject genitals only", () => {
    const prompt = buildAssetVisionPrompt();
    assert.match(prompt, /성기·항문 노출/);
    assert.match(prompt, /등짝/);
    assert.match(prompt, /일반 캐릭터 업로드 필터 전용/);
    assert.doesNotMatch(prompt, /관리자/);

    assert.equal(fs.existsSync(new URL("./assetModeration.ts", import.meta.url)), false);
  });
});
