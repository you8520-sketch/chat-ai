import {
  INVESTIGATION_MATCHER_VERSION,
  INVESTIGATION_MIN_RESULT_CONFIDENCE,
} from "@/lib/investigationCatalog";
import {
  containsForbiddenTags,
  resultStateSatisfies,
  tagsSatisfy,
} from "@/lib/investigationConditions";
import {
  isInvestigationRuleEligible,
  type EligibleInvestigationRule,
} from "@/lib/investigationEligibility";
import { knowledgeStateRank } from "@/lib/visualDiscoveryCatalog";
import type {
  InvestigationResultRow,
  InvestigationResultState,
  InvestigationResultType,
  InvestigationSourceType,
} from "@/lib/investigationTypes";
import type {
  PersonaSecretEvidenceSourceType,
  PersonaSecretKnowledgeState,
} from "@/lib/personaSecretDiscoveryTypes";
import { getCharacterSecretKnowledge } from "@/lib/personaSecretKnowledge";
import type Database from "better-sqlite3";

export type InvestigationDiscoveryMatch = {
  secretId: string;
  discoveryRuleId: string;
  resultState: PersonaSecretKnowledgeState;
  revealedFactText: string;
  investigationResultId: string;
  attemptId: string;
  targetId: string | null;
  resultType: InvestigationResultType;
  matchedTags: string[];
  sourceType: PersonaSecretEvidenceSourceType;
  matcherVersion: number;
};

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isAuthoritativeInvestigationResult(result: InvestigationResultRow): boolean {
  if (result.result_state !== "PARTIAL" && result.result_state !== "VERIFIED") {
    return false;
  }
  if (result.confidence < INVESTIGATION_MIN_RESULT_CONFIDENCE) return false;
  const src = result.source_type as InvestigationSourceType;
  return (
    src === "USER_EXPLICIT_ACTION" ||
    src === "USER_MESSAGE_DETERMINISTIC" ||
    src === "SERVER_SCENE_EVENT" ||
    src === "CREATOR_TRIGGER"
  );
}

function isObserverEligible(
  result: InvestigationResultRow,
  characterId: number
): boolean {
  return (
    result.observer_type === "CHARACTER" &&
    result.observer_id === String(characterId)
  );
}

function mapInvestigationSourceToEvidenceSource(
  sourceType: string
): PersonaSecretEvidenceSourceType | null {
  switch (sourceType) {
    case "USER_EXPLICIT_ACTION":
      return "USER_EXPLICIT_INVESTIGATION";
    case "USER_MESSAGE_DETERMINISTIC":
      return "USER_MESSAGE_INVESTIGATION";
    case "SERVER_SCENE_EVENT":
      return "SERVER_INVESTIGATION_RESULT";
    case "CREATOR_TRIGGER":
      return "CREATOR_INVESTIGATION_TRIGGER";
    default:
      return null;
  }
}

function priorKnowledgeSatisfied(opts: {
  chatId: number;
  characterId: number;
  personaId: number;
  required: EligibleInvestigationRule["conditions"]["requiredPriorKnowledge"];
  db?: Database.Database;
}): boolean {
  const required = opts.required;
  if (!required || required.length === 0) return true;
  for (const req of required) {
    const k = getCharacterSecretKnowledge({
      chatId: opts.chatId,
      personaId: opts.personaId,
      secretId: req.secretId,
      characterId: opts.characterId,
      db: opts.db,
    });
    if (!k) return false;
    if (knowledgeStateRank(k.knowledge_state) < knowledgeStateRank(req.state)) {
      return false;
    }
  }
  return true;
}

/**
 * Default mapping: PARTIAL → SUSPECTED, VERIFIED → CONFIRMED.
 * Rule may demand a more conservative resultState.
 */
