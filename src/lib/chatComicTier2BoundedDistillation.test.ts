import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import {
  containsBedroomBedStructure,
  projectComicSafeStructureForTier2,
  renderComicSafeStructureForTier2Prompt,
} from "@/lib/chatComicSafeStructure";
import {
  buildAndAuditStrictComicFallbackPrompt,
  collectTier2RawSourceCandidates,
} from "@/lib/chatComicTier2SafetyAudit";
import {
  boundTier2PanelDialogue,
  TIER2_PANEL_CONTINUITY_POSE,
  TIER2_PANEL_GLOBAL_CLOTHING_CONTRACT,
} from "@/lib/chatComicTier2SafeProjection";
import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import type { ScenePlan } from "@/lib/chatImageScenePlan";
import {
  closeContactWordingVariantPlan,
  dialogueRepresentativePlan,
  e1ExplicitOriginSafePlan,
  p1BedroomCloseProximityPlan,
  p2ShirtlessBedCoveragePlan,
  p3BriefKissPlan,
  realFailLikeSanitizedScenePlan,
  shyTenseAtmospherePlan,
} from "@/lib/chatComicTier2BoundedDistillation.fixture";
import { compilerOnlyDuoVisualSubjects } from "@/lib/chatComicPanelSpec.fixtures";

const duoSubjects = compilerOnlyDuoVisualSubjects({
  characterName: "Alpha",
  personaName: "Beta",
});

function countStructureDialogue(plan: ScenePlan): number {
  const structure = projectComicSafeStructureForTier2(plan);
  return structure.panels.reduce((total, panel) => total + (panel.dialogue?.length ?? 0), 0);
}

