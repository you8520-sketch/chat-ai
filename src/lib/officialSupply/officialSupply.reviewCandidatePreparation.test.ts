import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";

import { openAiOfficialImageTransport } from "@/lib/officialSupply/productionAdapters";
import {
  officialReviewCandidateReference,
  prepareOfficialImageReferences,
} from "@/lib/officialSupply/referencePreparation";
import { OfficialImageTransportError } from "@/lib/officialSupply/runner";

const F_RELATIVE = "docs/official-supply/reviews/assets/wolfgang-asset-redesign/rep-f-raw.webp";
const F_SHA = "a95f9aca91a09a4bf1cd2e13bab5c0bd226f8972bb2bf60990a66891150f8032";
const EDITS_URL = "https://api.openai.com/v1/images/edits";
const FIXTURE_KEY = "fixture-review-candidate-not-a-provider-key";

const originalFetch = globalThis.fetch;
const fetchCalls: string[] = [];

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function transportInput(reference: string) {
  return {
    model: "gpt-image-2.5-sunburst",
    primaryPrompt: "primary",
    strictFallbackPrompt: "strict",
    references: [reference],
    size: "1536x1024",
    quality: "medium" as const,
    outputCompression: 88,
    templateId: "official-review-candidate",
    idempotencyKey: "review-candidate-f",
  };
}

before(() => {
  process.env.OPENAI_API_KEY = FIXTURE_KEY;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = requestUrl(input);
    fetchCalls.push(url);
    assert.equal(url, EDITS_URL);
    assert.equal(init?.method, "POST");
    const authorization = new Headers(init?.headers).get("authorization");
    assert.equal(authorization, `Bearer ${FIXTURE_KEY}`);
    assert.ok(init?.body instanceof FormData);
    const images = init.body.getAll("image[]");
    assert.equal(images.length, 1);
    const image = images[0];
    assert.ok(image instanceof Blob);
    const bytes = Buffer.from(await image.arrayBuffer());
    const prepared = await prepareOfficialImageReferences([
      officialReviewCandidateReference(F_RELATIVE, F_SHA),
    ]);
    const match = /^data:image\/webp;base64,([\s\S]+)$/.exec(prepared[0] ?? "");
    assert.ok(match);
    assert.deepEqual(bytes, Buffer.from(match[1], "base64"));
    throw new Error("blocked before provider response");
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
});

describe("review candidate preparation through the official image transport", () => {
  it("reads F, builds image data, and stops before the provider response", async () => {
    const raw = fs.readFileSync(path.join(process.cwd(), F_RELATIVE));
    assert.equal(createHash("sha256").update(raw).digest("hex"), F_SHA);
    fetchCalls.length = 0;

    await assert.rejects(
      openAiOfficialImageTransport.generate(
        transportInput(officialReviewCandidateReference(F_RELATIVE, F_SHA))
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "blocked before provider response");
        assert.equal(error instanceof OfficialImageTransportError, false);
        return true;
      }
    );

    assert.deepEqual(fetchCalls, [EDITS_URL]);
    const prepared = await prepareOfficialImageReferences([
      officialReviewCandidateReference(F_RELATIVE, F_SHA),
    ]);
    const encoded = /^data:image\/webp;base64,([\s\S]+)$/.exec(prepared[0] ?? "");
    assert.ok(encoded);
    const bytes = Buffer.from(encoded[1], "base64");
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1536);
    assert.equal(bytes.length, 231636);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      "39d425e5bf7a8e48110107ab74e6d5989608d6d93156e85b10f90c77312ae1c7"
    );
    assert.equal(raw.length, 249520);
  });

  it("stops a missing file and a hash mismatch before the provider request", async () => {
    fetchCalls.length = 0;
    await assert.rejects(
      openAiOfficialImageTransport.generate(
        transportInput(
          officialReviewCandidateReference(
            "docs/official-supply/reviews/assets/wolfgang-asset-redesign/missing-f-candidate.webp",
            F_SHA
          )
        )
      ),
      (error: unknown) => {
        assert.ok(error instanceof OfficialImageTransportError);
        assert.equal(error.providerAttempted, false);
        assert.equal(error.costUsd, 0);
        assert.match(error.message, /reference not found/);
        return true;
      }
    );
    await assert.rejects(
      openAiOfficialImageTransport.generate(
        transportInput(officialReviewCandidateReference(F_RELATIVE, "c".repeat(64)))
      ),
      (error: unknown) => {
        assert.ok(error instanceof OfficialImageTransportError);
        assert.equal(error.providerAttempted, false);
        assert.equal(error.costUsd, 0);
        assert.match(error.message, /hash mismatch/);
        return true;
      }
    );
    await assert.rejects(
      openAiOfficialImageTransport.generate(transportInput(path.join(process.cwd(), F_RELATIVE))),
      (error: unknown) => {
        assert.ok(error instanceof OfficialImageTransportError);
        assert.equal(error.providerAttempted, false);
        assert.match(error.message, /unsupported reference source/);
        return true;
      }
    );
    assert.deepEqual(fetchCalls, []);
  });
});
