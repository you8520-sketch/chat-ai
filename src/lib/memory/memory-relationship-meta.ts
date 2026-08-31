import { getDb } from "@/lib/db";
import type { Route } from "@/lib/ai";
import {
  extractRelationshipMetaFromTurn,
  extractRelationshipMetaAfterRegenerate,
  type RelationshipMetaExtractResult,
} from "@/lib/ai";
import {
  EMPTY_MEMORY_META,
  mergeMemoryMeta,
  normalizeMemoryMeta,
  parseMemoryMeta,
  restrictRelationshipMetaDeltaToDurableAutoFacts,
  type HonorificNames,
  type MemoryMeta,
  type RelationshipMetaCategory,
  type RelationshipMetaDelta,
} from "@/lib/chatMemory";
import { isMemoryFeatureEnabled } from "./memory-feature";
import {
  getMemorySourceBoundary,
  isMemoryWriteGuardCurrentCore,
  type MemorySourceBoundary,
} from "./memory-source-boundary";
import { setMemoryRelationshipTaskState } from "./memoryRelationshipTask";
import {
  isCurrentAssistantGeneration,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";

export type { RelationshipMetaCategory };

export type RelationshipMetaApplyResult = {
  meta: MemoryMeta;
  accepted: boolean;
  rejectReason?: "stale_epoch_rejected" | "stale_generation_rejected";
};

export function loadChatRelationshipMeta(chatId: number, names?: HonorificNames): MemoryMeta {
  const db = getDb();
  const row = db
    .prepare("SELECT memory_meta FROM chats WHERE id=?")
    .get(chatId) as { memory_meta: string } | undefined;
  const meta = parseMemoryMeta(row?.memory_meta);
  return names ? normalizeMemoryMeta(meta, names) : meta;
}

export function saveChatRelationshipMeta(chatId: number, meta: MemoryMeta): void {
  const db = getDb();
  db.prepare("UPDATE chats SET memory_meta=? WHERE id=?").run(JSON.stringify(meta), chatId);
}

export function removeRelationshipMetaItem(
  meta: MemoryMeta,
  category: RelationshipMetaCategory,
  text: string
): MemoryMeta {
  const needle = text.trim();
  if (!needle) return meta;
  if (category === "promises") {
    return {
      ...meta,
      promises: meta.promises.filter((p) => p.text !== needle),
    };
  }
  return {
    ...meta,
    [category]: meta[category].filter((item) => item !== needle),
  };
}

export function clearChatRelationshipMeta(chatId: number): void {
  saveChatRelationshipMeta(chatId, { ...EMPTY_MEMORY_META });
}

/**
 * Roll back relationship-meta entries added by a deleted turn.
 *
 * The deleted turn's user+assistant text is no longer in the transcript, so any
 * promise/item/thought/honorific that was extracted *from that turn* should not
 * survive. We cannot perfectly reconstruct "which turn added X" from the merged
 * projection, so we re-derive from remaining messages: load all surviving turns,
 * re-run extraction is too expensive — instead we remove entries whose text no
 * longer appears in any surviving message.
 *
 * Conservative: only removes entries that are exact substring matches of the
 * deleted turn's text and are absent from all other turns.
 */
export function rollbackRelationshipMetaForDeletedTurn(opts: {
  chatId: number;
  names: HonorificNames;
  deletedUserText: string;
  deletedAssistantText: string;
}): MemoryMeta {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC"
    )
    .all(opts.chatId) as { role: string; content: string }[];
  const survivingText = rows.map((r) => r.content).join("\n");

  const deletedText = `${opts.deletedUserText}\n${opts.deletedAssistantText}`;
  const meta = loadChatRelationshipMeta(opts.chatId, opts.names);

  const filterOut = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
    // Keep if still present in surviving messages.
    if (survivingText.includes(t)) return true;
    // Remove only if it was present in the deleted turn.
    return !deletedText.includes(t);
  };

  const next: MemoryMeta = {
    honorifics: meta.honorifics.filter(filterOut),
    items: meta.items.filter(filterOut),
    thoughts: meta.thoughts.filter(filterOut),
    promises: meta.promises.filter((p) => filterOut(p.text)),
    currentLocation: meta.currentLocation,
  };

  saveChatRelationshipMeta(opts.chatId, next);
  return next;
}

function hasRelationshipDelta(delta: RelationshipMetaDelta): boolean {
  return (
    (delta.items?.length ?? 0) > 0 ||
    (delta.itemsRemove?.length ?? 0) > 0 ||
    (delta.promisesAdd?.length ?? 0) > 0 ||
    (delta.promisesRemove?.length ?? 0) > 0
  );
}

