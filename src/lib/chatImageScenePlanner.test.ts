import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  reflowScenePlanPanels,
} from "./chatImageScenePlan";
import { planChatImageScene } from "./chatImageScenePlanner";

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

describe("chatImageScenePlanner", () => {
  it("invalid AI plans fail closed without repair and fall back deterministically", async () => {
    const messages = buildSceneSourceMessages(SOURCE_ROWS);
    const result = await planChatImageScene({
      characterName: "태형",
      personaName: "렌",
      messages,
      complete: async () =>
        JSON.stringify({
          sceneBackground: "거리",
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

  it("panel-count reflow after a mocked planner does not add provider calls", async () => {
    const messages = buildSceneSourceMessages(SOURCE_ROWS);
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
    assert.equal(calls, 2);
    const afterPlannerCalls = calls;
    const two = reflowScenePlanPanels(planned.plan, 2);
    const four = reflowScenePlanPanels(planned.plan, 4);
    assert.equal(two.panels.length, 2);
    assert.equal(four.panels.length, 4);
    assert.equal(calls, afterPlannerCalls);
    assert.equal(two.events, planned.plan.events);
  });

  it("FALLBACK_SUCCESS marks usedFallback when the secondary model validates", async () => {
    const messages = buildSceneSourceMessages(SOURCE_ROWS);
    const goodPlan = buildDeterministicScenePlan(messages, 2);
    let call = 0;
    let secondModel = "";
    const result = await planChatImageScene({
      characterName: "태형",
      personaName: "렌",
      messages,
      complete: async ({ model }) => {
        call += 1;
        if (call === 1) {
          return JSON.stringify({ events: [], panels: [] });
        }
        secondModel = model;
        return JSON.stringify(goodPlan);
      },
    });
    assert.equal(call, 2);
    assert.equal(result.model, secondModel);
    assert.equal(result.usedFallback, true);
    assert.equal(result.plan.panels.length, 2);
  });

  it("AI_VALID_SHAPE_BUT_REORDERED fails planner validation and falls back deterministically", async () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"잠깐." *문을 연다* "가자."' },
    ]);
    const base = buildDeterministicScenePlan(messages, 2);
    const byText = new Map(base.events.map((event) => [event.text, event]));
    const reordered = {
      ...base,
      events: [
        { ...byText.get("가자.")!, order: 1 },
        { ...byText.get("문을 연다")!, order: 2 },
        { ...byText.get("잠깐.")!, order: 3 },
      ],
    };
    const result = await planChatImageScene({
      characterName: "태형",
      personaName: "렌",
      messages,
      complete: async () => JSON.stringify(reordered),
    });
    assert.equal(result.usedFallback, true);
    assert.equal(result.model, "deterministic-fallback");
    assert.deepEqual(
      result.plan.events.map((event) => event.text),
      ["잠깐.", "문을 연다", "가자."]
    );
  });

  it("AI_INVENTED_USER_EDIT fails planner validation and falls back deterministically", async () => {
    const messages = buildSceneSourceMessages(SOURCE_ROWS);
    const forged = buildDeterministicScenePlan(messages, 2);
    forged.panels[0]!.dialogue = [
      { speaker: "persona", text: "그래 좋아", provenance: "user_edit" },
    ];
    const result = await planChatImageScene({
      characterName: "태형",
      personaName: "렌",
      messages,
      complete: async () => JSON.stringify(forged),
    });
    assert.equal(result.usedFallback, true);
    assert.equal(result.model, "deterministic-fallback");
    assert.ok(result.plan.events.length > 0);
    assert.doesNotMatch(
      result.plan.panels.flatMap((panel) => panel.dialogue.map((line) => line.text)).join(" "),
      /그래 좋아/
    );
  });
});
