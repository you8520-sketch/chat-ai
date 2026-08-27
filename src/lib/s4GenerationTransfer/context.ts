/**
 * Request-local S4 generation context — uses exact projected prompt facts only.
 */

import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { getActiveChatScene } from "@/lib/chatScenes";
import { getChatObserver } from "@/lib/observerIdentity";
import type { PersonaKnowledgePromptDecision } from "@/lib/personaKnowledgePromptPolicy";
import {
  buildKnownPersonaFactsProjectionForObserver,
  buildPersonaKnowledgePromptBlock,
  type PersonaKnowledgePromptAuthority,
} from "@/lib/personaSecretKnowledge";
import {
  canObserveAuditorily,
  listScenePresence,
  requireRegisteredObserver,
} from "@/lib/scenePresence";
import { buildS4TransferOutputContractFragment } from "./prompt";
import type {
  S4FactRef,
  S4GenerationFactEntry,
  S4GenerationReceiverEntry,
  S4GenerationTransferContext,
  S4ReceiverRef,
} from "./types";

export type { S4GenerationTransferContext } from "./types";

const MAX_S4_RECEIVERS = 8;

function opaqueNonce(): string {
  return randomBytes(8).toString("base64url");
}

function nextFactRef(index: number): S4FactRef {
  return `K${index + 1}` as S4FactRef;
}

function nextReceiverRef(index: number): S4ReceiverRef {
  return `R${index + 1}` as S4ReceiverRef;
}

export function isS4LiveProducerTurnAllowed(opts: {
  oocHtmlMode?: boolean;
  oocSceneRenderTurn?: boolean;
  htmlFlashOnlyTurn?: boolean;
}): boolean {
  if (opts.oocHtmlMode) return false;
  if (opts.oocSceneRenderTurn) return false;
  if (opts.htmlFlashOnlyTurn) return false;
  return true;
}

function listEligibleReceivers(opts: {
  chatId: number;
  sender: { observerType: S4GenerationTransferContext["sender"]["observerType"]; observerId: string };
  db: Database.Database;
}): Map<S4ReceiverRef, S4GenerationReceiverEntry> {
  const scene = getActiveChatScene(opts.chatId, opts.db);
  if (!scene) return new Map();

  const receivers = new Map<S4ReceiverRef, S4GenerationReceiverEntry>();
  let receiverIndex = 0;
  for (const presence of listScenePresence(scene.id, opts.db)) {
    if (receiverIndex >= MAX_S4_RECEIVERS) break;
    if (
      presence.observer_type === opts.sender.observerType &&
      presence.observer_id === opts.sender.observerId
    ) {
      continue;
    }
    if (
      presence.presence_state !== "PRESENT" ||
      presence.awareness_state !== "AWARE" ||
      !canObserveAuditorily(presence)
    ) {
      continue;
    }
    if (
      !requireRegisteredObserver({
        chatId: opts.chatId,
        observerType: presence.observer_type,
        observerId: presence.observer_id,
        db: opts.db,
      })
    ) {
      continue;
    }
    const obs = getChatObserver({
      chatId: opts.chatId,
      observerType: presence.observer_type,
      observerId: presence.observer_id,
      db: opts.db,
    });
    const ref = nextReceiverRef(receiverIndex++);
    receivers.set(ref, {
      receiverRef: ref,
      observerType: presence.observer_type,
      observerId: presence.observer_id,
      displayName: obs?.display_name?.trim() || presence.observer_id,
    });
  }
  return receivers;
}

export function buildS4GenerationTransferContext(opts: {
  decision: PersonaKnowledgePromptDecision;
  chatId: number;
  personaId: number;
  legacySecretDescription?: string;
  authority?: PersonaKnowledgePromptAuthority;
  db?: Database.Database;
}): S4GenerationTransferContext | null {
  if (opts.decision.mode !== "OBSERVER_SPECIFIC") return null;
  if (!opts.decision.observerType || !opts.decision.observerId) return null;

  const db = opts.db ?? getDb();
  const sender = {
    observerType: opts.decision.observerType,
    observerId: opts.decision.observerId,
  };

  const projection = buildKnownPersonaFactsProjectionForObserver({
    chatId: opts.chatId,
    personaId: opts.personaId,
    observerType: sender.observerType,
    observerId: sender.observerId,
    legacySecretDescription: opts.legacySecretDescription,
    authority: opts.authority,
    db,
  });
  if (projection.projectedFacts.length === 0) return null;

  const receivers = listEligibleReceivers({ chatId: opts.chatId, sender, db });
  if (receivers.size === 0) return null;

  const factRefBySecretId = new Map<string, S4FactRef>();
  const facts = new Map<S4FactRef, S4GenerationFactEntry>();
  projection.projectedFacts.forEach((item, index) => {
    const ref = nextFactRef(index);
    factRefBySecretId.set(item.secretId, ref);
    facts.set(ref, {
      factRef: ref,
      secretId: item.secretId,
      senderKnowledgeState: item.state,
      factSnapshot: item.fact,
    });
  });

  const nonce = opaqueNonce();
  const ctx: S4GenerationTransferContext = {
    nonce,
    facts,
    receivers,
    promptFragment: "",
    sender,
  };
  ctx.promptFragment = buildS4TransferOutputContractFragment(ctx);
  return ctx;
}

export function buildPersonaKnowledgeWithS4ForTurn(opts: {
  decision: PersonaKnowledgePromptDecision;
  chatId: number;
  personaId: number;
  legacySecretDescription?: string;
  authority?: PersonaKnowledgePromptAuthority;
  allowS4?: boolean;
  db?: Database.Database;
}): { block: string | null; s4Context: S4GenerationTransferContext | null } {
  if (opts.allowS4 === false) {
    return {
      block: buildPersonaKnowledgePromptBlock({
        decision: opts.decision,
        chatId: opts.chatId,
        personaId: opts.personaId,
        legacySecretDescription: opts.legacySecretDescription,
        authority: opts.authority,
        db: opts.db,
      }),
      s4Context: null,
    };
  }

  const s4Context = buildS4GenerationTransferContext({
    decision: opts.decision,
    chatId: opts.chatId,
    personaId: opts.personaId,
    legacySecretDescription: opts.legacySecretDescription,
    authority: opts.authority,
    db: opts.db,
  });
  if (!s4Context) {
    return {
      block: buildPersonaKnowledgePromptBlock({
        decision: opts.decision,
        chatId: opts.chatId,
        personaId: opts.personaId,
        legacySecretDescription: opts.legacySecretDescription,
        authority: opts.authority,
        db: opts.db,
      }),
      s4Context: null,
    };
  }

  const factRefBySecretId = new Map<string, string>();
  for (const [ref, entry] of s4Context.facts.entries()) {
    factRefBySecretId.set(entry.secretId, ref);
  }
  const block = buildKnownPersonaFactsProjectionForObserver({
    chatId: opts.chatId,
    personaId: opts.personaId,
    observerType: s4Context.sender.observerType,
    observerId: s4Context.sender.observerId,
    legacySecretDescription: opts.legacySecretDescription,
    authority: opts.authority,
    factRefBySecretId,
    db: opts.db,
  }).block;

  if (!block?.trim()) {
    return { block: null, s4Context: null };
  }

  return {
    block: `${block.trimEnd()}\n\n${s4Context.promptFragment}`,
    s4Context,
  };
}
