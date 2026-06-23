import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeChatStatusHtml } from "./chatHtmlSanitize.ts";
import { parseMarkdownPipeTable, partitionRichBlocksForDisplay, savedVisibleTextForReceipt, splitChatRichBlocks, visibleTextFromMarkdownTable } from "./chatRichContent.ts";

describe("parseMarkdownPipeTable", () => {
  it("parses standard header-first pipe table", () => {
    const md = `| col1 | col2 |
|:---:|:---:|
| a | b |`;
    const parsed = parseMarkdownPipeTable(md);
    assert.ok(parsed);
    assert.equal(parsed.hasHeader, true);
    assert.deepEqual(parsed.rows, [
      ["col1", "col2"],
      ["a", "b"],
    ]);
    assert.deepEqual(parsed.alignments, ["center", "center"]);
  });

  it("parses separator-first table without header", () => {
    const md = `|:---:|:---
|상태창||🕒00:00|🏠00|`;
    const parsed = parseMarkdownPipeTable(md);
    assert.ok(parsed);
    assert.equal(parsed.hasHeader, false);
    assert.deepEqual(parsed.rows, [["상태창", "", "🕒00:00", "🏠00"]]);
    assert.equal(parsed.alignments.length, 2);
  });

  it("accepts rows without trailing pipe", () => {
    const md = `| a | b
|:---:|:---:
| 1 | 2`;
    const parsed = parseMarkdownPipeTable(md);
    assert.ok(parsed);
    assert.deepEqual(parsed.rows[1], ["1", "2"]);
  });

  it("returns null for non-table prose", () => {
    assert.equal(parseMarkdownPipeTable("hello world"), null);
  });
});

describe("splitChatRichBlocks", () => {
  it("splits prose, markdown table, and fenced html", () => {
    const text = `*RP 본문*

| stat | val |
|:---:|:---:|
| HP | 100 |

\`\`\`html
<table><tr><td>ok</td></tr></table>
\`\`\``;
    const blocks = splitChatRichBlocks(text);
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["novel", "markdown-table", "html"],
    );
  });

  it("extracts bare inline html table", () => {
    const text = `*RP 본문*\n<table><tr><th>A</th><td>1</td></tr></table>`;
    const blocks = splitChatRichBlocks(text);
    assert.deepEqual(blocks.map((b) => b.kind), ["novel", "html"]);
    assert.match(blocks[1]!.kind === "html" ? blocks[1].text : "", /<table/i);
  });

  it("extracts fenced html without newline after fence tag", () => {
    const text = `*RP*\n\`\`\`html<div style="max-width:450px">ok</div>\`\`\``;
    const blocks = splitChatRichBlocks(text);
    assert.deepEqual(blocks.map((b) => b.kind), ["novel", "html"]);
  });

  it("extracts unclosed html fence at message end (LOOP_ABORT)", () => {
    const text = `*RP*\n\`\`\`html<div style="max-width:450px"><p>속마음</p>`;
    const blocks = splitChatRichBlocks(text);
    assert.deepEqual(blocks.map((b) => b.kind), ["novel", "html"]);
    assert.match(blocks[1]!.kind === "html" ? blocks[1].text : "", /속마음/);
  });

  it("extracts separator-first markdown table at message end", () => {
    const text = `*RP 본문*\n|:---:|:---\n|상태|값|`;
    const blocks = splitChatRichBlocks(text);
    assert.equal(blocks.at(-1)?.kind, "markdown-table");
    assert.ok(parseMarkdownPipeTable(blocks.at(-1)!.kind === "markdown-table" ? blocks.at(-1)!.text : ""));
  });

  it("visibleTextFromMarkdownTable counts cell text not pipe markup", () => {
    const md = `| 항목 | 내용 |
|:---:|:---|
| 🕒시간 | 14:00 / 집 |
| 💡 속마음 | 조용히… |`;
    const visible = visibleTextFromMarkdownTable(md);
    assert.match(visible, /14:00 \/ 집/);
    assert.match(visible, /조용히/);
    assert.doesNotMatch(visible, /\|/);
    assert.doesNotMatch(visible, /:-/);
  });

  it("savedVisibleTextForReceipt includes novel + status table visible text", () => {
    const text = `${"가".repeat(100)}\n\n| 항목 | 내용 |\n|:---:|:---|\n| 시간 | 14:00 |`;
    const visible = savedVisibleTextForReceipt(text);
    assert.match(visible, /가{100}/);
    assert.match(visible, /14:00/);
    assert.doesNotMatch(visible, /\|/);
  });
});

describe("sanitizeChatStatusHtml", () => {
  it("keeps safe table markup", () => {
    const safe = sanitizeChatStatusHtml(
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
    assert.match(safe, /<table/i);
    assert.match(safe, /<td>1<\/td>/);
  });

  it("strips script and event handlers", () => {
    const safe = sanitizeChatStatusHtml(
      '<table onclick="alert(1)"><tr><td><script>alert(1)</script>x</td></tr></table>',
    );
    assert.doesNotMatch(safe, /script|onclick|alert/i);
    assert.match(safe, /x/);
  });

  it("strips disallowed tags like iframe and links", () => {
    const safe = sanitizeChatStatusHtml(
      '<table><tr><td><iframe src="x"></iframe><a href="http://evil">link</a></td></tr></table>',
    );
    assert.doesNotMatch(safe, /iframe|href|evil/i);
  });

  it("allows span with style for cell styling", () => {
    const safe = sanitizeChatStatusHtml('<table><tr><td><span style="color:red">x</span></td></tr></table>');
    assert.match(safe, /<span/);
  });
});

describe("partitionRichBlocksForDisplay", () => {
  it("places trailing html at bottom (status window)", () => {
    const blocks = splitChatRichBlocks("RP 본문\n\n```html\n<div>status</div>\n```");
    const p = partitionRichBlocksForDisplay(blocks);
    assert.equal(p.topHtml.length, 0);
    assert.equal(p.bottomHtml.length, 1);
    assert.equal(p.body.length, 1);
    assert.equal(p.body[0]?.kind, "novel");
  });

  it("places leading html at top (default turn HTML)", () => {
    const blocks = splitChatRichBlocks("```html\n<div>card</div>\n```\n\nRP 본문");
    const p = partitionRichBlocksForDisplay(blocks);
    assert.equal(p.topHtml.length, 1);
    assert.equal(p.bottomHtml.length, 0);
    assert.equal(p.body.length, 1);
  });
});
