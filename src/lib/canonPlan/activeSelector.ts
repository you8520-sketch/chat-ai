import { extractKeywords } from "@/lib/memory/memory-injector";
import type { CanonKnowledgeBucket } from "@/lib/characterKnowledgeBoundary";
import { isPublicVisibleChunk } from "@/lib/canonPlan/canonVisibility";
import type { CanonPlanChunk, CanonPlanV1 } from "@/lib/canonPlan/types";

export type ActiveSelectionInput = {
  plan: CanonPlanV1;
  userMessage: string;
  /** Bounded recent scene context (last N turns, joined). Used ONLY as a gated bridge. */
  recentContext?: string;
  /** Structured recent turns (same bound) for open-question detection. */
  recentTurns?: { role: string; content: string }[];
  sceneKeywords?: string[];
  budgetChars?: number;
};

export type ActiveSelectionGateReason =
  | "CURRENT_CANON_MATCH"
  | "ACTION_MARKER"
  | "RECENT_USER"
  | "OPEN_QUESTION"
  | "NONE";

export type ActiveSelectionReason = {
  chunkId: string;
  currentScore: number;
  recentScore: number;
  recentBridgeOnly: boolean;
};

export type ActiveSelectionResult = {
  activeChunks: CanonPlanChunk[];
  activeChars: number;
  budgetChars: number;
  keywords: string[];
  currentUserKeywordCount: number;
  recentContextUsed: boolean;
  recentContextGateReason: ActiveSelectionGateReason;
  candidateCount: number;
  eligibleAfterBoundaryCount: number;
  selectedCount: number;
  selectedChars: number;
  selectedIds: string[];
  reasons: ActiveSelectionReason[];
};

const ACTIVE_RESTRICTED_BUCKETS: ReadonlySet<CanonKnowledgeBucket> = new Set([
  "player",
  "scenario_meta",
]);

const ACTIVE_STOPWORDS = new Set(["이름", "하고"]);

const ACTIVE_INELIGIBLE_SECTION = /(?:예시\s*대(?:사|화)|example\s*dialog)/i;

const UBIQUITOUS_DF_RATIO = 0.2;
const UBIQUITOUS_DF_MIN = 3;

function filterActiveKeywords(kw: string[]): string[] {
  return kw.filter((k) => !ACTIVE_STOPWORDS.has(k) && k.length >= 2);
}

function tokenStem(token: string): string {
  const stripped = token.replace(
    /(?:한테|에게|께|으로|로서|에서|부터|까지|처럼|같이|[은는이가을를의에와과도만])$/,
    ""
  );
  return stripped.length >= 2 ? stripped : "";
}

function koreanLooseTokenHit(haystack: string, token: string): boolean {
  const stem = tokenStem(token);
  if (stem.length < 2) return false;
  return haystack.includes(stem) || haystack.includes(token);
}

function chunkSearchText(chunk: CanonPlanChunk): string {
  return `${chunk.sectionTitle}\n${chunk.text}`.toLowerCase();
}

/** Entity anchors from profile-style titles such as `[Name(alias)]`. */
export function sectionEntityAnchors(sectionTitle: string): string[] {
  const bracket = sectionTitle.match(/^\[([^\]]+)\]/);
  if (!bracket?.[1]) return [];
  const inner = bracket[1].trim();
  const anchors: string[] = [];
  const beforeParen = inner.split("(")[0]?.trim() ?? "";
  if (beforeParen.length >= 2) anchors.push(beforeParen.toLowerCase());
  const paren = inner.match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    for (const part of paren[1].split(/[/／,·]/)) {
      const p = part.trim().toLowerCase();
      if (p.length >= 2 && !/^(?:코드네임|codename|code)$/i.test(p)) anchors.push(p);
    }
  }
  return [...new Set(anchors)];
}

function userCueMentionsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => n.length >= 2 && koreanLooseTokenHit(lower, n));
}

const CATEGORY_SECTION_PREFIX =
  /^(?:세계관|정체성|이름|성명|외형|외모|체형|의상|성격|말투|능력|배경|과거|관계|가족|직업|시스템|불변|예시|identity|name|world|personality|speech|abilities|background|history|family)/i;

function isProfileEntitySection(sectionTitle: string): boolean {
  const bracket = sectionTitle.match(/^\[([^\]]+)\]/);
  if (!bracket?.[1]) return false;
  const inner = bracket[1].trim();
  if (CATEGORY_SECTION_PREFIX.test(inner)) return false;
  if (/\([^)]+\)/.test(inner)) return sectionEntityAnchors(sectionTitle).length > 0;
  const head = inner.split(/[—–\-]/)[0]?.trim() ?? inner;
  return head.length >= 2 && head.length <= 16 && !/\s/.test(head);
}

function publicPlanChunks(plan: CanonPlanV1): CanonPlanChunk[] {
  return plan.chunks.filter(
    (c) => !ACTIVE_RESTRICTED_BUCKETS.has(c.bucket) && isPublicVisibleChunk(c.visibility)
  );
}

