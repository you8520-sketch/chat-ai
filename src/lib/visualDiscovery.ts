/**
 * PR-S2B + PR-S4B — Visual Discovery orchestrator.
 *
 * Flow:
 *   scene evidence events
 *   → S4B witness resolution (per-observer OBSERVED)
 *   → S2B visual rule match (per OBSERVED observer)
 *   → per-observer knowledge transition
 *
 * Never passes canonical secret text to model/client/logs.
 * Ensemble prompt isolation is NOT implemented here (PR-S4C).
 */
import type Database from "better-sqlite3";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { isPersonaSecretDiscoveryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import type { PersonaSecretObserverType } from "@/lib/personaSecretDiscoveryTypes";
import {
  listObservedObserversForEvent,
  resolveAndPersistSceneEventWitnesses,
} from "@/lib/sceneObservationPersist";
import { listSceneEvidenceEventsForChatTurn } from "@/lib/sceneEvidencePersist";
import { applyVisualDiscoveryMatches } from "@/lib/visualDiscoveryApply";
import { listEligibleVisualDiscoveryRules } from "@/lib/visualDiscoveryEligibility";
import { matchVisualDiscoveryRuleForObservedObserver } from "@/lib/visualDiscoveryMatcher";

export type RunVisualDiscoveryResult = {
  matchCount: number;
  appliedCount: number;
  changedCount: number;
  observedObserverCount: number;
  rejectedObserverCount: number;
};

/**
 * Run S4B witness resolution + S2B visual discovery for the turn's scene evidence.
 * Safe no-op when personaId missing or no eligible rules/events.
 */
export function runVisualDiscoveryForTurn(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  userId?: number | null;
  db?: Database.Database;
}): RunVisualDiscoveryResult {
  if (!isPersonaSecretDiscoveryEnabled({ userId: opts.userId })) {
    return {
      matchCount: 0,
      appliedCount: 0,
      changedCount: 0,
      observedObserverCount: 0,
      rejectedObserverCount: 0,
    };
  }
  // Ensure main character observer + active scene exist (idempotent).
  bootstrapChatObservers({
    chatId: opts.chatId,
    characterId: opts.characterId,
    turnNumber: opts.turnNumber,
    userId: opts.userId,
    db: opts.db,
  });

  const events = listSceneEvidenceEventsForChatTurn({
    chatId: opts.chatId,
    turnNumber: opts.turnNumber,
    db: opts.db,
  });
  if (events.length === 0) {
    return {
      matchCount: 0,
      appliedCount: 0,
      changedCount: 0,
      observedObserverCount: 0,
      rejectedObserverCount: 0,
    };
  }

  const rules = listEligibleVisualDiscoveryRules(opts.personaId, opts.db);
  if (rules.length === 0) {
    return {
      matchCount: 0,
      appliedCount: 0,
      changedCount: 0,
      observedObserverCount: 0,
      rejectedObserverCount: 0,
    };
  }

  let matchCount = 0;
  let appliedCount = 0;
  let changedCount = 0;
  let observedObserverCount = 0;
  let rejectedObserverCount = 0;

  const currentCharacterId = String(opts.characterId);

  for (const event of events) {
    const resolution = resolveAndPersistSceneEventWitnesses({
      event,
      currentCharacterId,
      db: opts.db,
    });

    const observed = listObservedObserversForEvent({
      sceneEvidenceEventId: event.id,
      db: opts.db,
    });
    observedObserverCount += observed.length;
    rejectedObserverCount += Math.max(
      0,
      resolution.observations.length - observed.length
    );

    for (const obs of observed) {
      const observerType = obs.observer_type as PersonaSecretObserverType;
      if (
        observerType !== "CHARACTER" &&
        observerType !== "NPC" &&
        observerType !== "PARTY_MEMBER"
      ) {
        continue;
      }

      const matches = [];
      for (const rule of rules) {
        const m = matchVisualDiscoveryRuleForObservedObserver({
          event,
          rule,
          observerType,
          observerId: obs.observer_id,
        });
        if (m) matches.push(m);
      }
      if (matches.length === 0) continue;
      matchCount += matches.length;

      const applied = applyVisualDiscoveryMatches({
        chatId: opts.chatId,
        personaId: opts.personaId,
        characterId: opts.characterId,
        observerType,
        observerId: obs.observer_id,
        turnNumber: opts.turnNumber,
        sourceMessageId: opts.sourceMessageId,
        matches,
        db: opts.db,
      });
      appliedCount += applied.applied.length;
      changedCount += applied.applied.filter((a) => a.changed).length;
    }
  }

  return {
    matchCount,
    appliedCount,
    changedCount,
    observedObserverCount,
    rejectedObserverCount,
  };
}
