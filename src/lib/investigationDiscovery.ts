/**
 * PR-S3 — Investigation Discovery orchestrator (S3A → S3B).
 *
 * S3A (resolver) is secret-blind.
 * S3B (matcher/apply) may read discovery rules + knowledge only.
 */
import type Database from "better-sqlite3";
import { applyInvestigationDiscoveryMatches } from "@/lib/investigationApply";
import { listEligibleInvestigationDiscoveryRules } from "@/lib/investigationEligibility";
import { matchInvestigationDiscoveryForTurn } from "@/lib/investigationMatcher";
import {
  parseInvestigationAuthoritativeOutcomes,
  parseInvestigationExplicitActions,
} from "@/lib/investigationRequests";
import { resolveInvestigationTurn } from "@/lib/investigationResolver";

export type RunInvestigationDiscoveryResult = {
  attemptCount: number;
  resultCount: number;
  matchCount: number;
  appliedCount: number;
  changedCount: number;
};

/**
 * Resolve investigation requests then match INVESTIGATION_DISCOVERY rules.
 * Call after S2B, before known-facts rebuild.
 */
export function runInvestigationDiscoveryForTurn(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  userMessage?: string;
  explicitActions?: ReturnType<typeof parseInvestigationExplicitActions>;
  authoritativeOutcomes?: ReturnType<typeof parseInvestigationAuthoritativeOutcomes>;
  db?: Database.Database;
}): RunInvestigationDiscoveryResult {
  const resolved = resolveInvestigationTurn(
    {
      chatId: opts.chatId,
      characterId: opts.characterId,
      turnNumber: opts.turnNumber,
      sourceMessageId: opts.sourceMessageId,
      userMessage: opts.userMessage,
      explicitActions: opts.explicitActions,
      authoritativeOutcomes: opts.authoritativeOutcomes,
      personaId: opts.personaId,
    },
    opts.db
  );

  if (resolved.results.length === 0) {
    return {
      attemptCount: resolved.attemptCount,
      resultCount: 0,
      matchCount: 0,
      appliedCount: 0,
      changedCount: 0,
    };
  }

  const rules = listEligibleInvestigationDiscoveryRules(opts.personaId, opts.db);
  if (rules.length === 0) {
    return {
      attemptCount: resolved.attemptCount,
      resultCount: resolved.resultCount,
      matchCount: 0,
      appliedCount: 0,
      changedCount: 0,
    };
  }

  const matches = matchInvestigationDiscoveryForTurn({
    results: resolved.results,
    rules,
    characterId: opts.characterId,
    personaId: opts.personaId,
    chatId: opts.chatId,
    db: opts.db,
  });

  if (matches.length === 0) {
    return {
      attemptCount: resolved.attemptCount,
      resultCount: resolved.resultCount,
      matchCount: 0,
      appliedCount: 0,
      changedCount: 0,
    };
  }

  const applied = applyInvestigationDiscoveryMatches({
    chatId: opts.chatId,
    personaId: opts.personaId,
    characterId: opts.characterId,
    turnNumber: opts.turnNumber,
    sourceMessageId: opts.sourceMessageId,
    matches,
    db: opts.db,
  });

  return {
    attemptCount: resolved.attemptCount,
    resultCount: resolved.resultCount,
    matchCount: matches.length,
    appliedCount: applied.applied.length,
    changedCount: applied.applied.filter((a) => a.changed).length,
  };
}

export {
  parseInvestigationExplicitActions,
  parseInvestigationAuthoritativeOutcomes,
};
