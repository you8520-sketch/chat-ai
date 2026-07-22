import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelPickerPreviewRequestGate } from "@/lib/modelPickerPreviewRequestGate";

describe("modelPickerPreviewRequestGate", () => {
  it("applies only the latest response when B completes before A", () => {
    const gate = createModelPickerPreviewRequestGate();
    const seqA = gate.next();
    const seqB = gate.next();

    assert.equal(gate.isLatest(seqB), true);
    assert.equal(gate.isLatest(seqA), false);

    // B response lands first — still latest
    assert.equal(gate.isLatest(seqB), true);

    // Stale A response must be ignored
    assert.equal(gate.isLatest(seqA), false);
  });
});
