/**
 * Summary integrity — contiguous batches from explicit stored spans.
 * Never trust summarized_turn_count alone.
 */
import { ROLLING_SUMMARY_INTERVAL, ROLLING_SUMMARY_MIN_CHARS } from "./memory-constants";
import { isFallbackMemoryRecordSummary } from "./memory-summary-clamp";
import {
  assistantSuppliesUnsupportedSharedHistoryDetail,
  looksLikePriorSharedUserHistory,
} from "@/lib/sharedHistoryEvidence";
import {
  hasUnsupportedObjectiveUserLinkedFact,
  resolvePersonaName,
  sourcesFromUserText,
} from "./memory-source-authority";
import {
  newBatchEndForStart,
  resolveNextBatchRange,
  resolveStoredTurnEnd,
} from "./memory-summary-range";
import {
  EMPTY_OOC_SUMMARY_MARKER,
  isEmptyOocScope,
  normalizeSummaryScope,
  type MemorySummaryScope,
  type SummaryKind,
} from "./memory-summary-scope";

export type { SummaryKind, MemorySummaryScope };

type BatchSpan = { turnStart: number; turnEnd: number; inactive?: boolean };

/**
 * Active (non soft-deleted) summary rows only.
 * Soft-deleted (`inactive`) batches must not count as sealed coverage or
 * block reseal after the user deletes a wrong history/LTM entry.
 */
export function activeMemoryRecords<T extends { inactive?: boolean }>(
  records: readonly T[]
): T[] {
  return records.filter((r) => !r.inactive);
}

export type SummaryReasonCode =
  | "SUMMARY_TIMEOUT"
  | "SUMMARY_EMPTY"
  | "SUMMARY_INVALID"
  | "SUMMARY_SAVE_FAILED"
  | "SUMMARY_TRANSACTION_ROLLBACK"
  | "SUMMARY_BATCH_GAP"
  | "STALE_MEMORY_EPOCH"
  | "SUMMARY_SUCCESS"
  | "SUMMARY_OOC_PLACEHOLDER";

export type SummaryBatchDiag = {
  chatId: number;
  persistedBatchStarts: number[];
  missingBatchStarts: number[];
  summarizedTurnCount: number;
  highestContiguousTurn: number;
  recentSummaryBatchRange: string | null;
  reasonCode: SummaryReasonCode | "SUMMARY_OK" | "SUMMARY_COUNTER_DRIFT";
};

type ResolvedBatchSpan = { turnStart: number; turnEnd: number };

function normalizeSpan(row: BatchSpan): ResolvedBatchSpan | null {
  const turnEnd = resolveStoredTurnEnd(row.turnStart, row.turnEnd);
  if (turnEnd == null) return null;
  return {
    turnStart: row.turnStart,
    turnEnd,
  };
}

function sortedActiveSpans(records: BatchSpan[], actualTurnCount: number): ResolvedBatchSpan[] {
  return activeMemoryRecords(records)
    .map(normalizeSpan)
    .filter((r): r is ResolvedBatchSpan => r != null && r.turnEnd <= actualTurnCount)
    .sort((a, b) => a.turnStart - b.turnStart);
}

function sortedAllSpans(records: BatchSpan[], actualTurnCount: number): ResolvedBatchSpan[] {
  return records
    .map(normalizeSpan)
    .filter((r): r is ResolvedBatchSpan => r != null && r.turnEnd <= actualTurnCount)
    .sort((a, b) => a.turnStart - b.turnStart);
}

/**
 * Highest turn covered by contiguous batches starting at 1, including soft-deleted rows.
 * Used for persist gap checks so inactive historical rows still occupy their span.
 */
export function highestContiguousOccupiedTurn(
  records: BatchSpan[],
  actualTurnCount: number
): number {
  let expectedStart = 1;
  let highest = 0;
  for (const r of sortedAllSpans(records, actualTurnCount)) {
    if (r.turnStart !== expectedStart) break;
    highest = r.turnEnd;
    expectedStart = r.turnEnd + 1;
  }
  return highest;
}

