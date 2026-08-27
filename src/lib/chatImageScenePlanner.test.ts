import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSceneSourceMessages, reflowScenePlanPanels } from "./chatImageScenePlan";
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
});
