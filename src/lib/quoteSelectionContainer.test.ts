import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  extractQuoteSelectionText,
  isSelectionInContainer,
  normalizeQuoteSelectionText,
  resolveQuoteSelection,
} from "@/lib/quoteSelectionContainer";

type MockText = {
  nodeType: 3;
  textContent: string;
  parentElement: MockEl | null;
  ownerDocument: MockDocument;
};

type MockEl = {
  nodeType: 1;
  tagName: string;
  parentElement: MockEl | null;
  childNodes: MockNode[];
  attrs: Record<string, string | true>;
  ownerDocument: MockDocument;
  contains(node: MockNode): boolean;
  closest(selector: string): MockEl | null;
};

type MockNode = MockEl | MockText;

type MockPoint = { container: MockNode; offset: number };

class MockRange {
  startContainer: MockNode;
  startOffset: number;
  endContainer: MockNode;
  endOffset: number;
  commonAncestorContainer: MockNode;
  readonly START_TO_START = 0;
  readonly START_TO_END = 1;
  readonly END_TO_END = 2;
  readonly END_TO_START = 3;

  constructor(start: MockPoint, end: MockPoint, common: MockNode) {
    this.startContainer = start.container;
    this.startOffset = start.offset;
    this.endContainer = end.container;
    this.endOffset = end.offset;
    this.commonAncestorContainer = common;
  }

  compareBoundaryPoints(how: number, other: MockRange): number {
    const selfBoundary = how === 0 || how === 1 ? "start" : "end";
    const otherBoundary = how === 0 || how === 3 ? "start" : "end";
    return compareDocumentPoints(this.boundaryPoint(selfBoundary), other.boundaryPoint(otherBoundary));
  }

  intersectsNode(node: MockText): boolean {
    const nodeRange = new MockRange(
      { container: node, offset: 0 },
      { container: node, offset: node.textContent.length },
      node
    );
    return (
      this.compareBoundaryPoints(this.START_TO_END, nodeRange) < 0 &&
      this.compareBoundaryPoints(this.END_TO_START, nodeRange) > 0
    );
  }

  selectNodeContents(node: MockNode): void {
    if (node.nodeType === 3) {
      this.startContainer = node;
      this.startOffset = 0;
      this.endContainer = node;
      this.endOffset = node.textContent.length;
      this.commonAncestorContainer = node;
      return;
    }
    this.startContainer = node;
    this.startOffset = 0;
    this.endContainer = node;
    this.endOffset = node.childNodes.length;
    this.commonAncestorContainer = node;
  }

  private boundaryPoint(kind: "start" | "end"): MockPoint {
    return kind === "start"
      ? { container: this.startContainer, offset: this.startOffset }
      : { container: this.endContainer, offset: this.endOffset };
  }
}

class MockDocument {
  readonly body: MockEl;

  constructor(root: MockEl) {
    this.body = root;
    attachDocument(root, this);
  }

  createRange(): MockRange {
    return new MockRange({ container: this.body, offset: 0 }, { container: this.body, offset: 0 }, this.body);
  }

  createTreeWalker(root: MockNode, _whatToShow: number): { nextNode(): MockText | null } {
    if (root.nodeType === 3) {
      return { nextNode() { return null; } };
    }
    const descendants: MockText[] = [];
    walkNodes(root, (node) => {
      if (node.nodeType === 3) descendants.push(node);
    });
    let index = 0;
    return {
      nextNode() {
        return descendants[index++] ?? null;
      },
    };
  }
}

function attachDocument(node: MockNode, doc: MockDocument): void {
  node.ownerDocument = doc;
  if (node.nodeType === 1) {
    for (const child of node.childNodes) attachDocument(child, doc);
  }
}

function walkNodes(node: MockNode, visit: (node: MockNode) => void): void {
  visit(node);
  if (node.nodeType === 1) {
    for (const child of node.childNodes) walkNodes(child, visit);
  }
}

