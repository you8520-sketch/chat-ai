import { CHAT_MESSAGE_MAX } from "@/lib/chatModels";
import {
  CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE,
  CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE,
  CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE,
} from "@/lib/chatShortcutComposer";
import { compareShortcutRows } from "@/lib/chatShortcutListSync";

/**
 * Canonical owner of the composer shortcut-chip model.
 *
 * The composer textarea keeps ONE string (the display value). A chip occupies a
 * token in that string:
 *
 *   OPEN + two key digits + label + CLOSE
 *
 * OPEN/CLOSE/digits are zero-width characters, label is the visible "★ 이름 ×"
 * text. NBSP glues the spaces, and a word joiner between every label character
 * keeps the name and × on one line. A zero-width space before OPEN is a break
 * opportunity, so a chip that fits the composer moves whole to the next line.
 * The saved shortcut body never
 * enters the display value. It lives only in the chip table (snapshot taken at
 * selection time) and is substituted exactly once, by expandShortcutChips, when
 * the message is sent. No other module builds the sent text.
 */

export const SHORTCUT_CHIP_OPEN = "\u2060";
export const SHORTCUT_CHIP_CLOSE = "\u2061";
const KEY_DIGITS = ["\u200B", "\u200C", "\u2062", "\u2063", "\u2064"] as const;
const KEY_RADIX = KEY_DIGITS.length;
export const SHORTCUT_CHIP_LIMIT = KEY_RADIX * KEY_RADIX;
/**
 * Session draft cap for the raw composer string. Word joiners inside chip labels
 * are invisible and do not count toward CHAT_MESSAGE_MAX, but they are stored.
 * Visible text stays within the chat limit; this only keeps reload from slicing
 * a still-valid chip token.
 */
export const CHAT_COMPOSER_STORAGE_MAX = CHAT_MESSAGE_MAX * 2 + SHORTCUT_CHIP_LIMIT * 5;
export const SHORTCUT_CHIP_LIMIT_MESSAGE = `단축어는 한 번에 ${SHORTCUT_CHIP_LIMIT}개까지 넣을 수 있습니다.`;
export const SHORTCUT_EDIT_TOO_LONG_MESSAGE =
  "단축어를 펼친 전송 길이가 제한을 넘어 입력하지 못했습니다.";
export const SHORTCUT_EMPTY_CONTENT_MESSAGE = "넣을 단축어 내용이 없습니다.";

const NBSP = "\u00A0";
/** Same character as OPEN. Between label characters it forbids a line break. */
const WORD_JOINER = SHORTCUT_CHIP_OPEN;
/**
 * UAX #14 LB8 breaks after this, even before a word joiner. It is also key digit 0;
 * it is a chip prefix only when OPEN is the next character.
 */
const CHIP_LINE_BREAK = "\u200B";
const SENTINEL_PATTERN = /[\u2060\u2061\u200B\u200C\u2062\u2063\u2064]/g;
const SENTINEL_TEST = /[\u2060\u2061\u200B\u200C\u2062\u2063\u2064]/;

export type ShortcutChip = {
  key: number;
  shortcutId: number;
  name: string;
  favorite: boolean;
  /** Snapshot of the saved body at selection time. Later edits/deletes do not change it. */
  content: string;
};

export type ShortcutChipSource = {
  id: number;
  name: string;
  favorite: boolean;
  content: string;
};

export type ShortcutChipToken = { start: number; end: number; chip: ShortcutChip };

function plainLabel(chip: Pick<ShortcutChip, "name" | "favorite">): string {
  const name = chip.name.replace(/\s+/g, NBSP);
  return `${NBSP}${chip.favorite ? `★${NBSP}` : ""}${name}${NBSP}×${NBSP}`;
}

/** Word joiners between label characters. Hangul may otherwise break per syllable. */
function gluedLabel(chip: Pick<ShortcutChip, "name" | "favorite">): string {
  return [...plainLabel(chip)].join(WORD_JOINER);
}

