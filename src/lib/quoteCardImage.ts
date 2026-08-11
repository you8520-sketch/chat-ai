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
  /** Speaker label for dialogue (parsed prefix, auto-assigned, or user override). */
  speaker?: string;
};

/** Dialogue chrome on quote cards: off, speech bubble, or chat-room accent bar. */
export type QuoteCardDialogueStyle = "off" | "bubble" | "accent";

export type QuoteCardThemeId = "white" | "black" | "blue";
export type QuoteCardFontId =
  | "system"
  | "noto-serif"
  | "nanum-myeongjo"
  | "gowun-batang"
  | "song-myung";

export type QuoteCardTheme = {
  id: QuoteCardThemeId;
  label: string;
  background: string;
  bodyColor: string;
  footerColor: string;
  borderColor: string;
  bubbleFill: string;
  bubbleTextColor: string;
  imageScrim: string;
  accentColor: string;
  accentColorEnd: string;
};

export type QuoteCardFontOption = {
  id: QuoteCardFontId;
  label: string;
  css: string;
  loadName: string;
  google: string | null;
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
  imageScrim?: string;
  bodyFontFamily?: string;
  /**
   * Dialogue chrome. Default `"bubble"`.
   * Prefer this over deprecated `speechBubbles`.
   */
  dialogueStyle?: QuoteCardDialogueStyle;
  /**
   * @deprecated Use `dialogueStyle`. `true` → bubble, `false` → off.
   */
  speechBubbles?: boolean;
  bubbleFill?: string;
  bubbleTextColor?: string;
  accentColor?: string;
  accentColorEnd?: string;
  paragraphGapScale?: number;
  bubbleGap?: number;
  avatarImage?: CanvasImageSource | null;
  /**
   * Focal point inside the avatar source image (0–1).
   * Used so the face can be centered in the circular crop.
   */
  avatarFocus?: QuoteCardAvatarFocus;
  backgroundImage?: CanvasImageSource | null;
  characterInitial?: string;
  /** Default speaker when dialogue has no label (usually character name). */
  defaultSpeakerName?: string;
  /**
   * Per-dialogue speaker overrides keyed by dialogue index
   * (0-based among dialogue blocks only).
   */
  speakerOverrides?: Record<number, string>;
};

/** Cover-crop focus for circular avatar (and optional zoom ≥ 1). */
export type QuoteCardAvatarFocus = {
  x: number;
  y: number;
  zoom?: number;
};

/** Base export edge length (~1.25× the original 600). */
const CARD_SHORT_SIDE = 750;

export const QUOTE_CARD_AVATAR_FOCUS_DEFAULT: QuoteCardAvatarFocus = {
  x: 0.5,
  y: 0.5,
  zoom: 1,
};

export function clampQuoteCardAvatarFocus(
  focus?: Partial<QuoteCardAvatarFocus> | null
): QuoteCardAvatarFocus {
  const x = Number.isFinite(focus?.x) ? Number(focus?.x) : 0.5;
  const y = Number.isFinite(focus?.y) ? Number(focus?.y) : 0.5;
  const zoom = Number.isFinite(focus?.zoom) ? Number(focus?.zoom) : 1;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    zoom: Math.min(2.5, Math.max(1, zoom)),
  };
}

export const QUOTE_CARD_BODY_FONT_DEFAULT = 22;
export const QUOTE_CARD_BODY_FONT_MIN = 15;
export const QUOTE_CARD_BODY_FONT_MAX = 35;

