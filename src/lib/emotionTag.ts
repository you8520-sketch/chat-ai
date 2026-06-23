const TAG_RE = /\[태그:\s*([^\]]+)\]\s*$/;
const PARTIAL_TAG_RE = /\[태그:[^\]]*$/;
const ANY_TAG_RE = /\n?\[태그:\s*[^\]]+\]\s*/g;

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
export function stripEmotionTagsForDisplay(text: string): string {
  const { clean, tag } = stripEmotionTag(text);
  if (tag) return clean;
  return text.replace(ANY_TAG_RE, "").trimEnd();
}

/** 캐릭터 에셋 목록에 있는 태그만 인정 */
export function resolveEmotionTag(tag: string, allowedTags: string[]): string | null {
  const q = tag.trim();
  if (!q || allowedTags.length === 0) return null;
  if (allowedTags.includes(q)) return q;
  const partial = allowedTags.find((a) => a.includes(q) || q.includes(a));
  return partial ?? null;
}

export function buildEmotionTagPrompt(allowedTags: string[]): string {
  if (allowedTags.length === 0) return "";
  const list = allowedTags.join(", ");
  const fallback = allowedTags.includes("대화") ? "대화" : allowedTags[0];
  return `[EMOTION ASSET TAG]
Allowed tags ONLY: ${list}
Append ONE line at end: [태그: tagname]
NO invented tags. Default if unsure: [태그: ${fallback}]`;
}

/** 저장 전 — 없는 태그는 제거, 비슷한 태그만 유지 */
export function sanitizeEmotionTagInText(text: string, allowedTags: string[]): string {
  if (allowedTags.length === 0) {
    return stripEmotionTagsForDisplay(text);
  }
  const { clean, tag } = stripEmotionTag(text);
  if (!tag) return stripEmotionTagsForDisplay(text);
  const resolved = resolveEmotionTag(tag, allowedTags);
  if (!resolved) return clean;
  return `${clean}\n[태그: ${resolved}]`;
}