export function shortcutChipLabelParts(chip: Pick<ShortcutChip, "name" | "favorite">): {
  lead: string;
  remove: string;
  tail: string;
} {
  const glued = gluedLabel(chip);
  const removeAt = plainLabel(chip).lastIndexOf("×") * 2;
  return {
    lead: glued.slice(0, removeAt),
    remove: "×",
    tail: glued.slice(removeAt + 1),
  };
}

function chipLabel(chip: ShortcutChip): string {
  return gluedLabel(chip);
}

function encodeKey(key: number): string {
  return `${KEY_DIGITS[Math.floor(key / KEY_RADIX)]}${KEY_DIGITS[key % KEY_RADIX]}`;
}

function decodeKey(high: string | undefined, low: string | undefined): number | null {
  const h = KEY_DIGITS.indexOf(high as (typeof KEY_DIGITS)[number]);
  const l = KEY_DIGITS.indexOf(low as (typeof KEY_DIGITS)[number]);
  if (h < 0 || l < 0) return null;
  return h * KEY_RADIX + l;
}

function encodeToken(chip: ShortcutChip): string {
  return `${CHIP_LINE_BREAK}${SHORTCUT_CHIP_OPEN}${encodeKey(chip.key)}${chipLabel(chip)}${SHORTCUT_CHIP_CLOSE}`;
}

function visibleComposerLength(value: string): number {
  return stripSentinels(value).length;
}

export function hasShortcutSentinel(value: string): boolean {
  return SENTINEL_TEST.test(value);
}

function stripSentinels(text: string): string {
  return text.replace(SENTINEL_PATTERN, "");
}

/** Intact tokens only: known key, exact label, closing marker. Anything else is not a chip. */
export function findShortcutTokens(
  value: string,
  chips: readonly ShortcutChip[]
): ShortcutChipToken[] {
  const tokens: ShortcutChipToken[] = [];
  if (chips.length === 0 || !value.includes(SHORTCUT_CHIP_OPEN)) return tokens;
  const byKey = new Map(chips.map((chip) => [chip.key, chip]));
  let i = 0;
  while (i < value.length) {
    const prefixed = value[i] === CHIP_LINE_BREAK && value[i + 1] === SHORTCUT_CHIP_OPEN;
    const openAt = prefixed ? i + 1 : value[i] === SHORTCUT_CHIP_OPEN ? i : -1;
    if (openAt >= 0) {
      const key = decodeKey(value[openAt + 1], value[openAt + 2]);
      const chip = key == null ? undefined : byKey.get(key);
      if (chip) {
        const glued = chipLabel(chip);
        const plain = plainLabel(chip);
        const label = value.startsWith(glued, openAt + 3)
          ? glued
          : value.startsWith(plain, openAt + 3)
            ? plain
            : null;
        if (label) {
          const labelEnd = openAt + 3 + label.length;
          if (value[labelEnd] === SHORTCUT_CHIP_CLOSE) {
            tokens.push({ start: prefixed ? i : openAt, end: labelEnd + 1, chip });
            i = labelEnd + 1;
            continue;
          }
        }
      }
    }
    i += 1;
  }
  return tokens;
}

/** Chips still referenced by the display value, in table order. */
export function pruneShortcutChips(
  value: string,
  chips: readonly ShortcutChip[]
): ShortcutChip[] {
  if (chips.length === 0) return [];
  const used = new Set(findShortcutTokens(value, chips).map((token) => token.chip.key));
  return chips.filter((chip) => used.has(chip.key));
}

/**
 * The single place that turns the display value into the text sent to the AI.
 * Each token is replaced once by its snapshot body (the body is never re-scanned);
 * stray invisible markers are dropped.
 */
export function expandShortcutChips(value: string, chips: readonly ShortcutChip[]): string {
  const tokens = findShortcutTokens(value, chips);
  if (tokens.length === 0) return hasShortcutSentinel(value) ? stripSentinels(value) : value;
  let out = "";
  let cursor = 0;
  for (const token of tokens) {
    out += stripSentinels(value.slice(cursor, token.start));
    out += token.chip.content;
    cursor = token.end;
  }
  return out + stripSentinels(value.slice(cursor));
}

