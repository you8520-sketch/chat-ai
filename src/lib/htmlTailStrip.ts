/** HTML tail strip — client/server safe (no DB or AI imports) */

const HTML_TAIL_HINT_RE = /(<[a-zA-Z]|style=|```html|<\/|<div|<span)/i;
const MIN_PROSE_KEEP_CHARS = 80;

function findUnclosedHtmlFenceStart(text: string): number {
  const firstIdx = text.indexOf("```html");
  if (firstIdx < 0) return -1;

  const innerFromFirst = text.slice(firstIdx).replace(/^```html\s*/i, "").trim();
  if (/^```html/i.test(innerFromFirst)) {
    return firstIdx;
  }

  const idx = text.lastIndexOf("```html");
  if (idx < 0) return -1;
  const tail = text.slice(idx);
  if (/^```html[\s\S]*```\s*$/.test(tail)) return -1;
  return idx;
}

/** 끊긴 HTML tail만 제거 — 첫 ```html 또는 끝 미닫힌 태그부터 잘라 RP만 보존 */
export function stripBrokenHtmlTailSafely(text: string): { text: string; stripped: boolean } {
  const trimmedLen = text.trimEnd().length;
  const suffix = text.slice(trimmedLen);
  const core = text.trimEnd();
  if (!core || !HTML_TAIL_HINT_RE.test(core.slice(-100))) {
    return { text, stripped: false };
  }

  const unclosedFence = findUnclosedHtmlFenceStart(core) >= 0;
  const unclosedTag = /<[a-zA-Z][^>\n]*$/.test(core);
  if (!unclosedFence && !unclosedTag) {
    return { text, stripped: false };
  }

  const firstFence = core.indexOf("```html");
  if (firstFence >= 0) {
    const before = core.slice(0, firstFence).trimEnd();
    if (before.length >= MIN_PROSE_KEEP_CHARS) {
      return { text: before + suffix, stripped: true };
    }
  }

  const tagMatch = /<[a-zA-Z][^>\n]*$/.exec(core);
  if (tagMatch?.index != null && tagMatch.index >= 0) {
    const before = core.slice(0, tagMatch.index).trimEnd();
    if (before.length >= MIN_PROSE_KEEP_CHARS) {
      return { text: before + suffix, stripped: true };
    }
  }

  return { text, stripped: false };
}

export function stripBrokenHtmlFragmentAtEnd(text: string): { text: string; stripped: boolean } {
  const result = stripBrokenHtmlTailSafely(text);
  console.log(`[html-clamp] stripped broken fragment: ${result.stripped}`);
  return result;
}
