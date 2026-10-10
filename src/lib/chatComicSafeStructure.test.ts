import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
} from "./chatImageStrictSafetyFallbackPrompt";
import {
  containsBedroomBedStructure,
  projectComicSafeStructureForTier2,
  renderComicSafeStructureForTier2Prompt,
} from "./chatComicSafeStructure";
import type { ScenePlan } from "./chatImageScenePlan";

const SCENE_SHARED_LOCATION_RE = /Preserve safe location continuity:/u;
const PANEL_LEVEL_LOCATION_RE = /Panel \d+[^\n]*\blocation /u;
const BEDROOM_BED_RE = /(?:bedroom|bed|침실|침대|이불)/iu;

const duoSubjects = [
  {
    key: "character",
    name: "A",
    gender: "female" as const,
    role: "character" as const,
    referenceImageUrl: "/c.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
  },
  {
    key: "persona",
    name: "B",
    gender: "male" as const,
    role: "persona" as const,
    referenceImageUrl: "/p.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
  },
];

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

/** Sanitized REAL_FAIL-shaped bedroom intimacy arc — no raw RP or real identities. */
function realFailLikeBedroomPlan(): ScenePlan {
  return {
    sceneBackground: "프라이빗 침실",
    atmosphere: "은은하고 애틋한 분위기",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "침실 침대에서 가까이 마주보는 두 성인",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "침실 침대 가장자리",
        characterAction: "상의를 벗어 어깨가 드러난 채 앉아 있다",
        personaAction: "수줍게 가까이 다가와 볼에 손을 대며 홍조를 띤다",
        dialogue: [{ speaker: "persona", text: "…괜찮아?", provenance: "source" }],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "침대 위에서 가까이 마주본다",
        dialogue: [{ speaker: "persona", text: "…따뜻해.", provenance: "source" }],
      },
      {
        index: 3,
        sourceEventIds: [],
        situation: "침대에서 껴안고 이마를 맞댄다",
        dialogue: [{ speaker: "persona", text: "…고마워.", provenance: "source" }],
      },
      {
        index: 4,
        sourceEventIds: [],
        situation: "침대에서 몸을 맞대고 조용히 숨을 고른다",
        dialogue: [{ speaker: "persona", text: "…응.", provenance: "source" }],
      },
    ],
    recommendedPanelCount: 4,
  };
}

function extractPanelBlock(prompt: string, panelIndex: number): string {
  const re = new RegExp(
    `Panel ${panelIndex}[\\s\\S]*?(?=\\nPanel ${panelIndex + 1} |\\nExactly two recurring|$)`,
    "u"
  );
  return prompt.match(re)?.[0]?.trim() ?? "";
}

function providerBoundPanelHaystack(prompt: string, panelCount: number): string {
  return Array.from({ length: panelCount }, (_, index) =>
    extractPanelBlock(prompt, index + 1)
  ).join("\n");
}

function buildTier2FullProviderPrompt(
  structure: ReturnType<typeof projectComicSafeStructureForTier2>,
  panelCount: number
) {
  return buildStrictComicFallbackPrompt({
    panelCount: panelCount as 2 | 3 | 4,
    characterName: "A",
    characterGender: "female",
    personaName: "B",
    personaGender: "male",
    subjects: duoSubjects,
    safeStructure: structure,
    compositionMode: "full_provider_rendered",
  });
}

/** Test-only simulation of the removed scene-level serializer (revert sensitivity). */
function injectLegacySceneSharedLocationLine(prompt: string, sharedBackground: string): string {
  const marker =
    "STRICT PROVIDER-SAFE FALLBACK — preserve the same safe location, cast, and emotional beat with general-audience visual depiction.";
  return prompt.replace(
    marker,
    `${marker}\nPreserve safe location continuity: ${sharedBackground}.`
  );
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
      subjects: duoSubjects,
      safeStructure: structure,
    });
    assert.doesNotMatch(prompt, SCENE_SHARED_LOCATION_RE);
    assert.match(prompt, BEDROOM_BED_RE);
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
      subjects: duoSubjects,
      safeStructure: structure,
    });
    assert.doesNotMatch(prompt, /TIER2_RAW_SECRET/);
    assert.doesNotMatch(prompt, /성관계/);
    assert.doesNotMatch(prompt, /손목을긋/);
    assert.doesNotMatch(prompt, /피를흘/);
  });
});

