import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import {
  commitMeasuredLedger,
  createAdultOffLiveCapture,
  type MeasuredLedgerRow,
} from "../../scripts/lib/adultOffGuardLiveCapture";

const URL = CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL;

function row(overrides: Partial<MeasuredLedgerRow>): MeasuredLedgerRow {
  return {
    request_kind: "adult-off-output-moderation",
    model: "gpt-6-luna",
    actual_cost_usd: 0.0002,
    actual_cost_source: "cheaper_inference_billed",
    event_status: "settled",
    provider_request_id: "ci-1",
    input_tokens: 10,
    output_tokens: 4,
    ...overrides,
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe("adult-OFF live capture — provider calls are kept from fetch start through ledger close", () => {
  it("keeps a call that is still waiting for headers, then records the billing id", async () => {
    const capture = createAdultOffLiveCapture();
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    void capture.forward(() => gate, URL, { body: "{}" }, { kind: "other", model: "gpt-6-luna" });
    const waiting = capture.snapshot();
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.headerAtMs, null);
    assert.equal(waiting[0]?.providerRequestId, null);

    let finished = false;
    const finishPromise = capture
      .finish({
        listOwners: () => [],
        readLedger: () => [row({ provider_request_id: "ci-late" })],
        deadlineMs: 5_000,
      })
      .then((report) => {
        finished = true;
        return report;
      });
    await yieldNow();
    assert.equal(finished, false, "header-pending calls are not treated as done");

    release(
      jsonResponse(
        { id: "chatcmpl-late", cheaper_inference: { request_id: "ci-late" } },
        { "x-ci-request-id": "ci-late" }
      )
    );
    const report = await finishPromise;
    assert.equal(report.reason, "ok");
    assert.equal(report.calls[0]?.providerRequestId, "ci-late");
    assert.equal(report.calls[0]?.completionId, "chatcmpl-late");
    assert.equal(report.mayDeleteLedger, true);
  });

  it("includes a follow-up call that starts only after the classifier response ends", async () => {
    const capture = createAdultOffLiveCapture();
    let releaseClassifier: (response: Response) => void = () => {};
    let releaseFollowUp: (response: Response) => void = () => {};
    const classifierGate = new Promise<Response>((resolve) => {
      releaseClassifier = resolve;
    });
    const followGate = new Promise<Response>((resolve) => {
      releaseFollowUp = resolve;
    });
    const owner = (async () => {
      await capture.forward(() => classifierGate, URL, { body: "{}" }, { kind: "classifier", model: "gpt-6-luna" });
      await capture.forward(() => followGate, URL, { body: "{}" }, { kind: "other", model: "gpt-6-luna" });
    })();
    const ledger = [
      row({ request_kind: "adult-off-output-moderation", provider_request_id: "ci-classifier", actual_cost_usd: 0.0003 }),
      row({
        request_kind: "background-post-turn-shared-initial",
        provider_request_id: "ci-shared",
        actual_cost_usd: 0.0004,
      }),
    ];
    const finishPromise = capture.finish({
      listOwners: () => [owner],
      readLedger: () => ledger,
      deadlineMs: 5_000,
    });
    releaseClassifier(
      jsonResponse({ id: "chatcmpl-classifier" }, { "x-ci-request-id": "ci-classifier" })
    );
    const waitStarted = Date.now();
    while (!capture.snapshot().some((call) => call.kind === "other") && Date.now() - waitStarted < 1_000) {
      await yieldNow();
    }
    const followUp = capture.snapshot().find((call) => call.kind === "other");
    assert.ok(followUp, "follow-up is tracked once the owner starts it");
    assert.equal(followUp?.headerAtMs, null, "tracked before its response headers arrive");
    releaseFollowUp(jsonResponse({ id: "chatcmpl-shared" }, { "x-ci-request-id": "ci-shared" }));
    const report = await finishPromise;
    assert.equal(report.reason, "ok");
    assert.deepEqual(
      report.calls.map((call) => [call.kind, call.providerRequestId, call.ledgerRequestKind]),
      [
        ["classifier", "ci-classifier", "adult-off-output-moderation"],
        ["other", "ci-shared", "background-post-turn-shared-initial"],
      ]
    );
    const expectedUsd = 0.0003 + 0.0004;
    assert.equal(report.cost.confirmedUsd, expectedUsd);
    assert.equal(report.cost.knownUsd, expectedUsd);
    assert.equal(report.mayReportSuccess, true);
  });

  it("keeps calls whose headers or body cannot be read and does not allow ledger deletion", async () => {
    const capture = createAdultOffLiveCapture();
    await assert.rejects(
      capture.forward(
        async () => {
          throw new Error("headers failed");
        },
        URL,
        { body: "{}" },
        { kind: "other", model: "gpt-6-luna" }
      ),
      /headers failed/
    );
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("body broke"));
        },
      }),
      { status: 200, headers: { "content-type": "application/json", "x-ci-request-id": "ci-kept" } }
    );
    await capture.forward(async () => broken, URL, { body: "{}" }, { kind: "other", model: "gpt-6-luna" });
    const report = await capture.finish({
      listOwners: () => [],
      readLedger: () => [row({ provider_request_id: "ci-kept", event_status: "failed_without_usage", actual_cost_usd: null, actual_cost_source: "unavailable" })],
      deadlineMs: 5_000,
    });
    assert.equal(report.calls.length, 2);
    assert.match(report.calls[0]?.headerError ?? "", /headers failed/);
    assert.equal(report.calls[1]?.providerRequestId, "ci-kept");
    assert.match(report.calls[1]?.bodyError ?? "", /body broke/);
    assert.equal(report.reason, "call_unreadable");
    assert.equal(report.mayDeleteLedger, false);
    assert.equal(report.cost.knownUsd, null);
    assert.equal(report.cost.confirmedUsd, 0);
  });

  it("does not substitute a completion id when the response has no billing id", async () => {
    const capture = createAdultOffLiveCapture();
    await capture.forward(
      async () => jsonResponse({ id: "chatcmpl-not-a-bill", choices: [{ message: { content: "{}" } }] }),
      URL,
      { body: "{}" },
      { kind: "other", model: "gpt-6-luna" }
    );
    const report = await capture.finish({
      listOwners: () => [],
      readLedger: () => [
        row({
          request_kind: "background-post-turn-shared-initial",
          provider_request_id: null,
          actual_cost_usd: 0.0001,
        }),
      ],
      deadlineMs: 5_000,
    });
    assert.equal(report.calls[0]?.providerRequestId, null);
    assert.equal(report.calls[0]?.completionId, "chatcmpl-not-a-bill");
    assert.equal(report.calls[0]?.ledgerRequestKind, null);
  });

  it("does not report success or delete the ledger while a follow-up row is still started", async () => {
    const capture = createAdultOffLiveCapture();
    await capture.forward(
      async () => jsonResponse({ id: "chatcmpl-shared" }, { "x-ci-request-id": "ci-shared" }),
      URL,
      { body: "{}" },
      { kind: "other", model: "gpt-6-luna" }
    );
    let ledger: MeasuredLedgerRow[] = [
      row({
        request_kind: "background-post-turn-shared-initial",
        event_status: "started",
        actual_cost_usd: null,
        actual_cost_source: null,
        provider_request_id: null,
        input_tokens: 0,
        output_tokens: 0,
      }),
    ];
    const owner = Promise.resolve();
    const open = await capture.finish({
      listOwners: () => [owner],
      readLedger: () => ledger,
      deadlineMs: 5_000,
    });
    assert.equal(open.reason, "ledger_not_closed");
    assert.equal(open.mayDeleteLedger, false);
    assert.equal(open.mayReportSuccess, false);
    assert.equal(open.calls[0]?.providerRequestId, "ci-shared");
    assert.equal(open.cost.knownUsd, null);
    assert.equal(open.cost.confirmedUsd, 0);
    let deleted = false;
    assert.equal(
      commitMeasuredLedger(open, () => {
        deleted = true;
      }),
      "incomplete"
    );
    assert.equal(deleted, false);

    ledger = [
      row({
        request_kind: "background-post-turn-shared-initial",
        provider_request_id: "ci-shared",
        actual_cost_usd: 0.0004,
      }),
      row({
        request_kind: "main-rp",
        model: "gpt-6.1-sol",
        event_status: "completed_without_exact_cost",
        actual_cost_usd: null,
        actual_cost_source: "unavailable",
        provider_request_id: "or-main",
      }),
    ];
    const closed = await capture.finish({
      listOwners: () => [],
      readLedger: () => ledger,
      deadlineMs: 5_000,
      estimatesUsdByRequestKind: new Map([["main-rp", 0.05]]),
    });
    assert.equal(closed.reason, "ok");
    assert.equal(closed.calls[0]?.ledgerRequestKind, "background-post-turn-shared-initial");
    assert.equal(closed.cost.confirmedUsd, 0.0004);
    assert.equal(closed.cost.estimatedUsd, 0.05);
    assert.equal(closed.cost.knownUsd, 0.0004 + 0.05);
    deleted = false;
    assert.equal(
      commitMeasuredLedger(closed, () => {
        deleted = true;
      }),
      "called"
    );
    assert.equal(deleted, true);
  });

  it("reports a timed-out header wait as incomplete and still keeps the call", async () => {
    const capture = createAdultOffLiveCapture();
    void capture.forward(() => new Promise<Response>(() => {}), URL, { body: "{}" }, { kind: "other", model: "gpt-6-luna" });
    const report = await capture.finish({
      listOwners: () => [],
      readLedger: () => [],
      deadlineMs: 40,
    });
    assert.equal(report.reason, "timed_out");
    assert.equal(report.calls.length, 1);
    assert.equal(report.calls[0]?.headerAtMs, null);
    assert.equal(report.mayDeleteLedger, false);
    assert.equal(report.mayReportSuccess, false);
  });

  it("wires the live measure script to the turn tail owner instead of a fixed sleep", () => {
    const source = readFileSync("scripts/adult-off-guard-live-measure.ts", "utf8");
    assert.match(source, /listOpenTurnTailWork/);
    assert.match(source, /commitMeasuredLedger/);
    assert.doesNotMatch(source, /teeJobs/);
    assert.doesNotMatch(source, /setTimeout\(resolve, 400\)/);
    assert.doesNotMatch(source, /setTimeout\(resolve, 150\)/);
  });
});
