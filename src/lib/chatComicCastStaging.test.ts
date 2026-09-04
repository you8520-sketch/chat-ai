import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatComicPanelSpecVisualSection } from "@/lib/chatComicPanelSpec";
import {
  layoutPanelOverlay,
  type SpeechBubbleLayout,
} from "@/lib/chatComicTextOverlay";
import {
  bindApprovedCastManifest,
  groundCastIntent,
  type GroundCastContext,
} from "@/lib/chatImageCastManifest";
import type { ChatImageCastIntentManifest } from "@/lib/chatImageCast";
import {
  buildPromptSubjectMap,
  formatComicStagingLayout,
  resolveComicSubjectStaging,
  resolveDialogueSpeakerSubject,
} from "@/lib/chatImagePromptSubjectMap";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";
import {
  EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
  SYNTHETIC_CHARACTER_A_APPEARANCE,
} from "@/lib/chatImageVisualIdentity.fixtures";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
} from "@/lib/chatImageVisualIdentity";
import { createVisualSubjectKey } from "@/lib/visualSubjects";

const PERSONA_URL = "/synthetic/user-persona-primary.webp";
const MAIN_URL = "/synthetic/character-a-primary.webp";
const SUPPORT_URL = "/synthetic/support-a.webp";
const SUPPORT_SUBJECT_KEY = createVisualSubjectKey();

const GROUND_CTX: GroundCastContext = {
  persona: {
    name: "렌",
    gender: "female",
    referenceImageUrl: PERSONA_URL,
    savedAppearance: EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
    appearanceMode: "image_plus_saved",
  },
  mainCharacter: {
    name: "라이크",
    gender: "male",
    referenceImageUrl: MAIN_URL,
    savedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    appearanceMode: "image_plus_saved",
  },
  selectableAssets: [
    { url: SUPPORT_URL, tag: "강이현", visualSubjectKey: SUPPORT_SUBJECT_KEY },
  ],
  visualSubjects: [
    {
      subjectKey: SUPPORT_SUBJECT_KEY,
      name: "강이현",
      savedAppearance: "검은 단발",
      representativeAssetUrl: SUPPORT_URL,
      sourceCharacterId: null,
    },
  ],
  characterAssets: [
    { url: MAIN_URL, tag: "라이크" },
    { url: SUPPORT_URL, tag: "강이현", visualSubjectKey: SUPPORT_SUBJECT_KEY },
  ],
};

function duoCastIntent(): ChatImageCastIntentManifest {
  return {
    compositionGoal: "duo_focus",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: "렌",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "main_character",
        role: "main_character",
        name: "라이크",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
    ],
  };
}

function trioIntent(): ChatImageCastIntentManifest {
  return {
    compositionGoal: "trio_group",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: "렌",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "main_character",
        role: "main_character",
        name: "라이크",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "supporting:강이현",
        role: "supporting_character",
        name: "강이현",
        included: true,
        importance: "primary",
        visibility: "required_visible",
        requestedReferenceAssetUrl: SUPPORT_URL,
      },
    ],
  };
}

function boundProductionSubjects(manifest: { subjects: unknown[] }) {
  return bindApprovedCastManifest(manifest as Parameters<typeof bindApprovedCastManifest>[0]).subjects;
}

function bubbleSide(bubble: SpeechBubbleLayout, panelWidth: number): "left" | "center" | "right" {
  const centerX = bubble.x + bubble.width / 2;
  if (centerX < panelWidth * 0.38) return "left";
  if (centerX > panelWidth * 0.62) return "right";
  return "center";
}

function assertDuoSides(opts: {
  subjects: ReturnType<typeof boundProductionSubjects>;
  panelWidth: number;
  visualSection: string;
}) {
  const subjectMap = buildPromptSubjectMap(opts.subjects);
  const staging = formatComicStagingLayout(subjectMap, true);
  const main = subjectMap.subjects.find((subject) => subject.key === "main_character" || subject.key === "character");
  const persona = subjectMap.subjects.find((subject) => subject.key === "persona");
  assert.ok(main && persona);
  assert.match(staging, new RegExp(`${main!.label} left, ${persona!.label} right`));
  assert.match(opts.visualSection, new RegExp(`${main!.label} left, ${persona!.label} right`));

  const layout = layoutPanelOverlay({
    panel: {
      index: 1,
      sourceEventIds: [],
      situation: "카페",
      dialogue: [
        { speaker: "character", text: "캐릭터 대사", provenance: "source" },
        { speaker: "persona", text: "페르소나 대사", provenance: "source" },
      ],
    },
    approvedDialogue: [
      { speaker: "character", text: "캐릭터 대사", provenance: "source" },
      { speaker: "persona", text: "페르소나 대사", provenance: "source" },
    ],
    panelX: 0,
    panelY: 0,
    panelWidth: opts.panelWidth,
    panelHeight: 456,
    subjects: opts.subjects,
  });
  const characterBubble = layout.bubbles.find((bubble) => bubble.speaker === "character");
  const personaBubble = layout.bubbles.find((bubble) => bubble.speaker === "persona");
  assert.ok(characterBubble && personaBubble);
  assert.equal(bubbleSide(characterBubble, opts.panelWidth), "left");
  assert.equal(bubbleSide(personaBubble, opts.panelWidth), "right");
}

