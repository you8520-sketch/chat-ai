import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyUserPanelEdits,
  buildDeterministicScenePlan,
  buildScenePlanPrompt,
  buildSceneSourceMessages,
  buildUserFacingVisualDescription,
  extractDeterministicEvents,
  extractOrderedSceneSegments,
  formatApprovedScenePlanForComic,
  formatApprovedScenePlanForIllustration,
  formatSceneSourcePreview,
  projectUserFacingHeroScene,
  reflowScenePlanPanels,
  sanitizeSceneSourceText,
  scenePlanHasRawChatLeak,
  validateScenePlan,
  visualEvents,
  type ScenePlan,
  type SceneSourceMessage,
} from "./chatImageScenePlan";
import { validateCastMentions } from "./chatImageCast";

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
      assert.match(
        validated.reason,
        /dialogue sourceEventId missing|dialogue sourceEvent mismatch|dialogue text mismatch|dialogue speaker ownership mismatch/
      );
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
    assert.match(prompt, /CANONICAL EVENTS/);
    assert.match(prompt, /Do not return an events array/);
    assert.match(prompt, /assistant_echo classification is server-owned/);
    assert.match(prompt, /Do not describe hair color/);
    assert.match(prompt, /iris, pupil/);
    assert.doesNotMatch(prompt, /TEXT QUOTA/);
    assert.doesNotMatch(prompt, /gpt-4o-mini/);
  });
});

describe("chatImageScenePlan source grounding", () => {
  const chronologyMessages = () =>
    buildSceneSourceMessages([
      { id: 1, role: "user", content: '"잠깐." *문을 연다* "가자."' },
    ]);

  function planFromEvents(
    messages: SceneSourceMessage[],
    events: ScenePlan["events"]
  ): ScenePlan {
    const base = buildDeterministicScenePlan(messages, 2);
    const groups = [[events[0]], events.slice(1)].filter((group) => group.length);
    return {
      ...base,
      events,
      heroEventIds: events.filter((event) => event.kind !== "assistant_echo").map((event) => event.id),
      heroScene: events.map((event) => event.text).join(" "),
      panels: groups.map((group, index) => ({
        index: index + 1,
        sourceEventIds: group.map((event) => event.id),
        situation: group.map((event) => event.text).join(" "),
        dialogue: group
          .filter((event) => event.kind === "dialogue")
          .map((event) => ({
            speaker: event.actor === "persona" ? ("persona" as const) : ("character" as const),
            text: event.text,
            sourceEventId: event.id,
            provenance: "source" as const,
          })),
      })),
    };
  }

  it("AI_VALID_SHAPE_BUT_REORDERED rejects chronology that ignores source span order", () => {
    const messages = chronologyMessages();
    const base = buildDeterministicScenePlan(messages, 2);
    const byText = new Map(base.events.map((event) => [event.text, event]));
    const reordered = planFromEvents(messages, [
      { ...byText.get("가자.")!, order: 1 },
      { ...byText.get("문을 연다")!, order: 2 },
      { ...byText.get("잠깐.")!, order: 3 },
    ]);
    const validated = validateScenePlan(reordered, messages);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /canonical event mismatch|event omission/);
    }
  });

  it("AI_INVENTED_ACTION rejects non-source action text", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*문을 연다*" },
    ]);
    const forged = planFromEvents(messages, [
      {
        id: "E1",
        order: 1,
        sourceMessageId: 1,
        sourceRole: "user",
        kind: "action",
        actor: "persona",
        text: "칼을 꺼낸다",
        segmentKind: "action",
      },
    ]);
    const validated = validateScenePlan(forged, messages);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /canonical event mismatch|event omission/);
    }
  });

  it("AI_INVENTED_REACTION rejects paraphrased assistant reaction text", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "태형이 고개를 든다." },
    ]);
    const forged = planFromEvents(messages, [
      {
        id: "E1",
        order: 1,
        sourceMessageId: 1,
        sourceRole: "assistant",
        kind: "reaction",
        actor: "character",
        text: "태형이 렌을 끌어안는다.",
        segmentKind: "narration",
      },
    ]);
    const validated = validateScenePlan(forged, messages);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /canonical event mismatch|event omission/);
    }
  });

  it("WRONG_DIALOGUE_SOURCE_EVENT rejects persona dialogue bound to the wrong event", () => {
    const messages = sampleMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const personaEvent = plan.events.find(
      (event) => event.kind === "dialogue" && event.actor === "persona"
    );
    const characterEvent = plan.events.find(
      (event) => event.kind === "dialogue" && event.actor === "character"
    );
    assert.ok(personaEvent && characterEvent);
    const forged = {
      ...plan,
      panels: plan.panels.map((panel) => ({
        ...panel,
        dialogue: panel.dialogue.map((line) =>
          line.speaker === "persona"
            ? {
                ...line,
                sourceEventId: characterEvent.id,
              }
            : line
        ),
      })),
    };
    const validated = validateScenePlan(forged, messages);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(
        validated.reason,
        /dialogue text mismatch|dialogue speaker ownership mismatch|dialogue sourceEvent mismatch/
      );
    }
  });

  it("VALID_EXACT_ORDER accepts exact source order and verbatim excerpts", () => {
    const messages = chronologyMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const validated = validateScenePlan(plan, messages);
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.deepEqual(
        validated.plan.events.map((event) => event.text),
        ["잠깐.", "문을 연다", "가자."]
      );
      assert.deepEqual(
        validated.plan.events.map((event) => event.order),
        [1, 2, 3]
      );
    }
  });

  it("CLIENT_USER_EDIT allows panel dialogue edits while canonical events stay source-backed", () => {
    const messages = sampleMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const edited = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "persona" as const, text: "지금 갈게", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(edited, messages, { allowUserEdits: true });
    assert.equal(validated.ok, true);
  });

  it("CLIENT_EVENT_REWRITE rejects canonical event rewrites even with allowUserEdits", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*문을 연다*" },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const forged = {
      ...plan,
      events: plan.events.map((event) =>
        event.kind === "action" ? { ...event, text: "창문을 연다" } : event
      ),
    };
    const validated = validateScenePlan(forged, messages, { allowUserEdits: true });
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /canonical event mismatch|event omission/);
    }
  });
});

