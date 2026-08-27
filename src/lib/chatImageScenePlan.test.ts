import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyUserPanelEdits,
  buildDeterministicScenePlan,
  buildScenePlanPrompt,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  formatApprovedScenePlanForComic,
  formatApprovedScenePlanForIllustration,
  formatSceneSourcePreview,
  planChatImageScene,
  reflowScenePlanPanels,
  sanitizeSceneSourceText,
  scenePlanHasRawChatLeak,
  validateScenePlan,
  type ScenePlan,
  type SceneSourceMessage,
} from "./chatImageScenePlan";

const SOURCE_ROWS = [
  {
    id: 11,
    role: "user" as const,
    content: '*후드 귀를 만진다*\n"같이 갈래?"',
  },
  {
    id: 12,
    role: "assistant" as const,
    content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래." 태형이 자리에서 일어난다.',
  },
];

function sampleMessages(): SceneSourceMessage[] {
  return buildSceneSourceMessages(SOURCE_ROWS);
}

describe("chatImageScenePlan source", () => {
  it("SOURCE_PRESERVATION keeps user action and dialogue", () => {
    const messages = sampleMessages();
    const preview = formatSceneSourcePreview(messages);
    assert.match(preview, /후드 귀를 만진다/);
    assert.match(preview, /같이 갈래\?/);
    assert.doesNotMatch(preview, /STATUS_VALUES/);
  });

  it("SOURCE_PRESERVATION keeps action-only user rows", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*문을 연다*" },
      { id: 2, role: "assistant", content: "문이 열리자 태형이 돌아본다." },
    ]);
    assert.equal(messages[0]?.text.includes("문을 연다"), true);
    assert.equal(messages.length, 2);
  });

  it("SOURCE_PRESERVATION strips STATUS and HTML", () => {
    const text = sanitizeSceneSourceText(
      '<<<STATUS_VALUES{"hp":1}>>> <b>안녕</b> <!-- meta --> *손을 잡는다*'
    );
    assert.match(text, /안녕/);
    assert.match(text, /손을 잡는다/);
    assert.doesNotMatch(text, /STATUS_VALUES/);
    assert.doesNotMatch(text, /<b>/);
    assert.doesNotMatch(text, /<!--/);
  });
});

describe("chatImageScenePlan chronology and echo", () => {
  it("CHRONOLOGY keeps user action → user dialogue → character reaction → character dialogue → character action", () => {
    const events = extractDeterministicEvents(sampleMessages());
    const kinds = events.map((event) => `${event.sourceRole}:${event.kind}`);
    assert.equal(kinds[0], "user:action");
    assert.equal(kinds[1], "user:dialogue");
    assert.ok(kinds.includes("assistant:dialogue"));
    const actionIndex = events.findIndex((event) => event.sourceRole === "user" && event.kind === "action");
    const dialogueIndex = events.findIndex((event) => event.sourceRole === "user" && event.kind === "dialogue");
    assert.ok(actionIndex < dialogueIndex);
  });

  it("ASSISTANT_ECHO dedups recap of the user grab", () => {
    const events = extractDeterministicEvents(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: "*손을 잡는다*" },
        { id: 2, role: "assistant", content: "손을 잡자 상대가 돌아본다." },
      ])
    );
    const echoes = events.filter((event) => event.kind === "assistant_echo");
    const reactions = events.filter((event) => event.kind === "reaction");
    assert.ok(echoes.length + reactions.length >= 1);
    const visual = events.filter((event) => event.kind !== "assistant_echo");
    const grabBeats = visual.filter((event) => /손/.test(event.text) && event.sourceRole === "user");
    assert.equal(grabBeats.length, 1);
    assert.ok(visual.some((event) => /돌아/.test(event.text)));
  });

  it("USER_AGENCY rejects assistant-narrated user speech as persona bubble", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*후드를 잡아당긴다*" },
      { id: 2, role: "assistant", content: '렌이 "미안"이라고 말한 것처럼 태형이 고개를 숙였다.' },
    ]);
    const fallback = buildDeterministicScenePlan(messages, 2);
    const validated = validateScenePlan(
      {
        ...fallback,
        panels: fallback.panels.map((panel, index) =>
          index === 0
            ? {
                ...panel,
                dialogue: [
                  { speaker: "persona", text: "미안", provenance: "source" },
                ],
              }
            : panel
        ),
      },
      messages
    );
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /persona dialogue not in user source/);
    }
  });
});