function buildFinalTier2Prompt(plan: ScenePlan, panelCount = plan.panels.length) {
  const structure = projectComicSafeStructureForTier2(plan);
  return buildAndAuditStrictComicFallbackPrompt({
    panelCount: panelCount as 2 | 3 | 4,
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

function buildStrictPrompt(plan: ScenePlan, panelCount = plan.panels.length) {
  return buildStrictComicFallbackPrompt({
    panelCount: panelCount as 2 | 3 | 4,
    characterName: "A",
    characterGender: "male",
    personaName: "B",
    personaGender: "female",
    subjects: duoSubjects,
    safeStructure: projectComicSafeStructureForTier2(plan),
    compositionMode: "full_provider_rendered",
  });
}

describe("chatComicTier2BoundedDistillation REAL_FAIL-like fixture", () => {
  const plan = realFailLikeSanitizedScenePlan();

  it("dense source plan carries multi-beat arc before Tier-2 distillation", () => {
    assert.equal(plan.events.length, 20);
    assert.equal(
      plan.panels.reduce((n, panel) => n + panel.dialogue.length, 0),
      8
    );
  });

  it("bounded projection reduces dialogue and duplicate structured beats", () => {
    const bounded = projectComicSafeStructureForTier2(plan);
    const dialogueCount = countStructureDialogue(plan);
    const continuityPanels = bounded.panels.filter(
      (panel) => panel.poseHint === TIER2_PANEL_CONTINUITY_POSE
    ).length;
    const expandedPanels = bounded.panels.length - continuityPanels;
    const promptChars = renderComicSafeStructureForTier2Prompt(
      bounded,
      "full_provider_rendered"
    )
      .join("\n")
      .length;

    assert.equal(dialogueCount, 4);
    assert.ok(continuityPanels >= 1);
    assert.ok(expandedPanels >= 2);
    assert.ok(promptChars < 700);
    for (const panel of bounded.panels) {
      assert.ok((panel.dialogue?.length ?? 0) <= 1);
      assert.ok(panel.physicalBeatCategory);
    }
  });

  it("final provider prompt preserves scene and bounds duplicate arc", () => {
    const { prompt, audit } = buildFinalTier2Prompt(plan);
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.equal(audit.userRawProseCount, 0);
    assert.equal(audit.hasBedroom, true);
    assert.equal(audit.hasCloseInteraction, true);
    assert.match(prompt, /침실|침대|bedroom|bed/iu);
    assert.match(prompt, /maintain safe visual continuity/u);
    assert.doesNotMatch(prompt, /성관계/u);
  });

  it("separates global clothing safety contract from scene facts", () => {
    const bounded = projectComicSafeStructureForTier2(plan);
    const sceneHay = bounded.panels
      .map((panel) => `${panel.situation} ${panel.poseHint}`)
      .join(" ");
    const prompt = buildStrictPrompt(plan);

    assert.doesNotMatch(sceneHay, /누(?:워|운|어)/u);
    assert.match(prompt, new RegExp(TIER2_PANEL_GLOBAL_CLOTHING_CONTRACT, "u"));
    assert.match(prompt, /Preserve mood:/u);
  });
});

describe("chatComicTier2BoundedDistillation structured semantic owner", () => {
  it("wording variant fixture collapses by structured category not rendered regex", () => {
    const bounded = projectComicSafeStructureForTier2(closeContactWordingVariantPlan());
    const categories = bounded.panels.map((panel) => panel.physicalBeatCategory);
    assert.ok(categories.includes("close_proximity") || categories.includes("embrace"));
    assert.ok(
      bounded.panels.some((panel) => panel.poseHint === TIER2_PANEL_CONTINUITY_POSE)
    );
  });

  it("dialogue representative skips punctuation-only filler", () => {
    assert.deepEqual(boundTier2PanelDialogue(["…", "여기 있어."]), ["여기 있어."]);
    const bounded = projectComicSafeStructureForTier2(dialogueRepresentativePlan());
    assert.deepEqual(bounded.panels[0]?.dialogue, ["여기 있어."]);
    const { prompt } = buildFinalTier2Prompt(dialogueRepresentativePlan(), 2);
    assert.match(prompt, /여기 있어/);
    assert.doesNotMatch(prompt, /Speech bubble: "…"/);
  });

  it("mood-neutral continuity preserves shared atmosphere without injecting calm", () => {
    const bounded = projectComicSafeStructureForTier2(shyTenseAtmospherePlan());
    const prompt = buildStrictPrompt(shyTenseAtmospherePlan(), 2);
    assert.match(bounded.atmosphere ?? "", /수줍|긴장/u);
    assert.match(prompt, /수줍|긴장/u);
    assert.doesNotMatch(TIER2_PANEL_CONTINUITY_POSE, /calm|차분|평온/u);
    for (const panel of bounded.panels) {
      if (panel.poseHint === TIER2_PANEL_CONTINUITY_POSE) {
        assert.doesNotMatch(panel.poseHint, /calm|차분|평온/u);
      }
    }
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

describe("chatComicTier2BoundedDistillation golden capabilities — final prompt", () => {
  it("P1 bedroom close proximity preserved", () => {
    const { prompt, audit } = buildFinalTier2Prompt(p1BedroomCloseProximityPlan(), 2);
    assert.equal(audit.hasBedroom, true);
    assert.match(prompt, /침실|침대|bedroom|bed/iu);
    assert.match(prompt, /(?:가까|proximity|affectionate|밀착)/iu);
  });

  it("P2 shirtless bed coverage at final prompt — scene beat + global clothing contract", () => {
    const { prompt } = buildFinalTier2Prompt(p2ShirtlessBedCoveragePlan(), 2);
    assert.match(prompt, /(?:벗|어깨|shoulder)/iu);
    assert.match(prompt, /(?:침대|bed)/iu);
    assert.match(prompt, new RegExp(TIER2_PANEL_GLOBAL_CLOTHING_CONTRACT, "u"));
  });

  it("E1 explicit origin — raw leak 0 at final prompt", () => {
    const { audit, prompt } = buildFinalTier2Prompt(e1ExplicitOriginSafePlan(), 2);
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.doesNotMatch(prompt, /성관계/u);
    assert.equal(audit.hasBedroom, true);
  });

  it("P3 brief kiss remains representable at final prompt", () => {
    const prompt = buildStrictPrompt(p3BriefKissPlan(), 2);
    assert.match(prompt, /(?:키스|kiss)/iu);
  });
});

describe("chatComicTier2BoundedDistillation attempt owner", () => {
  it("MAX_PROVIDER_ATTEMPTS remains 2", () => {
    assert.equal(MAX_PROVIDER_ATTEMPTS, 2);
  });
});
