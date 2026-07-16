import { estimateTokens } from "@/lib/ai";
import { resolveCharacterGender } from "@/lib/characterGender";
import {
  collectCharacterSettingText,
  resolveHairDescriptionPolicy,
} from "@/lib/bodyHairRules";
import { filterExampleDialogInSetting } from "@/lib/exampleDialogSceneFilter";
import {
  buildCharacterCanonBlock,
  buildCharacterSpeechRecencyTail,
  CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK,
  CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK_COMPACT,
} from "@/lib/characterKnowledgeBoundary";
import {
  promoteAppearanceChunkImportance,
} from "@/lib/visualAnchor";
import { SHORT_TERM_TURNS, trimHistoryToBudget } from "@/lib/hybridMemory";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import { buildFlashOwnedEmotionTagUserOverlay } from "@/lib/emotionTag";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";
import { isRegisterPatch } from "@/lib/registerPatchExperiment";
import { buildOocCoNarrationHint } from "@/lib/userImpersonationPolicy";
import {
  resolveChatRuntimeMode,
  type ChatRuntimeMode,
} from "@/lib/chatRuntimeMode";
import { wrapCurrentUserInput } from "@/lib/currentUserInputLabel";
import {
  buildNovelModeUserPersonaRules,
} from "@/lib/userPersonaNarrationRules";
import { stripRpMetaPreamble } from "@/lib/narrativeRules";
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";
import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";
import { buildRegenerateSystemDirective } from "@/lib/continueNarrative";
import {
  buildNoGodmoddingBlock,
  injectExampleDialogStyleOnlyNote,
  resolveNoGodmoddingMode,
  type NoGodmoddingMode,
} from "@/lib/noGodmodding";
import {
  buildCoreMasterPrompt,
  buildCoreMasterEarlyTurnHint,
  buildIdentityAndRulesBlock,
} from "@/lib/corePrompt";
import { splitUserNotePromptZones } from "@/lib/userNoteStatusWindow";
import {
  buildReferenceUserNotePromptBlock,
  selectReferenceUserNoteForInjection,
} from "@/lib/userNoteReferenceInjector";
import {
  resolveStatusWindowPolicyFromSources,
  stripRedundantStatusWindowFromSource,
  modelPlainStatusEveryTurnActive,
  markdownPipeTableStatusWindowActive,
} from "@/lib/statusWindowNotePolicy";
import {
  resolveHtmlVisualCardPolicyFromSources,
  stripRedundantHtmlVisualCardFromSource,
} from "@/lib/htmlVisualCardPolicy";
import {
  sanitizePrimaryModelContextSource,
  sanitizePrimaryModelHistoryMessages,
} from "@/lib/flashOwnedOutputFirewall";
import {
  formatUserMessageForPrompt,
  hasActionOrThoughtParts,
  settingHasMindReadingAbility,
  settingHasMindReadingFromChunks,
} from "@/lib/userActionThoughtRules";
import {
  buildUserInputParsingBlock,
  buildWebnovelOutputLayoutRecencyBlock,
  unwrapRoleplayMarkdownInText,
} from "@/lib/webnovelOutputFormat";
import type { CharacterChunk, GeminiContextSplit } from "@/types";
import {
  type BuiltContext,
  type ContextBuildInput,
  MODEL_SYSTEM_BUDGETS,
} from "@/types";
import {
  resolveContextTrack,
  resolveHistoryTokenBudget,
  resolveMaxPayloadInputTokens,
  GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD,
} from "@/lib/contextTrack";
import {
  assembleGeminiStaticDynamicSplit,
  finalizeGeminiStaticCache,
  isVolatilePromptSectionId,
} from "@/lib/geminiStaticDynamicContext";
import { logGeminiStaticChunkDiff } from "@/lib/geminiStaticCacheDiff";
import { isGeminiExplicitCacheEnabled } from "@/lib/geminiExplicitCache";
import {
  auditAssembledPrompt,
  type TrackedPromptSection,
} from "@/services/promptAudit";
import { resolvePromptDumpSource, writePromptBuildDump } from "@/services/promptDebugDump";
import {
  buildBilingualDialoguePromptBlock,
  isBilingualDialogueActive,
  resolveBilingualDialoguePolicyFromSources,
} from "@/lib/bilingualDialoguePolicy";
import {
  appendCompactTerminalLengthToUserTurn,
  buildLengthInstruction,
  buildTerminalLengthOverrideBlock,
  resolveResponseLengthTarget,
} from "@/lib/responseLength";
import { SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";
import type { OpenRouterSystemSplit } from "@/lib/openRouterCache";
import { estimateOpenRouterCacheableTokens, buildOpenRouterDynamicLoreUserPrefix, HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES } from "@/lib/openRouterCache";
import { isDeepSeekModel, isDeepSeekV4ProModel, isQwenModel } from "@/lib/chatModels";
import { DEEPSEEK_APPEARANCE_VARIATION_RULE } from "@/lib/appearanceCompiler";
import { buildCoNarrationKoreanRule } from "@/lib/openRouterAdult";
import { buildOpenRouterKoreanProseTopBlock } from "@/lib/openRouterProsePolicy";
import {
  createDeepSeekXmlBuffers,
  flushDeepSeekXmlBuffers,
  logDeepSeekContextStructure,
  prependDeepSeekBottomReminder,
  resolveDeepSeekLoreXmlGroup,
  type DeepSeekXmlGroup,
} from "@/lib/deepseekPromptStructure";
import {
  buildRuntimePromptContaminationGuardBlock,
  sanitizeRuntimePromptSource,
} from "@/lib/runtimePromptContaminationGuard";

type SectionTarget = "dynamic" | "cacheRules" | "cacheCharacter";

function resolveSystemBudget(modelId?: string, override?: number): number {
  if (override && override > 0) return override;
  if (modelId && MODEL_SYSTEM_BUDGETS[modelId]) return MODEL_SYSTEM_BUDGETS[modelId];
  return MODEL_SYSTEM_BUDGETS.default;
}

function sanitizeCharacterChunkForOpenRouter(content: string, isOpenRouter: boolean): string {
  if (!isOpenRouter) return content;
  return sanitizePrimaryModelContextSource(content);
}

function userMessageUsesRpInputMarkers(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\*[^*\n]+\*/.test(t)) return true;
  if (/[(\uff08\[][^\])）\]]+[)\uff09\]]/.test(t)) return true;
  return hasActionOrThoughtParts(t);
}

