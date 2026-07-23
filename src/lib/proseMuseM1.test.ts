import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdvancedProseNsfwGuidelines,
  IMMERSIVE_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";
import { MUSE_PROSE_M1_STYLE_SECTION } from "@/lib/proseMuseM1";
import { PROSE_VNEXT_STYLE_SECTION } from "@/lib/proseVNext";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

describe("MUSE_PROSE_M1_STYLE_SECTION — frozen Candidate 1", () => {
  it("preserves mechanical shell + 7 M1 principles", () => {
    assert.match(MUSE_PROSE_M1_STYLE_SECTION, /\[NARRATION REGISTER\]/);
    assert.match(MUSE_PROSE_M1_STYLE_SECTION, /\[SCENE FLOW\]/);
    assert.match(MUSE_PROSE_M1_STYLE_SECTION, /\[RHYTHM\]/);
    assert.match(MUSE_PROSE_M1_STYLE_SECTION, /\[MUSE PROSE M1 — 장면 연속 계약\]/);
    assert.match(MUSE_PROSE_M1_STYLE_SECTION, /1\. 지금 다음 순간부터/);
    assert.match(MUSE_PROSE_M1_STYLE_SECTION, /7\. 다음 턴이 살아 있는 곳에서 멈춘다/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /8\./);
  });

  it("no VNext or legacy behavioral body", () => {
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /\[PROSE VNEXT/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /\[SENSATION\]/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /\[WEBNOVEL BREATH\]/);
    assert.ok(!MUSE_PROSE_M1_STYLE_SECTION.includes(IMMERSIVE_PROSE_BLOCK));
  });

  it("no LENGTH/Terminal or fixture leakage", () => {
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /\[LENGTH/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /TERMINAL/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /플러드/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /복도/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /대사량\s*\d/);
    assert.doesNotMatch(MUSE_PROSE_M1_STYLE_SECTION, /한 줄 이내/);
  });

  it("M1 ON via proseStyleSection seam — exactly once, legacy when OFF", () => {
    const legacyBundle = buildProseStyleXmlBundle({ nsfwEnabled: false });
    const m1Bundle = buildProseStyleXmlBundle({
      nsfwEnabled: false,
      proseStyleSection: MUSE_PROSE_M1_STYLE_SECTION,
    });
    assert.equal(countOccurrences(legacyBundle, "[MUSE PROSE M1"), 0);
    assert.equal(countOccurrences(m1Bundle, "[MUSE PROSE M1"), 1);
    assert.equal(countOccurrences(m1Bundle, "[PROSE VNEXT"), 0);
    assert.equal(
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false }).includes(PROSE_STYLE_SECTION),
      true
    );
    assert.equal(
      buildAdvancedProseNsfwGuidelines({
        nsfwEnabled: false,
        proseStyleSection: MUSE_PROSE_M1_STYLE_SECTION,
      }).includes(MUSE_PROSE_M1_STYLE_SECTION),
      true
    );
    assert.equal(
      buildAdvancedProseNsfwGuidelines({
        nsfwEnabled: false,
        proseStyleSection: MUSE_PROSE_M1_STYLE_SECTION,
      }).includes(PROSE_STYLE_SECTION),
      false
    );
  });

  it("similar magnitude to VNext section (not empty, not huge)", () => {
    const m1 = MUSE_PROSE_M1_STYLE_SECTION.length;
    const vnext = PROSE_VNEXT_STYLE_SECTION.length;
    assert.ok(m1 > 400);
    assert.ok(m1 < vnext * 1.5);
  });
});
