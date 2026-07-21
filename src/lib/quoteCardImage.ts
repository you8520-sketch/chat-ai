import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";

export type QuoteCardOrientation = "portrait" | "landscape" | "square";

export type QuoteCardMeta = {
  bodyText: string;
  characterName: string;
  creatorName?: string;
  siteName?: string;
  orientation?: QuoteCardOrientation;
};

export type QuoteCardBlock = {
  type: "narration" | "dialogue";
  text: string;
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
  /** Auto speech bubbles for quoted dialogue (default true). */
  speechBubbles?: boolean;
  bubbleFill?: string;
  bubbleTextColor?: string;
  paragraphGapScale?: number;
  bubbleGap?: number;
  avatarImage?: CanvasImageSource | null;
  backgroundImage?: CanvasImageSource | null;
  characterInitial?: string;
};

const CARD_SHORT_SIDE = 600;

export const QUOTE_CARD_BODY_FONT_DEFAULT = 22;
export const QUOTE_CARD_BODY_FONT_MIN = 15;
export const QUOTE_CARD_BODY_FONT_MAX = 35;

const DEFAULT_STYLE: Required<
  Omit<QuoteCardStyle, "avatarImage" | "backgroundImage" | "characterInitial">
> & {
  avatarImage: CanvasImageSource | null;
  backgroundImage: CanvasImageSource | null;
  characterInitial: string;
} = {
  padding: 36,
  bodyFontSize: QUOTE_CARD_BODY_FONT_DEFAULT,
  bodyLineHeight: 1.72,
  footerFontSize: 15,
  background: "#ffffff",
  bodyColor: "#18181b",
  footerColor: "#71717a",
  borderColor: "rgba(0,0,0,0.08)",
  speechBubbles: true,
  bubbleFill: "#f4f4f5",
  bubbleTextColor: "#18181b",
  paragraphGapScale: 1.35,
  bubbleGap: 18,
  avatarImage: null,
  backgroundImage: null,
  characterInitial: "",
};

const BODY_FONT = "system-ui, -apple-system, \"Segoe UI\", sans-serif";
const AVATAR_SIZE = 40;
const BUBBLE_PAD_X = 14;
const BUBBLE_PAD_Y = 12;
const BUBBLE_RADIUS = 16;
const AVATAR_GAP = 10;

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

/** Detect quoted dialogue lines for speech-bubble layout. */
export function parseQuoteCardBlocks(text: string): QuoteCardBlock[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n+/);
  const blocks: QuoteCardBlock[] = [];

  for (const raw of paragraphs) {
    const paragraph = raw.trim();
    if (!paragraph) continue;

    const dialogueMatch = paragraph.match(
      /^(?:["“”]|「|『)([\s\S]+?)(?:["“”]|」|』)\s*$/u
    );
    if (dialogueMatch?.[1]?.trim()) {
      blocks.push({ type: "dialogue", text: dialogueMatch[1].trim() });
      continue;
    }

    // Inline quotes: split narration / dialogue chunks on the same paragraph.
    const inlineRe = /(["“”]|「|『)([\s\S]+?)(["“”]|」|』)/gu;
    let last = 0;
    let matched = false;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(paragraph)) !== null) {
      matched = true;
      const before = paragraph.slice(last, m.index).trim();
      if (before) blocks.push({ type: "narration", text: before });
      const spoken = (m[2] ?? "").trim();
      if (spoken) blocks.push({ type: "dialogue", text: spoken });
      last = m.index + m[0].length;
    }
    if (matched) {
      const after = paragraph.slice(last).trim();
      if (after) blocks.push({ type: "narration", text: after });
      continue;
    }

    blocks.push({ type: "narration", text: paragraph });
  }

  return blocks.length > 0 ? blocks : [{ type: "narration", text: normalized }];
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

type LaidBlock =
  | { type: "narration"; lines: string[] }
  | { type: "dialogue"; lines: string[]; bubbleW: number; bubbleH: number };

