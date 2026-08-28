import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "fs";
import {
  OPENROUTER_QWEN38_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";
import { buildAssetVisionPrompt } from "@/lib/assetVisionPolicy";
import { ASSET_PERSON_TAGS } from "@/lib/assetPersonTags";
import { buildAssetVisionRequestBody } from "@/lib/vision";
import { resolveAssetVisionModels } from "@/lib/assetVisionModels";

/** Lightweight check that vision.ts wires Qwen3.8 → Qwen3-VL fallback (no API call). */
describe("asset vision model wiring", () => {
  it("uses Qwen3.8 Flash primary and Qwen3-VL fallback constants", () => {
    assert.equal(OPENROUTER_QWEN38_FLASH_MODEL, "qwen/qwen3.8-flash");
    assert.equal(OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL, "qwen/qwen3-vl-8b-instruct");

    const src = fs.readFileSync(new URL("./vision.ts", import.meta.url), "utf8");
    assert.match(src, /resolveAssetVisionModels/);
    assert.match(src, /buildAssetVisionPrompt/);
    assert.match(src, /json_schema/);
    assert.match(src, /require_parameters/);
    assert.match(src, /미분류/);
    assert.match(src, /normalizeVisionModerationFlags/);
    assert.doesNotMatch(src, /demoTag|EMOTION_TAGS\[|OPENROUTER_GEMINI_20_FLASH_MODEL/);
    assert.doesNotMatch(src, /"tag"\s*:\s*"[^"]+"\s*}/);
    assert.doesNotMatch(src, /process\.env\.ASSET_VISION_MODEL/);
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

  it("buildAssetVisionRequestBody is exported and model-aware", () => {
    const dataUrl = "data:image/png;base64,abc";
    const primaryBody = buildAssetVisionRequestBody(OPENROUTER_QWEN38_FLASH_MODEL, dataUrl);
    assert.deepEqual(primaryBody.reasoning, { effort: "none" });
    assert.deepEqual(primaryBody.provider, { require_parameters: true });

    const fallbackBody = buildAssetVisionRequestBody(
      OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
      dataUrl
    );
    assert.equal("reasoning" in fallbackBody, false);
    assert.deepEqual(fallbackBody.provider, { require_parameters: true });
  });

  it("visionModels delegates to canonical resolver", () => {
    assert.deepEqual(resolveAssetVisionModels(), [
      OPENROUTER_QWEN38_FLASH_MODEL,
      OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
    ]);
  });
});
