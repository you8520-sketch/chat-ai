import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OpenAiImageError } from "./openAiImageEdit";
import {
  OpenAiImageGenerationError,
  aggregateKnownProviderCostUsd,
  callOpenAiImageEditWithSafetyFallback,
  formatOpenAiImageFinalUserError,
  formatOpenAiImageProviderAttemptsForAdmin,
  serializeOpenAiImageProviderAttempts,
} from "./openAiImageSafetyFallback";
import {
  buildStrictComicFallbackPrompt,
  buildStrictLdDuoFallbackPrompt,
  STRICT_SAFE_DEPICTION,
} from "./chatImageStrictSafetyFallbackPrompt";
import type { ChatImageCastGroundedManifest } from "./chatImageCastManifest";
import type { ScenePlan } from "./chatImageScenePlan";
import { formatOpenAiImageUserError } from "./chatLdIllustrationGeneration";

const REF = `data:image/webp;base64,${Buffer.from("ref").toString("base64")}`;

const RAW_SECRET = "TIER2_RAW_SECRET_성관계_손목을긋고_피를흘린다";

function safetyRejectResponse(withUsage = false) {
  const body: Record<string, unknown> = {
    error: {
      message: "Your request was rejected by the safety system.",
      type: "image_generation_user_error",
      code: "moderation_blocked",
    },
  };
  if (withUsage) {
    body.usage = {
      input_tokens_details: { image_tokens: 100, text_tokens: 20 },
      output_tokens: 200,
    };
  }
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { "Content-Type": "application/json", "x-request-id": "req-safety-1" },
  });
}

