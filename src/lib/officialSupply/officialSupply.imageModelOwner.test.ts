import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveChatImageGenerationModel } from "@/lib/chatImageGeneration";
import {
  OFFICIAL_ASSET_IMAGE_DEFAULT_MODEL,
  OFFICIAL_ASSET_IMAGE_MODEL_ENV,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";

describe("official asset image model owner", () => {
  it("defaults to gpt-image-2", () => {
    assert.equal(OFFICIAL_ASSET_IMAGE_DEFAULT_MODEL, "gpt-image-2");
    assert.equal(resolveOfficialAssetImageModel({} as NodeJS.ProcessEnv), "gpt-image-2");
    assert.equal(resolveOfficialAssetImageModel({ [OFFICIAL_ASSET_IMAGE_MODEL_ENV]: "  " } as unknown as NodeJS.ProcessEnv), "gpt-image-2");
  });

  it("ignores the chat-wide OPENAI_IMAGE_MODEL", () => {
    const env = { OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" } as unknown as NodeJS.ProcessEnv;
    assert.equal(resolveOfficialAssetImageModel(env), "gpt-image-2");
    assert.equal(resolveChatImageGenerationModel(env), "gpt-image-2.5-sunburst");
  });

  it("does not let the official override change the chat model", () => {
    const env = { [OFFICIAL_ASSET_IMAGE_MODEL_ENV]: "gpt-image-2.5-sunburst" } as unknown as NodeJS.ProcessEnv;
    assert.equal(resolveOfficialAssetImageModel(env), "gpt-image-2.5-sunburst");
    assert.equal(resolveChatImageGenerationModel(env), "gpt-image-2");
    assert.equal(resolveChatImageGenerationModel({} as NodeJS.ProcessEnv), "gpt-image-2");
  });

  it("changes only through the explicit official override", () => {
    const env = {
      OPENAI_IMAGE_MODEL: "gpt-image-2",
      [OFFICIAL_ASSET_IMAGE_MODEL_ENV]: " gpt-image-2.5-sunburst ",
    } as unknown as NodeJS.ProcessEnv;
    assert.equal(resolveOfficialAssetImageModel(env), "gpt-image-2.5-sunburst");
    assert.equal(resolveChatImageGenerationModel(env), "gpt-image-2");
  });
});
