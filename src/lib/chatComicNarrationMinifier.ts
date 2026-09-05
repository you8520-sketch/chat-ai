/**
 * COMIC NARRATION MINIFICATION OWNER.
 *
 * Narration is a short, time-ordered key-event summary — never pasted prose.
 * Rules:
 * - max 1 narration per panel, max 2 narrations per 4-panel page
 * - max 1 sentence per narration; recommended 8–32 chars, hard max 40
 * - no sensory description / metaphor / decorative style / repeated emotion
 * - only action results, scene transitions, time flow, and key emotion changes
 * - narration is omitted when dialogue already carries the beat (dialogue-first)
 */

export const COMIC_NARRATION_STYLE = "minimal_timeline_summary" as const;
export const COMIC_NARRATION_MAX_CHARS = 40;
export const COMIC_NARRATION_RECOMMENDED_MIN_CHARS = 8;
export const COMIC_PAGE_MAX_NARRATIONS = 2;

const SENTENCE_END = /[.!?…。！？]/u;
const TRAILING_JUNK = /[\s,，。.;;：:\-—]+$/u;
const DIALOGUE_QUOTES = /[“”"「」『』]/gu;
const NARRATION_LEAD_IN = /^(?:그(?:는|가|녀는|녀가)?|그들|그들은)\s*/u;

/** Strip dialogue quote markers and common prose lead-ins. */
function stripNarrationJunk(raw: string): string {
  return raw
    .replace(DIALOGUE_QUOTES, "")
    .replace(NARRATION_LEAD_IN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plain Korean key-event summary: one sentence, hard max 40 chars.
 * Deterministic: first sentence only, then a hard character cap.
 */
export function minifyComicNarration(raw: string): string {
  const cleaned = stripNarrationJunk(String(raw ?? ""));
  if (!cleaned) return "";
  const firstSentence = (cleaned.split(SENTENCE_END)[0] ?? "").trim();
  let text = firstSentence;
  if (text.length > COMIC_NARRATION_MAX_CHARS) {
    text = text.slice(0, COMIC_NARRATION_MAX_CHARS);
  }
  return text.replace(TRAILING_JUNK, "").trim();
}

export type ComicNarrationSlot = { panelIndex: number; text: string };

/**
 * Deterministic per-page narration slots.
 * Only silent panels (no dialogue) are eligible; at most COMIC_PAGE_MAX_NARRATIONS
 * across the page, in panel order. Narration is omitted when dialogue carries the beat.
 */
export function resolveComicNarrationSlots(opts: {
  panels: ReadonlyArray<{
    index: number;
    narrationBoxNeeded: boolean;
    dialogueCount: number;
    situation: string;
  }>;
}): ComicNarrationSlot[] {
  const slots: ComicNarrationSlot[] = [];
  for (const panel of opts.panels) {
    if (slots.length >= COMIC_PAGE_MAX_NARRATIONS) break;
    if (!panel.narrationBoxNeeded) continue;
    if (panel.dialogueCount > 0) continue;
    const text = minifyComicNarration(panel.situation);
    if (!text) continue;
    slots.push({ panelIndex: panel.index, text });
  }
  return slots;
}

/** Provider prompt contract — narration must stay a minimal timeline summary. */
export function renderComicNarrationProviderContract(): string {
  return "Use narration sparingly. Include only very short time-ordered narration boxes for crucial transitions. Do not paste long prose paragraphs. Narration style: minimal timeline summary (one short sentence, 8-32 chars, max 40).";
}