import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkMessageApiResponse,
  classifyCostRows,
  estimateUsdFromUsage,
  reconstructScreenText,
  reconstructScreenTimeline,
  screenBeforeAndAfter,
  splitLatency,
} from "../../scripts/lib/adultOffGuardEvidence";

describe("adult-OFF guard evidence rules", () => {
  it("rebuilds the screen with replace/delta/reset/finalContent semantics, not concatenation", () => {
    const events = [
      { type: "status", text: "마무리 중…" },
      { type: "delta", text: "가나" },
      { type: "delta", text: "다" },
      { type: "reset" },
      { type: "replace", text: "라마바" },
      { type: "done", finalContent: "라마바 사" },
    ];
    assert.equal(reconstructScreenText(events), "라마바 사");
    assert.equal(reconstructScreenText(events.slice(0, 3)), "가나다");
    assert.equal(reconstructScreenText(events.slice(0, 5)), "라마바");
    const naive = events.map((e) => String(e.text ?? e.finalContent ?? "")).join("");
    assert.notEqual(naive, reconstructScreenText(events));
  });

  it("shows an empty screen before approval and the body after", () => {
    const timeline = reconstructScreenTimeline([
      { atMs: 10, event: { type: "status" } },
      { atMs: 20, event: { type: "stream_heartbeat" } },
      { atMs: 900, event: { type: "replace", text: "본문" } },
      { atMs: 910, event: { type: "done", finalContent: "본문!" } },
    ]);
    assert.deepEqual(screenBeforeAndAfter(timeline), {
      charsBeforeFirstBodyEvent: 0,
      firstBodyAtMs: 900,
      charsAtEnd: 3,
    });
    assert.deepEqual(screenBeforeAndAfter([]), {
      charsBeforeFirstBodyEvent: 0,
      firstBodyAtMs: null,
      charsAtEnd: 0,
    });
  });

  it("compares message API status and parsed JSON content with the stored body", () => {
    const stored = '그가 "잠깐" 말했다.\n다음 줄';
    const ok = checkMessageApiResponse({
      status: 200,
      bodyText: JSON.stringify({ content: stored }),
      storedContent: stored,
    });
    assert.equal(ok.reason, "ok");
    assert.equal(ok.matchesStored, true);
    assert.ok(
      !JSON.stringify({ content: stored }).includes(stored.slice(0, 40)),
      "raw substring search on JSON text is not a valid comparison for escaped content"
    );
    assert.equal(
      checkMessageApiResponse({ status: 404, bodyText: "{}", storedContent: stored }).reason,
      "http_error"
    );
    assert.equal(
      checkMessageApiResponse({ status: 200, bodyText: "<html>", storedContent: stored }).reason,
      "invalid_json"
    );
    assert.equal(
      checkMessageApiResponse({ status: 200, bodyText: "{}", storedContent: stored }).reason,
      "missing_content"
    );
    assert.equal(
      checkMessageApiResponse({
        status: 200,
        bodyText: JSON.stringify({ content: "다른 본문" }),
        storedContent: stored,
      }).reason,
      "content_mismatch"
    );
  });

  it("splits latency without double counting and reports overlap explicitly", () => {
    assert.deepEqual(splitLatency({ totalMs: 1000, providerMs: 600, classifierMs: 300 }), {
      totalMs: 1000,
      providerMs: 600,
      classifierMs: 300,
      otherMs: 100,
      overlapMs: 0,
    });
    const overlapped = splitLatency({ totalMs: 800, providerMs: 600, classifierMs: 300 });
    assert.equal(overlapped.otherMs, 0);
    assert.equal(overlapped.overlapMs, 100);
    assert.equal(splitLatency({ totalMs: 800, providerMs: null, classifierMs: 300 }).otherMs, null);
  });

  it("classifies cost as confirmed, estimated and unconfirmed without hiding started rows", () => {
    const result = classifyCostRows(
      [
        { request_kind: "adult-off-output-moderation", model: "gpt-6-luna", actual_cost_usd: 0.0003, actual_cost_source: "cheaper_inference_billed", event_status: "settled" },
        { request_kind: "main-rp", model: "gpt-6.1-sol", actual_cost_usd: null, actual_cost_source: "unavailable", event_status: "completed_without_exact_cost" },
        { request_kind: "background-post-turn-shared-initial", model: "gpt-6-luna", actual_cost_usd: null, actual_cost_source: null, event_status: "started" },
      ],
      new Map([["main-rp", 0.05]])
    );
    assert.equal(result.confirmedUsd, 0.0003);
    assert.equal(result.estimatedUsd, 0.05);
    assert.equal(result.confirmedRows, 1);
    assert.equal(result.estimatedRows, 1);
    assert.deepEqual(result.unconfirmedRows, [
      { request_kind: "background-post-turn-shared-initial", model: "gpt-6-luna", event_status: "started" },
    ]);
  });

  it("keeps a main row without an estimate unconfirmed instead of zero", () => {
    const result = classifyCostRows([
      { request_kind: "main-rp", model: "m", actual_cost_usd: null, actual_cost_source: "unavailable", event_status: "completed_without_exact_cost" },
    ]);
    assert.equal(result.estimatedUsd, 0);
    assert.equal(result.unconfirmedRows.length, 1);
  });

  it("estimates usage cost with cache read/write rates", () => {
    const usd = estimateUsdFromUsage(
      { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 } },
      { inputUsdPerM: 1, outputUsdPerM: 10, cacheReadUsdPerM: 0.1, cacheWriteUsdPerM: 2 }
    );
    assert.equal(usd, (500 * 1 + 200 * 0.1 + 300 * 2 + 100 * 10) / 1_000_000);
  });
});
