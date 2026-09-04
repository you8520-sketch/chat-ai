import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OpenAiImageError } from "./openAiImageEdit";
import {
  OpenAiImageGenerationError,
  callOpenAiImageEditWithSafetyFallback,
  formatOpenAiImageFinalUserError,
  serializeOpenAiImageProviderAttempts,
} from "./openAiImageSafetyFallback";
import {
  buildStrictComicFallbackPrompt,
  buildStrictLdDuoFallbackPrompt,
  STRICT_SAFE_DEPICTION,
} from "./chatImageStrictSafetyFallbackPrompt";

const REF = `data:image/webp;base64,${Buffer.from("ref").toString("base64")}`;

function safetyRejectResponse() {
  return new Response(
    JSON.stringify({
      error: {
        message: "Your request was rejected by the safety system.",
        type: "image_generation_user_error",
        code: "moderation_blocked",
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json", "x-request-id": "req-safety-1" } }
  );
}

function successResponse() {
  return new Response(
    JSON.stringify({
      data: [{ b64_json: Buffer.from("ok-image").toString("base64") }],
      usage: { input_tokens_details: { image_tokens: 10, text_tokens: 5 }, output_tokens: 20 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("openAiImageSafetyFallback orchestration", () => {
  it("A1 primary success — one provider call, no fallback", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return successResponse();
    };
    try {
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: "gpt-image-2",
        primaryPrompt: "primary scene",
        strictFallbackPrompt: "strict fallback scene",
        references: [REF],
        size: "800x1200",
        quality: "medium",
        outputCompression: 86,
        mode: "illustration",
      });
      assert.equal(calls, 1);
      assert.equal(result.safetyFallbackUsed, false);
      assert.equal(result.providerAttempts.length, 1);
      assert.equal(result.providerAttempts[0]?.outcome, "success");
      assert.equal(result.buffer.toString(), "ok-image");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("A2 safety reject then fallback success — two calls, first diagnostic preserved", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return calls === 1 ? safetyRejectResponse() : successResponse();
    };
    try {
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: "gpt-image-2",
        primaryPrompt: "risky primary",
        strictFallbackPrompt: "strict safe fallback",
        references: [REF],
        size: "800x1200",
        quality: "medium",
        outputCompression: 86,
      });
      assert.equal(calls, 2);
      assert.equal(result.safetyFallbackUsed, true);
      assert.equal(result.providerAttempts.length, 2);
      assert.equal(result.providerAttempts[0]?.outcome, "safety_rejected");
      assert.equal(result.providerAttempts[1]?.outcome, "success");
      assert.equal(result.hasUnknownAttemptCost, true);
      assert.equal(result.providerAttempts[0]?.diagnostic?.providerRequestId, "req-safety-1");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("A4 double safety reject — exactly two calls, both diagnostics preserved", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return safetyRejectResponse();
    };
    try {
      await assert.rejects(
        () =>
          callOpenAiImageEditWithSafetyFallback({
            model: "gpt-image-2",
            primaryPrompt: "risky primary",
            strictFallbackPrompt: "strict safe fallback",
            references: [REF],
            size: "800x1200",
            quality: "medium",
            outputCompression: 86,
          }),
        (error: unknown) => error instanceof OpenAiImageGenerationError
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("A6 429 primary — no safety retry", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
    };
    try {
      await assert.rejects(
        () =>
          callOpenAiImageEditWithSafetyFallback({
            model: "gpt-image-2",
            primaryPrompt: "primary",
            strictFallbackPrompt: "fallback",
            references: [REF],
            size: "800x1200",
            quality: "medium",
            outputCompression: 86,
          }),
        (error: unknown) => error instanceof OpenAiImageError
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("A8 invalid-request 400 non-safety — no retry", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { message: "Invalid image format", code: "invalid_image" } }),
        { status: 400 }
      );
    };
    try {
      await assert.rejects(
        () =>
          callOpenAiImageEditWithSafetyFallback({
            model: "gpt-image-2",
            primaryPrompt: "primary",
            strictFallbackPrompt: "fallback",
            references: [REF],
            size: "800x1200",
            quality: "medium",
            outputCompression: 86,
          }),
        (error: unknown) => error instanceof OpenAiImageError && !(error instanceof OpenAiImageGenerationError)
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("final user error has no safety-filter wording", () => {
    const msg = formatOpenAiImageFinalUserError(
      "Your request was rejected by the safety system."
    );
    assert.doesNotMatch(msg, /안전 필터/);
    assert.doesNotMatch(msg, /safety/i);
    assert.match(msg, /생성하지 못했습니다/);
  });

  it("serialize provider attempts round-trips", () => {
    const json = serializeOpenAiImageProviderAttempts([
      { attempt: 1, kind: "primary", outcome: "safety_rejected" },
      { attempt: 2, kind: "strict_safety_fallback", outcome: "success", costUsd: 0.01 },
    ]);
    assert.match(json, /safety_rejected/);
    assert.match(json, /strict_safety_fallback/);
  });
});

describe("strict safety fallback prompts", () => {
  it("S1 explicit adult source absent from strict LD fallback", () => {
    const explicit = "둘이 침대에서 격렬하게 관계를 가진다";
    const prompt = buildStrictLdDuoFallbackPrompt({
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: [
        {
          key: "character",
          name: "태현",
          gender: "male",
          role: "character",
          referenceImageUrl: "/c.webp",
          savedAppearance: "",
          appearanceMode: "image_only",
        },
        {
          key: "persona",
          name: "유저",
          gender: "female",
          role: "persona",
          referenceImageUrl: "/p.webp",
          savedAppearance: "",
          appearanceMode: "image_only",
        },
      ],
    });
    assert.doesNotMatch(prompt, new RegExp(explicit.slice(0, 6)));
    assert.match(prompt, /STRICT PROVIDER-SAFE FALLBACK/);
    assert.match(prompt, /non-sexual/i);
    assert.doesNotMatch(prompt, /non-explicit adult intimacy allowance/i);
  });

  it("S7 strict fallback uses base safe depiction only", () => {
    assert.match(STRICT_SAFE_DEPICTION, /non-explicit/i);
    assert.doesNotMatch(STRICT_SAFE_DEPICTION, /shirtless adult male torso allowance/i);
  });

  it("C1 2-cut comic strict fallback keeps panel count and no text", () => {
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: [
        {
          key: "character",
          name: "A",
          gender: "female",
          role: "character",
          referenceImageUrl: "/c.webp",
          savedAppearance: "",
          appearanceMode: "image_only",
        },
        {
          key: "persona",
          name: "B",
          gender: "male",
          role: "persona",
          referenceImageUrl: "/p.webp",
          savedAppearance: "",
          appearanceMode: "image_only",
        },
      ],
    });
    assert.match(prompt, /exactly 2/i);
    assert.match(prompt, /NO TEXT CONTRACT/i);
    assert.match(prompt, /Panel 1/);
    assert.match(prompt, /Panel 2/);
    assert.doesNotMatch(prompt, /Panel 3/);
  });
});
