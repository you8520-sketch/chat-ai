import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import {
  applyComicTextOverlay,
  buildComicTextOverlaySvg,
  compileChatComicTextOverlay,
  resolveOverlayDialogueText,
} from "./chatComicTextOverlay";
import type { ScenePlan } from "./chatImageScenePlan";

const subjects = [
  {
    key: "character",
    name: "권태현",
    gender: "male" as const,
    role: "character",
    referenceImageUrl: "/c.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
  },
  {
    key: "persona",
    name: "유저",
    gender: "female" as const,
    role: "persona",
    referenceImageUrl: "/p.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
  },
];

function duoPlan(dialogue: ScenePlan["panels"][number]["dialogue"]): ScenePlan {
  return {
    sceneBackground: "거실",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "거실",
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "두 사람이 마주 본다",
        dialogue,
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "조용한 순간",
        dialogue: [],
      },
    ],
    dialogues: [],
  };
}

describe("chatComicTextOverlay", () => {
  it("T1 dialogue produces at least one speech overlay element", () => {
    const overlay = compileChatComicTextOverlay({
      plan: duoPlan([
        { speaker: "character", text: "오늘은 괜찮아?", provenance: "source" },
      ]),
      personaName: "유저",
      characterName: "권태현",
      subjects,
      safetyFallbackUsed: false,
    });
    assert.ok(overlay.elements.some((element) => element.kind === "speech"));
  });

  it("T2 user-edited dialogue is preserved exactly in overlay", () => {
    const edited = "편집된 대사입니다!";
    const overlay = compileChatComicTextOverlay({
      plan: duoPlan([
        { speaker: "character", text: edited, provenance: "user_edit" },
      ]),
      personaName: "유저",
      characterName: "권태현",
      subjects,
      safetyFallbackUsed: false,
    });
    assert.ok(overlay.elements.some((element) => element.text === edited));
  });

  it("T3 persona hidden omits persona dialogue from overlay", () => {
    const overlay = compileChatComicTextOverlay({
      plan: duoPlan([
        { speaker: "persona", text: "숨겨야 할 대사", provenance: "source" },
        { speaker: "character", text: "들려야 할 대사", provenance: "source" },
      ]),
      personaName: "유저",
      characterName: "권태현",
      subjects,
      castManifest: {
        compositionGoal: "duo_focus",
        subjects: [
          {
            key: "character",
            role: "chat_character",
            name: "권태현",
            gender: "male",
            included: true,
            importance: "primary",
            visibility: "required_visible",
            sourceKind: "character",
            appearanceMode: "image_only",
          },
        ],
        eventSubjectBindings: [],
      },
      contentKind: "simulation",
      safetyFallbackUsed: false,
    });
    assert.doesNotMatch(
      overlay.elements.map((element) => element.text).join("\n"),
      /숨겨야 할 대사/
    );
    assert.match(
      overlay.elements.map((element) => element.text).join("\n"),
      /들려야 할 대사/
    );
  });

  it("T6 silent panel does not force speech bubble when no dialogue", () => {
    const overlay = compileChatComicTextOverlay({
      plan: duoPlan([]),
      personaName: "유저",
      characterName: "권태현",
      subjects,
      safetyFallbackUsed: false,
    });
    const panel2 = overlay.elements.filter((element) => element.panelIndex === 2);
    assert.equal(panel2.filter((element) => element.kind === "speech").length, 0);
  });

  it("S2 strict fallback overlay omits risky explicit dialogue", () => {
    assert.equal(
      resolveOverlayDialogueText("격렬한 성관계를 나눴다", "strict_fallback"),
      null
    );
    const overlay = compileChatComicTextOverlay({
      plan: duoPlan([
        { speaker: "character", text: "격렬한 성관계를 나눴다", provenance: "source" },
        { speaker: "character", text: "괜찮아?", provenance: "source" },
      ]),
      personaName: "유저",
      characterName: "권태현",
      subjects,
      safetyFallbackUsed: true,
    });
    assert.doesNotMatch(
      overlay.elements.map((element) => element.text).join("\n"),
      /성관계/
    );
    assert.match(
      overlay.elements.map((element) => element.text).join("\n"),
      /괜찮아/
    );
  });

  it("R1 overlay SVG includes bubble text and applyComicTextOverlay changes bytes", async () => {
    const overlay = compileChatComicTextOverlay({
      plan: duoPlan([
        { speaker: "character", text: "테스트 말풍선", provenance: "source" },
      ]),
      personaName: "유저",
      characterName: "권태현",
      subjects,
      safetyFallbackUsed: false,
    });
    const svg = buildComicTextOverlaySvg(400, 800, overlay);
    assert.match(svg, /테스트 말풍선/);
    const base = await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 3,
        background: { r: 180, g: 180, b: 180 },
      },
    })
      .webp()
      .toBuffer();
    const overlaid = await applyComicTextOverlay({ image: base, overlay });
    assert.notEqual(overlaid.length, base.length);
  });

  for (const panelCount of [2, 3, 4] as const) {
    it(`${panelCount}-cut overlay plan preserves panel indices`, () => {
      const plan: ScenePlan = {
        sceneBackground: "카페",
        events: [],
        castMentions: [],
        heroEventIds: [],
        heroScene: "카페",
        panels: Array.from({ length: panelCount }, (_, index) => ({
          index: index + 1,
          sourceEventIds: [],
          situation: `beat ${index + 1}`,
          dialogue:
            index === 0
              ? [{ speaker: "character", text: `패널${index + 1}`, provenance: "source" as const }]
              : [],
        })),
        dialogues: [],
      };
      const overlay = compileChatComicTextOverlay({
        plan,
        personaName: "유저",
        characterName: "권태현",
        subjects,
        safetyFallbackUsed: false,
      });
      assert.equal(overlay.panelCount, panelCount);
      assert.ok(overlay.elements.every((element) => element.panelIndex <= panelCount));
    });
  }
});
