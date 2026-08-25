import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  trpgRevealContinueCount,
  trpgRevealTextExtended,
} from "@/lib/trpg/revealTiming";

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
    assert.match(reveal, /trpgRevealTextExtended/);
    assert.match(reveal, /complete: boolean/);
    assert.match(reveal, /shownText: string/);
  });

  it("R: finish + true prefix extension preserves progress", () => {
    const previous = "낡은 등불이 흔들";
    const extended = `${previous}리며 바람이 분다.`;
    assert.equal(trpgRevealTextExtended(previous, extended), true);
    assert.equal(
      trpgRevealContinueCount({
        sessionChanged: false,
        shownCount: Array.from(previous).length,
        total: Array.from(extended).length,
      }),
      Array.from(previous).length
    );
  });

  it("S: finish + replacement/reroll starts fresh", () => {
    const previous = "낡은 등불이 흔들린다.";
    const replacement = "차가운 비가 내린다.";
    assert.equal(trpgRevealTextExtended(previous, replacement), false);
    assert.equal(
      trpgRevealContinueCount({
        sessionChanged: true,
        shownCount: Array.from(previous).length,
        total: Array.from(replacement).length,
      }),
      0
    );
  });

  it("T: finish + shortened text starts fresh", () => {
    const previous = "낡은 등불이 흔들리며 바람이 분다.";
    const shortened = "낡은 등불";
    assert.equal(trpgRevealTextExtended(previous, shortened), false);
    assert.equal(
      trpgRevealContinueCount({
        sessionChanged: true,
        shownCount: Array.from(previous).length,
        total: Array.from(shortened).length,
      }),
      0
    );
  });
});
