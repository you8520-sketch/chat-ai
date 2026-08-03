/**
 * Dialogue fragmentation metrics for RP diagnostic canary.
 * Auto metrics are heuristic; manual review overrides in harness artifacts.
 */

export type DialogueMetricsInput = {
  text: string;
  primaryCharacterName?: string;
};

export type DialogueMetrics = {
  canonical_length_ws: number;
  canonical_length_no_ws: number;
  paragraph_count: number;
  quote_pair_count: number;
  dialogue_paragraph_count: number;
  narration_chars: number;
  dialogue_chars: number;
  narration_ratio_pct: number;
  quote_blocks: string[];
  semantic_utterance_units_auto: number;
  fragmentation_multiplier_auto: number;
  resume_transitions_auto: number;
  quote_blocks_per_1000_chars: number;
  resume_transitions_per_1000_chars: number;
  content_hash: string;
  content_hash_no_newlines: string;
};

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export function extractQuoteBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /"([^"\n]{1,1200})"|“([^”\n]{1,1200})”/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const q = (m[1] ?? m[2] ?? "").trim();
    if (q) blocks.push(q);
  }
  return blocks;
}

/** Heuristic semantic units: quote-only islands separated by narration = candidate units. */
export function estimateSemanticUtteranceUnits(text: string): {
  units: number;
  resumeTransitions: number;
} {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let quoteIslands = 0;
  let inQuoteRun = false;
  let resumeTransitions = 0;
  let prevWasQuoteIsland = false;

  for (const p of paras) {
    const quoteOnly = /^[“"][^”"\n]+[”"]$/.test(p);
    if (quoteOnly) {
      if (!inQuoteRun) {
        quoteIslands += 1;
        if (prevWasQuoteIsland === false && quoteIslands > 1) {
          // narration between quote blocks from same flow — counted as resume below
        }
        inQuoteRun = true;
      }
    } else {
      if (inQuoteRun) {
        resumeTransitions += 1;
      }
      inQuoteRun = false;
    }
    prevWasQuoteIsland = quoteOnly;
  }

  const units = Math.max(1, quoteIslands);
  return { units, resumeTransitions: Math.max(0, quoteIslands - 1) };
}

export function computeDialogueMetrics(input: DialogueMetricsInput): DialogueMetrics {
  const text = input.text ?? "";
  const quote_blocks = extractQuoteBlocks(text);
  const dialogue_chars = quote_blocks.reduce((a, b) => a + b.length, 0);
  const canonical_length_ws = text.length;
  const canonical_length_no_ws = text.replace(/\s/g, "").length;
  const narration_chars = Math.max(0, canonical_length_ws - dialogue_chars);
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const { units, resumeTransitions } = estimateSemanticUtteranceUnits(text);
  const semantic_utterance_units_auto = units;
  const fragmentation_multiplier_auto =
    semantic_utterance_units_auto > 0
      ? Math.round((quote_blocks.length / semantic_utterance_units_auto) * 100) / 100
      : 0;

  return {
    canonical_length_ws,
    canonical_length_no_ws,
    paragraph_count: paras.length,
    quote_pair_count: quote_blocks.length,
    dialogue_paragraph_count: paras.filter((p) => /[“"]/.test(p)).length,
    narration_chars,
    dialogue_chars,
    narration_ratio_pct:
      canonical_length_ws > 0
        ? Math.round((narration_chars / canonical_length_ws) * 1000) / 10
        : 0,
    quote_blocks,
    semantic_utterance_units_auto,
    fragmentation_multiplier_auto,
    resume_transitions_auto: resumeTransitions,
    quote_blocks_per_1000_chars:
      canonical_length_ws > 0
        ? Math.round((quote_blocks.length / canonical_length_ws) * 100000) / 100
        : 0,
    resume_transitions_per_1000_chars:
      canonical_length_ws > 0
        ? Math.round((resumeTransitions / canonical_length_ws) * 100000) / 100
        : 0,
    content_hash: hashString(text),
    content_hash_no_newlines: hashString(text.replace(/[\r\n\u00a0]+/g, " ")),
  };
}

export function diffPipelineMetrics(
  before: DialogueMetrics,
  after: DialogueMetrics
): Record<string, number> {
  return {
    quote_pair_delta: after.quote_pair_count - before.quote_pair_count,
    dialogue_paragraph_delta: after.dialogue_paragraph_count - before.dialogue_paragraph_count,
    resume_transitions_delta: after.resume_transitions_auto - before.resume_transitions_auto,
    fragmentation_multiplier_delta:
      after.fragmentation_multiplier_auto - before.fragmentation_multiplier_auto,
  };
}
