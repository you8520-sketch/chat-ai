import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_61_SOL_MODEL } from "@/lib/chatModels";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const FX = 1560.6;

function solP(cacheReadTokens: number, cacheWriteTokens: number): number | null {
  return computePublishedStandardPreviewDisplayPoints({
    modelId: SOL,
    promptTokens: 17_104,
    outputTokens: 2_726,
    cacheReadTokens,
    cacheWriteTokens,
    effectiveKrwPerUsd: FX,
  });
}

describe("POLICY RED — user points ignore cache partition", () => {
  it("same Sol input/output yields the same user P for miss / read / write", () => {
    const miss = solP(0, 0);
    const hit = solP(8_000, 0);
    const write = solP(0, 8_000);
    assert.equal(miss, 174);
    assert.equal(hit, miss);
    assert.equal(write, miss);
  });
});