describe("chatComicSafeStructure strict Tier-2 shared location ownership", () => {
  it("STRICT_TIER2_SINGLE_LOCATION_OWNER — no scene-level line; panel location retained (revert-sensitive)", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeBedroomPlan());
    const prompt = buildTier2FullProviderPrompt(structure, 4);

    assert.doesNotMatch(prompt, SCENE_SHARED_LOCATION_RE);
    assert.match(prompt, /location 프라이빗 침실/iu);
    for (const panelIndex of [1, 2, 3, 4]) {
      assert.match(extractPanelBlock(prompt, panelIndex), /location /u);
    }

    const simulatedPrePatch = injectLegacySceneSharedLocationLine(
      prompt,
      structure.sharedBackground
    );
    assert.match(simulatedPrePatch, SCENE_SHARED_LOCATION_RE);
    for (const panelIndex of [1, 2, 3, 4]) {
      assert.equal(
        extractPanelBlock(prompt, panelIndex),
        extractPanelBlock(simulatedPrePatch, panelIndex),
        `panel ${panelIndex} must differ only by removed scene-level shared location line`
      );
    }
  });

  it("BEDROOM_FIDELITY — REAL_FAIL-shaped provider-bound panel blocks retain bedroom and bed", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeBedroomPlan());
    const prompt = buildTier2FullProviderPrompt(structure, 4);
    const panelHaystack = providerBoundPanelHaystack(prompt, 4);

    assert.match(panelHaystack, /침실|bedroom/iu, "BEDROOM must appear in provider-bound panel blocks");
    assert.match(panelHaystack, /침대|bed/iu, "BED must appear in provider-bound panel blocks");
    assert.doesNotMatch(panelHaystack, SCENE_SHARED_LOCATION_RE);
  });

  it("NORMAL_NON_INTIMATE_LOCATION — lobby scene keeps panel-level location without scene-level duplicate", () => {
    const plan: ScenePlan = {
      sceneBackground: "ACB 중앙 로비",
      atmosphere: "분주한 오후",
      events: [],
      castMentions: [],
      heroEventIds: [],
      heroScene: "로비",
      panels: [
        {
          index: 1,
          sourceEventIds: [],
          situation: "데스크 앞",
          dialogue: [{ speaker: "character", text: "억울하다니까?", provenance: "source" }],
        },
        {
          index: 2,
          sourceEventIds: [],
          situation: "로비 통로",
          dialogue: [],
        },
      ],
      recommendedPanelCount: 2,
    };
    const structure = projectComicSafeStructureForTier2(plan);
    const prompt = buildTier2FullProviderPrompt(structure, 2);

    assert.doesNotMatch(prompt, SCENE_SHARED_LOCATION_RE);
    assert.match(prompt, /location ACB 중앙 로비/iu);
  });

  it("strict comic fallback panel renderer excludes Safe shared location header", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeBedroomPlan());
    const rendered = renderComicSafeStructureForTier2Prompt(structure, "full_provider_rendered");
    assert.ok(rendered.some((line) => line.startsWith("Safe shared location:")));
    const prompt = buildTier2FullProviderPrompt(structure, 4);
    for (const line of rendered.filter((entry) => entry.startsWith("Panel "))) {
      assert.match(prompt, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(prompt, /Safe shared location:/iu);
  });

  it("PRIMARY_INVARIANCE — overlay_first without safeStructure never used scene-level shared location serializer", () => {
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
    });
    assert.match(prompt, /VISUAL LAYER ONLY/);
    assert.doesNotMatch(prompt, SCENE_SHARED_LOCATION_RE);
    assert.match(prompt, /Panel 1 — establishing:/u);
    assert.doesNotMatch(prompt, PANEL_LEVEL_LOCATION_RE);
    assert.match(
      prompt,
      /Preserve cast identity, location continuity, and emotional tone/u
    );
  });
});
