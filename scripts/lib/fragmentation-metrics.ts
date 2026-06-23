/**
 * Dialogue fragmentation / padding metrics for RP output analysis.
 */
export type FragmentationMetrics = {
  quote_count: number;
  avg_quote_chars: number;
  micro_quote_ratio: number;
  micro_quote_count: number;
  ping_pong_count: number;
  quotes_ge_6: boolean;
  total_quote_chars: number;
  total_narration_chars: number;
  quote_char_ratio: number;
  narration_paragraph_count: number;
  avg_narration_chars_per_para: number;
  dense_narration_para_ratio: number;
  fragmentation_score: number;
};

const MICRO_QUOTE_MAX_CHARS = 20;
const DENSE_PARA_MIN_SENTENCES = 3;
const DENSE_PARA_MIN_CHARS = 80;

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type Block = { type: "quote" | "narration"; content: string };

/** Walk text in document order — quote vs narration segments. */
export function parseQuoteNarrationBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const trimmed = text.trim();

  while (i < trimmed.length) {
    if (trimmed[i] === '"') {
      const end = trimmed.indexOf('"', i + 1);
      if (end < 0) break;
      blocks.push({ type: "quote", content: trimmed.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    const nextQuote = trimmed.indexOf('"', i);
    const chunk =
      nextQuote < 0 ? trimmed.slice(i) : trimmed.slice(i, nextQuote);
    const narr = chunk.trim();
    if (narr.length > 0) {
      blocks.push({ type: "narration", content: narr });
    }
    i = nextQuote < 0 ? trimmed.length : nextQuote;
  }

  return blocks;
}

function narrationSentenceCount(narr: string): number {
  return splitSentences(narr.replace(/\n+/g, " ")).length;
}

function isThinNarration(narr: string): boolean {
  const s = narrationSentenceCount(narr);
  return s >= 1 && s <= 2;
}

/** Count strict [Quote]→[1–2 sent narr]→[Quote]→[1–2 sent narr] cycles (non-overlapping). */
export function countPingPongCycles(blocks: Block[]): number {
  let count = 0;
  let i = 0;
  while (i <= blocks.length - 4) {
    const a = blocks[i];
    const b = blocks[i + 1];
    const c = blocks[i + 2];
    const d = blocks[i + 3];
    if (
      a.type === "quote" &&
      b.type === "narration" &&
      c.type === "quote" &&
      d.type === "narration" &&
      isThinNarration(b.content) &&
      isThinNarration(d.content)
    ) {
      count++;
      i += 4;
    } else {
      i++;
    }
  }
  return count;
}

export function analyzeFragmentation(text: string): FragmentationMetrics {
  const trimmed = text.trim();
  const blocks = parseQuoteNarrationBlocks(trimmed);

  const quotes = blocks.filter((b) => b.type === "quote");
  const quote_lengths = quotes.map((q) => q.content.trim().length);
  const quote_count = quote_lengths.length;
  const total_quote_chars = quote_lengths.reduce((a, b) => a + b, 0);
  const avg_quote_chars =
    quote_count > 0 ? total_quote_chars / quote_count : 0;

  const micro_quote_count = quote_lengths.filter(
    (l) => l < MICRO_QUOTE_MAX_CHARS
  ).length;
  const micro_quote_ratio =
    quote_count > 0 ? micro_quote_count / quote_count : 0;

  const ping_pong_count = countPingPongCycles(blocks);

  const narration_blocks = blocks.filter((b) => b.type === "narration");
  const total_narration_chars = narration_blocks.reduce(
    (s, b) => s + b.content.replace(/\s+/g, "").length,
    0
  );

  const visible_chars = trimmed.replace(/\s+/g, "").length;
  const quote_char_ratio =
    visible_chars > 0 ? total_quote_chars / visible_chars : 0;

  const paragraphs = trimmed.split(/\n\n+/).filter((p) => p.trim());
  const narration_paragraphs = paragraphs.filter((p) => {
    const withoutQuotes = p.replace(/"[^"]*"/g, "").trim();
    return withoutQuotes.length > 8;
  });
  const narration_paragraph_count = narration_paragraphs.length;

  let dense_para_count = 0;
  let narr_chars_in_paras = 0;
  for (const para of narration_paragraphs) {
    const narrOnly = para.replace(/"[^"]*"/g, "").trim();
    narr_chars_in_paras += narrOnly.replace(/\s+/g, "").length;
    const sents = splitSentences(narrOnly);
    if (
      sents.length >= DENSE_PARA_MIN_SENTENCES &&
      narrOnly.length >= DENSE_PARA_MIN_CHARS
    ) {
      dense_para_count++;
    }
  }

  const dense_narration_para_ratio =
    narration_paragraph_count > 0
      ? dense_para_count / narration_paragraph_count
      : 0;

  const avg_narration_chars_per_para =
    narration_paragraph_count > 0
      ? narr_chars_in_paras / narration_paragraph_count
      : 0;

  // 0–100 composite: higher = more fragmentation padding
  const short_quote_factor = quote_count > 0 ? 1 - Math.min(avg_quote_chars / 50, 1) : 0;
  const quote_volume_factor = Math.min(quote_count / 12, 1);
  const ping_pong_factor =
    visible_chars > 0 ? Math.min((ping_pong_count * 200) / visible_chars, 1) : 0;

  const fragmentation_score = round2(
    (micro_quote_ratio * 35 +
      short_quote_factor * 25 +
      quote_volume_factor * 20 +
      ping_pong_factor * 20) *
      100 /
      100
  );

  return {
    quote_count,
    avg_quote_chars: round2(avg_quote_chars),
    micro_quote_ratio: round2(micro_quote_ratio),
    micro_quote_count,
    ping_pong_count,
    quotes_ge_6: quote_count >= 6,
    total_quote_chars,
    total_narration_chars,
    quote_char_ratio: round2(quote_char_ratio),
    narration_paragraph_count,
    avg_narration_chars_per_para: round2(avg_narration_chars_per_para),
    dense_narration_para_ratio: round2(dense_narration_para_ratio),
    fragmentation_score,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
