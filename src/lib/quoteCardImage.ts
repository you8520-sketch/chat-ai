import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";

export type QuoteCardOrientation = "portrait" | "landscape" | "square";

export type QuoteCardMeta = {
  bodyText: string;
  characterName: string;
  creatorName?: string;
  siteName?: string;
  orientation?: QuoteCardOrientation;
};

export type QuoteCardStyle = {
  padding?: number;
  bodyFontSize?: number;
  bodyLineHeight?: number;
  footerFontSize?: number;
  background?: string;
  bodyColor?: string;
  footerColor?: string;
  borderColor?: string;
};

const CARD_SHORT_SIDE = 600;

export const QUOTE_CARD_BODY_FONT_DEFAULT = 22;
export const QUOTE_CARD_BODY_FONT_MIN = 15;
export const QUOTE_CARD_BODY_FONT_MAX = 35;

const DEFAULT_STYLE: Required<QuoteCardStyle> = {
  padding: 32,
  bodyFontSize: QUOTE_CARD_BODY_FONT_DEFAULT,
  bodyLineHeight: 1.65,
  footerFontSize: 13,
  background: "#141418",
  bodyColor: "#e4e4e7",
  footerColor: "#a1a1aa",
  borderColor: "rgba(255,255,255,0.08)",
};

const BODY_FONT = "system-ui, -apple-system, \"Segoe UI\", sans-serif";

export function quoteCardDimensions(orientation: QuoteCardOrientation = "portrait"): {
  width: number;
  height: number;
} {
  if (orientation === "landscape") {
    return { width: CARD_SHORT_SIDE * 1.5, height: CARD_SHORT_SIDE };
  }
  if (orientation === "square") {
    return { width: CARD_SHORT_SIDE, height: CARD_SHORT_SIDE };
  }
  return { width: CARD_SHORT_SIDE, height: CARD_SHORT_SIDE * 1.5 };
}

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const ch of paragraph) {
      const candidate = line + ch;
      if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
        lines.push(line);
        line = ch;
      } else {
        line = candidate;
      }
    }
    if (line.length > 0) lines.push(line);
  }

  return lines.length > 0 ? lines : [""];
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function layoutBodyText(
  ctx: CanvasRenderingContext2D,
  text: string,
  innerWidth: number,
  innerHeight: number,
  baseFontSize: number,
  lineHeight: number,
  minFontSize = QUOTE_CARD_BODY_FONT_MIN
): { lines: string[]; fontSize: number } {
  const floor = Math.max(6, Math.min(minFontSize, baseFontSize));
  let fontSize = Math.round(baseFontSize);
  while (fontSize >= floor) {
    ctx.font = `${fontSize}px ${BODY_FONT}`;
    const lines = wrapCanvasLines(ctx, text, innerWidth);
    const height = lines.length * fontSize * lineHeight;
    if (height <= innerHeight) {
      return { lines, fontSize };
    }
    fontSize -= 1;
  }
  ctx.font = `${floor}px ${BODY_FONT}`;
  const lines = wrapCanvasLines(ctx, text, innerWidth);
  const maxLines = Math.max(1, Math.floor(innerHeight / (floor * lineHeight)));
  if (lines.length <= maxLines) {
    return { lines, fontSize: floor };
  }
  const clipped = lines.slice(0, maxLines);
  const lastIdx = clipped.length - 1;
  let last = clipped[lastIdx];
  const ellipsis = "…";
  while (
    last.length > 0 &&
    ctx.measureText(last + ellipsis).width > innerWidth
  ) {
    last = last.slice(0, -1);
  }
  clipped[lastIdx] = last.length > 0 ? last + ellipsis : ellipsis;
  return { lines: clipped, fontSize: floor };
}

export function buildQuoteCardFooterLeft(meta: QuoteCardMeta): string {
  const character = meta.characterName.trim();
  const creator = meta.creatorName?.trim() ?? "";
  if (character && creator) return `${character} · ${creator}`;
  return character || creator;
}

export function scaleQuoteCardForViewport(
  cardWidth: number,
  cardHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  const maxW = Math.max(200, viewportWidth * 0.92 - 24);
  const maxH = Math.max(200, viewportHeight * 0.86 - 150);
  const scale = Math.min(maxW / cardWidth, maxH / cardHeight);
  return {
    width: Math.max(1, Math.round(cardWidth * scale)),
    height: Math.max(1, Math.round(cardHeight * scale)),
  };
}

function measureQuoteCardLayout(
  meta: QuoteCardMeta,
  style?: QuoteCardStyle
): {
  width: number;
  height: number;
  lines: string[];
  bodyFontSize: number;
  footerLeft: string;
  siteName: string;
  resolved: Required<QuoteCardStyle>;
  orientation: QuoteCardOrientation;
} {
  const resolved = { ...DEFAULT_STYLE, ...style };
  const orientation = meta.orientation ?? "portrait";
  const footerLeft = buildQuoteCardFooterLeft(meta);
  const siteName = meta.siteName?.trim() || SITE_DISPLAY_NAME;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }

  const text = meta.bodyText.trim();
  const footerGap = 28;
  const footerBand = resolved.footerFontSize * 2 + resolved.padding * 0.5;
  const chromeHeight = resolved.padding * 2 + footerGap + footerBand;

  const { width, height } = quoteCardDimensions(orientation);
  const innerWidth = width - resolved.padding * 2;
  const innerHeight = height - chromeHeight;
  const laid = layoutBodyText(
    ctx,
    text,
    innerWidth,
    innerHeight,
    resolved.bodyFontSize,
    resolved.bodyLineHeight
  );

  return {
    width,
    height,
    lines: laid.lines,
    bodyFontSize: laid.fontSize,
    footerLeft,
    siteName,
    resolved,
    orientation,
  };
}