export function shortcutExpandedLength(value: string, chips: readonly ShortcutChip[]): number {
  return expandShortcutChips(value, chips).length;
}

function sanitizeInserted(text: string, chips: readonly ShortcutChip[]): string {
  if (!hasShortcutSentinel(text)) return text;
  const tokens = findShortcutTokens(text, chips);
  let out = "";
  let cursor = 0;
  for (const token of tokens) {
    out += stripSentinels(text.slice(cursor, token.start));
    out += text.slice(token.start, token.end);
    cursor = token.end;
  }
  return out + stripSentinels(text.slice(cursor));
}

export type ShortcutEditResult = {
  value: string;
  chips: ShortcutChip[];
  /** Caret to restore when the result differs from what the textarea holds, else null. */
  caret: number | null;
};

/**
 * Reconcile a native textarea edit (typing, IME, paste, cut, Backspace on part of a
 * token) with the chip model. Edits that touch the inside of a token remove that
 * whole token; edits next to a token leave it intact. Stray markers are dropped.
 */
export function reconcileShortcutEdit(input: {
  prev: string;
  next: string;
  chips: readonly ShortcutChip[];
}): ShortcutEditResult {
  const { prev, next, chips } = input;
  if (prev === next) {
    return { value: next, chips: pruneShortcutChips(next, chips), caret: null };
  }
  const minLength = Math.min(prev.length, next.length);
  let p = 0;
  while (p < minLength && prev[p] === next[p]) p += 1;
  let q = 0;
  while (
    q < minLength - p &&
    prev[prev.length - 1 - q] === next[next.length - 1 - q]
  ) {
    q += 1;
  }
  let removedStart = p;
  let removedEnd = prev.length - q;
  for (const token of findShortcutTokens(prev, chips)) {
    if (removedStart < token.end && removedEnd > token.start) {
      removedStart = Math.min(removedStart, token.start);
      removedEnd = Math.max(removedEnd, token.end);
    }
  }
  const inserted = next.slice(p, next.length - q);
  const cleaned = sanitizeInserted(inserted, chips);
  if (removedStart === p && removedEnd === prev.length - q && cleaned === inserted) {
    return { value: next, chips: pruneShortcutChips(next, chips), caret: null };
  }
  const value = `${prev.slice(0, removedStart)}${cleaned}${prev.slice(removedEnd)}`;
  return {
    value,
    chips: pruneShortcutChips(value, chips),
    caret: removedStart + cleaned.length,
  };
}

/** Normalizes a stored/restored value+table pair so only intact tokens survive. */
export function normalizeShortcutComposer(
  value: string,
  chips: readonly ShortcutChip[]
): { value: string; chips: ShortcutChip[] } {
  if (!hasShortcutSentinel(value)) return { value, chips: [] };
  const tokens = findShortcutTokens(value, chips);
  if (tokens.length === 0) return { value: stripSentinels(value), chips: [] };
  let out = "";
  let cursor = 0;
  for (const token of tokens) {
    out += stripSentinels(value.slice(cursor, token.start));
    out += encodeToken(token.chip);
    cursor = token.end;
  }
  out += stripSentinels(value.slice(cursor));
  return { value: out, chips: pruneShortcutChips(out, chips) };
}

export function removeShortcutChipToken(input: {
  value: string;
  chips: readonly ShortcutChip[];
  tokenStart: number;
}): { value: string; chips: ShortcutChip[]; caret: number } | null {
  const token = findShortcutTokens(input.value, input.chips).find(
    (candidate) => candidate.start === input.tokenStart
  );
  if (!token) return null;
  const value = `${input.value.slice(0, token.start)}${input.value.slice(token.end)}`;
  return { value, chips: pruneShortcutChips(value, input.chips), caret: token.start };
}

export type ShortcutKeyAction =
  | { kind: "remove"; value: string; chips: ShortcutChip[]; caret: number }
  | { kind: "caret"; caret: number };

