import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  visibleAssistantDisplayCharCount,
  visibleAssistantDisplayText,
} from "@/lib/chatDisplayLength";

describe("visibleAssistantDisplayCharCount", () => {
  it("counts novel text only when no html", () => {
    assert.equal(visibleAssistantDisplayCharCount("RP 본문입니다."), "RP 본문입니다.".length);
  });

  it("excludes html markup but includes visible card text", () => {
    const prose = "가".repeat(100);
    const text = `${prose}\n\n\`\`\`html\n<div style="x"><p>상태창</p><p>속마음 한 줄</p></div>\n\`\`\``;
    const visible = visibleAssistantDisplayText(text);
    assert.match(visible, /가/);
    assert.match(visible, /상태창/);
    assert.match(visible, /속마음/);
    assert.doesNotMatch(visible, /<div/);
    assert.ok(visibleAssistantDisplayCharCount(text) > prose.length);
    assert.ok(visibleAssistantDisplayCharCount(text) < text.length);
  });

  it("includes markdown table cell text", () => {
    const text = `본문\n\n| a | b |\n|:---:|:---:|\n| 1 | 2 |`;
    assert.ok(visibleAssistantDisplayCharCount(text) > 2);
    assert.match(visibleAssistantDisplayText(text), /1/);
  });
});
