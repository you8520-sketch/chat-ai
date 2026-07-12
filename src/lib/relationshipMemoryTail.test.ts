import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  splitProseAndRelationshipMemoryTail,
  stripRelationshipMemoryTailForStream,
} from "@/lib/relationshipMemoryTailParse";
import { normalizeRelationshipMetaDeltaFromJson } from "@/lib/relationshipMemoryTail";
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

  it("drops forbidden fields from parsed relationship tail delta", () => {
    const delta = normalizeRelationshipMetaDeltaFromJson(
      {
        honorifics: ["레온→렌: 너"],
        items: ["렌: 은색 반지"],
        thoughts: ["레온: 숨기고 싶다"],
        thoughtsRemove: ["레온: 불안하다"],
        promisesAdd: [{ text: "내일 다시 만나기로 함" }],
        promisesRemove: [],
      },
      "",
      { charName: "레온", userName: "렌" }
    );

    assert.deepEqual(delta.items, ["렌: 은색 반지"]);
    assert.deepEqual(delta.promisesAdd, [{ text: "내일 다시 만나기로 함" }]);
    assert.equal(delta.honorifics, undefined);
    assert.equal(delta.thoughts, undefined);
    assert.equal(delta.thoughtsRemove, undefined);
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
    assert.doesNotMatch(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK, /"thoughts"/);
    assert.doesNotMatch(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK, /"honorifics"/);
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