export function applyRelationshipDeltaToChat(opts: {
  chatId: number;
  names: HonorificNames;
  delta: RelationshipMetaDelta;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  generationScope?: AssistantGenerationScope;
  __testThrowOnSave?: boolean;
}): RelationshipMetaApplyResult {
  const db = getDb();
  const snapshot = opts.boundarySnapshot ?? getMemorySourceBoundary(opts.chatId);
  return db.transaction((): RelationshipMetaApplyResult => {
    if (opts.generationScope && !isCurrentAssistantGeneration(opts.generationScope, db)) {
      console.info("STALE_GENERATION_RESULT_REJECTED", {
        family: "memory_relationship",
        messageId: opts.generationScope.assistantMessageId,
        generationSequence: opts.generationScope.generationSequence,
        phase: "projection_write",
      });
      return {
        meta: loadChatRelationshipMeta(opts.chatId, opts.names),
        accepted: false,
        rejectReason: "stale_generation_rejected",
      };
    }

    if (
      !isMemoryWriteGuardCurrentCore(db, {
        chatId: opts.chatId,
        snapshot,
        sourceUserMessageIds: [opts.sourceUserMessageId],
      })
    ) {
      console.info("MEMORY_STALE_EPOCH_REJECTED", {
        chat_id: opts.chatId,
        epoch: snapshot.epoch,
        source_message_id: opts.sourceUserMessageId ?? null,
      });
      return {
        meta: loadChatRelationshipMeta(opts.chatId, opts.names),
        accepted: false,
        rejectReason: "stale_epoch_rejected",
      };
    }

    // Merge the delta into the projection as it exists at commit time. Never
    // overwrite a reset with a stale pre-extraction JSON snapshot.
    const prev = loadChatRelationshipMeta(opts.chatId);
    const prevNormalized = normalizeMemoryMeta(prev, opts.names);
    const durableDelta = restrictRelationshipMetaDeltaToDurableAutoFacts(opts.delta);
    if (!hasRelationshipDelta(durableDelta)) {
      if (JSON.stringify(prev) !== JSON.stringify(prevNormalized)) {
        if (opts.__testThrowOnSave) {
          throw new Error("relationship meta save failed (test)");
        }
        saveChatRelationshipMeta(opts.chatId, prevNormalized);
      }
      return { meta: prevNormalized, accepted: true };
    }

    const merged = mergeMemoryMeta(prevNormalized, durableDelta, opts.names);
    if (opts.__testThrowOnSave) {
      throw new Error("relationship meta save failed (test)");
    }
    saveChatRelationshipMeta(opts.chatId, merged);
    return { meta: merged, accepted: true };
  }).immediate();
}

type ProviderBackedMergeOpts = {
  chatId: number;
  names: HonorificNames;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  assistantMessageId?: number;
  generationScope?: AssistantGenerationScope;
  __testExtract?: () => Promise<RelationshipMetaExtractResult>;
  __testThrowOnSave?: boolean;
};

function recordProviderBackedTaskTerminalState(
  assistantMessageId: number | undefined,
  outcome: "parse_failed" | "commit_accepted" | "stale_epoch_rejected" | "commit_failed",
  generationScope?: Pick<AssistantGenerationScope, "generationSequence" | "generationRequestId">
): void {
  if (!assistantMessageId) return;
  switch (outcome) {
    case "parse_failed":
      setMemoryRelationshipTaskState(assistantMessageId, "failed", "parse_failed", undefined, generationScope);
      break;
    case "commit_accepted":
      setMemoryRelationshipTaskState(assistantMessageId, "succeeded", undefined, undefined, generationScope);
      break;
    case "stale_epoch_rejected":
      setMemoryRelationshipTaskState(assistantMessageId, "failed", "stale_epoch_rejected", undefined, generationScope);
      break;
    case "commit_failed":
      setMemoryRelationshipTaskState(assistantMessageId, "failed", "commit_failed", undefined, generationScope);
      break;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

async function runProviderBackedRelationshipMerge(
  opts: ProviderBackedMergeOpts & {
    extract: () => Promise<RelationshipMetaExtractResult>;
  }
): Promise<MemoryMeta> {
  const prev = loadChatRelationshipMeta(opts.chatId);
  const prevNormalized = normalizeMemoryMeta(prev, opts.names);
  const generationScope = opts.generationScope;

  if (opts.assistantMessageId && generationScope) {
    setMemoryRelationshipTaskState(
      opts.assistantMessageId,
      "pending",
      undefined,
      undefined,
      generationScope
    );
  }

  let extractResult: RelationshipMetaExtractResult;
  try {
    extractResult = await opts.extract();
  } catch (e) {
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "commit_failed",
      generationScope
    );
    console.warn("[memory] relationship provider extract failed:", (e as Error).message);
    return prevNormalized;
  }

  if (!extractResult.parseOk) {
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "parse_failed",
      generationScope
    );
    return prevNormalized;
  }

  try {
    const applied = applyRelationshipDeltaToChat({
      chatId: opts.chatId,
      names: opts.names,
      delta: extractResult.delta,
      sourceUserMessageId: opts.sourceUserMessageId,
      boundarySnapshot: opts.boundarySnapshot,
      generationScope: generationScope ?? undefined,
      __testThrowOnSave: opts.__testThrowOnSave,
    });
    if (!applied.accepted) {
      if (applied.rejectReason === "stale_generation_rejected") {
        return applied.meta;
      }
      recordProviderBackedTaskTerminalState(
        opts.assistantMessageId,
        "stale_epoch_rejected",
        generationScope
      );
      return applied.meta;
    }
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "commit_accepted",
      generationScope
    );
    return applied.meta;
  } catch (e) {
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "commit_failed",
      generationScope
    );
    console.warn("[memory] relationship meta commit failed:", (e as Error).message);
    return prevNormalized;
  }
}