/** Atomic token behavior for collapsed Backspace / Delete / ArrowLeft / ArrowRight. */
export function planShortcutChipKey(input: {
  value: string;
  chips: readonly ShortcutChip[];
  selectionStart: number;
  selectionEnd: number;
  key: string;
}): ShortcutKeyAction | null {
  if (input.selectionStart !== input.selectionEnd) return null;
  const caret = input.selectionStart;
  const tokens = findShortcutTokens(input.value, input.chips);
  if (tokens.length === 0) return null;
  const before = tokens.find((token) => token.end === caret);
  const after = tokens.find((token) => token.start === caret);
  if (input.key === "Backspace" && before) {
    const removed = removeShortcutChipToken({
      value: input.value,
      chips: input.chips,
      tokenStart: before.start,
    });
    return removed ? { kind: "remove", ...removed } : null;
  }
  if (input.key === "Delete" && after) {
    const removed = removeShortcutChipToken({
      value: input.value,
      chips: input.chips,
      tokenStart: after.start,
    });
    return removed ? { kind: "remove", ...removed } : null;
  }
  if (input.key === "ArrowLeft" && before) return { kind: "caret", caret: before.start };
  if (input.key === "ArrowRight" && after) return { kind: "caret", caret: after.end };
  return null;
}

/** Keeps the caret/selection out of token interiors. Returns null when nothing moves. */
export function snapShortcutSelection(input: {
  value: string;
  chips: readonly ShortcutChip[];
  selectionStart: number;
  selectionEnd: number;
  previousStart: number;
}): { start: number; end: number } | null {
  const tokens = findShortcutTokens(input.value, input.chips);
  if (tokens.length === 0) return null;
  let { selectionStart: start, selectionEnd: end } = input;
  if (start === end) {
    const inside = tokens.find((token) => start > token.start && start < token.end);
    if (!inside) return null;
    if (input.previousStart <= inside.start) start = inside.end;
    else if (input.previousStart >= inside.end) start = inside.start;
    else start = start - inside.start < inside.end - start ? inside.start : inside.end;
    return { start, end: start };
  }
  const startToken = tokens.find((token) => start > token.start && start < token.end);
  const endToken = tokens.find((token) => end > token.start && end < token.end);
  if (!startToken && !endToken) return null;
  if (startToken) start = startToken.start;
  if (endToken) end = endToken.end;
  return { start, end };
}

export type ShortcutChipInsertResult =
  | { action: "defer"; message: string }
  | { action: "reject"; message: string }
  | { action: "apply"; value: string; chips: ShortcutChip[]; caret: number };

/**
 * Insert a chip at the caret (or replace `replaceRange`, used by the slash command).
 * The surrounding draft is never sliced: overflow of either the display value or the
 * expanded message refuses the insert.
 */
export function planShortcutChipInsert(input: {
  composing: boolean;
  locked?: boolean;
  value: string;
  chips: readonly ShortcutChip[];
  selectionStart: number;
  selectionEnd: number;
  replaceRange?: { start: number; end: number } | null;
  source: ShortcutChipSource;
  maxChars?: number;
}): ShortcutChipInsertResult {
  if (input.locked) return { action: "reject", message: CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE };
  if (input.composing) return { action: "defer", message: CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE };
  if (!input.source.content.trim()) {
    return { action: "reject", message: SHORTCUT_EMPTY_CONTENT_MESSAGE };
  }
  const maxChars = input.maxChars ?? CHAT_MESSAGE_MAX;
  const value = input.value;
  const table = pruneShortcutChips(value, input.chips);
  const tokens = findShortcutTokens(value, table);

  let start = clampIndex(
    input.replaceRange ? input.replaceRange.start : Math.min(input.selectionStart, input.selectionEnd),
    value.length
  );
  let end = input.replaceRange
    ? clampIndex(input.replaceRange.end, value.length)
    : start;
  if (end < start) end = start;
  const startInside = tokens.find((token) => start > token.start && start < token.end);
  if (startInside) start = startInside.end;
  const endInside = tokens.find((token) => end > token.start && end < token.end);
  if (endInside) end = endInside.end;
  if (end < start) end = start;

  if (table.length >= SHORTCUT_CHIP_LIMIT) {
    return { action: "reject", message: SHORTCUT_CHIP_LIMIT_MESSAGE };
  }
  const used = new Set(table.map((chip) => chip.key));
  let key = 0;
  while (used.has(key)) key += 1;
  const chip: ShortcutChip = {
    key,
    shortcutId: input.source.id,
    name: input.source.name,
    favorite: input.source.favorite,
    content: input.source.content,
  };
  const token = encodeToken(chip);
  const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
  const nextChips = [...table, chip];
  if (
    visibleComposerLength(nextValue) > maxChars ||
    shortcutExpandedLength(nextValue, nextChips) > maxChars
  ) {
    return { action: "reject", message: CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE };
  }
  return { action: "apply", value: nextValue, chips: nextChips, caret: start + token.length };
}

