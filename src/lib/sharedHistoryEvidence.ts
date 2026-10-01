/**
 * Canonical source-evidence scope for PRE-EXISTING user↔cast shared history.
 *
 * This helper owns evidence granularity only. Generation semantics stay in
 * historicalTruthPolicy.ts. Summary/episodic layers reuse this owner so a broad
 * user statement cannot validate assistant-invented specifics.
 */

const HARD_PRIOR_SHARED_RELATIONSHIP_CUE =
  /(?:만난\s*적|아는\s*사이|알던\s*사이|안부.{0,12}(?:전해|전하|부탁)|전에.{0,24}(?:만났|함께|약속|알았|연락)|예전에.{0,24}(?:만났|함께|약속|알았|연락)|지난번.{0,24}(?:만났|함께|약속|알았|연락)|그때\s*우리|네가\s*약속했|(?:유저|사용자).{0,18}(?:친분|인연|관계))/i;

const PRIOR_SHARED_HISTORY_CUE =
  /(?:첫\s*만남|만난\s*(?:뒤|후)|이후|만난\s*적|아는\s*사이|알던\s*사이|안부.{0,12}(?:전해|전하|부탁)|네가\s*약속했|전에|예전에|지난번|저번(?:에)?|어제|그때|아까|몇\s*(?:차례|번)|여러\s*번|그동안|(?:유저|사용자).{0,18}(?:친분|인연|관계))/i;

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
  "했다",
  "했어",
  "했고",
  "있다",
  "있어",
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

function normalizedCompact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

function matchingClaimTokens(claimText: string, sourceText: string): string[] {
  const source = normalizedCompact(sourceText);
  return sharedHistorySupportTokens(claimText).filter(
    (token) => token.length >= 2 && source.includes(normalizedCompact(token))
  );
}

export function looksLikePriorSharedUserHistory(text: string): boolean {
  return PRIOR_SHARED_HISTORY_CUE.test(text);
}

export function looksLikeHardPriorSharedUserRelationship(text: string): boolean {
  return HARD_PRIOR_SHARED_RELATIONSHIP_CUE.test(text);
}

/**
 * Evidence is bounded to the detail the user actually supplied.
 * "몇 차례 임무를 함께했다" supports that broad history, not a specific gate,
 * line of dialogue, meal, purchase, or visit.
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
  const matched = matchingClaimTokens(claimText, user);

  // Two concrete overlaps are the minimum evidence for a derived shared-history
  // sentence. Broad temporal words alone are intentionally insufficient.
  return matched.length >= Math.min(2, claimTokens.length);
}

/**
 * True when a prior/shared-history summary contains concrete detail that is
 * absent from USER evidence but present in ASSISTANT prose.
 *
 * This does not require the assistant sentence to contain a fixed temporal
 * keyword. That avoids missing lines such as "그 브레이크 진입 때 내가..." where
 * the event is plainly past context but a regex may not match the exact phrasing.
 */
export function assistantSuppliesUnsupportedSharedHistoryDetail(
  claimText: string,
  assistantText: string,
  userText: string
): boolean {
  if (!looksLikePriorSharedUserHistory(claimText)) return false;
  if (userTextSupportsPriorSharedHistoryClaim(claimText, userText)) return false;

  const assistantMatches = matchingClaimTokens(claimText, assistantText);
  if (assistantMatches.length === 0) return false;

  const userCompact = normalizedCompact(userText);
  const assistantOnly = assistantMatches.filter(
    (token) => !userCompact.includes(normalizedCompact(token))
  );

  if (assistantOnly.length >= 2) return true;
  return assistantOnly.some((token) => token.length >= 4);
}

function oocBody(text: string): string | null {
  const match = text.match(/(?:^|\n)\s*OOC\s*:\s*([^\n]+)/iu);
  return match?.[1]?.trim() || null;
}

/**
 * Literal current-user historical setup only. No model/NLP inference.
 * The exact historical-looking OOC clause is preserved so the generation layer
 * can carry its abstraction level without fabricating missing specifics.
 */
export function extractExplicitSharedHistoryScope(
  text: string | null | undefined
): string[] {
  const body = oocBody(text ?? "");
  if (!body) return [];
  return body
    .split(/(?<=[.!?。！？])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((sentence) => looksLikePriorSharedUserHistory(sentence))
    .slice(0, 4);
}
