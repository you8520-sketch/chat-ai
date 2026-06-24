import { estimateTokens } from "@/lib/ai";
import { resolveCharacterGender } from "@/lib/characterGender";
import {
  collectCharacterSettingText,
  resolveHairDescriptionPolicy,
} from "@/lib/bodyHairRules";
import {
  buildUserPersonaAppearanceReminder,
  buildVisualAnchorReminder,
  extractVisualAppearancePolicyFromChunks,
  promoteAppearanceChunkImportance,
} from "@/lib/visualAnchor";
import { SHORT_TERM_TURNS } from "@/lib/hybridMemory";
import { buildOpeningSceneSystemBlock } from "@/lib/chatGreetingContext";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import { buildEmotionTagPrompt } from "@/lib/emotionTag";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";
import { buildOocCoNarrationHint } from "@/lib/userImpersonationPolicy";
import {
  buildAutoContinueUserPersonaRules,
  buildNovelModeUserPersonaRules,
  buildSmartUserPersonaNarrationRules,
} from "@/lib/userPersonaNarrationRules";
import { stripRpMetaPreamble } from "@/lib/narrativeRules";
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";
import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";
import { buildRegenerateSystemDirective } from "@/lib/continueNarrative";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";
import {
  buildAutoContinueGodmoddingSupplement,
  buildNoGodmoddingBlock,
  resolveNoGodmoddingMode,
  type NoGodmoddingMode,
} from "@/lib/noGodmodding";
import {
  buildCoreMasterPrompt,
  buildCoreMasterPromptForCache,
  buildCoreMasterEarlyTurnHint,
  buildOpenRouterOpusCompactTail,
  buildIdentityAndRulesBlock,
  buildUserPersonaSpeechGuard,
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
  buildPrimaryModelFlashFirewallBlock,
  sanitizePrimaryModelContextSource,
  sanitizePrimaryModelHistoryMessages,
} from "@/lib/flashOwnedOutputFirewall";
import {
  formatUserMessageForPrompt,
  settingHasMindReadingAbility,
  settingHasMindReadingFromChunks,
} from "@/lib/userActionThoughtRules";
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
  usesFullLoreInjection,
  GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD,
  MIN_HISTORY_TURN_FLOOR,
  HISTORY_TRIM_CHUNK_MESSAGES,
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
  chunkPromptCategory,
  type TrackedPromptSection,
} from "@/services/promptAudit";
import { resolvePromptDumpSource, writePromptBuildDump } from "@/services/promptDebugDump";
import {
  buildBilingualDialoguePromptBlock,
  buildLangCriticalRule,
  isBilingualDialogueActive,
  resolveBilingualDialoguePolicyFromSources,
} from "@/lib/bilingualDialoguePolicy";
import {
  buildEnglishSettingKoreanOutputRule,
  buildKoreanOutputDirective,
  KOREAN_NARRATION_ENDING_RULE,
  DIALOGUE_FORMAT_DIRECTIVE,
} from "@/lib/promptTranslation";
import {
  buildLengthInstruction,
  buildTerminalLengthOverrideBlock,
  resolveResponseLengthTarget,
} from "@/lib/responseLength";
import type { OpenRouterSystemSplit } from "@/lib/openRouterCache";
import { estimateOpenRouterCacheableTokens, buildOpenRouterDynamicLoreUserPrefix, HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES } from "@/lib/openRouterCache";
import { isDeepSeekV4ProModel } from "@/lib/chatModels";
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

type SectionTarget = "dynamic" | "cacheRules" | "cacheCharacter";

function resolveSystemBudget(modelId?: string, override?: number): number {
  if (override && override > 0) return override;
  if (modelId && MODEL_SYSTEM_BUDGETS[modelId]) return MODEL_SYSTEM_BUDGETS[modelId];
  return MODEL_SYSTEM_BUDGETS.default;
}

