import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyForwardSettledSpend,
  hashProviderRequestId,
  unknownRequestFingerprint,
} from "@/lib/approvedExperimentSpend";

const LEDGER = new Set(["prod-1"]);
const EVIDENCE = {
  confirmedRequestIdHashes: new Set([hashProviderRequestId("exp-gemini-1")]),
  exclusiveKeyNamePrefixes: ["HAV-1354-"],
};

describe("approved experiment spend classification", () => {
  it("matches a production ledger request id exactly", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "prod-1",
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "PRODUCTION_LEDGER_MATCHED"
    );
  });

  it("confirms an approved experiment by hashed request id", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "exp-gemini-1",
        apiKeyName: "operator-agent",
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "APPROVED_EXPERIMENT_CONFIRMED"
    );
  });

  it("confirms exclusive experiment-key use without a hash allowlist hit", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "exp-flash-new",
        apiKeyName: "HAV-1354-FLASH-AB-4CALL-20261006",
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "APPROVED_EXPERIMENT_CONFIRMED"
    );
  });

  it("does not confirm when API key identity is missing and the id is unknown", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "unknown-1",
        apiKeyId: null,
        apiKeyName: null,
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "UNKNOWN_UNMATCHED"
    );
  });

  it("does not invent a confirmed cost from an unused catalog hash", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "never-called",
        apiKeyName: "HAV-PRODUCTION",
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "UNKNOWN_UNMATCHED"
    );
  });

  it("refuses to confirm from a production-like name that is not an exclusive prefix", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "prod-unlinked",
        apiKeyName: "HAV-PRODUCTION",
        ledgerIds: new Set(),
        evidence: EVIDENCE,
      }),
      "UNKNOWN_UNMATCHED"
    );
  });

  it("keeps the same unknown fingerprint across provider reorder", () => {
    const a = unknownRequestFingerprint(["b", "a", "c"]);
    const b = unknownRequestFingerprint(["c", "a", "b"]);
    assert.equal(a, b);
    assert.notEqual(a, unknownRequestFingerprint(["a", "b", "c", "d"]));
  });

  it("treats a blank request id as unverifiable", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "  ",
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "UNVERIFIABLE"
    );
  });
});
