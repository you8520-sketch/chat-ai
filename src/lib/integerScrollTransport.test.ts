import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIntegerScrollDebtTransport } from "./integerScrollTransport";

describe("integer scroll debt transport", () => {
  it("emits one-pixel steps only after fractional intent reaches one pixel", () => {
    const applied: number[] = [];
    const transport = createIntegerScrollDebtTransport((delta) => applied.push(delta));

    assert.equal(transport.apply(0.33), 0);
    assert.equal(transport.apply(0.33), 0);
    assert.equal(transport.apply(0.34), 1);
    assert.deepEqual(applied, [1]);
    assert.equal(transport.getDebt(), 0);
  });

  it("keeps cadence debt separate from the next lifecycle", () => {
    const applied: number[] = [];
    const transport = createIntegerScrollDebtTransport((delta) => applied.push(delta));

    transport.apply(0.75);
    transport.reset();
    assert.equal(transport.getDebt(), 0);
    assert.equal(transport.apply(0.25), 0);
    assert.deepEqual(applied, []);
  });

  it("supports a negative correction without retaining stale debt", () => {
    const applied: number[] = [];
    const transport = createIntegerScrollDebtTransport((delta) => applied.push(delta));

    transport.apply(1.4);
    assert.equal(transport.apply(-0.6), 0);
    assert.equal(transport.getDebt(), -0.2);
    assert.equal(transport.apply(0.2), 0);
    assert.deepEqual(applied, [1]);
  });
});
