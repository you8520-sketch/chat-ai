export const CHARACTER_TAG_MAX_LEN = 24;
export const CHARACTER_TAG_MAX_COUNT = 12;

export function normalizeCharacterTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").slice(0, CHARACTER_TAG_MAX_LEN);
}

export function parseCharacterTagsInput(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      const t = normalizeCharacterTag(String(item ?? ""));
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= CHARACTER_TAG_MAX_COUNT) break;
    }
    return out;
  }
  const s = String(raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      return parseCharacterTagsInput(JSON.parse(s));
    } catch {
      /* legacy comma string */
    }
  }
  const out: string[] = [];
  for (const part of s.split(/[,，\n]+/)) {
    const t = normalizeCharacterTag(part);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= CHARACTER_TAG_MAX_COUNT) break;
  }
  return out;
}
