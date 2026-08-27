/**
 * PR-S4D — Controlled Knowledge Transfer types.
 */

import type {
  PersonaSecretKnowledgeState,
  PersonaSecretObserverType,
} from "@/lib/personaSecretDiscoveryTypes";

export const KNOWLEDGE_TRANSFER_MATCHER_VERSION = 1;

export type KnowledgeTransferType =
  | "DIRECT_STATEMENT"
  | "DOCUMENT_HANDOFF"
  | "SERVER_DISCLOSURE";

export type KnowledgeTransferSource =
  | "USER_EXPLICIT_TRANSFER"
  | "SERVER_STRUCTURED_TRANSFER"
  | "CREATOR_STRUCTURED_TRANSFER";

export type KnowledgeTransferChannelType = "DIRECT";

export type PersonaSecretTransferAction = {
  secretId: string;
  sender: {
    observerType: PersonaSecretObserverType;
    observerId: string;
  };
  receiver: {
    observerType: PersonaSecretObserverType;
    observerId: string;
  };
  transferType: KnowledgeTransferType;
  /** Server-assigned for user transfers; never trust client-chosen ids on public body. */
  sourceMessageId?: number;
  /** Variant-scoped assistant provenance (authoritative S4 only). */
  sourceAssistantMessageId?: number;
  /** Variant-scoped generation sequence (authoritative S4 only). */
  sourceGenerationSequence?: number;
  /** Server-generated action id for idempotency (authoritative path). */
  actionId?: string;
  /** Alias for authoritative internal event id → stored as actionId. */
  authoritativeEventId?: string;
};

export type KnowledgeTransferAuthoritativeAction = PersonaSecretTransferAction & {
  sourceType: "SERVER_STRUCTURED_TRANSFER" | "CREATOR_STRUCTURED_TRANSFER";
};

export type KnowledgeTransferEventRow = {
  id: string;
  idempotency_key: string;
  chat_id: number;
  turn_number: number;
  source_message_id: number | null;
  source_assistant_message_id: number | null;
  source_generation_sequence: number | null;
  persona_id: number;
  secret_id: string;
  sender_type: PersonaSecretObserverType;
  sender_id: string;
  receiver_type: PersonaSecretObserverType;
  receiver_id: string;
  sender_state_snapshot: PersonaSecretKnowledgeState;
  resulting_state: PersonaSecretKnowledgeState;
  fact_snapshot: string;
  transfer_type: KnowledgeTransferType;
  source_type: KnowledgeTransferSource;
  channel_type: KnowledgeTransferChannelType;
  evidence_json: string;
  created_at: string;
};

export type KnowledgeTransferRejectReason =
  | "FORBIDDEN_SOURCE"
  | "FORBIDDEN_TRANSFER_TYPE"
  | "MISSING_ACTION_REF"
  | "INVALID_SENDER"
  | "INVALID_RECEIVER"
  | "SAME_OBSERVER"
  | "SECRET_NOT_FOUND"
  | "SECRET_WRONG_PERSONA"
  | "SENDER_UNKNOWN"
  | "SENDER_NO_FACT"
  | "PRESENCE_BLOCKED"
  | "CAPABILITY_BLOCKED"
  | "RECEIVER_SCOPE";

export type KnowledgeTransferApplyResult =
  | {
      ok: true;
      changed: boolean;
      transferEventId: string | null;
      resultingState: PersonaSecretKnowledgeState | null;
      reason?: "DUPLICATE" | "ALREADY_AT_LEAST";
    }
  | {
      ok: false;
      reason: KnowledgeTransferRejectReason;
    };
