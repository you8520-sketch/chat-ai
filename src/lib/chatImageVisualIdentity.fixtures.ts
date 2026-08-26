import { buildCoupleStampGenerationPlan } from "@/lib/chatCoupleStampGeneration";
import { buildEmoticonGenerationPlan } from "@/lib/chatEmoticonGeneration";
import { buildGiftBoxGenerationPlan } from "@/lib/chatImageGeneration";
import {
  bindChatImageReferencePack,
  buildPartyIllustrationReferencePlan,
  describeReferenceOrder,
  renderChatImageSubjectManifest,
  renderChatImageVisualIdentity,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import { buildChatLdIllustrationPrompt } from "@/lib/chatLdIllustrationGeneration";

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

const FIXED_EMOTICON_SCENES = [
  { text: "사랑해", subject: "character" as const, action: "holding a big heart" },
  { text: "보고 싶어", subject: "character" as const, action: "hugging a pillow" },
  { text: "헉!", subject: "character" as const, action: "wide-eyed surprise" },
  { text: "고마워", subject: "persona" as const, action: "grateful smile" },
  { text: "잘 자", subject: "persona" as const, action: "sleepy blanket" },
  { text: "미안해", subject: "persona" as const, action: "apologetic face" },
  { text: "안녕!", subject: "duo" as const, action: "both waving" },
  { text: "화이팅!", subject: "duo" as const, action: "raised fists" },
  { text: "꼬옥", subject: "duo" as const, action: "warm hug" },
] as const;

export function syntheticDuoGiftPrimary() {
  return buildGiftBoxGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    characterImageUrl: "/synthetic/character-a-primary.webp",
    characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    characterAppearanceMode: "image_plus_saved",
    personaName: "CharacterB",
    personaGender: "female",
    personaImageUrl: "/synthetic/character-b-primary.webp",
    personaSavedAppearance: SYNTHETIC_CHARACTER_B_APPEARANCE,
    personaAppearanceMode: "image_plus_saved",
    placement: "character_top",
    topExpression: "playful",
    bottomExpression: "calm",
    mood: "lovely",
  });
}

export function syntheticDuoGiftAlternateImageOnly() {
  return buildGiftBoxGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    characterImageUrl: "/synthetic/character-a-alternate.webp",
    characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    characterAppearanceMode: "image_only",
    personaName: "CharacterB",
    personaGender: "female",
    personaImageUrl: "/synthetic/character-b-primary.webp",
    personaSavedAppearance: SYNTHETIC_CHARACTER_B_APPEARANCE,
    personaAppearanceMode: "image_plus_saved",
    placement: "character_top",
    topExpression: "playful",
    bottomExpression: "calm",
    mood: "lovely",
  });
}

export function syntheticDuoGiftPlacementSwap() {
  return buildGiftBoxGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    characterImageUrl: "/synthetic/character-a-primary.webp",
    characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    characterAppearanceMode: "image_plus_saved",
    personaName: "CharacterB",
    personaGender: "female",
    personaImageUrl: "/synthetic/character-b-primary.webp",
    personaSavedAppearance: SYNTHETIC_CHARACTER_B_APPEARANCE,
    personaAppearanceMode: "image_plus_saved",
    placement: "persona_top",
    topExpression: "playful",
    bottomExpression: "calm",
    mood: "lovely",
  });
}

export function syntheticEmoticonPlan() {
  return buildEmoticonGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    personaName: "CharacterB",
    personaGender: "female",
    characterImageUrl: "/synthetic/character-a-primary.webp",
    characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    characterAppearanceMode: "image_plus_saved",
    personaImageUrl: "/synthetic/character-b-primary.webp",
    personaSavedAppearance: SYNTHETIC_CHARACTER_B_APPEARANCE,
    personaAppearanceMode: "image_plus_saved",
    scenes: FIXED_EMOTICON_SCENES,
  });
}

export function syntheticCoupleStampPlan() {
  return buildCoupleStampGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    personaName: "CharacterB",
    personaGender: "female",
    characterImageUrl: "/synthetic/character-a-primary.webp",
    characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    characterAppearanceMode: "image_plus_saved",
    personaImageUrl: "/synthetic/character-b-primary.webp",
    personaSavedAppearance: SYNTHETIC_CHARACTER_B_APPEARANCE,
    personaAppearanceMode: "image_plus_saved",
    options: {
      height: "same",
      background: "default",
      border: "none",
      characterExpression: "calm",
      personaExpression: "bright",
    },
  });
}

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