/**
 * Highest turn covered by contiguous complete batches starting at 1.
 * Gap at 1 (e.g. only 7~12 present) → 0.
 * Supports explicit stored spans (including user-edited arbitrary ranges).
 */
export function highestContiguousCompletedTurn(
  records: BatchSpan[],
  actualTurnCount: number
): number {
  let expectedStart = 1;
  let highest = 0;
  for (const r of sortedActiveSpans(records, actualTurnCount)) {
    if (r.turnStart !== expectedStart) break;
    highest = r.turnEnd;
    expectedStart = r.turnEnd + 1;
  }
  return highest;
}

/** Expected sealed-through turn for a greenfield 5-turn cadence (diagnostics only). */
export function expectedSealedTurnCount(playableTurnCount: number): number {
  const n = Math.max(0, Math.floor(playableTurnCount));
  if (n < ROLLING_SUMMARY_INTERVAL) return 0;
  let sealed = 0;
  let start = 1;
  while (start + ROLLING_SUMMARY_INTERVAL - 1 <= n) {
    sealed = start + ROLLING_SUMMARY_INTERVAL - 1;
    start = sealed + 1;
  }
  return sealed;
}

/** Expected 5-turn batch starts for a greenfield chat (diagnostics only — not legacy). */
export function expectedBatchStartsThrough(playableTurnCount: number): number[] {
  const starts: number[] = [];
  let start = 1;
  while (start + ROLLING_SUMMARY_INTERVAL - 1 <= playableTurnCount) {
    starts.push(start);
    start += ROLLING_SUMMARY_INTERVAL;
  }
  return starts;
}

/** New 5-turn batch end for a batch starting at startTurn. */
export function batchEndForStart(startTurn: number): number {
  return newBatchEndForStart(startTurn);
}

export function missingContiguousBatchStarts(
  records: BatchSpan[],
  playableTurnCount: number
): number[] {
  const missing: number[] = [];
  let expectedStart = 1;
  for (const r of sortedActiveSpans(records, playableTurnCount)) {
    if (r.turnStart > expectedStart) {
      missing.push(expectedStart);
      return missing;
    }
    expectedStart = r.turnEnd + 1;
  }
  const highest = highestContiguousCompletedTurn(records, playableTurnCount);
  const next = resolveNextBatchRange(highest, playableTurnCount);
  if (next) {
    const has = activeMemoryRecords(records).some((r) => r.turnStart === next.turnStart);
    if (!has) missing.push(next.turnStart);
  }
  return missing;
}

export function earliestMissingBatchStart(
  records: BatchSpan[],
  playableTurnCount: number
): number | null {
  const missing = missingContiguousBatchStarts(records, playableTurnCount);
  return missing[0] ?? null;
}

/** Resolve stored batch start containing turnNumber. */
export function resolveBatchStartForTurnNumber(
  turnNumber: number,
  records: BatchSpan[]
): number {
  const n = Math.max(1, Math.floor(turnNumber));
  for (const r of sortedActiveSpans(records, n)) {
    if (n >= r.turnStart && n <= r.turnEnd) return r.turnStart;
  }
  const highest = highestContiguousCompletedTurn(records, n);
  let start = Math.max(1, highest + 1);
  while (start + ROLLING_SUMMARY_INTERVAL - 1 < n) {
    start += ROLLING_SUMMARY_INTERVAL;
  }
  return start;
}

/** @deprecated use EMPTY_OOC_SUMMARY_MARKER — kept for legacy imports/tests */
export const OOC_ONLY_SUMMARY_MARKER = EMPTY_OOC_SUMMARY_MARKER;

export function isOocOnlySummaryKind(kind: string | null | undefined): boolean {
  return isEmptyOocScope(kind);
}

/** empty_ooc / legacy ooc_only batch marker body (not LTM narrative). */
export function buildOocOnlyBatchPlaceholder(_startTurn: number, _endTurn: number): string {
  return EMPTY_OOC_SUMMARY_MARKER;
}

export function buildEmptyOocBatchPlaceholder(
  startTurn: number,
  endTurn: number
): string {
  return buildOocOnlyBatchPlaceholder(startTurn, endTurn);
}

