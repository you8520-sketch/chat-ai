import { mkdirSync, writeFileSync } from "node:fs";

import {
  applyUserCastEdits,
  draftCastIntentFromMentions,
  normalizeCastPrimaryCap,
} from "@/lib/chatImageCast";
import {
  bindApprovedCastManifest,
  groundCastIntent,
  renderApprovedCastManifest,
  type ChatImageCastGroundedManifest,
} from "@/lib/chatImageCastManifest";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildLdSceneGenerationPlan } from "@/lib/chatLdIllustrationGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";
import {
  EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
  SCENE_BUILDER_SHARED_DUO,
  SYNTHETIC_CHARACTER_A_APPEARANCE,
} from "@/lib/chatImageVisualIdentity.fixtures";

const ctx = {
  persona: {
    name: "UserPersona",
    gender: "female" as const,
    referenceImageUrl: "/synthetic/user-persona-primary.webp",
    savedAppearance: EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
    appearanceMode: "image_plus_saved" as const,
  },
  mainCharacter: {
    name: "CharacterA",
    gender: "male" as const,
    referenceImageUrl: "/synthetic/character-a-primary.webp",
    savedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    appearanceMode: "image_plus_saved" as const,
  },
  selectableAssets: [
    { url: "/synthetic/support-a.webp", tag: "SupportA" },
    { url: "/synthetic/asset-b.webp", tag: "SupportB" },
  ],
};

function mustGround(
  ...args: Parameters<typeof groundCastIntent>
): ChatImageCastGroundedManifest {
  const result = groundCastIntent(...args);
  if (!result.ok) throw new Error(result.reason);
  return result.manifest;
}

function trioIntent() {
  return mustGround(
    {
      compositionGoal: "trio_group",
      subjects: [
        {
          key: "persona",
          role: "persona",
          name: "UserPersona",
          included: true,
          importance: "primary",
          visibility: "required_visible",
        },
        {
          key: "main_character",
          role: "main_character",
          name: "CharacterA",
          included: true,
          importance: "primary",
          visibility: "required_visible",
        },
        {
          key: "supporting:A",
          role: "supporting_character",
          name: "SupportA",
          included: true,
          importance: "primary",
          visibility: "required_visible",
          requestedReferenceAssetUrl: "/synthetic/support-a.webp",
        },
      ],
    },
    ctx
  );
}

const source = buildSceneSourceMessages([
  { id: 1, role: "user", content: '*손을 잡는다*\n"같이 가자."' },
  {
    id: 2,
    role: "assistant",
    content: "SupportA가 미소 지었다. SupportB가 뒤에서 손을 흔들었다.",
  },
]);

const sections: string[] = [];

function snap(title: string, prompt: string, refs: readonly string[]) {
  sections.push(
    [
      `## ${title}`,
      "",
      "### REFERENCE ORDER",
      refs.map((url, index) => `${index + 1}. ${url}`).join("\n"),
      "",
      "### PROMPT",
      "",
      "```",
      prompt,
      "```",
      "",
    ].join("\n")
  );
}

const duo = mustGround({
  compositionGoal: "duo_focus",
  subjects: [
    {
      key: "persona",
      role: "persona",
      name: "UserPersona",
      included: true,
      importance: "primary",
      visibility: "required_visible",
    },
    {
      key: "main_character",
      role: "main_character",
      name: "CharacterA",
      included: true,
      importance: "primary",
      visibility: "required_visible",
    },
  ],
}, ctx);
const duoBound = bindApprovedCastManifest(duo);
snap(
  "1. Duo focus",
  renderApprovedCastManifest({
    manifest: duo,
    selected: duoBound.selected,
    subjects: duoBound.subjects,
  }),
  duoBound.referenceUrls
);

const trio = trioIntent();
const trioBound = bindApprovedCastManifest(trio);
snap(
  "2. Exact trio (3 own refs)",
  renderApprovedCastManifest({
    manifest: trio,
    selected: trioBound.selected,
    subjects: trioBound.subjects,
  }),
  trioBound.referenceUrls
);

const comic3 = buildChatComicGenerationPlan({
  ...SCENE_BUILDER_SHARED_DUO,
  plan: buildDeterministicScenePlan(source, 3),
  castManifest: trio,
});
snap(
  "3. Trio comic 3-cut",
  comic3.prompt.split("APPROVED SCENE PLAN")[0]!.trim(),
  comic3.referenceUrls
);

const comic4 = buildChatComicGenerationPlan({
  ...SCENE_BUILDER_SHARED_DUO,
  plan: buildDeterministicScenePlan(source, 4),
  castManifest: trio,
});
snap(
  "4. Trio comic 4-cut",
  comic4.prompt.split("APPROVED SCENE PLAN")[0]!.trim(),
  comic4.referenceUrls
);

const plan3 = buildDeterministicScenePlan(source, 3);
plan3.castMentions = [
  {
    name: "SupportB",
    sourceEventIds: [plan3.events.find((event) => event.text.includes("SupportB"))!.id],
  },
];
let fiveIntent = draftCastIntentFromMentions({
  personaName: "UserPersona",
  mainCharacterName: "CharacterA",
  castMentions: plan3.castMentions,
  compositionGoal: "ensemble_scene",
});
fiveIntent = applyUserCastEdits(fiveIntent, "supporting:SupportA", {
  included: true,
  requestedReferenceAssetUrl: "/synthetic/support-a.webp",
});
fiveIntent = applyUserCastEdits(fiveIntent, "supporting:SupportB", {
  included: true,
  requestedReferenceAssetUrl: "/synthetic/asset-b.webp",
});
fiveIntent.subjects.push({
  key: "supporting:Extra2",
  role: "supporting_character",
  name: "Extra2",
  included: true,
  importance: "background",
  visibility: "background_ok",
});
fiveIntent = normalizeCastPrimaryCap(fiveIntent);
const five = mustGround(fiveIntent, ctx, plan3);
const fiveBound = bindApprovedCastManifest(five);
snap(
  "5. 4+ ensemble ref cap",
  renderApprovedCastManifest({
    manifest: five,
    selected: fiveBound.selected,
    subjects: fiveBound.subjects,
  }),
  fiveBound.referenceUrls
);

