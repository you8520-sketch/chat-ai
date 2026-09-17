import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  projectComicSafeStructureForTier2,
  renderComicSafeStructureForTier2Prompt,
} from "@/lib/chatComicSafeStructure";
import {
  buildAndAuditStrictComicFallbackPrompt,
  collectTier2RawSourceCandidates,
} from "@/lib/chatComicTier2SafetyAudit";
import {
  generalLongRpPlan,
  denseNonIntimateActionPlan,
  p1BedroomCloseProximityPlan,
  p2ShirtlessBedCoveragePlan,
  p3BriefKissPlan,
  realFailLikeSanitizedScenePlan,
} from "@/lib/chatComicTier2BoundedDistillation.fixture";
import {
  isTier2IntimacyHeavyPanel,
  shouldDistillAdultIntimacyCluster,
  TIER2_PANEL_EMOTIONAL_REACTION_POSE,
} from "@/lib/chatComicTier2IntimacyDistillation";
import { TIER2_PANEL_CONTINUITY_POSE } from "@/lib/chatComicTier2SafeProjection";
import { compilerOnlyDuoVisualSubjects } from "@/lib/chatComicPanelSpec.fixtures";

const subjects = compilerOnlyDuoVisualSubjects({
  characterName: "Alpha",
  personaName: "Beta",
});

function finalTier2(plan: Parameters<typeof projectComicSafeStructureForTier2>[0]) {
  const structure = projectComicSafeStructureForTier2(plan);
  return buildAndAuditStrictComicFallbackPrompt({
    panelCount: plan.panels.length as 2 | 3 | 4,
    characterName: "Alpha",
    characterGender: "male",
    personaName: "Beta",
    personaGender: "female",
    subjects,
    safeStructure: structure,
    rawSourceCandidates: collectTier2RawSourceCandidates(plan),
    compositionMode: "full_provider_rendered",
  });
}

describe("chatComicTier2IntimacyDistillation cluster detection", () => {
  it("REAL_FAIL-like dense intimacy cluster triggers distillation", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeSanitizedScenePlan());
    assert.equal(shouldDistillAdultIntimacyCluster(structure.panels), true);
    assert.ok(structure.panels.filter(isTier2IntimacyHeavyPanel).length >= 3);
  });

  it("P1 two-panel proximity does not trigger cluster distillation", () => {
    const structure = projectComicSafeStructureForTier2(p1BedroomCloseProximityPlan());
    assert.equal(shouldDistillAdultIntimacyCluster(structure.panels), false);
  });

  it("P3 single kiss panel does not trigger cluster distillation", () => {
    const structure = projectComicSafeStructureForTier2(p3BriefKissPlan());
    assert.equal(shouldDistillAdultIntimacyCluster(structure.panels), false);
  });

  it("general long RP does not trigger cluster distillation", () => {
    const structure = projectComicSafeStructureForTier2(generalLongRpPlan());
    assert.equal(shouldDistillAdultIntimacyCluster(structure.panels), false);
  });

  it("dense non-intimate action does not trigger cluster distillation", () => {
    const structure = projectComicSafeStructureForTier2(denseNonIntimateActionPlan());
    assert.equal(shouldDistillAdultIntimacyCluster(structure.panels), false);
  });
});

describe("chatComicTier2IntimacyDistillation selective flattening", () => {
  it("REAL_FAIL-like keeps one representative intimacy beat and flattens progression", () => {
    const bounded = projectComicSafeStructureForTier2(realFailLikeSanitizedScenePlan());
    const expanded = bounded.panels.filter(
      (panel) =>
        panel.poseHint !== TIER2_PANEL_CONTINUITY_POSE &&
        panel.poseHint !== TIER2_PANEL_EMOTIONAL_REACTION_POSE &&
        /(?:키스|kiss|affectionate|proximity|embrace|resting|밀착|껴안)/iu.test(
          `${panel.poseHint} ${panel.situation}`
        )
    );
    const continuity = bounded.panels.filter(
      (panel) => panel.poseHint === TIER2_PANEL_CONTINUITY_POSE
    );
    assert.equal(expanded.length, 1);
    assert.ok(continuity.length >= 1);
    assert.ok(bounded.panels.some((panel) => panel.physicalBeatCategory === "kiss"));
  });

  it("REAL_FAIL-like final prompt materially reduces intimacy-derived structure", () => {
    const { prompt, audit } = finalTier2(realFailLikeSanitizedScenePlan());
    const structureLines = renderComicSafeStructureForTier2Prompt(
      projectComicSafeStructureForTier2(realFailLikeSanitizedScenePlan()),
      "full_provider_rendered"
    ).join("\n");
    assert.ok(structureLines.length < 900);
    assert.ok(prompt.length < 6000);
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.equal(audit.userRawProseCount, 0);
    assert.equal(audit.hasBedroom, true);
    assert.match(prompt, /(?:키스|kiss|affectionate|proximity)/iu);
    assert.match(prompt, /maintain safe visual continuity/u);
  });

  it("P1 preserves bedroom close proximity safe cue", () => {
    const { prompt, audit } = finalTier2(p1BedroomCloseProximityPlan());
    assert.equal(audit.hasBedroom, true);
    assert.match(prompt, /(?:침실|침대|bedroom|bed|proximity|affectionate|밀착)/iu);
  });

  it("P2 preserves shirtless bed coverage cue", () => {
    const { prompt } = finalTier2(p2ShirtlessBedCoveragePlan());
    assert.match(prompt, /(?:벗|어깨|shoulder)/iu);
    assert.match(prompt, /(?:침대|bed)/iu);
  });

  it("P3 preserves brief kiss", () => {
    const { prompt } = finalTier2(p3BriefKissPlan());
    assert.match(prompt, /(?:키스|kiss)/iu);
  });

  it("general long RP structure unchanged vs non-intimate baseline", () => {
    const plan = generalLongRpPlan();
    const structure = projectComicSafeStructureForTier2(plan);
    assert.equal(
      structure.panels.every((panel) => panel.poseHint !== TIER2_PANEL_CONTINUITY_POSE),
      true
    );
    assert.equal(structure.panels.filter((panel) => panel.situation.length > 0).length, 4);
  });

  it("dense non-intimate action keeps per-panel situation beats", () => {
    const structure = projectComicSafeStructureForTier2(denseNonIntimateActionPlan());
    assert.equal(
      structure.panels.filter((panel) => panel.situation.trim().length > 0).length,
      4
    );
    assert.equal(
      structure.panels.some((panel) => panel.poseHint === TIER2_PANEL_CONTINUITY_POSE),
      false
    );
  });
});
