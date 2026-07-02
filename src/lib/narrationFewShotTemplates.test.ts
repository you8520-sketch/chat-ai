import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  disableNarrationFewShotFallbackForTests,
  enableNarrationFewShotFallbackForTests,
} from "@/lib/narrationFewShotFallbackFeature";
import {
  defaultPlatformNarrationFewShot,
  resolveExampleDialogForPrompt,
} from "@/lib/narrationFewShotTemplates";

afterEach(() => {
  disableNarrationFewShotFallbackForTests();
});

describe("narrationFewShotTemplates", () => {
  it("returns creator example_dialog unchanged when non-empty", () => {
    const creator = "유저: hi\n레온: …";
    assert.equal(resolveExampleDialogForPrompt(creator, "레온"), creator);
  });

  it("returns empty when example_dialog empty and fallback OFF", () => {
    assert.equal(resolveExampleDialogForPrompt("", "레온"), "");
  });

  it("injects space/sound platform few-shot when fallback ON", () => {
    enableNarrationFewShotFallbackForTests();
    const resolved = resolveExampleDialogForPrompt("", "레온");
    assert.equal(resolved, defaultPlatformNarrationFewShot("레온"));
    assert.match(resolved, /레온/);
    assert.doesNotMatch(resolved, /손을 뻗|손끝|손목/);
    assert.match(resolved, /공기|소음|간격|거리/);
  });
});