function needsUserInputParsingGuide(input: ContextBuildInput): boolean {
  const coNarrationEnabled = input.novelModeEnabled === true || !!input.userImpersonation;
  if (!coNarrationEnabled) return false;
  if (userMessageUsesRpInputMarkers(input.currentUserMessage)) return true;
  return input.shortTermHistory.some(
    (m) => m.role === "user" && userMessageUsesRpInputMarkers(m.content)
  );
}

/**
 * System prompt assembly — fixed priority (high → low):
 *   [TOP] OpenRouter Korean prose · bilingual · godmodding
 *   [1] Core Master Rules
 *   [2] Core Identity (full character profile every turn; OpenRouter cacheRules)
 *   [0] Identity & Rules (persona 1.2k + user-note focus 1k — absolute, cacheRules)
 *   [1.4] Prose style (OpenRouter cacheCharacter — stable)
 *   Dynamic block: [0c] Archive → [3] LTM (full budget trim, not RAG) → [3b] Relationship memo
 *     → [5] 유저노트 확장구간 RAG (UI 확장 칸 전용) → tail
 *
 * History: 전체 대화 raw → trimHistoryToBudget (전 모델 10K + 최소 4턴 floor).
 *   [4] OOC · [7] Style · Tail — operational
 *
 * Truncation order (when over payload budget): oldest chat history first;
 * never truncate identity/rules, user-note focus (≤1000), archive, relationship memo, or lorebook before history.
 */
