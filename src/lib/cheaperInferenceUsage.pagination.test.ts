import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  CI_USAGE_COVER_BUDGET_MS,
  CI_USAGE_COVER_PAGE_BUDGET,
  CI_USAGE_PAGE_CAP,
  fetchAllUsageRequests,
} from "./cheaperInferenceUsage";

const START = "2026-10-01T00:00:00.000Z";
const END = "2026-11-01T00:00:00.000Z";
const START_MS = Date.parse(START);
const END_MS = Date.parse(END);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Half-open provider: index i exists only in [START, END). Pages hold 100 rows. */
function monthHistoryFetch(total: number): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async (url: string) => {
    calls += 1;
    const parsed = new URL(url);
    const windowStart = Date.parse(parsed.searchParams.get("start_at") ?? "");
    const windowEnd = Date.parse(parsed.searchParams.get("end_at") ?? "");
    const limit = Number(parsed.searchParams.get("limit") ?? "100");
    const cursor = Number(parsed.searchParams.get("cursor") ?? "0");
    const rows: Array<Record<string, unknown>> = [];
    let next = cursor;
    for (let i = cursor; i < total && rows.length < limit; i += 1) {
      const at = START_MS + Math.floor((i * (END_MS - START_MS)) / total);
      if (at < windowStart) continue;
      if (at >= windowEnd) break;
      rows.push({
        request_id: `req-${i}`,
        status: "pending",
        billed_cost_usd: "0",
        created_at: new Date(at).toISOString(),
      });
      next = i + 1;
    }
    const moreAt = START_MS + Math.floor((next * (END_MS - START_MS)) / total);
    const more = next < total && moreAt < windowEnd;
    return jsonResponse({ data: rows, next_cursor: more ? String(next) : null });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

function neverEndingFetch(): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({
      data: [{ request_id: `row-${calls}`, status: "pending", billed_cost_usd: "0" }],
      next_cursor: `cursor-${calls}`,
    });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

describe("CheaperInference usage window coverage", () => {
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;

  afterEach(() => {
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  });

  it("reads a history longer than the 50-page slice cap without marking a short read complete", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const total = CI_USAGE_PAGE_CAP * 100 + 100;
    const history = monthHistoryFetch(total);
    const capped = neverEndingFetch();
    const cappedResult = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      maxPages: CI_USAGE_PAGE_CAP,
      apiKey: "test-key",
      fetchImpl: capped.fetchImpl,
    });
    assert.equal(cappedResult.ok, false);
    if (!cappedResult.ok) assert.equal(cappedResult.reason, "incomplete");
    assert.equal(capped.calls(), CI_USAGE_PAGE_CAP);

    const covered = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl: history.fetchImpl,
    });
    assert.equal(covered.ok, true);
    if (!covered.ok) return;
    assert.equal(covered.value.requests.length, total);
    assert.equal(new Set(covered.value.requests.map((row) => row.requestId)).size, total);
    assert.equal(covered.value.requests[0]!.requestId, "req-0");
    assert.equal(covered.value.requests[total - 1]!.requestId, `req-${total - 1}`);
    assert.ok(history.calls() > CI_USAGE_PAGE_CAP);
    assert.ok(covered.value.pages > CI_USAGE_PAGE_CAP);
  });

  it("keeps a single page under 100 rows", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const history = monthHistoryFetch(40);
    const result = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl: history.fetchImpl,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.requests.length, 40);
    assert.equal(result.value.pages, 1);
    assert.equal(history.calls(), 1);
  });

  it("covers the month start and excludes the exclusive month end", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      const parsed = new URL(url);
      const windowStart = Date.parse(parsed.searchParams.get("start_at") ?? "");
      const windowEnd = Date.parse(parsed.searchParams.get("end_at") ?? "");
      const points = [
        { id: "month-start", at: START_MS },
        { id: "before-end", at: END_MS - 1 },
        { id: "month-end", at: END_MS },
      ];
      const data = points
        .filter((point) => point.at >= windowStart && point.at < windowEnd)
        .map((point) => ({
          request_id: point.id,
          status: "pending",
          billed_cost_usd: "0",
          created_at: new Date(point.at).toISOString(),
        }));
      return jsonResponse({ data, next_cursor: null });
    }) as typeof fetch;
    const result = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.value.requests.map((row) => row.requestId),
      ["month-start", "before-end"]
    );
    assert.equal(seen.length, 1);
    const parsed = new URL(seen[0]!);
    assert.equal(Date.parse(parsed.searchParams.get("start_at") ?? ""), START_MS);
    assert.equal(Date.parse(parsed.searchParams.get("end_at") ?? ""), END_MS);
  });

  it("keeps one copy when the same request id is returned twice", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const pages = [
      {
        data: [{ request_id: "same", status: "pending", billed_cost_usd: "0" }],
        next_cursor: "next",
      },
      {
        data: [
          { request_id: "same", status: "pending", billed_cost_usd: "0" },
          { request_id: "other", status: "pending", billed_cost_usd: "0" },
        ],
        next_cursor: null,
      },
    ];
    let call = 0;
    const fetchImpl = (async () => {
      const page = pages[call] ?? pages[pages.length - 1];
      call += 1;
      return jsonResponse(page);
    }) as typeof fetch;
    const result = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.value.requests.map((row) => row.requestId),
      ["same", "other"]
    );
  });

  it("fails the whole read when a later page returns HTTP 500", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          data: [{ request_id: "kept-out", status: "pending", billed_cost_usd: "0" }],
          next_cursor: "next",
        });
      }
      return new Response("unavailable", { status: 500 });
    }) as typeof fetch;
    const result = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "http");
  });

  it("fails the whole read when the provider times out", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const fetchImpl = (async () => {
      throw new Error("The operation was aborted due to timeout");
    }) as typeof fetch;
    const result = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "network");
  });

  it("does not follow a repeated or non-string cursor", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    let repeatedCalls = 0;
    const repeated = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl: (async () => {
        repeatedCalls += 1;
        return jsonResponse({
          data: [{ request_id: `r-${repeatedCalls}`, status: "pending", billed_cost_usd: "0" }],
          next_cursor: "loop",
        });
      }) as typeof fetch,
    });
    assert.equal(repeated.ok, false);
    if (!repeated.ok) assert.equal(repeated.reason, "schema");
    assert.equal(repeatedCalls, 2);

    const malformed = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl: (async () =>
        jsonResponse({
          data: [{ request_id: "bad-cursor", status: "pending", billed_cost_usd: "0" }],
          next_cursor: 12,
        })) as typeof fetch,
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.reason, "schema");
  });

  it("stops a cursor that never ends instead of reporting success", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const stuck = neverEndingFetch();
    const result = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      fetchImpl: stuck.fetchImpl,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "incomplete");
    assert.equal(stuck.calls(), CI_USAGE_COVER_PAGE_BUDGET);

    const tiny = neverEndingFetch();
    const unsplittable = await fetchAllUsageRequests({
      startAt: "2026-10-15T00:00:00.000Z",
      endAt: "2026-10-15T00:00:00.001Z",
      apiKey: "test-key",
      fetchImpl: tiny.fetchImpl,
    });
    assert.equal(unsplittable.ok, false);
    if (!unsplittable.ok) assert.equal(unsplittable.reason, "incomplete");
    assert.equal(tiny.calls(), CI_USAGE_PAGE_CAP);
  });

  it("fails closed when the coverage time budget is already spent", async () => {
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    let calls = 0;
    let ticks = 0;
    const result = await fetchAllUsageRequests({
      startAt: START,
      endAt: END,
      apiKey: "test-key",
      now: () => {
        ticks += 1;
        return ticks === 1 ? 1_000 : 1_000 + CI_USAGE_COVER_BUDGET_MS + 1;
      },
      fetchImpl: (async () => {
        calls += 1;
        return jsonResponse({ data: [], next_cursor: null });
      }) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "incomplete");
    assert.equal(calls, 0);
  });
});