function trimHistoryToBudget(
  history: ContextBuildInput["shortTermHistory"],
  budget: number,
  minTurns = MIN_HISTORY_TURN_FLOOR
): ContextBuildInput["shortTermHistory"] {
  if (history.length === 0) return [];

  const floorMsgCount = Math.min(history.length, Math.max(1, minTurns * 2));
  const floorSlice = history.slice(-floorMsgCount);
  let tokens = floorSlice.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);

  if (history.length <= floorMsgCount || tokens >= budget) {
    return alignHistoryPrefixDrop(history, floorSlice);
  }

  const kept = [...floorSlice];
  for (let i = history.length - floorMsgCount - 1; i >= 0; i--) {
    const msg = history[i];
    const t = estimateTokens(msg.content);
    if (tokens + t > budget) break;
    kept.unshift(msg);
    tokens += t;
  }
  return alignHistoryPrefixDrop(history, kept);
}

/** Prefix drop — chunk 단위(10msg)로 잘라 Anthropic history cache prefix 안정화 */
function alignHistoryPrefixDrop(
  full: ContextBuildInput["shortTermHistory"],
  kept: ContextBuildInput["shortTermHistory"]
): ContextBuildInput["shortTermHistory"] {
  const prefixDrop = full.length - kept.length;
  if (prefixDrop <= 0) return kept;

  const alignedDrop =
    Math.ceil(prefixDrop / HISTORY_TRIM_CHUNK_MESSAGES) * HISTORY_TRIM_CHUNK_MESSAGES;
  const floorMsgCount = Math.min(full.length, Math.max(1, MIN_HISTORY_TURN_FLOOR * 2));
  const startIdx = Math.min(alignedDrop, Math.max(0, full.length - floorMsgCount));
  if (startIdx <= 0) return kept;
  return full.slice(startIdx);
}

function sanitizeCharacterChunkForOpenRouter(content: string, isOpenRouter: boolean): string {
  if (!isOpenRouter) return content;
  return sanitizePrimaryModelContextSource(content);
}

/**
 * System prompt assembly — fixed priority (high → low):
 *   [0] Identity & Rules (persona 1.2k + user-note focus 1k — absolute, cached)
 *   [0c] Archive memory (archive_summary — protected)
 *   [1] Core Master Rules
 *   [2] Character Critical + [6] Lore (grouped — before prose; OpenRouter cacheCharacter)
 *   [1.4] Prose style · [1.45] Turn handoff (OpenRouter cacheCharacter — stable)
 *   Dynamic block (non-cache): [5] 유저노트 확장 RAG → [3] Memory → [1.5] Lore RAG → tail
 *   Gemini bulk: [3] → [5] → [3b] 관계메모 → [1.5] RAG (same volatile order)
 *   [4] OOC · [7] Style · Tail — operational
 *
 * Truncation order (when over payload budget): oldest chat history first;
 * never truncate identity/rules, user-note focus (≤1000), archive, relationship memo, or lorebook before history.
 */