export function buildContext(input: ContextBuildInput): BuiltContext {
  const budget = resolveSystemBudget(input.modelId, input.tokenBudget);
  const isOpenRouter = input.provider === "openrouter";
  const contextTrack = resolveContextTrack(input.modelId, input.provider);
  let truncatedMemory = false;
  const chunks = promoteAppearanceChunkImportance(input.chunks);
  const hasMindReading = settingHasMindReadingFromChunks(chunks);

  const blocks: string[] = [];
  const dynamicLorebookParts: string[] = [];
  const cacheRulesParts: string[] = [];
  const cacheCharacterParts: string[] = [];
  const dynamicParts: string[] = [];
  const trackedSections: TrackedPromptSection[] = [];
  let usedTokens = 0;
  const deepSeekXmlMode = isDeepSeekV4ProModel(input.modelId ?? "");
  const deepSeekAppearanceRuleMode = isDeepSeekModel(input.modelId ?? "");
  const deepSeekXmlBuffers = deepSeekXmlMode ? createDeepSeekXmlBuffers() : null;
  const memoryFeatureOn = isMemoryFeatureEnabled();

  const pushFlushedBlock = (trimmed: string, target: SectionTarget) => {
    if (isOpenRouter) {
      if (target === "cacheRules") {
        cacheRulesParts.push(trimmed);
        return;
      }
      if (target === "cacheCharacter") {
        cacheCharacterParts.push(trimmed);
        return;
      }
      dynamicParts.push(trimmed);
      blocks.push(trimmed);
      return;
    }
    blocks.push(trimmed);
  };

  const flushDeepSeekXmlSections = (groups?: DeepSeekXmlGroup[]) => {
    if (!deepSeekXmlMode || !deepSeekXmlBuffers) return;
    for (const wrapped of flushDeepSeekXmlBuffers(deepSeekXmlBuffers, groups)) {
      const target: SectionTarget = wrapped.includes("<LONG_TERM_MEMORY>")
        ? "dynamic"
        : "cacheCharacter";
      pushFlushedBlock(wrapped, target);
    }
  };

  const pushSection = (
    id: string,
    label: string,
    category: TrackedPromptSection["category"],
    text: string,
    target: SectionTarget = "dynamic",
    deepSeekXml?: DeepSeekXmlGroup
  ) => {
    if (input.promptSectionSkipIds?.includes(id)) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    trackedSections.push({ id, label, category, text: trimmed });
    usedTokens += estimateTokens(trimmed);
    if (deepSeekXmlMode && deepSeekXml && deepSeekXmlBuffers) {
      deepSeekXmlBuffers[deepSeekXml].push(trimmed);
      return;
    }
    pushFlushedBlock(trimmed, target);
  };

  const personaLabel = input.personaDisplayName?.trim() || input.userNickname;
  const novelModeEnabled = input.novelModeEnabled === true;
  const coNarrationEnabled = novelModeEnabled || !!input.userImpersonation;
  // Resolve from turn flags — do not require ContextBuildInput.runtimeMode for typecheck.
  // (Railway/Next build has repeatedly failed when that optional field was missing from the
  // type snapshot even after it was added on main.)
  const runtimeMode: ChatRuntimeMode = resolveChatRuntimeMode({
    isContinue: input.isContinue,
    novelModeEnabled,
    oocUserImpersonationAllowed: !!input.userImpersonation && !novelModeEnabled,
  });
  const characterSettingTextRaw = collectCharacterSettingText(chunks);
  const recentHistoryText = input.shortTermHistory
    .slice(-4)
    .map((m) => m.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  const characterSettingTextFiltered = filterExampleDialogInSetting(characterSettingTextRaw, {
    userMessage: input.currentUserMessage,
    recentHistory: recentHistoryText,
  });
  const characterSettingText = injectExampleDialogStyleOnlyNote(characterSettingTextFiltered);
  const bilingualDialoguePolicy = resolveBilingualDialoguePolicyFromSources({
    chunks,
    characterSettingText,
    systemPrompt: input.systemPrompt,
    world: input.world,
    exampleDialog: input.exampleDialog,
  });
  const charGender = resolveCharacterGender(input.gender);
  const userGender = resolveCharacterGender(input.userPersonaGender ?? "other");
  const hairPolicy = resolveHairDescriptionPolicy(charGender, characterSettingText, userGender);

  const persona = input.userPersona?.trim();
  const rawNote = input.userNote?.trim() || "";
  const statusWindowPolicy = resolveStatusWindowPolicyFromSources({
    userNote: rawNote,
    userPersona: persona,
    userMessage: input.currentUserMessage,
    characterSetting: characterSettingText,
    statusWidgetActive: input.statusWidgetActive === true,
  });
  const htmlVisualCardPolicy = resolveHtmlVisualCardPolicyFromSources({
    userNote: rawNote,
    userPersona: persona,
    characterSetting: characterSettingText,
    userMessage: input.currentUserMessage,
    markdownStatusWindowActive: markdownPipeTableStatusWindowActive(statusWindowPolicy),
  });
  const { mandatory: mandatoryUserRulesRaw, reference: referenceUserNoteRaw } =
    splitUserNotePromptZones(rawNote);
  let mandatoryUserRules = stripRedundantStatusWindowFromSource(
    mandatoryUserRulesRaw,
    statusWindowPolicy
  );
  let referenceUserNote = stripRedundantStatusWindowFromSource(
    referenceUserNoteRaw,
    statusWindowPolicy
  );
  mandatoryUserRules = stripRedundantHtmlVisualCardFromSource(
    mandatoryUserRules,
    htmlVisualCardPolicy
  );
  referenceUserNote = stripRedundantHtmlVisualCardFromSource(
    referenceUserNote,
    htmlVisualCardPolicy
  );
  let personaForIdentity = persona
    ? stripRedundantStatusWindowFromSource(persona, statusWindowPolicy)
    : null;
  if (personaForIdentity) {
    personaForIdentity = stripRedundantHtmlVisualCardFromSource(
      personaForIdentity,
      htmlVisualCardPolicy
    );
  }

  if (isOpenRouter) {
    mandatoryUserRules = sanitizePrimaryModelContextSource(mandatoryUserRules);
    referenceUserNote = sanitizePrimaryModelContextSource(referenceUserNote);
    if (personaForIdentity) {
      personaForIdentity = sanitizePrimaryModelContextSource(personaForIdentity);
    }
  }

  const coreMasterInput = {
    charName: input.charName,
    userName: personaLabel,
    charGender,
    userGender,
    nsfwEnabled: input.nsfw,
    impersonationOn: coNarrationEnabled,
    novelModeEnabled,
    completedTurns: input.completedTurns ?? 0,
    hasMindReading: hasMindReading || settingHasMindReadingAbility(characterSettingText),
    allowsBeard: hairPolicy.allowsBeard,
    allowsBodyHair: hairPolicy.allowsBodyHair,
    party: input.party,
    tailFormatActive: !isOpenRouter,
    statusWindowTailActive: statusWindowPolicy.everyTurn,
    autoContinueTurn: input.isContinue === true && !novelModeEnabled,
  };

  // ───── [TOP] OpenRouter — unified Korean prose (all models) ─────
  if (isOpenRouter) {
    pushSection(
      "openrouter-korean-prose-top",
      "[TOP] OpenRouter Korean prose",
      "systemRules",
      buildOpenRouterKoreanProseTopBlock({
        bilingual: bilingualDialoguePolicy,
        novelModeEnabled,
        impersonationOn: coNarrationEnabled,
        party: input.party,
      }),
      "cacheRules"
    );
    pushSection(
      "openrouter-co-narration-rule",
      "[TOP] Co-narration rule",
      "systemRules",
      buildCoNarrationKoreanRule(coNarrationEnabled, novelModeEnabled),
      "dynamic"
    );
    pushSection(
      "runtime-prompt-contamination-guard",
      "[TOP] Runtime prompt contamination guard",
      "systemRules",
      buildRuntimePromptContaminationGuardBlock(input.modelId),
      isOpenRouter && (isQwenModel(input.modelId ?? "") || isDeepSeekV4ProModel(input.modelId ?? ""))
        ? "cacheRules"
        : "dynamic"
    );
  }

  if (isBilingualDialogueActive(bilingualDialoguePolicy)) {
    pushSection(
      "bilingual-dialogue",
      "[LANG] Bilingual dialogue (creator)",
      "systemRules",
      buildBilingualDialoguePromptBlock(bilingualDialoguePolicy),
      isOpenRouter ? "cacheRules" : "dynamic"
    );
  }

  const identityBlock = buildIdentityAndRulesBlock(personaForIdentity, mandatoryUserRules, {
    impersonationOn: coNarrationEnabled,
    novelModeEnabled,
    userName: personaLabel,
  });

  const archiveMemory = sanitizeRuntimePromptSource(input.archiveMemory);

  const pushArchiveMemory = () => {
    if (!memoryFeatureOn || !archiveMemory) return;
    pushSection(
      "archive-memory",
      "[0c] Archive memory",
      "memory",
      `[과거 기억]\n${archiveMemory}`,
      "dynamic",
      deepSeekXmlMode ? "ltm" : undefined
    );
  };

  const godmoddingMode = resolveNoGodmoddingMode({
    novelModeEnabled,
    impersonationOn: coNarrationEnabled,
    isContinue: input.isContinue,
  });
  const cacheStableGodmoddingMode: NoGodmoddingMode =
    isOpenRouter && godmoddingMode === "autoContinue" ? "standard" : godmoddingMode;
  pushSection(
    "no-godmodding",
    "[0a] No godmodding (user agency)",
    "systemRules",
    buildNoGodmoddingBlock(input.charName, personaLabel, cacheStableGodmoddingMode),
    isOpenRouter ? "cacheRules" : "dynamic"
  );

  // ───── [1] Core Master Rules (OpenRouter: merged into CANON/SCOPE/KNOWLEDGE top) ─────
  if (!isOpenRouter) {
    pushSection(
      "rule-core-master",
      "[1] Core Master Rules",
      "systemRules",
      buildCoreMasterPrompt(coreMasterInput),
      "dynamic"
    );
  }

  if (isOpenRouter) {
    const turnHint = buildCoreMasterEarlyTurnHint(input.completedTurns ?? 0);
    if (turnHint) {
      pushSection(
        "rule-core-turn-hint",
        "[1] Early turn hint",
        "systemRules",
        turnHint,
        "dynamic"
      );
    }
  }

  const isGeminiBulk = contextTrack === "gemini-bulk";
  const keywordLorebookBlock = sanitizeRuntimePromptSource(input.keywordLorebookBlock);
  const episodicMemoryBlock = input.episodicMemoryBlock?.trim() ?? "";
  const triggeredScenarioEventsBlock = input.triggeredScenarioEventsBlock?.trim() ?? "";
  const privateSpeechControlBlock = input.privateSpeechControlBlock?.trim() ?? "";
  const sceneDirectiveBlock = input.sceneDirectiveBlock?.trim() ?? "";
  let memory = sanitizeRuntimePromptSource(input.longTermMemory);
  const memoryMeta = sanitizeRuntimePromptSource(input.memoryMeta);

  const pushCurrentMemory = (includeRelationshipMeta: boolean) => {
    if (!memory && !(includeRelationshipMeta && memoryMeta)) return;
    const memoryParts: string[] = ["[Memory]"];
    if (includeRelationshipMeta && memoryMeta) {
      memoryParts.push(memoryMeta);
    }
    if (memory) {
      memoryParts.push(memory);
    }
    pushSection(
      "current-memory",
      "[3] Current Memory",
      "memory",
      memoryParts.join("\n\n"),
      "dynamic",
      deepSeekXmlMode ? "ltm" : undefined
    );
  };

  const pushCharacterCoreIdentity = () => {
    // OpenRouter: knowledge boundary lives in CANON/SCOPE/KNOWLEDGE top (static dedup).
    if (!isOpenRouter) {
      const knowledgeBoundaryBlock = input.promptUseFullKnowledgeBoundary
        ? CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK
        : CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK_COMPACT;
      pushSection(
        "character-knowledge-boundary",
        "[2a] Character knowledge boundary",
        "systemRules",
        knowledgeBoundaryBlock,
        "dynamic"
      );
    }
    const coreBlock = buildCharacterCanonBlock(characterSettingText, input.charName);
    if (!coreBlock) return;
    const coreBlockForModel =
      deepSeekAppearanceRuleMode && /\[(?:외형|외모|Appearance)[^\]]*\]/i.test(coreBlock)
        ? coreBlock.replace(/(\[(?:외형|외모|Appearance)[^\]]*\])/i, `${DEEPSEEK_APPEARANCE_VARIATION_RULE}\n$1`)
        : coreBlock;
    pushSection(
      "character-core-identity",
      "[2] Structured character canon (every turn)",
      "characterSetting",
      coreBlockForModel,
      isOpenRouter ? "cacheRules" : "dynamic",
      deepSeekXmlMode ? "world_lore" : undefined
    );
  };

  const pushIdentityAndRules = () => {
    if (!identityBlock) return;
    pushSection(
      "identity-and-rules",
      "[0] Identity & Rules (absolute)",
      "persona",
      identityBlock,
      isOpenRouter ? "cacheRules" : "dynamic"
    );
  };

  const pushReferenceUserNote = () => {
    if (!referenceUserNote) return;
    const recentContextForNoteRag = input.shortTermHistory
      .slice(-4)
      .map((m) => m.content?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    const injected = selectReferenceUserNoteForInjection({
      reference: referenceUserNote,
      userMessage: input.currentUserMessage,
      recentContext: recentContextForNoteRag,
    });
    const block = buildReferenceUserNotePromptBlock(injected);
    if (!block) return;
    pushSection(
      "user-note-reference",
      "[5] User Note (reference · RAG)",
      "userNote",
      block,
      "dynamic"
    );
  };

  const pushRelationshipMeta = () => {
    if (!memoryMeta) return;
    pushSection(
      "relationship-meta",
      "[3b] Relationship memo",
      "memory",
      memoryMeta,
      "dynamic",
      deepSeekXmlMode ? "ltm" : undefined
    );
  };

  const pushKeywordLorebook = () => {
    if (!keywordLorebookBlock) return;
    if (isOpenRouter) {
      dynamicLorebookParts.push(keywordLorebookBlock);
      return;
    }
    pushSection(
      "keyword-lorebook",
      "[1.4] Keyword Lorebook",
      "worldLore",
      keywordLorebookBlock,
      "dynamic",
      deepSeekXmlMode ? "world_lore" : undefined
    );
  };

  const pushEpisodicMemory = () => {
    if (!episodicMemoryBlock) return;
    pushSection(
      "episodic-memory-retrieved-facts",
      "[3a] Episodic memory retrieved facts",
      "memory",
      episodicMemoryBlock,
      "dynamic",
      deepSeekXmlMode ? "ltm" : undefined
    );
  };

  const pushTriggeredScenarioEvents = () => {
    if (!triggeredScenarioEventsBlock) return;
    pushSection(
      "triggered-scenario-events",
      "[3c] Triggered scenario events",
      "systemRules",
      triggeredScenarioEventsBlock,
      "dynamic"
    );
  };

  const pushSceneDirective = () => {
    if (!sceneDirectiveBlock) return;
    pushSection(
      "scene-directive",
      "[3d] Private scene directive",
      "systemRules",
      sceneDirectiveBlock,
      "dynamic"
    );
  };

  const pushPrivateSpeechControl = () => {
    if (!privateSpeechControlBlock) return;
    pushSection(
      "private-speech-control",
      "[2b] Private speech control",
      "systemRules",
      privateSpeechControlBlock,
      isOpenRouter ? "cacheRules" : "dynamic"
    );
  };

  // ───── [2] Core Identity — directly above persona / user-note focus ─────
  pushCharacterCoreIdentity();
  pushPrivateSpeechControl();
  // ───── [0] Identity & Rules (persona + mandatory user note) ─────
  pushIdentityAndRules();
  flushDeepSeekXmlSections(["persona", "world_lore"]);

  const narrativeStyleBlock = buildNarrativeStyleLayer({
    mode: coNarrationEnabled ? "possession" : "standard",
    charName: input.charName,
    genres: input.genres,
  });
  let narrativeStylePushedEarly = false;
  if (isRegisterPatch("C") && narrativeStyleBlock.trim()) {
    pushSection(
      "narrative-style",
      "[7] Style Mode",
      "systemRules",
      narrativeStyleBlock,
      isOpenRouter ? "dynamic" : "dynamic"
    );
    narrativeStylePushedEarly = true;
  }

  const openRouterLiteraryNsfw = isOpenRouter && !!input.nsfw;
  const proseGuidelinesOpts = {
    nsfwEnabled: !!input.nsfw,
    literaryEnhanced: openRouterLiteraryNsfw,
    includeAbsoluteProhibition: !isOpenRouter,
  };
  const proseStyleTarget: SectionTarget = isOpenRouter ? "cacheCharacter" : "dynamic";
  if (isOpenRouter) {
    const proseStyleBundle = buildProseStyleXmlBundle(proseGuidelinesOpts);
    pushSection(
      "prose-style-xml-bundle",
      "[1.4] Prose style policy (XML)",
      "systemRules",
      proseStyleBundle,
      proseStyleTarget
    );
  } else {
    pushSection(
      "rule-advanced-prose-nsfw",
      input.nsfw ? "[1.4] Advanced prose & NSFW guidelines" : "[1.4] Advanced prose guidelines",
      "systemRules",
      buildAdvancedProseNsfwGuidelines(proseGuidelinesOpts),
      proseStyleTarget
    );
  }

  if (needsUserInputParsingGuide(input)) {
    pushSection(
      "rule-user-input-parsing",
      "User input parsing (interpret [B] only — not output format)",
      "systemRules",
      buildUserInputParsingBlock(hasMindReading),
      isOpenRouter ? "dynamic" : "dynamic"
    );
  }

  if (input.regenerate === true) {
    pushSection(
      "regenerate-divergence",
      "[1.46] Regenerate divergence (mandatory)",
      "systemRules",
      buildRegenerateSystemDirective({
        charName: input.charName,
        rejectedAssistantDraft: input.rejectedAssistantDraft,
        regenAttemptId: input.regenAttemptId,
      }),
      "dynamic"
    );
  }

  const pushRagContextSections = () => {
    pushReferenceUserNote();
    pushKeywordLorebook();
  };

  // ───── Volatile context (after cached prose — OpenRouter dynamicBlock / Gemini dynamic tail) ─────
  const pushVolatileContextSections = () => {
    pushArchiveMemory();
    if (memoryFeatureOn) {
      pushCurrentMemory(false);
    }
    pushEpisodicMemory();
    pushTriggeredScenarioEvents();
    if (memoryFeatureOn) {
      pushRelationshipMeta();
      pushRagContextSections();
    } else if (!isGeminiBulk) {
      pushReferenceUserNote();
    }
    pushSceneDirective();
  };

  pushVolatileContextSections();

  flushDeepSeekXmlSections(["ltm"]);

  // ───── [4] OOC co-narration (레거시 — 소설 모드 토글이 우선) ─────
  if (input.userImpersonation && !novelModeEnabled) {
    pushSection(
      "ooc-co-narration",
      "[4] OOC co-narration",
      "persona",
      buildOocCoNarrationHint(personaLabel)
    );
  }

  // ───── [7] Style Mode ─────
  if (!narrativeStylePushedEarly && narrativeStyleBlock.trim()) {
    pushSection(
      "narrative-style",
      "[7] Style Mode",
      "systemRules",
      narrativeStyleBlock,
      isOpenRouter ? "dynamic" : "dynamic"
    );
  }

  // ───── Tail — operational constraints ─────
  const injectStatusWindowPolicy =
    statusWindowPolicy.policyBlock.trim() &&
    !input.statusWidgetActive &&
    (!isOpenRouter || statusWindowPolicy.everyTurn);
  if (injectStatusWindowPolicy) {
    pushSection(
      "state-window-policy",
      statusWindowPolicy.everyTurn
        ? "State window policy (user note/persona — every turn)"
        : "State window policy",
      "systemRules",
      statusWindowPolicy.policyBlock,
      "dynamic"
    );
  }

  if (novelModeEnabled) {
    pushSection(
      "novel-mode-persona-rules",
      "Novel mode user persona rules",
      "systemRules",
      buildNovelModeUserPersonaRules(input.charName, personaLabel),
      isOpenRouter ? "dynamic" : "dynamic"
    );
  }

  if (isRegisterPatch("D")) {
    const speechTail = buildCharacterSpeechRecencyTail(characterSettingText);
    if (speechTail) {
      pushSection(
        "character-speech-recency",
        "Character speech metadata (canon recency)",
        "characterSetting",
        speechTail,
        "dynamic"
      );
    }
  }

  const lengthInstructionOpts = {
    statusWindowEveryTurn: statusWindowPolicy.everyTurn,
    htmlFlashOwned: isOpenRouter,
    statusWidgetActive: input.statusWidgetActive === true,
  };

  if (!isOpenRouter) {
    pushSection(
      "rule-length-control",
      "Length control (single rule)",
      "systemRules",
      buildLengthInstruction(input.targetResponseChars, lengthInstructionOpts)
    );
  } else {
    pushSection(
      "rule-length-control",
      "Length control (single rule)",
      "systemRules",
      buildLengthInstruction(input.targetResponseChars, lengthInstructionOpts),
      "dynamic"
    );
  }

  pushSection(
    "rule-output-layout-recency",
    "Output layout recency (Korean webnovel paragraph breaks)",
    "systemRules",
    buildWebnovelOutputLayoutRecencyBlock(),
    "dynamic"
  );

  const globalLorebookBlock = sanitizeRuntimePromptSource(input.globalLorebookBlock);
  if (globalLorebookBlock) {
    if (isOpenRouter) {
      dynamicLorebookParts.push(globalLorebookBlock);
    } else {
      pushSection(
        "global-lorebook-depth-0",
        "Global lorebook (World Info · Depth 0 · absolute tail)",
        "systemRules",
        globalLorebookBlock,
        "dynamic"
      );
    }
  }

  pushSection(
    "rule-terminal-length-override",
    "Terminal length compact tail (absolute end)",
    "systemRules",
    buildTerminalLengthOverrideBlock(input.targetResponseChars),
    "dynamic"
  );

  const openRouterDynamicLorePrefix = isOpenRouter
    ? buildOpenRouterDynamicLoreUserPrefix(dynamicLorebookParts)
    : "";

  const openRouterSystemSplit: OpenRouterSystemSplit | undefined = isOpenRouter
    ? {
        systemRulesBlock: cacheRulesParts.join("\n\n"),
        characterSettingsBlock: cacheCharacterParts.join("\n\n"),
        dynamicBlock: dynamicParts.join("\n\n"),
      }
    : undefined;

  const systemPrompt = isOpenRouter && openRouterSystemSplit
    ? [
        openRouterSystemSplit.systemRulesBlock,
        openRouterSystemSplit.characterSettingsBlock,
        openRouterSystemSplit.dynamicBlock,
      ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n")
    : blocks.join("\n\n");

  if (isOpenRouter && openRouterSystemSplit && process.env.NODE_ENV !== "production") {
    const sysTok = estimateTokens(systemPrompt);
    console.log("[prompt-dedup-audit]", {
      system_total_tokens: sysTok,
      cache_rules_tokens: estimateTokens(openRouterSystemSplit.systemRulesBlock),
      character_settings_tokens: estimateTokens(openRouterSystemSplit.characterSettingsBlock),
      dynamic_block_tokens: estimateTokens(openRouterSystemSplit.dynamicBlock),
      tracked_section_count: trackedSections.length,
    });
    console.log("[OpenRouter cache split]", {
      cacheRulesTokens: estimateTokens(openRouterSystemSplit.systemRulesBlock),
      characterTokens: estimateTokens(openRouterSystemSplit.characterSettingsBlock),
      dynamicTokens: estimateTokens(openRouterSystemSplit.dynamicBlock),
      dynamicLoreUserPrefixTokens: estimateTokens(openRouterDynamicLorePrefix),
      cacheableTotal: estimateOpenRouterCacheableTokens(openRouterSystemSplit),
      cacheBreakpoints: 2,
      historyCacheTailExclude: HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES,
    });
    if (sysTok > 12_000) {
      console.warn(`[contextBuilder] OpenRouter system prompt ${sysTok} tok — character lore 포함 시 정상 범위`);
    }
  }

  const historyBudget = resolveHistoryTokenBudget(input.modelId, input.provider);
  const maxPayload = resolveMaxPayloadInputTokens(input.modelId);
  const formattedUser = input.isContinue
    ? input.currentUserMessage.trim()
    : formatUserMessageForPrompt(input.currentUserMessage, hasMindReading);
  // Provider-agnostic: parse labels + CURRENT USER INPUT wrapper on all models (interactive too).
  let userTurnContent = input.isContinue
    ? formattedUser
    : wrapCurrentUserInput(formattedUser, { mode: runtimeMode });
  if (isOpenRouter && openRouterDynamicLorePrefix) {
    userTurnContent = `${openRouterDynamicLorePrefix}\n\n${userTurnContent}`;
  }
  if (deepSeekXmlMode) {
    userTurnContent = prependDeepSeekBottomReminder(userTurnContent);
  }
  if (input.assetTags && input.assetTags.length > 0) {
    const emotionOverlay = buildFlashOwnedEmotionTagUserOverlay(input.assetTags);
    if (emotionOverlay) {
      userTurnContent = `${userTurnContent}\n\n${emotionOverlay}`;
    }
  }
  if (isOpenRouter) {
    userTurnContent = appendCompactTerminalLengthToUserTurn(
      userTurnContent,
      input.targetResponseChars
    );
  }
  const estimatePayloadTokens = (hist: ContextBuildInput["shortTermHistory"]) =>
    estimateTokens(
      `${systemPrompt}\n${[...hist, { role: "user" as const, content: userTurnContent }]
        .map((m) => m.content)
        .join("\n")}`
    );

  let effectiveHistoryBudget = historyBudget;
  let historySource = input.geminiStaticDynamicMode
    ? input.shortTermHistory
    : trimHistoryToBudget(input.shortTermHistory, effectiveHistoryBudget);

  if (!input.geminiStaticDynamicMode) {
    while (estimatePayloadTokens(historySource) > maxPayload && effectiveHistoryBudget > 400) {
      effectiveHistoryBudget = Math.max(400, effectiveHistoryBudget - 1500);
      historySource = trimHistoryToBudget(
        input.shortTermHistory,
        effectiveHistoryBudget
      );
    }
  }

  let history = historySource.map((m) => {
    if (m.role === "assistant") {
      let content = stripRpMetaPreamble(m.content);
      if (isOpenRouter) {
        content = unwrapRoleplayMarkdownInText(content);
      }
      return { ...m, content };
    }
    if (m.role === "user") {
      // Consistent action/thought labels for all providers (not CURRENT USER INPUT — history only).
      return { ...m, content: formatUserMessageForPrompt(m.content, hasMindReading) };
    }
    return m;
  });
  if (isOpenRouter) {
    history = sanitizePrimaryModelHistoryMessages(history, {
      modelOutputsPlainStatus: modelPlainStatusEveryTurnActive(statusWindowPolicy),
    });
  }

  if (history.length < input.shortTermHistory.length) {
    truncatedMemory = true;
  }

  const historyWithCurrent = [...history, { role: "user" as const, content: userTurnContent }];

  let geminiSplit: GeminiContextSplit | undefined = undefined;
  let systemPromptOut = systemPrompt;
  if (isGeminiBulk && input.geminiStaticDynamicMode) {
    geminiSplit = assembleGeminiStaticDynamicSplit({
      sections: trackedSections,
      staticHistoryBlock: input.staticHistoryBlock ?? undefined,
      dynamicHistory: historyWithCurrent,
    });
    systemPromptOut = isGeminiExplicitCacheEnabled()
      ? geminiSplit.dynamicSystemTail
      : `${geminiSplit.staticPrompt}\n\n${geminiSplit.dynamicSystemTail}`;
    if (process.env.NODE_ENV !== "production") {
      const volatileInStatic = trackedSections.some(
        (s) =>
          isVolatilePromptSectionId(s.id) &&
          s.text.trim().length > 0 &&
          geminiSplit!.staticPrompt.includes(
            s.text.trim().slice(0, Math.min(80, s.text.trim().length))
          )
      );
      console.log("[gemini-static-dynamic] split", {
        staticTokens: geminiSplit.staticEstimatedTokens,
        staticFingerprint: geminiSplit.staticFingerprint,
        dynamicTailTokens: estimateTokens(geminiSplit.dynamicSystemTail),
        dynamicHistoryMessages: historyWithCurrent.length,
        staticHistoryBlockChars: (input.staticHistoryBlock ?? "").length,
        storedSummaryBlock: Boolean(input.staticHistoryBlock?.trim()),
        explicitCache: isGeminiExplicitCacheEnabled(),
        memoryFeatureEnabled: memoryFeatureOn,
        volatileInStatic,
      });
      if (volatileInStatic) {
        console.error("[gemini-static-dynamic] volatile memory leaked into static — cache fingerprint will break");
      }
    }
  }

  const estimatedInputTokens = estimateTokens(
    `${systemPromptOut}\n${historyWithCurrent.map((m) => m.content).join("\n")}`
  );

  if (process.env.NODE_ENV !== "production" && contextTrack === "gemini-bulk") {
    console.log("[contextTrack] gemini-bulk (memory-side)", {
      modelId: input.modelId,
      historyBudget,
      effectiveHistoryBudget,
      historyTokens: estimateTokens(history.map((h) => h.content).join("\n")),
      systemTokens: estimateTokens(systemPrompt),
      estimatedInputTokens,
      cacheThreshold: GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD,
      exceedsCacheThreshold: estimatedInputTokens > GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD,
    });
  }

  const promptAudit = auditAssembledPrompt({
    systemSections: trackedSections,
    systemPrompt: systemPromptOut,
    history: historyWithCurrent,
    deepSeekXmlMode,
  });

  if (deepSeekXmlMode && process.env.NODE_ENV !== "production") {
    logDeepSeekContextStructure({ systemPrompt: systemPromptOut, history: historyWithCurrent });
  }

  // Dev-only — 실채팅만 debug/prompt_dump.txt (테스트·audit는 별도 파일 또는 생략)
  const promptDump = resolvePromptDumpSource({
    explicit: input.promptDumpSource,
    detail: input.promptDumpDetail,
  });
  if (promptDump.source) {
    writePromptBuildDump({
      sections: trackedSections,
      history: historyWithCurrent,
      provider: input.provider ?? "gemini",
      modelId: input.modelId ?? "unknown",
      charName: input.charName,
      source: promptDump.source,
      sourceDetail: promptDump.detail,
    });
  }

  return {
    systemPrompt: systemPromptOut,
    history: historyWithCurrent,
    geminiSplit,
    openRouterSystemSplit,
    openRouterDynamicLorePrefix: openRouterDynamicLorePrefix || undefined,
    statusWindowPolicy,
    htmlVisualCardPolicy,
    globalLorebookBlock: globalLorebookBlock || undefined,
    meta: {
      estimatedSystemTokens: estimateTokens(systemPromptOut),
      estimatedHistoryTokens: estimateTokens(history.map((h) => h.content).join("\n")),
      estimatedInputTokens,
      tokenBudget: budget,
      bilingualDialogue: isBilingualDialogueActive(bilingualDialoguePolicy),
      truncatedMemory,
      promptAudit,
      trackedSections,
      geminiBulkPadded: false,
      staticCachePaddingApplied: false,
    },
  };
}

/** @deprecated finalizeGeminiStaticCache(geminiSplit) 사용 */
export function finalizeGeminiBulkContext(
  built: BuiltContext,
  options?: { skipPadding?: boolean; chatId?: number }
): BuiltContext {
  if (options?.skipPadding || !built.geminiSplit) return built;
  if (built.meta.trackedSections && built.geminiSplit) {
    logGeminiStaticChunkDiff({
      chatId: options?.chatId,
      sections: built.meta.trackedSections,
      staticFingerprint: built.geminiSplit.staticFingerprint,
      staticTokens: built.geminiSplit.staticEstimatedTokens,
    });
  }
  const finalized = finalizeGeminiStaticCache(built.geminiSplit, { chatId: options?.chatId });
  return {
    ...built,
    systemPrompt: isGeminiExplicitCacheEnabled()
      ? finalized.dynamicSystemTail
      : `${finalized.staticPrompt}\n\n${finalized.dynamicSystemTail}`,
    geminiSplit: finalized,
    meta: {
      ...built.meta,
      staticCachePaddingApplied: finalized.staticPaddingApplied,
      geminiBulkPadded: finalized.staticPaddingApplied,
      estimatedSystemTokens: estimateTokens(finalized.staticPrompt + finalized.dynamicSystemTail),
    },
  };
}

export { finalizeGeminiStaticCache } from "@/lib/geminiStaticDynamicContext";

export { SHORT_TERM_TURNS };
export { resolveResponseLengthTarget };
