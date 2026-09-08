import type { NarrationFragmentationMetrics } from "./types";
import {
  countSentences,
  isDialogueParagraph,
  splitParagraphs,
} from "./quotes";

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function computeNarrationFragmentationMetrics(
  text: string
): NarrationFragmentationMetrics {
  const paras = splitParagraphs(text).filter((p) => !isDialogueParagraph(p));
  if (!paras.length) {
    return {
      one_sentence_narration_ratio: 0,
      consecutive_one_sentence_narration_runs: 0,
      max_short_narration_run: 0,
      avg_narration_paragraph_chars: 0,
      median_narration_paragraph_chars: 0,
    };
  }

  const oneSentFlags = paras.map((p) => countSentences(p) <= 1);
  const one_sentence_narration_ratio = Number(
    (oneSentFlags.filter(Boolean).length / paras.length).toFixed(4)
  );

  let consecutive_one_sentence_narration_runs = 0;
  let max_short_narration_run = 0;
  let run = 0;
  for (const flag of oneSentFlags) {
    if (flag) {
      run += 1;
      max_short_narration_run = Math.max(max_short_narration_run, run);
    } else {
      if (run >= 2) consecutive_one_sentence_narration_runs += 1;
      run = 0;
    }
  }
  if (run >= 2) consecutive_one_sentence_narration_runs += 1;

  const chars = paras.map((p) => p.replace(/\s+/g, "").length);
  const avg_narration_paragraph_chars = Number(
    (chars.reduce((a, b) => a + b, 0) / chars.length).toFixed(1)
  );
  const median_narration_paragraph_chars = Number(median(chars).toFixed(1));

  return {
    one_sentence_narration_ratio,
    consecutive_one_sentence_narration_runs,
    max_short_narration_run,
    avg_narration_paragraph_chars,
    median_narration_paragraph_chars,
  };
}
