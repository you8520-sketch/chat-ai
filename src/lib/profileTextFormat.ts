/** 공개 소개 본문 인라인 서식 — `[color:emerald]…[/color]`, `[size:lg]…[/size]`, `**…**` */

export const PROFILE_TEXT_COLORS = {
  emerald: "#6ee7b7",
  violet: "#c4b5fd",
  cyan: "#67e8f9",
  rose: "#fda4af",
  amber: "#fcd34d",
  white: "#f3f4f6",
} as const;

export const PROFILE_TEXT_COLOR_CLASS = {
  emerald: "text-emerald-300",
  violet: "text-violet-300",
  cyan: "text-cyan-300",
  rose: "text-rose-300",
  amber: "text-amber-300",
  white: "text-gray-100",
} as const;

export type ProfileTextColor = keyof typeof PROFILE_TEXT_COLORS;

export const PROFILE_TEXT_SIZES = {
  sm: "text-sm leading-relaxed",
  md: "text-[15px] leading-relaxed",
  lg: "text-lg leading-relaxed",
  xl: "text-xl leading-relaxed",
  "2xl": "text-2xl leading-relaxed",
  "3xl": "text-3xl leading-snug font-semibold",
} as const;

export type ProfileTextSize = keyof typeof PROFILE_TEXT_SIZES;

export const PROFILE_SIZE_LADDER: ProfileTextSize[] = ["sm", "md", "lg", "xl", "2xl", "3xl"];

const SIZE_NAMES = "3xl|2xl|xl|lg|md|sm";

const INLINE_TOKEN_RE = new RegExp(
  `\\*\\*(.+?)\\*\\*|\\[color:(emerald|violet|cyan|rose|amber|white)\\]([\\s\\S]*?)\\[/color\\]|\\[size:\\s*(${SIZE_NAMES})\\s*\\]([\\s\\S]*?)\\[/size\\s*\\]`,
  "gi"
);

export const PROFILE_TEXT_SIZE_PX: Record<ProfileTextSize, string> = {
  sm: "0.875rem",
  md: "0.9375rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
};

/** 줄바꿈·공백으로 깨진 [size]/[color] 태그 복구 */
export function repairProfileInlineFormatMarkup(text: string): string {
  let t = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < 5; i++) {
    const prev = t;
    t = t.replace(
      new RegExp(`\\[size:\\s*(?:\\n+\\s*)?(${SIZE_NAMES})\\s*\\]`, "gi"),
      "[size:$1]"
    );
    t = t.replace(
      /\[color:\s*(?:\n+\s*)?(emerald|violet|cyan|rose|amber|white)\s*\]/gi,
      "[color:$1]"
    );
    t = t.replace(/\[\s*\n+\s*\/size\s*\]/gi, "[/size]");
    t = t.replace(/\[\s*\n+\s*\/color\s*\]/gi, "[/color]");
    t = t.replace(new RegExp(`\\[size:\\s+(${SIZE_NAMES})\\s*\\]`, "gi"), "[size:$1]");
    if (t === prev) break;
  }

  // [size:3xl] … [/size] 사이 불필요 줄바꿈(짧은 구간만)
  t = t.replace(
    new RegExp(`(\\[size:(${SIZE_NAMES})\\])([^\\[]{0,120}?)(\\[/size\\])`, "gi"),
    (_, open, _size, body, close) => `${open}${body.replace(/\s*\n+\s*/g, "")}${close}`
  );

  return t;
}

/** 모든 [size] 래퍼 제거 — 순수 텍스트만 */
export function stripProfileSizeTags(text: string): string {
  let out = repairProfileInlineFormatMarkup(text);
  let prev = "";
  const stripRe = new RegExp(`\\[size:\\s*(${SIZE_NAMES})\\s*\\]([\\s\\S]*?)\\[/size\\s*\\]`, "gi");
  while (out !== prev) {
    prev = out;
    out = out.replace(stripRe, "$2");
  }
  return out;
}

