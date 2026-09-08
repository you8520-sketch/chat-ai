import type { DialogueFragmentationMetrics } from "./types";
import {
  countSentences,
  extractDialogueSpans,
  isDialogueParagraph,
  splitParagraphs,
} from "./quotes";

type ParaKind = "dialogue" | "narration";

type Para = {
  kind: ParaKind;
  text: string;
  /** Heuristic speaker label; null = unknown. */
  speaker: string | null;
};

/**
 * Heuristic speaker inference:
 * - Attribution in preceding narration ("에녹이 말했다", "…속삭였다")
 * - Leading bare name before quote in same paragraph
 * Does NOT claim certainty — sets speaker_split_review_required when ambiguous.
 */
function inferSpeaker(prevNarr: string | null, dialoguePara: string): string | null {
  const combined = `${prevNarr ?? ""} ${dialoguePara}`;
  const attr =
    /([가-힣A-Za-z]{2,12})(?:은|는|이|가)?\s*(?:말했|속삭였|외쳤|답했|물었|중얼|투덜|한숨|혀를 찼|고개를)/.exec(
      combined
    );
  if (attr?.[1]) return attr[1];
  const lead = /^([가-힣A-Za-z]{2,12})\s*[:：]/.exec(dialoguePara.trim());
  if (lead?.[1]) return lead[1];
  return null;
}

function isShortDialoguePara(p: string): boolean {
  const spans = extractDialogueSpans(p);
  if (!spans.length) return false;
  const inner = spans.map((s) => s.content).join("");
  const noWs = inner.replace(/\s+/g, "").length;
  return noWs > 0 && noWs <= 18 && countSentences(inner) <= 1;
}

export function computeDialogueFragmentationMetrics(
  text: string
): DialogueFragmentationMetrics {
  const rawParas = splitParagraphs(text);
  const paras: Para[] = [];
  let prevNarr: string | null = null;
  let unknownDialogue = 0;

  for (const p of rawParas) {
    if (isDialogueParagraph(p)) {
      const speaker = inferSpeaker(prevNarr, p);
      if (!speaker) unknownDialogue += 1;
      paras.push({ kind: "dialogue", text: p, speaker });
    } else {
      paras.push({ kind: "narration", text: p, speaker: null });
      prevNarr = p;
    }
  }

  const dialogueParas = paras.filter((p) => p.kind === "dialogue");
  const dialogue_paragraph_count = dialogueParas.length;

  // Speaker runs: consecutive dialogue paras with same non-null speaker,
  // allowing single short narration insertions between them.
  let speaker_run_count = 0;
  let same_speaker_dialogue_fragments = 0;
  let narration_insertions_between_same_speaker_dialogue = 0;
  let single_sentence_dialogue_paragraphs = 0;
  let max_consecutive_short_dialogue_run = 0;
  let shortRun = 0;

  let i = 0;
  while (i < paras.length) {
    if (paras[i]!.kind !== "dialogue") {
      shortRun = 0;
      i += 1;
      continue;
    }
    const runSpeaker = paras[i]!.speaker;
    let fragInRun = 0;
    let narrInserts = 0;
    let j = i;
    while (j < paras.length) {
      const cur = paras[j]!;
      if (cur.kind === "dialogue") {
        if (runSpeaker != null && cur.speaker != null && cur.speaker !== runSpeaker) {
          break;
        }
        if (runSpeaker == null && cur.speaker != null && fragInRun > 0) {
          // unknown → named: treat as potential new run
          break;
        }
        fragInRun += 1;
        const spans = extractDialogueSpans(cur.text);
        const inner = spans.map((s) => s.content).join(" ");
        if (countSentences(inner) <= 1) single_sentence_dialogue_paragraphs += 1;
        if (isShortDialoguePara(cur.text)) {
          shortRun += 1;
          max_consecutive_short_dialogue_run = Math.max(
            max_consecutive_short_dialogue_run,
            shortRun
          );
        } else {
          shortRun = 0;
        }
        j += 1;
        continue;
      }
      // narration between dialogue
      const next = paras[j + 1];
      const narrChars = cur.text.replace(/\s+/g, "").length;
      if (
        next?.kind === "dialogue" &&
        narrChars <= 80 &&
        (runSpeaker == null ||
          next.speaker == null ||
          next.speaker === runSpeaker)
      ) {
        narrInserts += 1;
        j += 1;
        continue;
      }
      break;
    }
    if (fragInRun > 0) {
      speaker_run_count += 1;
      if (fragInRun >= 2) {
        same_speaker_dialogue_fragments += fragInRun;
        narration_insertions_between_same_speaker_dialogue += narrInserts;
      }
    }
    i = Math.max(i + 1, j);
  }

  const same_speaker_fragment_ratio =
    dialogue_paragraph_count > 0
      ? Number(
          (same_speaker_dialogue_fragments / dialogue_paragraph_count).toFixed(4)
        )
      : 0;

  const speaker_split_review_required =
    unknownDialogue >= 2 ||
    (same_speaker_dialogue_fragments >= 3 &&
      narration_insertions_between_same_speaker_dialogue >= 2) ||
    max_consecutive_short_dialogue_run >= 3;

  return {
    dialogue_paragraph_count,
    speaker_run_count,
    same_speaker_dialogue_fragments,
    same_speaker_fragment_ratio,
    narration_insertions_between_same_speaker_dialogue,
    single_sentence_dialogue_paragraphs,
    max_consecutive_short_dialogue_run,
    speaker_split_review_required,
  };
}
