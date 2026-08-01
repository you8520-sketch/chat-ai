/**
 * Primary-focus / NPC-fanout evaluator for World-Motion V1.1.1.
 * Used by tests and API-gate harness — not injected into production prompts.
 */

export type PrimaryFocusEvalInput = {
  prose: string;
  primaryCharacter: string;
  /** Known supporting names already in the cast/scene (optional). */
  knownSupportingNames?: string[];
  /**
   * When ensemble/simulation, established multi-speaker dialogue is expected.
   * Fanout still flags disposable background role cascades.
   */
  sceneCastMode?: "single_primary" | "ensemble" | "simulation";
};

export type PrimaryFocusEvalResult = {
  primaryCharacter: string;
  primaryCharacterDialogueBlocks: number;
  supportingSpeakingNpcCount: number;
  supportingNpcDialogueBlocks: number;
  newSupportingNpcCount: number;
  backgroundDialogueBlocks: number;
  primaryFocusDiluted: boolean;
  npcFanoutDetected: boolean;
  supportingSpeakers: string[];
  reasonCodes: string[];
};

const QUOTE_RE = /[“"「『]([^”"»』]{1,240})[”"»』]/g;

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function nameVariants(name: string): string[] {
  const n = normalizeName(name);
  if (!n) return [];
  const out = new Set<string>([n]);
  // Common short forms: 윤태건 -> 태건
  if (n.length >= 3) out.add(n.slice(-2));
  if (n.length >= 4) out.add(n.slice(-3));
  return [...out].filter((x) => x.length >= 2);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countAttributedDialogue(prose: string, names: string[]): number {
  let count = 0;
  const variants = names.flatMap(nameVariants);
  // Opening quotes: " 「 『   Closing quotes: " 」 』
  const OPEN = "[“「『]";
  const CLOSE = "[”」』]";
  for (const v of variants) {
    // Name as subject of an explicit said verb (allow a short adverb gap, e.g. "낮게 말했다").
    const reSaid = new RegExp(
      `${escapeRegExp(v)}(?:이|가|은|는)?[^.\\n]{0,18}(?:말했|되물었|물었|대답했|외쳤|중얼거렸|혀를 찼)`,
      "g"
    );
    count += (prose.match(reSaid) || []).length;
    // Name immediately before an opening direct speech quote — tight window so a name
    // mentioned in narration is not mistaken for the speaker of a later quote.
    const reNear = new RegExp(`${escapeRegExp(v)}(?:이|가|은|는|\\s){0,4}${OPEN}`, "g");
    count += (prose.match(reNear) || []).length;
    // Post-attribution: a CLOSING quote followed shortly by the name + particle
    // (e.g. ”라이크.”\n태건은 ... 서 있었다). Only closing quotes — opening quotes
    // with a name inside are the speaker's own mention, not post-attribution.
    // Allow newlines since Korean RP often puts attribution on the next line.
    const rePost = new RegExp(`${CLOSE}[\\s\\S]{0,40}?${escapeRegExp(v)}(?:이|가|은|는)?`, "g");
    count += (prose.match(rePost) || []).length;
  }
  return count;
}

function collectNamedSpeakers(
  prose: string,
  primary: string,
  known: string[]
): { primaryBlocks: number; supporting: Map<string, number>; backgroundBlocks: number } {
  const primaryBlocks = countAttributedDialogue(prose, [primary]);
  const supporting = new Map<string, number>();
  for (const name of known) {
    if (!name || name === primary) continue;
    const blocks = countAttributedDialogue(prose, [name]);
    if (blocks > 0) supporting.set(normalizeName(name), blocks);
  }

  // Background role labels that speak with quotes nearby.
  let backgroundBlocks = 0;
  const bgLabels = ["직원", "가이드", "센티넬", "담당자", "안내 직원", "데스크"];
  for (const label of bgLabels) {
    // Tight window — role label must be the immediate speaker (label + particle + opening quote).
    const near = (
      prose.match(new RegExp(`${escapeRegExp(label)}(?:이|가)?\\s*["“「『]`, "g")) || []
    ).length;
    const said = (
      prose.match(
        new RegExp(
          `${escapeRegExp(label)}(?:이|가)?\\s*(?:말했|물었|대답했|외쳤|인사했|불렀|전했|알렸)`,
          "g"
        )
      ) || []
    ).length;
    // Post-attribution: closing quote followed shortly by the role label (allow newlines).
    const post = (
      prose.match(
        new RegExp(`["”」』][\\s\\S]{0,40}?${escapeRegExp(label)}(?:이|가|은|는)?`, "g")
      ) || []
    ).length;
    backgroundBlocks += near + said + post;
  }

  // Anonymous multi-voice gossip as background dialogue pressure.
  // Require actual quoted gossip exchange — not just keyword mentions in narration.
  const gossipQuotes = (
    prose.match(
      /[""「][^""」]{1,120}?(?:저 (?:카드|사람)|벌써\?|신입이면|가이드라며|신입)[^""」]{0,40}[""」]/g
    ) ?? []
  ).length;
  if (gossipQuotes >= 1) backgroundBlocks += 2;

  return { primaryBlocks, supporting, backgroundBlocks };
}

/**
 * Heuristic focus/fanout score for Korean long-form RP prose.
 * Speakers are attributed via primary/known names — not arbitrary tokens before quotes.
 */
export function evaluatePrimaryFocus(input: PrimaryFocusEvalInput): PrimaryFocusEvalResult {
  const primary = normalizeName(input.primaryCharacter);
  const prose = input.prose ?? "";
  const known = (input.knownSupportingNames ?? [])
    .map(normalizeName)
    .filter((n) => n && n !== primary);

  const { primaryBlocks, supporting, backgroundBlocks } = collectNamedSpeakers(
    prose,
    primary,
    known
  );

  let primaryDialogue = primaryBlocks;
  const quoteCount = [...prose.matchAll(QUOTE_RE)].length;
  if (primaryDialogue === 0 && quoteCount > 0 && prose.includes(primary)) {
    primaryDialogue = Math.max(1, Math.round(quoteCount * 0.35));
  }

  const supportingSpeakers = [...supporting.keys()];
  let supportingBlocks = 0;
  for (const n of supportingValues(supporting)) supportingBlocks += n;

  // New supporting: background role speakers not in known cast.
  const newSupportingNpcCount =
    backgroundBlocks > 0
      ? Math.min(
          3,
          (prose.match(/직원이|가이드가|센티넬이|담당자가|안내 직원이/g) || []).length
        )
      : 0;

  const reasonCodes: string[] = [];
  const primaryLeavesForNpc =
    /(?:회의실로|회의실에)\s*(?:가|향|불려)|잠깐\s*끌려|다녀올게|갔다\s*올게|식당\s*밖으로\s*사라/.test(
      prose
    ) && /태건|윤태건|직원|담당|호출/.test(prose);
  if (primaryLeavesForNpc) reasonCodes.push("PRIMARY_EXIT_FOR_SUPPORTING_NPC");

  const supportingSpeakingNpcCount =
    supportingSpeakers.length + (backgroundBlocks >= 2 ? Math.min(2, newSupportingNpcCount) : 0);

  const multiCast = input.sceneCastMode === "ensemble" || input.sceneCastMode === "simulation";
  const npcFanoutDetected = multiCast
    ? backgroundBlocks >= 3 && newSupportingNpcCount >= 2
    : supportingSpeakingNpcCount >= 3 ||
      (supportingSpeakers.length >= 1 && backgroundBlocks >= 2 && newSupportingNpcCount >= 2) ||
      (backgroundBlocks >= 3 && newSupportingNpcCount >= 2);
  if (npcFanoutDetected) reasonCodes.push("GROUNDED_NPC_FANOUT");

  const primaryFocusDiluted = multiCast
    ? npcFanoutDetected
    : primaryLeavesForNpc ||
      npcFanoutDetected ||
      (supportingBlocks > primaryDialogue && supportingSpeakers.length >= 1 && supportingBlocks >= 4);
  if (primaryFocusDiluted) reasonCodes.push("PRIMARY_CHARACTER_FOCUS_DILUTION");

  return {
    primaryCharacter: primary,
    primaryCharacterDialogueBlocks: primaryDialogue,
    supportingSpeakingNpcCount,
    supportingNpcDialogueBlocks: supportingBlocks + backgroundBlocks,
    newSupportingNpcCount,
    backgroundDialogueBlocks: backgroundBlocks,
    primaryFocusDiluted,
    npcFanoutDetected,
    supportingSpeakers: [
      ...supportingSpeakers,
      ...(backgroundBlocks > 0 ? ["background_roles"] : []),
    ],
    reasonCodes,
  };
}

function supportingValues(map: Map<string, number>): number[] {
  return [...map.values()];
}
