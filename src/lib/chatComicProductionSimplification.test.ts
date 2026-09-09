import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildChatComicImagePrompt } from "./chatComicGeneration";
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
  it("PLANNER-0 production comic never runs the Scene Planner (route has no planChatImageScene call)", () => {
    const route = read(ROUTE);
    // The comic route must not contain a planner call anywhere: the production
    // path is full-source direct and the scene_plan diagnostic endpoint is gone.
    // planChatImageScene remains available only via the TRPG focus module.
    assert.doesNotMatch(route, /planChatImageScene\(/);
    assert.doesNotMatch(route, /from "@\/lib\/chatImageScenePlanner"/);
  });

  it("PLANNER-1 route has no autopilot/highlight planner gating for production", () => {
    const route = read(ROUTE);
    assert.doesNotMatch(route, /isComicAutopilotActive/);
    assert.doesNotMatch(route, /autopilotActive/);
    assert.doesNotMatch(route, /planChatImageScene/);
  });

  it("PLANNER-2 route has no scene_plan diagnostic endpoint", () => {
    const route = read(ROUTE);
    assert.doesNotMatch(route, /body\.mode === "scene_plan"/);
    assert.doesNotMatch(route, /mode: "scene_plan"/);
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
    assert.match(route, /fullSourceDirectText: source\.turnText/);
    assert.doesNotMatch(route, /comicHighlightSelection/);
  });

  it("ROUTE-2 route no longer resolves highlight selection for production", () => {
    const route = read(ROUTE);
    assert.doesNotMatch(route, /resolveComicHighlightFallback/);
    assert.doesNotMatch(route, /resolveComicHighlightSelectionSource/);
    assert.doesNotMatch(route, /ComicHighlightSelection/);
  });

  it("ROUTE-3 route has no diagnostic mode branches", () => {
    const route = read(ROUTE);
    assert.doesNotMatch(route, /diagnosticMode/);
    assert.doesNotMatch(route, /diagnosticOverrides/);
    assert.doesNotMatch(route, /semanticLadderMode/);
    assert.doesNotMatch(route, /neutralVisualContext/);
    assert.doesNotMatch(route, /blank_balloon_hybrid/);
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

describe("PR-A merge blockers — cost bucket + storyboard false owner", () => {
  it("COST-1 production comic admin cost uses the fixed 4-panel bucket", () => {
    const panel = read(PANEL);
    assert.match(panel, /averageCosts\.comic\[4\]/);
    assert.doesNotMatch(panel, /averageCosts\.comic\[3\]/);
  });

  it("UI-DIRECT-1 production comic mode shows no storyboard dialogue editor", () => {
    const panel = read(PANEL);
    const builder = read("src/components/ChatSceneBuilder.tsx");
    // The editable storyboard path is removed: no autopilot switch prop is
    // passed, and the builder exposes no dialogue editor wiring.
    assert.doesNotMatch(panel, /comicAutopilotMode/);
    assert.doesNotMatch(builder, /comicAutopilotMode/);
    assert.doesNotMatch(builder, /onToggleDialogueEdit/);
    assert.doesNotMatch(builder, /대사 편집/);
  });

  it("UI-DIRECT-2 production comic mode shows no scene-detail editor", () => {
    const builder = read("src/components/ChatSceneBuilder.tsx");
    // The scene-detail editor button and visual editor are removed entirely.
    assert.doesNotMatch(builder, /장면 자세히 수정/);
    assert.doesNotMatch(builder, /PanelVisualEditor/);
    assert.doesNotMatch(builder, /sceneEditOpen/);
  });

  it("UI-DIRECT-3 provider-direct automatic explanation is retained", () => {
    const builder = read("src/components/ChatSceneBuilder.tsx");
    assert.match(builder, /4컷 만화를 자동으로 구성합니다/);
    assert.doesNotMatch(builder, /AI가 이 턴에서 중요 장면을 골라 컷 구성을 자동으로 만듭니다/);
  });

  it("UI-DIRECT-4 cast/reference controls are retained", () => {
    const panel = read(PANEL);
    assert.match(panel, /onCastChange=\{setCastIntent\}/);
    const builder = read("src/components/ChatSceneBuilder.tsx");
    assert.match(builder, /ChatImageCastPicker/);
  });
});

describe("non-admin privacy boundary (server gate is canonical owner)", () => {
  it("PRIV-1 image-generation GET gates averageCosts and latestResult cost behind canSeeCost", () => {
    const route = read("src/app/api/chat/image-generation/route.ts");
    assert.match(route, /averageCosts: canSeeCost\s*\?/);
    assert.match(route, /upstreamCostUsd: canSeeCost \? upstreamCostUsd : undefined/);
    assert.match(route, /const canSeeCost = isAdminUser/);
  });

  it("PRIV-2 comic POST exposes only gated upstream cost, no diagnostic payload", () => {
    const route = read(ROUTE);
    assert.match(route, /const canSeeCost = isAdminUser/);
    assert.match(route, /upstreamCostUsd: canSeeCost \? totalCostUsd : undefined/);
    assert.doesNotMatch(route, /providerAttemptDiagnostic/);
    assert.doesNotMatch(route, /comicDiagnostic/);
  });

  it("PRIV-3 illustration POST exposes only gated upstream cost, no diagnostic payload", () => {
    const route = read(ROUTE);
    assert.match(route, /upstreamCostUsd: canSeeCost \? generated\.knownProviderCostUsd : undefined/);
    assert.doesNotMatch(route, /providerAttemptDiagnostic/);
  });

  it("PRIV-4 client only renders admin cost from server-provided values", () => {
    const panel = read(PANEL);
    assert.match(panel, /data\.upstreamCostUsd != null && data\.upstreamCostKrw != null/);
    assert.match(panel, /actualCosts\[activeMode\]/);
  });
});

describe("PR-B decommission — production paths must not reintroduce deleted owners", () => {
  it("DECOM-1 production comic route imports no planner/highlight/textBrief/diagnostic owners", () => {
    const route = read(ROUTE);
    assert.doesNotMatch(route, /chatImageScenePlanner/);
    assert.doesNotMatch(route, /chatComicHighlightExcerpt/);
    assert.doesNotMatch(route, /chatComicTextBrief/);
    assert.doesNotMatch(route, /chatComicHighlightStoryboard/);
    assert.doesNotMatch(route, /chatComicDiagnostic/);
    assert.doesNotMatch(route, /chatImageScenePlanRateLimit/);
    assert.doesNotMatch(route, /chatImageScenePlanLifecycle/);
  });

  it("DECOM-2 production comic prompt builder imports no highlight/textBrief/diagnostic owners", () => {
    const builder = read("src/lib/chatComicGeneration.ts");
    assert.doesNotMatch(builder, /chatComicHighlightExcerpt/);
    assert.doesNotMatch(builder, /chatComicTextBrief/);
    assert.doesNotMatch(builder, /chatComicHighlightStoryboard/);
    assert.doesNotMatch(builder, /chatComicDiagnostic/);
  });

  it("DECOM-3 illustration route has no approved-scene-plan prompt path", () => {
    const route = read(ROUTE);
    assert.doesNotMatch(route, /approvedScenePlan/);
  });

  it("DECOM-4 panel exposes no SD/persona generation entrypoints", () => {
    const panel = read(PANEL);
    assert.doesNotMatch(panel, /generateSd/);
    assert.doesNotMatch(panel, /generatePersona/);
    assert.doesNotMatch(panel, /SD 이미지/);
    assert.doesNotMatch(panel, /페르소나 이미지 생성/);
  });

  it("DECOM-5 image-generation route has no generation POST path", () => {
    const route = read("src/app/api/chat/image-generation/route.ts");
    assert.doesNotMatch(route, /export async function POST/);
    assert.doesNotMatch(route, /isPersona|isEmoticon|isCoupleStamp/);
  });
});