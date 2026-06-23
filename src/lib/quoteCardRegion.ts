import type { QuoteCardOrientation } from "@/lib/quoteCardImage";

export type QuoteCaptureRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  orientation: QuoteCardOrientation;
};

export function computeFreeCaptureRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minSize = 40
): QuoteCaptureRect | null {
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  if (Math.max(width, height) < minSize) return null;

  const left = endX >= startX ? startX : endX;
  const top = endY >= startY ? startY : endY;
  return {
    left,
    top,
    width,
    height,
    orientation: width >= height ? "landscape" : "portrait",
  };
}

/** @deprecated 미리보기 비율은 모달에서 선택 — 드래그는 computeFreeCaptureRect 사용 */
export function computeAspectCaptureRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minSize = 48
): QuoteCaptureRect | null {
  const dx = endX - startX;
  const dy = endY - startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (Math.max(absDx, absDy) < minSize) return null;

  const landscape = absDx >= absDy;
  let width: number;
  let height: number;
  if (landscape) {
    width = absDx;
    height = (width * 2) / 3;
  } else {
    height = absDy;
    width = (height * 2) / 3;
  }

  const left = dx >= 0 ? startX : startX - width;
  const top = dy >= 0 ? startY : startY - height;
  return {
    left,
    top,
    width,
    height,
    orientation: landscape ? "landscape" : "portrait",
  };
}

function rectsIntersect(a: DOMRect, rect: QuoteCaptureRect): boolean {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  return a.right > rect.left && a.left < right && a.bottom > rect.top && a.top < bottom;
}

export function extractTextInCaptureRect(
  container: HTMLElement,
  rect: QuoteCaptureRect
): string {
  const parts: string[] = [];
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;

  while (node) {
    const parent = node.parentElement;
    if (!parent || parent.closest("textarea, input, button, [data-quote-ignore], [data-quote-ui]")) {
      node = walker.nextNode() as Text | null;
      continue;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    const clientRects = range.getClientRects();
    let hit = false;
    for (let i = 0; i < clientRects.length; i++) {
      if (rectsIntersect(clientRects[i], rect)) {
        hit = true;
        break;
      }
    }

    if (hit) {
      const block =
        parent.closest("p, div, article, li, h1, h2, h3, blockquote") ?? parent;
      if (lastBlock && block !== lastBlock) parts.push("\n");
      lastBlock = block;
      const chunk = node.textContent ?? "";
      if (chunk) parts.push(chunk);
    }

    node = walker.nextNode() as Text | null;
  }

  return parts
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
