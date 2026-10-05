/**
 * TEST-ONLY frozen production mapper from main `bd3db384`.
 * Regression oracle for /api/chat inline ContextBuildInput + history prep.
 * Named *.test.ts so Next/app typecheck never compile it as production.
 * Do not import from production runtime paths.
 */
import type { ChatMsg } from "@/lib/ai";
import type { User } from "@/lib/auth";
import { resolveCharacterGender } from "@/lib/characterGender";
import { resolveHistoryTokenBudget } from "@/lib/contextTrack";
import {
  countPlayableTurns,
  rawRecentTurnsToHistory,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { resolveNarrativePov } from "@/lib/narrativePov";
import {
  resolveProviderHistoryTurnFloor,
  trimProviderHistoryToBudget,
} from "@/lib/providerHistoryPolicy";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import type { ContextBuildInput } from "@/types";
import type {
  NextTurnCharacterRow,
  NextTurnHistoryPreparation,
  PersistedNextTurnPromptSections,
} from "@/services/nextTurnAssemblyPreparation";

export type FrozenLegacyHistoryInput = {
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
};

/** Exact history prep from main `bd3db384` /api/chat before shared-owner extraction. */
export function prepareLegacyProductionNextTurnHistory(
  input: FrozenLegacyHistoryInput
): NextTurnHistoryPreparation {
  const contextProvider =
    input.provider === "cheaperinference" ? "openrouter" : input.provider;
  const historyTokenBudget = resolveHistoryTokenBudget(input.modelId, contextProvider);
  const providerRawPoolExchangeCount = input.providerRawPoolExchangeCount;
  const providerRawTrimFloor = input.providerRawTrimFloor;
  const protectOpening = input.protectOpening;
  if (
    providerRawPoolExchangeCount == null ||
    providerRawTrimFloor == null ||
    protectOpening == null
  ) {
    throw new Error("legacy history fixture requires explicit pool/floor/opening");
  }
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
    completedTurns: countPlayableTurns(input.turns),
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

export type FrozenLegacyProductionMapperInput = {
  character: NextTurnCharacterRow;
  user: Pick<User, "id" | "nickname">;
  chat: {
    id: number;
    narrative_pov?: string | null;
    pov_character_name?: string | null;
  };
  chunks: ContextBuildInput["chunks"];
  exampleDialog: string;
  userPersona?: string | null;
  revealedPersonaFactsBlock?: string | null;
  userNote?: string | null;
  memoryFeatureOn: boolean;
  longTermMemory?: string;
  mediumTermMemoryBlock?: string;
  archiveMemory?: string;
  promptHistory: ChatMsg[];
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
  playableTurnCount: number;
  completedTurnsForMemoryCoverage: number;
  summarizedTurnCount: number;
  historyMinTurnFloor: number;
  providerHistoryAbsoluteTurnFloor: number;
  protectOpening: boolean;
  providerRawTrimFloor: number;
  adultHandoffRequiredTurnFloor?: number;
  relationshipMemoryForPrompt?: string;
  privateSpeechControlBlock?: string;
  keywordLorebookBlock?: string;
  userLorebookBlock?: string;
  globalLorebookBlock?: string;
  focusMaxChars: number;
  statusWidgetActive: boolean;
  canonInjectionPolicy?: ContextBuildInput["canonInjectionPolicy"];
  canonPlan?: ContextBuildInput["canonPlan"];
  sceneMomentumInput?: ContextBuildInput["sceneMomentumInput"];
  sceneDirectiveBlock?: string | null;
  relocateSceneDirectiveToUserTurn?: boolean;
  scenePacingPromptOwner?: ContextBuildInput["scenePacingPromptOwner"];
  episodicMemoryBlock?: string | null;
  triggeredScenarioEventsBlock?: string | null;
  rpDiagnosticCanary?: ContextBuildInput["rpDiagnosticCanary"];
};

/** Exact ContextBuildInput object from main `bd3db384` /api/chat. */
export function assembleLegacyProductionContextBuildInput(
  input: FrozenLegacyProductionMapperInput
): ContextBuildInput {
  const ch = input.character;
  const chat = input.chat;
  const user = input.user;
  return {
    charName: ch.name,
    contentKind: ch.content_kind === "simulation" ? "simulation" as const : "character" as const,
    narrativePov: resolveNarrativePov({
      mode: chat.narrative_pov,
      contentKind: ch.content_kind === "simulation" ? "simulation" : "character",
      mainCharacterName: ch.name,
      povCharacterName: chat.pov_character_name,
    }),
    chunks: input.chunks,
    systemPrompt: ch.system_prompt,
    world: ch.world,
    exampleDialog: input.exampleDialog,
    speechProfileJson: ch.speech_profile,
    speechPersonality: ch.speech_personality,
    speechTraits: ch.speech_traits,
    characterPersonality: ch.description,
    creatorNarrationStyle: ch.narration_style_instructions ?? "",
    userNickname: user.nickname,
    userPersona: input.userPersona,
    revealedPersonaFactsBlock: input.revealedPersonaFactsBlock ?? undefined,
    userNote: input.userNote,
    longTermMemory: input.memoryFeatureOn ? (input.longTermMemory ?? "") : "",
    mediumTermMemoryBlock: input.memoryFeatureOn ? (input.mediumTermMemoryBlock ?? "") : "",
    archiveMemory: input.memoryFeatureOn ? (input.archiveMemory ?? "") : "",
    shortTermHistory: input.promptHistory,
    currentUserMessage: input.currentUserMessage,
    currentTurnAuthoringDelegation: input.currentTurnAuthoringDelegation,
    nsfw: input.nsfw,
    activeConsentMode: input.activeConsentMode,
    gender: resolveCharacterGender(ch.gender),
    assetTags: input.assetTags && input.assetTags.length > 0 ? input.assetTags : undefined,
    memoryMeta: input.relationshipMemoryForPrompt,
    modelId: input.modelId,
    novelModeEnabled: input.novelModeEnabled,
    runtimeMode: input.runtimeMode,
    personaDisplayName: input.personaDisplayName,
    userId: user.id,
    chatId: chat.id,
    targetResponseChars: input.targetResponseChars,
    completedTurns: input.playableTurnCount,
    completedTurnsForMemoryCoverage: input.completedTurnsForMemoryCoverage,
    summarizedTurnCount: input.summarizedTurnCount,
    historyMinTurnFloor: input.historyMinTurnFloor,
    providerHistoryAbsoluteTurnFloor: input.providerHistoryAbsoluteTurnFloor,
    providerHistoryProtectOpening: input.protectOpening,
    providerHistoryMinRealPlayableExchanges: input.providerRawTrimFloor,
    adultHandoffRequiredTurnFloor: input.adultHandoffRequiredTurnFloor,
    userPersonaGender: input.userPersonaGender ?? "other",
    provider: "openrouter" as const,
    genres: input.genres,
    useEnglishCharacterPrompt: input.useEnglishCharacterPrompt,
    isContinue: input.isContinue,
    regenerate: !!input.regenerate,
    rejectedAssistantDraft: input.regenerate ? input.rejectedAssistantDraft ?? undefined : undefined,
    regenAttemptId: input.regenerate ? input.regenAttemptId ?? undefined : undefined,
    geminiStaticDynamicMode: false,
    episodicMemoryBlock: input.episodicMemoryBlock || undefined,
    triggeredScenarioEventsBlock: input.triggeredScenarioEventsBlock || undefined,
    privateSpeechControlBlock: input.privateSpeechControlBlock || undefined,
    sceneDirectiveBlock: input.relocateSceneDirectiveToUserTurn
      ? null
      : input.sceneDirectiveBlock,
    scenePacingPromptOwner: input.scenePacingPromptOwner,
    keywordLorebookBlock: input.keywordLorebookBlock || undefined,
    userLorebookBlock: input.userLorebookBlock || undefined,
    focusMaxChars: input.focusMaxChars,
    globalLorebookBlock: input.globalLorebookBlock || undefined,
    canonInjectionPolicy: input.canonInjectionPolicy,
    canonPlan: input.canonPlan ?? null,
    sceneMomentumInput: input.sceneMomentumInput,
    rpDiagnosticCanary: input.rpDiagnosticCanary ?? null,
    preserveAdultHandoffRawHistory: false,
    jsxComponentCatalogJson: ch.jsx_components_json ?? "",
  };
}

export function sharedOwnerArgsFromLegacyFixture(
  input: FrozenLegacyProductionMapperInput,
  history: NextTurnHistoryPreparation,
  sections: PersistedNextTurnPromptSections
) {
  return {
    character: input.character,
    user: input.user,
    chatId: input.chat.id,
    chunks: input.chunks,
    exampleDialog: input.exampleDialog,
    userPersona: input.userPersona,
    revealedPersonaFactsBlock: input.revealedPersonaFactsBlock,
    userNote: input.userNote,
    longTermMemory: input.memoryFeatureOn ? (input.longTermMemory ?? "") : "",
    mediumTermMemoryBlock: input.memoryFeatureOn ? (input.mediumTermMemoryBlock ?? "") : "",
    archiveMemory: input.memoryFeatureOn ? (input.archiveMemory ?? "") : "",
    history,
    shortTermHistory: input.promptHistory,
    currentUserMessage: input.currentUserMessage,
    currentTurnAuthoringDelegation: input.currentTurnAuthoringDelegation,
    nsfw: input.nsfw,
    activeConsentMode: input.activeConsentMode,
    assetTags: input.assetTags,
    modelId: input.modelId,
    novelModeEnabled: input.novelModeEnabled,
    runtimeMode: input.runtimeMode,
    personaDisplayName: input.personaDisplayName,
    targetResponseChars: input.targetResponseChars,
    userPersonaGender: input.userPersonaGender ?? "other",
    genres: input.genres,
    useEnglishCharacterPrompt: input.useEnglishCharacterPrompt,
    isContinue: input.isContinue,
    regenerate: !!input.regenerate,
    rejectedAssistantDraft: input.regenerate ? input.rejectedAssistantDraft : undefined,
    regenAttemptId: input.regenerate ? input.regenAttemptId : undefined,
    sections,
    canonInjectionPolicy: input.canonInjectionPolicy,
    canonPlan: input.canonPlan ?? null,
    sceneMomentumInput: input.sceneMomentumInput,
    sceneDirectiveBlock: input.relocateSceneDirectiveToUserTurn
      ? null
      : input.sceneDirectiveBlock,
    scenePacingPromptOwner: input.scenePacingPromptOwner,
    episodicMemoryBlock: input.episodicMemoryBlock,
    triggeredScenarioEventsBlock: input.triggeredScenarioEventsBlock,
    rpDiagnosticCanary: input.rpDiagnosticCanary ?? null,
    adultHandoffRequiredTurnFloor: input.adultHandoffRequiredTurnFloor,
    provider: "openrouter" as const,
  };
}
