/**
 * Home chat discovery turn slice — scene evidence → document targets → visual → investigation.
 * Shared by POST /api/chat and integration tests (no prompt/LLM side effects).
 */
import type Database from "better-sqlite3";
import { runInvestigationDiscoveryForTurn } from "@/lib/investigationDiscovery";
import { registerInvestigationTargetsFromPresentedDocuments } from "@/lib/investigationTargetFromSceneEvidence";
import type { InvestigationExplicitAction } from "@/lib/investigationTypes";
import {
  extractAndPersistSceneEvidence,
  type ExtractAndPersistSceneEvidenceResult,
} from "@/lib/sceneEvidence";
import type {
  SceneEvidenceExplicitAction,
  SceneEvidenceExtractorInput,
} from "@/lib/sceneEvidenceTypes";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";

export type RunHomeDiscoveryTurnInput = {
  chatId: number;
  characterId: number;
  personaId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  userMessage: string;
  explicitSceneActions?: SceneEvidenceExplicitAction[];
  investigationActions?: InvestigationExplicitAction[];
  userId?: number | null;
  db?: Database.Database;
};

export type RunHomeDiscoveryTurnResult = {
  sceneEvidence: ExtractAndPersistSceneEvidenceResult;
  documentTargets: { registered: number; skipped: number };
  investigation: ReturnType<typeof runInvestigationDiscoveryForTurn>;
};

/** Mirrors the home chat route ordering for S2A → S3 target bridge → S2B → S3. */
export function runHomeDiscoveryTurn(
  opts: RunHomeDiscoveryTurnInput
): RunHomeDiscoveryTurnResult {
  const sceneInput: SceneEvidenceExtractorInput = {
    chatId: opts.chatId,
    characterId: opts.characterId,
    turnNumber: opts.turnNumber,
    sourceMessageId: opts.sourceMessageId,
    userMessage: opts.userMessage,
    explicitActions: opts.explicitSceneActions,
    publicPersonaId: opts.personaId,
    userId: opts.userId,
  };

  const sceneEvidence = extractAndPersistSceneEvidence(sceneInput, opts.db);
  const documentTargets = registerInvestigationTargetsFromPresentedDocuments({
    chatId: opts.chatId,
    events: [...sceneEvidence.inserted, ...sceneEvidence.reused],
    userId: opts.userId,
    db: opts.db,
  });

  runVisualDiscoveryForTurn({
    chatId: opts.chatId,
    personaId: opts.personaId,
    characterId: opts.characterId,
    turnNumber: opts.turnNumber,
    sourceMessageId: opts.sourceMessageId,
    userId: opts.userId,
    db: opts.db,
  });

  const investigation = runInvestigationDiscoveryForTurn({
    chatId: opts.chatId,
    personaId: opts.personaId,
    characterId: opts.characterId,
    turnNumber: opts.turnNumber,
    sourceMessageId: opts.sourceMessageId,
    userMessage: opts.userMessage,
    explicitActions: opts.investigationActions,
    authoritativeOutcomes: [],
    userId: opts.userId,
    db: opts.db,
  });

  return { sceneEvidence, documentTargets, investigation };
}
