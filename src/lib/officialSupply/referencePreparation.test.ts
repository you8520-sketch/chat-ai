import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  officialReviewCandidateReference,
  prepareOfficialImageReferences,
} from "@/lib/officialSupply/referencePreparation";
import { OfficialImageTransportError } from "@/lib/officialSupply/runner";

const F_RELATIVE = "docs/official-supply/reviews/assets/wolfgang-asset-redesign/rep-f-raw.webp";
const F_SHA = "a95f9aca91a09a4bf1cd2e13bab5c0bd226f8972bb2bf60990a66891150f8032";

describe("official supply reference preparation", () => {
  it("reads the platform-owned style seed from local public storage without self-fetch", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network egress forbidden");
    }) as typeof fetch;
    try {
      const refs = await prepareOfficialImageReferences(
        [
          "https://chat-ai-production-3e84.up.railway.app/official-supply/style-seeds/romance-fantasy-rf-02-v1.svg",
        ],
        { NEXTAUTH_URL: "https://chat-ai-production-3e84.up.railway.app" }
      );
      assert.equal(refs.length, 1);
      assert.match(refs[0] ?? "", /^data:image\/webp;base64,/);
      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses a same-pathname Cluster B primary STYLE from a non-platform origin", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network egress forbidden");
    }) as typeof fetch;
    try {
      await assert.rejects(
        prepareOfficialImageReferences(
          [
            "https://evil.example/official-supply/style-seeds/romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform.webp",
          ],
          { NEXTAUTH_URL: "https://example.test" }
        ),
        (error: unknown) => {
          assert.ok(error instanceof OfficialImageTransportError);
          assert.equal(error.providerAttempted, false);
          assert.equal(error.costUsd, 0);
          assert.match(error.message, /platform public storage/);
          return true;
        }
      );
      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("classifies local reference preparation failure as zero-cost before provider start", async () => {
    await assert.rejects(
      prepareOfficialImageReferences(
        [
          "https://chat-ai-production-3e84.up.railway.app/official-supply/style-seeds/missing-proof-seed.svg",
        ],
        { NEXTAUTH_URL: "https://chat-ai-production-3e84.up.railway.app" }
      ),
      (error: unknown) => {
        assert.ok(error instanceof OfficialImageTransportError);
        assert.equal(error.providerAttempted, false);
        assert.equal(error.costUsd, 0);
        assert.equal(error.hasUnknownAttemptCost, false);
        assert.match(error.message, /reference preparation failed/);
        return true;
      }
    );
  });

  it("rejects review candidate paths outside the review asset root", () => {
    const sha = "a".repeat(64);
    assert.throws(
      () => officialReviewCandidateReference("/etc/passwd", sha),
      /outside the review asset root/
    );
    assert.throws(
      () => officialReviewCandidateReference("docs/official-supply/reviews/assets/../../package.json", sha),
      /outside the review asset root/
    );
    assert.throws(
      () => officialReviewCandidateReference(F_RELATIVE, "not-a-sha"),
      /64 lowercase hex/
    );
    const owner = fs.readFileSync(
      path.join(process.cwd(), "src/lib/officialSupply/referencePreparation.ts"),
      "utf8"
    );
    assert.equal(owner.includes("rep-f-raw"), false);
    assert.equal(owner.includes(F_SHA), false);
  });

  it("prepares a named review candidate after the raw SHA matches", async () => {
    const raw = fs.readFileSync(path.join(process.cwd(), F_RELATIVE));
    assert.equal(createHash("sha256").update(raw).digest("hex"), F_SHA);
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network egress forbidden");
    }) as typeof fetch;
    try {
      const refs = await prepareOfficialImageReferences([
        officialReviewCandidateReference(F_RELATIVE, F_SHA),
      ]);
      assert.equal(refs.length, 1);
      assert.match(refs[0] ?? "", /^data:image\/webp;base64,/);
      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails a missing or mismatched review candidate before any fetch", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network egress forbidden");
    }) as typeof fetch;
    try {
      await assert.rejects(
        prepareOfficialImageReferences([
          officialReviewCandidateReference(
            "docs/official-supply/reviews/assets/wolfgang-asset-redesign/missing-f-candidate.webp",
            F_SHA
          ),
        ]),
        (error: unknown) => {
          assert.ok(error instanceof OfficialImageTransportError);
          assert.equal(error.providerAttempted, false);
          assert.equal(error.costUsd, 0);
          assert.match(error.message, /reference not found/);
          return true;
        }
      );
      await assert.rejects(
        prepareOfficialImageReferences([officialReviewCandidateReference(F_RELATIVE, "b".repeat(64))]),
        (error: unknown) => {
          assert.ok(error instanceof OfficialImageTransportError);
          assert.equal(error.providerAttempted, false);
          assert.match(error.message, /hash mismatch/);
          return true;
        }
      );
      await assert.rejects(
        prepareOfficialImageReferences([path.join(process.cwd(), F_RELATIVE)]),
        (error: unknown) => {
          assert.ok(error instanceof OfficialImageTransportError);
          assert.equal(error.providerAttempted, false);
          assert.match(error.message, /unsupported reference source/);
          return true;
        }
      );
      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
