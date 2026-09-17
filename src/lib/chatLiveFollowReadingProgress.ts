/**
 * Render-progress camera target for general chat live follow.
 * Maps horizontal text-end progress within the current line to a continuous
 * virtual vertical reading position — not streamIntervalMs or char estimates.
 */

import { resolveTargetDocumentY } from "./liveReadingFollow";

export type ChatReadingProgressSource = "range-progress" | "sentinel-fallback";

export type ChatReadingProgressSample = {
  documentY: number;
  linePhase: number;
  source: ChatReadingProgressSource;
};

export type ReadingProgressResolveStats = {
  lastMs: number;
  maxMs: number;
  sampleCount: number;
};

let resolveStats: ReadingProgressResolveStats = {
  lastMs: 0,
  maxMs: 0,
  sampleCount: 0,
};

export function peekReadingProgressResolveStats(): ReadingProgressResolveStats {
  return { ...resolveStats };
}

export function resetReadingProgressResolveStats(): void {
  resolveStats = { lastMs: 0, maxMs: 0, sampleCount: 0 };
}

const MIN_USABLE_LINE_WIDTH_PX = 24;
const MIN_LINE_HEIGHT_PX = 12;

/** Pure projection: horizontal end-of-line progress → virtual viewport Y. */
export function computeVirtualReadingViewportY(opts: {
  lineTop: number;
  lineHeight: number;
  endX: number;
  contentLeft: number;
  usableLineWidth: number;
}): { viewportY: number; linePhase: number } {
  const width = Math.max(MIN_USABLE_LINE_WIDTH_PX, opts.usableLineWidth);
  const lineHeight = Math.max(MIN_LINE_HEIGHT_PX, opts.lineHeight);
  const linePhase = Math.min(1, Math.max(0, (opts.endX - opts.contentLeft) / width));
  return {
    linePhase,
    viewportY: opts.lineTop + linePhase * lineHeight,
  };
}

function isTextNodeCandidate(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0;
}

function findLastTextNode(root: Element): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-chat-assistant-stream-end]")) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-quote-ignore]")) return NodeFilter.FILTER_REJECT;
      return isTextNodeCandidate(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let last: Text | null = null;
  while (walker.nextNode()) {
    last = walker.currentNode as Text;
  }
  return last;
}

function resolveProseContentBounds(quoteRoot: Element): { left: number; width: number } | null {
  const prose =
    quoteRoot.querySelector(".chat-novel-prose") ??
    quoteRoot.querySelector("[data-quote-assistant] .chat-novel-prose") ??
    quoteRoot;
  const rect = prose.getBoundingClientRect();
  if (rect.width <= 0) return null;
  return { left: rect.left, width: rect.width };
}

function resolveEndOfTextRect(textNode: Text): DOMRect | null {
  const range = document.createRange();
  range.selectNodeContents(textNode);
  range.collapse(false);
  const rects = range.getClientRects();
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? range.getBoundingClientRect();
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

/**
 * Continuous reading target from rendered assistant prose geometry.
 * Falls back to block sentinel document Y when no measurable text exists.
 */
export function resolveChatReadingProgressDocumentY(opts: {
  scrollY: number;
  quoteRoot: Element | null;
  fallbackSentinel: Element | null;
}): ChatReadingProgressSample | null {
  if (typeof document === "undefined") return null;

  const started =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  let sample: ChatReadingProgressSample | null = null;

  if (opts.quoteRoot) {
    const textNode = findLastTextNode(opts.quoteRoot);
    const bounds = resolveProseContentBounds(opts.quoteRoot);
    if (textNode && bounds) {
      const endRect = resolveEndOfTextRect(textNode);
      if (endRect) {
        const lineHeight = Math.max(MIN_LINE_HEIGHT_PX, endRect.height);
        const { viewportY, linePhase } = computeVirtualReadingViewportY({
          lineTop: endRect.top,
          lineHeight,
          endX: endRect.right,
          contentLeft: bounds.left,
          usableLineWidth: bounds.width,
        });
        sample = {
          documentY: opts.scrollY + viewportY,
          linePhase,
          source: "range-progress",
        };
      }
    }
  }

  if (!sample && opts.fallbackSentinel) {
    sample = {
      documentY: resolveTargetDocumentY({
        element: opts.fallbackSentinel,
        scrollY: opts.scrollY,
      }),
      linePhase: 1,
      source: "sentinel-fallback",
    };
  }

  const elapsed =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  resolveStats.lastMs = elapsed;
  resolveStats.maxMs = Math.max(resolveStats.maxMs, elapsed);
  resolveStats.sampleCount += 1;

  return sample;
}
