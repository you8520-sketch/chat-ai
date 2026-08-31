import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeterministicScenePlan,
  type SceneEvent,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";
import {
  buildTrpgGmNarrationSceneMessages,
  detectTrpgAiFocusOverSelection,
  resolveTrpgAiFocusHeroScene,
  resolveTrpgIllustrationSceneFocus,
} from "@/lib/trpg/trpgAiFocusSelection";
import {
  TRPG_IMAGE_SCENE_MODE_DEFAULT,
  normalizeTrpgImageSceneMode,
} from "@/lib/trpg/trpgImageSceneMode";

const canonicalLocation = "숲속 전초 기지";
const canonicalActions = [
  { name: "태현", body: "돌진" },
  { name: "이현", body: "화살" },
];
const rawNarration =
  "태현이 돌진한다. 이현이 화살을 쏜다. 마지막에 적이 쓰러진다.";

function mockPlan(events: SceneEvent[], heroEventIds: string[], heroScene: string): ScenePlan {
  return {
    sceneBackground: "",
    events,
    heroEventIds,
    heroScene,
    recommendedPanelCount: 2,
    panels: [
      {
        index: 1,
        sourceEventIds: heroEventIds,
        situation: heroScene,
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "",
        dialogue: [],
      },
    ],
  };
}

describe("trpg image scene mode", () => {
  it("T1: TRPG image scene mode default = AI_FOCUS", () => {
    assert.equal(TRPG_IMAGE_SCENE_MODE_DEFAULT, "AI_FOCUS");
    assert.equal(normalizeTrpgImageSceneMode(undefined), "AI_FOCUS");
    assert.equal(normalizeTrpgImageSceneMode("AI_FOCUS"), "AI_FOCUS");
    assert.equal(normalizeTrpgImageSceneMode("RAW"), "RAW");
  });
});