export function isOocOnlyPlaceholderText(text: string): boolean {
  return text.trim() === EMPTY_OOC_SUMMARY_MARKER;
}

const SUMMARY_INSTRUCTION_ECHO_PATTERNS = [
  /(?:6|여섯)\s*턴\s*배치의?\s*사건을?\s*발생\s*순서대로\s*요약/i,
  /(?:5|다섯)\s*턴\s*배치의?\s*사건을?\s*발생\s*순서대로\s*요약/i,
  /사건\s*시기와?\s*인과관계를?\s*누락하지\s*않/i,
  /요약\s*(?:대상|작성|규칙|지침|형식|본문만\s*출력)/i,
  /(?:source|소스)\s*(?:턴|내용).*(?:검토|요약)/i,
  /최종\s*출력.*(?:턴\s*번호|점검표|노출)/i,
] as const;

export function isLikelySummaryInstructionEcho(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return SUMMARY_INSTRUCTION_ECHO_PATTERNS.some((pattern) => pattern.test(normalized));
}

const STRONG_GLOBAL_MEMORY_LOSS =
  /(?:기억상실|기억을\s*(?:완전히\s*)?(?:잃(?:었|은|고|어)?|상실)|모든\s*기억(?:이|을)\s*(?:없|잃))/i;
const EPISTEMIC_MARKER =
  /(?:추측|의심|가능성|확정되지|불확실|모른|알\s*수\s*없|듯|것\s*같|보인|여긴|판단|주장|말했|생각|진단|추정|감지|느꼈|경험했|여기게|실감)/i;
const SOURCE_UNCERTAINTY_MARKER =
  /(?:추측|의심|가능성|확실하지|모른|아마|일지도|일\s*수|듯|것\s*같|보인|여긴|판단|진단)/i;


const ATTRIBUTED_RELATIONSHIP_CLAIM_MARKER =
  /(?:말했|말하였다|밝혔|밝혔다|주장했|주장하였다|전했|전하였다|언급했|언급하였다|설명했|설명하였다|부탁했다고\s*말)/i;

function resolveSummaryUserName(userPersona?: string | null): string | null {
  const match = userPersona?.match(/(?:^|\n)이름\/호칭:\s*([^\n]+)/);
  const name = match?.[1]?.trim() ?? "";
  return name || null;
}

function summaryInventsUnsupportedUserRelationship(
  summary: string,
  source: { user: string; assistant: string },
  userPersona?: string | null,
  charName?: string | null
): boolean {
  const personaName = resolvePersonaName(userPersona) ?? resolveSummaryUserName(userPersona);
  if (
    hasUnsupportedObjectiveUserLinkedFact(summary, {
      sources: sourcesFromUserText(source.user),
      personaName,
      charName:
        charName ??
        source.assistant.match(/^([가-힣A-Za-z0-9]{1,12})는/)?.[1] ??
        null,
    })
  ) {
    return true;
  }
  if (!looksLikePriorSharedUserHistory(summary)) return false;
  if (ATTRIBUTED_RELATIONSHIP_CLAIM_MARKER.test(summary)) return false;

  const userName = personaName;
  const summaryNamesUser =
    /(?:유저|사용자)/.test(summary) || (!!userName && summary.includes(userName));
  if (!summaryNamesUser) return false;

  return assistantSuppliesUnsupportedSharedHistoryDetail(
    summary,
    source.assistant,
    source.user
  );
}

const STRONG_UNCERTAIN_CLAIM =
  /(?:각성|폭주|등급\s*상승|정체|정체성|임신|중독|저주|기억상실|조종|세뇌|배신)/i;
const CLAIM_TOKEN_STOPWORDS = new Set([
  "현재", "상태", "사건", "상황", "진행", "미해결", "그는", "그녀", "자신",
  "유저", "사용자", "캐릭터", "말했다", "생각했다", "판단했다", "추측했다",
]);

function normalizeClaimToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/(?:이라고|라고|에게서|에서는|으로|에서|에게|까지|부터|처럼|이며|이고|은|는|이|가|을|를|의|에|와|과|도|만)$/u, "");
}

