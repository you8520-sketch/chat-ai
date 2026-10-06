import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareOfficialImageReferences } from "@/lib/officialSupply/referencePreparation";
import { OfficialImageTransportError } from "@/lib/officialSupply/runner";

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
});
