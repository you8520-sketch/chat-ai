/**
 * Harness-only dialogue block extraction for Luna gate re-evaluation.
 * Not used in production runtime or generation prompts.
 */
import { groupNovelParagraphs } from "../../src/lib/novelParagraphs";

export type HarnessDialogueBlock = {
  text: string;
  visible: number;
  paragraphIndex: number;
};

const INLINE_NARRATED_QUOTE_AFTER_RE =
  /^(?:이)?(?:라고(?:요|만|서|도)?|라며|라는|라던|하고|하며|고\s+말|고\s+(?:외치|속삭|중얼|답|대답|응|설명|묻|되물)|란|처럼|같은|라서|이라서|라니|이라니|라자|이라자)/;

type QuotePair = { open: string; close: string };

const QUOTE_PAIRS: QuotePair[] = [
  { open: '"', close: '"' },
  { open: "\u201C", close: "\u201D" },
  { open: "「", close: "」" },
  { open: "『", close: "』" },
];

function matchingPair(open: string): QuotePair | null {
  return QUOTE_PAIRS.find((p) => p.open === open) ?? null;
}

function isInlineNarratedQuote(content: string, quoteEnd: number): boolean {
  const after = content.slice(quoteEnd).replace(/^\s+/, "");
  if (INLINE_NARRATED_QUOTE_AFTER_RE.test(after)) return true;
  const afterBreak = content.slice(quoteEnd).replace(/^\s*(?:\n+\s*)+/, "");
  return INLINE_NARRATED_QUOTE_AFTER_RE.test(afterBreak);
}

function readQuotedSpan(content: string, start: number, pair: QuotePair): number {
  let j = start + pair.open.length;
  while (j < content.length) {
    if (content.startsWith(pair.close, j)) return j + pair.close.length;
    j += 1;
  }
  return content.length;
}

function visibleQuotedLength(quoted: string): number {
  for (const pair of QUOTE_PAIRS) {
    if (quoted.startsWith(pair.open) && quoted.endsWith(pair.close)) {
      return quoted.slice(pair.open.length, quoted.length - pair.close.length).length;
    }
  }
  return quoted.length;
}

function isPureQuoteParagraph(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const pair of QUOTE_PAIRS) {
    if (!trimmed.startsWith(pair.open)) continue;
    const end = readQuotedSpan(trimmed, 0, pair);
    const span = trimmed.slice(0, end);
    if (span === trimmed) return true;
  }
  return false;
}

/** Extract standalone quoted speech blocks from a paragraph (may be >1 when mixed). */
function extractQuoteBlocksFromParagraph(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (isPureQuoteParagraph(trimmed)) return [trimmed];

  const blocks: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i]!;
    const pair = matchingPair(ch);
    if (!pair) {
      i += 1;
      continue;
    }
    const start = i;
    const end = readQuotedSpan(trimmed, start, pair);
    if (end <= start + pair.open.length) {
      i += 1;
      continue;
    }
    if (!isInlineNarratedQuote(trimmed, end)) {
      const before = trimmed.slice(0, start).trim();
      const quoted = trimmed.slice(start, end).trim();
      // Standalone when quote starts paragraph or only whitespace before on same line
      const lineStart = trimmed.lastIndexOf("\n", start) + 1;
      const prefixOnLine = trimmed.slice(lineStart, start).trim();
      if (!prefixOnLine || before.length === 0) {
        blocks.push(quoted);
      }
    }
    i = end;
  }
  return blocks;
}

export function extractHarnessDialogueBlocks(prose: string): HarnessDialogueBlock[] {
  const paragraphs = groupNovelParagraphs(prose);
  const blocks: HarnessDialogueBlock[] = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi]!.trim();
    if (!p) continue;
    const extracted = extractQuoteBlocksFromParagraph(p);
    for (const text of extracted) {
      blocks.push({
        text,
        visible: visibleQuotedLength(text),
        paragraphIndex: pi,
      });
    }
  }

  return blocks;
}

export function countHarnessDialogueBlocks(prose: string): number {
  return extractHarnessDialogueBlocks(prose).length;
}