export function buildContext(input: ContextBuildInput): BuiltContext {
  const budget = resolveSystemBudget(input.modelId, input.tokenBudget);
  const isOpenRouter = input.provider === "openrouter";
  const contextTrack = resolveContextTrack(input.modelId, input.provider);
  const includedIds: string[] = [];
  const skippedIds: string[] = [];
  let truncatedMemory = false;
  const chunks = promoteAppearanceChunkImportance(input.chunks);
  const hasMindReading = settingHasMindReadingFromChunks(chunks);

  const critical = chunks.filter((c) => c.importance === "CRITICAL");
  critical.forEach((c) => includedIds.push(c.id));

  const blocks: string[] = [];
  const dynamicLorebookParts: string[] = [];
  const cacheRulesParts: string[] = [];
  const cacheCharacterParts: string[] = [];
  const dynamicParts: string[] = [];
  const trackedSections: TrackedPromptSection[] = [];
  let usedTokens = 0;
  const deepSeekXmlMode = isDeepSeekV4ProModel(input.modelId ?? "");
  const deepSeekXmlBuffers = deepSeekXmlMode ? createDeepSeekXmlBuffers() : null;
  const memoryFeatureOn = isMemoryFeatureEnabled();

  const pushFlushedBlock = (trimmed: string, target: SectionTarget) => {
    blocks.push(trimmed);
    if (isOpenRouter) {
      if (target === "cacheRules") cacheRulesParts.push(trimmed);
      else if (target === "cacheCharacter") cacheCharacterParts.push(trimmed);
      else dynamicParts.push(trimmed);
    }
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
  const characterSettingText = collectCharacterSettingText(chunks);
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
      buildOpenRouterKoreanProseTopBlock(bilingualDialoguePolicy),
      "cacheRules"
    );
    pushSection(
      "openrouter-lang-critical",
      "[TOP] Language critical",
      "systemRules",
      buildLangCriticalRule({
        bilingual: isBilingualDialogueActive(bilingualDialoguePolicy)
          ? bilingualDialoguePolicy
          : undefined,
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

  // ───── [0] Identity & Rules (absolute — top priority, cache) ─────
  const identityBlock = buildIdentityAndRulesBlock(personaForIdentity, mandatoryUserRules, {
    impersonationOn: coNarrationEnabled,
    novelModeEnabled,
    userName: personaLabel,
  });
  if (identityBlock) {
    pushSection(
      "identity-and-rules",
      "[0] Identity & Rules (absolute)",
      "persona",
      identityBlock,
      isOpenRouter ? "cacheRules" : "dynamic"
    );
  }

  if (input.useEnglishCharacterPrompt) {
    pushSection(
      "english-setting-korean-output",
      "[0a] Language rule (English settings → Korean output)",
      "systemRules",
      buildEnglishSettingKoreanOutputRule(bilingualDialoguePolicy),
      isOpenRouter ? "cacheRules" : "dynamic"
    );
  }

  const archiveMemory = input.archiveMemory?.trim() ?? "";

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
  if (isOpenRouter && godmoddingMode === "autoContinue") {
    pushSection(
      "no-godmodding-auto-continue-supplement",
      "[0a] Auto-continue agency supplement",
      "systemRules",
      buildAutoContinueGodmoddingSupplement(input.charName, personaLabel),
      "dynamic"
    );
  }

  if (personaForIdentity) {
    pushSection(
      "user-persona-speech-guard",
      "[0b] User persona speech guard",
      "persona",
      buildUserPersonaSpeechGuard(
        input.charName,
        personaLabel,
        coNarrationEnabled,
        novelModeEnabled
      ),
      isOpenRouter ? "cacheRules" : "dynamic"
    );
  }

  // ───── [1] Core Master Rules ─────
  pushSection(
    "rule-core-master",
    "[1] Core Master Rules",
    "systemRules",
    isOpenRouter
      ? buildCoreMasterPromptForCache(coreMasterInput)
      : buildCoreMasterPrompt(coreMasterInput),
    isOpenRouter ? "cacheRules" : "dynamic"
  );

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
  const contextualLore = input.contextualLore?.trim();
  const keywordLorebookBlock = input.keywordLorebookBlock?.trim();
  let memory = input.longTermMemory?.trim() ?? "";
  const memoryMeta = input.memoryMeta?.trim() ?? "";

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

  const pushCharacterLore = () => {
    const loreChunks = chunks.filter(
      (c) => c.importance === "CONTEXTUAL" || c.importance === "SUPPLEMENTAL"
    );
    loreChunks.forEach((c) => includedIds.push(c.id));
    for (const chunk of loreChunks) {
      const chunkContent = sanitizeCharacterChunkForOpenRouter(chunk.content, isOpenRouter);
      pushSection(
        `chunk-lore-${chunk.id}`,
        `[6] ${chunk.importance} [${chunk.category}]`,
        chunkPromptCategory(chunk),
        `[Character Lore/${chunk.category}] ${chunkContent}`,
        isOpenRouter ? "cacheCharacter" : "dynamic",
        deepSeekXmlMode ? resolveDeepSeekLoreXmlGroup(chunk.category) : undefined
      );
    }
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

  const pushContextualRag = () => {
    if (!contextualLore) return;
    // Full lore already injected — RAG duplicates thousands of tokens (Gemini bulk + OpenRouter)
    if (usesFullLoreInjection(input.modelId, input.provider)) return;
    pushSection(
      "contextual-lore-rag",
      "[1.5] Contextual Lore (RAG)",
      "worldLore",
      contextualLore,
      "dynamic",
      deepSeekXmlMode ? "world_lore" : undefined
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

  // ───── [2] Character Critical · [6] Lore — before prose style ─────
  for (const chunk of critical) {
    const chunkContent = sanitizeCharacterChunkForOpenRouter(chunk.content, isOpenRouter);
    pushSection(
      `chunk-critical-${chunk.id}`,
      `[2] CRITICAL [${chunk.category}]`,
      chunkPromptCategory(chunk),
      `[Character Critical/${chunk.category}] ${chunkContent}`,
      isOpenRouter ? "cacheCharacter" : "dynamic",
      deepSeekXmlMode ? resolveDeepSeekLoreXmlGroup(chunk.category) : undefined
    );
  }

  if (input.assetTags && input.assetTags.length > 0) {
    pushSection(
      "rule-asset-tags",
      "[2] Asset emotion tags",
      "systemRules",
      buildEmotionTagPrompt(input.assetTags),
      isOpenRouter ? "cacheCharacter" : "dynamic",
      deepSeekXmlMode ? "persona" : undefined
    );
  }

  pushCharacterLore();
  if (input.openingSceneGreeting?.trim()) {
    pushSection(
      "opening-scene-greeting",
      "[2a] Opening scene (first message)",
      "persona",
      buildOpeningSceneSystemBlock(input.openingSceneGreeting),
      isOpenRouter ? "dynamic" : "dynamic",
      deepSeekXmlMode ? "persona" : undefined
    );
  }
  flushDeepSeekXmlSections(["persona", "world_lore"]);

  const openRouterLiteraryNsfw = isOpenRouter && !!input.nsfw;
  const proseGuidelinesOpts = {
    nsfwEnabled: !!input.nsfw,
    literaryEnhanced: openRouterLiteraryNsfw,
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

  pushSection(
    "turn-handoff-and-pacing",
    "[1.45] Turn handoff & pacing (single policy)",
    "systemRules",
    buildTurnHandoffAndPacingBlock(),
    proseStyleTarget
  );

  if (input.regenerate === true) {
    pushSection(
      "regenerate-divergence",
      "[1.46] Regenerate divergence (mandatory)",
      "systemRules",
      buildRegenerateSystemDirective({
        charName: input.charName,
        rejectedAssistantDraft: input.rejectedAssistantDraft,
      }),
      "dynamic"
    );
  }

  pushKeywordLorebook();

  // ───── Volatile context (after cached prose — OpenRouter dynamicBlock / Gemini dynamic tail) ─────
  const pushVolatileContextSections = () => {
    pushArchiveMemory();
    if (memoryFeatureOn) {
      if (isGeminiBulk) {
        pushReferenceUserNote();
        pushCurrentMemory(false);
        pushRelationshipMeta();
        pushContextualRag();
      } else {
        pushReferenceUserNote();
        pushCurrentMemory(true);
        pushContextualRag();
      }
    } else if (!isGeminiBulk) {
      pushReferenceUserNote();
    }
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
  pushSection(
    "narrative-style",
    "[7] Style Mode",
    "systemRules",
    buildNarrativeStyleLayer({
      mode: coNarrationEnabled ? "possession" : "standard",
      charName: input.charName,
      genres: input.genres,
      omitFormatRules: isOpenRouter,
    }),
    isOpenRouter ? "dynamic" : "dynamic"
  );

  // ───── Tail — operational constraints ─────
  const modelOutputsPlainStatus = modelPlainStatusEveryTurnActive(statusWindowPolicy);
  const mainModelOwnsHtmlVisualCard = input.mainModelOwnsHtmlVisualCard === true;
  const mainModelOwnsRelationshipExtract = input.mainModelOwnsRelationshipExtract === true;
  if (statusWindowPolicy.policyBlock.trim() && !input.statusWidgetActive) {
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

  if (
    mainModelOwnsHtmlVisualCard &&
    htmlVisualCardPolicy.enabled &&
    htmlVisualCardPolicy.policyBlock.trim()
  ) {
    pushSection(
      "html-visual-card-policy",
      "HTML visual card policy (main model — every turn)",
      "systemRules",
      htmlVisualCardPolicy.policyBlock,
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
  } else if (!input.userImpersonation) {
    const personaNarrationRules = input.isContinue
      ? buildAutoContinueUserPersonaRules(input.charName, personaLabel)
      : buildSmartUserPersonaNarrationRules(input.charName, personaLabel);
    pushSection(
      input.isContinue ? "auto-continue-persona-rules" : "user-persona-narration-rules",
      input.isContinue ? "Auto-continue user persona control" : "User persona narration control",
      "systemRules",
      personaNarrationRules,
      isOpenRouter ? "dynamic" : "dynamic"
    );
  }

  const lengthInstructionOpts = {
    statusWindowEveryTurn: statusWindowPolicy.everyTurn,
    htmlFlashOwned: isOpenRouter && !mainModelOwnsHtmlVisualCard,
    proseStylePolicyOwnsSceneExpansion: isOpenRouter,
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
      "rule-prose-guard",
      "Prose guard (OpenRouter)",
      "systemRules",
      buildOpenRouterOpusCompactTail(bilingualDialoguePolicy),
      "dynamic"
    );
    pushSection(
      "rule-length-control",
      "Length control (single rule)",
      "systemRules",
      buildLengthInstruction(input.targetResponseChars, lengthInstructionOpts),
      "dynamic"
    );
  }

  const statusWidgetFields = input.statusWidgetPromptBlock?.trim() ?? "";
  if (input.statusWidgetActive && statusWidgetFields) {
    pushSection(
      "status-widget-fields",
      "Status widget fields",
      "systemRules",
      statusWidgetFields,
      "dynamic"
    );
  }

  if (isOpenRouter) {
    pushSection(
      "openrouter-flash-owned-firewall",
      "Flash-owned pipelines (absolute tail)",
      "systemRules",
      buildPrimaryModelFlashFirewallBlock({
        modelOutputsPlainStatus,
        statusWidgetActive: input.statusWidgetActive === true,
        mainModelOwnsHtmlVisualCard,
        mainModelOwnsRelationshipExtract,
      }),
      "dynamic"
    );
  }

  if (!isOpenRouter) {
    pushSection(
      "korean-output-directive",
      "Korean output directive",
      "systemRules",
      buildKoreanOutputDirective(bilingualDialoguePolicy),
      isOpenRouter ? "dynamic" : "dynamic"
    );

    pushSection(
      "dialogue-format-directive",
      "Dialogue format (absolute tail)",
      "systemRules",
      DIALOGUE_FORMAT_DIRECTIVE,
      isOpenRouter ? "dynamic" : "dynamic"
    );

    pushSection(
      "korean-narration-ending",
      "Korean narration ending (absolute tail)",
      "systemRules",
      KOREAN_NARRATION_ENDING_RULE,
      isOpenRouter ? "dynamic" : "dynamic"
    );
  }

  const visualAnchor = buildVisualAnchorReminder(
    extractVisualAppearancePolicyFromChunks(chunks, input.charName, { personaName: personaLabel })
  );
  if (visualAnchor) {
    pushSection(
      "visual-appearance-anchor",
      "Visual appearance (absolute tail)",
      "systemRules",
      visualAnchor,
      isOpenRouter ? "dynamic" : "dynamic"
    );
  }

  const userPersonaAppearance = personaForIdentity
    ? buildUserPersonaAppearanceReminder(personaForIdentity, personaLabel)
    : null;
  // Full [USER_PERSONA] is already in identity-and-rules — skip redundant system tail
  // (DeepSeek may still inject appearance via user-turn bottom reminder)

  const globalLorebookBlock = input.globalLorebookBlock?.trim() ?? "";
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
    "Terminal length override (absolute tail)",
    "systemRules",
    buildTerminalLengthOverrideBlock(),
    "dynamic"
  );

  const openRouterDynamicLorePrefix = isOpenRouter
    ? buildOpenRouterDynamicLoreUserPrefix(dynamicLorebookParts)
    : "";

  const systemPrompt = blocks.join("\n\n");
  const openRouterSystemSplit: OpenRouterSystemSplit | undefined = isOpenRouter
    ? {
        systemRulesBlock: cacheRulesParts.join("\n\n"),
        characterSettingsBlock: cacheCharacterParts.join("\n\n"),
        dynamicBlock: dynamicParts.join("\n\n"),
      }
    : undefined;

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
  let userTurnContent = isOpenRouter ? input.currentUserMessage.trim() : formattedUser;
  if (isOpenRouter && openRouterDynamicLorePrefix) {
    userTurnContent = `${openRouterDynamicLorePrefix}\n\n${userTurnContent}`;
  }
  if (deepSeekXmlMode) {
    const deepSeekTailParts = [userPersonaAppearance].filter((p): p is string =>
      Boolean(p?.trim())
    );
    userTurnContent = prependDeepSeekBottomReminder(
      userTurnContent,
      deepSeekTailParts.length > 0 ? deepSeekTailParts.join("\n\n") : undefined
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
    : trimHistoryToBudget(input.shortTermHistory, effectiveHistoryBudget, MIN_HISTORY_TURN_FLOOR);

  if (!input.geminiStaticDynamicMode) {
    while (estimatePayloadTokens(historySource) > maxPayload && effectiveHistoryBudget > 400) {
      effectiveHistoryBudget = Math.max(400, effectiveHistoryBudget - 1500);
      historySource = trimHistoryToBudget(
        input.shortTermHistory,
        effectiveHistoryBudget,
        MIN_HISTORY_TURN_FLOOR
      );
    }
  }

  let history = historySource.map((m) => {
    if (m.role === "assistant") {
      return { ...m, content: stripRpMetaPreamble(m.content) };
    }
    if (m.role === "user" && !isOpenRouter) {
      return { ...m, content: formatUserMessageForPrompt(m.content, hasMindReading) };
    }
    return m;
  });
  if (isOpenRouter) {
    history = sanitizePrimaryModelHistoryMessages(history, {
      modelOutputsPlainStatus: modelPlainStatusEveryTurnActive(statusWindowPolicy),
      modelOutputsHtmlVisualCard: mainModelOwnsHtmlVisualCard,
    });
  }

  if (history.length < input.shortTermHistory.length) {
    const dropped = input.shortTermHistory.length - history.length;
    for (let i = 0; i < dropped; i++) skippedIds.push(`history-${i}`);
  }

  // [LENGTH CONTROL & SCENE EXPANSION] is in system — no duplicate [분량 — 이번 턴] user-turn reminder

  const historyWithCurrent = [...history, { role: "user" as const, content: userTurnContent }];

  let geminiSplit: GeminiContextSplit | undefined = undefined;
  let systemPromptOut = systemPrompt;
  if (isGeminiBulk && input.geminiStaticDynamicMode) {
    geminiSplit = assembleGeminiStaticDynamicSplit({
      sections: trackedSections,
      staticHistoryBlock: input.staticHistoryBlock ?? undefined,
      dynamicHistory: historyWithCurrent,
      visualAnchorTail: visualAnchor?.trim(),
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

  // Dev-only debug dump (debug/prompt_dump.txt + debug/token_breakdown.json)
  const promptDump = resolvePromptDumpSource({
    explicit: input.promptDumpSource,
    detail: input.promptDumpDetail,
  });
  writePromptBuildDump({
    sections: trackedSections,
    history: historyWithCurrent,
    provider: input.provider ?? "gemini",
    modelId: input.modelId ?? "unknown",
    charName: input.charName,
    source: promptDump.source,
    sourceDetail: promptDump.detail,
  });

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
      includedChunkIds: includedIds,
      skippedChunkIds: skippedIds,
      bilingualDialogue: isBilingualDialogueActive(bilingualDialoguePolicy),
      truncatedMemory,
      promptAudit,
      trackedSections,
      visualAnchorTail: visualAnchor?.trim() || undefined,
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
