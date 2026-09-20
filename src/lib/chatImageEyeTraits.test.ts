import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clipSavedAppearanceForPrompt } from "./chatImageVisualIdentity";
import {
  normalizeSavedAppearanceForProvider,
  parseEyeTraitsFromClause,
} from "./chatImageEyeTraits";

const EXACT_USER_CASE =
  "짧은 검은머리 검은눈동자 붉은 동공 흰셔츠 위에 가죽재질 전투 하네스 검은바지 가르마 없음 full bangs";

describe("chatImageEyeTraits", () => {
  it("EYE_EXACT_USER_CASE: 검은눈동자 붉은 동공 → dark visible eye + red pupil", () => {
    const parsed = parseEyeTraitsFromClause("검은눈동자 붉은 동공");
    assert.equal(parsed.irisColor, "black");
    assert.equal(parsed.pupilColor, "red");
    const normalized = normalizeSavedAppearanceForProvider("검은눈동자 붉은 동공");
    assert.match(normalized, /Iris color: black/);
    assert.match(normalized, /Pupil color: red/);
    assert.match(normalized, /do NOT fill the entire iris red/i);
    assert.doesNotMatch(normalized, /Iris color: red/);
  });

  it("EYE_EXACT_USER_FULL_DESCRIPTION preserves hair/outfit/bangs and eye split", () => {
    const normalized = normalizeSavedAppearanceForProvider(EXACT_USER_CASE);
    assert.match(normalized, /Iris color: black/);
    assert.match(normalized, /Pupil color: red/);
    assert.match(normalized, /짧은 검은머리/);
    assert.match(normalized, /흰셔츠/);
    assert.match(normalized, /가죽재질 전투 하네스/);
    assert.match(normalized, /검은바지/);
    assert.match(normalized, /가르마 없음/);
    assert.match(normalized, /full bangs/i);
    assert.doesNotMatch(normalized, /Iris color: red/);
  });

  it("EYE_NO_COMMA and EYE_REVERSED_ORDER extract independently", () => {
    for (const input of [
      "검은눈동자 붉은 동공",
      "검은 눈동자, 붉은 동공",
      "붉은 동공 검은눈동자",
      "검은 눈동자와 붉은 동공",
    ]) {
      const parsed = parseEyeTraitsFromClause(input);
      assert.equal(parsed.irisColor, "black", input);
      assert.equal(parsed.pupilColor, "red", input);
    }
  });

  it("EYE_RED_IRIS_DARK_PUPIL keeps red iris and black pupil", () => {
    const parsed = parseEyeTraitsFromClause("붉은 홍채 검은 동공");
    assert.equal(parsed.irisColor, "red");
    assert.equal(parsed.pupilColor, "black");
    const normalized = normalizeSavedAppearanceForProvider("붉은 홍채 검은 동공");
    assert.match(normalized, /Iris color: red/);
    assert.match(normalized, /Pupil color: black/);
    assert.doesNotMatch(normalized, /do NOT fill the entire iris red/i);
  });

  it("EYE_DARK_GRAY_FIDELITY and EYE_BLUE_FIDELITY keep exact colors", () => {
    assert.match(
      normalizeSavedAppearanceForProvider("dark gray irises"),
      /Iris color: dark gray/
    );
    assert.match(normalizeSavedAppearanceForProvider("blue irises"), /Iris color: blue/);
    assert.doesNotMatch(
      normalizeSavedAppearanceForProvider("dark gray irises"),
      /dark\/black/
    );
  });

  it("EYE_RED_EYES_VALID preserves positive red eyes without a contradictory negative", () => {
    for (const input of ["붉은 눈", "적안", "red eyes"]) {
      const normalized = normalizeSavedAppearanceForProvider(input);
      assert.match(normalized, /Iris color: red/, input);
      assert.doesNotMatch(normalized, /NOT red eyes/i, input);
      assert.doesNotMatch(normalized, /do not use red eyes/i, input);
      assert.doesNotMatch(normalized, /Avoid interpreting generic/i, input);
    }
  });

  it("EYE_NOT_RED preserves only the negative", () => {
    for (const input of ["붉은 눈이 아니다", "not red eyes"]) {
      const normalized = normalizeSavedAppearanceForProvider(input);
      assert.match(normalized, /NOT red eyes/i, input);
      assert.doesNotMatch(normalized, /Iris color: red/, input);
    }
  });

  it("LONG_APPEARANCE_PRIORITY keeps critical eye lines under the 700-char clip", () => {
    const raw = `${"x".repeat(680)} 검은눈동자 붉은 동공`;
    const clipped = clipSavedAppearanceForPrompt(
      normalizeSavedAppearanceForProvider(raw)
    );
    assert.ok(clipped.length <= 700);
    assert.match(clipped, /Iris color: black/);
    assert.match(clipped, /Pupil color: red/);
    assert.match(clipped, /do NOT fill the entire iris red/i);
  });

  it("GENERIC colors and explicit pupil shapes are preserved; unspecified shapes are not invented", () => {
    assert.match(
      normalizeSavedAppearanceForProvider("blue iris + black pupil"),
      /Iris color: blue/
    );
    assert.match(
      normalizeSavedAppearanceForProvider("blue iris black pupils"),
      /Pupil color: black/
    );
    assert.match(normalizeSavedAppearanceForProvider("green irises"), /Iris color: green/);
    assert.match(normalizeSavedAppearanceForProvider("gold irises"), /Iris color: gold/);
    const whitePupil = normalizeSavedAppearanceForProvider("dark irises white pupils");
    assert.match(whitePupil, /Iris color: dark/);
    assert.match(whitePupil, /Pupil color: white/);

    const slit = normalizeSavedAppearanceForProvider("gold irises vertical slit pupil");
    assert.match(slit, /Iris color: gold/);
    assert.match(slit, /Pupil shape: vertical slit/);

    const round = normalizeSavedAppearanceForProvider("dark irises red round pupil");
    assert.match(round, /Pupil color: red/);
    assert.match(round, /Pupil shape: round/);

    const noShape = normalizeSavedAppearanceForProvider("검은눈동자 붉은 동공");
    assert.doesNotMatch(noShape, /Pupil shape:/);
    assert.doesNotMatch(noShape, /slit|cross-shaped|star-shaped/i);
  });

  it("HETEROCHROMIA keeps left/right colors", () => {
    const normalized = normalizeSavedAppearanceForProvider("left blue / right green irises");
    assert.match(normalized, /Heterochromia: left blue, right green/i);
    assert.doesNotMatch(normalized, /Iris color: blue/);
  });

  it("does not flatten black pupils, red irises into dark/black", () => {
    const normalized = normalizeSavedAppearanceForProvider("black pupils, red irises");
    assert.match(normalized, /Iris color: red/);
    assert.match(normalized, /Pupil color: black/);
    assert.doesNotMatch(normalized, /dark\/black/);
  });

  it("EYE_SUBJECT_BIND prefixes immutable eye traits with subject name", () => {
    const normalized = normalizeSavedAppearanceForProvider("검은눈동자 붉은 동공", {
      subjectName: "리프트",
    });
    assert.match(normalized, /Immutable eye traits for 리프트/);
    assert.match(normalized, /리프트 ONLY — Pupil color: red/);
    assert.match(normalized, /리프트 ONLY — Iris color: black/);
  });

  it("EYE-IDEMPOTENT-1 black pupils red irises survives second normalize", () => {
    const first = normalizeSavedAppearanceForProvider("black pupils, red irises", {
      subjectName: "에단",
    });
    const second = normalizeSavedAppearanceForProvider(first, { subjectName: "에단" });
    assert.equal(first, second);
    assert.match(first, /에단 ONLY — Iris color: red/);
    assert.match(first, /에단 ONLY — Pupil color: black/);
    assert.doesNotMatch(first, /에단 ONLY — Pupil color: red/);
  });

  it("EYE-IDEMPOTENT-2 black irises red pupils survives second normalize", () => {
    const first = normalizeSavedAppearanceForProvider("black irises, red pupils", {
      subjectName: "리프트",
    });
    const second = normalizeSavedAppearanceForProvider(first, { subjectName: "리프트" });
    assert.equal(first, second);
    assert.match(first, /리프트 ONLY — Iris color: black/);
    assert.match(first, /리프트 ONLY — Pupil color: red/);
    assert.doesNotMatch(first, /리프트 ONLY — Iris color: red/);
  });

  it("EYE-IDEMPOTENT-3 heterochromia survives second normalize", () => {
    const first = normalizeSavedAppearanceForProvider("left blue / right green irises", {
      subjectName: "A",
    });
    const second = normalizeSavedAppearanceForProvider(first, { subjectName: "A" });
    assert.equal(first, second);
    assert.match(second, /Heterochromia: left blue, right green/);
  });

  it("EYE-IDEMPOTENT-4 pupil shape survives second normalize", () => {
    const first = normalizeSavedAppearanceForProvider("gold irises vertical slit pupil", {
      subjectName: "B",
    });
    const second = normalizeSavedAppearanceForProvider(first, { subjectName: "B" });
    assert.equal(first, second);
    assert.match(second, /Pupil shape: vertical slit/);
  });

  it("EYE_BULLET_RESIDUE strips punctuation-only bullets after eye phrase removal", () => {
    const input = "- black hair\n- black pupils, red irises\n- white shirt";
    const normalized = normalizeSavedAppearanceForProvider(input);
    assert.match(normalized, /Eyes \(explicit iris\/pupil ownership\):/);
    assert.match(normalized, /Iris color: red/);
    assert.match(normalized, /Pupil color: black/);
    assert.match(normalized, /black hair/);
    assert.match(normalized, /white shirt/);
    assert.doesNotMatch(normalized, /^\s*-\s*[,;·-]?\s*$/m);
    assert.doesNotMatch(normalized, /black pupils, red irises/);
  });

  it("EYE_BULLET_RESIDUE keeps valid comma-separated outfit phrases", () => {
    const input = "- black hair\n- black pupils, red irises\n- white shirt, harness\n- scar";
    const normalized = normalizeSavedAppearanceForProvider(input);
    assert.match(normalized, /white shirt, harness/);
    assert.match(normalized, /scar/);
    assert.doesNotMatch(normalized, /^\s*-\s*[,;·-]?\s*$/m);
  });
});
