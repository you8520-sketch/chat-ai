/**
 * Phase D.3 — deterministic evidence builder tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyCacheField } from "./lib/gemini31PhaseD2Usage";
import { classifyAliasJoin, classifyD1Join } from "./lib/gemini31PhaseD3Evidence";

describe("gemini31PhaseD3Evidence", () => {
  it("classifyAliasJoin: exact UUID when header id matches usage record", () => {
    assert.equal(classifyAliasJoin("uuid-1", "uuid-1", true), "EXACT_UUID_JOIN");
  });

  it("classifyAliasJoin: correlated when ids differ", () => {
    assert.equal(classifyAliasJoin("hdr-1", "usage-2", true), "HEADER_ID_CORRELATED");
  });

  it("classifyD1Join: token fingerprint labeled honestly", () => {
    assert.equal(classifyD1Join("token_fingerprint"), "TOKEN_FINGERPRINT_JOIN");
    assert.equal(classifyD1Join("request_id"), "EXACT_UUID_JOIN");
  });

  it("does not collapse null cache to zero", () => {
    assert.equal(classifyCacheField(null), "NOT_RECORDED");
    assert.equal(classifyCacheField(0), "RECORDED_ZERO");
  });
});
