import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  addPanelDialogueLine,
  applyUserIllustrationEdits,
  applyUserPanelEdits,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES,
  COMPACT_PREVIEW_KEY_ACTION_MAX,
  COMPACT_PREVIEW_SITUATION_MAX,
  formatApprovedScenePlanForIllustration,
  projectComicPanelBeat,
  projectComicPanelCompactDialoguePreview,
  projectComicPanelCompactSituation,
  projectCompleteVisualBeat,
  projectLdCompactPreviewSummary,
  reflowScenePlanPanels,
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

  it("Comic: panel situation preview uses complete visual beat without mid-sentence ellipsis", () => {
    const plan = buildDeterministicScenePlan(longNarrationMessages(), 3);
    for (const panel of plan.panels) {
      const compact = projectComicPanelCompactSituation(plan, panel);
      assert.doesNotMatch(compact, /…$/);
      if (compact) {
        assert.ok(compact.length > 0);
      }
    }
  });

  it("Comic: 2/3/4-cut overview exposes complete beats across panel counts", () => {
    for (const count of [2, 3, 4] as const) {
      const plan = buildDeterministicScenePlan(longNarrationMessages(), count);
      assert.equal(plan.panels.length, count);
      for (const panel of plan.panels) {
        const compact = projectComicPanelCompactSituation(plan, panel);
        assert.doesNotMatch(compact, /…$/);
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
        assert.doesNotMatch(situation, /…$/);
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

const SCENE_A_LD = "태현이 렌의 손을 잡고 문 앞에 서 있다.";
const SCENE_B_LD = "렌과 태현이 창가에 나란히 서서 비 내리는 거리를 바라본다.";
const SCENE_A_COMIC = "태현이 렌의 손을 잡는다.";
const SCENE_B_COMIC = "태현이 렌에게 우산을 건네며 현관 앞에 서 있다.";

function basicTwoPanelPlan(): ScenePlan {
  return buildDeterministicScenePlan(
    buildSceneSourceMessages([
      { id: 1, role: "user", content: '*손목을 붙잡는다*\n"가지 마."' },
      { id: 2, role: "assistant", content: SCENE_A_LD },
    ]),
    2
  );
}

function generationHeroScene(plan: ScenePlan): string {
  const match = formatApprovedScenePlanForIllustration(plan).match(/Hero scene: (.+)/);
  return match?.[1]?.trim() ?? "";
}

describe("chatImageScenePreviewProjection user-edit parity", () => {
  it("T7: LD detailed edit parity — compact preview follows generation scene B", () => {
    const plan = basicTwoPanelPlan();
    const beforeEdit = projectLdCompactPreviewSummary(plan);
    assert.match(beforeEdit.keyAction, /손/);

    const edited = applyUserIllustrationEdits(plan, { heroScene: SCENE_B_LD });
    const genScene = generationHeroScene(edited);
    assert.equal(genScene, SCENE_B_LD);

    const afterEdit = projectLdCompactPreviewSummary(edited);
    assert.match(afterEdit.keyAction, /창가|비/);
    assert.doesNotMatch(afterEdit.keyAction, /^손목을 붙잡는다$/);

    const snapshot = structuredClone(edited);
    projectLdCompactPreviewSummary(edited);
    assert.deepEqual(edited, snapshot);
  });

  it("T8: Comic detailed edit parity — compact panel preview follows generation scene B", () => {
    const plan = basicTwoPanelPlan();
    const panel = plan.panels[0];
    assert.ok(panel);
    assert.match(panel.situation, /손/);

    const edited = applyUserPanelEdits(plan, 1, { situation: SCENE_B_COMIC });
    const editedPanel = edited.panels[0];
    assert.ok(editedPanel);
    const beat = projectComicPanelBeat(edited, editedPanel, { personaVisible: true });
    assert.equal(beat.situation, SCENE_B_COMIC);

    const compact = projectComicPanelCompactSituation(edited, editedPanel);
    assert.match(compact, /우산|현관/);
    assert.doesNotMatch(compact, /^태현이 렌의 손을 잡는다$/);
  });

  it("T9: dialogue collapse parity reflects edited text in compact preview", () => {
    const plan = planWithManyDialogues();
    const edited = updatePanelDialogueAtIndex(plan, 1, 0, { text: "같이 가자." });
    const panel = edited.panels.find((entry) => entry.index === 1);
    assert.ok(panel);

    const preview = projectComicPanelCompactDialoguePreview(panel);
    assert.match(preview.previewLines[0]?.text ?? "", /같이 가자/);
    assert.doesNotMatch(preview.previewLines[0]?.text ?? "", /첫 번째/);
  });

  it("T10: persona hidden parity between generation projection and compact preview", () => {
    const plan = basicTwoPanelPlan();
    const hidden = { personaVisible: false as const };
    const rawEdited = "손목을 붙잡는다 태현과 함께 현관문을 바라본다.";
    const edited = applyUserIllustrationEdits(plan, { heroScene: rawEdited });

    const genScene = formatApprovedScenePlanForIllustration(edited, hidden).match(
      /Hero scene: (.+)/
    )?.[1];
    const compact = projectLdCompactPreviewSummary(edited, hidden);

    assert.ok(genScene);
    assert.doesNotMatch(genScene, /손목을 붙잡는다/);
    assert.doesNotMatch(compact.keyAction, /손목을 붙잡는다/);
  });

  it("T11: untouched long narration keeps chronology-based LD compact helper for AI suggestion path", () => {
    const plan = buildDeterministicScenePlan(longNarrationMessages(), 3);
    const summary = projectLdCompactPreviewSummary(plan);
    assert.ok(summary.keyAction.length <= COMPACT_PREVIEW_KEY_ACTION_MAX + 1);
    assert.match(summary.keyAction, /손목|붙잡/);
    assert.doesNotMatch(summary.keyAction, /복도 불빛/);

    for (const panel of plan.panels) {
      const compact = projectComicPanelCompactSituation(plan, panel);
      assert.doesNotMatch(compact, /…$/);
    }
  });

  it("T12: panel reflow preserves compact preview data for 2/3/4 panels", () => {
    for (const count of [2, 3, 4] as const) {
      const plan = reflowScenePlanPanels(buildDeterministicScenePlan(longNarrationMessages(), 2), count);
      assert.equal(plan.panels.length, count);
      const promptBefore = buildChatComicGenerationPlan({
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
      for (const panel of plan.panels) {
        projectComicPanelCompactSituation(plan, panel);
        projectComicPanelCompactDialoguePreview(panel);
      }
      const promptAfter = buildChatComicGenerationPlan({
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
      assert.equal(promptAfter, promptBefore);
    }
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

describe("chatImageScenePreviewProjection trustworthy UX", () => {
  it("B1: LD default illustration view has no scene preview/status card", () => {
    const source = fs.readFileSync("src/components/ChatSceneBuilder.tsx", "utf8");
    assert.doesNotMatch(source, /장면 정리 완료/);
    assert.doesNotMatch(
      source,
      /배경·인물 참조·장면 행동·대사 연기 정보는 생성 시 함께 반영됩니다/
    );
    assert.doesNotMatch(source, /장면 확인 \/ 수정/);
    assert.doesNotMatch(source, /<h3[^>]*>장면 미리보기<\/h3>/);
    assert.doesNotMatch(source, /outputMode === "illustration" && !sceneEditOpen/);
    assert.doesNotMatch(source, /outputMode === "illustration" && sceneEditOpen/);
    assert.doesNotMatch(source, /LdCompactPreview/);
    assert.doesNotMatch(source, /IllustrationEditor/);
  });

  it("B5: comic situation preview returns complete beat without hard char ellipsis", () => {
    const longBeat = "태형이 송곳니를 드러내며 렌의 손바닥을 입가로 끌어당긴다.";
    const beat = projectCompleteVisualBeat(longBeat);
    assert.doesNotMatch(beat, /…$/);
    assert.match(beat, /끌어당긴다/);
  });

  it("B5a: short normal Korean sentence stays intact", () => {
    const sentence = "태현이 렌의 손을 잡고 문 앞에 선다.";
    const beat = projectCompleteVisualBeat(sentence);
    assert.equal(beat, sentence);
    assert.ok(beat.length <= COMPACT_PREVIEW_SITUATION_MAX + 1);
  });

  it("B5b: long unpunctuated Korean narration projects a complete clause, not full input", () => {
    const longNarration =
      "태현이 복도 끝에서 렌의 손목을 붙잡고 멈춰 서서 숨을 고르며 " +
      "이현이 뒤에서 화살통을 여며 장비를 확인하고 " +
      "태현이 작게 속삭이며 렌의 눈을 바라보고 " +
      "렌은 시선을 피하며 창문 너머 비 내리는 거리를 응시하고 " +
      "태현은 한 걸음 더 다가가 손을 더 세게 쥐며 " +
      "렌은 마침내 고개를 돌려 태현을 바라보고 " +
      "이현은 복도 입구에서 화살을 뽑아 들고 경계하며 " +
      "태현은 렌의 손등에 열이 오른 것을 느끼고 더 단단히 쥐며 " +
      "렌은 떨리는 숨을 몰아쉬고 눈가를 붉히며 " +
      "이현은 멀리서 복도 끝 센서 불빛이 깜빡이는 것을 확인하고 " +
      "태현은 렌의 어깨에 코트를 걸치며 " +
      "렌은 작은 목소리로 돌아가자고 말하고 " +
      "태현은 고개를 끄덕이며 손을 놓지 않고 " +
      "렌은 마침내 몸을 기대며 태현의 품 안에 기댄다";
    assert.ok(longNarration.length >= 300);
    assert.doesNotMatch(longNarration, /[.!?…]/);

    const beat = projectCompleteVisualBeat(longNarration);
    assert.notEqual(beat, longNarration);
    assert.ok(beat.length < longNarration.length);
    assert.ok(beat.length <= COMPACT_PREVIEW_SITUATION_MAX + 24);
    assert.doesNotMatch(beat, /…$/);
    assert.match(beat, /^(태현|렌|이현)/);
    assert.doesNotMatch(beat, /기댄다$/);
  });

  it("B5c: long single sentence with multiple clauses yields bounded visual beat", () => {
    const longSentence =
      "태현이 렌의 손목을 붙잡고 멈춰 서서 숨을 고르며, " +
      "이현이 뒤에서 화살통을 여며 장비를 확인하고, " +
      "태현이 작게 속삭이며 렌의 눈을 바라보고, " +
      "렌은 시선을 피하며 창문 너머 비 내리는 거리를 응시하고, " +
      "태현은 한 걸음 더 다가가 손을 더 세게 쥐며, " +
      "렌은 마침내 고개를 돌려 태현을 바라보고, " +
      "이현은 복도 입구에서 화살을 뽑아 들고 경계하며, " +
      "태현은 렌의 손등에 열이 오른 것을 느끼고 더 단단히 쥐며, " +
      "렌은 떨리는 숨을 몰아쉬고 눈가를 붉히며, " +
      "이현은 멀리서 복도 끝 센서 불빛이 깜빡이는 것을 확인하고, " +
      "태현은 렌의 어깨에 코트를 걸치며, " +
      "렌은 작은 목소리로 돌아가자고 말하고, " +
      "태현은 고개를 끄덕이며 손을 놓지 않고, " +
      "렌은 마침내 몸을 기대며 태현의 품 안에 기댄다.";
    assert.ok(longSentence.length >= 250);

    const beat = projectCompleteVisualBeat(longSentence);
    assert.ok(beat.length <= COMPACT_PREVIEW_SITUATION_MAX + 24);
    assert.notEqual(beat, longSentence);
    assert.doesNotMatch(beat, /…$/);
    assert.match(beat, /태현|손목|붙잡/);
  });

  it("B5d: user-edited long panel.situation uses edit projection without touching generation data", () => {
    const plan = basicTwoPanelPlan();
    const panel = plan.panels[0];
    assert.ok(panel);
    const editedSituation =
      "태현이 렌의 손목을 붙잡고 멈춰 서서 숨을 고르며 " +
      "이현이 뒤에서 화살통을 여며 장비를 확인하고 " +
      "태현이 작게 속삭이며 렌의 눈을 바라본다";
    const edited = applyUserPanelEdits(plan, 1, { situation: editedSituation });
    const editedPanel = edited.panels[0];
    assert.ok(editedPanel);

    const genBeat = projectComicPanelBeat(edited, editedPanel, { personaVisible: true }).situation;
    assert.equal(genBeat, editedSituation);

    const compact = projectComicPanelCompactSituation(edited, editedPanel);
    assert.notEqual(compact, editedSituation);
    assert.ok(compact.length <= COMPACT_PREVIEW_SITUATION_MAX + 24);
    assert.doesNotMatch(compact, /…$/);

    const snapshot = structuredClone(edited);
    projectComicPanelCompactSituation(edited, editedPanel);
    assert.deepEqual(edited, snapshot);
  });

  it("B5e: four-panel long-single-sentence overview stays storyboard-bounded", () => {
    const longClause =
      "태현이 렌의 손목을 붙잡고 멈춰 서서 숨을 고르며 " +
      "이현이 뒤에서 화살통을 여며 장비를 확인하고 " +
      "태현이 작게 속삭이며 렌의 눈을 바라보고 " +
      "렌은 시선을 피하며 창문 너머 비 내리는 거리를 응시하고 " +
      "태현은 한 걸음 더 다가가 손을 더 세게 쥐며 " +
      "렌은 마침내 고개를 돌려 태현을 바라보고 " +
      "이현은 복도 입구에서 화살을 뽑아 들고 경계하며 " +
      "태현은 렌의 손등에 열이 오른 것을 느끼고 더 단단히 쥐며 " +
      "렌은 떨리는 숨을 몰아쉬고 눈가를 붉히며 " +
      "이현은 멀리서 복도 끝 센서 불빛이 깜빡이는 것을 확인하고 " +
      "태현은 렌의 어깨에 코트를 걸치며 " +
      "렌은 작은 목소리로 돌아가자고 말하고 " +
      "태현은 고개를 끄덕이며 손을 놓지 않고 " +
      "렌은 마침내 몸을 기대며 태현의 품 안에 기댄다";
    assert.ok(longClause.length >= 250);
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '*손목을 붙잡는다*\n"가지 마."' },
      { id: 2, role: "assistant", content: longClause },
    ]);
    const plan = buildDeterministicScenePlan(messages, 4);
    for (const panel of plan.panels) {
      panel.situation = longClause;
    }

    let totalCompactChars = 0;
    for (const panel of plan.panels) {
      const compact = projectComicPanelCompactSituation(plan, panel);
      assert.ok(compact.length <= COMPACT_PREVIEW_SITUATION_MAX + 24);
      assert.notEqual(compact, longClause);
      assert.doesNotMatch(compact, /…$/);
      totalCompactChars += compact.length;
    }
    assert.ok(totalCompactChars < longClause.length * 2);
  });

  it("B5: dialogue more label is non-actionable wording", () => {
    const source = fs.readFileSync("src/components/ChatSceneBuilder.tsx", "utf8");
    assert.match(source, /\+{preview\.hiddenCount}개 더 있음/);
    assert.doesNotMatch(source, /\+{preview\.hiddenCount}개 더 보기/);
  });

  it("B8: dialogue preview shows exact canonical text for visible rows", () => {
    const plan = planWithManyDialogues();
    const panel = plan.panels.find((entry) => entry.index === 1);
    assert.ok(panel);
    const preview = projectComicPanelCompactDialoguePreview(panel);
    assert.equal(preview.previewLines[0]?.text, panel.dialogue[0]?.text.trim());
    assert.equal(preview.hiddenCount, panel.dialogue.length - COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES);
  });

  it("B9: long dialogue preview keeps full canonical text without silent truncation", () => {
    const plan = planWithManyDialogues();
    const longLine =
      "이것은 fifty-six characters를 훨씬 넘어서는 매우 긴 대사 문장입니다. 끝까지 전부 보여야 합니다.";
    const edited = updatePanelDialogueAtIndex(plan, 1, 0, { text: longLine });
    const panel = edited.panels.find((entry) => entry.index === 1);
    assert.ok(panel);
    const preview = projectComicPanelCompactDialoguePreview(panel);
    assert.equal(preview.previewLines[0]?.text, longLine);
    assert.doesNotMatch(preview.previewLines[0]?.text ?? "", /…$/);
  });
});
