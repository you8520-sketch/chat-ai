/**
 * sanitizeHairDescriptions paragraph-preservation tests (T1-T12).
 * Run: node --conditions=react-server --import tsx --test src/lib/bodyHairRules.sanitizeHairDescriptions.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeHairDescriptions, type HairDescriptionPolicy } from "@/lib/bodyHairRules";

const restrictive: HairDescriptionPolicy = {
  charGender: "male",
  allowsBeard: false,
  allowsBodyHair: false,
};
const permissive: HairDescriptionPolicy = {
  charGender: "male",
  allowsBeard: true,
  allowsBodyHair: true,
};
const femaleChar: HairDescriptionPolicy = {
  charGender: "female",
  allowsBeard: false,
  allowsBodyHair: false,
};

function paragraphCount(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim()).length;
}
function wsNorm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("sanitizeHairDescriptions paragraph preservation", () => {
  it("T1 — no violation byte identity (multi-sentence RP, restrictive)", () => {
    const input =
      '조태형은 잠시 멍하니 상대를 내려다보다가, 이내 낮은 웃음을 터뜨렸다. 그 웃음은 로비에 깔린 소음처럼 가볍고 무심했다.\n\n"본기억이 안 난다고?"\n\n그의 목소리는 능청스러웠다.';
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, input);
    assert.equal(paragraphCount(out), paragraphCount(input));
  });

  it("T2 — permissive policy byte identity (beard/body-hair present)", () => {
    const input = "그의 턱에는 짙은 수염이 자라 있었다. 음모가 드러났다.";
    const out = sanitizeHairDescriptions(input, permissive);
    assert.equal(out, input);
  });

  it("T3 — paragraph-internal first sentence removed, rest stay in one paragraph", () => {
    const input = "그의 턱에는 짙은 수염이 자라 있었다. 정상 문장 1. 정상 문장 2.";
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, "정상 문장 1. 정상 문장 2.");
    assert.equal(paragraphCount(out), 1);
    assert.ok(paragraphCount(out) <= paragraphCount(input));
  });

  it("T4 — paragraph-internal middle sentence removed", () => {
    const input = "정상 문장 1. 그의 턱에는 짙은 수염이 자라 있었다. 정상 문장 2.";
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, "정상 문장 1. 정상 문장 2.");
    assert.equal(paragraphCount(out), 1);
  });

  it("T5 — paragraph-internal last sentence removed, boundary preserved", () => {
    const input = "정상 문장 1. 정상 문장 2. 그의 턱에는 짙은 수염이 자라 있었다.";
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, "정상 문장 1. 정상 문장 2.");
    assert.equal(paragraphCount(out), 1);
  });

  it("T6 — paragraph with only violation removed, no 3+ blank lines", () => {
    const input = "정상 문단 A.\n\n그의 턱에는 짙은 수염이 자라 있었다.\n\n정상 문단 B.";
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, "정상 문단 A.\n\n정상 문단 B.");
    assert.equal(paragraphCount(out), 2);
    assert.ok(!/\n{3,}/.test(out));
  });

  it("T7 — quoted multi-sentence dialogue preserved byte-identical (no violation)", () => {
    const input =
      '"뭐라고? 처음 듣는데. 네가 정말 그렇게 말했어?"\n\n그는 고개를 기울였다.';
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, input);
  });

  it("T8 — dialogue + narration mix, no violation → byte-identical", () => {
    const input =
      '정상 지문.\n\n"여러 문장으로 된 대사. 두 번째 문장."\n\n정상 지문.';
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, input);
  });

  it("T9 — CRLF preserved (no violation)", () => {
    const input = "정상 문장 1.\r\n\r\n정상 문장 2.";
    const out = sanitizeHairDescriptions(input, restrictive);
    assert.equal(out, input);
    assert.ok(out.includes("\r\n"));
  });

  it("T10 — idempotence", () => {
    const input =
      "정상 문장 1. 그의 턱에는 짙은 수염이 자라 있었다. 정상 문장 2.\n\n음모가 드러났다.";
    const once = sanitizeHairDescriptions(input, restrictive);
    const twice = sanitizeHairDescriptions(once, restrictive);
    assert.equal(twice, once);
  });

  it("T11 — paragraph non-increase property across fixtures", () => {
    const fixtures = [
      "정상 문장 1. 정상 문장 2.",
      "그의 턱에는 짙은 수염이 자라 있었다. 정상 문장.",
      "정상 A.\n\n그의 턱에는 짙은 수염이 자라 있었다.\n\n정상 B.",
      "정상.\n\n정상.\n\n음모가 드러났다.",
    ];
    for (const f of fixtures) {
      const out = sanitizeHairDescriptions(f, restrictive);
      assert.ok(
        paragraphCount(out) <= paragraphCount(f),
        `paragraph increased: ${paragraphCount(f)} -> ${paragraphCount(out)} for ${JSON.stringify(f)}`
      );
    }
  });

  it("T12 — production regression fixture: no-violation RAW stays unchanged", () => {
    // Redacted production-like RAW: multi-sentence narration paragraphs, no hair violation.
    const raw =
      '조태형은 잠시 멍하니 상대를 내려다보다가, 이내 낮은 웃음을 터뜨렸다. 그 웃음은 가볍고 무심했다.\n\n"본기억이 안 난다고?"\n\n그의 목소리는 능청스러웠다. 검은 네일이 박힌 손가락이 턱을 두드렸다.';
    const out = sanitizeHairDescriptions(raw, restrictive);
    assert.equal(out, raw);
    assert.equal(paragraphCount(out), paragraphCount(raw));
    assert.equal(wsNorm(out), wsNorm(raw));
  });

  it("T12b — production regression: violation present → paragraph count not inflated", () => {
    // Same shape but with a hair-violation sentence inserted.
    const raw =
      "조태형은 잠시 멍하니 상대를 내려다보다가, 이내 낮은 웃음을 터뜨렸다. 그의 턱에는 짙은 수염이 자라 있었다. 그 웃음은 가볍고 무심했다.\n\n\"본기억이 안 난다고?\"\n\n그의 목소리는 능청스러웠다.";
    const out = sanitizeHairDescriptions(raw, restrictive);
    assert.ok(paragraphCount(out) <= paragraphCount(raw) + 1);
    assert.ok(!out.includes("수염"));
    assert.ok(out.includes("가볍고 무심했다"));
  });

  it("female char policy: beard violation removed, paragraph preserved", () => {
    const input = "정상 문장. 그녀의 턱에 수염이 있었다. 정상 문장.";
    const out = sanitizeHairDescriptions(input, femaleChar);
    assert.equal(out, "정상 문장. 정상 문장.");
    assert.equal(paragraphCount(out), 1);
  });
});
