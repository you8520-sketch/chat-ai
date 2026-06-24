import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  splitProseAndRelationshipMemoryTail,
  stripRelationshipMemoryTailForStream,
} from "@/lib/relationshipMemoryTailParse";
import { RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK } from "@/lib/relationshipMemoryTailPrompt";

describe("relationshipMemoryTailParse", () => {
  it("strips trailing relationship JSON from prose", () => {
    const prose = "백하율은 고개를 끄덕였다.";
    const tail = JSON.stringify({
      honorifics: [],
      items: [],
      thoughts: ["백하율: 왜 이렇게 떨리지"],
      promisesAdd: [],
      promisesRemove: [],
    });
    const full = `${prose}\n\n${tail}`;
    const split = splitProseAndRelationshipMemoryTail(full);
    assert.equal(split.parseOk, true);
    assert.equal(split.prose, prose);
    assert.ok(split.rawJson);
  });

  it("returns parseOk false for malformed trailing JSON", () => {
    const full = "RP 본문\n{not json}";
    const split = splitProseAndRelationshipMemoryTail(full);
    assert.equal(split.parseOk, false);
    assert.match(split.prose, /RP 본문/);
  });

  it("accepts empty arrays as valid parse", () => {
    const prose = "짧은 RP";
    const tail =
      '{"honorifics":[],"items":[],"thoughts":[],"promisesAdd":[],"promisesRemove":[]}';
    const split = splitProseAndRelationshipMemoryTail(`${prose}\n${tail}`);
    assert.equal(split.parseOk, true);
    assert.equal(split.prose, prose);
  });

  it("does not strip unrelated trailing status widget JSON", () => {
    const prose = "RP";
    const statusJson = '{"시간":"밤","장소":"거리"}';
    const full = `${prose}\n${statusJson}`;
    const split = splitProseAndRelationshipMemoryTail(full);
    assert.equal(split.parseOk, false);
  });

  it("SELF_EXTRACT block contains required schema", () => {
    assert.match(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK, /RELATIONSHIP MEMORY — SELF-EXTRACT/);
    assert.match(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK, /promisesRemove/);
  });

  it("stripRelationshipMemoryTailForStream hides incomplete JSON during stream", () => {
    const partial = `RP 본문입니다.\n{"honorifics":[],"items":[],"thoughts":["백하율: 떨림"`;
    assert.equal(stripRelationshipMemoryTailForStream(partial), "RP 본문입니다.");
  });

  it("stripRelationshipMemoryTailForStream hides complete JSON during stream", () => {
    const tail =
      '{"honorifics":[],"items":[],"thoughts":[],"promisesAdd":[],"promisesRemove":[]}';
    const full = `RP 본문.\n${tail}`;
    assert.equal(stripRelationshipMemoryTailForStream(full), "RP 본문.");
  });
});
