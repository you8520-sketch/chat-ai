import { looksLikeDisplayTitle } from "@/lib/relationshipMetaCharacterName";
import {
  expandPossessionTransferRemovals,
  filterPossessionEntryItems,
  formatGroupedPossessionsForPrompt,
  parsePossessionEntry,
} from "@/lib/relationshipMetaItems";

export type MemoryPromise = {
  text: string;
  deadline?: string;
};

export type MemoryMeta = {
  honorifics: string[];
  items: string[];
  /** 캐릭터·NPC 속마음 — 유저 속마음 제외, 최근 N개만 유지 (`이름: 내용` 형식) */
  thoughts: string[];
  /** 서로 맺은 약속 — 이행·기한 만료 시 자동 제거 */
  promises: MemoryPromise[];
};

export const MEMORY_META_MAX = {
  honorifics: 20,
  items: 30,
  thoughts: 8,
  promises: 15,
} as const;

/** 턴당 추출·병합 시 추가할 속마음 상한 */
export const THOUGHTS_PER_TURN_MAX = 3;

export const EMPTY_MEMORY_META: MemoryMeta = {
  honorifics: [],
  items: [],
  thoughts: [],
  promises: [],
};

export type RelationshipMetaCategory = keyof MemoryMeta;

export type RelationshipMetaDelta = Partial<{
  honorifics: string[];
  items: string[];
  thoughts: string[];
  itemsRemove: string[];
  thoughtsRemove: string[];
  promisesAdd: MemoryPromise[];
  promisesRemove: string[];
}>;

export type HonorificNames = { charName: string; userName: string; displayTitle?: string };

const HONORIFIC_ENTRY_RE = /^(.+?)→(.+?):\s*(.*)$/;
const THOUGHT_ENTRY_RE = /^([^:：]{1,24})[:：]\s*(.+)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** 호칭 from/to — 인물 이름 최대 길이 (NPC 포함) */
const MAX_HONORIFIC_ACTOR_LEN = 12;
/** 작품명·문장이 이름 칸에 들어온 경우 */
const INVALID_HONORIFIC_ACTOR_RE =
  /(?:또\s|죽었|죽었|이다|했다|였다|습니다|인가|같은|처럼|섭남|남주|여주|프로젝트|시리즈)/;

function replaceGenericActorLabel(name: string, names: HonorificNames): string {
  const t = name.trim();
  if (t === "캐릭터") return names.charName;
  if (t === "유저") return names.userName;
  return t;
}

/** 관계 메모 속마음 — 유저(페르소나) 화자 제외 */
export function isUserThoughtSpeaker(name: string, names: HonorificNames): boolean {
  const speaker = replaceGenericActorLabel(name, names).trim();
  const user = names.userName.trim();
  if (!speaker || !user) return speaker === "유저";
  if (speaker === "유저" || speaker === user) return true;
  return false;
}

function isBlockedHonorificActor(name: string, names: HonorificNames): boolean {
  const t = name.trim();
  if (!t) return true;
  if (names.displayTitle && t === names.displayTitle.trim()) return true;
  if (looksLikeDisplayTitle(t)) return true;
  if (t.length > MAX_HONORIFIC_ACTOR_LEN) return true;
  if (/\s/.test(t)) return true;
  if (INVALID_HONORIFIC_ACTOR_RE.test(t)) return true;
  return false;
}

