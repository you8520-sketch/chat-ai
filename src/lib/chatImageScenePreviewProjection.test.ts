import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addPanelDialogueLine,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES,
  COMPACT_PREVIEW_KEY_ACTION_MAX,
  COMPACT_PREVIEW_SITUATION_MAX,
  formatApprovedScenePlanForIllustration,
  projectComicPanelCompactDialoguePreview,
  projectComicPanelCompactSituation,
  projectLdCompactPreviewSummary,
  truncateCompactPreviewText,
  updatePanelDialogueAtIndex,
  type ScenePlan,
} from "./chatImageScenePlan";
import { buildChatComicGenerationPlan } from "./chatComicGeneration";

const LONG_ASSISTANT_NARRATION =
  "태현이 렌의 손목을 붙잡고 문 앞까지 따라온다. 복도 불빛 아래 두 사람의 그림자가 길게 늘어지고, " +
  "렌은 숨을 고르며 고개를 돌린다. 태현은 잠시 망설이다가 손을 더 단단히 쥔다. " +
  '태현이 작게 "가지 마."라고 말했다.';

function longNarrationMessages() {
  return buildSceneSourceMessages([
    {
      id: 1,
      role: "user",
      content: '*손목을 붙잡는다*\n"가지 마."',
    },
    {
      id: 2,
      role: "assistant",
      content: LONG_ASSISTANT_NARRATION,
    },
  ]);
}

describe("chatImageScenePreviewProjection reproduction", () => {
  it("LD: raw heroScene is long prose but compact preview stays storyboard-short", () => {
    const plan = buildDeterministicScenePlan(longNarrationMessages(), 2);
    assert.ok(plan.heroScene.length > COMPACT_PREVIEW_KEY_ACTION_MAX);

    const summary = projectLdCompactPreviewSummary(plan);
    assert.ok(summary.keyAction.length <= COMPACT_PREVIEW_KEY_ACTION_MAX + 1);
    assert.ok(summary.keyAction.length < plan.heroScene.length);
    assert.match(summary.keyAction, /손목|붙잡/);
    assert.doesNotMatch(summary.keyAction, /복도 불빛/);
  });

  it("Comic: panel situation is long but compact preview fits storyboard card budget", () => {
    const plan = buildDeterministicScenePlan(longNarrationMessages(), 3);
    let compressedAtLeastOnce = false;
    for (const panel of plan.panels) {
      const compact = projectComicPanelCompactSituation(plan, panel);
      assert.ok(compact.length <= COMPACT_PREVIEW_SITUATION_MAX + 1);
      if (panel.situation.length > COMPACT_PREVIEW_SITUATION_MAX) {
        assert.ok(compact.length < panel.situation.length);
        compressedAtLeastOnce = true;
      }
    }
    assert.equal(compressedAtLeastOnce, true);
  });

  it("Comic: 2/3/4-cut overview stays compact across panel counts", () => {
    for (const count of [2, 3, 4] as const) {
      const plan = buildDeterministicScenePlan(longNarrationMessages(), count);
      assert.equal(plan.panels.length, count);
      for (const panel of plan.panels) {
        const compact = projectComicPanelCompactSituation(plan, panel);
        assert.ok(compact.length <= COMPACT_PREVIEW_SITUATION_MAX + 1);
      }
    }
  });
});

function planWithManyDialogues(): ScenePlan {
  const plan = buildDeterministicScenePlan(longNarrationMessages(), 2);
  let next = plan;
  const lines = [
    "첫 번째 대사입니다.",
    "두 번째 대사입니다.",
    "세 번째 대사입니다.",
    "네 번째 대사입니다.",
    "다섯 번째 대사입니다.",
  ];
  for (const text of lines) {
    next = addPanelDialogueLine(next, 1, "persona");
    const panel = next.panels.find((entry) => entry.index === 1);
    const lastIndex = (panel?.dialogue.length ?? 1) - 1;
    next = updatePanelDialogueAtIndex(next, 1, lastIndex, { text });
  }
  return next;
}

