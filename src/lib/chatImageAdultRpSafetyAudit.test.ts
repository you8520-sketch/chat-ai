import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatComicImagePrompt } from "@/lib/chatComicGeneration";
import {
  buildLdSceneGenerationPlan,
} from "@/lib/chatLdIllustrationGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  formatSceneSourcePreview,
} from "@/lib/chatImageScenePlan";
import {
  buildIllustrationSafeDepiction,
  containsRawRiskySourceLeak,
  projectSceneBlockForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";
import {
  callOpenAiImageEditWithSafetyFallback,
  MAX_PROVIDER_ATTEMPTS,
  OpenAiImageGenerationError,
} from "@/lib/openAiImageSafetyFallback";
import {
  buildStrictLdDuoFallbackPrompt,
  deriveLdStrictFallbackSceneFacts,
  STRICT_SAFE_DEPICTION,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";

const MILD_BED_SOURCE =
  "침대에 나란히 누워 홍조를 띠며 서로를 바라본다. 남자는 상의를 벗어 어깨가 드러나 있고, 이불이 살짝 엉켜 있다.";
const EXPLICIT_BED_SOURCE = "둘이 침대에서 겹치며 성관계를 한다. 둘 다 수줍게 뺨이 붉어진다.";

const DUO_SUBJECTS = [
  {
    key: "character",
    name: "태현",
    gender: "male" as const,
    role: "character",
    referenceImageUrl: "/c.webp",
    savedAppearance: "",
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

function ldTier2(source: string, adultGrounded: boolean) {
  return buildStrictLdDuoFallbackPrompt({
    characterName: "태현",
    characterGender: "male",
    personaName: "유저",
    personaGender: "female",
    subjects: DUO_SUBJECTS,
    sceneSourceText: source,
    adultGrounded,
  });
}

function comicPrompt(source: string, adultGrounded: boolean) {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "assistant", content: source },
  ]);
  return buildChatComicImagePrompt({
    characterName: "태형",
    characterGender: "male",
    personaName: "렌",
    personaGender: "female",
    plan: buildDeterministicScenePlan(messages, 4),
    adultGrounded,
    providerTextAdultEligible: adultGrounded,
    fullSourceDirectText: formatSceneSourcePreview(messages),
  });
}

function illustrationPrompt(source: string, adultGrounded: boolean) {
  return buildLdSceneGenerationPlan({
    characterName: "태형",
    characterGender: "male",
    personaName: "렌",
    personaGender: "female",
    characterImageUrl: "/c.webp",
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: "/p.webp",
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    currentTurn: source,
    adultGrounded,
  }).prompt;
}

describe("chatImageAdultRpSafetyAudit — route divergence", () => {
  it("RC4 ROUTE-PARITY comic full source uses same safe projection as illustration", () => {
    const projected = projectSceneBlockForSafeImageGeneration(EXPLICIT_BED_SOURCE, {
      adultGrounded: true,
    }).text;
    const comic = comicPrompt(EXPLICIT_BED_SOURCE, true);
    const illustration = illustrationPrompt(EXPLICIT_BED_SOURCE, true);
    assert.equal(containsRawRiskySourceLeak(comic), false);
    assert.equal(containsRawRiskySourceLeak(illustration), false);
    assert.doesNotMatch(comic, /성관계/);
    assert.match(comic, /bedroom aftermath|Close adult intimacy/i);
    assert.match(illustration, /bedroom aftermath|Close adult intimacy/i);
    assert.ok(comic.includes(projected.split("\n")[0]!.slice(0, 24)));
  });

  it("RC4 comic adultGrounded wires adult allowance into safe depiction", () => {
    const prompt = comicPrompt(MILD_BED_SOURCE, true);
    assert.ok(prompt.includes(buildIllustrationSafeDepiction({ adultGrounded: true })));
    assert.match(prompt, /flushed|shirtless|disheveled|sheet/i);
  });
});

describe("chatImageAdultRpSafetyAudit — double moderation terminal", () => {
  it("RC1 DOUBLE-MODERATION terminal after primary and Tier-2 safety rejection", async () => {
    const ref = `data:image/webp;base64,${Buffer.from("ref").toString("base64")}`;
    const rejectBody = {
      error: {
        message: "Your request was rejected by the safety system.",
        type: "image_generation_user_error",
        code: "moderation_blocked",
      },
    };
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(rejectBody), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      await callOpenAiImageEditWithSafetyFallback({
        model: "gpt-image-2",
        primaryPrompt: "primary",
        strictFallbackPrompt: "strict",
        references: [ref],
        size: "800x1200",
        quality: "medium",
        outputCompression: 86,
        mode: "comic",
      });
      assert.fail("expected terminal failure");
    } catch (error) {
      assert.ok(error instanceof OpenAiImageGenerationError);
      assert.equal(calls, MAX_PROVIDER_ATTEMPTS);
      assert.equal(error.providerAttempts.length, 2);
      assert.equal(error.providerAttempts[0]?.outcome, "safety_rejected");
      assert.equal(error.providerAttempts[1]?.outcome, "safety_rejected");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });
});

describe("chatImageAdultRpSafetyAudit — mild-adult fidelity gates", () => {
  it("SAFE-FLUSHED-FACES mild bed source preserves flushed cues in illustration Tier-1", () => {
    const prompt = illustrationPrompt(MILD_BED_SOURCE, true);
    assert.match(prompt, /홍조|누|침대/);
    assert.match(prompt, /flushed|shirtless|disheveled|sheet/i);
  });

  it("SAFE-SHIRTLESS-MALE mild shirtless cue preserved when not explicit", () => {
    const source = "태형이 셔츠를 벗고 침대에 앉아 있다.";
    const projected = projectSceneBlockForSafeImageGeneration(source, { adultGrounded: true });
    assert.equal(projected.applied, false);
    assert.match(projected.text, /셔츠|벗/);
    assert.match(illustrationPrompt(source, true), /shirtless adult male torso/i);
  });

  it("SAFE-MESSY-BEDROOM-MOOD messy bedding cue preserved in mild source", () => {
    const prompt = illustrationPrompt(MILD_BED_SOURCE, true);
    assert.match(prompt, /이불|엉/);
    assert.match(prompt, /disheveled|sheet|bedding/i);
  });

  it("SAFE-COVERED-AFTERMATH explicit block maps to bedroom substitute with mood cues", () => {
    const projected = projectSceneBlockForSafeImageGeneration(EXPLICIT_BED_SOURCE, {
      adultGrounded: true,
    });
    assert.doesNotMatch(projected.text, /성관계/);
    assert.match(projected.text, /bedroom aftermath|flushed|dishevel|sheet/i);
  });

  it("ADULT-OFF excludes adult allowance from mild bed illustration prompt", () => {
    const prompt = illustrationPrompt(MILD_BED_SOURCE, false);
    assert.doesNotMatch(prompt, /shirtless adult male torso/i);
    assert.doesNotMatch(prompt, /disheveled bedding mood/i);
  });

  it("EXPLICIT-RAW-LEAK comic and illustration provider-bound prompts leak count = 0", () => {
    assert.equal(containsRawRiskySourceLeak(comicPrompt(EXPLICIT_BED_SOURCE, true)), false);
    assert.equal(containsRawRiskySourceLeak(illustrationPrompt(EXPLICIT_BED_SOURCE, true)), false);
  });
});

describe("chatImageAdultRpSafetyAudit — LD Tier-2 scene facts", () => {
  it("TIER2-BED-LYING-FLUSHED bedroom + lying + flushed composition and mood", () => {
    const source = "침대에 나란히 누워 홍조를 띠며 서로를 바라본다.";
    const facts = deriveLdStrictFallbackSceneFacts({ sceneSourceText: source, adultGrounded: true });
    const tier2 = ldTier2(source, true);
    assert.match(facts.safeComposition, /resting side by side on the bed/i);
    assert.match(facts.safeComposition, /flushed or shy expressions/i);
    assert.match(facts.safeMood, /flushed|heated|shy/i);
    assert.match(tier2, /Composition:.*resting side by side on the bed/i);
    assert.match(tier2, /flushed or shy expressions/i);
  });

  it("TIER2-BED-SHIRTLESS bedroom + shirtless bare-upper-torso cue in composition", () => {
    const source = "태형이 셔츠를 벗고 침대에 앉아 있다.";
    const facts = deriveLdStrictFallbackSceneFacts({ sceneSourceText: source, adultGrounded: true });
    const tier2 = ldTier2(source, true);
    assert.match(facts.safeComposition, /bare upper torso framed from shoulders/i);
    assert.match(tier2, /bare upper torso framed from shoulders/i);
    assert.doesNotMatch(facts.safeComposition, /without exposed genitals/i);
    assert.doesNotMatch(tier2, /without exposed genitals/i);
  });

  it("TIER2-COMBINED-BEDROOM combines lying + shirtless + flushed + messy bedding", () => {
    const source = MILD_BED_SOURCE;
    const facts = deriveLdStrictFallbackSceneFacts({ sceneSourceText: source, adultGrounded: true });
    const tier2 = ldTier2(source, true);
    assert.match(facts.safeComposition, /resting side by side on the bed/i);
    assert.match(facts.safeComposition, /bare upper torso framed from shoulders/i);
    assert.match(facts.safeComposition, /flushed or shy expressions/i);
    assert.match(facts.safeComposition, /gently rumpled bedding/i);
    assert.match(tier2, /bare upper torso framed from shoulders/i);
    assert.match(tier2, /gently rumpled bedding/i);
  });

  it("TIER2-EXPLICIT-RAW-LEAK explicit source produces zero raw leak in strict fallback prompt", () => {
    const tier2 = ldTier2(EXPLICIT_BED_SOURCE, true);
    assert.equal(containsRawRiskySourceLeak(tier2), false);
    assert.doesNotMatch(tier2, /성관계/);
    assert.match(tier2, /STRICT PROVIDER-SAFE FALLBACK/i);
  });

  it("TIER2-ADULT-OFF uses base strict depiction without adult-grounded allowance", () => {
    const tier2 = ldTier2(MILD_BED_SOURCE, false);
    assert.ok(tier2.includes(STRICT_SAFE_DEPICTION));
    assert.doesNotMatch(tier2, /non-explicit adult intimacy allowance/i);
    assert.doesNotMatch(tier2, /shirtless adult male torso allowance/i);
  });

  it("TIER2-ADULT-OFF-SHIRTLESS combined bedroom fixture omits bare-upper-torso when adultGrounded=false", () => {
    const source = MILD_BED_SOURCE;
    const facts = deriveLdStrictFallbackSceneFacts({ sceneSourceText: source, adultGrounded: false });
    const tier2 = ldTier2(source, false);
    assert.equal(containsRawRiskySourceLeak(tier2), false);
    assert.doesNotMatch(tier2, /bare upper torso/i);
    assert.doesNotMatch(tier2, /shirtless adult male/i);
    assert.doesNotMatch(tier2, /non-explicit adult intimacy allowance/i);
    assert.doesNotMatch(tier2, /shirtless adult male torso allowance/i);
    assert.match(tier2, /resting side by side on the bed/i);
    assert.match(tier2, /flushed or shy expressions/i);
    assert.match(tier2, /gently rumpled bedding/i);
    assert.doesNotMatch(facts.safeComposition, /bare upper torso/i);
  });

  it("TIER2-ADULT-ON-SHIRTLESS combined bedroom fixture preserves shirtless cue when adultGrounded=true", () => {
    const source = MILD_BED_SOURCE;
    const facts = deriveLdStrictFallbackSceneFacts({ sceneSourceText: source, adultGrounded: true });
    const tier2 = ldTier2(source, true);
    assert.match(facts.safeComposition, /resting side by side on the bed/i);
    assert.match(facts.safeComposition, /bare upper torso framed from shoulders/i);
    assert.match(facts.safeComposition, /flushed or shy expressions/i);
    assert.match(facts.safeComposition, /gently rumpled bedding/i);
    assert.match(tier2, /bare upper torso framed from shoulders/i);
    assert.match(tier2, /flushed or shy expressions/i);
    assert.match(tier2, /gently rumpled bedding/i);
  });
});
