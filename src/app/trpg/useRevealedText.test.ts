import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  resolveTrpgRevealVisibleCount,
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
    assert.match(reveal, /resolveTrpgRevealVisibleCount/);
    assert.match(reveal, /complete: boolean/);
    assert.match(reveal, /shownText: string/);
  });

  it("R: finish + true prefix extension preserves progress", () => {
    const previous = "낡은 등불이 흔들";
    const extended = `${previous}리며 바람이 분다.`;
    assert.equal(trpgRevealTextExtended(previous, extended), true);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: extended, active: true, kind: "gm" },
        storedCount: Array.from(previous).length,
        finishOwned: true,
        reducedMotion: false,
      }),
      Array.from(previous).length
    );
  });

  it("S: finish + replacement/reroll starts fresh", () => {
    const previous = "낡은 등불이 흔들린다.";
    const replacement = "차가운 비가 내린다.";
    assert.equal(trpgRevealTextExtended(previous, replacement), false);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: replacement, active: true, kind: "gm" },
        storedCount: Array.from(previous).length,
        finishOwned: true,
        reducedMotion: false,
      }),
      0
    );
  });

  it("T: finish + shortened text starts fresh", () => {
    const previous = "낡은 등불이 흔들리며 바람이 분다.";
    const shortened = "낡은 등불";
    assert.equal(trpgRevealTextExtended(previous, shortened), false);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: shortened, active: true, kind: "gm" },
        storedCount: Array.from(previous).length,
        finishOwned: false,
        reducedMotion: false,
      }),
      0
    );
  });

  it("replacement first render starts at zero before passive effect", () => {
    const previous = "A".repeat(3000);
    const replacement = "B".repeat(2500);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: replacement, active: true, kind: "gm" },
        storedCount: 3000,
        finishOwned: false,
        reducedMotion: false,
      }),
      0
    );
  });

  it("shortening first render starts at zero before passive effect", () => {
    const previous = "A".repeat(3000);
    const shortened = "A".repeat(2500);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: shortened, active: true, kind: "gm" },
        storedCount: 3000,
        finishOwned: false,
        reducedMotion: false,
      }),
      0
    );
  });

  it("instant mode replacement still reveals immediately", () => {
    const previous = "A".repeat(3000);
    const replacement = "B".repeat(2500);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: replacement, active: true, kind: "gm" },
        storedCount: 3000,
        finishOwned: false,
        reducedMotion: true,
      }),
      2500
    );
  });

  it("same-round reroll does not inherit old visible count on first render", () => {
    const narrationA = "A".repeat(3000);
    const narrationB = "B".repeat(2500);
    const visibleCount = resolveTrpgRevealVisibleCount({
      previousSession: { text: narrationA, active: true, kind: "gm" },
      nextSession: { text: narrationB, active: true, kind: "gm" },
      storedCount: 3000,
      finishOwned: false,
      reducedMotion: false,
    });
    assert.equal(visibleCount, 0);
    assert.equal(visibleCount < Array.from(narrationB).length, true);
  });
});
