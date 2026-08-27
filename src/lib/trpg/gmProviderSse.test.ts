import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import { feedGmProviderSseBytes } from "./gmProviderSse";

function collectSse(chunks: string[]): { payloads: unknown[]; done: boolean } {
  const payloads: unknown[] = [];
  const state = { buffer: "" };
  let done = false;
  for (const chunk of chunks) {
    done = feedGmProviderSseBytes(state, chunk, (payload) => payloads.push(payload), false) || done;
  }
  done = feedGmProviderSseBytes(state, "", () => {}, true) || done;
  return { payloads, done };
}

describe("gmProviderSse", () => {
  it("parses SSE JSON split across network chunks", () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "안녕" } }] })}\n\n`;
    const split = Math.floor(line.length / 2);
    const { payloads } = collectSse([line.slice(0, split), line.slice(split)]);
    assert.equal((payloads[0] as { choices: [{ delta: { content: string } }] }).choices[0].delta.content, "안녕");
  });

  it("handles CRLF line endings", () => {
    const { payloads } = collectSse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "crlf" } }] })}\r\n\r\n`,
    ]);
    assert.equal((payloads[0] as { choices: [{ delta: { content: string } }] }).choices[0].delta.content, "crlf");
  });

  it("handles UTF-8 Korean split across byte chunks", () => {
    const text = "한글";
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    const bytes = new TextEncoder().encode(line);
    const mid = 5;
    const { payloads } = collectSse([
      new TextDecoder().decode(bytes.slice(0, mid)),
      new TextDecoder().decode(bytes.slice(mid)),
    ]);
    assert.equal((payloads[0] as { choices: [{ delta: { content: string } }] }).choices[0].delta.content, text);
  });

  it("parses final data event without trailing newline at EOF", () => {
    const state = { buffer: "" };
    const payloads: unknown[] = [];
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "tail" } }] })}`;
    feedGmProviderSseBytes(state, line, (payload) => payloads.push(payload), true);
    assert.equal((payloads[0] as { choices: [{ delta: { content: string } }] }).choices[0].delta.content, "tail");
  });

  it("accepts final empty-choice usage event and [DONE]", () => {
    const { payloads, done } = collectSse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    assert.equal(payloads.length, 2);
    assert.equal(done, true, "SSE_DONE_TERMINATES_READ=true");
    assert.deepEqual((payloads[1] as { usage: { prompt_tokens: number } }).usage, {
      prompt_tokens: 3,
      completion_tokens: 2,
    });
  });

  it("SSE_EOF_FALLBACK completes trailing buffer without [DONE]", () => {
    const state = { buffer: "" };
    const payloads: unknown[] = [];
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "eof" } }] })}`;
    const done = feedGmProviderSseBytes(state, line, (payload) => payloads.push(payload), true);
    assert.equal(done, false, "SSE_EOF_FALLBACK=true");
    assert.equal((payloads[0] as { choices: [{ delta: { content: string } }] }).choices[0].delta.content, "eof");
  });
});
