import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { anchorQaFromEvidenceFile } from "@/lib/officialSupply/approvedAssetApplyOperator";
import { compositionCheck } from "@/lib/officialSupply/officialSupply.approvedApplyFixtures";
import { ANCHOR_QA_KEYS, OfficialSupplyGateError } from "@/lib/officialSupply/store";

const SHA = "b".repeat(64);
const URL = "/uploads/official-x__rep-a1.webp";
const ACTUAL = { draftKey: "x", candidateUrl: URL, candidateSha256: SHA };

function evidenceFile(overrides: Record<string, unknown> = {}) {
  return {
    draftKey: "x",
    reviewer: "reviewer-a",
    approvalEvidence: "compared the card with references 07, 04, 08 side by side",
    candidateUrl: URL,
    candidateSha256: SHA,
    qa: {
      ...Object.fromEntries(ANCHOR_QA_KEYS.map((key) => [key, { ok: true, note: `${key} checked on the image` }])),
      compositionIndependence: compositionCheck(URL, SHA),
    },
    ...overrides,
  };
}

const refused = (raw: unknown) => assert.throws(() => anchorQaFromEvidenceFile(raw, ACTUAL), OfficialSupplyGateError);

describe("anchor review evidence file (no blanket approve)", () => {
  it("accepts a complete file and keeps the composition comparison basis", () => {
    const result = anchorQaFromEvidenceFile(evidenceFile(), ACTUAL);
    assert.equal(result.reviewer, "reviewer-a");
    assert.equal(result.qa.compositionIndependence?.evidence?.candidateSha256, SHA);
    assert.ok(ANCHOR_QA_KEYS.every((key) => result.qa[key].note));
  });

  it("refuses an approval string with no per-check judgements", () => {
    refused(evidenceFile({ qa: undefined }));
    refused(evidenceFile({ qa: {} }));
    refused(null);
    refused("approve");
  });

  it("refuses a check without a note, a missing key, or an unknown key", () => {
    const base = evidenceFile();
    refused({ ...base, qa: { ...base.qa, face: { ok: true, note: " " } } });
    const { hair: _hair, ...withoutHair } = base.qa as Record<string, unknown>;
    refused({ ...base, qa: withoutHair });
    refused({ ...base, qa: { ...base.qa, extra: { ok: true, note: "x" } } });
    refused({ ...base, qa: { ...base.qa, compositionIndependence: { ok: true, note: "" } } });
  });

  it("binds the file to the draft, the stored representative URL and the SHA-256 of its bytes", () => {
    refused(evidenceFile({ draftKey: "other" }));
    refused(evidenceFile({ candidateUrl: "/uploads/other.webp" }));
    refused(evidenceFile({ candidateSha256: "c".repeat(64) }));
  });

  it("refuses missing reviewer or approval evidence and test-fixture text", () => {
    refused(evidenceFile({ reviewer: "" }));
    refused(evidenceFile({ approvalEvidence: " " }));
    refused(evidenceFile({ approvalEvidence: "test-fixture-not-quality-approval" }));
    const base = evidenceFile();
    refused({ ...base, qa: { ...base.qa, face: { ok: true, note: "test fixture" } } });
  });
});
