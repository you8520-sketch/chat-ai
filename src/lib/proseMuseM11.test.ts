import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdvancedProseNsfwGuidelines,
  IMMERSIVE_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";
import { MUSE_PROSE_M11_STYLE_SECTION } from "@/lib/proseMuseM11";
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

describe("MUSE_PROSE_M11_STYLE_SECTION — admin-only single-slot candidate", () => {
  it("preserves mechanical shell + 8 M1.1 principles", () => {
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[NARRATION REGISTER\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[SCENE FLOW\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[RHYTHM\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[MUSE PROSE M1\.1 — 장면 연속 계약\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /1\. 사용자 입력은 이미 일어난 사실/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /8\. 종료 전 내부 점검/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /9\./);
  });

  it("no VNext or legacy behavioral body", () => {
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /\[PROSE VNEXT/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /\[SENSATION\]/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /\[WEBNOVEL BREATH\]/);
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes(IMMERSIVE_PROSE_BLOCK));
  });

  it("no LENGTH/Terminal or fixture leakage", () => {
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /\[LENGTH/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /TERMINAL/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /플러드/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /복도/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /대사량\s*\d/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /한 줄 이내/);
  });

  it("M1.1 ON via proseStyleSection seam — exactly once, legacy when OFF", () => {
    const legacyBundle = buildProseStyleXmlBundle({ nsfwEnabled: false });
    const m11Bundle = buildProseStyleXmlBundle({
      nsfwEnabled: false,
      proseStyleSection: MUSE_PROSE_M11_STYLE_SECTION,
    });
    assert.equal(countOccurrences(legacyBundle, "[MUSE PROSE M1.1"), 0);
    assert.equal(countOccurrences(m11Bundle, "[MUSE PROSE M1.1"), 1);
    assert.equal(countOccurrences(m11Bundle, "[PROSE VNEXT"), 0);
    assert.equal(
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false }).includes(PROSE_STYLE_SECTION),
      true
    );
    assert.equal(
      buildAdvancedProseNsfwGuidelines({
        nsfwEnabled: false,
        proseStyleSection: MUSE_PROSE_M11_STYLE_SECTION,
      }).includes(MUSE_PROSE_M11_STYLE_SECTION),
      true
    );
    assert.equal(
      buildAdvancedProseNsfwGuidelines({
        nsfwEnabled: false,
        proseStyleSection: MUSE_PROSE_M11_STYLE_SECTION,
      }).includes(PROSE_STYLE_SECTION),
      false
    );
  });

  it("similar magnitude to M1 section (not empty, not huge)", () => {
    const m11 = MUSE_PROSE_M11_STYLE_SECTION.length;
    const m1 = MUSE_PROSE_M1_STYLE_SECTION.length;
    assert.ok(m11 > 400);
    assert.ok(m11 < m1 * 1.5);
  });

  it("shares mechanical shell with M1 but behavioral body is distinct", () => {
    assert.ok(MUSE_PROSE_M11_STYLE_SECTION !== MUSE_PROSE_M1_STYLE_SECTION);
    assert.ok(MUSE_PROSE_M11_STYLE_SECTION !== PROSE_VNEXT_STYLE_SECTION);
    assert.ok(MUSE_PROSE_M11_STYLE_SECTION.includes("[NARRATION REGISTER]"));
    assert.ok(MUSE_PROSE_M11_STYLE_SECTION.includes("[MUSE PROSE M1.1 — 장면 연속 계약]"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("[MUSE PROSE M1 — 장면 연속 계약]"));
  });

  it("does not expose internal implementation terms", () => {
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("LENGTH owner"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("continuation"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("2차 호출"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("source-bound"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("source가"));
  });

  it("includes natural-language intent phrases", () => {
    assert.ok(MUSE_PROSE_M11_STYLE_SECTION.includes("한 번의 응답 안에서 전개"));
    assert.ok(
      MUSE_PROSE_M11_STYLE_SECTION.includes(
        "다음 사용자 반응이 필요한 지점까지 진행"
      )
    );
    assert.ok(
      MUSE_PROSE_M11_STYLE_SECTION.includes("근거가 확인된 정보만 구체화")
    );
    assert.ok(
      MUSE_PROSE_M11_STYLE_SECTION.includes(
        "1~4개 대사 덩어리는 우선 기준이며 절대 상한이 아님"
      )
    );
    assert.ok(
      MUSE_PROSE_M11_STYLE_SECTION.includes(
        "과묵한 캐릭터는 침묵과 행동으로 반응 가능"
      )
    );
  });
});