describe("chatImageScenePlan canonical events", () => {
  const chronologyMessages = () =>
    buildSceneSourceMessages([
      { id: 1, role: "user", content: '"잠깐." *문을 연다* "가자."' },
    ]);

  it("EVENT_OMISSION rejects planner events missing a canonical beat", () => {
    const messages = chronologyMessages();
    const canonical = buildDeterministicScenePlan(messages, 2);
    const byText = new Map(canonical.events.map((event) => [event.text, event]));
    const omitted = {
      ...canonical,
      events: [byText.get("잠깐.")!, byText.get("가자.")!],
    };
    const validated = validateScenePlan(omitted, messages);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /event omission/);
    }
  });

  it("PANEL_EVENT_OMISSION rejects panels that skip a visual canonical event", () => {
    const messages = chronologyMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const byId = new Map(plan.events.map((event) => [event.text, event.id]));
    const omitted = {
      ...plan,
      panels: [
        { ...plan.panels[0]!, sourceEventIds: [byId.get("잠깐.")!], index: 1 },
        { ...plan.panels[1]!, sourceEventIds: [byId.get("가자.")!], index: 2 },
      ],
    };
    const validated = validateScenePlan(omitted, messages);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /panel visual event omission/);
    }
  });

  it("PANEL_EVENT_EXACT_COVERAGE accepts contiguous grouping with full coverage", () => {
    const messages = chronologyMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const byId = new Map(plan.events.map((event) => [event.text, event.id]));
    const grouped = {
      ...plan,
      panels: [
        {
          ...plan.panels[0]!,
          index: 1,
          sourceEventIds: [byId.get("잠깐.")!, byId.get("문을 연다")!],
        },
        {
          ...plan.panels[1]!,
          index: 2,
          sourceEventIds: [byId.get("가자.")!],
        },
      ],
    };
    const validated = validateScenePlan(grouped, messages);
    assert.equal(validated.ok, true);
  });

  it("FALSE_ASSISTANT_ECHO keeps server reaction when planner claims assistant_echo", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*문을 연다*" },
      { id: 2, role: "assistant", content: "태형이 렌의 손목을 붙잡았다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const assistantEvent = plan.events.find((event) => event.sourceRole === "assistant");
    assert.ok(assistantEvent);
    assert.equal(assistantEvent.kind, "reaction");
    const forged = {
      ...plan,
      events: plan.events.map((event) =>
        event.id === assistantEvent.id ? { ...event, kind: "assistant_echo" as const } : event
      ),
    };
    const validated = validateScenePlan(forged, messages);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /assistant_echo not allowed from planner/);
    }
  });

  it("TRUE_ASSISTANT_ECHO dedups recap and keeps new reaction", () => {
    const events = extractDeterministicEvents(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: "*손을 잡는다*" },
        { id: 2, role: "assistant", content: "손을 잡자 태형이 고개를 돌렸다." },
      ])
    );
    const echoes = events.filter((event) => event.kind === "assistant_echo");
    const visual = visualEvents(events);
    assert.ok(echoes.length >= 1);
    assert.ok(visual.some((event) => /고개/.test(event.text)));
    const grabBeats = visual.filter((event) => /손/.test(event.text) && event.sourceRole === "user");
    assert.equal(grabBeats.length, 1);
  });

  it("USER_ACTION_NEVER_DROPPED keeps action-only user beats in canonical and panel coverage", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*문을 연다*" },
      { id: 2, role: "assistant", content: "태형이 조용히 따라 나선다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    assert.ok(plan.events.some((event) => event.kind === "action" && event.text === "문을 연다"));
    const validated = validateScenePlan(plan, messages);
    assert.equal(validated.ok, true);
    if (validated.ok) {
      const covered = validated.plan.panels.flatMap((panel) => panel.sourceEventIds);
      const actionId = plan.events.find((event) => event.text === "문을 연다")!.id;
      assert.ok(covered.includes(actionId));
    }
  });

  it("FOUR_PANEL_COVERAGE reflows all visual events exactly once", () => {
    const messages = sampleMessages();
    const three = buildDeterministicScenePlan(messages, 3);
    const four = reflowScenePlanPanels(three, 4);
    const validated = validateScenePlan(four, messages);
    assert.equal(validated.ok, true);
    if (validated.ok) {
      const required = visualEvents(validated.plan.events).map((event) => event.id);
      const covered = validated.plan.panels.flatMap((panel) => panel.sourceEventIds);
      assert.deepEqual([...new Set(covered)].sort(), [...required].sort());
      assert.equal(covered.length, required.length);
    }
  });

  it("CLIENT_USER_EDIT keeps canonical coverage while allowing panel dialogue edits", () => {
    const messages = sampleMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const edited = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "persona" as const, text: "지금 갈게", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(edited, messages, { allowUserEdits: true });
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.equal(validated.plan.events.length, plan.events.length);
    }
  });

  it("validateScenePlan omits events array and still returns server canonical events", () => {
    const messages = chronologyMessages();
    const plan = buildDeterministicScenePlan(messages, 2);
    const { events: _events, ...withoutEvents } = plan;
    const validated = validateScenePlan(withoutEvents, messages);
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.deepEqual(
        validated.plan.events.map((event) => event.text),
        ["잠깐.", "문을 연다", "가자."]
      );
    }
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

  it("castMentions exclude persona/main reserved names and unknown events", () => {
    const messages = sampleMessages();
    const canonical = extractDeterministicEvents(messages);
    const mentions = validateCastMentions(
      [
        { name: "태형", sourceEventIds: [canonical[1]!.id] },
        { name: "Unknown", sourceEventIds: ["E999"] },
      ],
      canonical,
      ["태형", "렌"]
    );
    assert.deepEqual(mentions, []);
  });
});

