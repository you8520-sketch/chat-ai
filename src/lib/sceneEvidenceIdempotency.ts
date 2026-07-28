import { createHash } from "node:crypto";
import { SCENE_EVIDENCE_EXTRACTOR_VERSION } from "@/lib/sceneEvidenceCatalog";
import type {
  SceneEvidenceAttributeValue,
  SceneEvidenceEventType,
} from "@/lib/sceneEvidenceTypes";

function stableStringifyAttributes(
  attrs: Record<string, SceneEvidenceAttributeValue>
): string {
  const keys = Object.keys(attrs).sort();
  const normalized: Record<string, SceneEvidenceAttributeValue> = {};
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "string") normalized[k] = v.trim().toLowerCase();
    else normalized[k] = v;
  }
  return JSON.stringify(normalized);
}

export function hashSceneEvidenceAttributes(
  attrs: Record<string, SceneEvidenceAttributeValue>
): string {
  return createHash("sha256")
    .update(stableStringifyAttributes(attrs), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/**
 * Idempotency key:
 * scene-evidence:{chatId}:{sourceMessageId|turn:N}:{eventType}:{attrHash}:{extractorVersion}
 */
export function buildSceneEvidenceIdempotencyKey(opts: {
  chatId: number;
  sourceMessageId?: number | null;
  turnNumber: number;
  eventType: SceneEvidenceEventType;
  attributes: Record<string, SceneEvidenceAttributeValue>;
  extractorVersion?: number;
}): string {
  const msgPart =
    opts.sourceMessageId != null && Number.isFinite(opts.sourceMessageId)
      ? String(opts.sourceMessageId)
      : `turn:${opts.turnNumber}`;
  const version = opts.extractorVersion ?? SCENE_EVIDENCE_EXTRACTOR_VERSION;
  const attrHash = hashSceneEvidenceAttributes(opts.attributes);
  return `scene-evidence:${opts.chatId}:${msgPart}:${opts.eventType}:${attrHash}:${version}`;
}
