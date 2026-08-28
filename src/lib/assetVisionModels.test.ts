import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";

import {
  DEFAULT_ASSET_VISION_FALLBACK,
  DEFAULT_ASSET_VISION_PRIMARY,
  resolveAssetVisionModels,
  resolveAssetVisionPrimaryModel,
} from "@/lib/assetVisionModels";
import {
  OPENROUTER_QWEN38_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";

describe("assetVisionModels canonical resolver", () => {
  const envKeys = [
    "ASSET_VISION_MODEL",
    "BACKGROUND_VISION_MODEL",
    "ASSET_VISION_MODEL_FALLBACK",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function clearEnv(): void {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }

  it("defaults to Qwen3.8 primary and Qwen3-VL fallback", () => {
    clearEnv();
    assert.equal(DEFAULT_ASSET_VISION_PRIMARY, OPENROUTER_QWEN38_FLASH_MODEL);
    assert.equal(DEFAULT_ASSET_VISION_FALLBACK, OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL);
    assert.equal(resolveAssetVisionPrimaryModel(), OPENROUTER_QWEN38_FLASH_MODEL);
    assert.deepEqual(resolveAssetVisionModels(), [
      OPENROUTER_QWEN38_FLASH_MODEL,
      OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
    ]);
  });

  it("ASSET_VISION_MODEL wins over BACKGROUND_VISION_MODEL", () => {
    clearEnv();
    process.env.ASSET_VISION_MODEL = "model/A";
    process.env.BACKGROUND_VISION_MODEL = "model/B";
    assert.equal(resolveAssetVisionPrimaryModel(), "model/A");
    assert.deepEqual(resolveAssetVisionModels(), ["model/A", OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL]);
  });

  it("uses legacy BACKGROUND_VISION_MODEL when ASSET_VISION_MODEL unset", () => {
    clearEnv();
    process.env.BACKGROUND_VISION_MODEL = "legacy/vision";
    assert.equal(resolveAssetVisionPrimaryModel(), "legacy/vision");
  });

  it("returns single model when primary equals fallback", () => {
    clearEnv();
    process.env.ASSET_VISION_MODEL = OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL;
    process.env.ASSET_VISION_MODEL_FALLBACK = OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL;
    assert.deepEqual(resolveAssetVisionModels(), [OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL]);
  });

  it("honors ASSET_VISION_MODEL_FALLBACK override", () => {
    clearEnv();
    process.env.ASSET_VISION_MODEL_FALLBACK = "custom/fallback";
    assert.deepEqual(resolveAssetVisionModels(), [
      OPENROUTER_QWEN38_FLASH_MODEL,
      "custom/fallback",
    ]);
  });
});

describe("assetVisionModels single owner with ai.ts export", () => {
  it("ai.ts derives BACKGROUND_VISION_OPENROUTER_MODEL from the same resolver", () => {
    const aiSrc = fs.readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    assert.match(aiSrc, /resolveAssetVisionPrimaryModel/);
    assert.match(aiSrc, /BACKGROUND_VISION_OPENROUTER_MODEL = resolveAssetVisionPrimaryModel\(\)/);
    assert.doesNotMatch(aiSrc, /BACKGROUND_VISION_MODEL\?\.trim\(\)\s*\|\|\s*\n\s*process\.env\.ASSET_VISION_MODEL/);
  });
});