describe("chatImageScenePlan user-facing scene description", () => {
  const ATTRIBUTION_FIXTURE =
    '태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.';

  function assertSceneDescriptionInvariants(opts: {
    messages: ReturnType<typeof buildSceneSourceMessages>;
    forbiddenInDescription: RegExp[];
    requiredInDescription?: RegExp;
    requiredDialogue?: string[];
    heroMustIncludeDialogue?: boolean;
  }) {
    const plan = buildDeterministicScenePlan(opts.messages, 2);
    const illustration = formatApprovedScenePlanForIllustration(plan);
    for (const pattern of opts.forbiddenInDescription) {
      assert.doesNotMatch(plan.heroScene, pattern);
      assert.doesNotMatch(plan.heroScene, /라고 말했다/);
    }
    if (opts.requiredInDescription) {
      assert.match(plan.heroScene, opts.requiredInDescription);
    }
    if (opts.requiredDialogue?.length) {
      for (const line of opts.requiredDialogue) {
        assert.ok(
          plan.events.some((event) => event.kind === "dialogue" && event.text.includes(line)),
          `canonical dialogue missing: ${line}`
        );
        assert.ok(
          illustration.includes(line) || plan.panels.some((panel) =>
            panel.dialogue.some((row) => row.text.includes(line))
          ),
          `downstream dialogue missing: ${line}`
        );
      }
    }
    if (opts.heroMustIncludeDialogue) {
      const heroDialogue = plan.heroEventIds
        .map((id) => plan.events.find((event) => event.id === id))
        .filter((event) => event?.kind === "dialogue");
      assert.ok(heroDialogue.length > 0, "heroEventIds should preserve dialogue events");
    }
    assert.match(illustration, /Hero scene:/);
    assert.doesNotMatch(illustration, /SOURCE PROSE/);
  }

  it("CASE A narration + dialogue — natural visual, no dangling attribution", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: ATTRIBUTION_FIXTURE },
    ]);
    assertSceneDescriptionInvariants({
      messages,
      forbiddenInDescription: [/가지 마/, /라고 말했다/],
      requiredInDescription: /손목|붙잡/,
      requiredDialogue: ["가지 마"],
    });
    const events = extractDeterministicEvents(messages);
    assert.ok(events.some((event) => event.text.includes("붙잡")));
    assert.ok(events.some((event) => event.kind === "dialogue" && event.text.includes("가지 마")));
    assert.equal(
      events.some((event) => /라고 말했다/.test(event.text)),
      false,
      "NO_DANGLING_SPEECH_ATTRIBUTION"
    );
  });

  it("CASE B split-line dialogue after narration cue", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: '태현은 렌을 바라보며 말했다.\n"가지 마."' },
    ]);
    assertSceneDescriptionInvariants({
      messages,
      forbiddenInDescription: [/가지 마/],
      requiredInDescription: /바라/,
      requiredDialogue: ["가지 마"],
    });
  });

  it("CASE C dialogue before action", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: '"가지 마."\n태현이 렌의 손목을 붙잡았다.' },
    ]);
    assertSceneDescriptionInvariants({
      messages,
      forbiddenInDescription: [/가지 마/],
      requiredInDescription: /손목|붙잡/,
      requiredDialogue: ["가지 마"],
    });
  });

  it("CASE D dialogue-only turn still produces plan", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"여기서 기다릴게."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    assert.ok(plan.heroEventIds.length > 0);
    const illustration = formatApprovedScenePlanForIllustration(plan);
    assert.match(illustration, /Key dialogue/);
    assert.match(illustration, /여기서 기다릴게/);
  });

  it("CASE E action + dialogue + reaction + follow-up action", () => {
    assertSceneDescriptionInvariants({
      messages: sampleMessages(),
      forbiddenInDescription: [/같이 갈래/, /그래/],
      requiredDialogue: ["같이 갈래", "그래"],
      heroMustIncludeDialogue: true,
    });
  });

  it("CASE F dialogue-heavy long assistant turn", () => {
    const messages = buildSceneSourceMessages([
      {
        id: 1,
        role: "assistant",
        content: '"안녕?" "뭐 해?" "같이 갈래?" "지금?" "좋아."',
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 3);
    assert.equal(plan.heroScene, "");
    assert.ok(plan.events.filter((event) => event.kind === "dialogue").length >= 3);
  });

  it("CASE G status / HTML markup mixed source", () => {
    const messages = buildSceneSourceMessages([
      {
        id: 1,
        role: "assistant",
        content: '<<<STATUS_VALUES{"mood":"tense"}>>> *고개를 든다* "괜찮아?"',
      },
    ]);
    assertSceneDescriptionInvariants({
      messages,
      forbiddenInDescription: [/STATUS_VALUES/, /괜찮아/],
      requiredInDescription: /고개/,
      requiredDialogue: ["괜찮아"],
    });
  });

  it("CASE H heroEventIds preserve dialogue for Key dialogue downstream", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"여기서 기다릴게."' },
      { id: 2, role: "assistant", content: "*미소 지으며 고개를 끄덕인다.*" },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    assert.ok(
      plan.heroEventIds.some(
        (id) => plan.events.find((event) => event.id === id)?.kind === "dialogue"
      )
    );
    assert.match(plan.heroScene, /미소|고개/);
    assert.doesNotMatch(plan.heroScene, /여기서 기다릴게/);
    const illustration = formatApprovedScenePlanForIllustration(plan);
    assert.match(illustration, /Key dialogue/);
    assert.match(illustration, /여기서 기다릴게/);
  });

  it("planner validation derives visual heroScene without regex stripping", () => {
    const messages = sampleMessages();
    const forged = {
      ...buildDeterministicScenePlan(messages, 2),
      heroScene: '후드 귀를 만진다 "같이 갈래?" 그래.',
    };
    const validated = validateScenePlan(forged, messages);
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.doesNotMatch(validated.plan.heroScene, /같이 갈래/);
      assert.match(validated.plan.heroScene, /후드|고개/);
      assert.ok(
        validated.plan.heroEventIds.some(
          (id) =>
            validated.plan.events.find((event) => event.id === id)?.kind === "dialogue"
        )
      );
    }
  });

  it("projectUserFacingHeroScene matches buildUserFacingVisualDescription from hero ids", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "assistant", content: ATTRIBUTION_FIXTURE },
      ]),
      2
    );
    assert.equal(projectUserFacingHeroScene(plan), plan.heroScene);
  });
});

