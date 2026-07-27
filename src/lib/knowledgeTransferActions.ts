/**
 * PR-S4D — Parse authoritative transfer actions from request body.
 * Never accepts client-supplied resultingState / factSnapshot.
 */

import type {
  KnowledgeTransferAuthoritativeAction,
  KnowledgeTransferType,
  PersonaSecretTransferAction,
} from "@/lib/knowledgeTransferTypes";
import type { PersonaSecretObserverType } from "@/lib/personaSecretDiscoveryTypes";

const TRANSFER_TYPES = new Set<KnowledgeTransferType>([
  "DIRECT_STATEMENT",
  "DOCUMENT_HANDOFF",
  "SERVER_DISCLOSURE",
]);

const OBSERVER_TYPES = new Set<PersonaSecretObserverType>([
  "CHARACTER",
  "NPC",
  "PARTY_MEMBER",
]);

const FORBIDDEN_KEYS = new Set([
  "resultingState",
  "resulting_state",
  "factSnapshot",
  "fact_snapshot",
  "canonicalSecretText",
  "canonical_secret_text",
  "senderState",
  "knowledgeState",
]);

function parseObserverRef(
  raw: unknown
): { observerType: PersonaSecretObserverType; observerId: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const observerType = String(o.observerType ?? "");
  const observerId = String(o.observerId ?? "").trim().slice(0, 128);
  if (!OBSERVER_TYPES.has(observerType as PersonaSecretObserverType)) return null;
  if (!observerId) return null;
  return {
    observerType: observerType as PersonaSecretObserverType,
    observerId,
  };
}

function parseOneAction(raw: unknown): PersonaSecretTransferAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }
  const secretId = String(o.secretId ?? "").trim().slice(0, 128);
  const transferType = String(o.transferType ?? "") as KnowledgeTransferType;
  const sender = parseObserverRef(o.sender);
  const receiver = parseObserverRef(o.receiver);
  if (!secretId || !TRANSFER_TYPES.has(transferType) || !sender || !receiver) {
    return null;
  }
  const action: PersonaSecretTransferAction = {
    secretId,
    sender,
    receiver,
    transferType,
  };
  if (o.sourceMessageId != null && Number.isFinite(Number(o.sourceMessageId))) {
    action.sourceMessageId = Math.floor(Number(o.sourceMessageId));
  }
  if (typeof o.actionId === "string" && o.actionId.trim()) {
    action.actionId = o.actionId.trim().slice(0, 160);
  }
  return action;
}

/** User-explicit transfers — source is always USER_EXPLICIT_TRANSFER. */
export function parseKnowledgeTransferActions(
  raw: unknown
): PersonaSecretTransferAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonaSecretTransferAction[] = [];
  for (const item of raw.slice(0, 8)) {
    const parsed = parseOneAction(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Server/creator structured transfers.
 * Rejects USER_EXPLICIT and any assistant/model source labels.
 */
export function parseKnowledgeTransferAuthoritativeActions(
  raw: unknown
): KnowledgeTransferAuthoritativeAction[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeTransferAuthoritativeAction[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const sourceType = String(o.sourceType ?? "");
    if (
      sourceType !== "SERVER_STRUCTURED_TRANSFER" &&
      sourceType !== "CREATOR_STRUCTURED_TRANSFER"
    ) {
      continue;
    }
    const parsed = parseOneAction(item);
    if (!parsed) continue;
    out.push({
      ...parsed,
      sourceType,
    });
  }
  return out;
}
