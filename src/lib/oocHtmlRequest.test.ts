import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendOocHtmlModeDirective,
  isOocHtmlRequest,
  OOC_HTML_MODE_SYSTEM_DIRECTIVE,
  resolveMainModelOocHtmlMode,
} from "@/lib/oocHtmlRequest";

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

describe("resolveMainModelOocHtmlMode", () => {
  const htmlRequest = "[OOC] 상태창 html로 보여줘";

  it("turns main-model HTML on only for an interactive OOC HTML request", () => {
    assert.equal(
      resolveMainModelOocHtmlMode({
        autoContinue: false,
        userMessage: htmlRequest,
        htmlVisualCardEnabled: false,
      }),
      true
    );
  });

  it("keeps Flash HTML ownership when the visual-card policy is on", () => {
    assert.equal(
      resolveMainModelOocHtmlMode({
        autoContinue: false,
        userMessage: htmlRequest,
        htmlVisualCardEnabled: true,
      }),
      false
    );
  });

  it("stays off for auto-continue and ordinary RP", () => {
    assert.equal(
      resolveMainModelOocHtmlMode({
        autoContinue: true,
        userMessage: htmlRequest,
        htmlVisualCardEnabled: false,
      }),
      false
    );
    assert.equal(
      resolveMainModelOocHtmlMode({
        autoContinue: false,
        userMessage: "창가에 앉아 있어.",
        htmlVisualCardEnabled: false,
      }),
      false
    );
  });
});

describe("appendOocHtmlModeDirective", () => {
  it("keeps the existing directive text and appends it once", () => {
    const once = appendOocHtmlModeDirective("동적 메모리");
    assert.equal(once, `동적 메모리\n\n${OOC_HTML_MODE_SYSTEM_DIRECTIVE}`);
    assert.equal(appendOocHtmlModeDirective(once), once);
    assert.equal(appendOocHtmlModeDirective("  "), OOC_HTML_MODE_SYSTEM_DIRECTIVE);
  });
});
