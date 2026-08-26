import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeSavedAppearanceForProvider,
  parseEyeTraitsFromClause,
  renderEyeTraitPromptLines,
} from "./chatImageEyeTraits";

describe("chatImageEyeTraits", () => {
  it("parses red pupil only without implying red irises", () => {
    const parsed = parseEyeTraitsFromClause("붉은 동공, 검은 홍채");
    assert.ok(parsed);
    assert.equal(parsed!.pupilColor, "red");
    assert.equal(parsed!.irisColor, "dark/black");
    const lines = renderEyeTraitPromptLines(parsed!);
    assert.match(lines.join("\n"), /Pupil color: red/);
    assert.match(lines.join("\n"), /small pupil center ONLY/);
    assert.match(lines.join("\n"), /do NOT fill the entire iris red/i);
  });

  it("parses red iris with dark pupil separately", () => {
    const parsed = parseEyeTraitsFromClause("검은 동공과 붉은 홍채");
    assert.ok(parsed);
    assert.equal(parsed!.pupilColor, "dark/black");
    assert.equal(parsed!.irisColor, "red");
    const normalized = normalizeSavedAppearanceForProvider("검은 동공과 붉은 홍채, 흰 셔츠");
    assert.match(normalized, /Iris color: red/);
    assert.match(normalized, /Pupil color: dark\/black/);
    assert.match(normalized, /흰 셔츠/);
    assert.doesNotMatch(normalized, /red eyes/i);
  });

  it("preserves NOT red eyes negation", () => {
    const normalized = normalizeSavedAppearanceForProvider("검은 동공과 붉은 홍채. 붉은 눈이 아니다.");
    assert.match(normalized, /NOT full red eyes/i);
  });

  it("handles English black pupils, red irises fixture", () => {
    const normalized = normalizeSavedAppearanceForProvider("black pupils, red irises");
    assert.match(normalized, /Iris color: red/);
    assert.match(normalized, /Pupil color: dark\/black/);
  });

  it("does not flatten red pupil into red iris wording", () => {
    const normalized = normalizeSavedAppearanceForProvider("붉은 동공");
    assert.match(normalized, /Pupil color: red/);
    assert.doesNotMatch(normalized, /Iris color: red/);
    assert.match(normalized, /do NOT fill the entire iris red/i);
  });
});
