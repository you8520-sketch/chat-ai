import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdvancedProseNsfwGuidelines,
  IMMERSIVE_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";
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

describe("PROSE_VNEXT_STYLE_SECTION — mechanical shell + VNext body", () => {
  it("preserves NARRATION REGISTER, SCENE FLOW, RHYTHM; carries VNext contract", () => {
    assert.match(PROSE_VNEXT_STYLE_SECTION, /\[NARRATION REGISTER\]/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /해체\(-다\/-했다\/-이었다\)/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /번역투·명사 단편/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /말줄임 \.\.\./);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /\[SCENE FLOW\]/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /\[RHYTHM\]/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /\[PROSE VNEXT — 장면 생동 계약\]/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /기억은 행동을 바꾼다/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /AI 캐릭터와 세계의 자율성/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /설명보다 암시/);
    assert.match(PROSE_VNEXT_STYLE_SECTION, /절제와 비반복/);
  });

  it("F: legacy IMMERSIVE / SENSATION / WEBNOVEL BREATH behavioral body absent", () => {
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /\[SENSATION\]/);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /\[WEBNOVEL BREATH\]/);
    assert.ok(!PROSE_VNEXT_STYLE_SECTION.includes(IMMERSIVE_PROSE_BLOCK));
  });

  it("does not encode engine jargon / quotas / few-shot", () => {
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /state-change density/i);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /event count/i);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /대사량\s*\d/);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /질문\s*할당/);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /dialogue quota/i);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /Every paragraph must introduce/i);
  });
});

describe("Prose VNext via proseStyleSection seam (one-slot replacement)", () => {
  it("A: proseStyleSection undefined → exact legacy PROSE_STYLE_SECTION output", () => {
    const legacy = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    const viaUndef = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: false,
      proseStyleSection: undefined,
    });
    assert.equal(viaUndef, legacy);
    assert.ok(legacy.includes(PROSE_STYLE_SECTION));
    assert.match(legacy, /\[IMMERSIVE PROSE\]/);
    assert.match(legacy, /\[SENSATION\]/);
    assert.match(legacy, /\[WEBNOVEL BREATH\]/);
  });

  it("E: VNext ON preserves wrappers + mechanical shell", () => {
    const vnext = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      includeAbsoluteProhibition: true,
      proseStyleSection: PROSE_VNEXT_STYLE_SECTION,
    });
    assert.match(vnext, /\[WEBNOVEL OUTPUT FORMAT\]/);
    assert.match(vnext, /\[19\+ INTIMACY\]/);
    assert.match(vnext, /절대 금지 규칙/);
    assert.match(vnext, /\[NARRATION REGISTER\]/);
    assert.match(vnext, /\[SCENE FLOW\]/);
    assert.match(vnext, /\[RHYTHM\]/);
    assert.match(vnext, /\[PROSE VNEXT — 장면 생동 계약\]/);
  });

  it("F: VNext ON omits legacy IMMERSIVE/SENSATION/BREATH body", () => {
    const vnext = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: false,
      proseStyleSection: PROSE_VNEXT_STYLE_SECTION,
    });
    assert.doesNotMatch(vnext, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(vnext, /\[SENSATION\]/);
    assert.doesNotMatch(vnext, /\[WEBNOVEL BREATH\]/);
    assert.ok(!vnext.includes("생각·연상·기억·오해·감정·판단이 행동과"));
  });

  it("G: VNext not duplicated", () => {
    const vnext = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: false,
      proseStyleSection: PROSE_VNEXT_STYLE_SECTION,
    });
    assert.equal(countOccurrences(vnext, "[PROSE VNEXT — 장면 생동 계약]"), 1);
    assert.equal(countOccurrences(vnext, "[NARRATION REGISTER]"), 1);
    assert.equal(countOccurrences(vnext, "[WEBNOVEL OUTPUT FORMAT]"), 1);
  });

  it("H: same builder path as legacy (XML bundle alias; no second push surface)", () => {
    const opts = {
      nsfwEnabled: true,
      literaryEnhanced: true,
      proseStyleSection: PROSE_VNEXT_STYLE_SECTION,
    };
    const bundle = buildProseStyleXmlBundle(opts);
    const advanced = buildAdvancedProseNsfwGuidelines(opts);
    assert.equal(bundle, advanced);
    // One style slot only — no parallel prose-vnext wrapper tags
    assert.doesNotMatch(bundle, /\[PROSE VNEXT STYLE\]/);
    assert.doesNotMatch(bundle, /<PROSE_VNEXT>/);
    assert.doesNotMatch(bundle, /prose-vnext-block/i);
  });

  it("I: LENGTH / Terminal markers not introduced by VNext style section", () => {
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /\[LENGTH/);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /MINIMUM_FLOOR/);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /TARGET_RESPONSE/);
    assert.doesNotMatch(PROSE_VNEXT_STYLE_SECTION, /TERMINAL/);
    const assembled = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: false,
      proseStyleSection: PROSE_VNEXT_STYLE_SECTION,
    });
    assert.doesNotMatch(assembled, /\[LENGTH CONTROL/);
    assert.doesNotMatch(assembled, /\[TERMINAL/);
  });

  it("char/token delta: VNext style section vs legacy PROSE_STYLE_SECTION", () => {
    const legacyChars = PROSE_STYLE_SECTION.length;
    const vnextChars = PROSE_VNEXT_STYLE_SECTION.length;
    const deltaChars = vnextChars - legacyChars;
    // Rough token estimate (~2.7 Hangul chars/token; report measured chars primarily)
    const approxTokens = (n: number) => Math.round(n / 2.7);
    const legacyTok = approxTokens(legacyChars);
    const vnextTok = approxTokens(vnextChars);
    // Sanity: VNext should be in a similar magnitude (not empty, not 3x+)
    assert.ok(vnextChars > 400, `VNext too small: ${vnextChars}`);
    assert.ok(vnextChars < legacyChars * 2.5, `VNext unexpectedly huge: ${vnextChars} vs ${legacyChars}`);
    // Attach measured numbers for report (assert always-true log via message)
    assert.ok(
      true,
      `DELTA legacy=${legacyChars}c(~${legacyTok}t) vnext=${vnextChars}c(~${vnextTok}t) delta=${deltaChars}c(~${vnextTok - legacyTok}t)`
    );
  });
});