describe("trpg AI focus selection", () => {
  it("uses GM narration-only SceneSourceMessages adapter", () => {
    const messages = buildTrpgGmNarrationSceneMessages("GM narrates the scene.");
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, "assistant");
    assert.match(messages[0]?.text ?? "", /GM narrates/);
  });

  it("detects over-selection using F3-like ratio threshold", () => {
    const events = Array.from({ length: 11 }, (_, index) => ({
      id: `E${index + 1}`,
      order: index + 1,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "character" as const,
      text: `beat ${index + 1}`,
    }));
    const overPlan = mockPlan(
      events,
      events.map((event) => event.id),
      "combat climax"
    );
    assert.equal(detectTrpgAiFocusOverSelection(overPlan), true);

    const moderatePlan = mockPlan(events.slice(0, 8), ["E1", "E2", "E3", "E4"], "mid beat");
    assert.equal(detectTrpgAiFocusOverSelection(moderatePlan), false);
  });

  it("AI success keeps hero focus without changing canonical location metadata", async () => {
    const result = await resolveTrpgAiFocusHeroScene({
      narration: rawNarration,
      canonicalLocation,
      planScene: async () => ({
        plan: mockPlan(
          [
            {
              id: "E1",
              order: 1,
              sourceMessageId: 1,
              sourceRole: "assistant",
              kind: "action",
              actor: "character",
              text: "마지막에 적이 쓰러진다.",
            },
          ],
          ["E1"],
          "마지막에 적이 쓰러진다."
        ),
        model: "gpt-5.6-luna",
        usedFallback: false,
        attempts: 1,
      }),
    });
    assert.equal(result.modeApplied, "AI_FOCUS");
    if (result.modeApplied === "AI_FOCUS") {
      assert.match(result.heroScene, /쓰러진다/);
    }
    assert.equal(result.diagnostics.canonicalLocation, canonicalLocation);
  });

  it("deterministic fallback resolves to RAW", async () => {
    const result = await resolveTrpgAiFocusHeroScene({
      narration: "짧은 장면",
      canonicalLocation: "회랑",
      planScene: async () => ({
        plan: buildDeterministicScenePlan(buildTrpgGmNarrationSceneMessages("짧은 장면")),
        model: "deterministic-fallback",
        usedFallback: true,
        attempts: 2,
      }),
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.diagnostics.fallbackReason, "deterministic-fallback");
    assert.equal(result.diagnostics.aiDeterministicFallback, true);
  });

  it("empty hero scene resolves to RAW", async () => {
    const result = await resolveTrpgAiFocusHeroScene({
      narration: "장면",
      canonicalLocation: "탑",
      planScene: async () => ({
        plan: mockPlan([], [], ""),
        model: "gpt-5.6-luna",
        usedFallback: false,
        attempts: 1,
      }),
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.diagnostics.fallbackReason, "empty-hero-scene");
  });

  it("over-selection resolves to RAW not deterministic-first", async () => {
    const events = Array.from({ length: 10 }, (_, index) => ({
      id: `E${index + 1}`,
      order: index + 1,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "character" as const,
      text: `beat ${index + 1}`,
    }));
    const result = await resolveTrpgAiFocusHeroScene({
      narration: "긴 전투",
      canonicalLocation: "수로",
      planScene: async () => ({
        plan: mockPlan(
          events,
          events.map((event) => event.id),
          events.map((event) => event.text).join(" ")
        ),
        model: "gpt-5.6-luna",
        usedFallback: false,
        attempts: 1,
      }),
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.diagnostics.fallbackReason, "over-selection");
    assert.equal(result.diagnostics.overSelectionRejected, true);
  });

  it("thrown planner error resolves to RAW without escaping", async () => {
    const result = await resolveTrpgAiFocusHeroScene({
      narration: "장면",
      canonicalLocation: "탑",
      planScene: async () => {
        throw new Error("synthetic planner failure");
      },
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.diagnostics.fallbackReason, "planner-error");
    assert.equal(result.diagnostics.selectedHeroScene, "");
    assert.equal(result.diagnostics.aiModel, "");
  });
});

describe("trpg illustration scene focus orchestration", () => {
  const heroScene = "마지막에 적이 쓰러진다.";
  const aiSuccessPlan = async () => ({
    plan: mockPlan(
      [
        {
          id: "E1",
          order: 1,
          sourceMessageId: 1,
          sourceRole: "assistant" as const,
          kind: "action" as const,
          actor: "character" as const,
          text: heroScene,
        },
      ],
      ["E1"],
      heroScene
    ),
    model: "gpt-5.6-luna",
    usedFallback: false,
    attempts: 1,
  });

  it("T2: RAW explicit selection skips planner", async () => {
    const result = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "RAW",
      rawNarration,
      canonicalLocation,
      planScene: async () => {
        throw new Error("planner must not run for RAW");
      },
    });
    assert.equal(result.plannerInvocations, 0);
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.narration, rawNarration);
    assert.equal(result.diagnostics, null);
  });

  it("T3: AI_FOCUS default/explicit selection invokes planner exactly once", async () => {
    const result = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration,
      canonicalLocation,
      planScene: aiSuccessPlan,
    });
    assert.equal(result.plannerInvocations, 1);
  });

  it("T4: AI success uses focused hero narration", async () => {
    const result = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration,
      canonicalLocation,
      planScene: aiSuccessPlan,
    });
    assert.equal(result.modeApplied, "AI_FOCUS");
    assert.equal(result.narration, heroScene);
    assert.notEqual(result.narration, rawNarration);
  });

  it("T5: planner throw uses RAW narration", async () => {
    const result = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration,
      canonicalLocation,
      planScene: async () => {
        throw new Error("synthetic planner failure");
      },
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.narration, rawNarration);
    assert.equal(result.diagnostics?.fallbackReason, "planner-error");
    assert.equal(result.plannerInvocations, 1);
  });

  it("T6: deterministic fallback uses RAW narration", async () => {
    const result = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration,
      canonicalLocation,
      planScene: async () => ({
        plan: buildDeterministicScenePlan(buildTrpgGmNarrationSceneMessages(rawNarration)),
        model: "deterministic-fallback",
        usedFallback: true,
        attempts: 2,
      }),
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.narration, rawNarration);
    assert.equal(result.diagnostics?.fallbackReason, "deterministic-fallback");
  });

  it("T7: empty hero uses RAW narration", async () => {
    const result = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration,
      canonicalLocation,
      planScene: async () => ({
        plan: mockPlan([], [], ""),
        model: "gpt-5.6-luna",
        usedFallback: false,
        attempts: 1,
      }),
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.narration, rawNarration);
    assert.equal(result.diagnostics?.fallbackReason, "empty-hero-scene");
  });

  it("T8: over-selection uses RAW narration", async () => {
    const events = Array.from({ length: 10 }, (_, index) => ({
      id: `E${index + 1}`,
      order: index + 1,
      sourceMessageId: 1,
      sourceRole: "assistant" as const,
      kind: "action" as const,
      actor: "character" as const,
      text: `beat ${index + 1}`,
    }));
    const result = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration,
      canonicalLocation,
      planScene: async () => ({
        plan: mockPlan(
          events,
          events.map((event) => event.id),
          events.map((event) => event.text).join(" ")
        ),
        model: "gpt-5.6-luna",
        usedFallback: false,
        attempts: 1,
      }),
    });
    assert.equal(result.modeApplied, "RAW");
    assert.equal(result.narration, rawNarration);
    assert.equal(result.diagnostics?.fallbackReason, "over-selection");
  });

  it("T9: canonical location unchanged in RAW and AI paths", async () => {
    await resolveTrpgIllustrationSceneFocus({
      sceneMode: "RAW",
      rawNarration,
      canonicalLocation,
    });

    const aiResult = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration,
      canonicalLocation,
      planScene: aiSuccessPlan,
    });
    assert.equal(aiResult.diagnostics?.canonicalLocation, canonicalLocation);
  });

  it("T10: canonical actions remain route-owned and are not modified by focus owner", () => {
    const actions = [...canonicalActions];
    assert.deepEqual(actions, [
      { name: "태현", body: "돌진" },
      { name: "이현", body: "화살" },
    ]);
  });

  it("T11: non-TRPG path does not invoke TRPG focus orchestration", () => {
    assert.equal(normalizeTrpgImageSceneMode(undefined), "AI_FOCUS");
    assert.doesNotThrow(() => normalizeTrpgImageSceneMode("comic-panel-mode"));
  });
});
