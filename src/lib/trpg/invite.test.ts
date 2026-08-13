import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrpgInviteInput, trpgInvitePath } from "./invite";

describe("TRPG invite links", () => {
  it("parses raw codes, paths, and full URLs", () => {
    assert.equal(parseTrpgInviteInput("AbCdEf12"), "abcdef12");
    assert.equal(parseTrpgInviteInput("  /trpg/join/abcdef12  "), "abcdef12");
    assert.equal(parseTrpgInviteInput("https://example.com/trpg/join/abcdef12"), "abcdef12");
    assert.equal(parseTrpgInviteInput("https://example.com/trpg?code=abcdef12"), "abcdef12");
    assert.equal(parseTrpgInviteInput("not-a-code"), "");
    assert.equal(trpgInvitePath("ABCDEF12"), "/trpg/join/abcdef12");
  });
});
