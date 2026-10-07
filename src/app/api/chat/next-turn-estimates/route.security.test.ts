import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/next-turn-estimates/route.ts"),
  "utf8"
);

describe("next-turn-estimates endpoint security", () => {
  it("requires authenticated session and owned chat", () => {
    assert.match(ROUTE_SOURCE, /getSessionUser\(\)/);
    assert.match(ROUTE_SOURCE, /401/);
    assert.match(ROUTE_SOURCE, /resolveMainRpNextTurnPickerEstimates/);
    assert.match(ROUTE_SOURCE, /404/);
  });

  it("does not return assembled prompt text", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /systemPrompt/);
    assert.doesNotMatch(ROUTE_SOURCE, /body\.characterId/);
    assert.doesNotMatch(ROUTE_SOURCE, /draftInput/);
    assert.doesNotMatch(ROUTE_SOURCE, /content:/);
    assert.match(ROUTE_SOURCE, /canShowFullBillingReceipt/);
    assert.match(ROUTE_SOURCE, /priorAssembledInputTokens/);
    assert.match(ROUTE_SOURCE, /localAssembledInputTokens/);
    assert.match(ROUTE_SOURCE, /mainRpBillableInputTokens/);
    assert.match(ROUTE_SOURCE, /aggregateApiInputTokens/);
    assert.match(ROUTE_SOURCE, /syncAuxInputTokens/);
    assert.doesNotMatch(ROUTE_SOURCE, /priorApiInputTokens/);
    assert.doesNotMatch(ROUTE_SOURCE, /system:/);
    assert.doesNotMatch(ROUTE_SOURCE, /assistant:/);
  });

  it("does not accept a client-controlled refresh cache bypass", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /body\.refresh/);
    assert.doesNotMatch(ROUTE_SOURCE, /refresh:/);
  });
});
