import { getDb } from "@/lib/db";
import { parseAssets, chatAssets } from "@/lib/characterAssets";
import { sanitizeCharacterGenres } from "@/lib/characterGenres";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import { resolveCharacterGender } from "@/lib/characterGender";
import { resolveHistoryTokenBudget } from "@/lib/contextTrack";
import {
  countPlayableTurns,
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  trimHistoryToBudget,
} from "@/lib/hybridMemory";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import {
  buildMemoryContextForPreview,
  resolveMemoryTier,
} from "@/lib/memory/memory-manager";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { resolveEffectiveUserAuthoringFromChatColumn } from "@/lib/userCoauthorState";
import {
  formatSelectedPersonaForPrompt,
  getPersonaSecretPayload,
  listPublicUserPersonas,
  resolveChatSelectedPersona,
} from "@/lib/userPersonas";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import { DEFAULT_SELECTED_AI } from "@/lib/chatModels";
import {
  MODEL_PICKER_ACTIVE_MODEL_IDS,
  type ModelPickerActiveModelId,
} from "@/lib/modelPickerPreview";
import { normalizeTargetResponseChars } from "@/lib/responseLength";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
import type { User } from "@/lib/auth";
import { buildContext } from "@/services/contextBuilder";
import {
  isPersonaSecretBoundaryEnabled,
  isPersonaSecretDiscoveryEnabled,
} from "@/lib/personaSecretBoundaryPolicy";
import { buildPersonaKnowledgePromptBlock } from "@/lib/personaSecretKnowledge";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
  withEnsembleRedactedPromptAssembly,
} from "@/lib/personaKnowledgePromptPolicy";
import type { ChatMsg } from "@/lib/ai";