/** 턴 종료 후 호칭·물건·속마음·약속 추출 → chats.memory_meta 병합 */
export async function mergeRelationshipMetaFromTurn(opts: {
  chatId: number;
  names: HonorificNames;
  userMessage: string;
  assistantMessage: string;
  route: Route;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  /** DeepSeek/Qwen — 메인 모델 JSON tail 파싱 성공 시 Flash 생략 */
  mainModelTailParsed?: boolean;
  mainModelDelta?: RelationshipMetaDelta | null;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  assistantMessageId?: number;
  generationScope?: AssistantGenerationScope;
  __testExtract?: () => Promise<RelationshipMetaExtractResult>;
  __testThrowOnSave?: boolean;
}): Promise<MemoryMeta> {
  if (!isMemoryFeatureEnabled()) return loadChatRelationshipMeta(opts.chatId);
  const names = opts.names;

  if (opts.mainModelTailParsed === true) {
    if (opts.assistantMessageId) {
      setMemoryRelationshipTaskState(
        opts.assistantMessageId,
        "skipped",
        "main_model_tail_satisfied",
        undefined,
        opts.generationScope
      );
    }
    try {
      const applied = applyRelationshipDeltaToChat({
        chatId: opts.chatId,
        names,
        delta: opts.mainModelDelta ?? {},
        sourceUserMessageId: opts.sourceUserMessageId,
        boundarySnapshot: opts.boundarySnapshot,
        generationScope: opts.generationScope,
        __testThrowOnSave: opts.__testThrowOnSave,
      });
      return applied.meta;
    } catch (e) {
      console.warn("[memory] relationship main-tail commit failed:", (e as Error).message);
      return loadChatRelationshipMeta(opts.chatId, opts.names);
    }
  }

  const prevNormalized = normalizeMemoryMeta(loadChatRelationshipMeta(opts.chatId), names);

  return runProviderBackedRelationshipMerge({
    chatId: opts.chatId,
    names: opts.names,
    sourceUserMessageId: opts.sourceUserMessageId,
    boundarySnapshot: opts.boundarySnapshot,
    assistantMessageId: opts.assistantMessageId,
    generationScope: opts.generationScope,
    __testExtract: opts.__testExtract,
    __testThrowOnSave: opts.__testThrowOnSave,
    extract: () =>
      opts.__testExtract
        ? opts.__testExtract()
        : extractRelationshipMetaFromTurn(
            opts.userMessage,
            opts.assistantMessage,
            names.charName,
            names.userName,
            opts.route,
            prevNormalized,
            opts.turnTrace,
            opts.assistantMessageId && opts.generationScope
              ? {
                  chatId: opts.chatId,
                  assistantMessageId: opts.assistantMessageId,
                  generationSequence: opts.generationScope.generationSequence,
                  generationRequestId: opts.generationScope.generationRequestId,
                }
              : undefined
          ),
  });
}

/** 재생성 — 거부본 대비 소지품·속마음 제거 후 새 정본 반영 */
export async function mergeRelationshipMetaAfterRegenerate(opts: {
  chatId: number;
  names: HonorificNames;
  userMessage: string;
  newAssistantMessage: string;
  previousAssistantMessage: string;
  route: Route;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  assistantMessageId?: number;
  generationScope?: AssistantGenerationScope;
  __testExtract?: () => Promise<RelationshipMetaExtractResult>;
  __testThrowOnSave?: boolean;
}): Promise<MemoryMeta> {
  if (!isMemoryFeatureEnabled()) return loadChatRelationshipMeta(opts.chatId);
  const names = opts.names;
  const prevNormalized = normalizeMemoryMeta(loadChatRelationshipMeta(opts.chatId), names);

  return runProviderBackedRelationshipMerge({
    chatId: opts.chatId,
    names: opts.names,
    sourceUserMessageId: opts.sourceUserMessageId,
    boundarySnapshot: opts.boundarySnapshot,
    assistantMessageId: opts.assistantMessageId,
    generationScope: opts.generationScope,
    __testExtract: opts.__testExtract,
    __testThrowOnSave: opts.__testThrowOnSave,
    extract: () =>
      opts.__testExtract
        ? opts.__testExtract()
        : extractRelationshipMetaAfterRegenerate(
            opts.userMessage,
            opts.newAssistantMessage,
            opts.previousAssistantMessage,
            names.charName,
            names.userName,
            opts.route,
            prevNormalized,
            opts.turnTrace,
            opts.assistantMessageId && opts.generationScope
              ? {
                  chatId: opts.chatId,
                  assistantMessageId: opts.assistantMessageId,
                  generationSequence: opts.generationScope.generationSequence,
                  generationRequestId: opts.generationScope.generationRequestId,
                }
              : undefined
          ),
  });
}
