import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOpenAiCompatibleSseEvent,
  createOpenAiCompatibleSseEvidence,
  createOpenAiCompatibleSseFeedState,
  decodeOpenAiCompatibleSseResponse,
  extractOpenAiCompatibleStreamDelta,
  feedOpenAiCompatibleSseChunk,
  isOpenAiCompatibleSseContentType,
  reconstructOpenAiCompatibleCompletionBody,
} from "./openAiCompatibleSseDecoder";

const MODEL = "deepseek-v4.1-flash";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("multiple delta events concatenate 가 + 나다", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  const state = createOpenAiCompatibleSseFeedState();
  const events = feedOpenAiCompatibleSseChunk(
    state,
    [
      `data: ${JSON.stringify({ model: MODEL, choices: [{ delta: { content: "가" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "나다" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("")
  );
  for (const event of events) applyOpenAiCompatibleSseEvent(evidence, event);
  assert.equal(evidence.text, "가나다");
  assert.equal(evidence.responseModelId, MODEL);
  assert.equal(evidence.doneObserved, true);
});

test("byte chunks may split an SSE line", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  const state = createOpenAiCompatibleSseFeedState();
  const full = `data: ${JSON.stringify({ model: MODEL, choices: [{ delta: { content: "가나다" } }] })}\n\n`;
  const mid = Math.floor(full.length / 2);
  const first = feedOpenAiCompatibleSseChunk(state, full.slice(0, mid));
  assert.equal(first.length, 0);
  const second = feedOpenAiCompatibleSseChunk(state, full.slice(mid));
  for (const event of second) applyOpenAiCompatibleSseEvent(evidence, event);
  assert.equal(evidence.text, "가나다");
  assert.equal(evidence.responseModelId, MODEL);
});

test("multiple SSE events in one byte chunk parse", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  const state = createOpenAiCompatibleSseFeedState();
  const events = feedOpenAiCompatibleSseChunk(
    state,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "가" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "나다" } }] })}\n\ndata: [DONE]\n\n`
  );
  for (const event of events) applyOpenAiCompatibleSseEvent(evidence, event);
  assert.equal(evidence.text, "가나다");
  assert.equal(evidence.doneObserved, true);
});

test("model on first event is preserved when later events omit it", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  applyOpenAiCompatibleSseEvent(evidence, {
    kind: "json",
    value: { model: MODEL, choices: [{ delta: { content: "가" } }] },
  });
  applyOpenAiCompatibleSseEvent(evidence, {
    kind: "json",
    value: { choices: [{ delta: { content: "나다" } }] },
  });
  assert.equal(evidence.responseModelId, MODEL);
  assert.equal(evidence.text, "가나다");
});

test("generation id on first event is preserved when the terminal event omits it", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  applyOpenAiCompatibleSseEvent(evidence, {
    kind: "json",
    value: { id: "gen-first-chunk", model: MODEL, choices: [{ delta: { content: "가" } }] },
  });
  applyOpenAiCompatibleSseEvent(evidence, {
    kind: "json",
    value: { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1 } },
  });
  assert.equal(evidence.generationId, "gen-first-chunk");
  assert.equal(reconstructOpenAiCompatibleCompletionBody(evidence).id, "gen-first-chunk");
});

test("usage and cheaper_inference on final empty-choice event are preserved", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  applyOpenAiCompatibleSseEvent(evidence, {
    kind: "json",
    value: { model: MODEL, choices: [{ delta: { content: "가나다" } }] },
  });
  applyOpenAiCompatibleSseEvent(evidence, {
    kind: "json",
    value: {
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
      cheaper_inference: { billing: { status: "settled", billed_cost_usd: 0.002 } },
    },
  });
  applyOpenAiCompatibleSseEvent(evidence, { kind: "done" });
  assert.equal(evidence.text, "가나다");
  assert.deepEqual(evidence.lastUsage, { prompt_tokens: 11, completion_tokens: 7 });
  assert.deepEqual(evidence.lastCheaperInference, {
    billing: { status: "settled", billed_cost_usd: 0.002 },
  });
  assert.equal(evidence.doneObserved, true);
  const body = reconstructOpenAiCompatibleCompletionBody(evidence);
  assert.equal(body.model, MODEL);
  assert.equal((body.choices as Array<{ message: { content: string } }>)[0]?.message.content, "가나다");
});

test("malformed SSE JSON event is fail-closed evidence", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  const state = createOpenAiCompatibleSseFeedState();
  const events = feedOpenAiCompatibleSseChunk(state, "data: {not-json\n\n");
  for (const event of events) applyOpenAiCompatibleSseEvent(evidence, event);
  assert.ok(evidence.schemaError);
});

test("EOF before DONE is fail-closed", async () => {
  const evidence = await decodeOpenAiCompatibleSseResponse(
    sseResponse([
      `data: ${JSON.stringify({ model: MODEL, choices: [{ delta: { content: "가" } }] })}\n\n`,
    ])
  );
  assert.equal(evidence.doneObserved, false);
  assert.match(evidence.schemaError ?? "", /eof before terminal/i);
  assert.equal(evidence.streamCompleted, true);
});

test("[DONE] is observed", () => {
  const evidence = createOpenAiCompatibleSseEvidence();
  applyOpenAiCompatibleSseEvent(evidence, { kind: "done" });
  assert.equal(evidence.doneObserved, true);
});

test("extractOpenAiCompatibleStreamDelta reads delta.content", () => {
  assert.equal(extractOpenAiCompatibleStreamDelta({ delta: { content: "가" } }), "가");
  assert.equal(isOpenAiCompatibleSseContentType("text/event-stream; charset=utf-8"), true);
  assert.equal(isOpenAiCompatibleSseContentType("application/json"), false);
});