function compareDocumentPoints(a: MockPoint, b: MockPoint): number {
  const pathA = pointPath(a);
  const pathB = pointPath(b);
  const len = Math.max(pathA.length, pathB.length);
  for (let i = 0; i < len; i++) {
    const av = pathA[i] ?? -1;
    const bv = pathB[i] ?? -1;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function pointPath(point: MockPoint): number[] {
  const parts: number[] = [];
  if (point.container.nodeType === 3) {
    let cur: MockNode | null = point.container;
    while (cur?.parentElement) {
      const parent = cur.parentElement;
      parts.unshift(parent.childNodes.indexOf(cur));
      cur = parent;
    }
    parts.push(point.offset);
    return parts;
  }
  let cur: MockNode = point.container;
  while (cur.parentElement) {
    const parent = cur.parentElement;
    parts.unshift(parent.childNodes.indexOf(cur) + 1);
    cur = parent;
  }
  parts.unshift(point.offset);
  return parts;
}

function createDocument(): MockDocument {
  const holder = {} as MockDocument;
  const root = el(holder, "root");
  return new MockDocument(root);
}

function el(doc: MockDocument, tag: string, attrs: Record<string, string | true> = {}, ...children: MockNode[]): MockEl {
  const node: MockEl = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: null,
    childNodes: [],
    attrs,
    ownerDocument: doc,
    contains(target) {
      if (target === node) return true;
      for (const child of node.childNodes) {
        if (child === target) return true;
        if (child.nodeType === 1 && child.contains(target)) return true;
      }
      return false;
    },
    closest(selector) {
      const selectors = selector.split(",").map((part) => part.trim());
      const matchOne = (candidate: MockEl, sel: string): boolean => {
        if (sel === "button") return candidate.tagName === "BUTTON";
        if (sel.startsWith("[") && sel.endsWith("]")) {
          const key = sel.slice(1, -1);
          return key in candidate.attrs;
        }
        return candidate.tagName === sel.toUpperCase();
      };
      let cur: MockEl | null = node;
      while (cur) {
        for (const sel of selectors) {
          if (matchOne(cur, sel)) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    },
  };
  for (const child of children) {
    child.parentElement = node;
    node.childNodes.push(child);
  }
  attachDocument(node, doc);
  return node;
}

function txt(doc: MockDocument, value: string): MockText {
  return {
    nodeType: 3,
    textContent: value,
    parentElement: null,
    ownerDocument: doc,
  };
}

function asRange(
  start: MockText,
  startOffset: number,
  end: MockText,
  endOffset: number,
  common: MockNode
): Range {
  return new MockRange(
    { container: start, offset: startOffset },
    { container: end, offset: endOffset },
    common
  ) as unknown as Range;
}

function wholeRange(start: MockText, end: MockText, common: MockEl): Range {
  return asRange(start, 0, end, end.textContent.length, common);
}

function quoteAssistantFixture(doc: MockDocument, prose: MockText) {
  const root = el(doc, "div", { "data-quote-assistant": true }, el(doc, "div", {}, prose));
  const container = el(doc, "div", {}, root) as unknown as HTMLElement;
  return { container, root, prose };
}

function adjacentTextAssistantFixture(doc: MockDocument, textA: string, textB: string) {
  const textNodeA = txt(doc, textA);
  const textNodeB = txt(doc, textB);
  const span = el(doc, "span", {}, textNodeA, textNodeB);
  const assistant = el(doc, "div", { "data-quote-assistant": true }, span);
  const container = el(doc, "div", {}, assistant) as unknown as HTMLElement;
  return { container, textNodeA, textNodeB, span };
}

function buildScene(doc: MockDocument) {
  const actorAProse = txt(doc, "Actor A says hello.");
  const actorBProse = txt(doc, "Actor B replies.");
  const gmProse = txt(doc, "GM narrates the scene.");
  const labelA = txt(doc, "Actor A");
  const diceText = txt(doc, "D20 17 SUCCESS");
  const judgeLabel = txt(doc, "GM 판정용");
  const judgeIntent = txt(doc, "hidden intent text");
  const buttonLabel = txt(doc, "Reroll");

  const sceneRoot = el(
    doc,
    "div",
    { "data-quote-assistant": true },
    el(doc, "div", {}, el(doc, "p", {}, labelA), el(doc, "div", {}, actorAProse)),
    el(doc, "div", { "data-quote-ignore": true }, diceText),
    el(doc, "div", {}, el(doc, "p", {}, txt(doc, "Actor B")), el(doc, "div", {}, actorBProse)),
    el(doc, "div", { "data-quote-ignore": true }, el(doc, "p", {}, judgeLabel), el(doc, "p", {}, judgeIntent)),
    el(doc, "div", {}, gmProse),
    el(doc, "div", { "data-quote-ignore": true }, el(doc, "button", {}, buttonLabel))
  );

  const container = el(doc, "div", {}, sceneRoot);
  return {
    container: container as unknown as HTMLElement,
    sceneRoot,
    actorAProse,
    actorBProse,
    gmProse,
    labelA,
    diceText,
    buttonLabel,
  };
}

describe("quote selection semantics", () => {
  it("E/F/G. AI to AI, AI to GM, and label to prose remain eligible", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    assert.equal(isSelectionInContainer(scene.container, wholeRange(scene.actorAProse, scene.actorBProse, scene.sceneRoot)), true);
    assert.equal(isSelectionInContainer(scene.container, wholeRange(scene.actorAProse, scene.gmProse, scene.sceneRoot)), true);
    assert.equal(isSelectionInContainer(scene.container, wholeRange(scene.labelA, scene.actorAProse, scene.sceneRoot)), true);
  });

  it("C/D. direct start or end inside ignored UI is rejected", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    assert.equal(isSelectionInContainer(scene.container, wholeRange(scene.diceText, scene.actorBProse, scene.sceneRoot)), false);
    assert.equal(isSelectionInContainer(scene.container, wholeRange(scene.actorAProse, scene.buttonLabel, scene.sceneRoot)), false);
  });

  it("A. ACTOR_A_TO_ACTOR_B_WITH_DICE_MIDDLE excludes ignored dice text", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    const resolved = resolveQuoteSelection(scene.container, wholeRange(scene.actorAProse, scene.actorBProse, scene.sceneRoot));
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /Actor A says hello/);
    assert.match(resolved.text, /Actor B replies/);
    assert.doesNotMatch(resolved.text, /D20|17|SUCCESS/);
  });

  it("B. ACTOR_TO_GM_WITH_JUDGE_MIDDLE excludes judge chrome text", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    const resolved = resolveQuoteSelection(scene.container, wholeRange(scene.actorAProse, scene.gmProse, scene.sceneRoot));
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /Actor A says hello/);
    assert.match(resolved.text, /GM narrates the scene/);
    assert.doesNotMatch(resolved.text, /GM 판정용|hidden intent/);
  });

  it("P1 single Text node partial selection returns exact substring", () => {
    const doc = createDocument();
    const prose = txt(doc, "abcdef");
    const { container } = quoteAssistantFixture(doc, prose);
    const selection = asRange(prose, 2, prose, 5, prose);
    assert.equal(extractQuoteSelectionText(container, selection), "cde");
  });

  it("P2 nested span greeting partial selection returns exact substring", () => {
    const doc = createDocument();
    const prose = txt(doc, "어서오세요~ 아, 또 오셨네요. 오늘도 삼각김밥이에요?");
    const span = el(doc, "span", { class: "font-semibold" }, prose);
    const paragraph = el(doc, "p", { class: "m-0" }, span);
    const novel = el(doc, "div", { class: "chat-novel-prose" }, paragraph);
    const assistant = el(doc, "div", { "data-quote-assistant": true }, novel);
    const container = el(doc, "div", { class: "min-w-0 space-y-1" }, assistant) as unknown as HTMLElement;
    const selection = asRange(prose, 2, prose, 14, prose);
    const resolved = resolveQuoteSelection(container, selection);
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /오세요~ 아, 또/);
  });

  it("P3 multi-node same assistant selection captures selected nodes only", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    const resolved = resolveQuoteSelection(scene.container, wholeRange(scene.actorAProse, scene.actorBProse, scene.sceneRoot));
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /Actor A says hello/);
    assert.match(resolved.text, /Actor B replies/);
    assert.doesNotMatch(resolved.text, /D20|17|SUCCESS/);
  });

  it("P4 intersectsNode false with true boundary overlap recovers selected text", () => {
    const doc = createDocument();
    const prose = txt(doc, "어서오세요~ 아, 또 오셨네요.");
    const { container } = quoteAssistantFixture(doc, prose);
    const selection = asRange(prose, 2, prose, 14, prose) as unknown as MockRange & Range;
    selection.intersectsNode = () => false;
    const resolved = resolveQuoteSelection(container, selection);
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /오세요~ 아, 또/);
  });

  it("P5 adjacent text nodes exclude zero-width boundary touch", () => {
    const doc = createDocument();
    const { container, textNodeA, textNodeB, span } = adjacentTextAssistantFixture(doc, "ABC", "DEF");

    const selectA = resolveQuoteSelection(
      container,
      asRange(textNodeA, 0, textNodeA, textNodeA.textContent.length, span)
    );
    assert.equal(selectA.text, "ABC");
    assert.doesNotMatch(selectA.text, /DEF/);

    const selectB = resolveQuoteSelection(
      container,
      asRange(textNodeB, 0, textNodeB, textNodeB.textContent.length, span)
    );
    assert.equal(selectB.text, "DEF");
    assert.doesNotMatch(selectB.text, /ABC/);

    const endsAtBStart = resolveQuoteSelection(
      container,
      asRange(textNodeA, 0, textNodeA, textNodeA.textContent.length, span)
    );
    assert.equal(endsAtBStart.text, "ABC");
    assert.doesNotMatch(endsAtBStart.text, /DEF/);

    const startsAtBStart = resolveQuoteSelection(
      container,
      asRange(textNodeB, 0, textNodeB, textNodeB.textContent.length, span)
    );
    assert.equal(startsAtBStart.text, "DEF");
    assert.doesNotMatch(startsAtBStart.text, /ABC/);
  });

  it("P6 ignored UI in the middle is omitted from captured text", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    const text = extractQuoteSelectionText(scene.container, wholeRange(scene.actorAProse, scene.gmProse, scene.sceneRoot));
    assert.doesNotMatch(text, /D20|SUCCESS|GM 판정용|hidden intent/);
  });

  it("P7 start or end inside blocked UI is ineligible", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    assert.equal(isSelectionInContainer(scene.container, wholeRange(scene.diceText, scene.actorBProse, scene.sceneRoot)), false);
    assert.equal(isSelectionInContainer(scene.container, wholeRange(scene.actorAProse, scene.buttonLabel, scene.sceneRoot)), false);
  });

  it("P8 user message without assistant marker is ineligible", () => {
    const doc = createDocument();
    const userText = txt(doc, "user wrote this");
    const container = el(doc, "div", {}, el(doc, "p", {}, userText)) as unknown as HTMLElement;
    assert.equal(
      isSelectionInContainer(
        container,
        asRange(userText, 0, userText, userText.textContent.length, userText)
      ),
      false
    );
  });

  it("P9 missing data-quote-assistant marker is ineligible", () => {
    const doc = createDocument();
    const prose = txt(doc, "No marker prose");
    const container = el(doc, "div", {}, el(doc, "p", {}, prose)) as unknown as HTMLElement;
    assert.equal(
      isSelectionInContainer(
        container,
        asRange(prose, 0, prose, prose.textContent.length, prose)
      ),
      false
    );
  });

  it("P11 TRPG actor to GM selection retains prose and excludes ignored UI", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    const resolved = resolveQuoteSelection(scene.container, wholeRange(scene.actorAProse, scene.gmProse, scene.sceneRoot));
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /Actor A says hello/);
    assert.match(resolved.text, /GM narrates the scene/);
    assert.doesNotMatch(resolved.text, /GM 판정용|hidden intent/);
  });

  it("P12 normalized forward Range partial selection matches browser contract", () => {
    const doc = createDocument();
    const prose = txt(doc, "abcdef");
    const { container } = quoteAssistantFixture(doc, prose);
    const selection = asRange(prose, 1, prose, 4, prose);
    assert.equal(resolveQuoteSelection(container, selection).text, "bcd");
  });

  it("T2 full greeting span selection with element common ancestor extracts text", () => {
    const doc = createDocument();
    const prose = txt(doc, "어서오세요~ 아, 또 오셨네요. 오늘도 삼각김밥이에요?");
    const span = el(doc, "span", { class: "font-semibold" }, prose);
    const paragraph = el(doc, "p", { class: "m-0" }, span);
    const novel = el(doc, "div", { class: "chat-novel-prose" }, paragraph);
    const assistant = el(doc, "div", { "data-quote-assistant": true }, novel);
    const container = el(doc, "div", { class: "min-w-0 space-y-1" }, assistant) as unknown as HTMLElement;
    const selection = asRange(prose, 0, prose, prose.textContent.length, span);
    const resolved = resolveQuoteSelection(container, selection);
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /어서오세요/);
  });

  it("T1 general chat greeting nested prose partial selection extracts text", () => {
    const doc = createDocument();
    const prose = txt(doc, "어서오세요~ 아, 또 오셨네요. 오늘도 삼각김밥이에요?");
    const span = el(doc, "span", { class: "font-semibold" }, prose);
    const paragraph = el(doc, "p", { class: "m-0" }, span);
    const novel = el(doc, "div", { class: "chat-novel-prose" }, paragraph);
    const assistant = el(doc, "div", { "data-quote-assistant": true }, novel);
    const container = el(doc, "div", { class: "min-w-0 space-y-1" }, assistant) as unknown as HTMLElement;
    const selection = asRange(prose, 2, prose, 14, prose);
    const resolved = resolveQuoteSelection(container, selection);
    assert.equal(resolved.eligible, true);
    assert.match(resolved.text, /오세요~ 아, 또/);
  });

  it("1. SAME_TEXT_NODE_PARTIAL uses Text commonAncestor and captures offset slice", () => {
    const doc = createDocument();
    const prose = txt(doc, "abcdef");
    const { container } = quoteAssistantFixture(doc, prose);
    const selection = asRange(prose, 2, prose, 5, prose);
    const resolved = resolveQuoteSelection(container, selection);
    assert.equal(resolved.eligible, true);
    assert.equal(resolved.text, "cde");
    assert.equal(extractQuoteSelectionText(container, selection), "cde");
  });

  it("2. SAME_TEXT_NODE_FULL uses Text commonAncestor for whole-node selection", () => {
    const doc = createDocument();
    const prose = txt(doc, "hello world");
    const { container } = quoteAssistantFixture(doc, prose);
    const selection = asRange(prose, 0, prose, prose.textContent.length, prose);
    assert.equal(resolveQuoteSelection(container, selection).text, "hello world");
  });

  it("mock TreeWalker skips Text root like the browser API", () => {
    const doc = createDocument();
    const prose = txt(doc, "abcdef");
    const walker = doc.createTreeWalker(prose, 4);
    assert.equal(walker.nextNode(), null);
  });

  it("H. PARTIAL_TEXT_RANGE preserves Range offsets", () => {
    const doc = createDocument();
    const prose = txt(doc, "abcdef");
    const { container } = quoteAssistantFixture(doc, prose);
    assert.equal(extractQuoteSelectionText(container, asRange(prose, 2, prose, 5, prose)), "cde");
  });

  it("I. MULTIPLE_IGNORED_NODES_IN_MIDDLE omits all ignored text", () => {
    const doc = createDocument();
    const scene = buildScene(doc);
    const text = extractQuoteSelectionText(scene.container, wholeRange(scene.actorAProse, scene.gmProse, scene.sceneRoot));
    assert.match(text, /Actor A says hello/);
    assert.match(text, /GM narrates the scene/);
    assert.doesNotMatch(text, /D20|SUCCESS|GM 판정용|hidden intent/);
  });

  it("normalizeQuoteSelectionText preserves paragraph cleanup behavior", () => {
    assert.equal(normalizeQuoteSelectionText("a\u00a0b  \nc"), "a b\nc");
    assert.equal(normalizeQuoteSelectionText("a\n\n\nb"), "a\n\nb");
  });

  it("P10 cross assistant roots remain ineligible", () => {
    const doc = createDocument();
    const leftProse = txt(doc, "Left block");
    const rightProse = txt(doc, "Right block");
    const container = el(
      doc,
      "div",
      {},
      el(doc, "div", { "data-quote-assistant": true }, el(doc, "div", {}, leftProse)),
      el(doc, "div", { "data-quote-assistant": true }, el(doc, "div", {}, rightProse))
    ) as unknown as HTMLElement;
    assert.equal(isSelectionInContainer(container, wholeRange(leftProse, rightProse, container as unknown as MockEl)), false);
  });
});