describe("chatImageScenePlan dialogue and silent panels", () => {
  it("DIALOGUE_PROVENANCE locks persona/character speech and marks user edits", () => {
    const messages = sampleMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const personaLines = plan.panels.flatMap((panel) =>
      panel.dialogue.filter((line) => line.speaker === "persona")
    );
    const characterLines = plan.panels.flatMap((panel) =>
      panel.dialogue.filter((line) => line.speaker === "character")
    );
    assert.ok(personaLines.every((line) => line.text.includes("같이 갈래")));
    assert.ok(characterLines.every((line) => line.text.includes("그래")));
    assert.ok(personaLines.every((line) => line.provenance === "source"));

    const edited = applyUserPanelEdits(plan, plan.panels[0]!.index, {
      dialogue: [{ speaker: "persona", text: "지금 갈게", provenance: "source" }],
    });
    assert.equal(edited.panels[0]?.dialogue[0]?.provenance, "user_edit");
    assert.equal(validateScenePlan(edited, messages).ok, true);
  });

  it("SILENT_SCENE allows 0 dialogue for 2/3/4 panels", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*문을 연다*" },
      { id: 2, role: "assistant", content: "태형이 조용히 따라 나선다." },
    ]);
    for (const count of [2, 3, 4] as const) {
      const plan = buildDeterministicScenePlan(messages, count);
      assert.equal(plan.panels.length, count);
      assert.ok(plan.panels.every((panel) => Array.isArray(panel.dialogue)));
      assert.equal(validateScenePlan(plan, messages).ok, true);
    }
  });
});

describe("chatImageScenePlan panel count and single image", () => {
  it("PANEL_COUNT reflow does not call a provider", async () => {
    const messages = sampleMessages();
    let calls = 0;
    const planned = await planChatImageScene({
      characterName: "태형",
      personaName: "렌",
      messages,
      complete: async () => {
        calls += 1;
        throw new Error("provider unavailable");
      },
    });
    assert.equal(planned.usedFallback, true);
    const two = reflowScenePlanPanels(planned.plan, 2);
    const three = reflowScenePlanPanels(planned.plan, 3);
    const four = reflowScenePlanPanels(planned.plan, 4);
    assert.equal(two.panels.length, 2);
    assert.equal(three.panels.length, 3);
    assert.equal(four.panels.length, 4);
    assert.equal(calls, 2);
    const afterReflowCalls = calls;
    reflowScenePlanPanels(planned.plan, 4);
    assert.equal(calls, afterReflowCalls);
    assert.equal(two.events, planned.plan.events);
  });

  it("SINGLE_IMAGE uses the same Scene Plan owner", () => {
    const plan = buildDeterministicScenePlan(sampleMessages(), 3);
    const illustration = formatApprovedScenePlanForIllustration(plan);
    assert.match(illustration, /Hero scene:/);
    assert.match(illustration, /Background:/);
    assert.doesNotMatch(illustration, /SOURCE PROSE/);
    assert.doesNotMatch(illustration, /Original prose context/);
    assert.equal(scenePlanHasRawChatLeak(illustration), false);
  });

  it("RAW_CHAT_REINJECTION is absent from approved comic/illustration prompts", () => {
    const plan = buildDeterministicScenePlan(sampleMessages(), 3);
    const comic = formatApprovedScenePlanForComic(plan);
    const illustration = formatApprovedScenePlanForIllustration(plan);
    assert.equal(scenePlanHasRawChatLeak(comic), false);
    assert.equal(scenePlanHasRawChatLeak(illustration), false);
    assert.doesNotMatch(comic, /후드 귀를 만진다\*\n/);
    assert.match(comic, /PANEL 1/);
  });

  it("planner prompt forbids identity ownership and invented user speech", () => {
    const prompt = buildScenePlanPrompt({
      characterName: "태형",
      personaName: "렌",
      messages: sampleMessages(),
    });
    assert.match(prompt, /Never invent user dialogue/);
    assert.match(prompt, /Do not describe hair color/);
    assert.match(prompt, /iris, pupil/);
    assert.doesNotMatch(prompt, /TEXT QUOTA/);
    assert.doesNotMatch(prompt, /gpt-4o-mini/);
  });

  it("invalid AI plans fail closed without repair and fall back deterministically", async () => {
    const messages = sampleMessages();
    const result = await planChatImageScene({
      characterName: "태형",
      personaName: "렌",
      messages,
      complete: async () =>
        JSON.stringify({
          sceneBackground: " dist ",
          events: [],
          heroEventIds: [],
          heroScene: "",
          recommendedPanelCount: 3,
          panels: [],
        }),
    });
    assert.equal(result.usedFallback, true);
    assert.equal(result.model, "deterministic-fallback");
    assert.ok(result.plan.events.length > 0);
  });
});

describe("chatImageScenePlan validator", () => {
  it("rejects reversed panel chronology", () => {
    const messages = sampleMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const reversed: ScenePlan = {
      ...plan,
      panels: [
        { ...plan.panels[0]!, sourceEventIds: [plan.events.at(-1)!.id] },
        { ...plan.panels[1]!, sourceEventIds: [plan.events[0]!.id] },
      ],
    };
    const validated = validateScenePlan(reversed, messages);
    assert.equal(validated.ok, false);
  });
});
