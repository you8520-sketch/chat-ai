import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE,
  resolveChatComicOutputSize,
  resolveChatComicPrice,
} from "./chatComicGenerationConstants";
import { buildChatComicImagePrompt, FULL_SOURCE_DIRECT_CONTENT_CONTRACT } from "./chatComicGeneration";
import {
  assertComicDiagnosticAxisIsolation,
  COMIC_DIAGNOSTIC_MODES,
  isComicAutopilotActive,
  resolveComicDiagnosticMode,
} from "./chatComicDiagnostic";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  formatSceneSourcePreview,
} from "./chatImageScenePlan";

const SOURCE_MESSAGES = buildSceneSourceMessages([
  { id: 1, role: "user", content: '"오늘 밤에 뭐해?" *문을 두드린다*' },
  {
    id: 2,
    role: "assistant",
    content: '태형이 문을 열었다. "들어와." *따뜻한 차를 내민다* "앉아."',
  },
]);
const FULL_SOURCE_TEXT = formatSceneSourcePreview(SOURCE_MESSAGES);

function directPlan() {
  return buildDeterministicScenePlan(SOURCE_MESSAGES, 4);
}

function basePromptOpts(plan: ReturnType<typeof directPlan>) {
  return {
    characterName: "태형",
    characterGender: "male" as const,
    personaName: "렌",
    personaGender: "male" as const,
    plan,
  };
}

describe("comic full-source direct experiment — resolve + axis isolation", () => {
  it("DIRECT-RESOLVE-1 admin can select full_source_direct with no levels", () => {
    assert.deepEqual(resolveComicDiagnosticMode({ canSeeCost: true, mode: "full_source_direct" }), {
      mode: "full_source_direct",
      semanticLevel: null,
      textStrategy: "local_image_detection",
      textBoundaryLevel: null,
    });
    assert.ok(COMIC_DIAGNOSTIC_MODES.includes("full_source_direct"));
  });

  it("DIRECT-RESOLVE-2 non-admin cannot select direct", () => {
    assert.throws(
      () => resolveComicDiagnosticMode({ canSeeCost: false, mode: "full_source_direct" }),
      /FORBIDDEN/
    );
  });

  it("DIRECT-RESOLVE-3 ladder-only params are rejected for direct", () => {
    assert.throws(
      () => resolveComicDiagnosticMode({ canSeeCost: true, mode: "full_source_direct", semanticLevel: "L0" }),
      /SEMANTIC_LEVEL_ONLY_FOR_LADDER/
    );
    assert.throws(
      () => resolveComicDiagnosticMode({ canSeeCost: true, mode: "full_source_direct", textBoundaryLevel: "T1" }),
      /TEXT_BOUNDARY_ONLY_FOR_LADDER/
    );
    assert.throws(
      () =>
        resolveComicDiagnosticMode({
          canSeeCost: true,
          mode: "full_source_direct",
          textStrategy: "shared_anchor_regions",
        }),
      /TEXT_STRATEGY_ONLY_FOR_HYBRID/
    );
  });

  it("DIRECT-AXIS-1 direct + non-normal reference isolation is rejected", () => {
    assert.throws(
      () =>
        assertComicDiagnosticAxisIsolation({
          mode: "full_source_direct",
          referenceMode: "neutral_template",
          visualContextMode: "normal",
        }),
      /COMIC_DIRECT_REQUIRES_NORMAL_REFERENCE_ISOLATION/
    );
  });

  it("DIRECT-AXIS-2 direct + neutral visual context is rejected", () => {
    assert.throws(
      () =>
        assertComicDiagnosticAxisIsolation({
          mode: "full_source_direct",
          referenceMode: "normal",
          visualContextMode: "neutral_visual_context",
        }),
      /COMIC_DIRECT_REQUIRES_NORMAL_VISUAL_CONTEXT/
    );
  });

  it("DIRECT-AXIS-3 direct + normal axes passes isolation", () => {
    assertComicDiagnosticAxisIsolation({
      mode: "full_source_direct",
      referenceMode: "normal",
      visualContextMode: "normal",
    });
  });
});

describe("comic full-source direct experiment — planner-call gate", () => {
  it("DIRECT-PLAN-1 normal/normal/normal is autopilot (planner runs once)", () => {
    assert.equal(
      isComicAutopilotActive({ mode: "normal", referenceMode: "normal", visualContextMode: "normal" }),
      true
    );
  });

  it("DIRECT-PLAN-2 direct mode is never autopilot (planner calls = 0)", () => {
    assert.equal(
      isComicAutopilotActive({
        mode: "full_source_direct",
        referenceMode: "normal",
        visualContextMode: "normal",
      }),
      false
    );
  });

  it("DIRECT-PLAN-3 ladder/hybrid and non-normal axes are never autopilot", () => {
    assert.equal(
      isComicAutopilotActive({ mode: "semantic_ladder", referenceMode: "normal", visualContextMode: "normal" }),
      false
    );
    assert.equal(
      isComicAutopilotActive({
        mode: "blank_balloon_hybrid",
        referenceMode: "normal",
        visualContextMode: "normal",
      }),
      false
    );
    assert.equal(
      isComicAutopilotActive({ mode: "normal", referenceMode: "neutral_template", visualContextMode: "normal" }),
      false
    );
    assert.equal(
      isComicAutopilotActive({
        mode: "normal",
        referenceMode: "normal",
        visualContextMode: "neutral_visual_context",
      }),
      false
    );
  });
});

