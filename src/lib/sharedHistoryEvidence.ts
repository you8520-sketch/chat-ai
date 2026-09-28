/**
 * Canonical source-evidence scope for PRE-EXISTING user↔cast shared history.
 *
 * This helper does not decide whether a current-scene event may happen.
 * It only answers whether a claim is framed as history that predates the
 * current scene/turn, and whether RAW user text independently supports the
 * same level of detail.
 *
 * Generation-time prose semantics live in historicalTruthPolicy.ts; rolling
 * summaries and episodic persistence consume this helper so they do not grow
 * separate relationship-history heuristics.
 */

const HARD_PRIOR_SHARED_RELATIONSHIP_CUE =
  /(?:만난\s*적|아는\s*사이|알던\s*사이|안부.{0,12}(?:전해|전하|부탁)|전에.{0,24}(?:만났|함께|약속|알았|연락)|예전에.{0,24}(?:만났|함께|약속|알았|연락)|지난번.{0,24}(?:만났|함께|약속|알았|연락)|그때\s*우리|네가\s*약속했|(?:유저|사용자).{0,18}(?:친분|인연|관계))/i;

const PRIOR_SHARED_HISTORY_CUE =
  /(?:만난\s*적|아는\s*사이|알던\s*사이|안부.{0,12}(?:전해|전하|부탁)|네가\s*약속했|전에|예전에|지난번|저번(?:에)?|어제|그때|아까|몇\s*(?:차례|번)|그동안|그.{1,30}때|(?:유저|사용자).{0,18}(?:친분|인연|관계))/i;

const SUPPORT_STOPWORDS = new Set([
  "유저",
  "사용자",
  "우리",
  "너랑",
  "너하고",
  "네가",
  "함께",
  "같이",
  "관계",
  "인연",
  "친분",
  "약속",
]);

function normalizeSupportToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(
      /(?:이랑|랑|하고|에게서|으로서|으로|에서|에게|께서|부터|까지|처럼|보다|은|는|이|가|을|를|의|에|와|과|도|만|로)$/u,
      ""
    )
    .replace(/(?:했잖아|했잖|했다가|했다|했어|했고|함)$/u, "");
}

export function sharedHistorySupportTokens(text: string): string[] {
  return [
    ...new Set(
      (text.match(/[가-힣A-Za-z0-9_]{2,}/g) ?? [])
        .map(normalizeSupportToken)
        .filter((token) => token.length >= 2 && !SUPPORT_STOPWORDS.has(token))
    ),
  ];
}

export function looksLikePriorSharedUserHistory(text: string): boolean {
  return PRIOR_SHARED_HISTORY_CUE.test(text);
}

/**
 * Conservative legacy/read-time detector. Use this only when the RAW user
 * source is unavailable, so old stored milestones are not guessed invalid.
 */
export function looksLikeHardPriorSharedUserRelationship(text: string): boolean {
  return HARD_PRIOR_SHARED_RELATIONSHIP_CUE.test(text);
}

/**
 * User evidence is bounded to the detail it actually contains.
 *
 * Two meaningful token overlaps are required for a multi-token claim. This
 * preserves directly user-confirmed history while preventing a broad source
 * such as "몇 차례 임무를 함께했다" from validating assistant-only details like
 * a specific 브레이크 entry, action, line, purchase, meal, or market visit.
 */
export function userTextSupportsPriorSharedHistoryClaim(
  claimText: string,
  userText: string
): boolean {
  if (!looksLikePriorSharedUserHistory(claimText)) return true;

  const user = userText.trim();
  if (!user) return false;

  const claimTokens = sharedHistorySupportTokens(claimText);
  if (claimTokens.length === 0) return false;
  const userTokens = new Set(sharedHistorySupportTokens(user));
  const overlap = claimTokens.filter((token) => userTokens.has(token)).length;
  return overlap >= Math.min(2, claimTokens.length);
}
