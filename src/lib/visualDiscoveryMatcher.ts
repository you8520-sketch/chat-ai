import {
  VISUAL_DISCOVERY_MATCHER_VERSION,
  VISUAL_EVENT_MIN_CONFIDENCE,
  knowledgeStateRank,
} from "@/lib/visualDiscoveryCatalog";
import {
  attributesSatisfyConditions,
  eventTypeMatchesEvidenceKind,
} from "@/lib/visualDiscoveryConditions";
import type { EligibleVisualRule } from "@/lib/visualDiscoveryEligibility";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";
import type {
  PersonaSecretEvidenceSourceType,
  PersonaSecretKnowledgeState,
  PersonaSecretObserverType,
} from "@/lib/personaSecretDiscoveryTypes";

export type VisualDiscoveryMatch = {
  secretId: string;
  discoveryRuleId: string;
  resultState: PersonaSecretKnowledgeState;
  revealedFactText: string;
  sceneEvidenceEventId: string;
  eventType: SceneEvidenceEvent["eventType"];
  matchedAttributes: Record<string, string | number | boolean>;
  sourceType: PersonaSecretEvidenceSourceType;
  matcherVersion: number;
  observerType?: PersonaSecretObserverType;
  observerId?: string;
};

function isObserverEligible(
  event: SceneEvidenceEvent,
  characterId: number
): boolean {
  const vis = event.visibility;
  if (!vis || vis.mode === "UNKNOWN") return false;
  if (vis.mode === "SCENE_PARTICIPANTS") {
    // No structural participant list yet — do not auto-approve.
    return false;
  }
  if (vis.mode === "EXPLICIT_OBSERVERS") {
    const ids = vis.observerIds ?? [];
    return ids.includes(String(characterId));
  }
  if (vis.mode === "CURRENT_CHARACTER") {
    // 1:1 chat premise for user-authored / explicit / server sources.
    return true;
  }
  return false;
}

function mapSceneSourceToVisualEvidenceSource(
  sourceType: SceneEvidenceEvent["sourceType"]
): PersonaSecretEvidenceSourceType | null {
  switch (sourceType) {
    case "USER_MESSAGE_DETERMINISTIC":
      return "USER_MESSAGE_VISUAL";
    case "USER_EXPLICIT_ACTION":
      return "USER_EXPLICIT_VISUAL_ACTION";
    case "SERVER_SCENE_EVENT":
      return "SERVER_VISUAL_EVENT";
    case "CREATOR_TRIGGER":
      return "CREATOR_VISUAL_TRIGGER";
    default:
      return null;
  }
}

/**
 * Match a visual rule against an event for a witness-proven observer.
 * Does NOT re-evaluate presence/visibility — that is S4B's responsibility.
 */
export function matchVisualDiscoveryRuleForObservedObserver(opts: {
  event: SceneEvidenceEvent;
  rule: EligibleVisualRule;
  observerType: PersonaSecretObserverType;
  observerId: string;
}): VisualDiscoveryMatch | null {
  const { event, rule, observerType, observerId } = opts;
  if (rule.method !== "VISUAL_DISCOVERY") return null;
  if (event.confidence < VISUAL_EVENT_MIN_CONFIDENCE) return null;

  const sourceType = mapSceneSourceToVisualEvidenceSource(event.sourceType);
  if (!sourceType) return null;

  if (!eventTypeMatchesEvidenceKind(event.eventType, rule.conditions)) {
    return null;
  }
  if (!attributesSatisfyConditions(event, rule.conditions)) {
    return null;
  }

  const resultState: PersonaSecretKnowledgeState =
    rule.conditions.resultState ?? rule.result_state;

  return {
    secretId: rule.secret_id,
    discoveryRuleId: rule.id,
    resultState,
    revealedFactText: rule.revealed_fact_text,
    sceneEvidenceEventId: event.id,
    eventType: event.eventType,
    matchedAttributes: { ...event.attributes },
    sourceType,
    matcherVersion: VISUAL_DISCOVERY_MATCHER_VERSION,
    observerType,
    observerId,
  };
}

/** @deprecated Prefer matchVisualDiscoveryRuleForObservedObserver after S4B witness resolution. */
export function matchVisualDiscoveryRule(
  event: SceneEvidenceEvent,
  rule: EligibleVisualRule,
  characterId: number
): VisualDiscoveryMatch | null {
  if (!isObserverEligible(event, characterId)) return null;
  return matchVisualDiscoveryRuleForObservedObserver({
    event,
    rule,
    observerType: "CHARACTER",
    observerId: String(characterId),
  });
}

/**
 * Match all eligible rules against turn events.
 * Same secret with multiple matches → keep highest resultState (still emit all matches for evidence).
 */
export function matchVisualDiscoveryForTurn(opts: {
  events: SceneEvidenceEvent[];
  rules: EligibleVisualRule[];
  characterId: number;
}): VisualDiscoveryMatch[] {
  const matches: VisualDiscoveryMatch[] = [];
  for (const event of opts.events) {
    for (const rule of opts.rules) {
      const m = matchVisualDiscoveryRule(event, rule, opts.characterId);
      if (m) matches.push(m);
    }
  }
  return matches;
}

export function pickHighestState(
  a: PersonaSecretKnowledgeState,
  b: PersonaSecretKnowledgeState
): PersonaSecretKnowledgeState {
  return knowledgeStateRank(a) >= knowledgeStateRank(b) ? a : b;
}

export function buildVisualDiscoveryIdempotencyKey(opts: {
  sceneEvidenceEventId: string;
  discoveryRuleId: string;
  observerType?: string;
  observerId: string;
  matcherVersion?: number;
}): string {
  const version = opts.matcherVersion ?? VISUAL_DISCOVERY_MATCHER_VERSION;
  const observerType = opts.observerType ?? "CHARACTER";
  return `visual-discovery:${opts.sceneEvidenceEventId}:${opts.discoveryRuleId}:${observerType}:${opts.observerId}:${version}`;
}
