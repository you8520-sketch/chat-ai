import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripLeakedDocumentMarkup } from "@/lib/chatHtmlSanitize";

describe("stripLeakedDocumentMarkup", () => {
  it("removes document head/link/font leaks from main model output", () => {
    const leaked =
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR" rel="stylesheet">' +
      '<div style="max-width:600px">카드 본문</div>';
    const out = stripLeakedDocumentMarkup(leaked);
    assert.doesNotMatch(out, /fonts\.googleapis/i);
    assert.match(out, /카드 본문/);
    assert.match(out, /<div/);
  });

  it("strips doctype and html/head/body wrappers", () => {
    const raw = "<!DOCTYPE html><html><head></head><body><p>ok</p></body></html>";
    const out = stripLeakedDocumentMarkup(raw);
    assert.doesNotMatch(out, /<!DOCTYPE/i);
    assert.doesNotMatch(out, /<html/i);
    assert.match(out, /ok/);
  });
});
