/**
 * Canonical persisted next-turn prompt preparation.
 * Production /api/chat and picker estimates both assemble ContextBuildInput here.
 * This module is side-effect-free: no generation_status, lease, memory write,
 * lorebook persist, canon compile, or provider I/O.
 */

import { createHash } from "node:crypto";
import type { ChatMsg } from "@/lib/ai";
import type { User } from "@/lib/auth";
import {
  parseAllowedConsentModes,
  parseModelRouteState,
  resolveEffectiveConsentMode,
} from "@/lib/adultSceneRouting";
import { canAccessAdultContent } from "@/lib/adultVerification";
import { resolveCanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { parseCanonPlanV1 } from "@/lib/canonPlan/serialize";
import type { CanonPlanV1 } from "@/lib/canonPlan/types";
import { parseAssets, chatAssets } from "@/lib/characterAssets";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
import { resolveCharacterGender } from "@/lib/characterGender";
import { sanitizeCharacterGenres } from "@/lib/characterGenres";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
import {
  resolveEffectiveAdultRp,
  resolveRoomAdultModeEnabled,
} from "@/lib/chatAdultHandoff";
import { formatMemoryMetaForPrompt, normalizeMemoryMeta, parseMemoryMeta } from "@/lib/chatMemory";
import { resolveHistoryTokenBudget } from "@/lib/contextTrack";
import { loadAttachedCreatorLorebooksPromptBlockFromActivation } from "@/lib/creatorLorebook";
import {
  buildPrivateSpeechControlBlock,
  parseCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import { getDb } from "@/lib/db";
import { loadGlobalLorebookPromptBlock } from "@/lib/globalLorebook";
import { chatInputSuppressesStatusWidget } from "@/lib/htmlDisplayOnlyTurn";
import {
  countPlayableTurns,
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
  shouldIncludeOpeningInProviderRaw,
  splitOpeningPlayableTurns,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { buildLorebookActivationText } from "@/lib/keywordLorebooks";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { getChatMemoryRow } from "@/lib/memory/memory-db";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import {
  buildMemoryContextForPreview,
  resolveMemoryTier,
} from "@/lib/memory/memory-manager";
import { countMemoryEligibleCompletedTurns } from "@/lib/memory/memory-turn-loader";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import { resolveNarrativePov, type ResolvedNarrativePov } from "@/lib/narrativePov";
import { formatUserNoteForPrompt } from "@/lib/persona";
import {
  buildGenerationKnowledgeContext,
  resolvePersonaKnowledgePromptDecisionForChat,
  type PersonaKnowledgePromptDecision,
} from "@/lib/personaKnowledgePromptPolicy";
import {
  isPersonaSecretBoundaryEnabled,
  isPersonaSecretDiscoveryEnabled,
} from "@/lib/personaSecretBoundaryPolicy";
import { buildPersonaKnowledgePromptBlock } from "@/lib/personaSecretKnowledge";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import {
  buildRevealedPersonaFactsBlockForPersona,
  listChatPersonaSecretReveals,
} from "@/lib/personaSecretReveal";
import {
  resolveProviderHistoryTurnFloor,
  trimProviderHistoryToBudget,
} from "@/lib/providerHistoryPolicy";
import { resolveRelationshipMetaNames } from "@/lib/relationshipMetaCharacterName";
import { normalizeTargetResponseChars } from "@/lib/responseLength";
import { buildSceneMomentumInputFromRoute } from "@/lib/sceneMomentum/routeInput";
import {
  resolveStatusWidgetTurn,
  statusWidgetModeForDefinitions,
} from "@/lib/statusWidget";
import { resolveSubscriptionMemoryCapability } from "@/lib/subscriptionMemoryCapability";
import { resolveEffectiveUserAuthoringFromChatColumn } from "@/lib/userCoauthorState";
import { loadUserLorebookPromptBlockFromActivation } from "@/lib/userLorebook";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import {
  getPersonaSecretPayload,
  listPublicUserPersonas,
  resolveChatSelectedPersona,
} from "@/lib/userPersonas";
import type { ContextBuildInput } from "@/types";

export const PERSISTED_NEXT_TURN_APPROXIMATION = {
  currentUserMessage: "",
  keywordLorebookFromUnsentDraft: "omitted",
  consentFromUnsentDraft: "omitted",
  canonLazyCompile: "omitted",
  personaS4LiveProducer: "omitted",
} as const;

export type NextTurnHistoryPreparation = {
  canonicalRecentHistoryFull: ChatMsg[];
  coverageProtectedHistory: ChatMsg[];
  promptHistory: ChatMsg[];
  completedTurns: number;
  completedTurnsForMemoryCoverage: number;
  summarizedTurnCount: number;
  historyMinTurnFloor: number;
  providerHistoryAbsoluteTurnFloor: number;
  providerHistoryProtectOpening: boolean;
  providerHistoryMinRealPlayableExchanges: number;
  providerRawPoolExchangeCount: number;
  historyTokenBudget: number;
};

export type NextTurnCharacterRow = {
  id: number;
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  world?: string | null;
  example_dialog?: string | null;
  greeting?: string | null;
  gender?: string | null;
  content_kind?: string | null;
  speech_profile?: string | null;
  speech_personality?: string | null;
  speech_traits?: string | null;
  narration_style_instructions?: string | null;
  jsx_components_json?: string | null;
  creator_compiled_description_json?: string | null;
  creator_canon_plan_json?: string | null;
  adult_consent_modes_json?: string | null;
  status_widget_json?: string | null;
  status_widget_allow_user_override?: number | null;
  genres?: string | null;
  assets?: string | null;
  simulation_cast?: string | null;
  setting_chunks?: string | null;
  setting_chunks_en?: string | null;
  prompt_translation_hash?: string | null;
  appearance_raw?: string | null;
  appearance_compiled?: string | null;
  updated_at?: string | null;
};

export type PersistedNextTurnPromptSections = {
  narrativePov: ResolvedNarrativePov;
  statusWidgetActive: boolean;
  keywordLorebookBlock: string;
  userLorebookBlock: string;
  globalLorebookBlock: string;
  relationshipMemory: string;
  privateSpeechControlBlock: string;
  jsxComponentCatalogJson: string;
  creatorNarrationStyle: string;
  focusMaxChars: number;
};

export type PersistedNextTurnSource = {
  chatId: number;
  character: NextTurnCharacterRow;
  chat: {
    id: number;
    mode: string;
    user_note: string;
    selected_persona_id: number | null;
    target_response_chars: number | null;
    narrative_pov?: string | null;
    pov_character_name?: string | null;
    memory_meta?: string | null;
    adult_handoff_enabled?: number | null;
    status_widget_stack_order?: string | null;
    status_widget_display_mode?: string | null;
    model_route_state_json?: string | null;
  };
  user: User;
  turns: DialogueTurn[];
  msgRows: Array<{ role: "user" | "assistant"; content: string; model?: string }>;
  personaDisplayName: string;
  userPersonaPrompt: string | null;
  userNotePrompt: string | null;
  selectedPersonaGender: ReturnType<typeof resolveCharacterGender>;
  selectedPersonaId: number | null;
  effectiveUserAuthoring: ReturnType<typeof resolveEffectiveUserAuthoringFromChatColumn>;
  characterChunks: ReturnType<typeof loadCharacterChunksForPromptReadOnly>["chunks"];
  usedEnglishCharacterPrompt: boolean;
  characterGenres: ReturnType<typeof sanitizeCharacterGenres>;
  assetTags: string[];
  settingText: string;
  targetResponseChars: number;
  nsfw: boolean;
  memoryFeatureOn: boolean;
  summarizedTurnCount: number;
  completedTurnsForMemoryCoverage: number;
  playableTurnCount: number;
  memoryCapability: ReturnType<typeof resolveSubscriptionMemoryCapability>;
  memoryTier: ReturnType<typeof resolveMemoryTier>;
  memoryCapacity: number;
  activeConsentMode: NonNullable<ContextBuildInput["activeConsentMode"]>;
  persistedCanonPlan: CanonPlanV1 | null;
  revealedPersonaFactsBlock: string | null;
  personaKnowledgePromptDecision: PersonaKnowledgePromptDecision;
};

export function hashPersistedNextTurnFingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function resolvePersistedActiveConsentMode(input: {
  modelRouteStateJson?: string | null;
  adultConsentModesJson?: string | null;
}): NonNullable<ContextBuildInput["activeConsentMode"]> {
  const previous = parseModelRouteState(input.modelRouteStateJson).activeConsentMode;
  return resolveEffectiveConsentMode({
    requested: undefined,
    previous,
    currentInput: "",
    allowedConsentModes: parseAllowedConsentModes(input.adultConsentModesJson),
  });
}

export function resolvePersistedCanonPlan(
  raw: string | null | undefined
): CanonPlanV1 | null {
  return parseCanonPlanV1(raw);
}

export function resolvePersistedPersonaKnownFacts(input: {
  user: User;
  chatId: number;
  character: NextTurnCharacterRow;
  selectedPersonaId: number | null;
}): {
  revealedPersonaFactsBlock: string | null;
  personaKnowledgePromptDecision: PersonaKnowledgePromptDecision;
} {
  const personaKnowledgePromptDecision: PersonaKnowledgePromptDecision = {
    mode: "ENSEMBLE_REDACTED",
    reasonCode: "MISSING_AUTHORITATIVE_SPEAKER",
  };
  if (
    !isPersonaSecretBoundaryEnabled({ userId: input.user.id }) ||
    input.selectedPersonaId == null
  ) {
    return { revealedPersonaFactsBlock: null, personaKnowledgePromptDecision };
  }

  if (isPersonaSecretDiscoveryEnabled({ userId: input.user.id })) {
    const decision = resolvePersonaKnowledgePromptDecisionForChat(
      buildGenerationKnowledgeContext({
        contentKind:
          input.character.content_kind === "simulation" ? "simulation" : "character",
        simulationCast: String(
          input.character.simulation_cast ?? input.character.system_prompt ?? ""
        ),
        characterId: Number(input.character.id),
      }),
      { chatId: input.chatId }
    );
    return {
      revealedPersonaFactsBlock: buildPersonaKnowledgePromptBlock({
        decision,
        chatId: input.chatId,
        personaId: Number(input.selectedPersonaId),
        authority: "discovery",
      }),
      personaKnowledgePromptDecision: decision,
    };
  }

  const secretPayload = getPersonaSecretPayload(
    input.user.id,
    Number(input.selectedPersonaId)
  );
  return {
    revealedPersonaFactsBlock: buildRevealedPersonaFactsBlockForPersona(
      listChatPersonaSecretReveals(input.chatId, Number(input.selectedPersonaId)),
      secretPayload?.secretDescription ?? ""
    ),
    personaKnowledgePromptDecision,
  };
}

export function prepareNextTurnHistory(input: {
  turns: DialogueTurn[];
  modelId: string;
  provider: "gemini" | "openrouter" | "openai" | "cheaperinference";
  memoryFeatureOn: boolean;
  completedTurnsForMemoryCoverage: number;
  summarizedTurnCount: number;
  personaDisplayName: string;
  userNickname: string;
  providerRawPoolExchangeCount?: number;
  providerRawTrimFloor?: number;
  protectOpening?: boolean;
}): NextTurnHistoryPreparation {
  const contextProvider =
    input.provider === "cheaperinference" ? "openrouter" : input.provider;
  const historyTokenBudget = resolveHistoryTokenBudget(input.modelId, contextProvider);
  const playableTurnCount = countPlayableTurns(input.turns);
  const unsummarizedTurns = Math.max(
    0,
    input.completedTurnsForMemoryCoverage - input.summarizedTurnCount
  );
  const providerRawPoolExchangeCount =
    input.providerRawPoolExchangeCount ??
    (input.memoryFeatureOn
      ? resolveProviderRawPoolExchangeCount({
          memoryFeatureEnabled: true,
          completedTurns: input.completedTurnsForMemoryCoverage,
          summarizedTurnCount: input.summarizedTurnCount,
        })
      : resolveProviderRawPoolExchangeCount({
          memoryFeatureEnabled: false,
          completedTurns: input.completedTurnsForMemoryCoverage,
          summarizedTurnCount: input.summarizedTurnCount,
        }));
  const providerRawTrimFloor =
    input.providerRawTrimFloor ??
    (input.memoryFeatureOn
      ? resolveProviderRawTrimFloorExchanges(unsummarizedTurns)
      : resolveProviderRawTrimFloorExchanges(0));
  const { opening: openingTurn, playable: playableTurnsForOpening } =
    splitOpeningPlayableTurns(input.turns);
  const protectOpening =
    input.protectOpening ??
    shouldIncludeOpeningInProviderRaw({
      opening: openingTurn,
      summarizedTurnCount: input.summarizedTurnCount,
      memoryFeatureEnabled: input.memoryFeatureOn,
      playableCount: playableTurnsForOpening.length,
    });
  const canonicalRecentHistoryFull: ChatMsg[] = rawRecentTurnsToHistory(
    input.turns,
    providerRawPoolExchangeCount,
    {
      summarizedTurnCount: input.summarizedTurnCount,
      memoryFeatureEnabled: input.memoryFeatureOn,
    }
  ).map((m) => ({
    ...m,
    content: replaceUserPlaceholder(m.content, input.personaDisplayName, input.userNickname),
  }));
  const providerHistoryAbsoluteTurnFloor = resolveProviderHistoryTurnFloor({
    minRealPlayableExchanges: providerRawTrimFloor,
    protectOpening,
    history: canonicalRecentHistoryFull,
  });
  const coverageProtectedHistory = trimProviderHistoryToBudget(
    canonicalRecentHistoryFull,
    historyTokenBudget,
    {
      minRealPlayableExchanges: providerRawTrimFloor,
      protectOpening,
    }
  );
  return {
    canonicalRecentHistoryFull,
    coverageProtectedHistory,
    promptHistory: coverageProtectedHistory,
    completedTurns: playableTurnCount,
    completedTurnsForMemoryCoverage: input.completedTurnsForMemoryCoverage,
    summarizedTurnCount: input.summarizedTurnCount,
    historyMinTurnFloor: providerHistoryAbsoluteTurnFloor,
    providerHistoryAbsoluteTurnFloor,
    providerHistoryProtectOpening: protectOpening,
    providerHistoryMinRealPlayableExchanges: providerRawTrimFloor,
    providerRawPoolExchangeCount,
    historyTokenBudget,
  };
}

/** Legacy picker history: untrimmed full dialogue. Kept only to prove the old mismatch. */
export function legacyPickerUntrimmedHistory(
  turns: DialogueTurn[],
  personaDisplayName: string,
  userNickname: string
): ChatMsg[] {
  return rawRecentTurnsToHistory(turns).map((m) => ({
    ...m,
    content: replaceUserPlaceholder(m.content, personaDisplayName, userNickname),
  }));
}

export function loadPersistedNextTurnSource(opts: {
  chatId: number;
  user: User;
}): PersistedNextTurnSource | null {
  const db = getDb();
  const chat = db
    .prepare(`SELECT * FROM chats WHERE id=? AND user_id=?`)
    .get(opts.chatId, opts.user.id) as PersistedNextTurnSource["chat"] | undefined;
  if (!chat) return null;

  const character = db
    .prepare(`SELECT * FROM characters WHERE id=?`)
    .get((chat as { character_id?: number }).character_id) as NextTurnCharacterRow | undefined;
  if (!character) return null;

  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(opts.chatId) as Array<{ role: "user" | "assistant"; content: string; model: string }>;

  const personas = listPublicUserPersonas(opts.user.id);
  const { persona: selectedPersona } = resolveChatSelectedPersona(
    opts.user,
    personas,
    chat.selected_persona_id
  );
  const personaDisplayName = selectedPersona?.name?.trim() || opts.user.nickname;
  const effectiveUserAuthoring = resolveEffectiveUserAuthoringFromChatColumn(
    db,
    chat.id,
    ""
  );
  const userPersonaPrompt = formatPublicPersonaForPrompt(
    personaDisplayName,
    selectedPersona?.gender ?? "other",
    selectedPersona?.description ?? "",
    { coNarrationEnabled: effectiveUserAuthoring.delegation.allowDialogue === true }
  );
  const memoryCapability = resolveSubscriptionMemoryCapability(opts.user);
  const userNote = chat.user_note?.trim() ?? "";
  const userNotePrompt = formatUserNoteForPrompt(userNote, memoryCapability.focusMaxChars);

  const { chunks: characterChunks, usedEnglish: usedEnglishCharacterPrompt } =
    loadCharacterChunksForPromptReadOnly(
      {
        id: Number(character.id),
        name: String(character.name),
        gender: String(character.gender ?? ""),
        system_prompt: String(character.system_prompt ?? ""),
        world: String(character.world ?? ""),
        example_dialog: String(character.example_dialog ?? ""),
        setting_chunks: String(character.setting_chunks ?? ""),
        setting_chunks_en: String(character.setting_chunks_en ?? ""),
        prompt_translation_hash: String(character.prompt_translation_hash ?? ""),
        speech_profile: String(character.speech_profile ?? ""),
        creator_compiled_description_json: String(
          character.creator_compiled_description_json ?? ""
        ),
        appearance_raw: String(character.appearance_raw ?? ""),
        appearance_compiled: String(character.appearance_compiled ?? ""),
      },
      personaDisplayName,
      opts.user.nickname
    );

  const characterGenres = sanitizeCharacterGenres(
    (() => {
      try {
        return JSON.parse(String(character.genres || "[]")) as unknown;
      } catch {
        return [];
      }
    })()
  );
  const characterAssets = chatAssets(parseAssets(String(character.assets ?? "[]")));
  const assetTags = [...new Set(characterAssets.map((a) => a.tag))];
  const settingText = collectCharacterSettingText(characterChunks);
  const turns = messagesToTurns(msgRows.map(({ role, content, model }) => ({ role, content, model })));
  const playableTurnCount = countPlayableTurns(turns);
  const memoryFeatureOn = isMemoryFeatureEnabled();
  const memoryRow = getChatMemoryRow(chat.id);
  const summarizedTurnCount = memoryFeatureOn ? (memoryRow?.summarized_turn_count ?? 0) : 0;
  const completedTurnsForMemoryCoverage = memoryFeatureOn
    ? countMemoryEligibleCompletedTurns(chat.id)
    : playableTurnCount;
  const roomAdultModeEnabled = resolveRoomAdultModeEnabled({
    persisted: chat.adult_handoff_enabled,
    userAdultVerified: canAccessAdultContent(opts.user),
  });
  const nsfw = resolveEffectiveAdultRp({
    userAdultVerified: canAccessAdultContent(opts.user),
    roomAdultModeEnabled,
  });
  const selectedPersonaId = selectedPersona?.id ?? chat.selected_persona_id;
  const personaKnownFacts = resolvePersistedPersonaKnownFacts({
    user: opts.user,
    chatId: chat.id,
    character,
    selectedPersonaId,
  });

  return {
    chatId: chat.id,
    character,
    chat,
    user: opts.user,
    turns,
    msgRows,
    personaDisplayName,
    userPersonaPrompt,
    userNotePrompt,
    selectedPersonaGender: resolveCharacterGender(selectedPersona?.gender ?? "other"),
    selectedPersonaId,
    effectiveUserAuthoring,
    characterChunks,
    usedEnglishCharacterPrompt,
    characterGenres,
    assetTags,
    settingText,
    targetResponseChars: normalizeTargetResponseChars(chat.target_response_chars),
    nsfw,
    memoryFeatureOn,
    summarizedTurnCount,
    completedTurnsForMemoryCoverage,
    playableTurnCount,
    memoryCapability,
    memoryTier: resolveMemoryTier(opts.user),
    memoryCapacity: getChatMemoryCapacity(chat.id),
    activeConsentMode: resolvePersistedActiveConsentMode({
      modelRouteStateJson: chat.model_route_state_json,
      adultConsentModesJson: character.adult_consent_modes_json,
    }),
    persistedCanonPlan: resolvePersistedCanonPlan(character.creator_canon_plan_json),
    revealedPersonaFactsBlock: personaKnownFacts.revealedPersonaFactsBlock,
    personaKnowledgePromptDecision: personaKnownFacts.personaKnowledgePromptDecision,
  };
}

export async function resolvePersistedNextTurnPromptSections(
  source: PersistedNextTurnSource,
  opts?: { currentUserMessage?: string }
): Promise<PersistedNextTurnPromptSections> {
  const db = getDb();
  const currentUserMessage = opts?.currentUserMessage ?? "";
  const contentKind =
    source.character.content_kind === "simulation" ? "simulation" : "character";
  const narrativePov = resolveNarrativePov({
    mode: source.chat.narrative_pov,
    contentKind,
    mainCharacterName: source.character.name,
    povCharacterName: source.chat.pov_character_name,
  });

  const personaWidgetJson =
    source.selectedPersonaId != null
      ? String(
          (
            listPublicUserPersonas(source.user.id).find((p) => p.id === source.selectedPersonaId) as
              | { active_status_widget_json?: string }
              | undefined
          )?.active_status_widget_json ?? ""
        )
      : "";
  const statusWidgetEngineMode = statusWidgetModeForDefinitions({
    characterWidgetJson: source.character.status_widget_json,
    personaWidgetJson,
    characterAllowUserOverride: source.character.status_widget_allow_user_override !== 0,
  });
  const statusWidgetTurn = resolveStatusWidgetTurn({
    characterWidgetJson: source.character.status_widget_json,
    chatMode: statusWidgetEngineMode,
    userWidgetJson: personaWidgetJson,
    stackOrder: source.chat.status_widget_stack_order,
    displayMode: source.chat.status_widget_display_mode,
    characterAllowUserOverride: source.character.status_widget_allow_user_override !== 0,
  });
  const statusWidgetActive =
    statusWidgetTurn.active && !chatInputSuppressesStatusWidget(currentUserMessage);

  const lorebookActivation = buildLorebookActivationText({
    currentUserMessage,
    recentTurns: source.turns.map((turn) => ({
      user: replaceUserPlaceholder(turn.user, source.personaDisplayName, source.user.nickname),
      assistant: replaceUserPlaceholder(
        turn.assistant,
        source.personaDisplayName,
        source.user.nickname
      ),
    })),
  });
  const creatorContentsForDedupe = new Set<string>();
  const keywordLorebookBlock = loadAttachedCreatorLorebooksPromptBlockFromActivation(
    db,
    source.character.id,
    lorebookActivation,
    {
      chatId: source.chat.id,
      currentTurn: source.playableTurnCount + 1,
      persistActiveMatches: false,
      onMatch: (match) => {
        creatorContentsForDedupe.add(match.content.trim());
      },
    }
  );
  const userLorebookBlock = loadUserLorebookPromptBlockFromActivation(db, {
    chatId: source.chat.id,
    userId: source.user.id,
    capability: source.memoryCapability,
    activation: lorebookActivation,
    currentTurn: source.playableTurnCount + 1,
    excludeContents: creatorContentsForDedupe,
    persistActiveMatches: false,
  });
  const globalLorebookScanText = [
    currentUserMessage,
    source.userNotePrompt,
    source.userPersonaPrompt,
    source.settingText,
  ]
    .filter(Boolean)
    .join("\n");
  const globalLorebookBlock = loadGlobalLorebookPromptBlock(
    db,
    globalLorebookScanText,
    globalLorebookScanText
  );

  const relationshipNames = resolveRelationshipMetaNames({
    displayName: source.character.name,
    systemPrompt: String(source.character.system_prompt ?? ""),
    chunks: source.characterChunks,
    userName: source.personaDisplayName,
  });
  const relationshipMemory = source.memoryFeatureOn
    ? formatMemoryMetaForPrompt(
        normalizeMemoryMeta(parseMemoryMeta(source.chat.memory_meta), relationshipNames)
      ) ?? ""
    : "";

  return {
    narrativePov,
    statusWidgetActive,
    keywordLorebookBlock,
    userLorebookBlock,
    globalLorebookBlock,
    relationshipMemory,
    privateSpeechControlBlock: buildPrivateSpeechControlBlock(
      parseCreatorDescriptionCompiled(source.character.creator_compiled_description_json)
    ),
    jsxComponentCatalogJson: source.character.jsx_components_json ?? "",
    creatorNarrationStyle: source.character.narration_style_instructions ?? "",
    focusMaxChars: source.memoryCapability.focusMaxChars,
  };
}

export function fingerprintPersistedNextTurnSource(
  source: PersistedNextTurnSource,
  sections: PersistedNextTurnPromptSections
): string {
  return hashPersistedNextTurnFingerprint({
    characterId: source.character.id,
    characterUpdatedAt: source.character.updated_at ?? "",
    description: source.character.description ?? "",
    speechPersonality: source.character.speech_personality ?? "",
    speechTraits: source.character.speech_traits ?? "",
    speechProfile: source.character.speech_profile ?? "",
    narration: sections.creatorNarrationStyle,
    jsx: sections.jsxComponentCatalogJson,
    systemPrompt: source.character.system_prompt ?? "",
    world: source.character.world ?? "",
    exampleDialog: source.character.example_dialog ?? "",
    chatMode: source.chat.mode,
    userNote: source.chat.user_note ?? "",
    personaId: source.chat.selected_persona_id,
    targetResponseChars: source.targetResponseChars,
    narrativePov: sections.narrativePov,
    nsfw: source.nsfw,
    authoring: source.effectiveUserAuthoring.delegation,
    messages: source.msgRows.map((row) => [row.role, row.content, row.model ?? ""]),
    summarizedTurnCount: source.summarizedTurnCount,
    completedTurnsForMemoryCoverage: source.completedTurnsForMemoryCoverage,
    statusWidgetActive: sections.statusWidgetActive,
    keywordLorebookBlock: sections.keywordLorebookBlock,
    userLorebookBlock: sections.userLorebookBlock,
    globalLorebookBlock: sections.globalLorebookBlock,
    relationshipMemory: sections.relationshipMemory,
    privateSpeech: sections.privateSpeechControlBlock,
    persona: source.userPersonaPrompt,
    userNotePrompt: source.userNotePrompt,
    memoryMeta: source.chat.memory_meta ?? "",
    activeConsentMode: source.activeConsentMode,
    creatorCanonPlanJson: source.character.creator_canon_plan_json ?? "",
    revealedPersonaFactsBlock: source.revealedPersonaFactsBlock ?? "",
  });
}

export function assembleNextTurnContextBuildInput(input: {
  character: NextTurnCharacterRow;
  user: Pick<User, "id" | "nickname">;
  chatId: number;
  chunks: ContextBuildInput["chunks"];
  exampleDialog: string;
  userPersona?: string | null;
  revealedPersonaFactsBlock?: string | null;
  userNote?: string | null;
  longTermMemory?: string | null;
  mediumTermMemoryBlock?: string | null;
  archiveMemory?: string | null;
  history: NextTurnHistoryPreparation;
  shortTermHistory?: ChatMsg[];
  currentUserMessage: string;
  currentTurnAuthoringDelegation: ContextBuildInput["currentTurnAuthoringDelegation"];
  nsfw: boolean;
  activeConsentMode?: ContextBuildInput["activeConsentMode"];
  assetTags?: string[];
  modelId: string;
  novelModeEnabled?: boolean;
  runtimeMode?: ContextBuildInput["runtimeMode"];
  personaDisplayName: string;
  targetResponseChars: number;
  userPersonaGender?: ContextBuildInput["userPersonaGender"];
  genres?: ContextBuildInput["genres"];
  useEnglishCharacterPrompt?: boolean;
  isContinue?: boolean;
  regenerate?: boolean;
  rejectedAssistantDraft?: string | null;
  regenAttemptId?: string | null;
  sections: PersistedNextTurnPromptSections;
  canonInjectionPolicy?: ContextBuildInput["canonInjectionPolicy"];
  canonPlan?: ContextBuildInput["canonPlan"];
  sceneMomentumInput?: ContextBuildInput["sceneMomentumInput"];
  sceneDirectiveBlock?: string | null;
  scenePacingPromptOwner?: ContextBuildInput["scenePacingPromptOwner"];
  episodicMemoryBlock?: string | null;
  triggeredScenarioEventsBlock?: string | null;
  rpDiagnosticCanary?: ContextBuildInput["rpDiagnosticCanary"];
  preserveAdultHandoffRawHistory?: boolean;
  adultHandoffRequiredTurnFloor?: number;
  provider?: ContextBuildInput["provider"];
}): ContextBuildInput {
  const contentKind =
    input.character.content_kind === "simulation" ? "simulation" : "character";
  return {
    charName: input.character.name,
    contentKind,
    narrativePov: input.sections.narrativePov,
    chunks: input.chunks,
    systemPrompt: String(input.character.system_prompt ?? ""),
    world: String(input.character.world ?? ""),
    exampleDialog: input.exampleDialog,
    speechProfileJson: input.character.speech_profile,
    speechPersonality: input.character.speech_personality,
    speechTraits: input.character.speech_traits,
    characterPersonality: input.character.description ?? "",
    creatorNarrationStyle: input.sections.creatorNarrationStyle,
    userNickname: input.user.nickname,
    userPersona: input.userPersona,
    revealedPersonaFactsBlock: input.revealedPersonaFactsBlock ?? undefined,
    userNote: input.userNote,
    longTermMemory: input.longTermMemory ?? "",
    mediumTermMemoryBlock: input.mediumTermMemoryBlock ?? "",
    archiveMemory: input.archiveMemory ?? "",
    shortTermHistory: input.shortTermHistory ?? input.history.promptHistory,
    currentUserMessage: input.currentUserMessage,
    currentTurnAuthoringDelegation: input.currentTurnAuthoringDelegation,
    nsfw: input.nsfw,
    activeConsentMode: input.activeConsentMode,
    gender: resolveCharacterGender(String(input.character.gender ?? "")),
    assetTags: input.assetTags && input.assetTags.length > 0 ? input.assetTags : undefined,
    memoryMeta: input.sections.relationshipMemory || undefined,
    modelId: input.modelId,
    novelModeEnabled: input.novelModeEnabled ?? false,
    runtimeMode: input.runtimeMode,
    personaDisplayName: input.personaDisplayName,
    userId: input.user.id,
    chatId: input.chatId,
    targetResponseChars: input.targetResponseChars,
    completedTurns: input.history.completedTurns,
    completedTurnsForMemoryCoverage: input.history.completedTurnsForMemoryCoverage,
    summarizedTurnCount: input.history.summarizedTurnCount,
    historyMinTurnFloor: input.history.historyMinTurnFloor,
    providerHistoryAbsoluteTurnFloor: input.history.providerHistoryAbsoluteTurnFloor,
    providerHistoryProtectOpening: input.history.providerHistoryProtectOpening,
    providerHistoryMinRealPlayableExchanges:
      input.history.providerHistoryMinRealPlayableExchanges,
    adultHandoffRequiredTurnFloor: input.adultHandoffRequiredTurnFloor ?? 0,
    userPersonaGender: input.userPersonaGender,
    provider: input.provider ?? "openrouter",
    genres: input.genres,
    useEnglishCharacterPrompt: input.useEnglishCharacterPrompt,
    isContinue: input.isContinue ?? false,
    regenerate: input.regenerate ?? false,
    rejectedAssistantDraft: input.rejectedAssistantDraft ?? undefined,
    regenAttemptId: input.regenAttemptId ?? undefined,
    geminiStaticDynamicMode: false,
    episodicMemoryBlock: input.episodicMemoryBlock || undefined,
    triggeredScenarioEventsBlock: input.triggeredScenarioEventsBlock || undefined,
    privateSpeechControlBlock: input.sections.privateSpeechControlBlock || undefined,
    sceneDirectiveBlock: input.sceneDirectiveBlock ?? undefined,
    scenePacingPromptOwner: input.scenePacingPromptOwner,
    keywordLorebookBlock: input.sections.keywordLorebookBlock || undefined,
    userLorebookBlock: input.sections.userLorebookBlock || undefined,
    focusMaxChars: input.sections.focusMaxChars,
    globalLorebookBlock: input.sections.globalLorebookBlock || undefined,
    canonInjectionPolicy: input.canonInjectionPolicy,
    canonPlan: input.canonPlan ?? null,
    sceneMomentumInput: input.sceneMomentumInput,
    rpDiagnosticCanary: input.rpDiagnosticCanary ?? null,
    preserveAdultHandoffRawHistory: input.preserveAdultHandoffRawHistory ?? false,
    jsxComponentCatalogJson: input.sections.jsxComponentCatalogJson,
    statusWidgetActive: input.sections.statusWidgetActive,
    mainModelOwnsRelationshipExtract: false,
  };
}

export async function assemblePersistedNextTurnInputs(opts: {
  source: PersistedNextTurnSource;
  sections: PersistedNextTurnPromptSections;
  modelId: string;
  currentUserMessage?: string;
}): Promise<ContextBuildInput> {
  const currentUserMessage = opts.currentUserMessage ?? PERSISTED_NEXT_TURN_APPROXIMATION.currentUserMessage;
  const history = prepareNextTurnHistory({
    turns: opts.source.turns,
    modelId: opts.modelId,
    provider: "openrouter",
    memoryFeatureOn: opts.source.memoryFeatureOn,
    completedTurnsForMemoryCoverage: opts.source.completedTurnsForMemoryCoverage,
    summarizedTurnCount: opts.source.summarizedTurnCount,
    personaDisplayName: opts.source.personaDisplayName,
    userNickname: opts.source.user.nickname,
  });
  const trimmedHistoryForLorebook = history.coverageProtectedHistory;
  const memoryInjection = opts.source.memoryFeatureOn
    ? await buildMemoryContextForPreview({
        chatId: opts.source.chat.id,
        tier: opts.source.memoryTier,
        memoryCapacity: opts.source.memoryCapacity,
        userMessage: currentUserMessage,
        modelId: opts.modelId,
        provider: "openrouter",
        excludeSummaryTurnStartGte: resolveLorebookExcludeFromTrimmedHistory(
          opts.source.turns,
          trimmedHistoryForLorebook
        ),
      })
    : { text: "", mediumTermText: "", archiveText: "" };

  const sceneMomentumInput = buildSceneMomentumInputFromRoute({
    shortTermHistory: history.promptHistory,
    currentUserMessage,
    normalizedMemoryMeta: opts.source.memoryFeatureOn
      ? normalizeMemoryMeta(
          parseMemoryMeta(opts.source.chat.memory_meta),
          resolveRelationshipMetaNames({
            displayName: opts.source.character.name,
            systemPrompt: String(opts.source.character.system_prompt ?? ""),
            chunks: opts.source.characterChunks,
            userName: opts.source.personaDisplayName,
          })
        )
      : null,
  });

  return assembleNextTurnContextBuildInput({
    character: opts.source.character,
    user: opts.source.user,
    chatId: opts.source.chat.id,
    chunks: opts.source.characterChunks,
    exampleDialog: resolveExampleDialogForPrompt(
      String(opts.source.character.example_dialog ?? ""),
      String(opts.source.character.name)
    ),
    userPersona: opts.source.userPersonaPrompt,
    userNote: opts.source.userNotePrompt,
    longTermMemory: memoryInjection.text,
    mediumTermMemoryBlock: memoryInjection.mediumTermText,
    archiveMemory: memoryInjection.archiveText,
    history,
    currentUserMessage,
    currentTurnAuthoringDelegation: opts.source.effectiveUserAuthoring.delegation,
    nsfw: opts.source.nsfw,
    activeConsentMode: opts.source.activeConsentMode,
    revealedPersonaFactsBlock: opts.source.revealedPersonaFactsBlock,
    assetTags: opts.source.assetTags,
    modelId: opts.modelId,
    personaDisplayName: opts.source.personaDisplayName,
    targetResponseChars: opts.source.targetResponseChars,
    userPersonaGender: opts.source.selectedPersonaGender,
    genres: opts.source.characterGenres,
    useEnglishCharacterPrompt: opts.source.usedEnglishCharacterPrompt,
    sections: opts.sections,
    canonInjectionPolicy: resolveCanonInjectionPolicy(opts.modelId, {
      userId: opts.source.user.id,
      chatId: opts.source.chat.id,
    }),
    canonPlan: opts.source.persistedCanonPlan,
    sceneMomentumInput,
  });
}
