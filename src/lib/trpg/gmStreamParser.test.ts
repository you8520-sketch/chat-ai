import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGmStreamParser,
  feedGmStreamParser,
  gmStreamParserComplete,
} from "./gmStreamParser";

describe("gmStreamParser", () => {
  it("exposes narration only after NARRATION marker", () => {
    const state = createGmStreamParser();
    assert.equal(feedGmStreamParser(state, "prefix<<<NARR"), "");
    assert.equal(feedGmStreamParser(state, "ATION>>>\n문이").trim(), "문이");
    assert.equal(state.narration.trim(), "문이");
  });

  it("stops at DELTA marker and never leaks delta body", () => {
    const state = createGmStreamParser();
    feedGmStreamParser(state, "<<<NARRATION>>>\n낡은 등불");
    const tail = feedGmStreamParser(state, " <<<DELTA>>>\n{\"players\":[]}");
    assert.equal(tail.trim(), "");
    assert.equal(state.deltaSeen, true);
    assert.match(state.narration, /낡은 등불/);
    assert.doesNotMatch(state.narration, /DELTA/);
    assert.doesNotMatch(state.narration, /players/);
  });

  it("handles split NARRATION marker across chunks", () => {
    const state = createGmStreamParser();
    assert.equal(feedGmStreamParser(state, "<<<NARR"), "");
    assert.equal(feedGmStreamParser(state, "ATION>>>\n안녕").trim(), "안녕");
  });

  it("handles split DELTA marker across chunks", () => {
    const state = createGmStreamParser();
    feedGmStreamParser(state, "<<<NARRATION>>>\n본문");
    assert.equal(feedGmStreamParser(state, " 계속<<<DEL").trim(), "계속");
    assert.equal(feedGmStreamParser(state, "TA>>>\n{"), "");
    assert.equal(state.narration.trim(), "본문 계속");
    assert.equal(state.deltaSeen, true);
  });

  it("flushes trailing narration on complete when DELTA never arrives", () => {
    const state = createGmStreamParser();
    feedGmStreamParser(state, "<<<NARRATION>>>\n마지막");
    gmStreamParserComplete(state);
    assert.equal(state.narration.trim(), "마지막");
  });
});
