import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLdSceneGenerationPlan,
} from "@/lib/chatLdIllustrationGeneration";
import {
  buildStrictLdDuoFallbackPrompt,
  deriveLdStrictFallbackSceneFacts,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  classifyRawVisualRisk,
  containsRawRiskySourceLeak,
  projectSceneBlockForSafeImageGeneration,
  projectSceneTextForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";
import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";

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

function ldPlan(currentTurn: string, adultGrounded: boolean) {
  return buildLdSceneGenerationPlan({
    characterName: "태현",
    characterGender: "male",
    personaName: "유저",
    personaGender: "female",
    characterImageUrl: "/c.webp",
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: "/p.webp",
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    currentTurn,
    adultGrounded,
  });
}

function ldTier2(currentTurn: string, adultGrounded: boolean) {
  return buildStrictLdDuoFallbackPrompt({
    characterName: "태현",
    characterGender: "male",
    personaName: "유저",
    personaGender: "female",
    subjects: DUO_SUBJECTS,
    sceneSourceText: currentTurn,
    adultGrounded,
  });
}

describe("chatImageSafeProjectionRegression", () => {
  it("SAFE-KISS preserves brief non-explicit kiss semantics", () => {
    const source = "두 성인이 서로를 껴안고 뺨에 짧게 키스한다.";
    const projected = projectSceneBlockForSafeImageGeneration(source, { adultGrounded: true });
    assert.equal(classifyRawVisualRisk(source).includes("adult_explicit"), false);
    assert.equal(projected.applied, false);
    assert.match(projected.text, /키스/);
    assert.match(ldPlan(source, true).prompt, /키스/);
  });

  it("SAFE-HUG preserves embrace semantics", () => {
    const source = "둘이 서로를 껴안고 조용히 숨을 고른다.";
    const projected = projectSceneBlockForSafeImageGeneration(source, { adultGrounded: true });
    assert.equal(projected.applied, false);
    assert.match(projected.text, /껴안/);
  });

  it("BED-LYING preserves bed and lying posture without forcing standing/sitting", () => {
    const source = "두 성인이 침대에 옆으로 누워 대화하며 쉬고 있다.";
    const projected = projectSceneBlockForSafeImageGeneration(source, { adultGrounded: true });
    assert.equal(projected.applied, false);
    assert.match(projected.text, /침대/);
    assert.match(projected.text, /누/);
    const tier2 = ldTier2(source, true);
    assert.doesNotMatch(tier2, /standing or sitting/i);
    assert.match(tier2, /bed|resting|누/i);
  });

  it("BED-CONVERSATION is not classified explicit by bedroom location alone", () => {
    const source = "침실 침대 위에서 둘이 편하게 대화한다.";
    assert.equal(classifyRawVisualRisk(source).includes("adult_explicit"), false);
    const projected = projectSceneBlockForSafeImageGeneration(source, { adultGrounded: true });
    assert.equal(projected.applied, false);
    assert.match(projected.text, /침대|침실/);
  });

  it("COVERED-AFTERMATH preserves same-scene intimacy without raw explicit detail", () => {
    const source = "둘이 침대에서 겹치며 성관계를 한다. 둘 다 수줍게 뺨이 붉어진다.";
    const projected = projectSceneBlockForSafeImageGeneration(source, { adultGrounded: true });
    assert.equal(containsRawRiskySourceLeak(projected.text), false);
    assert.doesNotMatch(projected.text, /성관계/);
    assert.match(projected.text, /bedroom aftermath|Close adult intimacy/i);
    const tier2 = ldTier2(source, true);
    assert.match(tier2, /bed|bedroom/i);
    assert.doesNotMatch(tier2, /standing or sitting/i);
    assert.match(tier2, /shy|flushed|awkward|tender/i);
  });

  it("ADULT-OFF excludes adult-only allowance from primary prompt", () => {
    const source = "둘이 침대에서 겹치며 성관계를 한다.";
    const prompt = ldPlan(source, false).prompt;
    assert.doesNotMatch(prompt, /shirtless adult male torso/i);
    assert.doesNotMatch(prompt, /Close adult intimacy/i);
    assert.doesNotMatch(prompt, /bedroom aftermath/i);
    assert.match(prompt, /non-sexual/i);
  });

  it("EXPLICIT-RAW-LEAK provider-bound raw explicit phrase count = 0", () => {
    const source = "둘이 침대에서 겹치며 성관계를 한다.";
    const prompt = ldPlan(source, true).prompt;
    assert.equal(containsRawRiskySourceLeak(prompt), false);
    assert.doesNotMatch(prompt, /성관계/);
  });

  it("TIER2-SAME-SCENE shares location and pose facts with primary projection", () => {
    const source = "두 성인이 침대에 누워 이불을 덮고 조용히 대화한다.";
    const primary = ldPlan(source, true).prompt;
    const tier2 = ldTier2(source, true);
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
    });
    assert.match(primary, /침대|누/);
    assert.match(tier2, new RegExp(facts.safeBroadLocation.split(" ")[1] ?? "bedroom", "i"));
    assert.match(tier2, /resting|bed/i);
    assert.doesNotMatch(tier2, /standing or sitting/i);
    assert.doesNotMatch(tier2, /neutral closeness only/i);
    assert.doesNotMatch(tier2, /sofa|거실/i);
  });

  it("ATTEMPT-BUDGET max provider attempts remains 2", () => {
    assert.equal(MAX_PROVIDER_ATTEMPTS, 2);
  });

  it("R6 fail-before generic Tier-2 override removed", () => {
    const tier2 = ldTier2("두 성인이 침대에 누워 쉰다.", true);
    assert.doesNotMatch(tier2, /standing or sitting near each other/i);
    assert.doesNotMatch(tier2, /no physical intimacy beyond neutral closeness/i);
    assert.doesNotMatch(tier2, /a calm, well-lit indoor or outdoor setting suited to the characters/i);
  });
});