function significantClaimTokens(text: string): string[] {
  const matches = text.match(/[가-힣A-Za-z0-9_]{2,}/g) ?? [];
  return [
    ...new Set(
      matches
        .map(normalizeClaimToken)
        .filter((token) => token.length >= 2 && !CLAIM_TOKEN_STOPWORDS.has(token))
    ),
  ];
}

function splitDialogueSources(dialogue: string): { user: string; assistant: string } {
  const users: string[] = [];
  const assistants: string[] = [];
  const batchPattern = /\[\d+턴\]\s*\n유저:\s*([\s\S]*?)\n[^:\n]+:\s*([\s\S]*?)(?=\n\n\[\d+턴\]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = batchPattern.exec(dialogue))) {
    users.push(match[1] ?? "");
    assistants.push(match[2] ?? "");
  }
  return { user: users.join("\n"), assistant: assistants.join("\n") };
}

/** Conservative source check for known certainty inflation before DB persistence. */
export function isRollingSummaryGroundedInDialogue(
  summary: string,
  dialogue: string,
  userPersona?: string | null,
  charName?: string | null
): boolean {
  if (isLikelySummaryInstructionEcho(summary)) return false;

  const source = splitDialogueSources(dialogue);
  if (summaryInventsUnsupportedUserRelationship(summary, source, userPersona, charName)) {
    return false;
  }
  if (STRONG_GLOBAL_MEMORY_LOSS.test(summary) && !STRONG_GLOBAL_MEMORY_LOSS.test(dialogue)) {
    return false;
  }

  const uncertainAssistantParts = source.assistant
    .split(/(?<=[.!?。！？]|다\.)\s+|\n+/)
    .filter(
      (part) =>
        SOURCE_UNCERTAINTY_MARKER.test(part) && STRONG_UNCERTAIN_CLAIM.test(part)
    );
  const summaryParts = summary
    .split(/(?<=[.!?。！？]|다\.)\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of uncertainAssistantParts) {
    const assistantOnlyTerms = significantClaimTokens(part).filter(
      (token) => !source.user.includes(token)
    );
    const matchingSummaryParts = summaryParts.filter((summaryPart) =>
      assistantOnlyTerms.some((token) => summaryPart.includes(token))
    );
    if (
      matchingSummaryParts.some(
        (summaryPart) =>
          STRONG_UNCERTAIN_CLAIM.test(summaryPart) &&
          !EPISTEMIC_MARKER.test(summaryPart)
      )
    ) {
      return false;
    }
  }

  return true;
}

const SUMMARY_ITEM_PERSON = "([가-힣A-Za-z][가-힣A-Za-z0-9]{0,11})";
const SUMMARY_NAME_PARTICLE = "(?:은|는|이|가)";
const SUMMARY_SELF_WEAR_RE = new RegExp(
  `${SUMMARY_ITEM_PERSON}${SUMMARY_NAME_PARTICLE}\\s[^\\n.]{0,80}?자신의\\s[^\\n.]{0,48}?(?:손가락|약지|손목|목)[^\\n.]{0,24}?(?:끼워|끼웠|착용)`,
  "gu"
);
const SUMMARY_LATER_MADE_WEAR_RE = new RegExp(
  `${SUMMARY_ITEM_PERSON}의\\s(?:손가락|약지|손목|목)에는[^\\n.]{0,80}?직접\\s*만든[^\\n.]{0,32}`,
  "gu"
);
const SUMMARY_CONTINUED_OWNER_RE = new RegExp(
  `${SUMMARY_ITEM_PERSON}${SUMMARY_NAME_PARTICLE}\\s계속\\s소유(?:한\\s채)?`,
  "gu"
);
const SUMMARY_TRANSFER_RE =
  /([가-힣A-Za-z][가-힣A-Za-z0-9]{0,11})(?:에게|한테)\s*(?:건네|건넸|넘겨|넘겼|돌려|주었|줬|양도|맡겼)/u;
