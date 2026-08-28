import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "fs";
import {
  OPENROUTER_QWEN38_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";
import { buildAssetVisionPrompt } from "@/lib/assetVisionPolicy";
import { ASSET_PERSON_TAGS } from "@/lib/assetPersonTags";

/** Lightweight check that vision.ts wires Qwen3.8 → Qwen3-VL fallback (no API call). */
describe("asset vision model wiring", () => {
  it("uses Qwen3.8 Flash primary and Qwen3-VL fallback constants", () => {
    assert.equal(OPENROUTER_QWEN38_FLASH_MODEL, "qwen/qwen3.8-flash");
    assert.equal(OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL, "qwen/qwen3-vl-8b-instruct");

    const src = fs.readFileSync(new URL("./vision.ts", import.meta.url), "utf8");
    assert.match(src, /OPENROUTER_QWEN38_FLASH_MODEL/);
    assert.match(src, /OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL/);
    assert.match(src, /buildAssetVisionPrompt/);
    assert.match(src, /json_schema/);
    assert.match(src, /미분류/);
    assert.match(src, /normalizeVisionModerationFlags/);
    assert.doesNotMatch(src, /demoTag|EMOTION_TAGS\[|OPENROUTER_GEMINI_20_FLASH_MODEL/);
    assert.doesNotMatch(src, /"tag"\s*:\s*"[^"]+"\s*}/);
  });

  it("single asset vision policy — three tiers and canonical person taxonomy", () => {
    const prompt = buildAssetVisionPrompt();
    assert.match(prompt, /여성 유두/);
    assert.match(prompt, /관리자 검수/);
    assert.match(prompt, /PERSON_TAGS:/);
    assert.match(prompt, /imageType="person"/);
    assert.equal(ASSET_PERSON_TAGS.includes("미소"), true);
    assert.equal(fs.existsSync(new URL("./assetModeration.ts", import.meta.url)), false);
  });
});
