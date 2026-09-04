import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
} from "./chatImageStrictSafetyFallbackPrompt";
import {
  containsBedroomBedStructure,
  projectComicSafeStructureForTier2,
} from "./chatComicSafeStructure";
import type { ScenePlan } from "./chatImageScenePlan";

function bedroomPlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    atmosphere: "은은한 조명",
    events: [
      {
        id: "e1",
        order: 1,
        sourceMessageId: 1,
        sourceRole: "assistant",
        kind: "environment",
        actor: "environment",
        text: "넓은 침실과 푹신한 침대",
        segmentKind: "narration",
      },
      {
        id: "e2",
        order: 2,
        sourceMessageId: 1,
        sourceRole: "assistant",
        kind: "action",
        actor: "character",
        text: "캐릭터가 침대에 누워 이불을 끌어올린다",
        segmentKind: "narration",
      },
    ],
    castMentions: [],
    heroEventIds: ["e1", "e2"],
    heroScene: "침실 침대",
    panels: [
      {
        index: 1,
        sourceEventIds: ["e1"],
        situation: "침실 침대",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: ["e2"],
        situation: "침대에 누운 자세",
        dialogue: [{ speaker: "character", text: "…조용히.", provenance: "source" }],
      },
    ],
    dialogues: [],
  };
}

describe("chatComicSafeStructure Tier-2 fidelity", () => {
  it("V1 bedroom/bed/lying source preserves safe structural facts", () => {
    const structure = projectComicSafeStructureForTier2(bedroomPlan());
    assert.equal(containsBedroomBedStructure(structure), true);
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
      safeStructure: structure,
    });
    assert.match(prompt, /침실|침대|bedroom|bed/iu);
    assert.match(prompt, /누|lying/iu);
    assert.doesNotMatch(prompt, /generic conservatory|random sofa|식물원/iu);
    assert.doesNotMatch(prompt, /성관계|노골/u);
  });

  it("does not include raw explicit source text in Tier-2 structure prompt", () => {
    const explicitPlan: ScenePlan = {
      ...bedroomPlan(),
      events: [
        {
          id: "x1",
          order: 1,
          sourceMessageId: 1,
          sourceRole: "assistant",
          kind: "action",
          actor: "character",
          text: "TIER2_RAW_SECRET_성관계_손목을긋고_피를흘린다",
          segmentKind: "narration",
        },
      ],
      panels: [
        {
          index: 1,
          sourceEventIds: ["x1"],
          situation: "TIER2_RAW_SECRET_성관계",
          dialogue: [],
        },
        {
          index: 2,
          sourceEventIds: ["x1"],
          situation: "aftermath",
          dialogue: [],
        },
      ],
    };
    const structure = projectComicSafeStructureForTier2(explicitPlan);
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
      safeStructure: structure,
    });
    assert.doesNotMatch(prompt, /TIER2_RAW_SECRET/);
    assert.doesNotMatch(prompt, /성관계/);
    assert.doesNotMatch(prompt, /손목을긋/);
    assert.doesNotMatch(prompt, /피를흘/);
  });
});