const SUMMARY_ITEM_HEADS = ["목걸이", "팔찌", "귀걸이", "브로치", "반지", "시계"] as const;
const SUMMARY_ITEM_TOKEN_STOP = new Set([
  "자신",
  "자신의",
  "왼쪽",
  "오른쪽",
  "번째",
  "손가락",
  "약지",
  "손목",
  "계속",
  "소유",
  "직접",
  "만든",
  "착용",
  "착용분",
  "원문",
  "확정",
  "같은",
  "이후",
  "몸에",
  "물건",
]);

export type SummaryItemRoleReason =
  | "unchanged"
  | "ambiguous_wear_clarified"
  | "continued_owner_contradicts_self_wear"
  | "ambiguous_multiple_wears"
  | "source_assigns_other_owner"
  | "non_factual_wear";

export type SummaryItemRoleReconciliation = {
  text: string;
  changed: boolean;
  reason: SummaryItemRoleReason;
  /** Set when a contradiction was visible but the source was not clear enough to rewrite. */
  report?: string;
};

type ItemPhrase = { head: string; modifiers: string[] };

type SourceWear = {
  wearer: string;
  phrases: ItemPhrase[];
  yieldedTo: string | null;
  nonFactual: boolean;
};

type SkipReason = "ambiguous_multiple_wears" | "source_assigns_other_owner" | "non_factual_wear";

function allPatternMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  pattern.lastIndex = 0;
  const found: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    found.push(match);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  pattern.lastIndex = 0;
  return found;
}

function stripSummaryParticle(token: string): string {
  return token.replace(
    /(?:으로|에서|에게|부터|까지|처럼|은|는|이|가|을|를|에|와|과|도|만)$/u,
    ""
  );
}

function summaryTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.match(/[가-힣]{2,}/g) ?? []) {
    const token = stripSummaryParticle(raw);
    if (token.length < 2 || SUMMARY_ITEM_TOKEN_STOP.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function itemHead(token: string): string | null {
  for (const head of SUMMARY_ITEM_HEADS) {
    if (token === head || token.endsWith(head)) return head;
  }
  return null;
}

function itemPhrases(text: string): ItemPhrase[] {
  const tokens = summaryTokens(text);
  const phrases: ItemPhrase[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const head = itemHead(token);
    if (!head) continue;
    const modifiers: string[] = [];
    for (let cursor = Math.max(0, index - 3); cursor < index; cursor += 1) {
      const previous = tokens[cursor] ?? "";
      if (!previous || itemHead(previous)) continue;
      modifiers.push(previous);
    }
    phrases.push({ head, modifiers });
  }
  return phrases;
}

function clauseMatchesWear(clause: readonly ItemPhrase[], wear: readonly ItemPhrase[]): boolean {
  return clause.some((phrase) =>
    wear.some((other) => {
      if (phrase.head !== other.head) return false;
      if (phrase.modifiers.length === 0) return true;
      return phrase.modifiers.every((modifier) => other.modifiers.includes(modifier));
    })
  );
}

function sentenceBounds(text: string, index: number): { start: number; end: number } {
  const marks = [".", "\n", "。", "!", "?"];
  let start = 0;
  const lookFrom = Math.max(0, index - 1);
  for (const mark of marks) {
    const found = text.lastIndexOf(mark, lookFrom);
    if (found + 1 > start) start = found + 1;
  }
  let end = text.length;
  for (const mark of marks) {
    const found = text.indexOf(mark, index);
    if (found >= 0 && found + 1 < end) end = found + 1;
  }
  return { start, end };
}

function isInsideQuote(text: string, index: number): boolean {
  const before = text.slice(0, index);
  if ((before.match(/「/g) ?? []).length > (before.match(/」/g) ?? []).length) return true;
  if ((before.match(/“/g) ?? []).length > (before.match(/”/g) ?? []).length) return true;
  return (before.match(/"/g) ?? []).length % 2 === 1;
}

function isNonFactualWear(text: string, index: number): boolean {
  if (isInsideQuote(text, index)) return true;
  const bounds = sentenceBounds(text, index);
  const sentence = text.slice(bounds.start, bounds.end);
  return /환각|망상|허구|꿈속|꿈에서|상상\s*속|것\s*같|었을\s*듯|을\s*듯|듯하|듯싶/u.test(sentence);
}

function transferName(fragment: string, wearer: string): string | null {
  const match = fragment.match(SUMMARY_TRANSFER_RE);
  const name = match?.[1] ?? "";
  if (!name || name === wearer) return null;
  return name;
}

function recipientAfterWear(
  source: string,
  wearEnd: number,
  wearer: string,
  phrases: readonly ItemPhrase[]
): string | null {
  const rest = source.slice(wearEnd, wearEnd + 160);
  const period = rest.search(/[.。\n]/u);
  const sameSentence = period < 0 ? rest : rest.slice(0, period);
  const sameRecipient = transferName(sameSentence, wearer);
  if (sameRecipient) return sameRecipient;
  if (period < 0) return null;
  const nextSentence = rest.slice(period + 1).split(/[.。\n]/u)[0] ?? "";
  const nextRecipient = transferName(nextSentence, wearer);
  if (!nextRecipient) return null;
  const nextPhrases = itemPhrases(nextSentence);
  if (!clauseMatchesWear(phrases, nextPhrases) && !clauseMatchesWear(nextPhrases, phrases)) return null;
  return nextRecipient;
}

function phrasesForWear(source: string, index: number): ItemPhrase[] {
  const bounds = sentenceBounds(source, index);
  const own = itemPhrases(source.slice(bounds.start, bounds.end));
  if (own.some((phrase) => phrase.modifiers.length > 0) || bounds.start <= 0) return own;
  const previousBounds = sentenceBounds(source, bounds.start - 1);
  const previousText = source.slice(previousBounds.start, previousBounds.end);
  if (allPatternMatches(SUMMARY_SELF_WEAR_RE, previousText).length > 0) return own;
  const inherited = itemPhrases(previousText);
  if (own.length === 0) return inherited;
  return own.map((phrase) => ({
    head: phrase.head,
    modifiers: [
      ...phrase.modifiers,
      ...inherited.filter((item) => item.head === phrase.head).flatMap((item) => item.modifiers),
    ],
  }));
}

function collectSourceWears(source: string): SourceWear[] {
  return allPatternMatches(SUMMARY_SELF_WEAR_RE, source).flatMap((match) => {
    const wearer = match[1] ?? "";
    const index = match.index ?? 0;
    if (!wearer) return [];
    const phrases = phrasesForWear(source, index);
    const nonFactual = isNonFactualWear(source, index);
    return [
      {
        wearer,
        phrases,
        nonFactual,
        yieldedTo: nonFactual ? null : recipientAfterWear(source, index + match[0].length, wearer, phrases),
      },
    ];
  });
}

function clauseItemText(summary: string, ownerStart: number): string {
  const before = summary.slice(0, ownerStart);
  let boundary = -1;
  for (const mark of [".", "\n", "。", ",", "，"]) {
    boundary = Math.max(boundary, before.lastIndexOf(mark));
  }
  return before.slice(boundary + 1);
}

function subjectParticle(name: string): "이" | "가" {
  const code = name.charCodeAt(name.length - 1);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

function escapeSummaryName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clarifyAmbiguousWear(summary: string, wear: SourceWear): { text: string; clarified: boolean } {
  let clarified = false;
  const pattern = new RegExp(
    `(${escapeSummaryName(wear.wearer)}${SUMMARY_NAME_PARTICLE}\\s[^\\n.]{0,32}?)끼(워|웠)`,
    "gu"
  );
  const text = summary.replace(pattern, (full, prefix: string, ending: string) => {
    if (prefix.includes("자신") || prefix.includes("손가락") || prefix.includes("약지")) return full;
    if (!clauseMatchesWear(itemPhrases(`${prefix}끼${ending}`), wear.phrases)) return full;
    clarified = true;
    return `${prefix}자신의 몸에 끼${ending}`;
  });
  return { text, clarified };
}

function laterHandmadePerson(
  source: string,
  wearer: string,
  clause: readonly ItemPhrase[]
): string | null {
  for (const match of allPatternMatches(SUMMARY_LATER_MADE_WEAR_RE, source)) {
    const person = match[1] ?? "";
    if (!person || person === wearer) continue;
    if (!clauseMatchesWear(clause, itemPhrases(match[0] ?? ""))) continue;
    return person;
  }
  return null;
}

function wearReplacement(wearer: string, laterPerson: string | null): string {
  const worn = `${wearer}${subjectParticle(wearer)} 자신의 몸에 착용함`;
  if (!laterPerson) return worn;
  return `${worn}. 이후 ${laterPerson}의 직접 만든 착용분이 같은 물건인지는 원문이 확정하지 않음`;
}

function skipReport(reason: SkipReason): string {
  switch (reason) {
    case "ambiguous_multiple_wears":
      return "같은 물건의 착용이 둘 이상이라 요약 원문을 유지함";
    case "source_assigns_other_owner":
      return "원문이 착용자와 다른 현재 소유자를 적어서 요약 원문을 유지함";
    case "non_factual_wear":
      return "인용·추측·환각 속 착용은 교정 근거가 아니라서 요약 원문을 유지함";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

function leadingSkip(reasons: readonly SkipReason[]): SkipReason | null {
  if (reasons.includes("ambiguous_multiple_wears")) return "ambiguous_multiple_wears";
  if (reasons.includes("source_assigns_other_owner")) return "source_assigns_other_owner";
  if (reasons.includes("non_factual_wear")) return "non_factual_wear";
  return null;
}

/**
 * Prompt/seal correction for one summary body against its own source turns.
 * Rewrites a continued-owner clause only when one factual self-wear uniquely
 * names that item. A later handmade wear stays an unconfirmed object.
 * Ambiguous, transferred, quoted, speculative, or hallucinated wears keep the original.
 */
export function reconcileSummaryItemRoles(
  summary: string,
  sourceDialogue: string
): SummaryItemRoleReconciliation {
  const wears = collectSourceWears(sourceDialogue);
  if (wears.length === 0) return { text: summary, changed: false, reason: "unchanged" };
  const factual = wears.filter((wear) => !wear.nonFactual && !wear.yieldedTo);
  let text = summary;
  let clarified = false;
  if (factual.length === 1) {
    const clarification = clarifyAmbiguousWear(text, factual[0]!);
    text = clarification.text;
    clarified = clarification.clarified;
  }

  const skips: SkipReason[] = [];
  const owners = allPatternMatches(SUMMARY_CONTINUED_OWNER_RE, text)
    .map((match) => {
      const start = match.index ?? 0;
      return {
        start,
        end: start + match[0].length,
        name: match[1] ?? "",
        itemText: clauseItemText(text, start),
      };
    })
    .filter((owner) => owner.name.length > 0)
    .sort((left, right) => right.start - left.start);

  let replaced = false;
  for (const owner of owners) {
    const clause = itemPhrases(owner.itemText);
    if (clause.length === 0) continue;
    const matching = factual.filter((wear) => clauseMatchesWear(clause, wear.phrases));
    const yielded = wears.filter(
      (wear) => !wear.nonFactual && wear.yieldedTo && clauseMatchesWear(clause, wear.phrases)
    );
    const discarded = wears.filter(
      (wear) => wear.nonFactual && clauseMatchesWear(clause, wear.phrases)
    );
    if (matching.length > 1) {
      skips.push("ambiguous_multiple_wears");
      continue;
    }
    if (matching.length === 1) {
      const wear = matching[0]!;
      if (wear.wearer === owner.name) continue;
      const laterPerson = laterHandmadePerson(sourceDialogue, wear.wearer, clause);
      const replacement = wearReplacement(wear.wearer, laterPerson);
      const after = text.slice(owner.end);
      const sentenceEnd = after.search(/[.]/u);
      text =
        sentenceEnd < 0
          ? `${text.slice(0, owner.start)}${replacement}${after}`
          : `${text.slice(0, owner.start)}${replacement}${after.slice(sentenceEnd)}`;
      replaced = true;
      continue;
    }
    if (yielded.length > 0) {
      skips.push("source_assigns_other_owner");
      continue;
    }
    if (discarded.length > 0) skips.push("non_factual_wear");
  }

  const skip = leadingSkip(skips);
  if (replaced) {
    return {
      text,
      changed: true,
      reason: "continued_owner_contradicts_self_wear",
      ...(skip ? { report: skipReport(skip) } : {}),
    };
  }
  if (clarified) return { text, changed: true, reason: "ambiguous_wear_clarified" };
  if (skip) return { text: summary, changed: false, reason: skip, report: skipReport(skip) };
  return { text: summary, changed: false, reason: "unchanged" };
}

/** Validate LLM / fixture summary before persist. */
export function validateSummaryNarrative(
  text: string,
  kind: SummaryKind | MemorySummaryScope = "main_canon"
):
  | { ok: true; text: string; kind: MemorySummaryScope }
  | { ok: false; reason: SummaryReasonCode } {
  const scope = normalizeSummaryScope(kind);

  if (scope === "empty_ooc") {
    return { ok: true, text: EMPTY_OOC_SUMMARY_MARKER, kind: "empty_ooc" };
  }

  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, reason: "SUMMARY_EMPTY" };
  if (isOocOnlyPlaceholderText(t)) return { ok: false, reason: "SUMMARY_INVALID" };
  if (isFallbackMemoryRecordSummary(t)) return { ok: false, reason: "SUMMARY_INVALID" };
  if (isLikelySummaryInstructionEcho(t)) return { ok: false, reason: "SUMMARY_INVALID" };

  const minChars =
    scope === "preference" || scope === "noncanon" || scope === "branch_canon"
      ? 12
      : ROLLING_SUMMARY_MIN_CHARS;
  if (t.length < minChars) return { ok: false, reason: "SUMMARY_INVALID" };
  if (/^(null|undefined|n\/a|none|empty)$/i.test(t)) {
    return { ok: false, reason: "SUMMARY_INVALID" };
  }
  return { ok: true, text: t, kind: scope };
}

export function parseRecentSummaryBatchStarts(recentSummary: string): number[] {
  const starts: number[] = [];
  const re = /\[(\d+)~\d+턴\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(recentSummary))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) starts.push(n);
  }
  return starts;
}

export function describeRecentSummaryBatchRange(recentSummary: string): string | null {
  const starts = parseRecentSummaryBatchStarts(recentSummary);
  if (starts.length === 0) return null;
  const first = Math.min(...starts);
  const lastStart = Math.max(...starts);
  const lastEndMatch = recentSummary.match(
    new RegExp(`\\[${lastStart}~(\\d+)턴\\]`)
  );
  const lastEnd = lastEndMatch ? Number(lastEndMatch[1]) : null;
  if (lastEnd == null || !Number.isFinite(lastEnd)) return null;
  return `${first}~${lastEnd}`;
}

export function buildSummaryBatchDiagnostics(opts: {
  chatId: number;
  records: BatchSpan[];
  playableTurnCount: number;
  summarizedTurnCount: number;
  recentSummary: string;
}): SummaryBatchDiag {
  const persistedBatchStarts = [
    ...new Set(
      activeMemoryRecords(opts.records)
        .map(normalizeSpan)
        .filter((r): r is ResolvedBatchSpan => r != null)
        .map((r) => r.turnStart)
    ),
  ].sort((a, b) => a - b);

  const highestContiguousTurn = highestContiguousCompletedTurn(
    opts.records,
    opts.playableTurnCount
  );
  const missingBatchStarts = missingContiguousBatchStarts(
    opts.records,
    opts.playableTurnCount
  );
  const recentSummaryBatchRange = describeRecentSummaryBatchRange(opts.recentSummary);

  let reasonCode: SummaryBatchDiag["reasonCode"] = "SUMMARY_OK";
  if (missingBatchStarts.length > 0) reasonCode = "SUMMARY_BATCH_GAP";
  else if (opts.summarizedTurnCount !== highestContiguousTurn) {
    reasonCode = "SUMMARY_COUNTER_DRIFT";
  }

  return {
    chatId: opts.chatId,
    persistedBatchStarts,
    missingBatchStarts,
    summarizedTurnCount: opts.summarizedTurnCount,
    highestContiguousTurn,
    recentSummaryBatchRange,
    reasonCode,
  };
}

export { resolveStoredTurnEnd } from "./memory-summary-range";
