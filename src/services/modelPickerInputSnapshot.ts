import type { User } from "@/lib/auth";
import { DEFAULT_SELECTED_AI } from "@/lib/chatModels";
import {
  MODEL_PICKER_ACTIVE_MODEL_IDS,
  type ModelPickerActiveModelId,
} from "@/lib/modelPickerPreview";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { countPlayableTurns, messagesToTurns } from "@/lib/hybridMemory";
import { buildContext } from "@/services/contextBuilder";
import {
  assemblePersistedNextTurnInputs,
  fingerprintPersistedNextTurnSource,
  loadPersistedNextTurnSource,
  resolvePersistedNextTurnPromptSections,
} from "@/services/nextTurnAssemblyPreparation";
import { withEnsembleRedactedPromptAssembly } from "@/lib/personaKnowledgePromptPolicy";

export type SnapshotCacheEntry = {
  tokensByModel: Partial<Record<ModelPickerActiveModelId, number>>;
  sourceFingerprint: string;
};

const assembledSnapshotCache = new Map<number, SnapshotCacheEntry>();
/** Per-chat latest only; evict oldest chats when bound exceeded (long-lived Railway safety). */
export const MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES = 64;

function touchSnapshotCache(chatId: number): SnapshotCacheEntry | undefined {
  const entry = assembledSnapshotCache.get(chatId);
  if (!entry) return undefined;
  assembledSnapshotCache.delete(chatId);
  assembledSnapshotCache.set(chatId, entry);
  return entry;
}

function evictOldestSnapshotCacheEntries(): void {
  while (assembledSnapshotCache.size > MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldestChatId = assembledSnapshotCache.keys().next().value as number | undefined;
    if (oldestChatId == null) break;
    assembledSnapshotCache.delete(oldestChatId);
  }
}

export function modelPickerSnapshotCacheSize(): number {
  return assembledSnapshotCache.size;
}

export function invalidateModelPickerInputSnapshot(chatId: number): void {
  assembledSnapshotCache.delete(chatId);
}

export function matchesModelPickerSnapshotCache(
  cached: SnapshotCacheEntry | undefined,
  current: Pick<SnapshotCacheEntry, "sourceFingerprint">
): boolean {
  return !!cached && cached.sourceFingerprint === current.sourceFingerprint;
}

export function rememberModelPickerInputSnapshot(
  chatId: number,
  entry: SnapshotCacheEntry
): void {
  if (assembledSnapshotCache.has(chatId)) {
    assembledSnapshotCache.delete(chatId);
  }
  assembledSnapshotCache.set(chatId, entry);
  evictOldestSnapshotCacheEntries();
}

export async function resolveModelPickerAssembledInputSnapshots(opts: {
  chatId: number;
  user: User;
  refresh?: boolean;
}): Promise<Partial<Record<ModelPickerActiveModelId, number>> | null> {
  const source = loadPersistedNextTurnSource({
    chatId: opts.chatId,
    user: opts.user,
  });
  if (!source) return null;

  const sections = await resolvePersistedNextTurnPromptSections(source, {
    currentUserMessage: "",
  });
  const sourceFingerprint = fingerprintPersistedNextTurnSource(source, sections);
  const cached = touchSnapshotCache(opts.chatId);
  if (!opts.refresh && matchesModelPickerSnapshotCache(cached, { sourceFingerprint })) {
    return cached!.tokensByModel;
  }

  const assemblePickerContext = <T,>(fn: () => T): T =>
    source.personaKnowledgePromptDecision.mode === "ENSEMBLE_REDACTED"
      ? withEnsembleRedactedPromptAssembly(fn)
      : fn();

  const tokensByModel: Partial<Record<ModelPickerActiveModelId, number>> = {};
  for (const modelId of MODEL_PICKER_ACTIVE_MODEL_IDS) {
    const contextBuildInput = await assemblePersistedNextTurnInputs({
      source,
      sections,
      modelId,
      currentUserMessage: "",
    });
    const built = assemblePickerContext(() => buildContext(contextBuildInput));
    const tokens =
      built.meta.promptAudit?.totalAssembledTokens ?? built.meta.estimatedInputTokens;
    if (typeof tokens === "number" && tokens > 0) {
      tokensByModel[modelId] = tokens;
    }
  }

  if (Object.keys(tokensByModel).length > 0) {
    rememberModelPickerInputSnapshot(opts.chatId, {
      tokensByModel,
      sourceFingerprint,
    });
    return tokensByModel;
  }

  return matchesModelPickerSnapshotCache(cached, { sourceFingerprint })
    ? cached!.tokensByModel
    : null;
}

/** @deprecated Use the per-model snapshot map for pricing previews. */
export async function resolveModelPickerAssembledInputSnapshot(opts: {
  chatId: number;
  user: User;
  refresh?: boolean;
}): Promise<number | null> {
  const snapshots = await resolveModelPickerAssembledInputSnapshots(opts);
  if (!snapshots) return null;
  return (
    snapshots[DEFAULT_SELECTED_AI as ModelPickerActiveModelId] ??
    Object.values(snapshots).find((tokens) => typeof tokens === "number" && tokens > 0) ??
    null
  );
}

/** Opening-only chats still include greeting history — detect zero playable turns. */
export function isPickerColdStartChat(messages: Array<{ role: string; content: string }>): boolean {
  const turns = messagesToTurns(
    messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      model: "greeting",
    }))
  );
  return countPlayableTurns(turns) === 0 || messages.every((m) => m.content === OPENING_TURN_USER);
}
