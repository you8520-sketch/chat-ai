import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONFIRMED_APPROVED_EXPERIMENT_REQUEST_ID_HASHES,
  classifyForwardSettledSpend,
  hashProviderRequestId,
  unknownRequestFingerprint,
} from "@/lib/approvedExperimentSpend";

const LEDGER = new Set(["prod-1"]);
const EVIDENCE = {
  confirmedRequestIdHashes: new Set([hashProviderRequestId("exp-gemini-1")]),
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
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "APPROVED_EXPERIMENT_CONFIRMED"
    );
  });

  it("A. the live catalog is 25 unique request-id hashes and confirms only those ids", () => {
    assert.equal(CONFIRMED_APPROVED_EXPERIMENT_REQUEST_ID_HASHES.size, 25);
    assert.equal(new Set(CONFIRMED_APPROVED_EXPERIMENT_REQUEST_ID_HASHES).size, 25);
    for (const hex of CONFIRMED_APPROVED_EXPERIMENT_REQUEST_ID_HASHES) {
      assert.match(hex, /^[0-9a-f]{64}$/);
    }
    const listed = "listed-experiment-request";
    assert.equal(
      classifyForwardSettledSpend({
        requestId: listed,
        ledgerIds: new Set(),
        evidence: { confirmedRequestIdHashes: new Set([hashProviderRequestId(listed)]) },
      }),
      "APPROVED_EXPERIMENT_CONFIRMED"
    );
  });

  it("B. a new request on HAV-1354-FLASH-AB-* is UNKNOWN, not prefix-confirmed", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "exp-flash-new-unapproved",
        ledgerIds: new Set(),
      }),
      "UNKNOWN_UNMATCHED"
    );
  });

  it("C. the same HAV-1354 name with an allowlisted request id stays CONFIRMED", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "exp-gemini-1",
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
        ledgerIds: LEDGER,
        evidence: EVIDENCE,
      }),
      "UNKNOWN_UNMATCHED"
    );
  });

  it("D. a new unlisted production request stays UNKNOWN", () => {
    assert.equal(
      classifyForwardSettledSpend({
        requestId: "prod-unlinked",
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