export const QUOTE_CARD_THEMES: QuoteCardTheme[] = [
  {
    id: "white",
    label: "흰색",
    background: "#ffffff",
    bodyColor: "#18181b",
    footerColor: "#71717a",
    borderColor: "rgba(0,0,0,0.08)",
    bubbleFill: "#f4f4f5",
    bubbleTextColor: "#18181b",
    imageScrim: "rgba(255,255,255,0.72)",
    accentColor: "#7c3aed",
    accentColorEnd: "#8b5cf6",
  },
  {
    id: "black",
    label: "검정",
    background: "#0a0a0a",
    bodyColor: "#f4f4f5",
    footerColor: "#a1a1aa",
    borderColor: "rgba(255,255,255,0.14)",
    bubbleFill: "#27272a",
    bubbleTextColor: "#fafafa",
    imageScrim: "rgba(0,0,0,0.58)",
    accentColor: "#a78bfa",
    accentColorEnd: "#c4b5fd",
  },
  {
    id: "blue",
    label: "파랑",
    background: "#0c1929",
    bodyColor: "#e8eef7",
    footerColor: "#93c5fd",
    borderColor: "rgba(147,197,253,0.28)",
    bubbleFill: "#1e3a5f",
    bubbleTextColor: "#f0f7ff",
    imageScrim: "rgba(12,25,41,0.62)",
    accentColor: "#60a5fa",
    accentColorEnd: "#93c5fd",
  },
];

/** System + popular Korean novel/reading faces. */
export const QUOTE_CARD_FONTS: QuoteCardFontOption[] = [
  {
    id: "system",
    label: "기본",
    css: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    loadName: "system-ui",
    google: null,
  },
  {
    id: "noto-serif",
    label: "노토 명조",
    css: '"Noto Serif KR", "Apple SD Gothic Neo", serif',
    loadName: "Noto Serif KR",
    google: "Noto+Serif+KR:wght@400;500;600",
  },
  {
    id: "nanum-myeongjo",
    label: "나눔명조",
    css: '"Nanum Myeongjo", "Apple SD Gothic Neo", serif',
    loadName: "Nanum Myeongjo",
    google: "Nanum+Myeongjo:wght@400;700",
  },
  {
    id: "gowun-batang",
    label: "고운바탕",
    css: '"Gowun Batang", "Apple SD Gothic Neo", serif',
    loadName: "Gowun Batang",
    google: "Gowun+Batang:wght@400;700",
  },
  {
    id: "song-myung",
    label: "송명",
    css: '"Song Myung", "Apple SD Gothic Neo", serif',
    loadName: "Song Myung",
    google: "Song+Myung",
  },
];

export function quoteCardThemeById(id: QuoteCardThemeId): QuoteCardTheme {
  return QUOTE_CARD_THEMES.find((t) => t.id === id) ?? QUOTE_CARD_THEMES[0]!;
}

export function quoteCardFontById(id: QuoteCardFontId): QuoteCardFontOption {
  return QUOTE_CARD_FONTS.find((f) => f.id === id) ?? QUOTE_CARD_FONTS[0]!;
}

export function styleFromQuoteCardTheme(themeId: QuoteCardThemeId): Pick<
  QuoteCardStyle,
  | "background"
  | "bodyColor"
  | "footerColor"
  | "borderColor"
  | "bubbleFill"
  | "bubbleTextColor"
  | "imageScrim"
  | "accentColor"
  | "accentColorEnd"
> {
  const t = quoteCardThemeById(themeId);
  return {
    background: t.background,
    bodyColor: t.bodyColor,
    footerColor: t.footerColor,
    borderColor: t.borderColor,
    bubbleFill: t.bubbleFill,
    bubbleTextColor: t.bubbleTextColor,
    imageScrim: t.imageScrim,
    accentColor: t.accentColor,
    accentColorEnd: t.accentColorEnd,
  };
}

let quoteCardFontsPromise: Promise<void> | null = null;