describe("validateScenePlan user_edit provenance (UE1-UE6)", () => {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "assistant", content: '"안녕."' },
  ]);

  it("UE1: user_edit noun phrase 살상 무기 is preserved", () => {
    const plan = buildDeterministicScenePlan(messages, 2);
    const edited = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "character" as const, text: "살상 무기", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(edited, messages, { allowUserEdits: true });
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.equal(validated.plan.panels[0]!.dialogue[0]?.text, "살상 무기");
    }
  });

  it("UE2: user_edit 접근 금지 is preserved", () => {
    const plan = buildDeterministicScenePlan(messages, 2);
    const edited = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "persona" as const, text: "접근 금지", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(edited, messages, { allowUserEdits: true });
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.equal(validated.plan.panels[0]!.dialogue[0]?.text, "접근 금지");
    }
  });

  it("UE3: source unquoted noun fragment is not automatic speech", () => {
    const sourceMessages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "*검을 든다* 살상 무기" },
    ]);
    const plan = buildDeterministicScenePlan(sourceMessages, 2);
    const dialogue = plan.panels.flatMap((panel) => panel.dialogue);
    assert.equal(dialogue.some((line) => line.text === "살상 무기"), false);
  });

  it("UE4: source sign label quote is not speech", () => {
    const sourceMessages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: '"접근 금지"라고 적힌 표지판' },
    ]);
    const plan = buildDeterministicScenePlan(sourceMessages, 2);
    const dialogue = plan.panels.flatMap((panel) => panel.dialogue);
    assert.equal(dialogue.some((line) => line.text.includes("접근 금지")), false);
  });

  it("UE5: empty user_edit string is not rendered", () => {
    const plan = buildDeterministicScenePlan(messages, 2);
    const edited = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "persona" as const, text: "", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(edited, messages, { allowUserEdits: true });
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.equal(validated.plan.panels[0]!.dialogue.length, 0);
    }
  });

  it("UE6: forged user_edit rejected when allowUserEdits=false", () => {
    const plan = buildDeterministicScenePlan(messages, 2);
    const forged = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "persona" as const, text: "위조", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(forged, messages, { allowUserEdits: false });
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.match(validated.reason, /user_edit not allowed from planner/);
    }
  });
});
