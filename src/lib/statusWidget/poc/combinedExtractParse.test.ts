import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCombinedWidgetExtractResponse,
  extractJsonObjectFromText,
} from "./combinedExtractParse";
import type { StatusWidget } from "../types";

const charWidget: StatusWidget = {
  version: 1,
  name: "c",
  placement: "bottom",
  htmlTemplate: "{{장소}}{{현재시각}}{{속마음}}",
  fields: [
    { id: "장소", label: "장소", instruction: "장소" },
    { id: "현재시각", label: "현재시각", instruction: "HH:MM" },
    { id: "속마음", label: "속마음", instruction: "NPC의 속마음" },
  ],
};

const userWidget: StatusWidget = {
  version: 1,
  name: "u",
  placement: "bottom",
  htmlTemplate: "{{장소}}{{현재시각}}{{속마음}}",
  fields: [
    { id: "장소", label: "장소", instruction: "장소" },
    { id: "현재시각", label: "현재시각", instruction: "HH:MM" },
    { id: "속마음", label: "속마음", instruction: "유저의 속마음" },
  ],
};

describe("parseCombinedWidgetExtractResponse (POC)", () => {
  it("1. full JSON success applies both sources and facts", () => {
    const text = JSON.stringify({
      character_values: {
        장소: "사령실",
        현재시각: "14:00",
        속마음: "임무를 완수해야 한다",
      },
      user_values: {
        장소: "복도",
        현재시각: "14:05",
        속마음: "걱정이 된다",
      },
      extracted_facts: [
        {
          category: "setting",
          subject: "복도",
          attribute: "location",
          value: "실내",
          importance: "normal",
          fact_text: "두 사람은 실내 복도에서 만났다.",
        },
      ],
    });
    const parsed = parseCombinedWidgetExtractResponse(text, {
      characterWidget: charWidget,
      userWidget,
    });
    assert.equal(parsed.jsonParseOk, true);
    assert.equal(parsed.characterParseOk, true);
    assert.equal(parsed.userParseOk, true);
    assert.equal(parsed.character?.["장소"], "사령실");
    assert.equal(parsed.user?.["장소"], "복도");
    // facts may be filtered by sanitize; values must still apply
    assert.ok(Array.isArray(parsed.extracted_facts));
  });

  it("2. bad user_values type keeps character; user null", () => {
    const text = JSON.stringify({
      character_values: { 장소: "사령실", 현재시각: "14:00", 속마음: "침착하다" },
      user_values: "broken",
      extracted_facts: [],
    });
    const parsed = parseCombinedWidgetExtractResponse(text, {
      characterWidget: charWidget,
      userWidget,
    });
    assert.equal(parsed.characterParseOk, true);
    assert.equal(parsed.character?.["장소"], "사령실");
    assert.equal(parsed.userParseOk, false);
    assert.equal(parsed.user, null);
  });

  it("3. missing character_values keeps user", () => {
    const text = JSON.stringify({
      user_values: { 장소: "복도", 현재시각: "09:00", 속마음: "설렌다" },
      extracted_facts: [],
    });
    const parsed = parseCombinedWidgetExtractResponse(text, {
      characterWidget: charWidget,
      userWidget,
    });
    assert.equal(parsed.characterParseOk, false);
    assert.equal(parsed.character, null);
    assert.equal(parsed.userParseOk, true);
    assert.equal(parsed.user?.["장소"], "복도");
  });

  it("4. bad extracted_facts does not invalidate widget values", () => {
    const text = JSON.stringify({
      character_values: { 장소: "사령실", 현재시각: "14:00", 속마음: "침착하다" },
      user_values: { 장소: "복도", 현재시각: "14:00", 속마음: "불안하다" },
      extracted_facts: { not: "an array" },
    });
    const parsed = parseCombinedWidgetExtractResponse(text, {
      characterWidget: charWidget,
      userWidget,
    });
    assert.equal(parsed.character?.["장소"], "사령실");
    assert.equal(parsed.user?.["장소"], "복도");
    assert.equal(parsed.extracted_facts.length, 0);
    assert.equal(parsed.factsParseOk, false);
  });

  it("5. whole JSON parse failure → both sources miss", () => {
    const parsed = parseCombinedWidgetExtractResponse("not json at all", {
      characterWidget: charWidget,
      userWidget,
    });
    assert.equal(parsed.jsonParseOk, false);
    assert.equal(parsed.character, null);
    assert.equal(parsed.user, null);
    assert.equal(parsed.extracted_facts.length, 0);
  });

  it("6. placeholder fields in one source are dropped without killing the source", () => {
    const text = JSON.stringify({
      character_values: {
        장소: "사령실",
        현재시각: "—",
        속마음: "…",
      },
      user_values: {
        장소: "복도",
        현재시각: "10:00",
        속마음: "괜찮다",
      },
      extracted_facts: [],
    });
    const parsed = parseCombinedWidgetExtractResponse(text, {
      characterWidget: charWidget,
      userWidget,
    });
    assert.equal(parsed.characterParseOk, true);
    assert.equal(parsed.character?.["장소"], "사령실");
    assert.equal(parsed.character?.["현재시각"], undefined);
    assert.equal(parsed.character?.["속마음"], undefined);
    assert.equal(parsed.user?.["현재시각"], "10:00");
  });

  it("extractJsonObjectFromText supports fenced JSON", () => {
    const obj = extractJsonObjectFromText('```json\n{"a":1}\n```');
    assert.deepEqual(obj, { a: 1 });
  });
});