function successResponse(usage?: {
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  output_tokens?: number;
}) {
  return new Response(
    JSON.stringify({
      data: [{ b64_json: Buffer.from("ok-image").toString("base64") }],
      usage: usage ?? {
        input_tokens_details: { image_tokens: 10, text_tokens: 5 },
        output_tokens: 20,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function withMockFetch(
  run: (counter: { count: () => number; inc: () => number }) => Promise<void>
) {
  return async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    const counter = {
      count: () => calls,
      inc: () => {
        calls += 1;
        return calls;
      },
    };
    globalThis.fetch = async () => {
      throw new Error("mock fetch handler must override globalThis.fetch");
    };
    try {
      await run(counter);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  };
}

describe("openAiImageSafetyFallback orchestration", () => {
  it("A1 primary success — one provider call, no fallback", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        counter.inc();
        return successResponse();
      };
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
      assert.equal(counter.count(), 1);
      assert.equal(result.safetyFallbackUsed, false);
      assert.equal(result.providerAttempts.length, 1);
      assert.equal(result.providerAttempts[0]?.outcome, "success");
      assert.equal(result.buffer.toString(), "ok-image");
      assert.equal(result.hasUnknownAttemptCost, false);
    })();
  });

  it("A2 safety reject then fallback success — two calls, usage absent on reject", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        const n = counter.inc();
        return n === 1 ? safetyRejectResponse(false) : successResponse();
      };
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: "gpt-image-2",
        primaryPrompt: "risky primary",
        strictFallbackPrompt: "strict safe fallback",
        references: [REF],
        size: "800x1200",
        quality: "medium",
        outputCompression: 86,
      });
      assert.equal(counter.count(), 2);
      assert.equal(result.safetyFallbackUsed, true);
      assert.equal(result.hasUnknownAttemptCost, true);
      assert.equal(result.providerAttempts[0]?.outcome, "safety_rejected");
      assert.equal(result.providerAttempts[1]?.outcome, "success");
    })();
  });

  it("A3 safety reject with usage then success — known cost sums both attempts", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        const n = counter.inc();
        return n === 1
          ? safetyRejectResponse(true)
          : successResponse({
              input_tokens_details: { image_tokens: 50, text_tokens: 10 },
              output_tokens: 100,
            });
      };
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: "gpt-image-2",
        primaryPrompt: "risky primary",
        strictFallbackPrompt: "strict safe fallback",
        references: [REF],
        size: "800x1200",
        quality: "medium",
        outputCompression: 86,
      });
      const costA = result.providerAttempts[0]?.costUsd;
      const costB = result.providerAttempts[1]?.costUsd;
      assert.ok(costA != null && costA > 0);
      assert.ok(costB != null && costB > 0);
      assert.equal(result.knownProviderCostUsd, costA + costB);
      assert.equal(result.hasUnknownAttemptCost, false);
      assert.equal(result.finalAttemptCostUsd, costB);
    })();
  });

  it("A3b first reject usage absent — known cost is fallback only, unknown flagged", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        const n = counter.inc();
        return n === 1
          ? safetyRejectResponse(false)
          : successResponse({
              input_tokens_details: { image_tokens: 50, text_tokens: 10 },
              output_tokens: 100,
            });
      };
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: "gpt-image-2",
        primaryPrompt: "risky primary",
        strictFallbackPrompt: "strict safe fallback",
        references: [REF],
        size: "800x1200",
        quality: "medium",
        outputCompression: 86,
      });
      assert.equal(result.providerAttempts[0]?.costUsd ?? null, null);
      assert.ok(result.providerAttempts[1]?.costUsd != null);
      assert.equal(result.knownProviderCostUsd, result.providerAttempts[1]?.costUsd ?? null);
      assert.equal(result.hasUnknownAttemptCost, true);
    })();
  });

  it("A4 double safety reject — exactly two calls, both diagnostics preserved", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        counter.inc();
        return safetyRejectResponse();
      };
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
        (error: unknown) => {
          if (!(error instanceof OpenAiImageGenerationError)) return false;
          assert.equal(error.providerAttempts.length, 2);
          assert.equal(error.providerAttempts[0]?.outcome, "safety_rejected");
          assert.equal(error.providerAttempts[1]?.outcome, "safety_rejected");
          return true;
        }
      );
      assert.equal(counter.count(), 2);
    })();
  });

  it("A5 safety reject then fallback timeout — preserves both attempts", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        const n = counter.inc();
        if (n === 1) return safetyRejectResponse();
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      };
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
        (error: unknown) => {
          if (!(error instanceof OpenAiImageGenerationError)) return false;
          assert.equal(error.providerAttempts.length, 2);
          assert.equal(error.providerAttempts[0]?.outcome, "safety_rejected");
          assert.equal(error.providerAttempts[1]?.outcome, "failed");
          assert.match(formatOpenAiImageFinalUserError(), /생성하지 못했습니다/);
          return true;
        }
      );
      assert.equal(counter.count(), 2);
    })();
  });

  it("A5b safety reject then fallback network failure — first rejection preserved", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        const n = counter.inc();
        if (n === 1) return safetyRejectResponse();
        throw new TypeError("network down");
      };
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
        (error: unknown) => {
          if (!(error instanceof OpenAiImageGenerationError)) return false;
          assert.equal(error.providerAttempts.length, 2);
          assert.equal(error.providerAttempts[0]?.outcome, "safety_rejected");
          assert.equal(error.providerAttempts[0]?.diagnostic?.providerRequestId, "req-safety-1");
          return true;
        }
      );
      assert.equal(counter.count(), 2);
    })();
  });

  it("A6 429 primary — no safety retry", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        counter.inc();
        return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
      };
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
      assert.equal(counter.count(), 1);
    })();
  });

  it("A7 500 primary — no safety retry", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        counter.inc();
        return new Response(JSON.stringify({ error: { message: "server error" } }), { status: 500 });
      };
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
      assert.equal(counter.count(), 1);
    })();
  });

  it("A8 invalid-request 400 non-safety — no retry", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        counter.inc();
        return new Response(
          JSON.stringify({ error: { message: "Invalid image format", code: "invalid_image" } }),
          { status: 400 }
        );
      };
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
      assert.equal(counter.count(), 1);
    })();
  });

  it("A9 safety-adjacent generic error without structured safety rejection — no retry", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        counter.inc();
        return new Response(
          JSON.stringify({
            error: { message: "Content was blocked for your account." },
          }),
          { status: 400 }
        );
      };
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
      assert.equal(counter.count(), 1);
    })();
  });

  it("E1 primary 429 maps to rate-limit message, not scene-change wording", () => {
    const msg = formatOpenAiImageUserError("rate limit");
    assert.match(msg, /잠시 후/);
    assert.doesNotMatch(msg, /장면을 조금 바꿔/);
    assert.doesNotMatch(msg, /안전 필터/);
  });

  it("E3 exhausted safety recovery uses generic scene-change message", () => {
    const msg = formatOpenAiImageFinalUserError(
      "Your request was rejected by the safety system."
    );
    assert.doesNotMatch(msg, /안전 필터/);
    assert.doesNotMatch(msg, /safety/i);
    assert.doesNotMatch(msg, /moderation/i);
    assert.match(msg, /생성하지 못했습니다/);
    assert.match(msg, /장면을 조금 바꿔/);
  });

  it("aggregateKnownProviderCostUsd sums known attempt costs only", () => {
    assert.ok(Math.abs((aggregateKnownProviderCostUsd([
        { attempt: 1, kind: "primary", outcome: "safety_rejected", costUsd: 0.003 },
        { attempt: 2, kind: "strict_safety_fallback", outcome: "success", costUsd: 0.01 },
      ]) ?? 0) - 0.013) < 1e-9);
    assert.equal(
      aggregateKnownProviderCostUsd([
        { attempt: 1, kind: "primary", outcome: "safety_rejected", costUsd: null },
        { attempt: 2, kind: "strict_safety_fallback", outcome: "success", costUsd: 0.01 },
      ]),
      0.01
    );
    assert.equal(aggregateKnownProviderCostUsd([]), null);
  });

  it("admin provider attempt diagnostic exposes recovered success evidence", async () => {
    await withMockFetch(async (counter) => {
      globalThis.fetch = async () => {
        const n = counter.inc();
        return n === 1 ? safetyRejectResponse(true) : successResponse();
      };
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: "gpt-image-2",
        primaryPrompt: "risky primary",
        strictFallbackPrompt: "strict safe fallback",
        references: [REF],
        size: "800x1200",
        quality: "medium",
        outputCompression: 86,
      });
      const admin = formatOpenAiImageProviderAttemptsForAdmin({
        providerAttempts: result.providerAttempts,
        knownProviderCostUsd: result.knownProviderCostUsd,
        hasUnknownAttemptCost: result.hasUnknownAttemptCost,
        safetyFallbackUsed: result.safetyFallbackUsed,
      });
      assert.equal(admin.safetyFallbackUsed, true);
      assert.equal(admin.attemptCount, 2);
      assert.equal((admin.attempts as Array<{ outcome: string }>)[0]?.outcome, "safety_rejected");
      assert.equal((admin.attempts as Array<{ outcome: string }>)[1]?.outcome, "success");
      assert.ok(admin.knownProviderCostUsd != null);
    })();
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
  const duoSubjects = [
    {
      key: "character",
      name: "태현",
      gender: "male" as const,
      role: "character",
      referenceImageUrl: "/c.webp",
      savedAppearance: "explicit prose should not leak",
      appearanceMode: "image_only" as const,
    },
    {
      key: "persona",
      name: "유저",
      gender: "female" as const,
      role: "persona",
      referenceImageUrl: "/p.webp",
      savedAppearance: "",
      appearanceMode: "image_only" as const,
    },
  ];

  it("S1 explicit adult source absent from strict LD fallback", () => {
    const explicit = "둘이 침대에서 격렬하게 관계를 가진다";
    const prompt = buildStrictLdDuoFallbackPrompt({
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: duoSubjects,
    });
    assert.doesNotMatch(prompt, new RegExp(explicit.slice(0, 6)));
    assert.match(prompt, /STRICT PROVIDER-SAFE FALLBACK/);
    assert.match(prompt, /non-sexual/i);
    assert.doesNotMatch(prompt, /non-explicit adult intimacy allowance/i);
    assert.doesNotMatch(prompt, /explicit prose should not leak/);
  });

  it("S2 self-harm raw source absent from strict LD fallback", () => {
    const prompt = buildStrictLdDuoFallbackPrompt({
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
    });
    assert.doesNotMatch(prompt, /손목을긋/);
    assert.doesNotMatch(prompt, /피를흘/);
  });

  it("S3 graphic raw source absent", () => {
    const prompt = buildStrictLdDuoFallbackPrompt({
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
    });
    assert.doesNotMatch(prompt, /피를흘/);
    assert.doesNotMatch(prompt, /TIER2_RAW_SECRET/);
  });

  it("S4 coercive/sexual raw source absent", () => {
    const prompt = buildStrictLdDuoFallbackPrompt({
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
    });
    assert.doesNotMatch(prompt, /성관계/);
    assert.doesNotMatch(prompt, /TIER2_RAW_SECRET/);
  });

  it("S7 strict fallback uses base safe depiction only", () => {
    assert.match(STRICT_SAFE_DEPICTION, /non-explicit/i);
    assert.doesNotMatch(STRICT_SAFE_DEPICTION, /shirtless adult male torso allowance/i);
  });

  it("C-RAW-1 multi-cast comic strict fallback omits SceneEvent.text bindings", () => {
    const eventId = "evt-secret";
    const plan: ScenePlan = {
      sceneBackground: "bedroom",
      events: [
        {
          id: eventId,
          order: 1,
          sourceMessageId: 1,
          sourceRole: "assistant",
          kind: "action",
          actor: "character",
          text: RAW_SECRET,
          segmentKind: "narration",
        },
      ],
      castMentions: [],
      panels: [],
      dialogues: [],
    };
    const castManifest: ChatImageCastGroundedManifest = {
      compositionGoal: "trio_group",
      subjects: [
        {
          key: "persona",
          role: "user_persona",
          name: "UserPersona",
          gender: "female",
          referenceImageUrl: "/p.webp",
          appearanceMode: "image_only",
          importance: "primary",
          visibility: "required_visible",
          sourceKind: "persona",
          included: true,
        },
        {
          key: "main_character",
          role: "chat_character",
          name: "CharacterA",
          gender: "male",
          referenceImageUrl: "/c.webp",
          appearanceMode: "image_only",
          importance: "primary",
          visibility: "required_visible",
          sourceKind: "character",
          included: true,
        },
        {
          key: "supporting:A",
          role: "supporting_character",
          name: "SupportA",
          gender: "female",
          referenceImageUrl: "/s.webp",
          appearanceMode: "image_only",
          importance: "primary",
          visibility: "required_visible",
          sourceKind: "cast_asset",
          included: true,
        },
      ],
      eventSubjectBindings: [{ eventId, subjectKey: "supporting:A" }],
    };
    const castSelected = castManifest.subjects.filter((subject) => subject.included);
    const subjects = castSelected.map((subject) => ({
      key: subject.key,
      name: subject.name,
      gender: subject.gender,
      role: subject.role,
      referenceImageUrl: subject.referenceImageUrl ?? "",
      savedAppearance: RAW_SECRET,
      appearanceMode: subject.appearanceMode,
    }));
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 3,
      characterName: "CharacterA",
      characterGender: "male",
      personaName: "UserPersona",
      personaGender: "female",
      subjects,
      castManifest,
      castSelected,
    });
    assert.match(prompt, /UserPersona/);
    assert.match(prompt, /CharacterA/);
    assert.match(prompt, /SupportA/);
    assert.match(prompt, /Exactly 3 recurring identities/);
    assert.match(prompt, /exactly 3/i);
    assert.doesNotMatch(prompt, /TIER2_RAW_SECRET/);
    assert.doesNotMatch(prompt, /성관계/);
    assert.doesNotMatch(prompt, /손목을긋/);
    assert.doesNotMatch(prompt, /피를흘/);
    assert.doesNotMatch(prompt, /EVENT SUBJECT BINDINGS/);
    void plan;
  });

  for (const panelCount of [2, 3, 4] as const) {
    it(`C${panelCount} ${panelCount}-panel strict comic fallback keeps panel count and no text`, () => {
      const prompt = buildStrictComicFallbackPrompt({
        panelCount,
        characterName: "A",
        characterGender: "female",
        personaName: "B",
        personaGender: "male",
        subjects: duoSubjects,
      });
      assert.match(prompt, new RegExp(`exactly ${panelCount}`, "i"));
      assert.match(prompt, /NO TEXT CONTRACT/i);
      assert.match(prompt, /Panel 1/);
      assert.match(prompt, new RegExp(`Panel ${panelCount}`));
      if (panelCount < 4) assert.doesNotMatch(prompt, /Panel 4/);
    });
  }
});
