import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildChatComicImagePrompt } from "./chatComicGeneration";
import {
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
const ROUTE = "src/app/api/chat/comic-generation/route.ts";
const PANEL = "src/components/ChatImageGeneratorPanel.tsx";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("production comic simplification — Scene Planner calls 0", () => {
  it("PLANNER-0 production comic never runs the Scene Planner (route has no planChatImageScene call in the comic branch)", () => {
    const route = read(ROUTE);
    // The production comic branch (mode "comic") must not contain a planner call.
    // planChatImageScene may only remain in the scene_plan diagnostic endpoint.
    const comicBranch = route.slice(route.indexOf('if (body.mode === "comic")'));
    assert.doesNotMatch(comicBranch, /planChatImageScene\(/);
  });

  it("PLANNER-1 normal/normal/normal is never autopilot (planner calls = 0)", () => {
    assert.equal(
      isComicAutopilotActive({ mode: "normal", referenceMode: "normal", visualContextMode: "normal" }),
      false
    );
    assert.equal(
      isComicAutopilotActive({ mode: "normal", referenceMode: "normal", visualContextMode: "normal" }),
      false
    );
  });

  it("PLANNER-2 default production request resolves to normal mode + normal axes", () => {
    const mode = resolveComicDiagnosticMode({ canSeeCost: false });
    assert.equal(mode.mode, "normal");
    assert.equal(isComicAutopilotActive({ mode: mode.mode, referenceMode: "normal", visualContextMode: "normal" }), false);
  });
});

describe("production comic simplification — full source reaches provider prompt", () => {
  function productionPrompt() {
    return buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: buildDeterministicScenePlan(SOURCE_MESSAGES, 4),
      fullSourceDirectText: FULL_SOURCE_TEXT,
    });
  }

  it("SOURCE-1 full canonical turn text reaches the provider prompt", () => {
    const prompt = productionPrompt();
    assert.ok(prompt.includes("오늘 밤에 뭐해?"), "full source user line present");
    assert.ok(prompt.includes("들어와."), "full source character line present");
    assert.ok(prompt.includes(FULL_SOURCE_TEXT), "full turn text present verbatim");
  });

  it("SOURCE-2 canonical content contract appears exactly once", () => {
    const prompt = productionPrompt();
    const occurrences = prompt.split("Using the full source, compose a chronological 4-panel comic").length - 1;
    assert.equal(occurrences, 1, "canonical contract exactly once");
  });

  it("SOURCE-3 no planner-derived highlight/text-brief sections in the production prompt", () => {
    const prompt = productionPrompt();
    assert.doesNotMatch(prompt, /SELECTED HIGHLIGHT SOURCE/);
    assert.doesNotMatch(prompt, /DIALOGUE CANDIDATES/);
    assert.doesNotMatch(prompt, /NARRATION CANDIDATES/);
    assert.doesNotMatch(prompt, /AUTO PANEL RECOMMENDATION/);
    assert.doesNotMatch(prompt, /COMIC PANEL SPEC — FULL PROVIDER-RENDERED MANHWA PAGE/);
  });

  it("SOURCE-4 fixed 4-panel output size and no auto-panel claim", () => {
    const prompt = productionPrompt();
    assert.match(prompt, /exactly 4 wide horizontal panels/);
    assert.doesNotMatch(prompt, /natural 3- or 4-panel/);
  });
});

describe("production comic simplification — route wiring", () => {
  it("ROUTE-1 route passes the full turn text for production comic", () => {
    const route = read(ROUTE);
    assert.match(route, /fullSourceDirectText: fullSourceDirectMode \? source\.turnText : undefined/);
    assert.match(route, /const autopilotActive = false/);
  });

  it("ROUTE-2 route no longer resolves highlight selection for production", () => {
    const route = read(ROUTE);
    assert.doesNotMatch(route, /resolveComicHighlightFallback/);
  });
});

describe("production comic simplification — admin diagnostic UI removed", () => {
  it("UI-1 no comic diagnostic controls in the panel", () => {
    const panel = read(PANEL);
    assert.doesNotMatch(panel, /comicReferenceIsolationMode/);
    assert.doesNotMatch(panel, /comicVisualContextIsolationMode/);
    assert.doesNotMatch(panel, /comicDiagnosticMode/);
    assert.doesNotMatch(panel, /comicSemanticLevel/);
    assert.doesNotMatch(panel, /comicTextBoundaryLevel/);
    assert.doesNotMatch(panel, /관리자 진단/);
  });

  it("UI-2 admin actual-cost line is retained", () => {
    const panel = read(PANEL);
    assert.match(panel, /관리자 방금 생성 실제 API 원가/);
  });
});

describe("non-admin privacy boundary (server gate is canonical owner)", () => {
  it("PRIV-1 image-generation GET gates averageCosts and latestResult cost behind canSeeCost", () => {
    const route = read("src/app/api/chat/image-generation/route.ts");
    assert.match(route, /averageCosts: canSeeCost\s*\?/);
    assert.match(route, /upstreamCostUsd: canSeeCost \? upstreamCostUsd : undefined/);
    assert.match(route, /const canSeeCost = isAdminUser/);
  });

  it("PRIV-2 comic POST gates upstream cost and provider diagnostics behind canSeeCost", () => {
    const route = read(ROUTE);
    assert.match(route, /const canSeeCost = isAdminUser/);
    assert.match(route, /upstreamCostUsd: canSeeCost \? totalCostUsd : undefined/);
    assert.match(route, /providerAttemptDiagnostic: adminProviderAttemptDiagnostic/);
  });

  it("PRIV-3 illustration POST gates upstream cost and provider diagnostics behind canSeeCost", () => {
    const route = read(ROUTE);
    assert.match(route, /upstreamCostUsd: canSeeCost \? generated\.knownProviderCostUsd : undefined/);
    assert.match(route, /providerAttemptDiagnostic: adminProviderAttemptDiagnostic\(generated\)/);
  });

  it("PRIV-4 client only renders admin cost from server-provided values", () => {
    const panel = read(PANEL);
    assert.match(panel, /data\.upstreamCostUsd != null && data\.upstreamCostKrw != null/);
    assert.match(panel, /actualCosts\[activeMode\]/);
  });
});