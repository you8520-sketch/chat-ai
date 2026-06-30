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
Each tag names an uploaded character image (expression, pose, or situation — e.g. 부끄러움, 무표정, 침대에 누움, 대화).
Allowed tags ONLY (copy spelling exactly): ${list}
At the very end of your reply, append exactly ONE line: [태그: tagname]
Choose the tag whose image best matches the character's look and what they are doing in the **final moment of this turn** (e.g. if they end up lying on a bed and that tag exists, use it).
FORBIDDEN: any tag not in the list — do not invent tags for images that were not uploaded.
If nothing fits perfectly, pick the closest tag from the list, or [태그: ${fallback}]`;
}

/** User-turn overlay — Flash-owned display asset (not main system rules cache). */
export function buildFlashOwnedEmotionTagUserOverlay(allowedTags: string[]): string {
  const core = buildEmotionTagPrompt(allowedTags);
  if (!core.trim()) return "";
  return `[FLASH-OWNED — scene-matched display asset]\n${core}`;
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
