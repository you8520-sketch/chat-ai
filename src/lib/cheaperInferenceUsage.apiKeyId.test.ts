import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchUsageRequestsPage } from "@/lib/cheaperInferenceUsage";

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
});
