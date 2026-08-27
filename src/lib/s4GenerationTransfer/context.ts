/**
 * Request-local S4 generation context — facts from sender knowledge rows only.
 */

import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { getActiveChatScene } from "@/lib/chatScenes";
import { getChatObserver } from "@/lib/observerIdentity";
import type { PersonaKnowledgePromptDecision } from "@/lib/personaKnowledgePromptPolicy";
import {
  buildPersonaKnowledgePromptBlock,
  listKnownObserverSecretKnowledge,
  type PersonaKnowledgePromptAuthority,
} from "@/lib/personaSecretKnowledge";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";
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

const MAX_S4_FACTS = 8;

function opaqueNonce(): string {
  return randomBytes(8).toString("base64url");
}

function nextFactRef(index: number): S4FactRef {
  return `K${index + 1}` as S4FactRef;
}

function nextReceiverRef(index: number): S4ReceiverRef {
  return `R${index + 1}` as S4ReceiverRef;
}

export function buildS4GenerationTransferContext(opts: {
  decision: PersonaKnowledgePromptDecision;
  chatId: number;
  personaId: number;
  db?: Database.Database;
}): S4GenerationTransferContext | null {
  if (opts.decision.mode !== "OBSERVER_SPECIFIC") return null;
  if (!opts.decision.observerType || !opts.decision.observerId) return null;

  const db = opts.db ?? getDb();
  const sender = {
    observerType: opts.decision.observerType,
    observerId: opts.decision.observerId,
  };

  const knowledge = listKnownObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    observerType: sender.observerType,
    observerId: sender.observerId,
    db,
  }).filter((row) => row.knowledge_state === "CONFIRMED" || row.knowledge_state === "SUSPECTED");

  const facts = new Map<S4FactRef, S4GenerationFactEntry>();
  const seenFacts = new Set<string>();
  let factIndex = 0;
  for (const row of knowledge) {
    if (factIndex >= MAX_S4_FACTS) break;
    const factSnapshot = sanitizeRevealedFactForPrompt(row.fact_snapshot);
    if (!factSnapshot || seenFacts.has(factSnapshot)) continue;
    seenFacts.add(factSnapshot);
    const ref = nextFactRef(factIndex++);
    facts.set(ref, {
      factRef: ref,
      secretId: row.secret_id,
      senderKnowledgeState: row.knowledge_state,
      factSnapshot,
    });
  }
  if (facts.size === 0) return null;

  const scene = getActiveChatScene(opts.chatId, db);
  if (!scene) return null;

  const receivers = new Map<S4ReceiverRef, S4GenerationReceiverEntry>();
  let receiverIndex = 0;
  for (const presence of listScenePresence(scene.id, db)) {
    if (receiverIndex >= MAX_S4_FACTS) break;
    if (
      presence.observer_type === sender.observerType &&
      presence.observer_id === sender.observerId
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
        db,
      })
    ) {
      continue;
    }
    const obs = getChatObserver({
      chatId: opts.chatId,
      observerType: presence.observer_type,
      observerId: presence.observer_id,
      db,
    });
    const ref = nextReceiverRef(receiverIndex++);
    receivers.set(ref, {
      receiverRef: ref,
      observerType: presence.observer_type,
      observerId: presence.observer_id,
      displayName: obs?.display_name?.trim() || presence.observer_id,
    });
  }
  if (receivers.size === 0) return null;

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

/** Map secretId → K ref for inline persona-knowledge line labels. */
export function s4FactRefBySecretId(ctx: S4GenerationTransferContext): Map<string, S4FactRef> {
  const out = new Map<string, S4FactRef>();
  for (const entry of ctx.facts.values()) {
    out.set(entry.secretId, entry.factRef);
  }
  return out;
}

/**
 * Append S4 contract to persona knowledge block without duplicating fact bodies.
 */
export function augmentPersonaKnowledgeBlockForS4(
  baseBlock: string | null,
  ctx: S4GenerationTransferContext | null
): string | null {
  if (!ctx) return baseBlock;
  if (!baseBlock?.trim()) return null;
  return `${baseBlock.trimEnd()}\n\n${ctx.promptFragment}`;
}

export function buildPersonaKnowledgeWithS4ForTurn(opts: {
  decision: PersonaKnowledgePromptDecision;
  chatId: number;
  personaId: number;
  legacySecretDescription?: string;
  authority?: PersonaKnowledgePromptAuthority;
  db?: Database.Database;
}): { block: string | null; s4Context: S4GenerationTransferContext | null } {
  const s4Context = buildS4GenerationTransferContext({
    decision: opts.decision,
    chatId: opts.chatId,
    personaId: opts.personaId,
    db: opts.db,
  });
  const block = buildPersonaKnowledgePromptBlock({
    decision: opts.decision,
    chatId: opts.chatId,
    personaId: opts.personaId,
    legacySecretDescription: opts.legacySecretDescription,
    authority: opts.authority,
    factRefBySecretId: s4Context ? s4FactRefBySecretId(s4Context) : undefined,
    db: opts.db,
  });
  return {
    block: augmentPersonaKnowledgeBlockForS4(block, s4Context),
    s4Context,
  };
}