function measureBlocksHeight(
  blocks: LaidBlock[],
  fontSize: number,
  lineHeight: number,
  paragraphGapScale: number,
  bubbleGap: number
): number {
  let h = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (i > 0) {
      h += b.type === "dialogue" || blocks[i - 1]!.type === "dialogue"
        ? bubbleGap
        : fontSize * lineHeight * (paragraphGapScale - 1);
    }
    if (b.type === "narration") {
      h += b.lines.length * fontSize * lineHeight;
    } else {
      h += Math.max(AVATAR_SIZE, b.bubbleH);
    }
  }
  return h;
}

function layoutBubbleBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: QuoteCardBlock[],
  innerWidth: number,
  innerHeight: number,
  baseFontSize: number,
  lineHeight: number,
  paragraphGapScale: number,
  bubbleGap: number
): { laid: LaidBlock[]; fontSize: number } {
  const floor = Math.max(6, Math.min(QUOTE_CARD_BODY_FONT_MIN, baseFontSize));
  let fontSize = Math.round(baseFontSize);

  while (fontSize >= floor) {
    ctx.font = `${fontSize}px ${BODY_FONT}`;
    const dialogueTextWidth = Math.max(
      80,
      innerWidth - AVATAR_SIZE - AVATAR_GAP - BUBBLE_PAD_X * 2
    );
    const laid: LaidBlock[] = blocks.map((block) => {
      if (block.type === "narration") {
        return {
          type: "narration",
          lines: wrapCanvasLines(ctx, block.text, innerWidth),
        };
      }
      const lines = wrapCanvasLines(ctx, block.text, dialogueTextWidth);
      const textH = Math.max(fontSize * lineHeight, lines.length * fontSize * lineHeight);
      const bubbleW = Math.min(
        innerWidth - AVATAR_SIZE - AVATAR_GAP,
        Math.ceil(
          Math.max(...lines.map((l) => ctx.measureText(l).width), 24) + BUBBLE_PAD_X * 2
        )
      );
      return {
        type: "dialogue",
        lines,
        bubbleW,
        bubbleH: textH + BUBBLE_PAD_Y * 2,
      };
    });
    if (measureBlocksHeight(laid, fontSize, lineHeight, paragraphGapScale, bubbleGap) <= innerHeight) {
      return { laid, fontSize };
    }
    fontSize -= 1;
  }

  ctx.font = `${floor}px ${BODY_FONT}`;
  const dialogueTextWidth = Math.max(
    80,
    innerWidth - AVATAR_SIZE - AVATAR_GAP - BUBBLE_PAD_X * 2
  );
  const laid: LaidBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    if (block.type === "narration") {
      const lines = wrapCanvasLines(ctx, block.text, innerWidth);
      const need =
        (laid.length > 0 ? floor * lineHeight * (paragraphGapScale - 1) : 0) +
        lines.length * floor * lineHeight;
      if (used + need > innerHeight && laid.length > 0) break;
      laid.push({ type: "narration", lines });
      used += need;
    } else {
      const lines = wrapCanvasLines(ctx, block.text, dialogueTextWidth);
      const textH = Math.max(floor * lineHeight, lines.length * floor * lineHeight);
      const bubbleH = textH + BUBBLE_PAD_Y * 2;
      const bubbleW = Math.min(
        innerWidth - AVATAR_SIZE - AVATAR_GAP,
        Math.ceil(
          Math.max(...lines.map((l) => ctx.measureText(l).width), 24) + BUBBLE_PAD_X * 2
        )
      );
      const need =
        (laid.length > 0 ? bubbleGap : 0) + Math.max(AVATAR_SIZE, bubbleH);
      if (used + need > innerHeight && laid.length > 0) break;
      laid.push({ type: "dialogue", lines, bubbleW, bubbleH });
      used += need;
    }
  }
  if (laid.length === 0) {
    laid.push({ type: "narration", lines: ["…"] });
  }
  return { laid, fontSize: floor };
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
  const maxW = Math.max(200, Math.min(480, viewportWidth * 0.92 - 24));
  const maxH = Math.max(180, viewportHeight * 0.42);
  const scale = Math.min(maxW / cardWidth, maxH / cardHeight);
  return {
    width: Math.max(1, Math.round(cardWidth * scale)),
    height: Math.max(1, Math.round(cardHeight * scale)),
  };
}

