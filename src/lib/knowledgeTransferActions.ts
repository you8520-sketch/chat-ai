/**
 * PR-S4D — Parse transfer actions.
 * Public body path never accepts authoritative sourceTypes.
 * Clients cannot supply resultingState / factSnapshot.
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

function parseOneActionBase(raw: unknown): PersonaSecretTransferAction | null {
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
  return {
    secretId,
    sender,
    receiver,
    transferType,
  };
}

/**
 * Public chat body transfers — source is always forced to USER_EXPLICIT_TRANSFER
 * by the orchestrator. Client sourceType / sourceMessageId are not trusted.
 */
export function parseKnowledgeTransferActions(
  raw: unknown
): PersonaSecretTransferAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonaSecretTransferAction[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    // Reject forged authoritative labels on the public user array.
    if (o.sourceType != null) {
      const st = String(o.sourceType);
      if (
        st === "SERVER_STRUCTURED_TRANSFER" ||
        st === "CREATOR_STRUCTURED_TRANSFER"
      ) {
        continue;
      }
      if (st && st !== "USER_EXPLICIT_TRANSFER") continue;
    }
    const parsed = parseOneActionBase(item);
    if (!parsed) continue;
    // SERVER_DISCLOSURE is internal-only — never accept on the public user array.
    if (parsed.transferType === "SERVER_DISCLOSURE") continue;
    // sourceMessageId is assigned by the chat route from the saved user message.
    out.push(parsed);
  }
  return out;
}

/**
 * Internal-only authoritative transfers (server scene engine / creator trigger /
 * admin endpoint / queued event). Never wire this parser to public chat body.
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
    const parsed = parseOneActionBase(item);
    if (!parsed) continue;

    const actionId =
      typeof o.actionId === "string" && o.actionId.trim()
        ? o.actionId.trim().slice(0, 160)
        : typeof o.authoritativeEventId === "string" &&
            o.authoritativeEventId.trim()
          ? o.authoritativeEventId.trim().slice(0, 160)
          : undefined;
    const sourceMessageId =
      o.sourceMessageId != null && Number.isFinite(Number(o.sourceMessageId))
        ? Math.floor(Number(o.sourceMessageId))
        : undefined;
    if (sourceMessageId == null && !actionId) continue;

    out.push({
      ...parsed,
      sourceType,
      ...(sourceMessageId != null ? { sourceMessageId } : {}),
      ...(actionId ? { actionId, authoritativeEventId: actionId } : {}),
    });
  }
  return out;
}
