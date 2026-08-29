/** Phase B.1 experiment-only — not promoted to production parser. */

export type LayoutAbParagraphMetrics = {
  totalParagraphs: number;
  dialogueParagraphs: number;
  narrationParagraphs: number;
  mixedDialogueNarrationParagraphs: number;
  oneSentenceParagraphRatio: number;
  veryShortParagraphRatio: number;
  longParagraphRatio: number;
  consecutiveDialogueParagraphRunMax: number;
  speakerChangeWithoutParagraphBreak: number;
  extremeFragmentationFlag: boolean;
};

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueLine(line: string): boolean {
  const t = line.trim();
  if (/^["“”『』「」]/.test(t)) return true;
  if (/["“”][^"\n]{1,200}["“”]$/.test(t)) return true;
  return /^[가-힣A-Za-z]{1,8}[,:]\s*["“"]/.test(t);
}

function classifyParagraph(p: string): "dialogue" | "narration" | "mixed" {
  const lines = p.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "narration";
  const dialogueLines = lines.filter(isDialogueLine).length;
  if (dialogueLines === 0) return "narration";
  if (dialogueLines === lines.length) return "dialogue";
  return "mixed";
}

function sentenceCount(p: string): number {
  const marks = p.match(/[.!?。！？…]/g);
  return Math.max(1, marks?.length ?? (p.length > 40 ? 2 : 1));
}

/** Count dialogue speaker changes within the same paragraph (blank-line separated paragraphs are OK). */
function countSpeakerChangesWithoutBreak(text: string): number {
  const paragraphs = splitParagraphs(text);
  let violations = 0;
  for (const paragraph of paragraphs) {
    const lines = paragraph.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const prevDialogue = isDialogueLine(lines[i - 1]!);
      const currDialogue = isDialogueLine(lines[i]!);
      if (prevDialogue && currDialogue && lines[i - 1] !== lines[i]) {
        violations++;
      }
    }
  }
  return violations;
}

function maxConsecutiveDialogueRuns(paragraphs: string[]): number {
  let max = 0;
  let run = 0;
  for (const p of paragraphs) {
    if (classifyParagraph(p) === "dialogue") {
      run++;
      max = Math.max(max, run);
    } else {
      run = 0;
    }
  }
  return max;
}

/** Deterministic layout metrics for A/B comparison. */
export function computeLayoutAbParagraphMetrics(text: string): LayoutAbParagraphMetrics {
  const paragraphs = splitParagraphs(text);
  const total = paragraphs.length;
  let dialogue = 0;
  let narration = 0;
  let mixed = 0;
  let oneSentence = 0;
  let veryShort = 0;
  let longPara = 0;

  for (const p of paragraphs) {
    const kind = classifyParagraph(p);
    if (kind === "dialogue") dialogue++;
    else if (kind === "mixed") mixed++;
    else narration++;

    const chars = [...p.replace(/\s/g, "")].length;
    if (chars <= 18) veryShort++;
    if (chars >= 280) longPara++;
    if (sentenceCount(p) <= 1 && kind !== "dialogue") oneSentence++;
  }

  const oneSentenceParagraphRatio = total > 0 ? oneSentence / total : 0;
  const veryShortParagraphRatio = total > 0 ? veryShort / total : 0;
  const longParagraphRatio = total > 0 ? longPara / total : 0;
  const consecutiveDialogueParagraphRunMax = maxConsecutiveDialogueRuns(paragraphs);
  const speakerChangeWithoutParagraphBreak = countSpeakerChangesWithoutBreak(text);
  const extremeFragmentationFlag =
    total >= 8 &&
    (oneSentenceParagraphRatio >= 0.55 || veryShortParagraphRatio >= 0.65);

  return {
    totalParagraphs: total,
    dialogueParagraphs: dialogue,
    narrationParagraphs: narration,
    mixedDialogueNarrationParagraphs: mixed,
    oneSentenceParagraphRatio: Math.round(oneSentenceParagraphRatio * 1000) / 1000,
    veryShortParagraphRatio: Math.round(veryShortParagraphRatio * 1000) / 1000,
    longParagraphRatio: Math.round(longParagraphRatio * 1000) / 1000,
    consecutiveDialogueParagraphRunMax,
    speakerChangeWithoutParagraphBreak,
    extremeFragmentationFlag,
  };
}