function eligibleActiveChunks(plan: CanonPlanV1): CanonPlanChunk[] {
  const coreSet = new Set(plan.coreIds);
  return publicPlanChunks(plan).filter(
    (c) =>
      !coreSet.has(c.id) &&
      c.salience !== "core" &&
      !ACTIVE_INELIGIBLE_SECTION.test(c.sectionTitle)
  );
}

function documentFrequency(chunks: CanonPlanChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const seen = new Set(filterActiveKeywords(extractKeywords(chunkSearchText(chunk))));
    for (const token of seen) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return df;
}

function tokenDocumentCount(
  token: string,
  chunks: CanonPlanChunk[],
  df: Map<string, number>
): number {
  const exact = df.get(token);
  if (exact != null) return exact;
  let count = 0;
  for (const chunk of chunks) {
    if (koreanLooseTokenHit(chunkSearchText(chunk), token)) count += 1;
  }
  return count;
}

function titleDocumentCount(token: string, chunks: CanonPlanChunk[]): number {
  const titles = new Set<string>();
  for (const chunk of chunks) {
    const title = chunk.sectionTitle.toLowerCase();
    if (koreanLooseTokenHit(title, token)) titles.add(title);
  }
  return titles.size;
}

function tokenInformativeness(
  token: string,
  chunks: CanonPlanChunk[],
  df: Map<string, number>
): number {
  const stem = tokenStem(token);
  if (stem.length < 2) return 0;
  const n = Math.max(1, chunks.length);
  const d = tokenDocumentCount(token, chunks, df);
  if (d <= 0) return 0;
  const ratio = d / n;
  if (ratio >= UBIQUITOUS_DF_RATIO && d >= UBIQUITOUS_DF_MIN) return 0;
  if (d === 1) return stem.length >= 3 ? 3 : 2;
  if (d === 2 || ratio <= 0.12) return 2;
  return 1;
}

type TokenScore = { score: number; distinctiveHits: number; titleOrAnchorHit: boolean };

function scoreChunkTokens(
  chunk: CanonPlanChunk,
  tokens: string[],
  eligible: CanonPlanChunk[],
  df: Map<string, number>
): TokenScore {
  const hay = chunkSearchText(chunk);
  const titleLower = chunk.sectionTitle.toLowerCase();
  const anchors = sectionEntityAnchors(chunk.sectionTitle);
  let score = 0;
  let distinctiveHits = 0;
  let titleOrAnchorHit = false;
  for (const token of tokens) {
    const stem = tokenStem(token);
    const titleHit = koreanLooseTokenHit(titleLower, token);
    const bodyHit = koreanLooseTokenHit(hay, token);
    if (!bodyHit && !titleHit) continue;
    const dfWeight = tokenInformativeness(token, eligible, df);
    const uniqueTitle = titleHit && titleDocumentCount(token, eligible) <= 1;
    const weight = uniqueTitle && stem.length >= 2 ? Math.max(dfWeight, 2) : dfWeight;
    if (weight <= 0) continue;
    score += weight * (titleHit ? 3 : 2);
    const concentrated = tokenDocumentCount(token, eligible, df) === 1 && stem.length >= 2;
    if (weight >= 2 && (titleHit || stem.length >= 3 || concentrated)) distinctiveHits += 1;
    const anchorHit = anchors.some((a) => koreanLooseTokenHit(token, a) || koreanLooseTokenHit(a, token));
    if (anchorHit || uniqueTitle) titleOrAnchorHit = true;
  }
  if (userCueMentionsAny(tokens.join(" "), anchors)) titleOrAnchorHit = true;
  return { score, distinctiveHits, titleOrAnchorHit };
}

function activationScore(
  chunk: CanonPlanChunk,
  tokens: string[],
  userMessage: string,
  eligible: CanonPlanChunk[],
  df: Map<string, number>
): number {
  if (isProfileEntitySection(chunk.sectionTitle)) {
    const anchors = sectionEntityAnchors(chunk.sectionTitle);
    if (!userCueMentionsAny(userMessage, anchors)) return 0;
  }
  const { score, distinctiveHits, titleOrAnchorHit } = scoreChunkTokens(
    chunk,
    tokens,
    eligible,
    df
  );
  if (distinctiveHits === 0) return 0;
  if (titleOrAnchorHit) return score;
  if (distinctiveHits >= 2) return score;
  const strongRare = tokens.some((t) => {
    if (tokenStem(t).length < 3) return false;
    const d = tokenDocumentCount(t, eligible, df);
    return (
      d > 0 &&
      d <= 2 &&
      tokenInformativeness(t, eligible, df) >= 2 &&
      koreanLooseTokenHit(chunkSearchText(chunk), t)
    );
  });
  return strongRare ? score : 0;
}