/** 본문에 실제 등장한 이름만 from/to로 허용 — 카드·시뮬 제목 제외 */
export function filterHonorificsToDialogue(
  entries: string[],
  dialogue: string,
  names: HonorificNames
): string[] {
  const text = dialogue.trim();
  if (!text) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of entries) {
    const line = raw.trim();
    const m = line.match(HONORIFIC_ENTRY_RE);
    if (!m) continue;

    let from = replaceGenericActorLabel(m[1], names);
    let to = replaceGenericActorLabel(m[2], names);
    const value = m[3]?.trim() ?? "";
    if (!value) continue;
    if (isBlockedHonorificActor(from, names) || isBlockedHonorificActor(to, names)) continue;
    if (!text.includes(from) || !text.includes(to)) continue;

    const normalized = `${from}→${to}: ${value}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out.slice(0, MEMORY_META_MAX.honorifics);
}

/** `from→to: value` — 캐릭터/유저 라벨만 치환, 카드 제목·본문 미등장 항목은 제거 */
export function normalizeHonorificEntry(entry: string, names: HonorificNames): string {
  const t = entry.trim();
  if (!t) return "";
  const m = t.match(HONORIFIC_ENTRY_RE);
  if (!m) return "";
  const from = replaceGenericActorLabel(m[1], names);
  const to = replaceGenericActorLabel(m[2], names);
  const value = m[3]?.trim() ?? "";
  if (!value) return "";
  if (isBlockedHonorificActor(from, names) || isBlockedHonorificActor(to, names)) return "";
  return `${from}→${to}: ${value}`;
}

function normalizeItemEntry(entry: string, names: HonorificNames): string {
  let t = entry.trim();
  if (!t) return t;
  if (names.displayTitle) {
    t = t.replace(new RegExp(`^${escapeRegExp(names.displayTitle)}→`), `${names.charName}→`);
    t = t.replace(new RegExp(`→${escapeRegExp(names.displayTitle)}(?=[: \\s]|$)`), `→${names.charName}`);
    t = t.replace(new RegExp(`^${escapeRegExp(names.displayTitle)}(?=[: \\s]|$)`), names.charName);
  }
  t = t.replace(/^캐릭터→유저/, `${names.charName}→${names.userName}`);
  t = t.replace(/^유저→캐릭터/, `${names.userName}→${names.charName}`);
  t = t.replace(/^캐릭터→/, `${names.charName}→`);
  t = t.replace(/→유저(?=[: \s]|$)/, `→${names.userName}`);
  t = t.replace(/^유저(?=[: \s]|$)/, names.userName);
  t = t.replace(/^캐릭터(?=[: \s]|$)/, names.charName);
  return filterPossessionEntryItems(t);
}

/** 정규화 후 동일 문자열 기준 중복 제거 (호칭) */
export function dedupeNormalizedHonorifics(
  honorifics: string[],
  names: HonorificNames,
  max = MEMORY_META_MAX.honorifics
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of honorifics) {
    const normalized = normalizeHonorificEntry(entry, names);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, max);
}

function dedupeNormalizedItems(
  items: string[],
  names: HonorificNames,
  max = MEMORY_META_MAX.items
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of items) {
    const normalized = normalizeItemEntry(entry, names);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, max);
}

export const THOUGHT_CONTENT_MAX_CHARS = 40;
/** 목표 글자 수를 넘더라도 문장이 완결될 때까지 허용하는 상한 */
export const THOUGHT_CONTENT_HARD_MAX_CHARS = 56;

const THOUGHT_INCOMPLETE_TAIL_RE =
  /(?:을|를|은|는|이|가|와|과|에|에서|으로|로|처럼|만큼|수도|듯|며|고|면|면서|지만|인데|라고|에게|께|한테)$/;

const THOUGHT_BREAK_RULES: { pattern: string; cutAfter: boolean }[] = [
  { pattern: " · ", cutAfter: false },
  { pattern: " / ", cutAfter: false },
  { pattern: ", ", cutAfter: true },
  { pattern: "。", cutAfter: true },
  { pattern: ". ", cutAfter: true },
  { pattern: "! ", cutAfter: true },
  { pattern: "? ", cutAfter: true },
  { pattern: "…", cutAfter: true },
  { pattern: ".", cutAfter: true },
  { pattern: "!", cutAfter: true },
  { pattern: "?", cutAfter: true },
];

function isCompleteThoughtSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[.!?…]["']?$/.test(t)) return true;
  if (THOUGHT_INCOMPLETE_TAIL_RE.test(t)) return false;
  if (
    /(?:[가-힣]{2,}(?:혀|여|켜|줘|더|라|자|네|지|어|아|해|다|함|음|임|군|구나|거야|겠어|겠지|래|냐|까|군요|네요|어요|아요|지요|래요|없어|있어|싫어|좋아|그래|맞아|아니))(?:[.!?…])?$/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** 속마음 본문 길이 제한 — 40자 목표, 문장 완결까지 hardMax까지 허용 */
export function clampThoughtContent(
  content: string,
  max = THOUGHT_CONTENT_MAX_CHARS,
  hardMax = THOUGHT_CONTENT_HARD_MAX_CHARS
): string {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;

  const cap = Math.min(t.length, hardMax);

  for (let end = max; end <= cap; end++) {
    const slice = t.slice(0, end).trim();
    if (slice && isCompleteThoughtSentence(slice)) return slice;
  }

  if (t.length <= hardMax) return t;

  for (let end = hardMax; end >= Math.floor(max * 0.65); end--) {
    const slice = t.slice(0, end).trim();
    if (slice && isCompleteThoughtSentence(slice)) return slice;
  }

  const prefix = t.slice(0, hardMax);
  const windowStart = Math.max(0, hardMax - 18);
  const window = prefix.slice(windowStart);

  for (const { pattern, cutAfter } of THOUGHT_BREAK_RULES) {
    const idx = window.lastIndexOf(pattern);
    if (idx < 0) continue;
    const abs = windowStart + idx;
    const end = cutAfter ? abs + pattern.length : abs;
    const result = t.slice(0, end).trim();
    if (result.length > 0 && !THOUGHT_INCOMPLETE_TAIL_RE.test(result)) return result;
  }

  const lastSpace = prefix.lastIndexOf(" ");
  if (lastSpace > 0) {
    const result = t.slice(0, lastSpace).trim();
    if (result.length > 0) return result;
  }

  return prefix.trim();
}

/** 턴 요약·3인칭 서술형 속마음 — 관계 메모에 넣지 않음 */
export function isLikelySituationSummary(content: string): boolean {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return false;

  if (/^(?:그는|그녀|캐릭터가)\s/.test(t)) return true;
  if (/\s·\s|(?:^|\s)·\s/.test(t)) return true;
  if (/[^\s]{2,}(?:했다|였다)(?:[\s.!?·,]|$)/.test(t)) return true;
  if (/[,，;；]/.test(t)) return true;

  const sentenceEndings = t.match(/[.!?。！？]/g);
  if (sentenceEndings && sentenceEndings.length > 1) return true;

  return false;
}

export const RELATIONSHIP_THOUGHT_EXTRACT_RULES = `thoughts(속마음) 규칙:
- **이번 턴** 본문에 등장한 캐릭터·NPC만. 형식 필수: "이름: 속마음" (이름은 본문에 나온 그대로)
- **매 턴 1~${THOUGHTS_PER_TURN_MAX}개** — NPC·캐릭터 각각 **1인칭 내면 한 줄**. 전체 저장은 최근 ${MEMORY_META_MAX.thoughts}개(가득 차면 오래된 것부터 삭제)
- 내용 목표 **${THOUGHT_CONTENT_MAX_CHARS}자 내외**. 문장을 완결하려면 ${THOUGHT_CONTENT_HARD_MAX_CHARS}자까지 허용. 상황 나열·요약 금지
- 3인칭 서술(그는/그녀/캐릭터가~), 과거형 사건 서술(~했다/~였다), · 키워드 나열(턴요약형), 여러 절/문장 금지
- **유저 내면·( ) 속마음 절대 금지**`;

/** `이름: 내용` — `캐릭터`/`유저`를 실제 이름으로 치환; 접두 없으면 주인공 이름 */
export function normalizeThoughtEntry(entry: string, names: HonorificNames): string {
  const t = entry.trim();
  if (!t) return t;
  const m = t.match(THOUGHT_ENTRY_RE);
  let name: string;
  let content: string;
  if (m) {
    name = replaceGenericActorLabel(m[1], names);
    if (isBlockedHonorificActor(name, names) || isUserThoughtSpeaker(name, names)) return "";
    content = m[2].trim();
  } else {
    name = names.charName;
    content = t;
  }
  content = clampThoughtContent(content);
  if (!content || isLikelySituationSummary(content)) return "";
  return `${name}: ${content}`;
}

/** 정규화 후 동일 문자열 기준 중복 제거 (속마음) */
export function dedupeNormalizedThoughts(
  thoughts: string[],
  names: HonorificNames,
  max: number = MEMORY_META_MAX.thoughts,
  keepRecent = max >= MEMORY_META_MAX.thoughts
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of thoughts) {
    const normalized = normalizeThoughtEntry(entry, names);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return keepRecent ? out.slice(-max) : out.slice(0, max);
}

/** 턴 추출 — 유효한 속마음만 정규화, 최대 THOUGHTS_PER_TURN_MAX개 */
export function normalizeTurnThoughts(
  thoughts: string[],
  names: HonorificNames,
  max = THOUGHTS_PER_TURN_MAX
): string[] {
  return dedupeNormalizedThoughts(thoughts, names, max, false);
}

export function normalizeMemoryMeta(meta: MemoryMeta, names: HonorificNames): MemoryMeta {
  return {
    honorifics: dedupeNormalizedHonorifics(meta.honorifics, names),
    items: dedupeNormalizedItems(meta.items, names),
    thoughts: dedupeNormalizedThoughts(meta.thoughts, names),
    promises: meta.promises,
  };
}

function uniqStrings(a: string[], b: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...a, ...b]) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, max);
}

function parsePromises(raw: unknown): MemoryPromise[] {
  if (!Array.isArray(raw)) return [];
  const out: MemoryPromise[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) out.push({ text });
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as MemoryPromise).text === "string") {
      const p = entry as MemoryPromise;
      const text = p.text.trim();
      if (!text) continue;
      const deadline = typeof p.deadline === "string" ? p.deadline.trim() : undefined;
      out.push(deadline ? { text, deadline } : { text });
    }
  }
  return out.slice(0, MEMORY_META_MAX.promises);
}

export function parseMemoryMeta(raw: string | null | undefined): MemoryMeta {
  if (!raw?.trim()) return { ...EMPTY_MEMORY_META };
  try {
    const j = JSON.parse(raw) as Partial<MemoryMeta> & { locations?: string[] };
    return {
      honorifics: Array.isArray(j.honorifics)
        ? j.honorifics.filter(Boolean).slice(0, MEMORY_META_MAX.honorifics)
        : [],
      items: Array.isArray(j.items) ? j.items.filter(Boolean).slice(0, MEMORY_META_MAX.items) : [],
      thoughts: Array.isArray(j.thoughts)
        ? j.thoughts.filter(Boolean).slice(-MEMORY_META_MAX.thoughts)
        : [],
      promises: parsePromises(j.promises),
    };
  } catch {
    return { ...EMPTY_MEMORY_META };
  }
}

function mergeThoughts(
  prev: string[],
  delta: string[],
  names?: HonorificNames
): string[] {
  const additions = names
    ? normalizeTurnThoughts(delta, names)
    : delta.map((t) => t.trim()).filter(Boolean).slice(0, THOUGHTS_PER_TURN_MAX);

  const seen = new Set(prev.map((t) => t.trim()));
  const out = [...prev];
  for (const t of additions) {
    const trimmed = t.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  while (out.length > MEMORY_META_MAX.thoughts) {
    out.shift();
  }
  return out;
}

function mergePromises(
  prev: MemoryPromise[],
  add: MemoryPromise[],
  remove: string[]
): MemoryPromise[] {
  const removeSet = new Set(remove.map((t) => t.trim()).filter(Boolean));
  let out = prev.filter((p) => !removeSet.has(p.text.trim()));
  for (const p of add) {
    const text = p.text.trim();
    if (!text) continue;
    const deadline = p.deadline?.trim();
    const next: MemoryPromise = deadline ? { text, deadline } : { text };
    if (out.some((x) => x.text === text)) continue;
    out.push(next);
  }
  return out.slice(0, MEMORY_META_MAX.promises);
}

function applyMetaRemovals(entries: string[], remove: string[] | undefined): string[] {
  if (!remove?.length) return entries;
  const removeSet = new Set(remove.map((t) => t.trim()).filter(Boolean));
  return entries.filter((item) => !removeSet.has(item.trim()));
}

function possessionEntryPersonKey(entry: string, names: HonorificNames): string {
  const normalized = normalizeItemEntry(entry, names);
  const parsed = parsePossessionEntry(normalized);
  return parsed?.person ?? normalized;
}

/** 같은 인물 소지품 줄은 갱신(교체) — 전달 후 옛 줄+새 줄 중복 방지 */
function mergePossessionEntries(
  prev: string[],
  remove: string[] | undefined,
  add: string[] | undefined,
  names: HonorificNames
): string[] {
  let entries = applyMetaRemovals(prev, remove);
  if (!add?.length) return dedupeNormalizedItems(entries, names);

  const byPerson = new Map<string, string>();
  for (const raw of entries) {
    const normalized = normalizeItemEntry(raw, names);
    if (!normalized) continue;
    byPerson.set(possessionEntryPersonKey(normalized, names), normalized);
  }
  for (const raw of add) {
    const normalized = normalizeItemEntry(raw, names);
    if (!normalized) continue;
    byPerson.set(possessionEntryPersonKey(normalized, names), normalized);
  }
  return dedupeNormalizedItems([...byPerson.values()], names);
}

export function mergeMemoryMeta(
  prev: MemoryMeta,
  delta: RelationshipMetaDelta,
  names?: HonorificNames
): MemoryMeta {
  let honorifics = uniqStrings(prev.honorifics, delta.honorifics ?? [], MEMORY_META_MAX.honorifics);
  let thoughts = applyMetaRemovals(prev.thoughts, delta.thoughtsRemove);

  const deltaItems = delta.items ?? [];
  const transferPatch = names
    ? expandPossessionTransferRemovals(prev.items, deltaItems, names)
    : { itemsRemove: [] as string[], itemsRevise: [] as string[] };
  const itemsRemove = [
    ...(delta.itemsRemove ?? []),
    ...transferPatch.itemsRemove,
  ];
  const itemsAdd = [...deltaItems, ...transferPatch.itemsRevise];

  let items = names
    ? mergePossessionEntries(prev.items, itemsRemove, itemsAdd, names)
    : applyMetaRemovals(prev.items, itemsRemove);
  if (!names) {
    items = uniqStrings(items, itemsAdd, MEMORY_META_MAX.items);
  }

  thoughts = mergeThoughts(thoughts, delta.thoughts ?? [], names);
  if (names) {
    honorifics = dedupeNormalizedHonorifics(honorifics, names);
    thoughts = dedupeNormalizedThoughts(thoughts, names);
  }
  return {
    honorifics,
    items,
    thoughts,
    promises: mergePromises(prev.promises, delta.promisesAdd ?? [], delta.promisesRemove ?? []),
  };
}

export function formatMemoryMetaForPrompt(meta: MemoryMeta): string | null {
  const lines: string[] = [];
  if (meta.honorifics.length) lines.push(`호칭: ${meta.honorifics.join(" · ")}`);
  if (meta.items.length) lines.push(`소지품:\n${formatGroupedPossessionsForPrompt(meta.items)}`);
  if (meta.thoughts.length) {
    lines.push(`속마음(캐릭터·NPC):\n${meta.thoughts.join("\n")}`);
  }
  if (meta.promises.length) {
    const formatted = meta.promises.map((p) =>
      p.deadline ? `${p.text} (기한: ${p.deadline})` : p.text
    );
    lines.push(`약속: ${formatted.join(" · ")}`);
  }
  return lines.length
    ? `[Memory — 참고, 우선순위 2순위 하위]\n관계:\n${lines.join("\n")}`
    : null;
}

export function formatPromiseLabel(p: MemoryPromise): string {
  return p.deadline ? `${p.text} (기한: ${p.deadline})` : p.text;
}

export function parsePendingTurns(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? arr.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(-4)
      : [];
  } catch {
    return [];
  }
}

export function formatPendingForPrompt(pending: string[]): string | null {
  if (!pending.length) return null;
  return pending.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

export const TURN_SUMMARY_DEFAULT_MAX_CHARS = 200;

const SUMMARY_BREAK_RULES: { pattern: string; cutAfter: boolean }[] = [
  { pattern: " · ", cutAfter: false },
  { pattern: " / ", cutAfter: false },
  { pattern: ", ", cutAfter: true },
  { pattern: "。", cutAfter: true },
  { pattern: ". ", cutAfter: true },
  { pattern: "! ", cutAfter: true },
  { pattern: "? ", cutAfter: true },
  { pattern: "…", cutAfter: true },
  { pattern: ".", cutAfter: true },
  { pattern: "!", cutAfter: true },
  { pattern: "?", cutAfter: true },
];

/** 턴 요약 길이 제한 — 자연 경계(·, 구두점, 공백)에서 끊음 */
export function clampSummary(text: string, max = TURN_SUMMARY_DEFAULT_MAX_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;

  const prefix = t.slice(0, max);
  const windowStart = Math.max(0, max - 40);
  const window = prefix.slice(windowStart);

  for (const { pattern, cutAfter } of SUMMARY_BREAK_RULES) {
    const idx = window.lastIndexOf(pattern);
    if (idx < 0) continue;
    const abs = windowStart + idx;
    const end = cutAfter ? abs + pattern.length : abs;
    const result = t.slice(0, end).trim();
    if (result.length > 0) return result;
  }

  const lastSpace = prefix.lastIndexOf(" ");
  if (lastSpace > 0) return t.slice(0, lastSpace).trim();

  return prefix.trim();
}

/** API 키 없을 때 간단 턴 요약 */
export function demoTurnSummary(userMsg: string, assistantMsg: string, charName: string): string {
  const u = userMsg.replace(/\s+/g, " ").trim().slice(0, 25);
  const a = assistantMsg.replace(/\s+/g, " ").trim().slice(0, 45);
  const quote = u ? ` "${u}" 언급` : "";
  return clampSummary(`유저 발화함 · ${charName} 응답함${quote} · ${a}`);
}

export type TurnAnalysis = {
  turnSummary: string;
  meta: RelationshipMetaDelta;
};

export const TURNS_PER_LONG_MERGE = 5;

export type MemorySnapshot = {
  longTerm: string;
  pendingTurns: string[];
  meta: MemoryMeta;
  limit: number;
  assistantTurnCount: number;
};

export function turnsUntilMerge(assistantTurnCount: number): number {
  const rem = assistantTurnCount % TURNS_PER_LONG_MERGE;
  return rem === 0 ? TURNS_PER_LONG_MERGE : TURNS_PER_LONG_MERGE - rem;
}
