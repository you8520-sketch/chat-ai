import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { readCompatibleCompletionProviderRequestId } from "@/lib/openRouterCompletion";

const STREAM_SOURCE = readFileSync(
  new URL("./openRouterAdult.ts", import.meta.url),
  "utf8"
);

describe("CheaperInference request-id contract (non-streaming vs stream)", () => {
  it("does not persist x-ci-request-id on the non-streaming completion path", () => {
    const headers = new Headers({
      "x-ci-request-id": "ci-only-uuid",
      "x-cheaper-inference-request-id": "ci-alias-uuid",
    });
    assert.equal(readCompatibleCompletionProviderRequestId(headers), null);
  });

  it("persists x-request-id when that generic header is the only identity", () => {
    const headers = new Headers({ "x-request-id": "generic-request-id" });
    assert.equal(
      readCompatibleCompletionProviderRequestId(headers),
      "generic-request-id"
    );
  });

  it("keeps the live non-streaming reader on generic headers only", () => {
    const source = readFileSync(
      new URL("./openRouterCompletion.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /readCompatibleCompletionProviderRequestId\(res\.headers\)/);
    assert.match(
      source,
      /headers\.get\("x-request-id"\) \?\? headers\.get\("x-openrouter-request-id"\)/
    );
    assert.equal(source.includes("x-ci-request-id"), false);
  });

  it("does not treat Cloudflare cf-ray as a CheaperInference billing request id", () => {
    const cfRay = "8a1b2c3d4e5f6g7h-ICN";
    assert.equal(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-/i.test(cfRay), false);
    assert.match(STREAM_SOURCE, /res\.headers\.get\("cf-ray"\)/);
    const streamBlock = STREAM_SOURCE.slice(
      STREAM_SOURCE.indexOf("providerRequestId ="),
      STREAM_SOURCE.indexOf("providerRequestId =") + 420
    );
    assert.match(streamBlock, /x-ci-request-id/);
    assert.match(streamBlock, /cf-ray/);
    assert.ok(
      streamBlock.indexOf("x-ci-request-id") < streamBlock.indexOf("cf-ray"),
      "cf-ray must remain a last-resort fallback, not the CI billing owner"
    );
  });
});