/** 중첩 [size:lg]…[/size] 깊이 + 바깥 단계 → 실제 표시 크기 */
export function effectiveProfileSize(text: string): ProfileTextSize {
  let t = text.trim();
  let depth = 0;
  let outer: ProfileTextSize = "md";
  let m: RegExpMatchArray | null;

  while ((m = t.match(new RegExp(`^\\[size:\\s*(${SIZE_NAMES})\\s*\\]([\\s\\S]*)\\[/size\\s*\\]$`)))) {
    depth += 1;
    outer = m[1] as ProfileTextSize;
    t = m[2].trim();
  }

  if (depth === 0) return "md";

  const baseIdx = Math.max(0, PROFILE_SIZE_LADDER.indexOf(outer));
  const idx = Math.min(PROFILE_SIZE_LADDER.length - 1, baseIdx + (depth - 1));
  return PROFILE_SIZE_LADDER[idx] ?? "md";
}

export function profileSizeWrap(text: string, size: ProfileTextSize): string {
  if (size === "md") return text;
  return `[size:${size}]${text}[/size]`;
}

export function profileSizeIncrease(text: string): string {
  const repaired = repairProfileInlineFormatMarkup(text);
  const core = stripProfileSizeTags(repaired).trim() || "텍스트";
  const current = effectiveProfileSize(repaired.trim());
  const idx = PROFILE_SIZE_LADDER.indexOf(current);
  const next = PROFILE_SIZE_LADDER[Math.min(PROFILE_SIZE_LADDER.length - 1, idx + 1)];
  if (next === "md") return core;
  return profileSizeWrap(core, next);
}

export function profileSizeDecrease(text: string): string {
  const repaired = repairProfileInlineFormatMarkup(text);
  const core = stripProfileSizeTags(repaired).trim() || "텍스트";
  const current = effectiveProfileSize(repaired.trim());
  const idx = PROFILE_SIZE_LADDER.indexOf(current);
  const next = PROFILE_SIZE_LADDER[Math.max(0, idx - 1)];
  if (next === "md") return core;
  return profileSizeWrap(core, next);
}

export type ProfileInlineSegment =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "color"; color: ProfileTextColor; value: string }
  | { type: "size"; size: ProfileTextSize; value: string };

export function parseProfileInlineSegments(text: string): ProfileInlineSegment[] {
  const source = repairProfileInlineFormatMarkup(text);
  const segments: ProfileInlineSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_TOKEN_RE.source, "gi");

  while ((m = re.exec(source)) !== null) {
    const idx = m.index;
    if (idx > last) {
      segments.push({ type: "text", value: source.slice(last, idx) });
    }
    if (m[4] !== undefined && m[5] !== undefined) {
      segments.push({
        type: "size",
        size: m[4].toLowerCase() as ProfileTextSize,
        value: m[5],
      });
    } else if (m[2] !== undefined && m[3] !== undefined) {
      segments.push({
        type: "color",
        color: m[2] as ProfileTextColor,
        value: m[3],
      });
    } else if (m[1] !== undefined) {
      segments.push({ type: "bold", value: m[1] });
    }
    last = idx + m[0].length;
  }

  if (last < source.length) {
    segments.push({ type: "text", value: source.slice(last) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: source }];
}

export function profileBoldWrap(text: string): string {
  return `**${text}**`;
}

export function profileColorWrap(text: string, color: ProfileTextColor): string {
  return `[color:${color}]${text}[/color]`;
}

export function wrapTextareaSelection(
  textarea: HTMLTextAreaElement | null,
  current: string,
  onChange: (next: string) => void,
  wrap: (selected: string) => string,
  placeholder = "텍스트"
): void {
  if (!textarea) {
    onChange(current + wrap(placeholder));
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = current.slice(start, end);
  const inner = selected || placeholder;
  const wrapped = wrap(inner);
  const next = current.slice(0, start) + wrapped + current.slice(end);
  onChange(next);

  requestAnimationFrame(() => {
    textarea.focus();
    if (!selected) {
      const markerStart = wrapped.indexOf(inner);
      const pos = start + markerStart;
      textarea.setSelectionRange(pos, pos + inner.length);
    } else {
      textarea.setSelectionRange(start, start + wrapped.length);
    }
  });
}
