/**
 * Single source-authority decision for seal summaries and episodic persist.
 *
 * evidence_type is an extractor label, not authority. ASSISTANT raw text is never
 * independent proof of a pre-existing user↔cast/family fact.
 *
 * Conservative v1: user-linked retrospective or family-tie facts become objective
 * durable memory only from USER_EXPLICIT / OOC. Current-scene AI/NPC actions that
 * do not encode that tie stay CURRENT_SCENE. Attributed speech stays CHARACTER_CLAIM.
 */
import {
  looksLikeHardPriorSharedUserRelationship,
  looksLikePriorSharedUserHistory,
  splitSharedHistoryClauses,
  userSharedHistoryEvidenceUnits,
  userUnitCoversClaim,
} from "@/lib/sharedHistoryEvidence";

export const MEMORY_SOURCE_AUTHORITY_KINDS = [
  "USER_EXPLICIT",
  "CHARACTER_CLAIM",
  "CURRENT_SCENE",
  "UNSUPPORTED",
] as const;

export type MemorySourceAuthorityKind = (typeof MEMORY_SOURCE_AUTHORITY_KINDS)[number];

export type MemorySourceRole = "user" | "ooc" | "character_claim" | "none";

export type MemoryAuthoritySource = {
  turn: number | null;
  messageId: number | null;
  text: string;
};

export type MemorySourceAuthorityDecision = {
  kind: MemorySourceAuthorityKind;
  sourceRole: MemorySourceRole;
  sourceTurn: number | null;
  sourceMessageId: number | null;
};

const ATTRIBUTED_CLAIM_MARKER =
  /(?:말했|말하였다|밝혔|밝혔다|주장했|주장하였다|전했|전하였다|언급했|언급하였다|설명했|설명하였다|부탁했다고\s*말|물었다고\s*말)/i;

const USER_FAMILY_PARTICIPANT =
  /누나|언니|오빠|동생|엄마|아빠|어머니|아버지|부모|친구|(?<![가-힣])형(?![가-힣])/u;

export function resolvePersonaName(userPersona?: string | null): string | null {
  const match = userPersona?.match(/(?:^|\n)이름\/호칭:\s*([^\n]+)/);
  const name = match?.[1]?.trim() ?? "";
  return name || null;
}

export function isAttributedMemoryClaim(text: string): boolean {
  return ATTRIBUTED_CLAIM_MARKER.test(text);
}

export function mentionsUser(text: string, personaName: string | null): boolean {
  if (/(?:유저|사용자)/.test(text)) return true;
  return Boolean(personaName && text.includes(personaName));
}

function hasFamilyParticipant(text: string): boolean {
  return USER_FAMILY_PARTICIPANT.test(text);
}

export function clauseNeedsUserAuthority(
  clause: string,
  personaName: string | null,
  category?: string | null
): boolean {
  if (isAttributedMemoryClaim(clause)) return false;
  const retrospective =
    looksLikePriorSharedUserHistory(clause) || looksLikeHardPriorSharedUserRelationship(clause);
  const family = hasFamilyParticipant(clause);
  if (mentionsUser(clause, personaName) && (retrospective || family)) return true;
  return category === "relationship" && (retrospective || family);
}

function findCoveringSource(
  clause: string,
  sources: readonly MemoryAuthoritySource[],
  ignoreNames: readonly string[]
): MemoryAuthoritySource | null {
  for (const source of sources) {
    const units = userSharedHistoryEvidenceUnits(source.text);
    if (units.some((unit) => userUnitCoversClaim(unit, clause, ignoreNames))) {
      return source;
    }
  }
  return null;
}

export function resolveClauseSourceAuthority(
  clause: string,
  opts: {
    sources: readonly MemoryAuthoritySource[];
    personaName?: string | null;
    charName?: string | null;
    attributed?: boolean;
    category?: string | null;
  }
): MemorySourceAuthorityDecision {
  const personaName = opts.personaName ?? null;
  const attributed = opts.attributed === true || isAttributedMemoryClaim(clause);
  if (attributed) {
    return {
      kind: "CHARACTER_CLAIM",
      sourceRole: "character_claim",
      sourceTurn: null,
      sourceMessageId: null,
    };
  }
  if (!clauseNeedsUserAuthority(clause, personaName, opts.category)) {
    return {
      kind: "CURRENT_SCENE",
      sourceRole: "none",
      sourceTurn: null,
      sourceMessageId: null,
    };
  }
  const ignoreNames = [personaName, opts.charName].filter((name): name is string => Boolean(name));
  const covering = findCoveringSource(clause, opts.sources, ignoreNames);
  if (covering) {
    const ooc = /(?:^|\n)\s*OOC\s*:/iu.test(covering.text);
    return {
      kind: "USER_EXPLICIT",
      sourceRole: ooc ? "ooc" : "user",
      sourceTurn: covering.turn,
      sourceMessageId: covering.messageId,
    };
  }
  return {
    kind: "UNSUPPORTED",
    sourceRole: "none",
    sourceTurn: null,
    sourceMessageId: null,
  };
}

export function resolveMemorySourceAuthority(
  text: string,
  opts: {
    sources: readonly MemoryAuthoritySource[];
    personaName?: string | null;
    charName?: string | null;
    attributed?: boolean;
    category?: string | null;
  }
): MemorySourceAuthorityDecision {
  const clauses = splitSharedHistoryClauses(text);
  const parts = clauses.length > 0 ? clauses : [text];
  let explicit: MemorySourceAuthorityDecision | null = null;
  let claimed = opts.attributed === true;
  for (const clause of parts) {
    const decision = resolveClauseSourceAuthority(clause, opts);
    switch (decision.kind) {
      case "UNSUPPORTED":
        return decision;
      case "USER_EXPLICIT":
        explicit = explicit ?? decision;
        break;
      case "CHARACTER_CLAIM":
        claimed = true;
        break;
      case "CURRENT_SCENE":
        break;
      default: {
        const exhausted: never = decision.kind;
        return exhausted;
      }
    }
  }
  if (explicit) return explicit;
  return {
    kind: claimed ? "CHARACTER_CLAIM" : "CURRENT_SCENE",
    sourceRole: claimed ? "character_claim" : "none",
    sourceTurn: null,
    sourceMessageId: null,
  };
}

export function hasUnsupportedObjectiveUserLinkedFact(
  text: string,
  opts: {
    sources: readonly MemoryAuthoritySource[];
    personaName?: string | null;
    charName?: string | null;
    attributed?: boolean;
    category?: string | null;
  }
): boolean {
  return resolveMemorySourceAuthority(text, opts).kind === "UNSUPPORTED";
}

export function sourcesFromUserText(userText: string): MemoryAuthoritySource[] {
  return [{ turn: null, messageId: null, text: userText }];
}
