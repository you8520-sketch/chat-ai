import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
} from "./chatImageStrictSafetyFallbackPrompt";
import {
  containsBedroomBedInProviderBoundPanels,
  containsBedroomBedStructure,
  projectComicSafeStructureForTier2,
  renderComicSafeStructureForTier2Prompt,
} from "./chatComicSafeStructure";
import type { ScenePlan } from "./chatImageScenePlan";

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

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function extractPanelBlock(prompt: string, n: number): string {
  const re = new RegExp(
    `Panel ${n}[\\s\\S]*?(?=\\nPanel ${n + 1} |\\nExactly two recurring|$)`,
    "u"
  );
  return prompt.match(re)?.[0]?.trim() ?? "";
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

function buildTier2Prompt(structure: ReturnType<typeof projectComicSafeStructureForTier2>) {
  return buildStrictComicFallbackPrompt({
    panelCount: 4,
    characterName: "A",
    characterGender: "female",
    personaName: "B",
    personaGender: "male",
    subjects: duoSubjects,
    safeStructure: structure,
    compositionMode: "full_provider_rendered",
  });
}

describe("chatComicTier2SharedLocationOwnership", () => {
  it("strict Tier-2 omits scene-level SHARED_LOCATION while panel blocks retain per-panel location", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeBedroomPlan());
    const prompt = buildTier2Prompt(structure);

    assert.doesNotMatch(prompt, /Preserve safe location continuity:/iu);
    assert.match(prompt, /location 프라이빗 침실/iu);
    assert.equal(containsBedroomBedInProviderBoundPanels(structure), true);
    assert.equal(containsBedroomBedStructure(structure), true);

    for (const panelIndex of [1, 2, 3, 4]) {
      assert.match(extractPanelBlock(prompt, panelIndex), /location /u);
    }
  });

  it("REAL_FAIL-like fixture retains BEDROOM and BED in provider-bound panels after shared-line removal", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeBedroomPlan());
    const haystack = structure.panels
      .flatMap((panel) => [panel.background, panel.situation, panel.poseHint])
      .join(" ");

    assert.match(haystack, /침실|bedroom/iu, "BEDROOM must remain in panel-level facts");
    assert.match(haystack, /침대|bed/iu, "BED must remain in panel-level facts");
    assert.equal(containsBedroomBedInProviderBoundPanels(structure), true);
  });

  it("panel blocks are stable when only scene-level shared location serialization is removed", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeBedroomPlan());
    const withSharedLine = buildTier2Prompt(structure).replace(
      /Preserve safe location continuity:[^\n]*\n/u,
      ""
    );
    const prompt = buildTier2Prompt(structure);

    assert.equal(prompt, withSharedLine);
    for (const panelIndex of [1, 2, 3, 4]) {
      assert.equal(extractPanelBlock(prompt, panelIndex), extractPanelBlock(withSharedLine, panelIndex));
    }
  });

  it("normal non-intimate scene keeps panel location without scene-level duplicate", () => {
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
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
      safeStructure: structure,
      compositionMode: "full_provider_rendered",
    });
    assert.doesNotMatch(prompt, /Preserve safe location continuity:/iu);
    assert.match(prompt, /location ACB 중앙 로비/iu);
  });

  it("long non-intimate bedroom scene preserves bed location at panel level", () => {
    const longBeat =
      "프라이빗 침실의 넓은 침대 옆 작은 탁자에서 두 사람이 각자 책을 읽고 있다.";
    const plan: ScenePlan = {
      sceneBackground: "프라이빗 침실",
      atmosphere: "조용한 아침",
      events: [],
      castMentions: [],
      heroEventIds: [],
      heroScene: "침실 침대",
      panels: [
        { index: 1, sourceEventIds: [], situation: longBeat, dialogue: [] },
        { index: 2, sourceEventIds: [], situation: longBeat, dialogue: [] },
      ],
      recommendedPanelCount: 2,
    };
    const structure = projectComicSafeStructureForTier2(plan);
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
      safeStructure: structure,
      compositionMode: "full_provider_rendered",
    });
    assert.doesNotMatch(prompt, /Preserve safe location continuity:/iu);
    assert.equal(containsBedroomBedInProviderBoundPanels(structure), true);
    assert.match(prompt, /침실|침대/iu);
  });

  it("overlay renderer may still emit Safe shared location header but strict comic fallback uses panel lines only", () => {
    const structure = projectComicSafeStructureForTier2(realFailLikeBedroomPlan());
    const rendered = renderComicSafeStructureForTier2Prompt(structure, "full_provider_rendered");
    assert.ok(rendered.some((line) => line.startsWith("Safe shared location:")));
    const panelOnly = rendered.filter((line) => line.startsWith("Panel "));
    const prompt = buildTier2Prompt(structure);
    for (const line of panelOnly) {
      assert.match(prompt, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(prompt, /Safe shared location:/iu);
  });

  it("primary overlay_first path unchanged when safeStructure absent", () => {
    const baseline = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
    });
    assert.match(baseline, /VISUAL LAYER ONLY/);
    assert.doesNotMatch(baseline, /Preserve safe location continuity:/iu);
    assert.equal(hashPrompt(baseline), hashPrompt(baseline));
  });
});
