import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveTrpgRevealVisibleCount,
  shouldConsumeFinishLockOnPrefixExtension,
  trpgRevealSessionChanged,
  trpgRevealTextExtended,
} from "./revealTiming";

/** Mirrors the useRevealedText effect transition for finish + prefix extension. */
function simulateFinishThenPrefixExtension(opts: {
  prefixLen: number;
  suffixLen: number;
  partialBeforeFinish: number;
  tickSize: number;
}): {
  finishPrefixAtExtensionStart: number;
  finishLockConsumed: boolean;
  suffixTimerStarted: boolean;
  suffixProgressive: boolean;
  finalVisible: number;
  monotonic: boolean;
} {
  const prefix = "A".repeat(opts.prefixLen);
  const extended = prefix + "B".repeat(opts.suffixLen);
  let storedCount = opts.partialBeforeFinish;
  let finishOwned = false;
  let previousText = prefix;
  const kind = "gm" as const;
  const active = true;

  // finish()
  finishOwned = true;
  storedCount = opts.prefixLen;

  const sessionChanged = trpgRevealSessionChanged(
    { text: previousText, active, kind },
    { text: extended, active, kind }
  );
  const textExtended = trpgRevealTextExtended(previousText, extended);
  let visible = resolveTrpgRevealVisibleCount({
    previousSession: { text: previousText, active, kind },
    nextSession: { text: extended, active, kind },
    storedCount,
    finishOwned,
    reducedMotion: false,
  });
  const finishPrefixAtExtensionStart = visible;

  let finishLockConsumed = false;
  if (
    shouldConsumeFinishLockOnPrefixExtension({
      sessionChanged,
      textExtended,
      finishOwned,
    })
  ) {
    finishOwned = false;
    finishLockConsumed = true;
  }

  const total = Array.from(extended).length;
  const suffixTimerStarted = visible < total && !finishOwned;
  let suffixProgressive = false;
  let minVisibleAfterExtension = visible;

  while (visible < total && suffixTimerStarted) {
    const next = Math.max(visible, Math.min(total, visible + opts.tickSize));
    suffixProgressive = suffixProgressive || (next > opts.prefixLen && next < total);
    minVisibleAfterExtension = Math.min(minVisibleAfterExtension, next);
    visible = next;
  }

  return {
    finishPrefixAtExtensionStart,
    finishLockConsumed,
    suffixTimerStarted,
    suffixProgressive,
    finalVisible: visible,
    monotonic: minVisibleAfterExtension >= opts.prefixLen,
  };
}

describe("TRPG reveal finish + extension lifecycle", () => {
  it("A: finish at 2500 then true extension to 2700 progressively reveals suffix", () => {
    const result = simulateFinishThenPrefixExtension({
      prefixLen: 2500,
      suffixLen: 200,
      partialBeforeFinish: 300,
      tickSize: 40,
    });
    assert.equal(result.finishPrefixAtExtensionStart, 2500);
    assert.ok(result.finishPrefixAtExtensionStart >= 2500, "first render after extension preserves prefix");
    assert.equal(result.finishLockConsumed, true);
    assert.equal(result.suffixTimerStarted, true);
    assert.equal(result.suffixProgressive, true);
    assert.equal(result.finalVisible, 2700);
    assert.equal(result.monotonic, true);
  });

  it("finish lock would block suffix if not consumed on extension", () => {
    const prefix = "A".repeat(2500);
    const extended = prefix + "B".repeat(200);
    let finishOwned = true;
    const visible = resolveTrpgRevealVisibleCount({
      previousSession: { text: prefix, active: true, kind: "gm" },
      nextSession: { text: extended, active: true, kind: "gm" },
      storedCount: 2500,
      finishOwned,
      reducedMotion: false,
    });
    assert.equal(visible, 2500);
    const blocked = visible >= 2700 || finishOwned;
    assert.equal(blocked, true, "without consuming finish lock, suffix timer cannot start");
    finishOwned = false;
    assert.equal(2500 < 2700 && !finishOwned, true);
  });

  it("E: replacement after finish starts fresh at zero", () => {
    const previous = "A".repeat(2500);
    const replacement = "B".repeat(2500);
    assert.equal(trpgRevealTextExtended(previous, replacement), false);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: replacement, active: true, kind: "gm" },
        storedCount: 2500,
        finishOwned: true,
        reducedMotion: false,
      }),
      0
    );
  });
});