export type SnapshotCacheEntry = {
  tokensByModel: Partial<Record<ModelPickerActiveModelId, number>>;
  messageCount: number;
  chatMode: string;
  personaId: number | null;
  userNote: string;
  targetResponseChars: number;
  authoringFingerprint: string;
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

function snapshotCacheKey(chatId: number): SnapshotCacheEntry | undefined {
  return touchSnapshotCache(chatId);
}

export function matchesModelPickerSnapshotCache(
  cached: SnapshotCacheEntry | undefined,
  current: Omit<SnapshotCacheEntry, "tokensByModel">
): boolean {
  return !!cached &&
    cached.messageCount === current.messageCount &&
    cached.chatMode === current.chatMode &&
    cached.personaId === current.personaId &&
    cached.userNote === current.userNote &&
    cached.targetResponseChars === current.targetResponseChars &&
    cached.authoringFingerprint === current.authoringFingerprint;
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
  const db = getDb();
  const chat = db
    .prepare(
      `SELECT id, character_id, mode, user_note, selected_persona_id, target_response_chars
       FROM chats WHERE id=? AND user_id=?`
    )
    .get(opts.chatId, opts.user.id) as
    | {
        id: number;
        character_id: number;
        mode: string;
        user_note: string;
        selected_persona_id: number | null;
        target_response_chars: number | null;
      }
    | undefined;

  if (!chat) return null;

  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(opts.chatId) as Array<{ role: "user" | "assistant"; content: string; model: string }>;

  const messageCount = msgRows.length;
  const userNote = chat.user_note?.trim() ?? "";
  const targetResponseChars = normalizeTargetResponseChars(chat.target_response_chars);
  // Same persisted base, current-epoch OOC override, and empty next-turn input
  // as the ordinary Main RP request. Resolving before the cache check also
  // catches setting changes that do not add a message.
  const effectiveUserAuthoring = resolveEffectiveUserAuthoringFromChatColumn(
    db,
    chat.id,
    ""
  );
  const authoringFingerprint = JSON.stringify(effectiveUserAuthoring.delegation);
  const cached = snapshotCacheKey(opts.chatId);
  const cacheMatches = matchesModelPickerSnapshotCache(cached, {
    messageCount,
    chatMode: chat.mode,
    personaId: chat.selected_persona_id,
    userNote,
    targetResponseChars,
    authoringFingerprint,
  });
  if (!opts.refresh && cacheMatches) {
    return cached!.tokensByModel;
  }

  const ch = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, assets, genres,
              setting_chunks, setting_chunks_en, prompt_translation_hash, speech_profile,
              creator_compiled_description_json, appearance_raw, appearance_compiled,
              content_kind, simulation_cast
       FROM characters WHERE id=?`
    )
    .get(chat.character_id) as Record<string, unknown> | undefined;

  if (!ch) return cacheMatches ? cached!.tokensByModel : null;

  const personas = listPublicUserPersonas(opts.user.id);
  const { persona: selectedPersona } = resolveChatSelectedPersona(
    opts.user,
    personas,
    chat.selected_persona_id
  );
  const personaDisplayName = selectedPersona?.name?.trim() || opts.user.nickname;
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    selectedPersona?.gender ?? "other",
    selectedPersona?.description ?? "",
    { coNarrationEnabled: effectiveUserAuthoring.delegation.allowDialogue === true }
  );
  const userNotePrompt = formatUserNoteForPrompt(userNote);

  const { chunks: characterChunks, usedEnglish: usedEnglishCharacterPrompt } =
    loadCharacterChunksForPromptReadOnly(
      {
        id: Number(ch.id),
        name: String(ch.name),
        gender: String(ch.gender ?? ""),
        system_prompt: String(ch.system_prompt ?? ""),
        world: String(ch.world ?? ""),
        example_dialog: String(ch.example_dialog ?? ""),
        setting_chunks: String(ch.setting_chunks ?? ""),
        setting_chunks_en: String(ch.setting_chunks_en ?? ""),
        prompt_translation_hash: String(ch.prompt_translation_hash ?? ""),
        speech_profile: String(ch.speech_profile ?? ""),
        creator_compiled_description_json: String(ch.creator_compiled_description_json ?? ""),
        appearance_raw: String(ch.appearance_raw ?? ""),
        appearance_compiled: String(ch.appearance_compiled ?? ""),
      },
      personaDisplayName,
      opts.user.nickname
    );

  const dialogueTurns = messagesToTurns(
    msgRows.map(({ role, content, model }) => ({ role, content, model }))
  );
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  const sharedContextModelId = DEFAULT_SELECTED_AI;
  const historyTokenBudget = resolveHistoryTokenBudget(sharedContextModelId, "openrouter");

  const recentHistoryFull: ChatMsg[] = rawRecentTurnsToHistory(dialogueTurns).map((m) => ({
    ...m,
    content: replaceUserPlaceholder(m.content, personaDisplayName, opts.user.nickname),
  }));
  const trimmedHistoryForLorebook = trimHistoryToBudget(recentHistoryFull, historyTokenBudget);

  const memoryFeatureOn = isMemoryFeatureEnabled();
  const memoryTier = resolveMemoryTier(opts.user);
  const memoryCapacity = getChatMemoryCapacity(chat.id);
  const memoryInjection = memoryFeatureOn
    ? await buildMemoryContextForPreview({
        chatId: chat.id,
        tier: memoryTier,
        memoryCapacity,
        userMessage: "",
        modelId: sharedContextModelId,
        provider: "openrouter",
        excludeSummaryTurnStartGte: resolveLorebookExcludeFromTrimmedHistory(
          dialogueTurns,
          trimmedHistoryForLorebook
        ),
      })
    : { text: "", mediumTermText: "", archiveText: "" };

  const characterGenres = sanitizeCharacterGenres(
    (() => {
      try {
        return JSON.parse(String(ch.genres || "[]")) as unknown;
      } catch {
        return [];
      }
    })()
  );
  const characterAssets = chatAssets(parseAssets(String(ch.assets ?? "[]")));
  const assetTags = [...new Set(characterAssets.map((a) => a.tag))];
  collectCharacterSettingText(characterChunks);

  // PR-S4C: same decision as main generation — never show observer facts on ensemble.
  let revealedPersonaFactsBlock: string | null | undefined;
  let contentKind: "character" | "simulation" = "character";
  const personaKnowledgeAssemble = <T,>(fn: () => T): T => fn();
  let assemblePickerContext = personaKnowledgeAssemble;
  if (
    isPersonaSecretBoundaryEnabled() &&
    isPersonaSecretDiscoveryEnabled({ userId: opts.user.id })
  ) {
    const personaId = selectedPersona?.id ?? chat.selected_persona_id;
    contentKind = String(ch.content_kind ?? "") === "simulation" ? "simulation" : "character";
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind,
        simulationCast: String(ch.simulation_cast ?? ch.system_prompt ?? ""),
        characterId: Number(ch.id),
      }),
      { chatId: chat.id }
    );
    if (personaId != null) {
      const secretPayload = getPersonaSecretPayload(opts.user.id, Number(personaId));
      revealedPersonaFactsBlock = buildPersonaKnowledgePromptBlock({
        decision,
        chatId: chat.id,
        personaId: Number(personaId),
        authority: "discovery",
      });
    }
    if (decision.mode === "ENSEMBLE_REDACTED") {
      assemblePickerContext = (fn) => withEnsembleRedactedPromptAssembly(fn);
    }
  }

  const tokensByModel: Partial<Record<ModelPickerActiveModelId, number>> = {};
  for (const modelId of MODEL_PICKER_ACTIVE_MODEL_IDS) {
    const built = assemblePickerContext(() =>
      buildContext({
      charName: String(ch.name),
      contentKind,
      chunks: characterChunks,
      revealedPersonaFactsBlock: revealedPersonaFactsBlock ?? undefined,
      systemPrompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      exampleDialog: resolveExampleDialogForPrompt(String(ch.example_dialog ?? ""), String(ch.name)),
      speechProfileJson: String(ch.speech_profile ?? ""),
      speechPersonality: (ch as { speech_personality?: string }).speech_personality,
      speechTraits: (ch as { speech_traits?: string }).speech_traits,
      characterPersonality: String(ch.description ?? ""),
      userNickname: opts.user.nickname,
      userPersona: userPersonaPrompt,
      userNote: userNotePrompt,
      longTermMemory: memoryFeatureOn ? memoryInjection.text : "",
      mediumTermMemoryBlock: memoryFeatureOn ? memoryInjection.mediumTermText : "",
      archiveMemory: memoryFeatureOn ? memoryInjection.archiveText : "",
      shortTermHistory: recentHistoryFull,
      currentUserMessage: "",
      nsfw: chat.mode === "nsfw",
      gender: resolveCharacterGender(String(ch.gender ?? "")),
      assetTags: assetTags.length > 0 ? assetTags : undefined,
      modelId,
      currentTurnAuthoringDelegation: effectiveUserAuthoring.delegation,
      novelModeEnabled: false,
      personaDisplayName,
      targetResponseChars,
      completedTurns: playableTurnCount,
      userPersonaGender: selectedPersona?.gender ?? "other",
      provider: "openrouter",
      genres: characterGenres,
      useEnglishCharacterPrompt: usedEnglishCharacterPrompt,
      isContinue: false,
      regenerate: false,
      geminiStaticDynamicMode: false,
      statusWidgetActive: false,
      mainModelOwnsRelationshipExtract: false,
    })
    );
    const tokens =
      built.meta.promptAudit?.totalAssembledTokens ?? built.meta.estimatedInputTokens;
    if (typeof tokens === "number" && tokens > 0) {
      tokensByModel[modelId] = tokens;
    }
  }

  if (Object.keys(tokensByModel).length > 0) {
    rememberModelPickerInputSnapshot(opts.chatId, {
      tokensByModel,
      messageCount,
      chatMode: chat.mode,
      personaId: chat.selected_persona_id,
      userNote,
      targetResponseChars,
      authoringFingerprint,
    });
    return tokensByModel;
  }

  return cacheMatches ? cached!.tokensByModel : null;
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
