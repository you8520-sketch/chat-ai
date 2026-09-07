import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyApprovedAiScenePlan,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  reflowScenePlanPanels,
  resolveComicHighlightSelectionSource,
} from "./chatImageScenePlan";
import {
  commitScenePanelCount,
  resolveComicAiApplyPanelCount,
} from "./chatImageScenePlanLifecycle";

const MESSAGES = buildSceneSourceMessages([
  { id: 1, role: "user", content: '"같이 갈래?"' },
  { id: 2, role: "assistant", content: '"그래."' },
]);

describe("chatImageScenePlanLifecycle — normal comic generate lifecycle", () => {
  it("R0 sync panel-count write updates ref before async apply", () => {
    const ref = { current: 3 as const };
    let state = 3 as const;
    const setState = (count: typeof state) => {
      state = count;
    };
    commitScenePanelCount(ref, 4, setState);
    assert.equal(ref.current, 4);
    assert.equal(state, 4);
    assert.equal(resolveComicAiApplyPanelCount(ref.current), 4);
  });

  it("R1 applies AI plan at latest panel count after 3→4 switch", () => {
    const aiPlan = buildDeterministicScenePlan(MESSAGES, 3);
    const applied = applyApprovedAiScenePlan(aiPlan, resolveComicAiApplyPanelCount(4));
    assert.equal(applied.panels.length, 4);
  });

  it("R6 cached semantic plan reflows locally without new provider call contract", () => {
    const cached = buildDeterministicScenePlan(MESSAGES, 3);
    const reflowed = applyApprovedAiScenePlan(cached, 2);
    assert.equal(reflowed.panels.length, 2);
    assert.equal(reflowed.events.length, cached.events.length);
  });

  it("STALE-2 panel mode change before click → click-time mode is used (plan count reflowed at click time, never baked in)", () => {
    const base = buildDeterministicScenePlan(MESSAGES, 3);
    const atClick = reflowScenePlanPanels(base, 4);
    assert.equal(atClick.panels.length, 4);
    const backTo3 = reflowScenePlanPanels(atClick, 3);
    assert.equal(backTo3.panels.length, 3);
  });

  it("deterministic plan + attached highlight reads scene_planner; bare plan reads deterministic_fallback", () => {
    const base = buildDeterministicScenePlan(MESSAGES, undefined, {
      personaName: "렌",
      characterName: "태형",
    });
    assert.equal(resolveComicHighlightSelectionSource(base), "deterministic_fallback");
    assert.equal(
      resolveComicHighlightSelectionSource({
        ...base,
        comicHighlightSelection: { anchorEventId: "E2", focusEventIds: ["E1", "E2"] },
      }),
      "scene_planner"
    );
  });
});