describe("chatImageScenePreviewProjection comic dialogue compact", () => {
  it("T1: long dialogue panel keeps canonical lines while preview shows limited rows", () => {
    const plan = planWithManyDialogues();
    const panel = plan.panels.find((entry) => entry.index === 1);
    assert.ok(panel);
    assert.ok(panel.dialogue.length >= 5);

    const preview = projectComicPanelCompactDialoguePreview(panel);
    assert.equal(preview.totalVisible, panel.dialogue.length);
    assert.equal(preview.previewLines.length, COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES);
    assert.equal(preview.hiddenCount, panel.dialogue.length - COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES);
  });

  it("T3: dialogue edit owner still mutates canonical dialogue text", () => {
    const plan = planWithManyDialogues();
    const edited = updatePanelDialogueAtIndex(plan, 1, 0, { text: "같이 가자." });
    const panel = edited.panels.find((entry) => entry.index === 1);
    assert.equal(panel?.dialogue[0]?.text, "같이 가자.");
  });

  it("T4: compact storyboard data works for 2/3/4 panels", () => {
    for (const count of [2, 3, 4] as const) {
      const plan = buildDeterministicScenePlan(longNarrationMessages(), count);
      assert.equal(plan.panels.length, count);
      for (const panel of plan.panels) {
        const situation = projectComicPanelCompactSituation(plan, panel);
        const dialogue = projectComicPanelCompactDialoguePreview(panel);
        assert.ok(situation.length <= COMPACT_PREVIEW_SITUATION_MAX + 1);
        assert.ok(dialogue.previewLines.length <= COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES);
      }
    }
  });

  it("T5: compact situation follows sourceEventIds chronology, not character-first priority", () => {
    const messages = buildSceneSourceMessages([
      {
        id: 1,
        role: "user",
        content: '*손을 잡는다*\n"같이 갈래?"',
      },
      {
        id: 2,
        role: "assistant",
        content: "태형이 먼저 고개를 돌린다.",
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const panel = plan.panels[0];
    assert.ok(panel);
    panel.characterAction = "캐릭터 우선 표시";
    panel.personaAction = "페르소나 우선 표시";

    const compact = projectComicPanelCompactSituation(plan, panel);
    assert.match(compact, /손을 잡는다/);
    assert.doesNotMatch(compact, /캐릭터 우선/);
    assert.doesNotMatch(compact, /페르소나 우선/);
  });
});

describe("chatImageScenePreviewProjection generation non-regression", () => {
  function illustrationPrompt(plan: ScenePlan): string {
    return formatApprovedScenePlanForIllustration(plan);
  }

  function comicPrompt(plan: ScenePlan): string {
    return buildChatComicGenerationPlan({
      characterName: "태현",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      characterImageUrl: "/ref/character",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "/ref/persona",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      plan,
    }).prompt;
  }

  it("LD generation prompt unchanged by compact preview projection", () => {
    const plan = buildDeterministicScenePlan(longNarrationMessages(), 2);
    const before = illustrationPrompt(plan);
    projectLdCompactPreviewSummary(plan);
    const after = illustrationPrompt(plan);
    assert.equal(after, before);
    assert.match(before, /Hero scene:/);
  });

  it("Comic generation prompt unchanged by compact preview projection", () => {
    const plan = buildDeterministicScenePlan(longNarrationMessages(), 3);
    const before = comicPrompt(plan);
    for (const panel of plan.panels) {
      projectComicPanelCompactSituation(plan, panel);
      projectComicPanelCompactDialoguePreview(panel);
    }
    const after = comicPrompt(plan);
    assert.equal(after, before);
    assert.match(before, /COMIC PANEL SPEC/);
  });

  it("T6: compact dialogue preview does not mutate ScenePlan", () => {
    const plan = planWithManyDialogues();
    const snapshot = structuredClone(plan);
    for (const panel of plan.panels) {
      projectComicPanelCompactDialoguePreview(panel);
      projectComicPanelCompactSituation(plan, panel);
    }
    assert.deepEqual(plan, snapshot);
  });
});

describe("truncateCompactPreviewText", () => {
  it("preserves short text and truncates long prose at word boundary", () => {
    assert.equal(truncateCompactPreviewText("짧은 장면", 20), "짧은 장면");
    const long = "a".repeat(100);
    const truncated = truncateCompactPreviewText(long, 40);
    assert.ok(truncated.endsWith("…"));
    assert.ok(truncated.length <= 41);
  });
});
