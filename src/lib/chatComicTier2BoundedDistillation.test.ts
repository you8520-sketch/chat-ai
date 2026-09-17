import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  buildChatComicGenerationPlan,
} from "@/lib/chatComicGeneration";
import {
  containsBedroomBedStructure,
  countTier2NonContinuityPanels,
  countTier2StructureDialogue,
  countTier2StructurePhysicalBeats,
  measureTier2PanelBeatChars,
  measureTier2StructurePromptChars,
  projectComicSafeStructureForTier2,
  projectComicSafeStructureForTier2Raw,
} from "@/lib/chatComicSafeStructure";
import {
  buildAndAuditStrictComicFallbackPrompt,
  collectTier2RawSourceCandidates,
} from "@/lib/chatComicTier2SafetyAudit";
import { TIER2_PANEL_CONTINUITY_POSE } from "@/lib/chatComicTier2SafeProjection";
import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import {
  e1ExplicitOriginSafePlan,
  p1BedroomCloseProximityPlan,
  p2ShirtlessBedCoveragePlan,
  p3BriefKissPlan,
  realFailLikeSanitizedScenePlan,
} from "@/lib/chatComicTier2BoundedDistillation.fixture";
import { compilerOnlyDuoVisualSubjects } from "@/lib/chatComicPanelSpec.fixtures";

const duoSubjects = compilerOnlyDuoVisualSubjects({
  characterName: "Alpha",
  personaName: "Beta",
});

function buildTier2Prompt(plan: ReturnType<typeof realFailLikeSanitizedScenePlan>) {
  const structure = projectComicSafeStructureForTier2(plan);
  return buildAndAuditStrictComicFallbackPrompt({
    panelCount: 4,
    characterName: "Alpha",
    characterGender: "male",
    personaName: "Beta",
    personaGender: "female",
    subjects: duoSubjects,
    safeStructure: structure,
    rawSourceCandidates: collectTier2RawSourceCandidates(plan),
    compositionMode: "full_provider_rendered",
  });
}

describe("chatComicTier2BoundedDistillation REAL_FAIL-like fixture", () => {
  const plan = realFailLikeSanitizedScenePlan();

  it("fail-before raw projection expands multi-beat semantics", () => {
    assert.equal(plan.events.length, 20);
    assert.equal(
      plan.panels.reduce((n, panel) => n + panel.dialogue.length, 0),
      8
    );

    const raw = projectComicSafeStructureForTier2Raw(plan);
    assert.equal(raw.panels.length, 4);
    assert.ok(countTier2StructureDialogue(raw) >= 6);
    assert.equal(countTier2NonContinuityPanels(raw), 4);
    assert.ok(measureTier2PanelBeatChars(raw) > 200);
  });

  it("pass-after bounded projection reduces dialogue and duplicate beats", () => {
    const raw = projectComicSafeStructureForTier2Raw(plan);
    const bounded = projectComicSafeStructureForTier2(plan);

    const beforeDialogue = countTier2StructureDialogue(raw);
    const afterDialogue = countTier2StructureDialogue(bounded);
    const beforeExpandedPanels = countTier2NonContinuityPanels(raw);
    const afterExpandedPanels = countTier2NonContinuityPanels(bounded);
    const beforeBeatChars = measureTier2PanelBeatChars(raw);
    const afterBeatChars = measureTier2PanelBeatChars(bounded);
    const beforeChars = measureTier2StructurePromptChars(raw, "full_provider_rendered");
    const afterChars = measureTier2StructurePromptChars(bounded, "full_provider_rendered");

    assert.ok(beforeDialogue > afterDialogue);
    assert.equal(afterDialogue, 4);
    assert.ok(beforeExpandedPanels > afterExpandedPanels);
    assert.ok(afterExpandedPanels >= 2);
    assert.ok(beforeBeatChars > afterBeatChars);
    assert.ok(beforeChars > afterChars);

    for (const panel of bounded.panels) {
      assert.ok((panel.dialogue?.length ?? 0) <= 1);
    }
  });

  it("preserves same-scene location, cast continuity, and representative intimacy", () => {
    const bounded = projectComicSafeStructureForTier2(plan);
    assert.equal(bounded.panels.length, 4);
    assert.equal(containsBedroomBedStructure(bounded), true);
    assert.match(bounded.sharedBackground, /침실/u);
    const combined = bounded.panels.map((p) => `${p.situation} ${p.poseHint}`).join(" ");
    assert.match(combined, /(?:가까|껴안|키스|홍조|애틋|침대|bed|bedroom)/iu);
    assert.doesNotMatch(combined, /성관계/u);
  });

  it("Tier-2 prompt stays lexically clean after distillation", () => {
    const { prompt, audit } = buildTier2Prompt(plan);
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.equal(audit.userRawProseCount, 0);
    assert.equal(audit.strongGenitalTermCount, 0);
    assert.equal(audit.negativeSexualSafetyVocabCount, 0);
    assert.equal(audit.hasBedroom, true);
    assert.equal(audit.hasBed, true);
    assert.equal(audit.hasCloseInteraction, true);
    assert.doesNotMatch(prompt, /성관계/u);
  });

  it("does not invent lying/coverage facts beyond source", () => {
    const bounded = projectComicSafeStructureForTier2(plan);
    const hay = JSON.stringify(bounded);
    assert.doesNotMatch(hay, /blanket|sheet coverage invented/iu);
    const continuityCount = bounded.panels.filter((p) =>
      p.poseHint.includes(TIER2_PANEL_CONTINUITY_POSE)
    ).length;
    assert.ok(continuityCount >= 1);
  });
});

