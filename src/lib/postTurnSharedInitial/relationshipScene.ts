/**
 * Keyword locator for a relationship "promise scene" inside the current-turn
 * assistant prose.
 *
 * This module NEVER decides whether a promise was made. It only returns a
 * character window around an explicit commitment cue so the existing
 * relationship-only inference can read that scene in isolation. The model still
 * confirms or rejects; the keyword cannot write to the ledger by itself.
 */

export type RelationshipSceneWindow = {
  /** Inclusive start offset in the source prose. */
  start: number;
  /** Exclusive end offset in the source prose. */
  end: number;
  /** Exact source text for this window. */
  text: string;
  /** Which cue tier located this window. */
  tier: "commitment" | "fallback";
};

/**
 * Tier 1 — explicit commitment words. These are the only cues that trigger the
 * conditional scene call in production. "I will / I'll" is deliberately absent:
 * in T71 it matched ordinary narration and crowded out the real promise.
 */
const COMMITMENT_CUES: readonly RegExp[] = [
  /약속/g,
  /맹세/g,
  /서약/g,
  /\bpromis(?:e|es|ed|ing)\b/gi,
  /\bswear(?:s|ing)?\b|\bswore\b|\bsworn\b/gi,
  /\bvow(?:s|ed|ing)?\b/gi,
  /\bguarantee(?:s|d|ing)?\b/gi,
];

/** Tier 2 — "장담" is often a threat/boast, so it is only a fallback. */
const FALLBACK_CUES: readonly RegExp[] = [/장담/g, /\bpledge(?:s|d|ing)?\b/gi];

/** Characters of context on each side of the cue, snapped to line boundaries. */
export const RELATIONSHIP_SCENE_RADIUS = 150;
/** Maximum number of disjoint windows in one scene call. */
export const RELATIONSHIP_SCENE_MAX_WINDOWS = 2;
/** Total character budget across all windows in one scene call. */
export const RELATIONSHIP_SCENE_MAX_CHARS = 1200;
/** A single window larger than this is skipped (prose is usually ~500 chars). */
const MAX_SINGLE_WINDOW_CHARS = 900;

type LineSpan = { start: number; end: number };

function lineSpans(text: string): LineSpan[] {
  const out: LineSpan[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      if (i > start) out.push({ start, end: i });
      start = i + 1;
    }
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

const OOC_SPAN_PATTERNS: readonly RegExp[] = [
  /\*?\[\s*ooc\b[^\]]*\]\*?/gi,
  /\(\s*ooc\b[^)]*\)/gi,
  /^\s*ooc\s*:.*$/gim,
];

function oocSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const re of OOC_SPAN_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
}

function insideAny(offset: number, spans: Array<{ start: number; end: number }>): boolean {
  return spans.some((s) => offset >= s.start && offset < s.end);
}

function cueOffsets(prose: string, cues: readonly RegExp[]): number[] {
  const hits: number[] = [];
  const ooc = oocSpans(prose);
  for (const re of cues) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(prose))) {
      if (!insideAny(match.index, ooc)) hits.push(match.index);
    }
  }
  return hits.sort((a, b) => a - b);
}

function snapStart(text: string, offset: number): number {
  const floor = Math.max(0, offset);
  const newline = text.lastIndexOf("\n", floor);
  return newline < 0 ? 0 : newline + 1;
}

function snapEnd(text: string, offset: number): number {
  const ceil = Math.min(text.length, offset);
  const newline = text.indexOf("\n", ceil);
  return newline < 0 ? text.length : newline;
}

function lineExpandedWindow(
  prose: string,
  cue: number,
  radius: number
): { start: number; end: number } | null {
  const lines = lineSpans(prose);
  const cueLine = lines.findIndex((line) => cue >= line.start && cue < line.end);
  if (cueLine < 0) return null;
  let first = cueLine;
  let last = cueLine;
  let leftBudget = radius;
  let rightBudget = radius;
  while (first > 0) {
    const len = lines[first - 1].end - lines[first - 1].start;
    if (len > radius * 2 || len > leftBudget) break;
    first -= 1;
    leftBudget -= len;
  }
  while (last < lines.length - 1) {
    const len = lines[last + 1].end - lines[last + 1].start;
    if (len > radius * 2 || len > rightBudget) break;
    last += 1;
    rightBudget -= len;
  }
  return { start: lines[first].start, end: lines[last].end };
}

