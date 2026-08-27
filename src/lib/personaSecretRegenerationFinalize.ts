/**
 * Server-only regeneration canonical mutation boundary.
 * Message canonicalization and S4 worldline reconciliation commit together.
 */

import type Database from "better-sqlite3";
import { reconcileS4KnowledgeForVariantSwitch } from "@/lib/knowledgeTransferVariant";
import {
  finalizeAssistantMessageCore,
  type FinalizeAssistantMessageOpts,
  type FinalizeAssistantMessageResult,
} from "@/lib/streamingPersistence";

export type FinalizeRegenerationAssistantMessageOpts =
  FinalizeAssistantMessageOpts & {
    /** @internal test-only */
    __testThrowAfterS4Activation?: boolean;
    /** @internal test-only */
    __testThrowAfterS4Reprojection?: boolean;
  };

/** Transaction-free core for composition by numeric and nonnumeric owners. */
export function finalizeRegenerationAssistantMessageCore(
  db: Database.Database,
  opts: FinalizeRegenerationAssistantMessageOpts
): FinalizeAssistantMessageResult {
  const result = finalizeAssistantMessageCore(db, opts);
  if (result.wrote) {
    reconcileS4KnowledgeForVariantSwitch(db, {
      chatId: opts.chatId,
      assistantMessageId: opts.assistantMessageId,
      __testThrowAfterActivation: opts.__testThrowAfterS4Activation,
      __testThrowAfterReprojection: opts.__testThrowAfterS4Reprojection,
    });
  }
  return result;
}

/** BEGIN IMMEDIATE owner for nonnumeric regeneration finalization. */
export function executeAtomicRegenerationFinalize(
  db: Database.Database,
  opts: FinalizeRegenerationAssistantMessageOpts
): FinalizeAssistantMessageResult {
  return db
    .transaction(() => finalizeRegenerationAssistantMessageCore(db, opts))
    .immediate();
}