describe("comic full-source direct experiment — provider prompt variant", () => {
  it("DIRECT-PROMPT-1 full canonical source reaches the provider prompt with fixed 4 panels", () => {
    const prompt = buildChatComicImagePrompt({
      ...basePromptOpts(directPlan()),
      fullSourceDirectText: FULL_SOURCE_TEXT,
    });
    assert.ok(prompt.includes("오늘 밤에 뭐해?"), "full source user line present");
    assert.ok(prompt.includes("들어와."), "full source character line present");
    assert.match(prompt, /FULL SOURCE \(canonical turn/);
    assert.match(prompt, /DIRECT CONTENT CONTRACT/);
    assert.ok(prompt.includes(FULL_SOURCE_DIRECT_CONTENT_CONTRACT));
    assert.match(prompt, /exactly 4 wide horizontal panels/);
    assert.match(prompt, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
  });

  it("DIRECT-PROMPT-2 direct prompt carries no planner-derived content selection", () => {
    const prompt = buildChatComicImagePrompt({
      ...basePromptOpts(directPlan()),
      fullSourceDirectText: FULL_SOURCE_TEXT,
    });
    assert.doesNotMatch(prompt, /DIALOGUE CANDIDATES/);
    assert.doesNotMatch(prompt, /SELECTED HIGHLIGHT/);
    assert.doesNotMatch(prompt, /AUTO PANEL RECOMMENDATION/);
    assert.doesNotMatch(prompt, /COMIC PANEL SPEC — FULL PROVIDER-RENDERED MANHWA PAGE/);
  });

  it("DIRECT-PROMPT-3 default path unchanged without the direct flag", () => {
    const prompt = buildChatComicImagePrompt(basePromptOpts(directPlan()));
    assert.doesNotMatch(prompt, /FULL SOURCE \(canonical turn/);
    assert.doesNotMatch(prompt, /DIRECT CONTENT CONTRACT/);
    assert.match(prompt, /COMIC PANEL SPEC — FULL PROVIDER-RENDERED MANHWA PAGE/);
  });

  it("DIRECT-PROMPT-4 autopilot highlight wins when both selection and direct text are set", () => {
    const prompt = buildChatComicImagePrompt({
      ...basePromptOpts(directPlan()),
      comicHighlightSelection: { anchorEventId: "E1", focusEventIds: ["E1"] },
      comicPanelMode: "auto",
      fullSourceDirectText: FULL_SOURCE_TEXT,
    });
    assert.match(prompt, /SELECTED HIGHLIGHT SOURCE/);
    assert.doesNotMatch(prompt, /DIRECT CONTENT CONTRACT/);
  });

  it("DIRECT-PROMPT-5 canonical content contract is the single owner of direct semantics", () => {
    const prompt = buildChatComicImagePrompt({
      ...basePromptOpts(directPlan()),
      fullSourceDirectText: FULL_SOURCE_TEXT,
    });
    assert.match(prompt, /important actions, emotional shifts, and key dialogue/);
    assert.match(prompt, /Let the number of speech bubbles vary naturally with the scene/);
    assert.match(prompt, /natural, complete Korean sentences/);
    assert.match(prompt, /rendered clearly and stably/);
    assert.match(prompt, /Preserve the source's key events and speaker relationships/);
    assert.doesNotMatch(prompt, /at most two bubbles/i);
    assert.doesNotMatch(prompt, /Limit to at most two bubbles/i);
    assert.doesNotMatch(prompt, /only where a scene transition requires one/);
    assert.doesNotMatch(prompt, /transition needs one/);
    assert.doesNotMatch(prompt, /Select important dialogue from the full source above/);
  });

  it("DIRECT-PROMPT-6 direct prompt does not contain production exact-dialogue wording", () => {
    const prompt = buildChatComicImagePrompt({
      ...basePromptOpts(directPlan()),
      fullSourceDirectText: FULL_SOURCE_TEXT,
    });
    assert.doesNotMatch(prompt, /exact dialogue below/);
  });

  it("DIRECT-PROMPT-7 direct text contract omits production verbose balloon instructions", () => {
    const prompt = buildChatComicImagePrompt({
      ...basePromptOpts(directPlan()),
      fullSourceDirectText: FULL_SOURCE_TEXT,
    });
    assert.doesNotMatch(prompt, /Use narration sparingly/);
    assert.doesNotMatch(prompt, /imperfect typography is acceptable/);
  });

  it("NORMAL-CONTRACT-1 production full-provider path retains exact-dialogue semantics", () => {
    const prompt = buildChatComicImagePrompt(basePromptOpts(directPlan()));
    assert.match(prompt, /exact dialogue below/);
  });

  it("NORMAL-CONTRACT-2 production text contract retains full balloon and narration instructions", () => {
    const prompt = buildChatComicImagePrompt(basePromptOpts(directPlan()));
    assert.match(prompt, /Use narration sparingly/);
    assert.match(prompt, /imperfect typography is acceptable/);
  });
});

describe("comic full-source direct experiment — fixed 4-panel wiring", () => {
  it("DIRECT-FIXED-4 deterministic plan reflows to 4 with canonical 4-panel output size", () => {
    const plan = buildDeterministicScenePlan(SOURCE_MESSAGES, 4);
    assert.equal(plan.panels.length, 4);
    assert.equal(resolveChatComicOutputSize(4), CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE);
    assert.equal(resolveChatComicOutputSize(4), "864x1824");
  });

  it("DIRECT-PRICE-1 comic price stays flat regardless of panel count", () => {
    assert.equal(resolveChatComicPrice(4, {} as NodeJS.ProcessEnv), 180);
  });
});