function resolveStyle(style?: QuoteCardStyle) {
  return {
    ...DEFAULT_STYLE,
    ...style,
    avatarImage: style?.avatarImage ?? null,
    backgroundImage: style?.backgroundImage ?? null,
    characterInitial: style?.characterInitial ?? "",
    speechBubbles: style?.speechBubbles ?? DEFAULT_STYLE.speechBubbles,
  };
}

function measureQuoteCardLayout(
  meta: QuoteCardMeta,
  style?: QuoteCardStyle
): {
  width: number;
  height: number;
  lines: string[];
  laidBlocks: LaidBlock[] | null;
  bodyFontSize: number;
  footerLeft: string;
  siteName: string;
  resolved: ReturnType<typeof resolveStyle>;
  orientation: QuoteCardOrientation;
  useBubbles: boolean;
} {
  const resolved = resolveStyle(style);
  const orientation = meta.orientation ?? "portrait";
  const footerLeft = buildQuoteCardFooterLeft(meta);
  const siteName = meta.siteName?.trim() || SITE_DISPLAY_NAME;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }

  const text = meta.bodyText.trim();
  const footerGap = 32;
  const footerBand = resolved.footerFontSize * 2.2 + resolved.padding * 0.45;
  const chromeHeight = resolved.padding * 2 + footerGap + footerBand;

  const { width, height } = quoteCardDimensions(orientation);
  const innerWidth = width - resolved.padding * 2;
  const innerHeight = height - chromeHeight;

  const blocks = parseQuoteCardBlocks(text);
  const useBubbles =
    resolved.speechBubbles && blocks.some((b) => b.type === "dialogue");

  if (!useBubbles) {
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
      laidBlocks: null,
      bodyFontSize: laid.fontSize,
      footerLeft,
      siteName,
      resolved,
      orientation,
      useBubbles: false,
    };
  }

  const { laid, fontSize } = layoutBubbleBlocks(
    ctx,
    blocks,
    innerWidth,
    innerHeight,
    resolved.bodyFontSize,
    resolved.bodyLineHeight,
    resolved.paragraphGapScale,
    resolved.bubbleGap
  );

  return {
    width,
    height,
    lines: [],
    laidBlocks: laid,
    bodyFontSize: fontSize,
    footerLeft,
    siteName,
    resolved,
    orientation,
    useBubbles: true,
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
  const m = measureQuoteCardLayout(meta, style);
  return {
    width: m.width,
    height: m.height,
    lines: m.lines,
    bodyFontSize: m.bodyFontSize,
    footerLeft: m.footerLeft,
    siteName: m.siteName,
    resolved: m.resolved as Required<QuoteCardStyle>,
    orientation: m.orientation,
  };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  width: number,
  height: number
): void {
  const iw =
    "naturalWidth" in img && typeof img.naturalWidth === "number" && img.naturalWidth > 0
      ? img.naturalWidth
      : "width" in img && typeof img.width === "number"
        ? img.width
        : width;
  const ih =
    "naturalHeight" in img && typeof img.naturalHeight === "number" && img.naturalHeight > 0
      ? img.naturalHeight
      : "height" in img && typeof img.height === "number"
        ? img.height
        : height;
  const scale = Math.max(width / Math.max(1, iw), height / Math.max(1, ih));
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawCircularAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  image: CanvasImageSource | null,
  initial: string
): void {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (image) {
    const iw =
      "naturalWidth" in image && typeof image.naturalWidth === "number" && image.naturalWidth > 0
        ? image.naturalWidth
        : "width" in image && typeof image.width === "number"
          ? image.width
          : size;
    const ih =
      "naturalHeight" in image &&
      typeof image.naturalHeight === "number" &&
      image.naturalHeight > 0
        ? image.naturalHeight
        : "height" in image && typeof image.height === "number"
          ? image.height
          : size;
    const scale = Math.max(size / Math.max(1, iw), size / Math.max(1, ih));
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(image, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#e4e4e7";
    ctx.fillRect(x, y, size, size);
    const letter = (initial.trim()[0] || "?").toUpperCase();
    ctx.fillStyle = "#52525b";
    ctx.font = `600 ${Math.round(size * 0.42)}px ${BODY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, cx, cy + 1);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
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
    laidBlocks,
    bodyFontSize,
    footerLeft,
    siteName,
    resolved,
    useBubbles,
  } = measured;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }

  roundRectPath(ctx, 0, 0, width, height, 18);
  ctx.save();
  ctx.clip();

  if (resolved.backgroundImage) {
    drawCoverImage(ctx, resolved.backgroundImage, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = resolved.background;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();

  roundRectPath(ctx, 0, 0, width, height, 18);
  ctx.strokeStyle = resolved.borderColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  const pad = resolved.padding;
  const lineStep = bodyFontSize * resolved.bodyLineHeight;
  let y = pad;

  if (!useBubbles || !laidBlocks) {
    ctx.fillStyle = resolved.bodyColor;
    ctx.font = `${bodyFontSize}px ${BODY_FONT}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line === "" && i > 0) {
        y += lineStep * (resolved.paragraphGapScale - 1);
        continue;
      }
      ctx.fillText(line, pad, y);
      y += lineStep;
    }
  } else {
    const initial =
      resolved.characterInitial.trim() ||
      meta.characterName.trim()[0] ||
      "?";
    for (let i = 0; i < laidBlocks.length; i++) {
      const block = laidBlocks[i]!;
      if (i > 0) {
        y +=
          block.type === "dialogue" || laidBlocks[i - 1]!.type === "dialogue"
            ? resolved.bubbleGap
            : bodyFontSize * resolved.bodyLineHeight * (resolved.paragraphGapScale - 1);
      }
      if (block.type === "narration") {
        ctx.fillStyle = resolved.bodyColor;
        ctx.font = `${bodyFontSize}px ${BODY_FONT}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        for (const line of block.lines) {
          ctx.fillText(line, pad, y);
          y += lineStep;
        }
      } else {
        const rowH = Math.max(AVATAR_SIZE, block.bubbleH);
        const avatarY = y + (rowH - AVATAR_SIZE) / 2;
        drawCircularAvatar(
          ctx,
          pad,
          avatarY,
          AVATAR_SIZE,
          resolved.avatarImage,
          initial
        );
        const bubbleX = pad + AVATAR_SIZE + AVATAR_GAP;
        const bubbleY = y + (rowH - block.bubbleH) / 2;
        roundRectPath(ctx, bubbleX, bubbleY, block.bubbleW, block.bubbleH, BUBBLE_RADIUS);
        ctx.fillStyle = resolved.bubbleFill;
        ctx.fill();
        ctx.fillStyle = resolved.bubbleTextColor;
        ctx.font = `${bodyFontSize}px ${BODY_FONT}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        let ty = bubbleY + BUBBLE_PAD_Y;
        for (const line of block.lines) {
          ctx.fillText(line, bubbleX + BUBBLE_PAD_X, ty);
          ty += lineStep;
        }
        y += rowH;
      }
    }
  }

  const footerY = height - pad - resolved.footerFontSize;
  ctx.fillStyle = resolved.footerColor;
  ctx.font = `500 ${resolved.footerFontSize}px ${BODY_FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(footerLeft, pad, footerY);
  const siteWidth = ctx.measureText(siteName).width;
  ctx.fillText(siteName, width - pad - siteWidth, footerY);

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

export async function copyQuoteCardPng(blob: Blob): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  if (typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    return true;
  } catch {
    return false;
  }
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

/** Exposed for tests — default card chrome. */
export const QUOTE_CARD_DEFAULT_BACKGROUND = DEFAULT_STYLE.background;
export const QUOTE_CARD_DEFAULT_FOOTER_FONT_SIZE = DEFAULT_STYLE.footerFontSize;