const QUESTION_MARKERS = ["?", "？", "뭐", "왜", "어떻", "누구", "언제", "니$", "나$", "어$", "까$"];

function cueHasQuestionMarker(cue: string): boolean {
  return QUESTION_MARKERS.some(
    (m) => cue.includes(m) || cue.trim().endsWith(m.replace("$", ""))
  );
}

/** Immediately preceding user turn only — older user turns are not activation evidence. */
function recentUserAuthoredText(recentTurns?: { role: string; content: string }[]): string {
  if (!recentTurns?.length) return "";
  for (let i = recentTurns.length - 1; i >= 0; i -= 1) {
    const turn = recentTurns[i];
    if (turn.role === "user" && turn.content.trim()) return turn.content.trim();
  }
  return "";
}

function isAnaphoricUserCue(userMessage: string): boolean {
  const compact = userMessage.replace(/\s+/g, "");
  if (compact.length === 0 || compact.length > 36) return false;
  if (/(?:그(?:런|거|건|사람|이|게|냥)?|왜|어떻|누구|언제|뭐)/.test(compact)) return true;
  return cueHasQuestionMarker(userMessage) && compact.length <= 24;
}

/**
 * ACTIVE selector — plan-local token rarity + user-authored evidence only.
 *
 * Assistant history never independently activates dormant canon.
 * OPEN_QUESTION is not a global dormant gate.
 */
export function selectActiveCanonChunks(input: ActiveSelectionInput): ActiveSelectionResult {
  const budgetChars = input.budgetChars ?? input.plan.retrieval.activeBudgetChars;
  const eligible = eligibleActiveChunks(input.plan);
  const df = documentFrequency(publicPlanChunks(input.plan));

  const currentUserKw = filterActiveKeywords([
    ...new Set([
      ...extractKeywords(input.userMessage),
      ...(input.sceneKeywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean),
    ]),
  ]);

  const recentUserText = recentUserAuthoredText(input.recentTurns);
  const recentUserKw = filterActiveKeywords(extractKeywords(recentUserText)).filter(
    (k) => !currentUserKw.includes(k)
  );

  const currentScores = new Map<string, number>();
  for (const chunk of eligible) {
    currentScores.set(
      chunk.id,
      activationScore(chunk, currentUserKw, input.userMessage, eligible, df)
    );
  }

  const currentMatch = [...currentScores.values()].some((s) => s > 0);
  const thinCue = isAnaphoricUserCue(input.userMessage);

  const recentUserScores = new Map<string, number>();
  if (!currentMatch && thinCue && recentUserKw.length > 0) {
    for (const chunk of eligible) {
      recentUserScores.set(
        chunk.id,
        activationScore(chunk, recentUserKw, recentUserText, eligible, df)
      );
    }
  }

  const recentUserMatch = [...recentUserScores.values()].some((s) => s > 0);

  let recentContextGateReason: ActiveSelectionGateReason = "NONE";
  if (currentMatch) recentContextGateReason = "CURRENT_CANON_MATCH";
  else if (recentUserMatch) recentContextGateReason = "RECENT_USER";

  const reasons: ActiveSelectionReason[] = [];
  const ranked = eligible
    .map((chunk) => {
      const currentScore = currentScores.get(chunk.id) ?? 0;
      const recentScore = recentUserScores.get(chunk.id) ?? 0;
      const finalScore = currentScore > 0 ? currentScore : recentScore;
      if (finalScore > 0) {
        reasons.push({
          chunkId: chunk.id,
          currentScore,
          recentScore,
          recentBridgeOnly: currentScore <= 0 && recentScore > 0,
        });
      }
      return { chunk, score: finalScore };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.chunk.order - b.chunk.order || a.chunk.id.localeCompare(b.chunk.id)
    );

  const activeChunks: CanonPlanChunk[] = [];
  let activeChars = 0;
  for (const { chunk, score } of ranked) {
    if (score <= 0) continue;
    const next = activeChars + chunk.text.length;
    if (activeChunks.length > 0 && next > budgetChars) break;
    if (chunk.text.length > budgetChars && activeChunks.length === 0) {
      activeChunks.push(chunk);
      activeChars = chunk.text.length;
      break;
    }
    activeChunks.push(chunk);
    activeChars = next;
  }

  return {
    activeChunks,
    activeChars,
    budgetChars,
    keywords: currentUserKw,
    currentUserKeywordCount: currentUserKw.length,
    recentContextUsed: recentUserMatch,
    recentContextGateReason,
    candidateCount: input.plan.chunks.length,
    eligibleAfterBoundaryCount: eligible.length,
    selectedCount: activeChunks.length,
    selectedChars: activeChars,
    selectedIds: activeChunks.map((c) => c.id),
    reasons,
  };
}

export function isActiveSelectionEmpty(result: ActiveSelectionResult): boolean {
  return result.activeChunks.length === 0;
}
