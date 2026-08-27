/**
 * PR-S3 home path — register chat-scoped investigation targets from USER-authored
 * DOCUMENT_PRESENTED scene evidence only. Secret-blind: never reads canonical secrets.
 */
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { buildSecretBlindDocumentTargetPayload } from "@/lib/investigationDocumentTargetPayload";
import { registerPresentedDocumentTarget } from "@/lib/investigationTargets";
import { isPersonaSecretDiscoveryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import type {
  SceneEvidenceEvent,
  SceneEvidenceSource,
} from "@/lib/sceneEvidenceTypes";

const TRUSTED_USER_SOURCES = new Set<SceneEvidenceSource>([
  "USER_MESSAGE_DETERMINISTIC",
  "USER_EXPLICIT_ACTION",
]);

const DOCUMENT_EVENT_TYPES = new Set([
  "DOCUMENT_PRESENTED",
  "IDENTITY_DOCUMENT_PRESENTED",
]);

export type RegisterDocumentTargetsFromSceneEvidenceResult = {
  registered: number;
  skipped: number;
};

function documentLabelFromEvent(event: SceneEvidenceEvent): string | null {
  const raw = event.attributes.documentLabel;
  if (typeof raw !== "string") return null;
  const label = raw.trim().slice(0, 64);
  return label.length >= 1 ? label : null;
}

function documentSubjectFromEvent(
  event: SceneEvidenceEvent
): "PERSONA_SELF" | undefined {
  return event.attributes.documentSubject === "PERSONA_SELF"
    ? "PERSONA_SELF"
    : undefined;
}

/**
 * After S2A persist, upsert chat-scoped document targets for USER-authored presentations.
 * Assistant/server/creator scene events are ignored — they must not create trusted targets.
 */
export function registerInvestigationTargetsFromPresentedDocuments(opts: {
  chatId: number;
  events: SceneEvidenceEvent[];
  userId?: number | null;
  db?: Database.Database;
}): RegisterDocumentTargetsFromSceneEvidenceResult {
  if (!isPersonaSecretDiscoveryEnabled({ userId: opts.userId })) {
    return { registered: 0, skipped: opts.events.length };
  }

  const db = opts.db ?? getDb();
  let registered = 0;
  let skipped = 0;
  const seen = new Set<string>();

  for (const event of opts.events) {
    if (event.chatId !== opts.chatId) {
      skipped++;
      continue;
    }
    if (!DOCUMENT_EVENT_TYPES.has(event.eventType)) {
      skipped++;
      continue;
    }
    if (!TRUSTED_USER_SOURCES.has(event.sourceType)) {
      skipped++;
      continue;
    }

    const documentLabel = documentLabelFromEvent(event);
    if (!documentLabel) {
      skipped++;
      continue;
    }

    const dedupeKey = `${event.eventType}:${documentLabel.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      skipped++;
      continue;
    }
    seen.add(dedupeKey);

    const payload = buildSecretBlindDocumentTargetPayload({
      documentLabel,
      identityDocument: event.eventType === "IDENTITY_DOCUMENT_PRESENTED",
      documentSubject: documentSubjectFromEvent(event),
    });

    registerPresentedDocumentTarget({
      chatId: opts.chatId,
      documentLabel,
      payload,
      db,
    });
    registered++;
  }

  return { registered, skipped };
}