describe("production cast staging matrix CAST-L1–L6", () => {
  it("CAST-L1: bound duo manifest keeps character left and persona right in visual + overlay", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"안녕."' }]),
      2,
      { personaName: "렌", characterName: "라이크" }
    );
    const grounded = groundCastIntent(duoCastIntent(), GROUND_CTX, plan);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    assert.equal(grounded.manifest.subjects[0]?.role, "persona");
    const subjects = boundProductionSubjects(grounded.manifest);
    const visual = buildChatComicPanelSpecVisualSection({
      plan,
      personaName: "렌",
      characterName: "라이크",
      subjects,
      castSelected: grounded.manifest.subjects.filter((subject) => subject.included),
    });
    assertDuoSides({ subjects, panelWidth: 864, visualSection: visual });
  });

  it("CAST-L2: duo without castManifest keeps canonical sides", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"안녕."' }]),
      2,
      { personaName: "렌", characterName: "라이크" }
    );
    const subjects = bindChatImageReferencePack({
      subjectsInImageOrder: buildChatDuoVisualSubjects({
        characterName: "라이크",
        characterGender: "male",
        characterImageUrl: MAIN_URL,
        characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
        characterAppearanceMode: "image_plus_saved",
        personaName: "렌",
        personaGender: "female",
        personaImageUrl: PERSONA_URL,
        personaSavedAppearance: EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
        personaAppearanceMode: "image_plus_saved",
      }),
    }).subjects;
    const visual = buildChatComicPanelSpecVisualSection({
      plan,
      personaName: "렌",
      characterName: "라이크",
      subjects,
    });
    assertDuoSides({ subjects, panelWidth: 864, visualSection: visual });
  });

  it("CAST-L3: grounded trio resolves each named speaker to its own subject identity", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        {
          id: 1,
          role: "assistant",
          content: ['렌: "조심해."', '라이크: "알겠어."', '강이현: "뒤는 내가 볼게."'].join("\n"),
        },
      ]),
      2,
      { personaName: "렌", characterName: "라이크", knownSpeakerNames: ["강이현", "라이크", "렌"] }
    );
    const grounded = groundCastIntent(trioIntent(), GROUND_CTX, plan);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const subjects = boundProductionSubjects(grounded.manifest);
    const subjectMap = buildPromptSubjectMap(subjects);
    assert.ok(resolveDialogueSpeakerSubject(subjectMap, { speaker: "persona", speakerName: "렌" }));
    assert.ok(resolveDialogueSpeakerSubject(subjectMap, { speaker: "character", speakerName: "라이크" }));
    assert.ok(resolveDialogueSpeakerSubject(subjectMap, { speaker: "other", speakerName: "강이현" }));
  });

  it("CAST-L4: supporting speaker other+speakerName maps to named subject, not generic center enum", () => {
    const grounded = groundCastIntent(trioIntent(), GROUND_CTX);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const subjects = boundProductionSubjects(grounded.manifest);
    const subjectMap = buildPromptSubjectMap(subjects);
    const support = resolveDialogueSpeakerSubject(subjectMap, {
      speaker: "other",
      speakerName: "강이현",
    });
    assert.ok(support);
    assert.equal(support!.name, "강이현");
    const layout = layoutPanelOverlay({
      panel: {
        index: 1,
        sourceEventIds: [],
        situation: "복도",
        dialogue: [
          { speaker: "other", speakerName: "강이현", text: "뒤는 내가 볼게.", provenance: "source" },
        ],
      },
      approvedDialogue: [
        { speaker: "other", speakerName: "강이현", text: "뒤는 내가 볼게.", provenance: "source" },
      ],
      panelX: 0,
      panelY: 0,
      panelWidth: 864,
      panelHeight: 456,
      subjects,
    });
    const bubble = layout.bubbles[0];
    assert.ok(bubble);
    assert.equal(bubbleSide(bubble!, 864), "center");
  });

  it("CAST-L5: unknown other speakerName does not hijack a canonical subject", () => {
    const grounded = groundCastIntent(trioIntent(), GROUND_CTX);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const subjects = boundProductionSubjects(grounded.manifest);
    const subjectMap = buildPromptSubjectMap(subjects);
    assert.equal(
      resolveDialogueSpeakerSubject(subjectMap, { speaker: "other", speakerName: "정체불명" }),
      undefined
    );
  });

  it("CAST-L6: personaHidden recalculates staging from the same canonical owner", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"안녕."' }]),
      2,
      { personaName: "렌", characterName: "라이크" }
    );
    const grounded = groundCastIntent(duoCastIntent(), GROUND_CTX, plan);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const subjects = boundProductionSubjects(grounded.manifest);
    const subjectMap = buildPromptSubjectMap(subjects);
    const hiddenLayout = formatComicStagingLayout(subjectMap, false);
    assert.match(hiddenLayout, /centered; persona off-camera only/);
    const layout = layoutPanelOverlay({
      panel: {
        index: 1,
        sourceEventIds: [],
        situation: "카페",
        dialogue: [{ speaker: "character", text: "혼자 대사", provenance: "source" }],
      },
      approvedDialogue: [{ speaker: "character", text: "혼자 대사", provenance: "source" }],
      panelX: 0,
      panelY: 0,
      panelWidth: 864,
      panelHeight: 456,
      personaVisible: false,
      subjects,
    });
    assert.equal(layout.bubbles.length, 1);
    assert.equal(bubbleSide(layout.bubbles[0]!, 864), "center");
  });
});
