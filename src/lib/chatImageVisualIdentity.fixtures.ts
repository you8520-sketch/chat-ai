import {
  bindChatImageReferencePack,
  buildPartyIllustrationReferencePlan,
  describeReferenceOrder,
  renderChatImageSubjectManifest,
  renderChatImageVisualIdentity,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildChatLdIllustrationPrompt } from "@/lib/chatLdIllustrationGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";

export const SYNTHETIC_CHARACTER_A_APPEARANCE = [
  "black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5",
  "black pupils, red irises",
  "large healed scar on the back of the neck",
  "white shirt, black harness",
].join("\n");

export const SYNTHETIC_CHARACTER_B_APPEARANCE = [
  "blue-black hair, center-parted hair",
  "dark gray irises",
  "black suit",
].join("\n");

export const SYNTHETIC_PERSONA_APPEARANCE = [
  "short brown hair, glasses",
  "hazel eyes",
  "cream knit sweater",
].join("\n");

export const EXACT_USER_PERSONA_APPEARANCE =
  "짧은 검은머리 검은눈동자 붉은 동공 흰셔츠 위에 가죽재질 전투 하네스 검은바지 가르마 없음 full bangs";

/** Persona eye contract used by Scene Builder / comic identity regression. */
export const EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE =
  `${EXACT_USER_PERSONA_APPEARANCE} 세로 슬릿 동공`;

export const SCENE_BUILDER_SHARED_DUO = {
  characterName: "CharacterA",
  characterGender: "male" as const,
  personaName: "UserPersona",
  personaGender: "female" as const,
  characterImageUrl: "/synthetic/character-a-primary.webp",
  characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
  characterAppearanceMode: "image_plus_saved" as const,
  personaImageUrl: "/synthetic/user-persona-primary.webp",
  personaSavedAppearance: EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
  personaAppearanceMode: "image_plus_saved" as const,
};

const SHARED_SCENE_SOURCE = buildSceneSourceMessages([
  { id: 1, role: "user", content: '*후드 귀를 만진다*\n"같이 갈래?"' },
  {
    id: 2,
    role: "assistant",
    content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."',
  },
]);

export function syntheticComicPlan(panelCount: 2 | 3 | 4 = 3) {
  return buildChatComicGenerationPlan({
    ...SCENE_BUILDER_SHARED_DUO,
    plan: buildDeterministicScenePlan(SHARED_SCENE_SOURCE, panelCount),
  });
}

export const SYNTHETIC_PRIVATE_CHARACTER_PROMPT = [
  "[성격] 비밀을 절대 말하지 않는다.",
  "[세계관] 왕국 음모.",
  "[외형] 검은 머리, 비대칭 앞머리, 검은 동공과 붉은 홍채, 흰 셔츠, 검은 하네스.",
  "[관계] 사용자를 시험한다.",
].join("\n");

export const SYNTHETIC_PRIVATE_PERSONA_DESCRIPTION = [
  "차분한 성격이다.",
  "외형: 짧은 갈색 머리, 안경, 헤이즐 눈, 크림색 니트.",
  "비밀 메모: 절대 외부에 알리지 말 것.",
].join("\n");

export function syntheticLdDuoPlan() {
  const pack = bindChatImageReferencePack({
    subjectsInImageOrder: [
      {
        key: "character",
        role: "chat character",
        name: "CharacterA",
        gender: "male",
        referenceIndex: null,
        referenceImageUrl: "/synthetic/character-a-primary.webp",
        appearanceMode: "image_plus_saved",
        savedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
        sourceKind: "main_character",
      },
      {
        key: "persona",
        role: "user persona",
        name: "CharacterB",
        gender: "female",
        referenceIndex: null,
        referenceImageUrl: "/synthetic/character-b-primary.webp",
        appearanceMode: "image_plus_saved",
        savedAppearance: SYNTHETIC_CHARACTER_B_APPEARANCE,
        sourceKind: "persona",
      },
    ] satisfies ChatImageVisualSubject[],
  });
  return {
    ...pack,
    prompt: buildChatLdIllustrationPrompt({
      characterName: "CharacterA",
      characterGender: "male",
      personaName: "CharacterB",
      personaGender: "female",
      currentTurn: "Setting: cafe\nActions: CharacterB hands CharacterA a cup.",
      subjects: pack.subjects,
    }),
  };
}

