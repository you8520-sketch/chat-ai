import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";
import {
  parseStrictNumericProposal,
  reduceNumericStateProposal,
} from "@/lib/rpNumericState/reducer";
import { NumericStateInvalidCurrentError } from "@/lib/rpNumericState/types";

const meter100: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 40,
  integer: true,
  maxIncreasePerTurn: 5,
  maxDecreasePerTurn: 5,
};

const meter10: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 10,
  initial: 3,
  integer: true,
};

describe("Phase B1-A — strict proposal parser (P1-P12)", () => {
  it("P1 number 43", () => {
    assert.equal(parseStrictNumericProposal(43, meter100), 43);
  });
  it('P2 "43"', () => {
    assert.equal(parseStrictNumericProposal("43", meter100), 43);
  });
  it('P3 "43.5"', () => {
    assert.equal(parseStrictNumericProposal("43.5", meter100), 43.5);
  });
  it('P4 "1,000"', () => {
    assert.equal(parseStrictNumericProposal("1,000", meter100), 1000);
  });
  it('P5 "43%" with 0..100 → 43', () => {
    assert.equal(parseStrictNumericProposal("43%", meter100), 43);
  });
  it('P6 "43%" with 0..10 → invalid', () => {
    assert.equal(parseStrictNumericProposal("43%", meter10), null);
  });
  it('P7 "43/100" with max 100 → 43', () => {
    assert.equal(parseStrictNumericProposal("43/100", meter100), 43);
  });
  it('P8 "43/10" max100 → invalid', () => {
    assert.equal(parseStrictNumericProposal("43/10", meter100), null);
  });
  it('P9 "약 43" → invalid', () => {
    assert.equal(parseStrictNumericProposal("약 43", meter100), null);
  });
  it('P10 "40~50" → invalid', () => {
    assert.equal(parseStrictNumericProposal("40~50", meter100), null);
  });
  it('P11 "호감도 43" → invalid', () => {
    assert.equal(parseStrictNumericProposal("호감도 43", meter100), null);
  });
  it("P12 NaN/Infinity → invalid", () => {
    assert.equal(parseStrictNumericProposal(Number.NaN, meter100), null);
    assert.equal(parseStrictNumericProposal(Number.POSITIVE_INFINITY, meter100), null);
  });
});

describe("Phase B1-A — pure reducer (R1-R13)", () => {
  it("R1 normal increase", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 40,
      proposal: 43,
      sourceKind: "extractor",
    });
    assert.equal(r.outcome, "APPLIED");
    assert.equal(r.afterValue, 43);
    assert.equal(r.appliedDelta, 3);
  });

  it("R2 normal decrease", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 40,
      proposal: 37,
      sourceKind: "extractor",
    });
    assert.equal(r.outcome, "APPLIED");
    assert.equal(r.afterValue, 37);
    assert.equal(r.appliedDelta, -3);
  });

  it("R3 unchanged", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 40,
      proposal: 40,
      sourceKind: "extractor",
    });
    assert.equal(r.outcome, "NO_CHANGE");
    assert.equal(r.afterValue, 40);
    assert.equal(r.appliedDelta, 0);
  });

  it("R4 invalid → HOLD", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 40,
      proposal: "약 43",
      sourceKind: "extractor",
    });
    assert.equal(r.outcome, "INVALID_HOLD");
    assert.equal(r.afterValue, 40);
    assert.equal(r.proposedValue, null);
  });

  it("R5 over max", () => {
    const r = reduceNumericStateProposal({
      definition: { ...meter100, maxIncreasePerTurn: undefined },
      beforeValue: 40,
      proposal: 999,
      sourceKind: "extractor",
    });
    assert.equal(r.afterValue, 100);
    assert.ok(r.adjustments.includes("CLAMPED_MAX"));
  });

  it("R6 under min", () => {
    const r = reduceNumericStateProposal({
      definition: { ...meter100, maxDecreasePerTurn: undefined },
      beforeValue: 40,
      proposal: -50,
      sourceKind: "extractor",
    });
    assert.equal(r.afterValue, 0);
    assert.ok(r.adjustments.includes("CLAMPED_MIN"));
  });

  it("R7 max increase limit", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 40,
      proposal: 80,
      sourceKind: "extractor",
    });
    assert.equal(r.afterValue, 45);
    assert.equal(r.proposedDelta, 40);
    assert.equal(r.appliedDelta, 5);
    assert.ok(r.adjustments.includes("DELTA_LIMITED_UP"));
  });

  it("R8 max decrease limit", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 40,
      proposal: 0,
      sourceKind: "extractor",
    });
    assert.equal(r.afterValue, 35);
    assert.ok(r.adjustments.includes("DELTA_LIMITED_DOWN"));
  });

  it("R9 integer rounding", () => {
    const r = reduceNumericStateProposal({
      definition: { ...meter100, maxIncreasePerTurn: undefined },
      beforeValue: 40,
      proposal: 43.6,
      sourceKind: "extractor",
    });
    assert.equal(r.afterValue, 44);
    assert.ok(r.adjustments.includes("INTEGER_COERCED"));
  });

  it("R10 multiple adjustment flags possible", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 40,
      proposal: 999,
      sourceKind: "extractor",
    });
    assert.equal(r.afterValue, 45);
    assert.ok(r.adjustments.includes("CLAMPED_MAX"));
    assert.ok(r.adjustments.includes("DELTA_LIMITED_UP"));
  });

  it("R11 manual override bypasses delta limit", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 20,
      proposal: 80,
      sourceKind: "manual_override",
    });
    assert.equal(r.afterValue, 80);
    assert.equal(r.adjustments.includes("DELTA_LIMITED_UP"), false);
  });

  it("R12 manual override still clamps max/min", () => {
    const r = reduceNumericStateProposal({
      definition: meter100,
      beforeValue: 20,
      proposal: 150,
      sourceKind: "manual_override",
    });
    assert.equal(r.afterValue, 100);
    assert.ok(r.adjustments.includes("CLAMPED_MAX"));
  });

  it("R13 invalid current state fails hard", () => {
    assert.throws(
      () =>
        reduceNumericStateProposal({
          definition: meter100,
          beforeValue: Number.NaN,
          proposal: 40,
          sourceKind: "extractor",
        }),
      NumericStateInvalidCurrentError
    );
    assert.throws(
      () =>
        reduceNumericStateProposal({
          definition: meter100,
          beforeValue: 999,
          proposal: 40,
          sourceKind: "extractor",
        }),
      NumericStateInvalidCurrentError
    );
  });
});
