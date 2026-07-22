import { extractKeywords } from "@/lib/memory/memory-injector";
import type { CanonKnowledgeBucket } from "@/lib/characterKnowledgeBoundary";
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
  /** AR-A3 observability — bounded metadata only, no raw restricted text. */
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

// B1 — knowledge-restricted buckets excluded from ACTIVE runtime selection.
// Chunks remain in the CanonPlan/DB unchanged; only excluded from ACTIVE selection.
const ACTIVE_RESTRICTED_BUCKETS: ReadonlySet<CanonKnowledgeBucket> = new Set([
  "player",
  "scenario_meta",
]);

// B2 — minimal generic-token / stopword guard. Only the AR0-confirmed true false
// positives. Applied to ACTIVE keyword sets only; the shared production
// extractKeywords is NOT modified, so Archive retrieval is untouched.
const ACTIVE_STOPWORDS = new Set(["이름", "하고"]);

function filterActiveKeywords(kw: string[]): string[] {
  return kw.filter((k) => !ACTIVE_STOPWORDS.has(k));
}

function scoreChunkRelevance(chunk: CanonPlanChunk, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = chunk.text.toLowerCase();
  const titleLower = chunk.sectionTitle.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) score += 2;
    else if (titleLower.includes(keyword)) score += 1;
  }
  return score;
}

// Korean-aware loose token hit — byte-identical to archiveSelective.koreanLooseTokenHit
// (local copy; the production helper is not exported). Trims trailing 1–2 chars so
// particle-laden tokens (e.g. "실종이라") still match a stem ("실종").
function koreanLooseTokenHit(haystack: string, token: string): boolean {
  if (token.length < 2) return false;
  if (haystack.includes(token)) return true;
  if (token.length >= 3 && haystack.includes(token.slice(0, token.length - 1))) return true;
  if (token.length >= 4 && haystack.includes(token.slice(0, token.length - 2))) return true;
  return false;
}

function eligibleActiveChunks(plan: CanonPlanV1): CanonPlanChunk[] {
  const coreSet = new Set(plan.coreIds);
  return plan.chunks.filter(
    (c) =>
      !coreSet.has(c.id) &&
      c.salience !== "core" &&
      !ACTIVE_RESTRICTED_BUCKETS.has(c.bucket)
  );
}

// AR-A3 gate markers — exact AR0 replay-harness definitions (do not invent heuristics).
const ACTION_MARKERS = [
  "쏘", "숨어", "숨자", "함정", "판단", "조심", "위험", "도려", "엄폐", "철수", "공격", "저격", "사격",
];
const QUESTION_MARKERS = ["?", "？", "뭐", "왜", "어떻", "누구", "언제", "니$", "나$", "어$", "까$"];

function cueHasQuestionMarker(cue: string): boolean {
  return QUESTION_MARKERS.some(
    (m) => cue.includes(m) || cue.trim().endsWith(m.replace("$", ""))
  );
}

function hasOpenQuestion(
  userMessage: string,
  recentTurns?: { role: string; content: string }[]
): boolean {
  if (cueHasQuestionMarker(userMessage)) return true;
  if (recentTurns && recentTurns.length) {
    const lastUser = [...recentTurns].reverse().find((m) => m.role === "user");
    if (lastUser && QUESTION_MARKERS.some((m) => lastUser.content.includes(m))) return true;
  }
  return false;
}

/**
 * ACTIVE canon selector (AR-A3 patch).
 *
 * Evidence model:
 * - Current user message is the PRIMARY scoring source (body +2 / title +1 substring).
 * - Bounded recent scene context is a BRIDGE only, gated by
 *   `currentCanonMatch || actionMarker || hasOpenQuestion`. When the gate is NONE,
 *   recent context contributes nothing and behavior is identical to the legacy
 *   current-user-only selector (plus B1/B2 safety).
 * - B1 excludes `player` + `scenario_meta` buckets at eligibility (before scoring).
 * - B2 drops the AR0-confirmed generic tokens ("이름", "하고") from ACTIVE keywords.
 *
 * ACTIVE=0 is valid and must not imply FULL canon fallback. `activeMaxChars` is a
 * ceiling, not a quota; `selected=0` is a legal, expected result for quiet scenes.
 */
export function selectActiveCanonChunks(input: ActiveSelectionInput): ActiveSelectionResult {
  const budgetChars = input.budgetChars ?? input.plan.retrieval.activeBudgetChars;

  // Primary evidence — current-user keywords (B2 stopword guard applied).
  const currentUserKw = filterActiveKeywords([
    ...new Set([
      ...extractKeywords(input.userMessage),
      ...(input.sceneKeywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean),
    ]),
  ]);

  // Bridge evidence — bounded recent scene context (B2 applied, deduped vs current).
  const recentKwAll = input.recentContext ? filterActiveKeywords(extractKeywords(input.recentContext)) : [];
  const currentSet = new Set(currentUserKw);
  const recentKw = recentKwAll.filter((k) => !currentSet.has(k));

  const eligible = eligibleActiveChunks(input.plan);

  // AR-A3 gate: the recent bridge fires only when the current cue signals an
  // active scene. Old-history canon keywords alone MUST NOT reactivate dormant lore.
  const canonMatch = eligible.some((c) => scoreChunkRelevance(c, currentUserKw) > 0);
  const action = ACTION_MARKERS.some((m) => input.userMessage.includes(m));
  const question = hasOpenQuestion(input.userMessage, input.recentTurns);
  const gateOn = canonMatch || action || question;
  const recentContextGateReason: ActiveSelectionGateReason = canonMatch
    ? "CURRENT_CANON_MATCH"
    : action
      ? "ACTION_MARKER"
      : question
        ? "OPEN_QUESTION"
        : "NONE";

  const reasons: ActiveSelectionReason[] = [];
  const ranked = eligible
    .map((chunk) => {
      const currentScore = scoreChunkRelevance(chunk, currentUserKw);
      const lower = chunk.text.toLowerCase();
      let recentScore = 0;
      if (gateOn) {
        for (const k of recentKw) if (koreanLooseTokenHit(lower, k)) recentScore += 1;
      }
      let score = currentScore > 0 ? currentScore : 0;
      let gate = currentScore > 0;
      if (gateOn) {
        score += recentScore;
        gate = gate || recentScore >= 2;
      }
      const finalScore = gate ? score : 0;
      if (finalScore > 0) {
        reasons.push({
          chunkId: chunk.id,
          currentScore,
          recentScore,
          recentBridgeOnly: gateOn && currentScore <= 0 && recentScore >= 2,
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
    recentContextUsed: gateOn && recentKw.length > 0 && reasons.some((r) => r.recentScore > 0),
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
