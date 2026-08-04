/**
 * Production regression fixture replay — verifies the fixed sanitizeHairDescriptions
 * does not inflate paragraph count on a redacted production-like RAW.
 *
 * Run: node --conditions=react-server --import tsx --test src/lib/bodyHairRules.regressionFixture.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeHairDescriptions, type HairDescriptionPolicy } from "@/lib/bodyHairRules";

const restrictive: HairDescriptionPolicy = {
  charGender: "male",
  allowsBeard: false,
  allowsBodyHair: false,
};

const fixturePath = join(process.cwd(), "src/lib/__fixtures__/hairSanitizerRegressionRaw.txt");
const raw = readFileSync(fixturePath, "utf8");

function paragraphCount(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim()).length;
}
function quoteCount(text: string): number {
  return (text.match(/["“]/g) ?? []).length;
}

describe("sanitizeHairDescriptions production regression fixture", () => {
  it("no-violation RAW → byte-identical, paragraph count unchanged", () => {
    const out = sanitizeHairDescriptions(raw, restrictive);
    assert.equal(out, raw, "output must be byte-identical when no violation");
    assert.equal(paragraphCount(out), paragraphCount(raw));
    assert.equal(quoteCount(out), quoteCount(raw));
  });

  it("paragraph non-increase on violation-injected variant", () => {
    const injected =
      "조태형은 잠시 멍하니 상대를 내려다보다가, 이내 낮은 웃음을 터뜨렸다. 그의 턱에는 짙은 수염이 자라 있었다. 그 웃음은 가볍고 무심했다.\n\n\"본기억이 안 난다고?\"\n\n그의 목소리는 능청스러웠다.";
    const out = sanitizeHairDescriptions(injected, restrictive);
    assert.ok(paragraphCount(out) <= paragraphCount(injected) + 1);
    assert.ok(!out.includes("수염"));
    assert.ok(out.includes("가볍고 무심했다"));
  });

  it("idempotence on fixture", () => {
    const once = sanitizeHairDescriptions(raw, restrictive);
    const twice = sanitizeHairDescriptions(once, restrictive);
    assert.equal(twice, once);
  });
});