function resolveMatchState(
  resultState: InvestigationResultState,
  rule: EligibleInvestigationRule
): PersonaSecretKnowledgeState {
  const fromResult: PersonaSecretKnowledgeState =
    resultState === "VERIFIED" ? "CONFIRMED" : "SUSPECTED";
  const fromRule: PersonaSecretKnowledgeState =
    rule.conditions.resultState ?? rule.result_state;
  // Conservative: take the weaker of rule intent and result mapping when rule wants SUSPECTED.
  if (fromRule === "SUSPECTED") return "SUSPECTED";
  return fromResult;
}

export function matchInvestigationDiscoveryRule(opts: {
  result: InvestigationResultRow;
  rule: EligibleInvestigationRule;
  characterId: number;
  personaId: number;
  db?: Database.Database;
}): InvestigationDiscoveryMatch | null {
  const { result, rule, characterId, personaId, db } = opts;
  if (rule.method !== "INVESTIGATION_DISCOVERY") return null;
  if (!isInvestigationRuleEligible(rule)) return null;
  if (!isAuthoritativeInvestigationResult(result)) return null;
  if (!isObserverEligible(result, characterId)) return null;

  const sourceType = mapInvestigationSourceToEvidenceSource(result.source_type);
  if (!sourceType) return null;

  const conditions = rule.conditions;
  if (result.result_type !== conditions.evidenceKind) return null;
  if (
    !resultStateSatisfies(
      result.result_state,
      conditions.minimumResultState
    )
  ) {
    return null;
  }

  const tags = parseJsonStringArray(result.result_tags_json);
  if (!tagsSatisfy(tags, conditions.requiredTags, conditions.matchMode ?? "ALL")) {
    return null;
  }
  if (containsForbiddenTags(tags, conditions.forbiddenTags)) return null;

  if (
    !priorKnowledgeSatisfied({
      chatId: result.chat_id,
      characterId,
      personaId,
      required: conditions.requiredPriorKnowledge,
      db,
    })
  ) {
    return null;
  }

  const minConf = conditions.minimumConfidence ?? INVESTIGATION_MIN_RESULT_CONFIDENCE;
  if (result.confidence < minConf) return null;

  const matchedTags = (conditions.requiredTags ?? []).filter((t) =>
    tags.map((x) => x.toLowerCase()).includes(t.toLowerCase())
  );

  return {
    secretId: rule.secret_id,
    discoveryRuleId: rule.id,
    resultState: resolveMatchState(result.result_state, rule),
    revealedFactText: rule.revealed_fact_text,
    investigationResultId: result.id,
    attemptId: result.attempt_id,
    targetId: result.target_id,
    resultType: result.result_type,
    matchedTags,
    sourceType,
    matcherVersion: INVESTIGATION_MATCHER_VERSION,
  };
}

export function matchInvestigationDiscoveryForTurn(opts: {
  results: InvestigationResultRow[];
  rules: EligibleInvestigationRule[];
  characterId: number;
  personaId: number;
  chatId: number;
  db?: Database.Database;
}): InvestigationDiscoveryMatch[] {
  const matches: InvestigationDiscoveryMatch[] = [];
  for (const result of opts.results) {
    if (result.chat_id !== opts.chatId) continue;
    for (const rule of opts.rules) {
      const m = matchInvestigationDiscoveryRule({
        result,
        rule,
        characterId: opts.characterId,
        personaId: opts.personaId,
        db: opts.db,
      });
      if (m) matches.push(m);
    }
  }
  return matches;
}

export function buildInvestigationDiscoveryIdempotencyKey(opts: {
  investigationResultId: string;
  discoveryRuleId: string;
  observerType?: string;
  observerId: string;
  matcherVersion?: number;
}): string {
  const version = opts.matcherVersion ?? INVESTIGATION_MATCHER_VERSION;
  const observerType = opts.observerType ?? "CHARACTER";
  return `investigation-discovery:${opts.investigationResultId}:${opts.discoveryRuleId}:${observerType}:${opts.observerId}:${version}`;
}

export { INVESTIGATION_MATCHER_VERSION };