export function syntheticLdPartyCast() {
  const members = [
    {
      name: "CharacterA",
      gender: "male" as const,
      role: "companion character",
      referenceIndex: 1,
      appearanceNote: SYNTHETIC_CHARACTER_A_APPEARANCE,
      appearanceMode: "image_plus_saved" as const,
      imageUrl: "/synthetic/character-a-primary.webp",
      isPrimaryImage: true,
    },
    {
      name: "CharacterB",
      gender: "female" as const,
      role: "player",
      referenceIndex: 2,
      appearanceNote: SYNTHETIC_CHARACTER_B_APPEARANCE,
      appearanceMode: "image_plus_saved" as const,
      imageUrl: "/synthetic/character-b-primary.webp",
      isPrimaryImage: true,
    },
    {
      name: "CharacterC",
      gender: "other" as const,
      role: "companion character",
      referenceIndex: 3,
      appearanceNote: "this should not appear when image_only",
      appearanceMode: "image_only" as const,
      imageUrl: "/synthetic/character-c-alt.webp",
      isPrimaryImage: false,
    },
    {
      name: "CharacterD",
      gender: "male" as const,
      role: "player",
      referenceIndex: null,
      appearanceNote: "short black hair, glasses",
      appearanceMode: "image_plus_saved" as const,
      imageUrl: null,
      isPrimaryImage: true,
    },
  ];
  const plan = buildPartyIllustrationReferencePlan(members);
  return {
    members,
    subjects: plan.subjects,
    referenceUrls: plan.referenceUrls,
    canGenerate: plan.canGenerate,
    hiddenIdentityFallback: plan.hiddenIdentityFallback,
    prompt: buildChatLdIllustrationPrompt({
      characterName: "IgnoredMain",
      characterGender: "female",
      personaName: "IgnoredPersona",
      personaGender: "male",
      currentTurn: "The party stands at a ruined gate.",
      situation: "LOCATION: ruined gate\nGM SCENE: The party stands at a ruined gate.",
      cast: members,
      subjects: plan.subjects,
    }),
    identity: renderChatImageVisualIdentity({
      subjects: plan.subjects,
      hasTemplate: false,
    }),
  };
}

export function syntheticNoPhotoSavedSubject() {
  const subject: ChatImageVisualSubject = {
    key: "cast-1",
    role: "companion character",
    name: "CharacterA",
    gender: "male",
    referenceIndex: null,
    referenceImageUrl: null,
    appearanceMode: "image_plus_saved",
    savedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    sourceKind: "cast_member",
  };
  return {
    subject,
    prompt: renderChatImageSubjectManifest(subject, 0),
    referenceUrls: [],
  };
}

export function syntheticNoPhotoNoSavedSubject() {
  const subject: ChatImageVisualSubject = {
    key: "cast-1",
    role: "player",
    name: "CharacterE",
    gender: "other",
    referenceIndex: null,
    referenceImageUrl: null,
    appearanceMode: "image_only",
    savedAppearance: "",
    sourceKind: "cast_member",
  };
  return {
    subject,
    prompt: renderChatImageSubjectManifest(subject, 0),
    referenceUrls: [],
  };
}

export function syntheticLdPartyMixedVisualStates() {
  const members = [
    {
      name: "CharacterA",
      gender: "male" as const,
      role: "companion character",
      referenceIndex: 1,
      appearanceNote: SYNTHETIC_CHARACTER_A_APPEARANCE,
      appearanceMode: "image_plus_saved" as const,
      imageUrl: "/synthetic/character-a-primary.webp",
      isPrimaryImage: true,
    },
    {
      name: "CharacterC",
      gender: "other" as const,
      role: "companion character",
      referenceIndex: 2,
      appearanceNote: SYNTHETIC_CHARACTER_A_APPEARANCE,
      appearanceMode: "image_only" as const,
      imageUrl: "/synthetic/character-c-alt.webp",
      isPrimaryImage: false,
    },
    {
      name: "CharacterD",
      gender: "male" as const,
      role: "player",
      referenceIndex: null,
      appearanceNote: "short black hair, glasses",
      appearanceMode: "image_plus_saved" as const,
      imageUrl: null,
      isPrimaryImage: true,
    },
    {
      name: "CharacterE",
      gender: "female" as const,
      role: "player",
      referenceIndex: null,
      appearanceNote: "",
      appearanceMode: "image_only" as const,
      imageUrl: null,
      isPrimaryImage: true,
    },
  ];
  const plan = buildPartyIllustrationReferencePlan(members);
  return {
    members,
    ...plan,
    prompt: buildChatLdIllustrationPrompt({
      characterName: "IgnoredMain",
      characterGender: "female",
      personaName: "IgnoredPersona",
      personaGender: "male",
      currentTurn: "The party waits in the dark.",
      situation: "LOCATION: dark hall\nGM SCENE: The party waits in the dark.",
      cast: members,
      subjects: plan.subjects,
    }),
  };
}

export function syntheticLdPartyAllReferencesAbsent() {
  const members = [
    {
      name: "CharacterA",
      gender: "male" as const,
      role: "companion character",
      referenceIndex: null,
      appearanceNote: SYNTHETIC_CHARACTER_A_APPEARANCE,
      appearanceMode: "image_plus_saved" as const,
      imageUrl: null,
      isPrimaryImage: true,
    },
    {
      name: "CharacterB",
      gender: "female" as const,
      role: "player",
      referenceIndex: null,
      appearanceNote: "",
      appearanceMode: "image_only" as const,
      imageUrl: null,
      isPrimaryImage: true,
    },
  ];
  const plan = buildPartyIllustrationReferencePlan(members);
  return {
    members,
    contextFallbackUrls: [
      "/synthetic/chat-main-character.webp",
      "/synthetic/user-persona.webp",
    ],
    referenceOrder: describeReferenceOrder(plan),
    ...plan,
    prompt: buildChatLdIllustrationPrompt({
      characterName: "IgnoredMain",
      characterGender: "female",
      personaName: "IgnoredPersona",
      personaGender: "male",
      currentTurn: "No one brought a photo.",
      situation: "LOCATION: camp\nGM SCENE: No one brought a photo.",
      cast: members,
      subjects: plan.subjects,
    }),
  };
}
