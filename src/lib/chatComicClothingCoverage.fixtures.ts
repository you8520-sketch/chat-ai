import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import { projectComicSafeStructureForTier2 } from "@/lib/chatComicSafeStructure";
import { buildStrictComicFallbackPrompt } from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  resolveScenePresentationVisibility,
  type SceneDialogue,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

export const TIER2_CLOTHING_TEST_SUBJECTS: readonly ChatImageVisualSubject[] = [
  {
    key: "character",
    name: "라이크",
    gender: "male",
    role: "character",
    referenceIndex: 2,
    referenceImageUrl: "/c.webp",
    savedAppearance: "",
    appearanceMode: "image_only",
    sourceKind: "main_character",
  },
  {
    key: "persona",
    name: "렌",
    gender: "male",
    role: "persona",
    referenceIndex: 3,
    referenceImageUrl: "/p.webp",
    savedAppearance: "",
    appearanceMode: "image_only",
    sourceKind: "persona",
  },
];

export const TIER2_CLOTHING_FEMALE_CHARACTER_SUBJECTS: readonly ChatImageVisualSubject[] = [
  {
    ...TIER2_CLOTHING_TEST_SUBJECTS[0]!,
    name: "솔",
    gender: "female",
  },
  TIER2_CLOTHING_TEST_SUBJECTS[1]!,
];

const N1C1_DIALOGUE: SceneDialogue = {
  speaker: "character",
  text: "좋아해.",
  provenance: "source",
};

function n1aBase(): ScenePlan {
  return {
    sceneBackground: "사적인 침실",
    atmosphere: "부드럽고 따뜻한 분위기, 은은한 조명, 따뜻한 표정과 은은한 홍조",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "침실 침대 옆에 함께 있는 두 성인",
    panels: [
      { index: 1, sourceEventIds: [], situation: "침실 침대 옆에 나란히 앉아 있다", dialogue: [] },
      { index: 2, sourceEventIds: [], situation: "침대에 기대어 편안히 쉬고 있다", dialogue: [] },
      { index: 3, sourceEventIds: [], situation: "침실에서 따뜻한 표정으로 가까이 앉아 있다", dialogue: [] },
      { index: 4, sourceEventIds: [], situation: "부드러운 이불과 함께 차분히 휴식한다", dialogue: [] },
    ],
    recommendedPanelCount: 4,
  };
}

export function tier2NeutralScenePlan(): ScenePlan {
  return {
    sceneBackground: "조용한 카페",
    atmosphere: "편안한 오후",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "카페 테이블",
    panels: [
      { index: 1, sourceEventIds: [], situation: "카페 테이블에 마주 앉아 있다", dialogue: [] },
      { index: 2, sourceEventIds: [], situation: "대화하며 미소 짓는다", dialogue: [] },
      { index: 3, sourceEventIds: [], situation: "잔을 들어 올린다", dialogue: [] },
      { index: 4, sourceEventIds: [], situation: "창밖을 바라본다", dialogue: [] },
    ],
    recommendedPanelCount: 4,
  };
}

export function tier2BedroomAffectionScenePlan(): ScenePlan {
  return n1aBase();
}

export function tier2BriefKissScenePlan(): ScenePlan {
  const base = n1aBase();
  return {
    ...base,
    panels: base.panels.map((panel) =>
      panel.index === 3
        ? { ...panel, situation: "침실에서 따뜻한 표정으로 가까이 앉아 뺨에 짧게 키스한다" }
        : panel
    ),
  };
}

export function tier2SingleDialogueScenePlan(): ScenePlan {
  const base = tier2BriefKissScenePlan();
  return {
    ...base,
    panels: base.panels.map((panel) =>
      panel.index === 1 ? { ...panel, dialogue: [N1C1_DIALOGUE] } : panel
    ),
  };
}

export function tier2MultiDialogueScenePlan(): ScenePlan {
  const base = tier2SingleDialogueScenePlan();
  return {
    ...base,
    panels: base.panels.map((panel) => {
      if (panel.index === 2) {
        return {
          ...panel,
          dialogue: [{ speaker: "persona", text: "나도.", provenance: "source" }],
        };
      }
      if (panel.index === 4) {
        return {
          ...panel,
          dialogue: [{ speaker: "persona", text: "…고마워.", provenance: "source" }],
        };
      }
      return panel;
    }),
  };
}

export function tier2ShirtlessRomanceScenePlan(): ScenePlan {
  const base = tier2MultiDialogueScenePlan();
  return {
    ...base,
    panels: base.panels.map((panel) =>
      panel.index === 1
        ? { ...panel, clothingCoverage: "adult_male_character_shirtless_upper_torso" }
        : panel
    ),
  };
}

export function panelLine(prompt: string, panel: number): string {
  const re = new RegExp(
    `Panel ${panel}[\\s\\S]*?(?=\\nPanel ${panel + 1} |\\nExactly two recurring|$)`,
    "u"
  );
  return (prompt.match(re)?.[0] ?? "").trim();
}

export function buildTier2StrictFallbackPrompt(opts: {
  plan: ScenePlan;
  adultGrounded?: boolean;
  characterGender?: ImagePromptGender;
  personaGender?: ImagePromptGender;
  subjects?: readonly ChatImageVisualSubject[];
}): string {
  const subjects = opts.subjects ?? TIER2_CLOTHING_TEST_SUBJECTS;
  const characterGender = opts.characterGender ?? subjects[0]?.gender ?? "male";
  const personaGender = opts.personaGender ?? subjects[1]?.gender ?? "male";
  const safeStructure = projectComicSafeStructureForTier2(
    opts.plan,
    resolveScenePresentationVisibility({ contentKind: "character", castManifest: null }),
    {
      adultGrounded: opts.adultGrounded ?? false,
      characterGender,
    }
  );
  return buildStrictComicFallbackPrompt({
    panelCount: 4,
    mood: "comic",
    characterName: subjects[0]?.name ?? "A",
    characterGender,
    personaName: subjects[1]?.name ?? "B",
    personaGender,
    subjects,
    safeStructure,
    compositionMode: "full_provider_rendered",
  });
}
