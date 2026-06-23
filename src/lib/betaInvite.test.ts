import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  isValidBetaInviteCode,
  normalizeInviteCode,
  parseBetaInviteCodes,
} from "@/lib/betaInvite";

describe("betaInvite", () => {
  const prev = process.env.BETA_INVITE_CODES;

  afterEach(() => {
    if (prev === undefined) delete process.env.BETA_INVITE_CODES;
    else process.env.BETA_INVITE_CODES = prev;
  });

  it("allows any code when BETA_INVITE_CODES unset", () => {
    delete process.env.BETA_INVITE_CODES;
    assert.equal(parseBetaInviteCodes().length, 0);
    assert.equal(isValidBetaInviteCode("anything"), true);
  });

  it("validates against configured codes (case-insensitive)", () => {
    process.env.BETA_INVITE_CODES = "beta-abc123,BETA-XYZ789";
    assert.equal(isValidBetaInviteCode("beta-abc123"), true);
    assert.equal(isValidBetaInviteCode("beta-xyz789"), true);
    assert.equal(isValidBetaInviteCode("wrong"), false);
    assert.equal(isValidBetaInviteCode(""), false);
  });

  it("normalizes invite codes", () => {
    assert.equal(normalizeInviteCode("  beta-abc  "), "BETA-ABC");
  });
});