describe("trpg quote selection parity (structure)", () => {
  it("uses one SceneTurn quote root and disables inner prose roots", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const named = fs.readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");
    const chat = fs.readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");

    assert.match(room, /function SceneTurn[\s\S]*data-quote-assistant[\s\S]*quoteSelectStyle/);
    assert.match(room, /quoteAssistantRoot=\{false\}/);
    assert.doesNotMatch(room, /disabled=\{busy \|\| generating\}/);
    assert.match(named, /quoteAssistantRoot = true/);
    assert.match(named, /quoteAssistantRoot \? \{ "data-quote-assistant": true \}/);
    assert.match(chat, /data-quote-assistant/);
  });

  it("marks dice and judge chrome as quote-ignore inside SceneTurn", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /data-quote-ignore[\s\S]*TrpgRollResultLane/);
    assert.match(room, /GM 판정용[\s\S]*data-quote-ignore|data-quote-ignore[\s\S]*GM 판정용/);
    assert.match(room, /data-quote-ignore[\s\S]*장면 \$\{row\.roundNumber\}|장면 \$\{row\.roundNumber\}[\s\S]*data-quote-ignore/);
  });

  it("does not nest competing data-quote-assistant owners in TRPG scene prose path", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const sceneTurnBlock = room.slice(room.indexOf("function SceneTurn"));
    const assistantCount = (sceneTurnBlock.match(/data-quote-assistant/g) ?? []).length;
    assert.equal(assistantCount, 1);
    assert.doesNotMatch(sceneTurnBlock, /quoteAssistantRoot=\{true\}/);
  });

  it("J. global chat quote ownership and shared extraction owner unchanged", () => {
    const toolbar = fs.readFileSync("src/components/ChatSelectionQuoteToolbar.tsx", "utf8");
    const chat = fs.readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");
    assert.match(toolbar, /extractQuoteSelectionText/);
    assert.doesNotMatch(toolbar, /sel\.toString\(\)/);
    assert.match(chat, /disabled=\{loading \|\| editingId != null\}/);
    assert.doesNotMatch(chat, /quoteAssistantRoot/);
  });
});
