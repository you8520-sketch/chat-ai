import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOocHtmlRequest } from "@/lib/oocHtmlRequest";

describe("isOocHtmlRequest", () => {
  it("detects OOC HTML requests", () => {
    assert.equal(isOocHtmlRequest("[OOC] 상태창 html로 보여줘"), true);
    assert.equal(isOocHtmlRequest("ooc: UI mockup please"), true);
    assert.equal(isOocHtmlRequest("OOC] 디자인 바꿔줘"), true);
    assert.equal(isOocHtmlRequest("ooc - 레이아웃 수정"), true);
    assert.equal(isOocHtmlRequest("ooc) 코드로 보여줘"), true);
  });

  it("returns false for normal RP without OOC HTML intent", () => {
    assert.equal(isOocHtmlRequest("계속 이어서 써줘"), false);
    assert.equal(isOocHtmlRequest("ooc: 다음 장면으로"), false);
    assert.equal(isOocHtmlRequest("<!DOCTYPE html>"), false);
    assert.equal(isOocHtmlRequest(""), false);
  });
});
