import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  preserveStreamFirstProse,
  shouldSkipStreamEndShrink,
  STREAM_SAVE_MIN_RETENTION,
} from "@/lib/streamFirstSave";

describe("streamFirstSave", () => {
  it("preserves stream-visible prose when candidate loses more than 5%", () => {
    const stream = "가".repeat(1800);
    const candidate = "나".repeat(1500);
    const out = preserveStreamFirstProse(stream, candidate, 2000);
    assert.equal(out, stream);
  });

  it("accepts candidate when retention is at least 95%", () => {
    const stream = "가".repeat(1000);
    const candidate = "나".repeat(960);
    const out = preserveStreamFirstProse(stream, candidate, 2000);
    assert.equal(out, candidate);
  });

  it("shouldSkipStreamEndShrink blocks 1700 to 1590 style drop", () => {
    const stream = "가".repeat(1750);
    const next = "나".repeat(1590);
    assert.equal(
      shouldSkipStreamEndShrink(stream, next, STREAM_SAVE_MIN_RETENTION),
      true
    );
  });
});
