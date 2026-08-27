/**
 * S4 same-generation DIRECT_STATEMENT live producer — server-local types.
 * Never expose secretId / observerId / nonce to clients.
 */

import type { PersonaSecretKnowledgeState, PersonaSecretObserverType } from "@/lib/personaSecretDiscoveryTypes";

export const S4_TRANSFER_BLOCK = "<<<S4_KNOWLEDGE_TRANSFER>>>";
export const S4_TRANSFER_END = "<<<END_S4>>>";

export const S4_MAX_TRANSFER_EVENTS = 4;
export const S4_PROOF_TEXT_MAX_CHARS = 480;

export type S4FactRef = `K${number}`;
export type S4ReceiverRef = `R${number}`;

export type S4GenerationFactEntry = {
  factRef: S4FactRef;
  secretId: string;
  senderKnowledgeState: PersonaSecretKnowledgeState;
  factSnapshot: string;
};

export type S4GenerationReceiverEntry = {
  receiverRef: S4ReceiverRef;
  observerType: PersonaSecretObserverType;
  observerId: string;
  displayName: string;
};

export type S4GenerationTransferContext = {
  nonce: string;
  facts: Map<S4FactRef, S4GenerationFactEntry>;
  receivers: Map<S4ReceiverRef, S4GenerationReceiverEntry>;
  /** Server-only prompt suffix (refs + receiver map + output contract). */
  promptFragment: string;
  sender: {
    observerType: PersonaSecretObserverType;
    observerId: string;
  };
};

export type S4StructuredTransferEvent = {
  factRef: string;
  receiverRef: string;
  transferType: "DIRECT_STATEMENT";
  completed: boolean;
  proofText: string;
};

export type S4ParsedTransferEnvelope = {
  nonce: string;
  events: S4StructuredTransferEvent[];
};