function buildWindow(
  prose: string,
  cue: number,
  radius: number,
  tier: RelationshipSceneWindow["tier"]
): RelationshipSceneWindow | null {
  // Anchor on the start of the cue's line, not the cue character. A long
  // dialogue line would otherwise push the end offset past the next speaker's
  // reaction and re-introduce a bystander into the window.
  const cueLine = lineSpans(prose).find((line) => cue >= line.start && cue < line.end);
  const anchor = cueLine?.start ?? cue;
  let start = snapStart(prose, anchor - radius);
  let end = snapEnd(prose, anchor + radius);
  if (end <= start) return null;
  if (end - start > MAX_SINGLE_WINDOW_CHARS) {
    // A single oversized paragraph must not swallow the whole turn. Fall back
    // to line expansion, which skips the oversized neighbour line.
    const expanded = lineExpandedWindow(prose, cue, radius);
    if (!expanded) return null;
    start = expanded.start;
    end = expanded.end;
  }
  if (end - start > MAX_SINGLE_WINDOW_CHARS) return null;
  return { start, end, text: prose.slice(start, end), tier };
}

function mergeOverlapping(
  windows: RelationshipSceneWindow[]
): RelationshipSceneWindow[] {
  const out: RelationshipSceneWindow[] = [];
  for (const w of windows) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) {
      const start = last.start;
      const end = Math.max(last.end, w.end);
      out[out.length - 1] = {
        start,
        end,
        text: last.text + w.text.slice(Math.max(0, last.end - w.start)),
        tier: last.tier === "commitment" ? "commitment" : w.tier,
      };
    } else {
      out.push(w);
    }
  }
  return out;
}

/**
 * Locate at most two promise-scene windows in the assistant prose.
 * Returns [] when no explicit commitment cue exists.
 */
export function locateRelationshipScenes(
  prose: string,
  opts: { radius?: number; maxWindows?: number; maxChars?: number } = {}
): RelationshipSceneWindow[] {
  if (!prose.trim()) return [];
  const radius = opts.radius ?? RELATIONSHIP_SCENE_RADIUS;
  const maxWindows = opts.maxWindows ?? RELATIONSHIP_SCENE_MAX_WINDOWS;
  const maxChars = opts.maxChars ?? RELATIONSHIP_SCENE_MAX_CHARS;

  const strong = cueOffsets(prose, COMMITMENT_CUES);
  const cues = strong.length ? strong : cueOffsets(prose, FALLBACK_CUES);
  if (!cues.length) return [];
  const tier: RelationshipSceneWindow["tier"] = strong.length ? "commitment" : "fallback";

  const candidates: RelationshipSceneWindow[] = [];
  for (const cue of cues) {
    // A duplicate cue inside an already-selected window (e.g. the English
    // promise line and its Korean translation) must not widen the window.
    if (candidates.some((w) => cue >= w.start && cue < w.end)) continue;
    const window = buildWindow(prose, cue, radius, tier);
    if (window) candidates.push(window);
  }
  const merged = mergeOverlapping(candidates);

  const selected: RelationshipSceneWindow[] = [];
  let usedChars = 0;
  for (const window of merged) {
    if (selected.length >= maxWindows) break;
    if (usedChars + window.text.length > maxChars) continue;
    selected.push(window);
    usedChars += window.text.length;
  }
  return selected;
}

/** True when the prose contains any explicit commitment cue. */
export function hasRelationshipSceneCandidate(prose: string): boolean {
  return locateRelationshipScenes(prose).length > 0;
}

/**
 * Build the assistant block for the isolated scene call. Multiple windows are
 * separated and labelled so one call can cover two distinct promises without
 * silently dropping the second.
 */
export function buildRelationshipSceneProse(windows: readonly RelationshipSceneWindow[]): string {
  if (windows.length <= 1) return windows[0]?.text ?? "";
  return windows
    .map((w, i) => `--- scene ${i + 1} ---\n${w.text}`)
    .join("\n\n");
}
