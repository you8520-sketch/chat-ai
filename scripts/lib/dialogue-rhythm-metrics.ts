/** Dialogue rhythm metrics for responsibility audit (read-only). */

export type DialogueRhythmMetrics = {
  dialogueQuoteCount: number;
  meanDialogueQuoteChars: number;
  dialogueCharShare: number;
  alternationScore: number;
  maxConsecutiveNarrationBlocks: number;
  maxConsecutiveDialogueBlocks: number;
  narrationWall: boolean;
  /** Speech in narration without "…" (말했다/외쳤 + 『』 or inline) */
  inlineDialogueWithoutQuotes: number;
  /** Avg narration paragraphs between consecutive " dialogue blocks */
  meanNarrationGapBetweenDialogue: number;
  /** Lines ending with ? in quotes vs total quotes */
  questionDialogueShare: number;
  /** Narration paragraphs after a quoted question before next quote */
  meanResponseGapAfterQuestion: number;
};

function stripArtifacts(text: string): string {
  const i = text.search(/<<<STATUS/i);
  const body = i >= 0 ? text.slice(0, i) : text;
  return body.replace(/\[태그:[^\]]+\]/g, "").trim();
}

export function splitParagraphs(text: string): string[] {
  return stripArtifacts(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function isDialogueParagraph(p: string): boolean {
  const t = p.trim();
  if (/^["「『]/.test(t)) return true;
  const quotes = t.match(/"[^"]+"/g) ?? [];
  const quoteChars = quotes.join("").length;
  return quoteChars > 0 && quoteChars / t.length >= 0.45;
}

function maxConsecutiveRun(blocks: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const b of blocks) {
    if (b) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}

function alternationScore(isDialogue: boolean[]): number {
  if (isDialogue.length < 2) return isDialogue.length === 0 ? 0 : 1;
  let switches = 0;
  for (let i = 1; i < isDialogue.length; i++) {
    if (isDialogue[i] !== isDialogue[i - 1]) switches++;
  }
  return switches / (isDialogue.length - 1);
}

function countInlineDialogueWithoutQuotes(text: string): number {
  const body = stripArtifacts(text);
  let n = 0;
  const patterns = [
    /[''「『][^''」』\n]{1,80}[''」』][^.?\n]{0,20}(?:말했다|외쳤|무뚝|중얼|속삭|되물|되풀이)/g,
    /(?:말했다|외쳤|대답했다|중얼거렸|속삭였)[^.?\n]{0,30}[''「『][^''」』\n]{1,80}/g,
    /[^"]\s[''][가-힣][^''\n]{2,40}['']/g,
  ];
  for (const re of patterns) {
    n += body.match(re)?.length ?? 0;
  }
  return n;
}

function meanNarrationGapBetweenDialogue(isDialogue: boolean[]): number {
  const gaps: number[] = [];
  let sinceLast = 0;
  let seenDialogue = false;
  for (const d of isDialogue) {
    if (d) {
      if (seenDialogue) gaps.push(sinceLast);
      seenDialogue = true;
      sinceLast = 0;
    } else sinceLast++;
  }
  if (gaps.length === 0) return isDialogue.filter(Boolean).length === 0 ? isDialogue.length : 0;
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

function questionMetrics(paragraphs: string[]): {
  questionDialogueShare: number;
  meanResponseGapAfterQuestion: number;
} {
  const quotes = paragraphs.flatMap((p) => p.match(/"[^"]+"/g) ?? []);
  const qQuotes = quotes.filter((q) => /\?/.test(q) || /…\?/.test(q));
  const questionDialogueShare = quotes.length > 0 ? qQuotes.length / quotes.length : 0;

  const gaps: number[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const qs = paragraphs[i]?.match(/"[^"]+\?[^"]*"/g);
    if (!qs?.length) continue;
    let gap = 0;
    for (let j = i + 1; j < paragraphs.length; j++) {
      if (isDialogueParagraph(paragraphs[j]!)) {
        gaps.push(gap);
        break;
      }
      gap++;
    }
  }
  const meanResponseGapAfterQuestion =
    gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  return { questionDialogueShare, meanResponseGapAfterQuestion };
}

export function analyzeDialogueRhythm(text: string): DialogueRhythmMetrics {
  const paragraphs = splitParagraphs(text);
  const isDlg = paragraphs.map(isDialogueParagraph);
  const body = stripArtifacts(text);
  const quotes = body.match(/"[^"]+"/g) ?? [];
  const quoteChars = quotes.join("").length;

  const qm = questionMetrics(paragraphs);

  return {
    dialogueQuoteCount: quotes.length,
    meanDialogueQuoteChars:
      quotes.length > 0
        ? quotes.reduce((s, q) => s + q.length, 0) / quotes.length
        : 0,
    dialogueCharShare: body.length > 0 ? quoteChars / body.length : 0,
    alternationScore: alternationScore(isDlg),
    maxConsecutiveNarrationBlocks: maxConsecutiveRun(isDlg.map((d) => !d)),
    maxConsecutiveDialogueBlocks: maxConsecutiveRun(isDlg),
    narrationWall:
      maxConsecutiveRun(isDlg.map((d) => !d)) >= 6 ||
      (quotes.length === 0 && paragraphs.length >= 4),
    inlineDialogueWithoutQuotes: countInlineDialogueWithoutQuotes(text),
    meanNarrationGapBetweenDialogue: meanNarrationGapBetweenDialogue(isDlg),
    questionDialogueShare: qm.questionDialogueShare,
    meanResponseGapAfterQuestion: qm.meanResponseGapAfterQuestion,
  };
}

export function dialogueRhythmScore(m: DialogueRhythmMetrics): number {
  let s = 6 + m.alternationScore * 3;
  s -= Math.min(3, Math.max(0, m.maxConsecutiveNarrationBlocks - 4) * 0.6);
  s -= Math.min(2, m.meanNarrationGapBetweenDialogue * 0.4);
  s -= Math.min(2, m.inlineDialogueWithoutQuotes * 0.5);
  if (m.narrationWall) s -= 2;
  if (m.dialogueQuoteCount === 0 && m.maxConsecutiveNarrationBlocks >= 3) s -= 2;
  if (m.meanResponseGapAfterQuestion > 3) s -= 1;
  return Math.round(Math.max(0, Math.min(10, s)) * 10) / 10;
}