export function measureQuoteCardCanvas(
  meta: QuoteCardMeta,
  style?: QuoteCardStyle
): {
  width: number;
  height: number;
  lines: string[];
  bodyFontSize: number;
  footerLeft: string;
  siteName: string;
  resolved: Required<QuoteCardStyle>;
  orientation: QuoteCardOrientation;
} {
  return measureQuoteCardLayout(meta, style);
}

export async function renderQuoteCardPngBlob(
  meta: QuoteCardMeta,
  style?: QuoteCardStyle
): Promise<{ blob: Blob; width: number; height: number }> {
  const measured = measureQuoteCardLayout(meta, style);
  const {
    width,
    height,
    lines,
    bodyFontSize,
    footerLeft,
    siteName,
    resolved,
  } = measured;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }

  roundRectPath(ctx, 0, 0, width, height, 16);
  ctx.fillStyle = resolved.background;
  ctx.fill();
  ctx.strokeStyle = resolved.borderColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = resolved.bodyColor;
  ctx.font = `${bodyFontSize}px ${BODY_FONT}`;
  ctx.textBaseline = "top";
  let y = resolved.padding;
  const lineStep = bodyFontSize * resolved.bodyLineHeight;
  for (const line of lines) {
    ctx.fillText(line, resolved.padding, y);
    y += lineStep;
  }

  const footerY = height - resolved.padding - resolved.footerFontSize;
  ctx.fillStyle = resolved.footerColor;
  ctx.font = `${resolved.footerFontSize}px ${BODY_FONT}`;
  ctx.fillText(footerLeft, resolved.padding, footerY);
  const siteWidth = ctx.measureText(siteName).width;
  ctx.fillText(siteName, width - resolved.padding - siteWidth, footerY);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) {
    throw new Error("PNG export failed");
  }
  return { blob, width, height };
}

export function downloadQuoteCardPng(blob: Blob, filename = "quote.png"): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function isMobileSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|SamsungBrowser/i.test(ua);
  return isiOS && safari;
}

export function canShareQuoteCardPng(blob: Blob, filename = "quote.png"): boolean {
  if (typeof navigator === "undefined" || !navigator.share || typeof File === "undefined") return false;
  const file = new File([blob], filename, { type: "image/png" });
  return !navigator.canShare || navigator.canShare({ files: [file] });
}

/**
 * Open a blank tab synchronously under a user gesture for iOS Safari.
 * Must NOT use noopener/noreferrer — Safari still opens the tab but returns null,
 * which leaves an orphaned about:blank page we cannot navigate to the image.
 */
export function prepareQuoteCardSaveFallbackWindow(): Window | null {
  if (!isMobileSafariLike() || typeof window === "undefined") return null;
  try {
    return window.open("about:blank", "_blank");
  } catch {
    return null;
  }
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function navigateFallbackWindowToBlob(target: Window, url: string, filename: string): void {
  // Embedding <img> is more reliable than navigating to blob:image/png on some iOS versions
  // (blank viewer / failed paint), and keeps long-press → Save Image available.
  try {
    const doc = target.document;
    const safeName = escapeHtmlAttr(filename);
    doc.open();
    doc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeName}</title><style>html,body{margin:0;background:#111;min-height:100%;display:flex;align-items:center;justify-content:center}img{max-width:100%;height:auto;-webkit-touch-callout:default}</style></head><body><img src="${url}" alt="${safeName}"></body></html>`
    );
    doc.close();
    return;
  } catch {
    // Fall through if document access fails.
  }
  target.location.href = url;
}

export function saveQuoteCardPngWithFallback(
  blob: Blob,
  filename = "quote.png",
  preopenedWindow: Window | null = null
): "download" | "opened" | "blocked" {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // Continue to Safari/new-tab fallback below when possible.
  }

  if (isMobileSafariLike()) {
    const target =
      preopenedWindow && !preopenedWindow.closed
        ? preopenedWindow
        : prepareQuoteCardSaveFallbackWindow();
    if (!target || target.closed) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return "blocked";
    }
    try {
      navigateFallbackWindowToBlob(target, url, filename);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      return "opened";
    } catch {
      try {
        target.close();
      } catch {
        // ignore
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return "blocked";
    }
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return "download";
}

export async function shareQuoteCardPng(blob: Blob, filename = "quote.png"): Promise<boolean> {
  if (!canShareQuoteCardPng(blob, filename)) return false;
  const file = new File([blob], filename, { type: "image/png" });
  await navigator.share({
    files: [file],
    title: SITE_DISPLAY_NAME,
  });
  return true;
}