export function ensureQuoteCardWebFontsLoaded(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (quoteCardFontsPromise) return quoteCardFontsPromise;
  quoteCardFontsPromise = (async () => {
    const google = QUOTE_CARD_FONTS.map((f) => f.google).filter(Boolean) as string[];
    if (google.length > 0) {
      const id = "quote-card-google-fonts";
      if (!document.getElementById(id)) {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?${google
          .map((f) => `family=${f}`)
          .join("&")}&display=swap`;
        document.head.appendChild(link);
      }
    }
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all(
      QUOTE_CARD_FONTS.filter((f) => f.google).map(async (f) => {
        try {
          await document.fonts.load(`400 22px "${f.loadName}"`);
          await document.fonts.load(`600 22px "${f.loadName}"`);
        } catch {
          /* ignore missing face */
        }
      })
    );
  })();
  return quoteCardFontsPromise;
}

const DEFAULT_STYLE: Required<
  Omit<
    QuoteCardStyle,
    | "avatarImage"
    | "avatarFocus"
    | "backgroundImage"
    | "characterInitial"
    | "defaultSpeakerName"
    | "speakerOverrides"
    | "speechBubbles"
  >
> & {
  avatarImage: CanvasImageSource | null;
  avatarFocus: QuoteCardAvatarFocus;
  backgroundImage: CanvasImageSource | null;
  characterInitial: string;
  defaultSpeakerName: string;
  speakerOverrides: Record<number, string>;
  speechBubbles: boolean;
} = {
  padding: 36,
  bodyFontSize: QUOTE_CARD_BODY_FONT_DEFAULT,
  bodyLineHeight: 1.72,
  footerFontSize: 15,
  background: QUOTE_CARD_THEMES[0]!.background,
  bodyColor: QUOTE_CARD_THEMES[0]!.bodyColor,
  footerColor: QUOTE_CARD_THEMES[0]!.footerColor,
  borderColor: QUOTE_CARD_THEMES[0]!.borderColor,
  imageScrim: QUOTE_CARD_THEMES[0]!.imageScrim,
  bodyFontFamily: QUOTE_CARD_FONTS[0]!.css,
  dialogueStyle: "bubble",
  speechBubbles: true,
  bubbleFill: QUOTE_CARD_THEMES[0]!.bubbleFill,
  bubbleTextColor: QUOTE_CARD_THEMES[0]!.bubbleTextColor,
  accentColor: QUOTE_CARD_THEMES[0]!.accentColor,
  accentColorEnd: QUOTE_CARD_THEMES[0]!.accentColorEnd,
  paragraphGapScale: 1.35,
  bubbleGap: 18,
  avatarImage: null,
  avatarFocus: { ...QUOTE_CARD_AVATAR_FOCUS_DEFAULT },
  backgroundImage: null,
  characterInitial: "",
  defaultSpeakerName: "",
  speakerOverrides: {},
};

const AVATAR_SIZE = 40;
const BUBBLE_PAD_X = 14;
const BUBBLE_PAD_Y = 12;
const BUBBLE_RADIUS = 16;
const AVATAR_GAP = 10;
const ACCENT_BAR_W = 3;
const ACCENT_PAD_X = 12;
const SPEAKER_LABEL_GAP = 4;

const SPEAKER_AVATAR_TONES: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: "#e4e4e7", fg: "#52525b" },
  { bg: "#ddd6fe", fg: "#5b21b6" },
  { bg: "#fde68a", fg: "#92400e" },
  { bg: "#bbf7d0", fg: "#166534" },
  { bg: "#fecaca", fg: "#991b1b" },
  { bg: "#bae6fd", fg: "#075985" },
  { bg: "#fbcfe8", fg: "#9d174d" },
  { bg: "#c7d2fe", fg: "#3730a3" },
];

export function resolveQuoteCardDialogueStyle(
  style?: Pick<QuoteCardStyle, "dialogueStyle" | "speechBubbles">
): QuoteCardDialogueStyle {
  if (style?.dialogueStyle) return style.dialogueStyle;
  if (style?.speechBubbles === false) return "off";
  if (style?.speechBubbles === true) return "bubble";
  return "bubble";
}

function hashSpeakerToneIndex(speaker: string): number {
  let h = 0;
  for (let i = 0; i < speaker.length; i++) {
    h = (h * 31 + speaker.charCodeAt(i)) >>> 0;
  }
  return h % SPEAKER_AVATAR_TONES.length;
}

export function speakerAvatarTone(speaker: string): { bg: string; fg: string } {
  return SPEAKER_AVATAR_TONES[hashSpeakerToneIndex(speaker.trim() || "?")]!;
}

function splitTrailingSpeaker(before: string): { narration: string; speaker?: string } {
  const trimmed = before.trim();
  if (!trimmed) return { narration: "" };
  const m = trimmed.match(/^(.*?)([^\s"'「『“”：:.,!?。…]{1,16})\s*[:：]\s*$/u);
  if (!m) return { narration: trimmed };
  const speaker = (m[2] ?? "").trim();
  if (!speaker || /^[-–—*…·.]+$/u.test(speaker)) return { narration: trimmed };
  return { narration: (m[1] ?? "").trim(), speaker };
}

/** Detect quoted dialogue lines; optional `이름: "대사"` speaker prefixes. */
export function parseQuoteCardBlocks(text: string): QuoteCardBlock[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n+/);
  const blocks: QuoteCardBlock[] = [];

  for (const raw of paragraphs) {
    const paragraph = raw.trim();
    if (!paragraph) continue;

    // Speaker token: short name without spaces/punctuation (avoids "지문. 이름:" false positives).
    const dialogueMatch = paragraph.match(
      /^(?:([^\s"'「『“”：:.,!?。…]{1,16})\s*[:：]\s*)?(?:["“”]|「|『)([\s\S]+?)(?:["“”]|」|』)\s*$/u
    );
    if (dialogueMatch?.[2]?.trim()) {
      const speaker = dialogueMatch[1]?.trim();
      blocks.push({
        type: "dialogue",
        text: dialogueMatch[2].trim(),
        ...(speaker ? { speaker } : {}),
      });
      continue;
    }

    // Inline quotes: split narration / dialogue chunks on the same paragraph.
    const inlineRe = /(["“”]|「|『)([\s\S]+?)(["“”]|」|』)/gu;
    let last = 0;
    let matched = false;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(paragraph)) !== null) {
      matched = true;
      const beforeRaw = paragraph.slice(last, m.index);
      const { narration, speaker } = splitTrailingSpeaker(beforeRaw);
      if (narration) blocks.push({ type: "narration", text: narration });
      const spoken = (m[2] ?? "").trim();
      if (spoken) {
        blocks.push({
          type: "dialogue",
          text: spoken,
          ...(speaker ? { speaker } : {}),
        });
      }
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

/**
 * Fill dialogue speakers: overrides win, then parsed `이름:` prefixes,
 * otherwise every line defaults to the character name (edit non-character lines in UI).
 */
export function resolveQuoteCardSpeakers(
  blocks: QuoteCardBlock[],
  opts: {
    defaultSpeaker?: string;
    overrides?: Record<number, string>;
  } = {}
): QuoteCardBlock[] {
  const defaultSpeaker = (opts.defaultSpeaker ?? "").trim() || "캐릭터";
  const overrides = opts.overrides ?? {};

  let dialogueIndex = 0;
  return blocks.map((block) => {
    if (block.type !== "dialogue") return block;
    const idx = dialogueIndex;
    dialogueIndex += 1;
    const override = overrides[idx]?.trim();
    if (override) return { ...block, speaker: override };
    if (block.speaker?.trim()) return { ...block, speaker: block.speaker.trim() };
    return { ...block, speaker: defaultSpeaker };
  });
}

/** Dialogue rows for the quote modal editor (index + preview snippet). */
export function listQuoteCardDialogueEntries(
  text: string,
  opts: {
    defaultSpeaker?: string;
    overrides?: Record<number, string>;
  } = {}
): Array<{ index: number; speaker: string; preview: string }> {
  const resolved = resolveQuoteCardSpeakers(parseQuoteCardBlocks(text), opts);
  const out: Array<{ index: number; speaker: string; preview: string }> = [];
  let i = 0;
  for (const block of resolved) {
    if (block.type !== "dialogue") continue;
    const preview =
      block.text.length > 28 ? `${block.text.slice(0, 28)}…` : block.text;
    out.push({
      index: i,
      speaker: block.speaker?.trim() || opts.defaultSpeaker?.trim() || "캐릭터",
      preview,
    });
    i += 1;
  }
  return out;
}

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
  fontFamily: string,
  minFontSize = QUOTE_CARD_BODY_FONT_MIN
): { lines: string[]; fontSize: number } {
  const floor = Math.max(6, Math.min(minFontSize, baseFontSize));
  let fontSize = Math.round(baseFontSize);
  while (fontSize >= floor) {
    ctx.font = `${fontSize}px ${fontFamily}`;
    const lines = wrapCanvasLines(ctx, text, innerWidth);
    const height = lines.length * fontSize * lineHeight;
    if (height <= innerHeight) {
      return { lines, fontSize };
    }
    fontSize -= 1;
  }
  ctx.font = `${floor}px ${fontFamily}`;
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
  | {
      type: "dialogue";
      lines: string[];
      contentW: number;
      contentH: number;
      speaker: string;
      showSpeakerLabel: boolean;
      labelH: number;
    };

function speakerLabelHeight(fontSize: number, show: boolean): number {
  if (!show) return 0;
  return Math.round(fontSize * 0.72) + SPEAKER_LABEL_GAP;
}

function measureBlocksHeight(
  blocks: LaidBlock[],
  fontSize: number,
  lineHeight: number,
  paragraphGapScale: number,
  bubbleGap: number,
  dialogueStyle: Exclude<QuoteCardDialogueStyle, "off">
): number {
  let h = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (i > 0) {
      h +=
        b.type === "dialogue" || blocks[i - 1]!.type === "dialogue"
          ? bubbleGap
          : fontSize * lineHeight * (paragraphGapScale - 1);
    }
    if (b.type === "narration") {
      h += b.lines.length * fontSize * lineHeight;
    } else if (dialogueStyle === "bubble") {
      h += b.labelH + Math.max(AVATAR_SIZE, b.contentH);
    } else {
      h += b.labelH + b.contentH;
    }
  }
  return h;
}

function layoutDialogueBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: QuoteCardBlock[],
  innerWidth: number,
  innerHeight: number,
  baseFontSize: number,
  lineHeight: number,
  paragraphGapScale: number,
  bubbleGap: number,
  fontFamily: string,
  dialogueStyle: Exclude<QuoteCardDialogueStyle, "off">
): { laid: LaidBlock[]; fontSize: number } {
  const floor = Math.max(6, Math.min(QUOTE_CARD_BODY_FONT_MIN, baseFontSize));
  let fontSize = Math.round(baseFontSize);
  const uniqueSpeakers = new Set(
    blocks
      .filter((b): b is QuoteCardBlock & { type: "dialogue" } => b.type === "dialogue")
      .map((b) => (b.speaker ?? "").trim() || "?")
  );
  const showSpeakerLabels = uniqueSpeakers.size > 1;

  const dialogueTextWidthFor = (size: number) => {
    if (dialogueStyle === "bubble") {
      return Math.max(80, innerWidth - AVATAR_SIZE - AVATAR_GAP - BUBBLE_PAD_X * 2);
    }
    return Math.max(80, innerWidth - ACCENT_BAR_W - ACCENT_PAD_X);
  };

  const layDialogue = (
    speakerRaw: string | undefined,
    text: string,
    size: number
  ): Extract<LaidBlock, { type: "dialogue" }> => {
    const speaker = speakerRaw?.trim() || "캐릭터";
    const showSpeakerLabel = showSpeakerLabels;
    const labelH = speakerLabelHeight(size, showSpeakerLabel);
    const dialogueTextWidth = dialogueTextWidthFor(size);
    const lines = wrapCanvasLines(ctx, text, dialogueTextWidth);
    const textH = Math.max(size * lineHeight, lines.length * size * lineHeight);
    if (dialogueStyle === "bubble") {
      const contentW = Math.min(
        innerWidth - AVATAR_SIZE - AVATAR_GAP,
        Math.ceil(
          Math.max(...lines.map((l) => ctx.measureText(l).width), 24) + BUBBLE_PAD_X * 2
        )
      );
      return {
        type: "dialogue",
        lines,
        contentW,
        contentH: textH + BUBBLE_PAD_Y * 2,
        speaker,
        showSpeakerLabel,
        labelH,
      };
    }
    return {
      type: "dialogue",
      lines,
      contentW: innerWidth,
      contentH: textH,
      speaker,
      showSpeakerLabel,
      labelH,
    };
  };

  while (fontSize >= floor) {
    ctx.font = `${fontSize}px ${fontFamily}`;
    const laid: LaidBlock[] = blocks.map((block) => {
      if (block.type === "narration") {
        return {
          type: "narration",
          lines: wrapCanvasLines(ctx, block.text, innerWidth),
        };
      }
      return layDialogue(block.speaker, block.text, fontSize);
    });
    if (
      measureBlocksHeight(
        laid,
        fontSize,
        lineHeight,
        paragraphGapScale,
        bubbleGap,
        dialogueStyle
      ) <= innerHeight
    ) {
      return { laid, fontSize };
    }
    fontSize -= 1;
  }

  ctx.font = `${floor}px ${fontFamily}`;
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
      const dialogue = layDialogue(block.speaker, block.text, floor);
      const bodyH =
        dialogueStyle === "bubble"
          ? Math.max(AVATAR_SIZE, dialogue.contentH)
          : dialogue.contentH;
      const need =
        (laid.length > 0 ? bubbleGap : 0) + dialogue.labelH + bodyH;
      if (used + need > innerHeight && laid.length > 0) break;
      laid.push(dialogue);
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
  const dialogueStyle = resolveQuoteCardDialogueStyle(style);
  return {
    ...DEFAULT_STYLE,
    ...style,
    avatarImage: style?.avatarImage ?? null,
    avatarFocus: clampQuoteCardAvatarFocus(style?.avatarFocus),
    backgroundImage: style?.backgroundImage ?? null,
    characterInitial: style?.characterInitial ?? "",
    defaultSpeakerName: style?.defaultSpeakerName ?? "",
    speakerOverrides: style?.speakerOverrides ?? {},
    dialogueStyle,
    speechBubbles: dialogueStyle !== "off",
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
  dialogueStyle: QuoteCardDialogueStyle;
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

  const parsed = parseQuoteCardBlocks(text);
  const defaultSpeaker =
    resolved.defaultSpeakerName.trim() || meta.characterName.trim() || "캐릭터";
  const blocks = resolveQuoteCardSpeakers(parsed, {
    defaultSpeaker,
    overrides: resolved.speakerOverrides,
  });
  const dialogueStyle = resolved.dialogueStyle;
  const hasDialogue = blocks.some((b) => b.type === "dialogue");

  if (dialogueStyle === "off" || !hasDialogue) {
    const laid = layoutBodyText(
      ctx,
      text,
      innerWidth,
      innerHeight,
      resolved.bodyFontSize,
      resolved.bodyLineHeight,
      resolved.bodyFontFamily
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
      dialogueStyle: "off",
    };
  }

  const { laid, fontSize } = layoutDialogueBlocks(
    ctx,
    blocks,
    innerWidth,
    innerHeight,
    resolved.bodyFontSize,
    resolved.bodyLineHeight,
    resolved.paragraphGapScale,
    resolved.bubbleGap,
    resolved.bodyFontFamily,
    dialogueStyle
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
    dialogueStyle,
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
  initial: string,
  tone: { bg: string; fg: string } = SPEAKER_AVATAR_TONES[0]!,
  focus: QuoteCardAvatarFocus = QUOTE_CARD_AVATAR_FOCUS_DEFAULT
): void {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  const resolvedFocus = clampQuoteCardAvatarFocus(focus);

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
    const cover = Math.max(size / Math.max(1, iw), size / Math.max(1, ih));
    const scale = cover * (resolvedFocus.zoom ?? 1);
    const dw = iw * scale;
    const dh = ih * scale;
    // Map focal point in source → circle center.
    const dx = cx - resolvedFocus.x * dw;
    const dy = cy - resolvedFocus.y * dh;
    ctx.drawImage(image, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = tone.bg;
    ctx.fillRect(x, y, size, size);
    const letter = (initial.trim()[0] || "?").toUpperCase();
    ctx.fillStyle = tone.fg;
    ctx.font = `600 ${Math.round(size * 0.42)}px ${DEFAULT_STYLE.bodyFontFamily}`;
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

function drawAccentBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  colorStart: string,
  colorEnd: string
): void {
  const grad = ctx.createLinearGradient(x, y, x, y + height);
  grad.addColorStop(0, colorStart);
  grad.addColorStop(1, colorEnd);
  ctx.fillStyle = grad;
  roundRectPath(ctx, x, y, ACCENT_BAR_W, height, 2);
  ctx.fill();
}

export async function renderQuoteCardPngBlob(
  meta: QuoteCardMeta,
  style?: QuoteCardStyle
): Promise<{ blob: Blob; width: number; height: number }> {
  await ensureQuoteCardWebFontsLoaded();
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
    dialogueStyle,
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
    ctx.fillStyle = resolved.imageScrim;
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
  const fontFamily = resolved.bodyFontFamily;
  const defaultSpeaker =
    resolved.defaultSpeakerName.trim() || meta.characterName.trim() || "캐릭터";
  let y = pad;

  if (dialogueStyle === "off" || !laidBlocks) {
    ctx.fillStyle = resolved.bodyColor;
    ctx.font = `${bodyFontSize}px ${fontFamily}`;
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
        ctx.font = `${bodyFontSize}px ${fontFamily}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        for (const line of block.lines) {
          ctx.fillText(line, pad, y);
          y += lineStep;
        }
        continue;
      }

      const speaker = block.speaker.trim() || defaultSpeaker;
      const initial =
        speaker === defaultSpeaker && resolved.characterInitial.trim()
          ? resolved.characterInitial.trim()
          : speaker[0] || "?";
      const useAvatarImage =
        Boolean(resolved.avatarImage) &&
        speaker === defaultSpeaker;
      const tone = speakerAvatarTone(speaker);

      if (block.showSpeakerLabel) {
        const labelSize = Math.round(bodyFontSize * 0.72);
        ctx.fillStyle = resolved.footerColor;
        ctx.font = `600 ${labelSize}px ${fontFamily}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        const labelX =
          dialogueStyle === "bubble" ? pad + AVATAR_SIZE + AVATAR_GAP : pad + ACCENT_BAR_W + ACCENT_PAD_X;
        ctx.fillText(speaker, labelX, y);
        y += block.labelH;
      }

      if (dialogueStyle === "bubble") {
        const rowH = Math.max(AVATAR_SIZE, block.contentH);
        const avatarY = y + (rowH - AVATAR_SIZE) / 2;
        drawCircularAvatar(
          ctx,
          pad,
          avatarY,
          AVATAR_SIZE,
          useAvatarImage ? resolved.avatarImage : null,
          initial,
          tone,
          useAvatarImage ? resolved.avatarFocus : QUOTE_CARD_AVATAR_FOCUS_DEFAULT
        );
        const bubbleX = pad + AVATAR_SIZE + AVATAR_GAP;
        const bubbleY = y + (rowH - block.contentH) / 2;
        roundRectPath(
          ctx,
          bubbleX,
          bubbleY,
          block.contentW,
          block.contentH,
          BUBBLE_RADIUS
        );
        ctx.fillStyle = resolved.bubbleFill;
        ctx.fill();
        ctx.fillStyle = resolved.bubbleTextColor;
        ctx.font = `${bodyFontSize}px ${fontFamily}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        let ty = bubbleY + BUBBLE_PAD_Y;
        for (const line of block.lines) {
          ctx.fillText(line, bubbleX + BUBBLE_PAD_X, ty);
          ty += lineStep;
        }
        y += rowH;
      } else {
        const barH = Math.max(bodyFontSize * 0.9, block.contentH - bodyFontSize * 0.2);
        const barY = y + Math.max(0, (block.contentH - barH) / 2);
        drawAccentBar(
          ctx,
          pad,
          barY,
          barH,
          resolved.accentColor,
          resolved.accentColorEnd
        );
        ctx.fillStyle = resolved.bodyColor;
        ctx.font = `600 ${bodyFontSize}px ${fontFamily}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        let ty = y;
        const textX = pad + ACCENT_BAR_W + ACCENT_PAD_X;
        for (const line of block.lines) {
          ctx.fillText(line, textX, ty);
          ty += lineStep;
        }
        y += block.contentH;
      }
    }
  }

  const footerY = height - pad - resolved.footerFontSize;
  ctx.fillStyle = resolved.footerColor;
  ctx.font = `500 ${resolved.footerFontSize}px ${fontFamily}`;
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
