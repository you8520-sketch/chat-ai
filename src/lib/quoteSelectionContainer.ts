const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const SHOW_TEXT = 4;
const RANGE_START_TO_END = 1;
const RANGE_END_TO_START = 3;

const BLOCKED_SELECTOR = "textarea, input, button, [data-quote-ignore], [data-quote-ui]";
const BLOCK_BREAK_SELECTOR = "p, div, article, li, h1, h2, h3, blockquote";

export function elementFromSelectionNode(node: Node): Element | null {
  if (node.nodeType === TEXT_NODE) {
    return (node as Text).parentElement;
  }
  const maybeElement = node as Element;
  if (maybeElement.nodeType === ELEMENT_NODE && typeof maybeElement.closest === "function") {
    return maybeElement;
  }
  return null;
}

function isBlockedElement(element: Element | null): boolean {
  if (!element) return true;
  return Boolean(element.closest(BLOCKED_SELECTOR));
}

export function isSelectionInContainer(container: HTMLElement, range: Range): boolean {
  const startElement = elementFromSelectionNode(range.startContainer);
  const endElement = elementFromSelectionNode(range.endContainer);
  const commonElement = elementFromSelectionNode(range.commonAncestorContainer);
  if (!startElement || !endElement || !commonElement) return false;
  if (!container.contains(startElement) || !container.contains(endElement)) return false;
  if (
    commonElement.closest(BLOCKED_SELECTOR) ||
    startElement.closest(BLOCKED_SELECTOR) ||
    endElement.closest(BLOCKED_SELECTOR)
  ) {
    return false;
  }
  const startAssistant = startElement.closest("[data-quote-assistant]");
  const endAssistant = endElement.closest("[data-quote-assistant]");
  if (!startAssistant || !endAssistant || startAssistant !== endAssistant) return false;
  return container.contains(startAssistant) && container.contains(endAssistant);
}

export function normalizeQuoteSelectionText(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isTextNodeWithinRange(textNode: Text, range: Range): boolean {
  if (typeof range.intersectsNode === "function") {
    try {
      if (range.intersectsNode(textNode)) return true;
    } catch {
      // fall through to boundary comparison
    }
  }
  const doc = textNode.ownerDocument;
  if (!doc) return false;
  const nodeRange = doc.createRange();
  nodeRange.selectNodeContents(textNode);
  return (
    range.compareBoundaryPoints(RANGE_START_TO_END, nodeRange) < 0 &&
    range.compareBoundaryPoints(RANGE_END_TO_START, nodeRange) > 0
  );
}

function sliceTextNodeInRange(textNode: Text, range: Range): string {
  const content = textNode.textContent ?? "";
  const doc = textNode.ownerDocument;
  if (!doc) return "";

  const nodeRange = doc.createRange();
  nodeRange.selectNodeContents(textNode);

  if (range.compareBoundaryPoints(RANGE_START_TO_END, nodeRange) > 0) return "";
  if (range.compareBoundaryPoints(RANGE_END_TO_START, nodeRange) < 0) return "";

  let start = 0;
  let end = content.length;
  if (range.startContainer === textNode) {
    start = range.startOffset;
  }
  if (range.endContainer === textNode) {
    end = range.endOffset;
  }
  start = Math.max(0, Math.min(start, content.length));
  end = Math.max(start, Math.min(end, content.length));
  return content.slice(start, end);
}

function blockElementForText(textNode: Text): Element {
  const parent = textNode.parentElement;
  if (!parent) return textNode as unknown as Element;
  return parent.closest(BLOCK_BREAK_SELECTOR) ?? parent;
}

function appendTextNodeSlice(
  container: HTMLElement,
  range: Range,
  textNode: Text,
  parts: string[],
  lastBlock: { value: Element | null }
): void {
  const parent = textNode.parentElement;
  if (!parent || !container.contains(parent) || isBlockedElement(parent)) return;
  if (!isTextNodeWithinRange(textNode, range)) return;
  const slice = sliceTextNodeInRange(textNode, range);
  if (!slice) return;
  const block = blockElementForText(textNode);
  if (lastBlock.value && block !== lastBlock.value) {
    parts.push("\n");
  }
  lastBlock.value = block;
  parts.push(slice);
}

function collectDescendantTextNodes(root: Node, ownerDocument: Document): Text[] {
  const nodes: Text[] = [];
  const walker = ownerDocument.createTreeWalker(root, SHOW_TEXT);
  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    nodes.push(textNode);
    textNode = walker.nextNode() as Text | null;
  }
  return nodes;
}

export function extractQuoteSelectionText(container: HTMLElement, range: Range): string {
  if (!isSelectionInContainer(container, range)) return "";

  const parts: string[] = [];
  const lastBlock = { value: null as Element | null };
  const root = range.commonAncestorContainer;
  const ownerDocument =
    container.ownerDocument ??
    (range.startContainer as Node & { ownerDocument?: Document }).ownerDocument ??
    null;
  if (!ownerDocument) return "";

  const textNodes =
    root.nodeType === TEXT_NODE ? [root as Text] : collectDescendantTextNodes(root, ownerDocument);

  for (const textNode of textNodes) {
    appendTextNodeSlice(container, range, textNode, parts, lastBlock);
  }

  return normalizeQuoteSelectionText(parts.join(""));
}

export function resolveQuoteSelection(
  container: HTMLElement,
  range: Range
): { eligible: boolean; text: string } {
  if (!isSelectionInContainer(container, range)) {
    return { eligible: false, text: "" };
  }
  return { eligible: true, text: extractQuoteSelectionText(container, range) };
}
