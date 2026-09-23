#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import {
  evaluateStreamComplete,
  parseSseBody,
} from "./collect-production-aligned-sse.ts";

const incomplete = parseSseBody(
  [
    'data: {"choices":[{"delta":{"content":"배 안쪽 끝까지 짓눌리는 감각에"}}]}',
    "",
  ].join("\n")
);
assert.equal(incomplete.text.includes("감각에"), true);
assert.equal(incomplete.finish, null);
assert.equal(incomplete.usage, null);
assert.equal(incomplete.sawDone, false);
assert.equal(
  evaluateStreamComplete({
    httpStatus: 200,
    sawDone: incomplete.sawDone,
    finishReason: incomplete.finish,
    usage: incomplete.usage,
    text: incomplete.text,
    collectorError: null,
  }),
  false,
  "#621-shaped incomplete stream must be INVALID"
);

const complete = parseSseBody(
  [
    'data: {"choices":[{"delta":{"content":"낮게 속삭였다."}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4}}',
    "data: [DONE]",
    "",
  ].join("\n")
);
assert.equal(complete.finish, "stop");
assert.equal(complete.sawDone, true);
assert.ok(complete.usage);
assert.equal(
  evaluateStreamComplete({
    httpStatus: 200,
    sawDone: complete.sawDone,
    finishReason: complete.finish,
    usage: complete.usage,
    text: complete.text,
    collectorError: null,
  }),
  true
);

const doneWithoutFinish = parseSseBody(
  [
    'data: {"choices":[{"delta":{"content":"끝."}}]}',
    'data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}',
    "data: [DONE]",
    "",
  ].join("\n")
);
assert.equal(doneWithoutFinish.finish, null);
assert.equal(doneWithoutFinish.sawDone, true);
assert.equal(
  evaluateStreamComplete({
    httpStatus: 200,
    sawDone: doneWithoutFinish.sawDone,
    finishReason: doneWithoutFinish.finish,
    usage: doneWithoutFinish.usage,
    text: doneWithoutFinish.text,
    collectorError: null,
  }),
  true,
  "Do not invent finishReason; [DONE]+usage is enough terminal evidence"
);

console.log("selftest-collector: PASS");
