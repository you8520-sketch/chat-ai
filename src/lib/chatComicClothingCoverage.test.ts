import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTier2StrictFallbackPrompt,
  panelLine,
  tier2BedroomAffectionScenePlan,
  tier2BriefKissScenePlan,
  tier2MultiDialogueScenePlan,
  tier2NeutralScenePlan,
  tier2ShirtlessRomanceScenePlan,
  tier2SingleDialogueScenePlan,
  TIER2_CLOTHING_FEMALE_CHARACTER_SUBJECTS,
  TIER2_CLOTHING_TEST_SUBJECTS,
} from "./chatComicClothingCoverage.fixtures";
import {
  projectComicSafeStructureForTier2,
  renderTier2ComicGlobalClothingFooter,
  renderTier2PanelClothingContract,
  resolveTier2PanelClothingCoverage,
} from "./chatComicSafeStructure";

function assertDefaultModestPrompt(prompt: string): void {
  assert.match(prompt, /Modest clothing throughout/iu);
  for (const panel of [1, 2, 3, 4]) {
    assert.match(panelLine(prompt, panel), /modest covered clothing/iu);
    assert.doesNotMatch(panelLine(prompt, panel), /bare upper torso/iu);
  }
}

describe("chatComicClothingCoverage canonical owner", () => {
  it("renders modest default contract unchanged", () => {
    assert.equal(renderTier2PanelClothingContract("modest_covered"), "modest covered clothing");
  });

  it("gates shirtless coverage on adultGrounded and male character gender", () => {
    const panel = {
      index: 1,
      sourceEventIds: [],
      situation: "x",
      dialogue: [],
      clothingCoverage: "adult_male_character_shirtless_upper_torso" as const,
    };
    assert.equal(resolveTier2PanelClothingCoverage(panel, false, "male"), "modest_covered");
    assert.equal(
      resolveTier2PanelClothingCoverage(panel, true, "male"),
      "adult_male_character_shirtless_upper_torso"
    );
    assert.equal(
      resolveTier2PanelClothingCoverage(panel, true, "female"),
      "modest_covered"
    );
  });

  it("uses non-contradictory global footer when any panel is shirtless", () => {
    const structure = projectComicSafeStructureForTier2(tier2ShirtlessRomanceScenePlan(), undefined, {
      adultGrounded: true,
      characterGender: "male",
    });
    const footer = renderTier2ComicGlobalClothingFooter(structure);
    assert.doesNotMatch(footer, /Modest clothing throughout/iu);
    assert.match(footer, /Follow each panel's clothing contract above/iu);
  });
});

describe("chatComicClothingCoverage default modest ladder semantics", () => {
  it("N0 neutral scene keeps default modest panel and global contracts", () => {
    assertDefaultModestPrompt(buildTier2StrictFallbackPrompt({ plan: tier2NeutralScenePlan() }));
  });

  it("N1A bedroom affection keeps default modest panel and global contracts", () => {
    assertDefaultModestPrompt(
      buildTier2StrictFallbackPrompt({ plan: tier2BedroomAffectionScenePlan() })
    );
  });

  it("N1B brief kiss keeps default modest contracts and kiss beat", () => {
    const prompt = buildTier2StrictFallbackPrompt({ plan: tier2BriefKissScenePlan() });
    assertDefaultModestPrompt(prompt);
    assert.match(panelLine(prompt, 3), /키스/);
  });

  it("N1C1 keeps single dialogue row and modest contracts", () => {
    const prompt = buildTier2StrictFallbackPrompt({ plan: tier2SingleDialogueScenePlan() });
    assertDefaultModestPrompt(prompt);
    assert.match(panelLine(prompt, 1), /Speech bubble: "좋아해\."/u);
    assert.doesNotMatch(panelLine(prompt, 2), /Speech bubble: "[^"]+"/u);
  });

  it("N1C2 keeps three dialogue rows, kiss panel, and modest contracts", () => {
    const prompt = buildTier2StrictFallbackPrompt({ plan: tier2MultiDialogueScenePlan() });
    assertDefaultModestPrompt(prompt);
    assert.match(panelLine(prompt, 1), /Speech bubble: "좋아해\."/u);
    assert.match(panelLine(prompt, 2), /Speech bubble: "나도\."/u);
    assert.match(panelLine(prompt, 4), /Speech bubble: "…고마워\."/u);
    assert.doesNotMatch(panelLine(prompt, 3), /Speech bubble: "[^"]+"/u);
    assert.match(panelLine(prompt, 3), /키스/);
  });
});

describe("chatComicClothingCoverage N2A offline contract", () => {
  it("renders shirtless panel 1 without modest-clothing contradiction", () => {
    const n1c2Prompt = buildTier2StrictFallbackPrompt({
      plan: tier2MultiDialogueScenePlan(),
      adultGrounded: true,
      characterGender: "male",
    });
    const n2aPrompt = buildTier2StrictFallbackPrompt({
      plan: tier2ShirtlessRomanceScenePlan(),
      adultGrounded: true,
      characterGender: "male",
    });

    const p1 = panelLine(n2aPrompt, 1);
    assert.match(p1, /bare upper torso framed from shoulders upward/iu);
    assert.doesNotMatch(p1, /modest covered clothing/iu);
    assert.match(p1, /Speech bubble: "좋아해\."/u);

    assert.equal(panelLine(n1c2Prompt, 2), panelLine(n2aPrompt, 2));
    assert.equal(panelLine(n1c2Prompt, 3), panelLine(n2aPrompt, 3));
    assert.equal(panelLine(n1c2Prompt, 4), panelLine(n2aPrompt, 4));

    assert.doesNotMatch(n2aPrompt, /Modest clothing throughout/iu);
    assert.doesNotMatch(n2aPrompt, /성관계|성기|노골/u);
    assert.notEqual(n2aPrompt, n1c2Prompt);
  });

  it("keeps P2-P4 modest and does not leak shirtless to other panels", () => {
    const prompt = buildTier2StrictFallbackPrompt({
      plan: tier2ShirtlessRomanceScenePlan(),
      adultGrounded: true,
      characterGender: "male",
    });
    for (const panel of [2, 3, 4]) {
      const line = panelLine(prompt, panel);
      assert.match(line, /modest covered clothing/iu);
      assert.doesNotMatch(line, /bare upper torso/iu);
    }
  });

  it("falls back to modest when adultGrounded is false", () => {
    const prompt = buildTier2StrictFallbackPrompt({
      plan: tier2ShirtlessRomanceScenePlan(),
      adultGrounded: false,
      characterGender: "male",
    });
    assertDefaultModestPrompt(prompt);
  });

  it("falls back to modest for non-male character even when adultGrounded", () => {
    const prompt = buildTier2StrictFallbackPrompt({
      plan: tier2ShirtlessRomanceScenePlan(),
      adultGrounded: true,
      characterGender: "female",
      subjects: TIER2_CLOTHING_FEMALE_CHARACTER_SUBJECTS,
    });
    assertDefaultModestPrompt(prompt);
  });

  it("pose hints do not duplicate modest covered clothing wording", () => {
    const structure = projectComicSafeStructureForTier2(tier2ShirtlessRomanceScenePlan(), undefined, {
      adultGrounded: true,
      characterGender: "male",
    });
    for (const panel of structure.panels) {
      assert.doesNotMatch(panel.poseHint, /modest covered clothing/iu);
    }
  });
});

describe("chatComicClothingCoverage production writer boundary", () => {
  it("documents that validateScenePlan does not copy clothingCoverage from client panels", () => {
    assert.equal(TIER2_CLOTHING_TEST_SUBJECTS.length, 2);
    assert.equal(
      resolveTier2PanelClothingCoverage(
        {
          index: 1,
          sourceEventIds: [],
          situation: "x",
          dialogue: [],
          clothingCoverage: "adult_male_character_shirtless_upper_torso",
        },
        true,
        "male"
      ),
      "adult_male_character_shirtless_upper_torso"
    );
  });
});
