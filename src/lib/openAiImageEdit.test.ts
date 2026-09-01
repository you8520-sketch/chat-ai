import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHEAPER_INFERENCE_IMAGE_EDITS_URL } from "@/lib/cheaperInferenceConfig";
import {
  OpenAiImageError,
  calculateGptImage2CostUsd,
  callImageEdit,
  resolveImageEditTransportConfig,
} from "./openAiImageEdit";

describe("imageEditTransport", () => {
  it("resolves CheaperInference as canonical image edit transport", () => {
    const config = resolveImageEditTransportConfig();
    assert.equal(config.provider, "cheaperinference");
    assert.equal(config.baseUrl, "https://api.cheaperinference.com/v1");
    assert.equal(config.endpointUrl, CHEAPER_INFERENCE_IMAGE_EDITS_URL);
    assert.equal(config.apiKeyOwner, "CHEAPER_INFERENCE_API_KEY");
  });

  it("requires CheaperInference API key and does not use OPENAI_API_KEY", async () => {
    const originalFetch = globalThis.fetch;
    const originalCiKey = process.env.CHEAPER_INFERENCE_API_KEY;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.OPENAI_API_KEY = "openai-only-key";
    globalThis.fetch = async () => {
      throw new Error("provider must not be called");
    };
    try {
      await assert.rejects(
        () =>
          callImageEdit({
            model: "gpt-image-2",
            prompt: "test",
            references: [`data:image/webp;base64,${Buffer.from("x").toString("base64")}`],
            size: "1024x1024",
            quality: "medium",
            outputCompression: 84,
          }),
        (error: unknown) =>
          error instanceof OpenAiImageError &&
          error.status === 503 &&
          /CheaperInference API 키/.test(error.message)
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCiKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = originalCiKey;
      if (originalOpenAiKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });
});

describe("openAiImageEdit", () => {
  it("calculates direct GPT Image 2 cost from image, text, and output usage", () => {
    const cost = calculateGptImage2CostUsd({
      input_tokens_details: { image_tokens: 1_000, text_tokens: 200 },
      output_tokens: 4_547,
    });
    assert.ok(cost != null);
    assert.ok(Math.abs(cost - 0.14541) < 1e-12);
  });

  it("returns null when usage is unavailable", () => {
    assert.equal(calculateGptImage2CostUsd(undefined), null);
  });

  it("sends reference images to CheaperInference image edits endpoint as multipart data", async () => {
    const originalFetch = globalThis.fetch;
    const originalCiKey = process.env.CHEAPER_INFERENCE_API_KEY;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci-key";
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), CHEAPER_INFERENCE_IMAGE_EDITS_URL);
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-ci-key");
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), "gpt-image-2");
      assert.equal(init.body.get("size"), "1200x800");
      assert.equal(init.body.get("quality"), "high");
      const images = init.body.getAll("image[]");
      assert.equal(images.length, 3);
      assert.equal((images[0] as File).name, "reference-1.webp");
      assert.equal((images[1] as File).name, "reference-2.webp");
      assert.equal((images[2] as File).name, "reference-3.webp");
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("generated").toString("base64") }],
          usage: {
            input_tokens_details: { image_tokens: 100, text_tokens: 20 },
            output_tokens: 200,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    try {
      const result = await callImageEdit({
        model: "gpt-image-2",
        prompt: "test",
        references: [
          `data:image/webp;base64,${Buffer.from("template").toString("base64")}`,
          `data:image/webp;base64,${Buffer.from("character").toString("base64")}`,
          `data:image/webp;base64,${Buffer.from("persona").toString("base64")}`,
        ],
        size: "1200x800",
        quality: "high",
        outputCompression: 88,
      });
      assert.equal(result.buffer.toString(), "generated");
      assert.ok(result.costUsd != null && result.costUsd > 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCiKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = originalCiKey;
      if (originalOpenAiKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it("rejects zero references without calling the provider", async () => {
    const originalFetch = globalThis.fetch;
    const originalCiKey = process.env.CHEAPER_INFERENCE_API_KEY;
    let called = false;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci-key";
    globalThis.fetch = async () => {
      called = true;
      throw new Error("provider must not be called");
    };
    try {
      await assert.rejects(
        () =>
          callImageEdit({
            model: "gpt-image-2",
            prompt: "test",
            references: [],
            size: "1024x1024",
            quality: "high",
            outputCompression: 88,
          }),
        (error: unknown) =>
          error instanceof OpenAiImageError &&
          error.status === 400 &&
          /참조 이미지가 없어/.test(error.message)
      );
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCiKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = originalCiKey;
    }
  });
});
