import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { describe, it } from "node:test";
import {
  extractQuoteSelectionText,
  isSelectionInContainer,
  resolveQuoteSelection,
} from "@/lib/quoteSelectionContainer";

type QuoteDom = {
  window: DOMWindow;
  document: Document;
  Range: typeof Range;
};

function createQuoteDom(html: string): QuoteDom {
  const dom = new JSDOM(html);
  return {
    window: dom.window,
    document: dom.window.document,
    Range: dom.window.Range,
  };
}

function assistantContainer(doc: Document, innerHtml: string): HTMLElement {
  const wrapper = doc.createElement("div");
  wrapper.innerHTML = innerHtml;
  const assistant = doc.createElement("div");
  assistant.setAttribute("data-quote-assistant", "true");
  assistant.append(...wrapper.childNodes);
  const container = doc.createElement("div");
  container.appendChild(assistant);
  doc.body.appendChild(container);
  return container;
}

function textRange(
  doc: Document,
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): Range {
  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function oldInvertedOverlapLogic(range: Range, nodeRange: Range, RangeCtor: typeof Range): boolean {
  return (
    range.compareBoundaryPoints(RangeCtor.START_TO_END, nodeRange) < 0 &&
    range.compareBoundaryPoints(RangeCtor.END_TO_START, nodeRange) > 0
  );
}

describe("quote selection real DOM Range semantics", () => {
  it("R0 real DOM contract signs and old inverted production logic mismatch", () => {
    const { document, Range } = createQuoteDom("<body></body>");
    const textNode = document.createTextNode("abcdef");
    document.body.appendChild(textNode);

    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(textNode);

    const selection = textRange(document, textNode, 1, textNode, 4);
    const ste = selection.compareBoundaryPoints(Range.START_TO_END, nodeRange);
    const ets = selection.compareBoundaryPoints(Range.END_TO_START, nodeRange);

    assert.equal(ste, 1, "START_TO_END: selection.end is after node.start");
    assert.equal(ets, -1, "END_TO_START: selection.start is before node.end");
    assert.equal(oldInvertedOverlapLogic(selection, nodeRange, Range), false, "old #821 logic rejects real overlap");
  });

  it("R1 same text partial selection returns exact substring", () => {
    const { document } = createQuoteDom("<body></body>");
    const container = assistantContainer(document, "<p>abcdef</p>");
    const textNode = container.querySelector("p")!.firstChild as Text;
    const selection = textRange(document, textNode, 1, textNode, 4);

    assert.equal(extractQuoteSelectionText(container, selection), "bcd");
  });

  it("R2 whole text selection returns full node text", () => {
    const { document } = createQuoteDom("<body></body>");
    const container = assistantContainer(document, "<p>abcdef</p>");
    const textNode = container.querySelector("p")!.firstChild as Text;
    const selection = textRange(document, textNode, 0, textNode, textNode.textContent!.length);

    assert.equal(extractQuoteSelectionText(container, selection), "abcdef");
  });

  it("R3 adjacent text nodes select A only", () => {
    const { document } = createQuoteDom("<body></body>");
    const container = assistantContainer(document, "<span></span>");
    const span = container.querySelector("span")!;
    const textNodeA = document.createTextNode("ABC");
    const textNodeB = document.createTextNode("DEF");
    span.append(textNodeA, textNodeB);

    const selection = textRange(document, textNodeA, 0, textNodeA, textNodeA.textContent!.length);
    const resolved = resolveQuoteSelection(container, selection);

    assert.equal(resolved.eligible, true);
    assert.equal(resolved.text, "ABC");
    assert.doesNotMatch(resolved.text, /DEF/);
  });

  it("R4 adjacent text nodes select B only", () => {
    const { document } = createQuoteDom("<body></body>");
    const container = assistantContainer(document, "<span></span>");
    const span = container.querySelector("span")!;
    const textNodeA = document.createTextNode("ABC");
    const textNodeB = document.createTextNode("DEF");
    span.append(textNodeA, textNodeB);

    const selection = textRange(document, textNodeB, 0, textNodeB, textNodeB.textContent!.length);
    const resolved = resolveQuoteSelection(container, selection);

    assert.equal(resolved.eligible, true);
    assert.equal(resolved.text, "DEF");
    assert.doesNotMatch(resolved.text, /ABC/);
  });

  it("R5 cross-node actual overlap returns exact merged substring", () => {
    const { document } = createQuoteDom("<body></body>");
    const container = assistantContainer(document, "<span></span>");
    const span = container.querySelector("span")!;
    const textNodeA = document.createTextNode("ABC");
    const textNodeB = document.createTextNode("DEF");
    span.append(textNodeA, textNodeB);

    const selection = textRange(document, textNodeA, 1, textNodeB, 2);
    assert.equal(extractQuoteSelectionText(container, selection), "BCDE");
  });

  it("R6 zero-width boundary touch excludes adjacent node text", () => {
    const { document } = createQuoteDom("<body></body>");
    const container = assistantContainer(document, "<span></span>");
    const span = container.querySelector("span")!;
    const textNodeA = document.createTextNode("ABC");
    const textNodeB = document.createTextNode("DEF");
    span.append(textNodeA, textNodeB);

    const selectA = resolveQuoteSelection(
      container,
      textRange(document, textNodeA, 0, textNodeA, textNodeA.textContent!.length)
    );
    assert.equal(selectA.text, "ABC");
    assert.doesNotMatch(selectA.text, /DEF/);

    const selectB = resolveQuoteSelection(
      container,
      textRange(document, textNodeB, 0, textNodeB, textNodeB.textContent!.length)
    );
    assert.equal(selectB.text, "DEF");
    assert.doesNotMatch(selectB.text, /ABC/);
  });

  it("R7 nested span partial selection returns exact substring", () => {
    const { document } = createQuoteDom("<body></body>");
    const container = assistantContainer(
      document,
      '<p><span class="font-semibold">어서오세요~ 아, 또 오셨네요.</span></p>'
    );
    const textNode = container.querySelector("span")!.firstChild as Text;
    const selection = textRange(document, textNode, 2, textNode, 14);
    const resolved = resolveQuoteSelection(container, selection);

    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /오세요~ 아, 또/);
  });

  it("R8 blocked UI in the middle is omitted from captured text", () => {
    const { document } = createQuoteDom("<body></body>");
    const assistant = document.createElement("div");
    assistant.setAttribute("data-quote-assistant", "true");

    const actorA = document.createElement("div");
    const actorAText = document.createTextNode("Actor A says hello.");
    actorA.appendChild(document.createElement("p")).appendChild(actorAText);

    const dice = document.createElement("div");
    dice.setAttribute("data-quote-ignore", "true");
    dice.appendChild(document.createTextNode("D20 17 SUCCESS"));

    const gm = document.createElement("div");
    const gmText = document.createTextNode("GM narrates the scene.");
    gm.appendChild(gmText);

    assistant.append(actorA, dice, gm);
    const container = document.createElement("div");
    container.appendChild(assistant);
    document.body.appendChild(container);

    const selection = textRange(document, actorAText, 0, gmText, gmText.textContent!.length);
    const text = extractQuoteSelectionText(container, selection);

    assert.match(text, /Actor A says hello/);
    assert.match(text, /GM narrates the scene/);
    assert.doesNotMatch(text, /D20|17|SUCCESS/);
  });

  it("R9 cross assistant roots remain ineligible", () => {
    const { document } = createQuoteDom("<body></body>");
    const leftText = document.createTextNode("Left block");
    const rightText = document.createTextNode("Right block");
    const leftAssistant = document.createElement("div");
    leftAssistant.setAttribute("data-quote-assistant", "true");
    leftAssistant.appendChild(leftText);
    const rightAssistant = document.createElement("div");
    rightAssistant.setAttribute("data-quote-assistant", "true");
    rightAssistant.appendChild(rightText);
    const container = document.createElement("div");
    container.append(leftAssistant, rightAssistant);
    document.body.appendChild(container);

    const selection = textRange(document, leftText, 0, rightText, rightText.textContent!.length);
    assert.equal(isSelectionInContainer(container, selection), false);
  });

  it("R10 user message without assistant marker is ineligible", () => {
    const { document } = createQuoteDom("<body></body>");
    const userText = document.createTextNode("user wrote this");
    const paragraph = document.createElement("p");
    paragraph.appendChild(userText);
    const container = document.createElement("div");
    container.appendChild(paragraph);
    document.body.appendChild(container);

    const selection = textRange(document, userText, 0, userText, userText.textContent!.length);
    assert.equal(isSelectionInContainer(container, selection), false);
  });
});
