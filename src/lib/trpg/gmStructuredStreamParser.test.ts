import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGmStructuredStreamParser,
  feedGmStructuredStreamParser,
  gmStructuredStreamParserComplete,
} from "./gmStructuredStreamParser";

function streamJson(chunks: string[]): string {
  const state = createGmStructuredStreamParser();
  let out = "";
  for (const chunk of chunks) {
    out += feedGmStructuredStreamParser(state, chunk);
  }
  gmStructuredStreamParserComplete(state);
  return out;
}

describe("gmStructuredStreamParser top-level narration", () => {
  it("A — narration-first property order streams top-level narration", () => {
    const json = JSON.stringify({
      narration: "본문",
      delta: { players: [], location: "문" },
    });
    assert.equal(streamJson([json]), "본문");
  });

  it("B — delta-first property order streams top-level narration", () => {
    const json = JSON.stringify({
      delta: { players: [], location: "문" },
      narration: "본문",
    });
    assert.equal(streamJson([json]), "본문");
  });

  it("C — nested narration key is ignored; top-level narration wins", () => {
    const json = JSON.stringify({
      delta: { narration: "가짜 nested narration" },
      narration: "실제 본문",
    });
    const text = streamJson([json]);
    assert.equal(text, "실제 본문");
    assert.doesNotMatch(text, /가짜/);
  });

  it("D — nested array/object narration keys before top-level narration are ignored", () => {
    const json = JSON.stringify({
      delta: {
        players: [{ narration: "player nested" }],
        flagsAdd: ["x"],
        localScene: { narration: "scene nested" },
      },
      narration: "실제 본문",
    });
    assert.equal(streamJson([json]), "실제 본문");
  });

  it("E — split top-level narration key and value across chunks", () => {
    const json = JSON.stringify({
      delta: { narration: "noise" },
      narration: "실제 본문",
    });
    const splitAt = json.indexOf('"실제');
    const text = streamJson([json.slice(0, splitAt), json.slice(splitAt)]);
    assert.equal(text, "실제 본문");
  });

  it("F — escapes, newline, backslash, Korean, and unicode in top-level narration", () => {
    const json =
      '{"delta":{"players":[]},"narration":"이름: \\"대사\\"\\n다음\\\\line\\uAC00"}';
    const text = streamJson([json]);
    assert.equal(text, '이름: "대사"\n다음\\line가');
    assert.doesNotMatch(text, /\\"/);
    assert.doesNotMatch(text, /\\n/);
  });

  it("does not leak JSON syntax to streamed narration", () => {
    const json = JSON.stringify({ narration: "본문", delta: { players: [] } });
    const state = createGmStructuredStreamParser();
    feedGmStructuredStreamParser(state, json);
    assert.doesNotMatch(state.narration, /"delta"/);
    assert.doesNotMatch(state.narration, /players/);
    assert.doesNotMatch(state.narration, /\{/);
  });

  it("handles split narration key token across chunks", () => {
    const json = JSON.stringify({ delta: {}, narration: "안녕" });
    const keyIdx = json.indexOf('"narration"');
    const text = streamJson([json.slice(0, keyIdx + 4), json.slice(keyIdx + 4)]);
    assert.equal(text, "안녕");
  });
});
