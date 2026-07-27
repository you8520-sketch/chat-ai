/**
 * PR-S2A — Secret-blind Scene Evidence orchestrator.
 *
 * CRITICAL: This module must never import persona secret storage, discovery rules,
 * knowledge, compiler, or secret_description accessors.
 */
import type Database from "better-sqlite3";
import {
  draftsFromExplicitActions,
  draftsFromServerOrCreatorEvents,
  extractDeterministicSceneEvidenceFromUserMessage,
} from "@/lib/sceneEvidenceDeterministic";
import { persistSceneEvidenceEvents } from "@/lib/sceneEvidencePersist";
import type {
  SceneEvidenceDraft,
  SceneEvidenceExtractorInput,
  SceneEvidencePersistResult,
} from "@/lib/sceneEvidenceTypes";
import { validateSceneEvidenceDraft } from "@/lib/sceneEvidenceValidate";

export type ExtractAndPersistSceneEvidenceResult = SceneEvidencePersistResult & {
  draftCount: number;
  rejectedCount: number;
};

/**
 * Extract + validate + append-only persist.
 * Input is intentionally narrow — callers must not pass secret payloads.
 *
 * S2B matcher hook point: after this returns, matcher may consume `inserted`.
 * S2A does not perform any knowledge transition.
 */
export function extractAndPersistSceneEvidence(
  input: SceneEvidenceExtractorInput,
  db?: Database.Database
): ExtractAndPersistSceneEvidenceResult {
  const drafts: SceneEvidenceDraft[] = [];

  if (input.explicitActions?.length) {
    drafts.push(
      ...draftsFromExplicitActions({
        chatId: input.chatId,
        characterId: input.characterId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId,
        publicPersonaId: input.publicPersonaId,
        actions: input.explicitActions,
      })
    );
  }

  if (input.serverEvents?.length) {
    drafts.push(
      ...draftsFromServerOrCreatorEvents({
        chatId: input.chatId,
        characterId: input.characterId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId,
        publicPersonaId: input.publicPersonaId,
        events: input.serverEvents,
        sourceType: "SERVER_SCENE_EVENT",
      })
    );
  }

  if (input.creatorTriggers?.length) {
    drafts.push(
      ...draftsFromServerOrCreatorEvents({
        chatId: input.chatId,
        characterId: input.characterId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId,
        publicPersonaId: input.publicPersonaId,
        events: input.creatorTriggers,
        sourceType: "CREATOR_TRIGGER",
      })
    );
  }

  if (input.userMessage?.trim()) {
    drafts.push(
      ...extractDeterministicSceneEvidenceFromUserMessage({
        chatId: input.chatId,
        characterId: input.characterId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId,
        userMessage: input.userMessage,
        publicPersonaId: input.publicPersonaId,
      })
    );
  }

  const accepted: SceneEvidenceDraft[] = [];
  let rejectedCount = 0;
  for (const d of drafts) {
    const v = validateSceneEvidenceDraft(d);
    if (v.ok) accepted.push(v.event);
    else rejectedCount++;
  }

  const persisted = persistSceneEvidenceEvents(accepted, db);
  return {
    ...persisted,
    draftCount: drafts.length,
    rejectedCount,
  };
}

/** Placeholder for S2B — intentionally no-op in S2A. */
export function prepareSceneEvidenceMatcherSlot(_events: unknown): null {
  return null;
}

const EXPLICIT_ACTION_TYPES = new Set([
  "EXPOSE_BODY_REGION",
  "COVER_BODY_REGION",
  "PRESENT_ITEM",
  "PRESENT_VISIBLE_MARK",
  "PRESENT_DOCUMENT",
  "MANIFEST_ABILITY",
  "DISPLAY_SYMPTOM",
]);

/**
 * Parse optional client `sceneActions` — strips unknown/secret-bearing keys.
 * Never reads secret_description or persona secret payloads from the body.
 */
export function parseSceneEvidenceExplicitActions(
  raw: unknown
): SceneEvidenceExtractorInput["explicitActions"] {
  if (!Array.isArray(raw)) return [];
  const out: NonNullable<SceneEvidenceExtractorInput["explicitActions"]> = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const actionType = String(o.actionType ?? "");
    if (!EXPLICIT_ACTION_TYPES.has(actionType)) continue;
    // Reject if client tries to smuggle secret fields into the action.
    if (
      Object.keys(o).some((k) =>
        /secret|knowledge|canonical|discovery|alias/i.test(k)
      )
    ) {
      continue;
    }
    if (actionType === "EXPOSE_BODY_REGION" && typeof o.region === "string") {
      out.push({
        actionType: "EXPOSE_BODY_REGION",
        region: o.region as never,
        ...(typeof o.exposureLevel === "string"
          ? { exposureLevel: o.exposureLevel.slice(0, 32) }
          : {}),
      });
    } else if (actionType === "COVER_BODY_REGION" && typeof o.region === "string") {
      out.push({ actionType: "COVER_BODY_REGION", region: o.region as never });
    } else if (actionType === "PRESENT_ITEM" && typeof o.itemLabel === "string") {
      out.push({ actionType: "PRESENT_ITEM", itemLabel: o.itemLabel.slice(0, 64) });
    } else if (
      actionType === "PRESENT_VISIBLE_MARK" &&
      typeof o.markLabel === "string"
    ) {
      out.push({
        actionType: "PRESENT_VISIBLE_MARK",
        markLabel: o.markLabel.slice(0, 64),
      });
    } else if (
      actionType === "PRESENT_DOCUMENT" &&
      typeof o.documentLabel === "string"
    ) {
      out.push({
        actionType: "PRESENT_DOCUMENT",
        documentLabel: o.documentLabel.slice(0, 64),
      });
    } else if (
      actionType === "MANIFEST_ABILITY" &&
      typeof o.manifestation === "string"
    ) {
      out.push({
        actionType: "MANIFEST_ABILITY",
        manifestation: o.manifestation.slice(0, 64),
        ...(typeof o.visibleEffect === "string"
          ? { visibleEffect: o.visibleEffect.slice(0, 64) }
          : {}),
      });
    } else if (actionType === "DISPLAY_SYMPTOM" && typeof o.symptom === "string") {
      out.push({
        actionType: "DISPLAY_SYMPTOM",
        symptom: o.symptom.slice(0, 64),
        ...(typeof o.severity === "string"
          ? { severity: o.severity.slice(0, 32) }
          : {}),
      });
    }
  }
  return out;
}
