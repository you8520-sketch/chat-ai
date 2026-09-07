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
import { planChatImageScene } from "./chatImageScenePlanner";

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

  it("LIFECYCLE-3 click generate → Scene Planner invoked exactly once (single planChatImageScene call, one primary completer invocation)", async () => {
    let completerCalls = 0;
    const result = await planChatImageScene({
      scenePlanIntent: "comic",
      characterName: "태형",
      personaName: "렌",
      messages: MESSAGES,
      speakerContext: { personaName: "렌", characterName: "태형" },
      complete: async (opts) => {
        completerCalls += 1;
        assert.match(opts.system, /comic scene selector/, "generate-time planner uses highlight-selector-only system");
        return JSON.stringify({ anchorEventId: "E2", focusEventIds: ["E1", "E2"] });
      },
    });
    assert.equal(completerCalls, 1, "one planner invocation per generate");
    assert.equal(result.usedFallback, false);
    assert.equal(result.plan.comicHighlightSelection?.anchorEventId, "E2");
    assert.equal(resolveComicHighlightSelectionSource(result.plan), "scene_planner");
  });

  it("LIFECYCLE-4 planner recovery — invalid selection never reaches provider; deterministic fallback plan only", async () => {
    const result = await planChatImageScene({
      scenePlanIntent: "comic",
      characterName: "태형",
      personaName: "렌",
      messages: MESSAGES,
      speakerContext: { personaName: "렌", characterName: "태형" },
      complete: async () => JSON.stringify({ anchorEventId: "E2", focusEventIds: ["E9999"] }),
    });
    assert.equal(result.model, "deterministic-fallback");
    assert.equal(result.usedFallback, true);
    assert.equal(result.plan.comicHighlightSelection, undefined);
    assert.equal(resolveComicHighlightSelectionSource(result.plan), "deterministic_fallback");
  });

  it("LIFECYCLE-3/4 empty source → planner throws before any provider work (image 0, settlement 0 by construction)", async () => {
    await assert.rejects(
      planChatImageScene({
        scenePlanIntent: "comic",
        characterName: "태형",
        personaName: "렌",
        messages: [],
        complete: async () => "{}",
      }),
      /턴 내용이 없습니다/u
    );
  });

  it("STALE-2 panel mode change before click → click-time mode is used (planner independent; plan count not baked into request)", () => {
    // The generate request sends comicPanelMode at click time; the deterministic
    // base plan is reflowed at click-time panel count, never at source-load time.
    const base = buildDeterministicScenePlan(MESSAGES, 3);
    const atClick = reflowScenePlanPanels(base, 4);
    assert.equal(atClick.panels.length, 4);
    const backTo3 = reflowScenePlanPanels(atClick, 3);
    assert.equal(backTo3.panels.length, 3);
  });
});