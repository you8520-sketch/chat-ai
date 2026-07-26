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
  it("preserves mechanical shell + 7 M1.1-B principles", () => {
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[NARRATION REGISTER\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[SCENE FLOW\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[RHYTHM\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /\[MUSE PROSE M1\.1-B — 장면 확장 계약\]/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /1\. 다음 순간부터 이어간다/);
    assert.match(MUSE_PROSE_M11_STYLE_SECTION, /7\. 장면의 변화 위에 착지한다/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /8\./);
  });

  it("states the scene-expansion intent", () => {
    for (const phrase of [
      "[MUSE PROSE M1.1-B — 장면 확장 계약]",
      "짧은 입력은 장면 축약 신호가 아니다",
      "하나의 장면 단위를 충분히 진행",
      "확인 결과 자체가 주어지지 않았다면 결과 내용을 발명하지 않는다",
      "장면 안에서는 여러 변화가 일어날 수 있지만",
      "마지막에 사용자가 반응할 중심은 하나로 모은다",
    ]) {
      assert.ok(
        MUSE_PROSE_M11_STYLE_SECTION.includes(phrase),
        `missing phrase: ${phrase}`
      );
    }
  });

  it("hardens source-grounding for lookup tools and unresolved results", () => {
    for (const phrase of [
      "장면에 이미 확인 수단이 있으면",
      "장면에 없던 단말기·서류·기록을 편의상 새로 만들지 않는다",
      "확인 행동의 시작·중단·실패",
      "확인되지 않은 내용이나 관계 변화를 억지로 만들지 않는다",
    ]) {
      assert.ok(
        MUSE_PROSE_M11_STYLE_SECTION.includes(phrase),
        `missing phrase: ${phrase}`
      );
    }
    for (const phrase of [
      "단말기·서류를 확인하려는 행동은 할 수 있다",
      "확인 행동과 그 물리적 결과",
      "캐릭터의 선택과 관계 변화는 충분히 진행",
      "마지막에 사용자에게 열어두는 핵심 질문이나 반응 요구는 하나",
    ]) {
      assert.ok(
        !MUSE_PROSE_M11_STYLE_SECTION.includes(phrase),
        `unexpected phrase: ${phrase}`
      );
    }
  });

  it("drops dialogue count targets and early-close pressure", () => {
    for (const phrase of [
      "1~4개",
      "0~2개",
      "다음 사용자 반응이 필요한 지점까지",
    ]) {
      assert.ok(
        !MUSE_PROSE_M11_STYLE_SECTION.includes(phrase),
        `unexpected phrase: ${phrase}`
      );
    }
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
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /대사량\s*\d/);
    assert.doesNotMatch(MUSE_PROSE_M11_STYLE_SECTION, /한 줄 이내/);
    for (const fixture of ["B동", "브리핑룸", "서강우", "플러드", "복도"]) {
      assert.ok(
        !MUSE_PROSE_M11_STYLE_SECTION.includes(fixture),
        `unexpected fixture: ${fixture}`
      );
    }
  });

  it("M1.1-B ON via proseStyleSection seam — exactly once, legacy when OFF", () => {
    const legacyBundle = buildProseStyleXmlBundle({ nsfwEnabled: false });
    const m11Bundle = buildProseStyleXmlBundle({
      nsfwEnabled: false,
      proseStyleSection: MUSE_PROSE_M11_STYLE_SECTION,
    });
    assert.equal(countOccurrences(legacyBundle, "[MUSE PROSE M1.1-B"), 0);
    assert.equal(countOccurrences(m11Bundle, "[MUSE PROSE M1.1-B"), 1);
    assert.equal(countOccurrences(m11Bundle, "[MUSE PROSE M1 "), 0);
    assert.equal(countOccurrences(m11Bundle, "[PROSE VNEXT"), 0);
    assert.equal(countOccurrences(m11Bundle, PROSE_STYLE_SECTION), 0);
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

  it("LENGTH and Terminal marker counts unchanged by the M1.1-B swap", () => {
    const legacyBundle = buildProseStyleXmlBundle({ nsfwEnabled: false });
    const m11Bundle = buildProseStyleXmlBundle({
      nsfwEnabled: false,
      proseStyleSection: MUSE_PROSE_M11_STYLE_SECTION,
    });
    for (const marker of ["[LENGTH", "TARGET_LENGTH:", "MINIMUM_FLOOR:", "TERMINAL"]) {
      assert.equal(
        countOccurrences(m11Bundle, marker),
        countOccurrences(legacyBundle, marker),
        `marker count changed: ${marker}`
      );
    }
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
    assert.ok(MUSE_PROSE_M11_STYLE_SECTION.includes("[MUSE PROSE M1.1-B — 장면 확장 계약]"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("[MUSE PROSE M1 — 장면 연속 계약]"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("[MUSE PROSE M1.1 — 장면 연속 계약]"));
  });

  it("does not expose internal implementation terms", () => {
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("LENGTH owner"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("continuation"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("2차 호출"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("source-bound"));
    assert.ok(!MUSE_PROSE_M11_STYLE_SECTION.includes("source가"));
  });
});
