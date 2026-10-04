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
  });

  it("does not accept a client-controlled refresh cache bypass", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /body\.refresh/);
    assert.doesNotMatch(ROUTE_SOURCE, /refresh:/);
  });
});
