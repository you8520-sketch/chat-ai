const TAG_RE = /\[태그:\s*([^\]]+)\]\s*$/;
const PARTIAL_TAG_RE = /\[태그:[^\]]*$/;
const ANY_TAG_RE = /\n?\[태그:\s*([^\]]+)\]\s*/g;
const INLINE_TAG_RE = /\[태그:\s*([^\]]+)\]/g;
const STREAM_TAG_PREFIX = "[태그:";

export type EmotionTagPart = { kind: "text"; text: string } | { kind: "tag"; tag: string };

/**
 * Hold back a trailing display-asset marker while it is still arriving.
 *
 * Streaming chunks may split "[태그: 장면명]" into "[", "[태", "[태그", etc.
 * Waiting until the colon arrives is too late because those prefix fragments have
 * already been painted. Once the suffix stops being a possible asset marker it is
 * returned unchanged, so ordinary bracketed prose is only delayed, never deleted.
 */
export function stripTrailingEmotionTagStreamCandidate(text: string): string {
  const trimmed = text.trimEnd();
  const openBracket = trimmed.lastIndexOf("[");
  if (openBracket < 0) return text;

  const suffix = trimmed.slice(openBracket);
  const compact = suffix.replace(/\s+/g, "");
  const isMarkerPrefix =
    compact.length > 0 && STREAM_TAG_PREFIX.startsWith(compact);
  const isPartialOrCompleteMarker =
    compact.startsWith(STREAM_TAG_PREFIX) &&
    (compact.indexOf("]") < 0 || /^\[태그:[^\]]*\]$/.test(compact));

  if (!isMarkerPrefix && !isPartialOrCompleteMarker) return text;
  return trimmed.slice(0, openBracket).trimEnd();
}

/** AI 응답 끝의 [태그: 감정] 파싱 — 표시용 텍스트와 태그 분리 */
export function stripEmotionTag(text: string): { clean: string; tag: string | null } {
  const trimmed = text.trimEnd();
  const match = trimmed.match(TAG_RE);
  if (match) {
    return { clean: trimmed.slice(0, match.index).trimEnd(), tag: match[1].trim() };
  }
  const partial = trimmed.match(PARTIAL_TAG_RE);
  if (partial) {
    return { clean: trimmed.slice(0, partial.index).trimEnd(), tag: null };
  }
  return { clean: trimmed, tag: null };
}

/** 본문 어디에 있든 [태그: …] 줄 제거 (화면 표시용) */
export function stripEmotionTagsForDisplay(
  text: string,
  opts?: { streaming?: boolean }
): string {
  const source = opts?.streaming
    ? stripTrailingEmotionTagStreamCandidate(text)
    : text;
  const { clean, tag } = stripEmotionTag(source);
  if (tag) return clean;
  return source.replace(ANY_TAG_RE, "").trimEnd();
}

export function collectEmotionTags(text: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(INLINE_TAG_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const tag = match[1]?.trim();
    if (tag) tags.push(tag);
  }
  return tags;
}

export function splitProseWithEmotionTags(
  text: string,
  opts?: { streaming?: boolean }
): EmotionTagPart[] {
  const source = opts?.streaming
    ? stripTrailingEmotionTagStreamCandidate(text)
    : text;
  const parts: EmotionTagPart[] = [];
  const re = new RegExp(INLINE_TAG_RE.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    if (match.index > last) {
      parts.push({ kind: "text", text: source.slice(last, match.index) });
    }
    const tag = match[1]?.trim();
    if (tag) parts.push({ kind: "tag", tag });
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    parts.push({ kind: "text", text: source.slice(last) });
  }
  return parts;
}

/** 캐릭터 에셋 목록에 있는 태그만 인정 — 업로드된 태그명과 정확히 일치할 때만 */
export function resolveEmotionTag(tag: string, allowedTags: string[]): string | null {
  const q = tag.trim();
  if (!q || allowedTags.length === 0) return null;
  return allowedTags.includes(q) ? q : null;
}

export function buildEmotionTagPrompt(allowedTags: string[]): string {
  if (allowedTags.length === 0) return "";
  const unique = [...new Set(allowedTags.map((t) => t.trim()).filter(Boolean))];
  const list = unique.join(", ");
  const fallback = unique.includes("대화") ? "대화" : unique[0]!;
  return `[DISPLAY ASSET TAG — UPLOADED IMAGES ONLY]
Each tag names an uploaded character image (expression, pose, or situation — e.g. 부끄러움, 무표정, 키스, 밀착).
Allowed tags ONLY (copy spelling exactly): ${list}
Insert [태그: tagname] in the body at the moment that image should appear. Wide/landscape images render inline in the message at that position. Tall/portrait images update the left portrait (and mobile chat background).
You may use more than one tag. Prefer a portrait tag for expression and landscape tags for scene images.
If you only use one tag, put it at the end: [태그: tagname]
Choose tags whose images match the character's look and what they are doing in this turn (e.g. if they end up lying on a bed and that tag exists, use it).
FORBIDDEN: any tag not in the list — do not invent tags for images that were not uploaded.
If nothing fits perfectly, pick the closest tag from the list, or [태그: ${fallback}]`;
}

/** User-turn overlay — Flash-owned display asset (not main system rules cache). */
export function buildFlashOwnedEmotionTagUserOverlay(allowedTags: string[]): string {
  const core = buildEmotionTagPrompt(allowedTags);
  if (!core.trim()) return "";
  return `[FLASH-OWNED — scene-matched display asset]\n${core}`;
}

/** 저장 전 — 없는 태그는 제거, 허용된 태그만 본문 위치에 유지 */
export function sanitizeEmotionTagInText(text: string, allowedTags: string[]): string {
  if (allowedTags.length === 0) {
    return stripEmotionTagsForDisplay(text);
  }
  const source = text.replace(/\r\n/g, "\n");
  const rewritten = source.replace(ANY_TAG_RE, (full, name: string) => {
    const resolved = resolveEmotionTag(String(name ?? "").trim(), allowedTags);
    if (!resolved) return "";
    return `${full.startsWith("\n") ? "\n" : ""}[태그: ${resolved}]`;
  });
  return rewritten.replace(/\n{3,}/g, "\n\n").trimEnd();
}