const cameo = mustGround(
  {
    compositionGoal: "duo_focus",
    subjects: [
      ...[
        {
          key: "persona",
          role: "persona" as const,
          name: "UserPersona",
          included: true,
          importance: "primary" as const,
          visibility: "required_visible" as const,
        },
        {
          key: "main_character",
          role: "main_character" as const,
          name: "CharacterA",
          included: true,
          importance: "primary" as const,
          visibility: "required_visible" as const,
        },
      ],
      {
        key: "supporting:C",
        role: "supporting_character",
        name: "SupportC",
        included: true,
        importance: "background",
        visibility: "background_ok",
      },
    ],
  },
  ctx
);
const cameoBound = bindApprovedCastManifest(cameo);
snap(
  "6. No-photo cameo",
  renderApprovedCastManifest({
    manifest: cameo,
    selected: cameoBound.selected,
    subjects: cameoBound.subjects,
  }),
  cameoBound.referenceUrls
);

const bindPlan = buildDeterministicScenePlan(
  buildSceneSourceMessages([
    { id: 1, role: "user", content: "*손을 흔든다*" },
    { id: 2, role: "assistant", content: 'SupportA가 "여기 있었네."라고 말했다.' },
  ]),
  2
);
bindPlan.castMentions = [
  {
    name: "SupportA",
    sourceEventIds: [bindPlan.events.find((event) => event.text.includes("SupportA"))!.id],
    actorEventIds: [bindPlan.events.find((event) => event.text.includes("SupportA"))!.id],
  },
];
let bindIntent = draftCastIntentFromMentions({
  personaName: "UserPersona",
  mainCharacterName: "CharacterA",
  castMentions: bindPlan.castMentions,
});
bindIntent = applyUserCastEdits(bindIntent, "supporting:SupportA", {
  included: true,
  requestedReferenceAssetUrl: "/synthetic/support-a.webp",
});
const bindGround = mustGround(bindIntent, ctx, bindPlan);
const bindBound = bindApprovedCastManifest(bindGround);
snap(
  "7. Supporting event-subject binding",
  renderApprovedCastManifest({
    manifest: bindGround,
    selected: bindBound.selected,
    subjects: bindBound.subjects,
    plan: bindPlan,
  }),
  bindBound.referenceUrls
);

const reorderBase: ChatImageCastIntentManifest = {
  compositionGoal: "trio_group",
  subjects: [
    {
      key: "persona",
      role: "persona",
      name: "UserPersona",
      included: true,
      importance: "primary",
      visibility: "required_visible",
    },
    {
      key: "main_character",
      role: "main_character",
      name: "CharacterA",
      included: true,
      importance: "primary",
      visibility: "required_visible",
    },
    {
      key: "supporting:A",
      role: "supporting_character",
      name: "SupportA",
      included: true,
      importance: "primary",
      visibility: "required_visible",
      requestedReferenceAssetUrl: "/synthetic/support-a.webp",
    },
    {
      key: "supporting:B",
      role: "supporting_character",
      name: "SupportB",
      included: true,
      importance: "secondary",
      visibility: "preferred_visible",
      requestedReferenceAssetUrl: "/synthetic/asset-b.webp",
    },
  ],
};
const reorderIntent = applyUserCastEdits(
  applyUserCastEdits(reorderBase, "supporting:A", { importance: "secondary" }),
  "supporting:B",
  { importance: "primary" }
);
const reorder = mustGround(reorderIntent, ctx);
const reorderBound = bindApprovedCastManifest(reorder);
snap(
  "8. Supporting importance reorder reference order",
  renderApprovedCastManifest({
    manifest: reorder,
    selected: reorderBound.selected,
    subjects: reorderBound.subjects,
  }),
  reorderBound.referenceUrls
);

const single = buildLdSceneGenerationPlan({
  ...SCENE_BUILDER_SHARED_DUO,
  approvedScenePlan: buildDeterministicScenePlan(source, 3),
  castManifest: trio,
});
sections.push(
  [
    "## LD single illustration (trio cast parity)",
    "",
    "### REFERENCE ORDER",
    single.referenceUrls.map((url, index) => `${index + 1}. ${url}`).join("\n"),
    "",
    "### PROMPT (cast block excerpt)",
    "",
    "```",
    single.prompt.split("APPROVED SCENE PLAN")[0]!.trim(),
    "```",
    "",
  ].join("\n")
);

mkdirSync("docs/audits/chat-image-multicast-674", { recursive: true });
writeFileSync(
  "docs/audits/chat-image-multicast-674/PROMPT-SNAPSHOTS.md",
  [
    "# Chat image multi-cast prompt snapshots (synthetic)",
    "",
    "Provider calls: 0. Synthetic fixtures only.",
    "",
    ...sections,
  ].join("\n")
);

console.log("Wrote docs/audits/chat-image-multicast-674/PROMPT-SNAPSHOTS.md");
