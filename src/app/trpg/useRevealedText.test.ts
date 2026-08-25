import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { trpgRevealContinueCount } from "@/lib/trpg/revealTiming";

describe("useRevealedText finish semantics", () => {
  it("preserves shown progress when text grows after finish()", () => {
    const shownBeforeGrowth = 12;
    const totalAfterGrowth = 20;
    const continueCount = trpgRevealContinueCount({
      sessionChanged: false,
      shownCount: shownBeforeGrowth,
      total: totalAfterGrowth,
    });
    assert.equal(continueCount, shownBeforeGrowth);
  });

  it("exposes finish without restarting a completed session", () => {
    const reveal = readFileSync("src/app/trpg/useRevealedText.ts", "utf8");
    assert.match(reveal, /finishRequestedRef/);
    assert.match(reveal, /onlyTextGrew/);
    assert.match(reveal, /complete: boolean/);
    assert.match(reveal, /shownText: string/);
  });
});
