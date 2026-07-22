import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/model-picker-preview/route.ts"),
  "utf8"
);

describe("model-picker-preview endpoint security", () => {
  it("requires authenticated session", () => {
    assert.match(ROUTE_SOURCE, /getSessionUser\(\)/);
    assert.match(ROUTE_SOURCE, /401/);
  });

  it("scopes chat lookup to owning user", () => {
    assert.match(ROUTE_SOURCE, /FROM chats WHERE id=\? AND user_id=\?/);
  });

  it("derives character from owned chat row (no client character override)", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /body\.characterId/);
    assert.doesNotMatch(ROUTE_SOURCE, /character_id=\?.*body/);
  });

  it("builds preview from server-side active model list", () => {
    assert.match(ROUTE_SOURCE, /buildModelPickerPreview/);
    assert.doesNotMatch(ROUTE_SOURCE, /body\.modelId/);
  });
});