/**
 * True when a user edit (typing, paste, IME) would exceed a limit.
 * Display value and expanded message are both capped by the chat message limit.
 */
export function shortcutEditExceedsLimit(
  value: string,
  chips: readonly ShortcutChip[],
  maxChars: number = CHAT_MESSAGE_MAX
): boolean {
  return visibleComposerLength(value) > maxChars || shortcutExpandedLength(value, chips) > maxChars;
}

export type ShortcutSlashMatch = { start: number; end: number; query: string };

export const SHORTCUT_SLASH_QUERY_MAX = 30;

/**
 * `/` starts a command only at the start of the draft or after whitespace / a chip.
 * URLs, `a/b`, `//` and any `/` in the middle of a word are plain text.
 */
export function detectShortcutSlash(value: string, caret: number): ShortcutSlashMatch | null {
  const end = clampIndex(caret, value.length);
  let start = end;
  while (start > 0) {
    const ch = value[start - 1] as string;
    if (/\s/.test(ch) || SENTINEL_TEST.test(ch)) break;
    start -= 1;
  }
  if (value[start] !== "/" || start >= end) return null;
  const query = value.slice(start + 1, end);
  if (query.includes("/") || query.length > SHORTCUT_SLASH_QUERY_MAX) return null;
  return { start, end, query };
}

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const JONGSEONG_COUNT = 28;
const CHOSEONG_SPAN = 21 * JONGSEONG_COUNT;

function isHangulSyllable(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= HANGUL_BASE && code <= HANGUL_END;
}

function choseongOf(ch: string): string | null {
  if (!isHangulSyllable(ch)) return null;
  return CHOSEONG[Math.floor((ch.charCodeAt(0) - HANGUL_BASE) / CHOSEONG_SPAN)] ?? null;
}

function queryCharMatches(q: string, n: string, isLast: boolean): boolean {
  if (q === n) return true;
  if (CHOSEONG.includes(q)) return choseongOf(n) === q;
  // Live IME: the last syllable may still lack its final consonant (지 → 진).
  if (isLast && isHangulSyllable(q) && isHangulSyllable(n)) {
    const qi = q.charCodeAt(0) - HANGUL_BASE;
    const ni = n.charCodeAt(0) - HANGUL_BASE;
    return qi % JONGSEONG_COUNT === 0 && Math.floor(qi / JONGSEONG_COUNT) === Math.floor(ni / JONGSEONG_COUNT);
  }
  return false;
}

export function shortcutNameMatchesQuery(name: string, query: string): boolean {
  const q = Array.from(query.normalize("NFC").toLowerCase());
  if (q.length === 0) return true;
  const n = Array.from(name.normalize("NFC").toLowerCase().replace(/\s+/g, ""));
  if (q.length > n.length) return false;
  return q.every((ch, index) => queryCharMatches(ch, n[index] as string, index === q.length - 1));
}

/** Favorites first, then the library's own order (updatedAt desc, id desc). */
export function filterShortcutsForSlash<
  T extends { id: number; name: string; favorite: boolean; updatedAt?: string },
>(items: readonly T[], query: string): T[] {
  return items
    .filter((item) => shortcutNameMatchesQuery(item.name, query))
    .sort(compareShortcutRows);
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length;
  return Math.min(length, Math.max(0, Math.trunc(value)));
}
