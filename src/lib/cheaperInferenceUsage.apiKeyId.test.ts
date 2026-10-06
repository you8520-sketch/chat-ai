import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchUsageRequestsPage,
  lookupCheaperInferenceUsageRequestById,
} from "@/lib/cheaperInferenceUsage";

describe("CheaperInference usage api_key_id contract", () => {
  it("accepts string and numeric api_key_id from the documented usage item", async () => {
    const previous = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-usage-key";
    try {
      const stringPage = await fetchUsageRequestsPage({
        startAt: "2026-10-01T00:00:00Z",
        endAt: "2026-10-02T00:00:00Z",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              object: "list",
              data: [
                {
                  request_id: "req-string-key",
                  status: "settled",
                  billed_cost_usd: "0.01",
                  model: "deepseek-v4-pro-0813",
                  endpoint: "/chat/completions",
                  created_at: "2026-10-02T01:00:00Z",
                  api_key_id: "key_abc",
                  api_key_name: "must-not-be-parsed-as-id",
                },
              ],
            }),
            { status: 200 }
          ),
      });
      assert.equal(stringPage.ok, true);
      if (stringPage.ok) {
        assert.equal(stringPage.value.requests[0]!.apiKeyId, "key_abc");
      }

      const numericPage = await fetchUsageRequestsPage({
        startAt: "2026-10-01T00:00:00Z",
        endAt: "2026-10-02T00:00:00Z",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  request_id: "req-numeric-key",
                  status: "settled",
                  billed_cost_usd: "0.02",
                  api_key_id: 42,
                },
              ],
            }),
            { status: 200 }
          ),
      });
      assert.equal(numericPage.ok, true);
      if (numericPage.ok) {
        assert.equal(numericPage.value.requests[0]!.apiKeyId, "42");
      }
    } finally {
      if (previous == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previous;
    }
  });

  it("uses an explicit reporting apiKey and never the production env key", async () => {
    const previous = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "production-must-not-be-sent";
    try {
      const auths: string[] = [];
      const page = await fetchUsageRequestsPage({
        startAt: "2026-10-06T05:50:00Z",
        endAt: "2026-10-06T06:05:00Z",
        apiKey: "reporting-only-key",
        fetchImpl: async (_input, init) => {
          auths.push(String((init?.headers as { Authorization?: string } | undefined)?.Authorization ?? ""));
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        },
      });
      assert.equal(page.ok, true);
      assert.deepEqual(auths, ["Bearer reporting-only-key"]);
    } finally {
      if (previous == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previous;
    }
  });

  it("bounded lookup polls until the request appears", async () => {
    let gets = 0;
    const found = await lookupCheaperInferenceUsageRequestById({
      requestId: "req-live",
      startAt: "2026-10-06T05:50:00Z",
      endAt: "2026-10-06T06:05:00Z",
      apiKey: "reporting-only-key",
      sleep: async () => undefined,
      fetchImpl: async () => {
        gets += 1;
        const data =
          gets === 1
            ? []
            : [
                {
                  request_id: "req-live",
                  status: "settled",
                  billed_cost_usd: "0.000528",
                  model: "deepseek-v4.1-flash",
                  endpoint: "/v1/chat/completions",
                },
              ];
        return new Response(JSON.stringify({ data }), { status: 200 });
      },
    });
    assert.equal(found.ok, true);
    if (found.ok) {
      assert.equal(found.value.status, "settled");
      assert.equal(found.value.billedMicroUsd, 528);
      assert.equal(found.value.model, "deepseek-v4.1-flash");
      assert.equal(found.value.endpoint, "/v1/chat/completions");
    }
    assert.equal(gets, 2);
  });

  it("bounded lookup fail-closes on HTTP 403 without further GETs", async () => {
    let gets = 0;
    const result = await lookupCheaperInferenceUsageRequestById({
      requestId: "req-live",
      startAt: "2026-10-06T05:50:00Z",
      endAt: "2026-10-06T06:05:00Z",
      apiKey: "reporting-only-key",
      fetchImpl: async () => {
        gets += 1;
        return new Response("no", { status: 403 });
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "http");
      assert.equal(result.status, 403);
    }
    assert.equal(gets, 1);
  });

  it("bounded lookup expires as incomplete when the request never appears", async () => {
    let gets = 0;
    const result = await lookupCheaperInferenceUsageRequestById({
      requestId: "req-live",
      startAt: "2026-10-06T05:50:00Z",
      endAt: "2026-10-06T06:05:00Z",
      apiKey: "reporting-only-key",
      sleep: async () => undefined,
      fetchImpl: async () => {
        gets += 1;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "incomplete");
    assert.equal(gets, 3);
  });
});