describe("chatComicTier2BoundedDistillation primary unchanged", () => {
  it("Tier-1 generation plan is independent of Tier-2 distillation", () => {
    const plan = realFailLikeSanitizedScenePlan();
    const primary = buildChatComicGenerationPlan({
      characterName: "Alpha",
      characterGender: "male",
      personaName: "Beta",
      personaGender: "female",
      characterImageUrl: "/c.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "/p.webp",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      mood: "comic",
      plan,
      compositionMode: "full_provider_rendered",
      adultGrounded: true,
      providerTextAdultEligible: true,
      fullSourceDirectText: "sanitized fixture source for primary path",
    });
    assert.ok(primary.prompt.length > 500);
    assert.match(primary.prompt, /FULL SOURCE/u);
    assert.doesNotMatch(primary.prompt, /STRICT PROVIDER-SAFE FALLBACK/u);
  });
});

describe("chatComicTier2BoundedDistillation golden capabilities", () => {
  it("P1 bedroom close proximity preserved", () => {
    const structure = projectComicSafeStructureForTier2(p1BedroomCloseProximityPlan());
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "male",
      personaName: "B",
      personaGender: "female",
      subjects: duoSubjects,
      safeStructure: structure,
      compositionMode: "full_provider_rendered",
    });
    assert.equal(containsBedroomBedStructure(structure), true);
    assert.match(prompt, /침실|침대|bedroom|bed/iu);
    assert.match(prompt, /(?:가까|proximity|affectionate)/iu);
  });

  it("P2 shirtless bed coverage preserved", () => {
    const structure = projectComicSafeStructureForTier2(p2ShirtlessBedCoveragePlan());
    const hay = structure.panels.map((p) => `${p.situation} ${p.poseHint}`).join(" ");
    assert.match(hay, /(?:벗|어깨|shirtless|shoulder)/iu);
    assert.match(hay, /(?:침대|bed)/iu);
  });

  it("E1 explicit origin projects safely without raw leak", () => {
    const { audit, prompt } = buildTier2Prompt(e1ExplicitOriginSafePlan());
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.doesNotMatch(prompt, /성관계/u);
    assert.equal(audit.hasBedroom, true);
  });

  it("P3 brief kiss preserved", () => {
    const structure = projectComicSafeStructureForTier2(p3BriefKissPlan());
    const hay = structure.panels.map((p) => `${p.situation} ${p.poseHint}`).join(" ");
    assert.match(hay, /(?:키스|kiss)/iu);
  });
});

describe("chatComicTier2BoundedDistillation attempt owner", () => {
  it("MAX_PROVIDER_ATTEMPTS remains 2", () => {
    assert.equal(MAX_PROVIDER_ATTEMPTS, 2);
  });
});
