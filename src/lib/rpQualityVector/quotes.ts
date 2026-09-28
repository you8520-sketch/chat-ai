/**
 * Production-aligned spoken dialogue quotes only: "..." and “...”.
 * 「」/『』 are special labels in product UI — NOT counted as dialogue here.
 */

export const DIALOGUE_QUOTE_RE =
  /"([^"\n]{0,2000})"|“([^”\n]{0,2000})”/g;

export const DIALOGUE_PAIR_RE = /(?:"[^"\n]{0,2000}"|“[^”\n]{0,2000}”)/g;

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function extractDialogueSpans(
  text: string
): Array<{ start: number; end: number; content: string }> {
  const spans: Array<{ start: number; end: number; content: string }> = [];
  const re = new RegExp(DIALOGUE_PAIR_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const inner = raw.replace(/^["“]/, "").replace(/["”]$/, "").trim();
    spans.push({
      start: m.index,
      end: m.index + raw.length,
      content: inner,
    });
  }
  return spans;
}

export function isDialogueParagraph(p: string): boolean {
  const t = p.trim();
  if (!t) return false;
  // Entire paragraph is one or more dialogue quotes (optional whitespace).
  const stripped = t.replace(DIALOGUE_PAIR_RE, "").replace(/\s+/g, "");
  if (stripped.length === 0 && DIALOGUE_PAIR_RE.test(t)) return true;
  // Majority quote paragraph: quote chars dominate
  const spans = extractDialogueSpans(t);
  if (!spans.length) return false;
  const quoteChars = spans.reduce((s, x) => s + x.content.replace(/\s+/g, "").length, 0);
  const total = t.replace(/\s+/g, "").length;
  return total > 0 && quoteChars / total >= 0.7;
}

export function countSentences(text: string): number {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return 0;
  const parts = t.split(/(?<=[.!?…。！？])\s+/).filter((s) => s.trim());
  return Math.max(1, parts.length);
}
