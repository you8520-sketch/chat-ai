import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyUserPanelEdits,
  buildDeterministicScenePlan,
  buildScenePlanPrompt,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  extractOrderedSceneSegments,
  formatApprovedScenePlanForComic,
  formatApprovedScenePlanForIllustration,
  formatSceneSourcePreview,
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

describe("chatImageScenePlan intra-message source order", () => {
  function userKinds(text: string): string[] {
    return extractOrderedSceneSegments(text, "user").map((segment) => segment.kind);
  }

  it("CASE A action before dialogue preserves source order", () => {
    const segments = extractOrderedSceneSegments('*두리번거린다* "같이 갈래?"', "user");
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ["action", "dialogue"]
    );
    assert.ok(segments[0]!.start < segments[1]!.start);
    const events = extractDeterministicEvents(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '*두리번거린다* "같이 갈래?"' }])
    );
    assert.equal(events[0]?.kind, "action");
    assert.equal(events[1]?.kind, "dialogue");
  });

  it("CASE B dialogue before action preserves source order", () => {
    const segments = extractOrderedSceneSegments('"같이 갈래?" *두리번거린다*', "user");
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ["dialogue", "action"]
    );
    assert.ok(segments[0]!.start < segments[1]!.start);
    assert.deepEqual(userKinds('"같이 갈래?" *두리번거린다*'), ["dialogue", "action"]);
  });

  it("CASE C dialogue-action-dialogue preserves source order", () => {
    const text = '"잠깐." *문을 연다* "가자."';
    assert.deepEqual(userKinds(text), ["dialogue", "action", "dialogue"]);
    const events = extractDeterministicEvents(
      buildSceneSourceMessages([{ id: 1, role: "user", content: text }])
    );
    assert.deepEqual(
      events.map((event) => event.kind),
      ["dialogue", "action", "dialogue"]
    );
  });

  it("CASE D assistant narration-dialogue-reaction preserves source order", () => {
    const text = '태형이 고개를 든다. "그래." 자리에서 일어난다.';
    const segments = extractOrderedSceneSegments(text, "assistant");
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ["narration", "dialogue", "narration"]
    );
    const events = extractDeterministicEvents(
      buildSceneSourceMessages([{ id: 1, role: "assistant", content: text }])
    );
    assert.equal(events[0]?.kind, "reaction");
    assert.equal(events[1]?.kind, "dialogue");
    assert.equal(events[2]?.kind, "reaction");
    assert.ok(events[0]!.order < events[1]!.order && events[1]!.order < events[2]!.order);
  });

  it("CASE E assistant dialogue before reaction preserves source order", () => {
    const text = '"그래." 태형이 자리에서 일어난다.';
    assert.deepEqual(
      extractOrderedSceneSegments(text, "assistant").map((segment) => segment.kind),
      ["dialogue", "narration"]
    );
    const events = extractDeterministicEvents(
      buildSceneSourceMessages([{ id: 1, role: "assistant", content: text }])
    );
    assert.equal(events[0]?.kind, "dialogue");
    assert.equal(events[1]?.kind, "reaction");
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
    assert.equal(
      validateScenePlan(edited, messages, { allowUserEdits: true }).ok,
      true
    );
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
  it("PANEL_COUNT reflow is local and keeps the same events", () => {
    const messages = sampleMessages();
    const planned = buildDeterministicScenePlan(messages, 3);
    const two = reflowScenePlanPanels(planned, 2);
    const three = reflowScenePlanPanels(planned, 3);
    const four = reflowScenePlanPanels(planned, 4);
    assert.equal(two.panels.length, 2);
    assert.equal(three.panels.length, 3);
    assert.equal(four.panels.length, 4);
    assert.equal(two.events, planned.events);
    assert.equal(three.events, planned.events);
    assert.equal(four.events, planned.events);
    assert.equal(two.heroScene, planned.heroScene);
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
});

describe("chatImageScenePlan validator", () => {
  it("AI_INVENTED_USER_EDIT rejects planner provenance without source backing", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*손을 잡는다*" },
      { id: 2, role: "assistant", content: "태형이 고개를 숙인다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const forged = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [
                { speaker: "persona", text: "그래 좋아", provenance: "user_edit" },
              ],
            }
          : panel
      ),
    };
    const plannerCheck = validateScenePlan(forged, messages, { allowUserEdits: false });
    assert.equal(plannerCheck.ok, false);
    if (!plannerCheck.ok) {
      assert.match(plannerCheck.reason, /user_edit not allowed from planner/);
    }
    const clientCheck = validateScenePlan(forged, messages, { allowUserEdits: true });
    assert.equal(clientCheck.ok, true);
  });

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
