import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGmStructuredStreamParser,
  feedGmStructuredStreamParser,
  gmStructuredStreamParserComplete,
} from "./gmStructuredStreamParser";

describe("gmStructuredStreamParser", () => {
  it("exposes narration only after narration key opens string value", () => {
    const state = createGmStructuredStreamParser();
    assert.equal(feedGmStructuredStreamParser(state, '{"nar'), "");
    assert.equal(feedGmStructuredStreamParser(state, 'ration":"문이').trim(), "문이");
    assert.equal(state.narration.trim(), "문이");
  });

  it("stops at closing quote and never leaks delta body", () => {
    const state = createGmStructuredStreamParser();
    feedGmStructuredStreamParser(state, '{"narration":"낡은 등불');
    const tail = feedGmStructuredStreamParser(state, '","delta":{"players":[]}}');
    assert.equal(tail.trim(), "");
    assert.equal(state.narrationClosed, true);
    assert.match(state.narration, /낡은 등불/);
    assert.doesNotMatch(state.narration, /delta/);
    assert.doesNotMatch(state.narration, /players/);
  });

  it("handles split narration key across chunks", () => {
    const state = createGmStructuredStreamParser();
    assert.equal(feedGmStructuredStreamParser(state, '{"narr'), "");
    assert.equal(feedGmStructuredStreamParser(state, 'ation":"안녕').trim(), "안녕");
  });

  it("decodes escaped quotes and newlines inside narration", () => {
    const state = createGmStructuredStreamParser();
    feedGmStructuredStreamParser(state, '{"narration":"이름: \\"대사\\"\\n다음');
    feedGmStructuredStreamParser(state, '","delta":{}}');
    assert.match(state.narration, /이름: "대사"/);
    assert.match(state.narration, /\n다음/);
  });

  it("handles Korean unicode without leaking JSON syntax", () => {
    const state = createGmStructuredStreamParser();
    feedGmStructuredStreamParser(state, '{"narration":"한글 장면');
    feedGmStructuredStreamParser(state, '","delta":{}}');
    assert.equal(state.narration, "한글 장면");
    assert.doesNotMatch(state.narration, /"/);
  });

  it("flushes trailing narration on complete when closing quote never arrives", () => {
    const state = createGmStructuredStreamParser();
    feedGmStructuredStreamParser(state, '{"narration":"마지막');
    gmStructuredStreamParserComplete(state);
    assert.equal(state.narration.trim(), "마지막");
  });
});
