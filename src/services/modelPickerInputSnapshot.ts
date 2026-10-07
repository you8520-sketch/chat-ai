import type { User } from "@/lib/auth";
import { DEFAULT_SELECTED_AI } from "@/lib/chatModels";
import {
  MODEL_PICKER_ACTIVE_MODEL_IDS,
  type ModelPickerActiveModelId,
} from "@/lib/modelPickerPreview";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { countPlayableTurns, messagesToTurns } from "@/lib/hybridMemory";
import type {
  NextTurnPromptAuditSections,
  NextTurnRawHistoryHealth,
} from "@/lib/mainRpNextTurnEstimate";
import { promptAuditSectionsFromPromptAudit } from "@/lib/mainRpNextTurnEstimate";
import { buildContext } from "@/services/contextBuilder";
import {
  assemblePersistedNextTurnInputs,
  fingerprintPersistedNextTurnSource,
  loadPersistedNextTurnSource,
  preparePreviousRequestHistory,
  resolvePersistedNextTurnPromptSections,
} from "@/services/nextTurnAssemblyPreparation";
import { withEnsembleRedactedPromptAssembly } from "@/lib/personaKnowledgePromptPolicy";

export type ModelPickerAssemblyEvidence = {
  assembledInputTokens: number;
  currentUserEstimatedTokens: number;
  nextPromptHistory: Array<{ role: "user" | "assistant"; content: string }>;
  previousPromptHistory: Array<{ role: "user" | "assistant"; content: string }>;
  nextPromptAuditSections: NextTurnPromptAuditSections | null;
  nextRawHistoryHealth: NextTurnRawHistoryHealth;
};

export type SnapshotCacheEntry = {
  tokensByModel: Partial<Record<ModelPickerActiveModelId, number>>;
  evidenceByModel?: Partial<Record<ModelPickerActiveModelId, ModelPickerAssemblyEvidence>>;
  sourceFingerprint: string;
};

export type ModelPickerAssembledSnapshot = {
  tokensByModel: Partial<Record<ModelPickerActiveModelId, number>>;
  evidenceByModel: Partial<Record<ModelPickerActiveModelId, ModelPickerAssemblyEvidence>>;
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

let assembledSnapshotRebuildCount = 0;

export function modelPickerAssembledSnapshotRebuildCount(): number {
  return assembledSnapshotRebuildCount;
}

export function resetModelPickerAssembledSnapshotRebuildCount(): void {
  assembledSnapshotRebuildCount = 0;
}

export async function resolveModelPickerAssembledSnapshotEvidence(opts: {
  chatId: number;
  user: User;
  previousSummarizedTurnCount?: number | null;
}): Promise<ModelPickerAssembledSnapshot | null> {
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
  if (
    matchesModelPickerSnapshotCache(cached, { sourceFingerprint }) &&
    cached!.evidenceByModel
  ) {
    return {
      tokensByModel: cached!.tokensByModel,
      evidenceByModel: cached!.evidenceByModel,
    };
  }
  assembledSnapshotRebuildCount += 1;

  const assemblePickerContext = <T,>(fn: () => T): T =>
    source.personaKnowledgePromptDecision.mode === "ENSEMBLE_REDACTED"
      ? withEnsembleRedactedPromptAssembly(fn)
      : fn();

  const tokensByModel: Partial<Record<ModelPickerActiveModelId, number>> = {};
  const evidenceByModel: Partial<
    Record<ModelPickerActiveModelId, ModelPickerAssemblyEvidence>
  > = {};
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
    if (typeof tokens !== "number" || tokens <= 0) continue;
    tokensByModel[modelId] = tokens;
    const previousHistory = preparePreviousRequestHistory({
      turns: source.turns,
      modelId,
      provider: "openrouter",
      memoryFeatureOn: source.memoryFeatureOn,
      completedTurnsForMemoryCoverage: source.completedTurnsForMemoryCoverage,
      summarizedTurnCount:
        opts.previousSummarizedTurnCount ?? source.summarizedTurnCount,
      personaDisplayName: source.personaDisplayName,
      userNickname: source.user.nickname,
    });
    evidenceByModel[modelId] = {
      assembledInputTokens: tokens,
      currentUserEstimatedTokens: 0,
      nextPromptHistory: (contextBuildInput.shortTermHistory ?? []).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      previousPromptHistory: previousHistory.promptHistory.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      nextPromptAuditSections: promptAuditSectionsFromPromptAudit({
        breakdown: built.meta.promptAudit?.breakdown ?? null,
      }),
      nextRawHistoryHealth: {
        summarizedThroughTurn:
          contextBuildInput.summarizedTurnCount ?? source.summarizedTurnCount,
        unsummarizedCompletedTurns: Math.max(
          0,
          (contextBuildInput.completedTurnsForMemoryCoverage ??
            source.completedTurnsForMemoryCoverage) - source.summarizedTurnCount
        ),
      },
    };
  }

  if (Object.keys(tokensByModel).length > 0) {
    rememberModelPickerInputSnapshot(opts.chatId, {
      tokensByModel,
      evidenceByModel,
      sourceFingerprint,
    });
    return { tokensByModel, evidenceByModel };
  }

  return matchesModelPickerSnapshotCache(cached, { sourceFingerprint }) && cached!.evidenceByModel
    ? {
        tokensByModel: cached!.tokensByModel,
        evidenceByModel: cached!.evidenceByModel,
      }
    : null;
}

export async function resolveModelPickerAssembledInputSnapshots(opts: {
  chatId: number;
  user: User;
}): Promise<Partial<Record<ModelPickerActiveModelId, number>> | null> {
  const snapshot = await resolveModelPickerAssembledSnapshotEvidence(opts);
  return snapshot?.tokensByModel ?? null;
}

/** @deprecated Use the per-model snapshot map for pricing previews. */
export async function resolveModelPickerAssembledInputSnapshot(opts: {
  chatId: number;
  user: User;
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
