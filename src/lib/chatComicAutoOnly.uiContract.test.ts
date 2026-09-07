import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
const panelSource = readFileSync(resolve(root, "src/components/ChatSceneBuilder.tsx"), "utf8");
const generatorSource = readFileSync(resolve(root, "src/components/ChatImageGeneratorPanel.tsx"), "utf8");

describe("normal comic AUTO-only UI contract", () => {
  it("UI-AUTO-1/2/3/4 no user panel-count selector renders in ChatSceneBuilder", () => {
    assert.doesNotMatch(panelSource, /컷 수/u, "UI-AUTO-1 no '컷 수' heading");
    assert.doesNotMatch(panelSource, /자동\(추천\)/u, "UI-AUTO-2 no '자동(추천)' selector");
    assert.doesNotMatch(panelSource, />3컷</u, "UI-AUTO-3 no '3컷' selector button");
    assert.doesNotMatch(panelSource, />4컷</u, "UI-AUTO-4 no '4컷' selector button");
    assert.doesNotMatch(panelSource, /CHAT_COMIC_PANEL_OPTIONS/u, "selector constant no longer rendered");
    assert.doesNotMatch(panelSource, /onComicPanelModeChange/u, "no manual mode change wiring");
    assert.doesNotMatch(panelSource, /onPanelCountChange/u, "no manual panel-count wiring");
  });

  it("UI-AUTO-5 normal comic keeps one primary generation CTA", () => {
    assert.match(generatorSource, /컷만화 생성/u);
    assert.match(generatorSource, /중요 장면을 고르고 컷만화를 만드는 중…/u);
  });

  it("REQUEST-AUTO-1/2 normal comic request is AUTO_ONLY; no manual mode state remains", () => {
    assert.match(generatorSource, /panelCount:\s*\n\s*!isIllustration\s*\n\s*\? "auto"\s*\n\s*:\s*undefined/u, "REQUEST-AUTO-1 normal request sends auto");
    assert.doesNotMatch(generatorSource, /comicPanelMode/u, "REQUEST-AUTO-2 no manual mode state");
    assert.doesNotMatch(generatorSource, /setComicPanelMode/u, "no manual mode setter");
    assert.doesNotMatch(generatorSource, /commitPanelCount/u, "no manual panel-count commit");
    assert.doesNotMatch(generatorSource, /scenePanelCount/u, "no manual panel-count state");
  });

  it("REQUEST-AUTO-3/4 source change and regenerate stay AUTO (no stale manual mode)", () => {
    assert.doesNotMatch(generatorSource, /comicPanelMode/u, "no persistent manual mode to restore");
    assert.match(generatorSource, /panelCount:/u, "request still carries panelCount boundary");
  });

  it("normal comic explanatory copy is AUTO-only, no manual choice copy", () => {
    assert.match(panelSource, /AI가 대화에서 중요한 장면을 골라 자연스러운 컷만화로 구성합니다\./u);
  });
});