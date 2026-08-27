const TEXT_NODE = 3;

export function elementFromSelectionNode(node: Node): Element | null {
  if (node.nodeType === TEXT_NODE) {
    return (node as Text).parentElement;
  }
  const maybeElement = node as Element;
  if (maybeElement.nodeType === 1 && typeof maybeElement.closest === "function") {
    return maybeElement;
  }
  return null;
}

export function isSelectionInContainer(container: HTMLElement, range: Range): boolean {
  const startElement = elementFromSelectionNode(range.startContainer);
  const endElement = elementFromSelectionNode(range.endContainer);
  const commonElement = elementFromSelectionNode(range.commonAncestorContainer);
  if (!startElement || !endElement || !commonElement) return false;
  if (!container.contains(startElement) || !container.contains(endElement)) return false;
  const blockedSelector = "textarea, input, button, [data-quote-ignore], [data-quote-ui]";
  if (
    commonElement.closest(blockedSelector) ||
    startElement.closest(blockedSelector) ||
    endElement.closest(blockedSelector)
  ) {
    return false;
  }
  const startAssistant = startElement.closest("[data-quote-assistant]");
  const endAssistant = endElement.closest("[data-quote-assistant]");
  if (!startAssistant || !endAssistant || startAssistant !== endAssistant) return false;
  return container.contains(startAssistant) && container.contains(endAssistant);
}
