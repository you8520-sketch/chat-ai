import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OpenAiImageError,
  calculateGptImage2CostUsd,
  callOpenAiImageEdit,
} from "./openAiImageEdit";

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

  it("sends reference images to OpenAI direct edit endpoint as multipart data", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.openai.com/v1/images/edits");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-key");
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
      const result = await callOpenAiImageEdit({
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
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("requires OPENAI_API_KEY and does not fall back to CheaperInference", async () => {
    const originalFetch = globalThis.fetch;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalCiKey = process.env.CHEAPER_INFERENCE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "ci-only-key";
    globalThis.fetch = async () => {
      throw new Error("provider must not be called");
    };
    try {
      await assert.rejects(
        () =>
          callOpenAiImageEdit({
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
          /OpenAI API 키/.test(error.message)
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalOpenAiKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
      if (originalCiKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = originalCiKey;
    }
  });

  it("rejects zero references without calling the provider", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    let called = false;
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = async () => {
      called = true;
      throw new Error("provider must not be called");
    };
    try {
      await assert.rejects(
        () =>
          callOpenAiImageEdit({
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
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });
});
