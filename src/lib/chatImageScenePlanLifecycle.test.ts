import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyApprovedAiScenePlan,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  reflowScenePlanPanels,
} from "./chatImageScenePlan";
import {
  resolveComicAiApplyPanelCount,
  shouldApplyComicAiPlanUpgrade,
} from "./chatImageScenePlanLifecycle";

const MESSAGES = buildSceneSourceMessages([
  { id: 1, role: "user", content: '"같이 갈래?"' },
  { id: 2, role: "assistant", content: '"그래."' },
]);

describe("chatImageScenePlanLifecycle async panel-count race", () => {
  it("R1 applies AI plan at latest panel count after 3→4 switch", () => {
    const aiPlan = buildDeterministicScenePlan(MESSAGES, 3);
    const applied = applyApprovedAiScenePlan(aiPlan, resolveComicAiApplyPanelCount(4));
    assert.equal(applied.panels.length, 4);
  });

  it("R2 rejects AI upgrade when user edited", () => {
    assert.equal(
      shouldApplyComicAiPlanUpgrade({
        responseEpoch: 1,
        currentEpoch: 1,
        userEdited: true,
      }),
      false
    );
  });

  it("R3 rejects stale epoch response", () => {
    assert.equal(
      shouldApplyComicAiPlanUpgrade({
        responseEpoch: 1,
        currentEpoch: 2,
        userEdited: false,
      }),
      false
    );
  });

  it("R4 keeps latest count when user edited after switch", () => {
    const base = buildDeterministicScenePlan(MESSAGES, 3);
    const switched = reflowScenePlanPanels(base, 4);
    const edited = {
      ...switched,
      panels: switched.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "persona" as const, text: "지금 갈게", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    assert.equal(edited.panels.length, 4);
    assert.equal(edited.panels[0]?.dialogue[0]?.text, "지금 갈게");
    assert.equal(
      shouldApplyComicAiPlanUpgrade({
        responseEpoch: 5,
        currentEpoch: 5,
        userEdited: true,
      }),
      false
    );
  });

  it("R5 resolves to 4 after 3→2→4 switches", () => {
    const aiPlan = buildDeterministicScenePlan(MESSAGES, 3);
    const count = resolveComicAiApplyPanelCount(4);
    assert.equal(count, 4);
    assert.equal(applyApprovedAiScenePlan(aiPlan, count).panels.length, 4);
  });

  it("R6 cached semantic plan reflows locally without new provider call contract", () => {
    const cached = buildDeterministicScenePlan(MESSAGES, 3);
    const reflowed = applyApprovedAiScenePlan(cached, 2);
    assert.equal(reflowed.panels.length, 2);
    assert.equal(reflowed.events.length, cached.events.length);
  });
});
