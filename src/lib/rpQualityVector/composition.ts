import type { CompositionMetrics } from "./types";
import {
  extractDialogueSpans,
  isDialogueParagraph,
  splitParagraphs,
} from "./quotes";

export function computeCompositionMetrics(text: string): CompositionMetrics {
  const spans = extractDialogueSpans(text);
  let dialogue_chars = 0;
  for (const s of spans) {
    dialogue_chars += s.content.replace(/\s+/g, "").length;
  }
  // Include quote marks in dialogue char budget (spoken surface).
  for (const s of spans) {
    dialogue_chars += 2; // opening+closing mark
  }

  const totalNoWs = text.replace(/\s+/g, "").length;
  let narration_chars = Math.max(0, totalNoWs - dialogue_chars);
  // Recompute dialogue without double-counting marks against total:
  // Prefer: dialogue = sum of full match lengths (no-ws), narration = remainder.
  dialogue_chars = 0;
  const re = /(?:"[^"\n]{0,2000}"|“[^”\n]{0,2000}”)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    dialogue_chars += m[0].replace(/\s+/g, "").length;
  }
  narration_chars = Math.max(0, totalNoWs - dialogue_chars);

  const paras = splitParagraphs(text);
  const dialogue_paragraph_count = paras.filter(isDialogueParagraph).length;
  const narration_paragraph_count = Math.max(
    0,
    paras.length - dialogue_paragraph_count
  );
  const dialogue_paragraph_share =
    paras.length > 0
      ? Number((dialogue_paragraph_count / paras.length).toFixed(4))
      : 0;

  const dialogue_char_share =
    totalNoWs > 0 ? Number((dialogue_chars / totalNoWs).toFixed(4)) : 0;
  const narration_char_share =
    totalNoWs > 0 ? Number((narration_chars / totalNoWs).toFixed(4)) : 0;

  // Unmatched curly/straight quotes → uncertain
  const openStraight = (text.match(/"/g) ?? []).length;
  const openCurly = (text.match(/“/g) ?? []).length;
  const closeCurly = (text.match(/”/g) ?? []).length;
  const composition_parse_uncertain =
    openStraight % 2 === 1 || openCurly !== closeCurly;

  return {
    dialogue_chars,
    narration_chars,
    dialogue_char_share,
    narration_char_share,
    dialogue_paragraph_count,
    narration_paragraph_count,
    dialogue_paragraph_share,
    composition_parse_uncertain,
    dialogue_heavy_review: dialogue_char_share > 0.35,
    strong_dialogue_dominance: dialogue_char_share > 0.45,
  };
}
