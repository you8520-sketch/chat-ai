import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  GeminiTrafficOverloadError,
  isTrafficOverloadSystemMessage,
  sendTrafficOverloadGracefulStream,
  estimateTokens,
  type ChatMsg,
  type Route,
  type StageUsage,
} from "@/lib/ai";
import {
  clampResponseLength,
  DEFAULT_TARGET_RESPONSE_CHARS,
  normalizeTargetResponseChars,
  sanitizeStreamArtifacts,
  detectAdultGenerationFailure,
  generationFailureUserMessage,
  htmlFlashFailureUserMessage,
  isCatastrophicallyShortResponse,
  CATASTROPHIC_MIN_RESPONSE_CHARS,
  resolveVisibleTierCharCount,
} from "@/lib/responseLength";
import {
  visibleAssistantDisplayCharCount,
  visibleAssistantDisplayText,
} from "@/lib/chatDisplayLength";
import { normalizeAiNovelProseLayout } from "@/lib/novelParagraphs";
import { loadCharacterChunks, loadCharacterChunksForPrompt } from "@/lib/characterChunks";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import { buildContext } from "@/services/contextBuilder";
import { auditAssembledPrompt, formatPromptAuditLog } from "@/services/promptAudit";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import { deductPoints, getPointBalance, MIN_POINTS_TO_CHAT, computeTurnBilling, computeHtmlFlashOnlyTurnBilling, billableOutputTokens, billableOutputChars, shouldWaiveTurnBilling, resolveDeepSeekWaiverMinimumCharge, resolveQwenWaiverMinimumCharge, resolveGemini25WaiverMinimumCharge, resolveGemini31WaiverMinimumCharge, selectBillableStages, sumOpenRouterStageOutputTokens, sumOpenRouterStageReasoningTokens, sumOpenRouterStageUpstreamUsd, billableOpenRouterOutputTokens, resolveTurnBillableInput, explainOpenRouterOpusTurnCost, explainOpenRouterDeepSeekTurnCost, explainOpenRouterGeminiProTurnCost, type DeductionSlice } from "@/lib/points";
import { createChatSession } from "@/lib/chatSessionCreate";
import { incrementCharacterTotalTurns } from "@/lib/characterEngagementStats";
import { isDeepSeekV4ProModel, isGemini25ProModel, isGemini31ProModel, isGeminiProOpenRouterModel, isQwenModel } from "@/lib/chatModels";
import { openRouterNormalizedRawCostKrw, openRouterRawCostKrw } from "@/lib/billingRawCost";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { maybeCreditCreatorReward } from "@/lib/creatorPoints";
import { TurnApiBudget, NARRATIVE_LENGTH_CONTINUATION_ENABLED } from "@/lib/turnApiBudget";
import { maybeRewriteNarrationLexicon } from "@/lib/speechLock";
import { isMockApiMode, logMockModeOnce } from "@/lib/mockApiMode";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import { parseAssets, chatAssets } from "@/lib/characterAssets";
import { sanitizeEmotionTagInText, stripEmotionTagsForDisplay } from "@/lib/emotionTag";
import { sanitizeCharacterGenres } from "@/lib/characterGenres";
import { resolveCharacterGender } from "@/lib/characterGender";
import {
  collectCharacterSettingText,
  buildCharacterCanonBlock,
  resolveHairDescriptionPolicy,
  sanitizeHairDescriptions,
} from "@/lib/bodyHairRules";
import {
  extractVisualAppearancePolicyFromChunks,
  buildFlashCanonicalAppearanceBlock,
  sanitizeVisualAppearance,
} from "@/lib/visualAnchor";
import { formatMemoryMetaForPrompt, normalizeMemoryMeta, parseMemoryMeta, type RelationshipMetaDelta } from "@/lib/chatMemory";
import { resolveRelationshipMetaNames } from "@/lib/relationshipMetaCharacterName";
import {
  messagesToTurns,
  countPlayableTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  trimHistoryToBudget,
} from "@/lib/hybridMemory";
import { resolveHistoryTokenBudget } from "@/lib/contextTrack";
import {
  filterOutMessageIds,
  purgeOrphanUserMessages,
} from "@/lib/chatMessageHygiene";
import {
  buildMemoryContextForChat,
  resolveMemoryTier,
  scheduleMemoryUpdate,
} from "@/lib/memory/memory-manager";
import { syncMemoryFromChat } from "@/lib/memory/memory-backfill";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import {
  CHAT_MESSAGE_MAX,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { stealthReceiptModelFields } from "@/lib/billingDisplay";
import { loadKeywordLorebookPromptBlock } from "@/lib/keywordLorebooks";
import { loadGlobalLorebookPromptBlock } from "@/lib/globalLorebook";
import { resolveHtmlVisualCardPolicyFromSources, resolveHtmlFlashPlacement, htmlPolicyReplacesMarkdownStatus, applyChatOocExclusiveHtmlPolicy, oocFlashHtmlMustBeRejected, isOocCreativeHtmlRichEnough } from "@/lib/htmlVisualCardPolicy";
import {
  resolveStatusWindowPolicyFromSources,
  markdownPipeTableStatusWindowActive,
} from "@/lib/statusWindowNotePolicy";
import {
  generateHtmlVisualCardWithFlash,
  attachHtmlBlockAtPlacement,
  normalizeFullResponsePreservingHtml,
  buildFallbackHtmlVisualCard,
  ensureHtmlVisualCardBlock,
  unwrapHtmlVisualCardInner,
  extractProseWithoutHtml,
  HTML_ONLY_MODEL_LABEL,
  resolveProseBaselineForHtmlFlash,
  stripBrokenHtmlFragmentAtEnd,
  stripBrokenHtmlFragmentPreservingOocBody,
} from "@/lib/htmlVisualCardRecovery";
import { continueNarrativeIfUnderMinimum, needsVisibleLengthContinuation } from "@/lib/narrativeLengthContinuation";
import { responseHasHtmlVisualCard, splitChatRichBlocks } from "@/lib/chatRichContent";
import { buildOpenRouterCacheReceiptInfo } from "@/lib/openRouterModelPricing";
import { estimateUserContextChars } from "@/lib/userContextBilling";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { validateUserNoteCombined, userNoteCombinedCharCount, parseUserNoteCombined, extractFocusZoneNote } from "@/lib/userNoteStatusWindow";
import { resolveStatusWidgetReservedChars } from "@/lib/statusWidget";
import { splitAndNormalizeRelationshipMemoryTail } from "@/lib/relationshipMemoryTail";
import { parseUserChatPrefs, normalizeNovelModeEnabled } from "@/lib/userChatPrefs";
import {
  ensureDefaultPersona,
  formatSelectedPersonaForPrompt,
  resolveChatSelectedPersona,
  validatePersonaSelection,
} from "@/lib/userPersonas";
import { resolveUserImpersonationAllowance } from "@/lib/userImpersonationPolicy";
import {
  CONTINUE_USER_DISPLAY,
  buildContinueNarrativeCommand,
  buildRegenerateUserPrompt,
  buildRegenerateOocPriorityPrompt,
  oocOverridesRegenerateRpDirective,
  isContinueUserMessage,
  personaUsesInformalSpeech,
  resolveAutoContinueHistoryTurns,
} from "@/lib/continueNarrative";
import {
  appendMessageVariant,
  normalizeMessageVariants,
  serializeVariantsForClient,
} from "@/lib/messageAlternates";
import { DegenerationAbortError, DEGENERATION_USER_MESSAGE, isDegenerateOutput, getDegenerationReason } from "@/lib/gibberishGuard";
import { PREFERENCE_EVENT } from "@/lib/feedback/events";
import { recordGenerationSnapshot, recordPreferenceEvent } from "@/lib/feedback/feedback-db";
import { enqueueScoreRecompute } from "@/lib/feedback/queue";
import { buildGenerationContextJson, computePromptHash } from "@/lib/feedback/snapshot";
import {
  stripNarrativePartLabels,
  stripInternalTagLeakage,
  stripRpMetaLeakage,
  stripSceneAnalysisLeakage,
} from "@/lib/narrativeRules";
import { dedupeGlobalParagraphs } from "@/lib/antiRepetition";
import {
  applyStreamFirstAfterStatusPartition,
  preserveStreamFirstProse,
} from "@/lib/streamFirstSave";
import { recoverSentenceCompletionInFullResponse } from "@/lib/sentenceCompletionRecovery";
import { partitionModelStatusArtifacts, stripPlainStatusFromProse } from "@/lib/statusMeta/stripArtifacts";
import {
  buildRemovalTraceReport,
  logRemovalTrace,
  pushRemovalTraceStep,
  type RemovalTraceStep,
} from "@/lib/removalTrace";
import {
  canShowFullBillingReceipt,
  sanitizeUsageForPublicReceipt,
} from "@/lib/billingReceiptAccess";
import { scheduleStatusMetaExtraction, markMessageStatusMetaPending } from "@/lib/statusMeta/job";
import { resolveStatusMetaExtractionEnabled } from "@/lib/statusMeta/displayPolicy";
import {
  applyStatusWidgetSystemPromptOverrides,
  patchOpenRouterSplitForStatusWidget,
  resolveStatusWidgetTurn,
  serializeStatusWidgetValuesJson,
} from "@/lib/statusWidget";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";
import {
  logStatusWidgetTurnTelemetry,
  resolveStatusWidgetTurnValues,
} from "@/lib/statusWidget/telemetry";
import {
  applyStatusWidgetBillingCharge,
  buildStatusWidgetExtractReceipt,
  statusWidgetApiCostChargePoints,
} from "@/lib/statusWidget/receiptUsage";
import type { Usage } from "@/lib/chatUsage";
import { userMessageRequestsStatusWindowOoc } from "@/lib/statusMeta/ooc";
import { isOocHtmlRequest } from "@/lib/oocHtmlRequest";
import { isHtmlDisplayOnlyTurn, isHtmlFlashOnlyTurn, isOocCreativeHtmlTurn, chatInputSuppressesStatusWidget } from "@/lib/htmlDisplayOnlyTurn";
import {
  buildChatOocRpContinuingUserPrompt,
  chatOocSuppressesUserNoteExtras,
  isChatOocRpContinuing,
} from "@/lib/chatOocPriority";
import {
  streamOpenRouterAdultToClient,
  convertToOpenRouterFormat,
} from "@/lib/openRouterAdult";
import { formatClientApiError } from "@/lib/apiErrors";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveRegenerateGenerationOverrides } from "@/lib/openRouterClient";
import { sanitizePrimaryModelAssistantHistory } from "@/lib/flashOwnedOutputFirewall";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

function sseEncode(obj: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function resolveIsAdultMode(input: unknown, chatMode: string): boolean {
  if (input === true || input === "true" || input === 1 || input === "1") return true;
  if (input === false || input === "false" || input === 0 || input === "0") return false;
  return chatMode === "nsfw";
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const { characterId, chatId, message, userNote, selectedPersonaId } = body;
  const regenerate = body.regenerate === true;
  const isContinue = body.isContinue === true;
  const isAdultModeInput =
    body.isAdultMode ?? body.isNsfwMode ?? body.nsfwMode;
  const targetResponseCharsInput = body.targetResponseChars ?? body.targetResponseLength;
  const novelModeEnabledInput = body.novelModeEnabled;

  if (isContinue && regenerate) {
    return Response.json({ error: "자동진행과 재생성은 동시에 사용할 수 없습니다." }, { status: 400 });
  }
  if (isContinue && !chatId) {
    return Response.json({ error: "대화를 시작한 후 자동진행을 사용할 수 있습니다." }, { status: 400 });
  }

  if (!regenerate && !isContinue && !message?.trim()) {
    return Response.json({ error: "메시지를 입력하세요." }, { status: 400 });
  }
  if (!regenerate && !isContinue && message.length > CHAT_MESSAGE_MAX) {
    return Response.json(
      { error: `메시지는 ${CHAT_MESSAGE_MAX}자까지 입력할 수 있습니다.` },
      { status: 400 }
    );
  }

  const db = getDb();
  const userAdminRow = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  const showFullBillingReceipt = canShowFullBillingReceipt({
    email: user.email,
    is_admin: userAdminRow?.is_admin ?? 0,
  });
  const userNoteRow = db
    .prepare("SELECT user_note, chat_prefs FROM users WHERE id=?")
    .get(user.id) as { user_note: string; chat_prefs: string };
  const accountChatPrefs = parseUserChatPrefs(userNoteRow?.chat_prefs);
  const userNoteInput =
    typeof userNote === "string" ? userNote.trim() : undefined;
  const personas = ensureDefaultPersona(user.id, user.nickname);
  const requestedPersonaId =
    selectedPersonaId != null && selectedPersonaId !== ""
      ? Number(selectedPersonaId)
      : null;

  const ch = db.prepare("SELECT * FROM characters WHERE id = ?").get(characterId) as {
    id: number;
    name: string;
    system_prompt: string;
    greeting: string;
    nsfw: number;
    world: string;
    example_dialog: string;
    assets: string;
    gender: string;
    creator_id: number | null;
    official: number;
    genres: string;
    recommended_writing_style: string;
  } | undefined;
  if (!ch) return Response.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });

  if (ch.nsfw && !user.is_adult) {
    return Response.json({ error: "NSFW 캐릭터는 성인인증 후 이용할 수 있습니다.", needVerify: true }, { status: 403 });
  }

  let chat = chatId
    ? (db.prepare("SELECT * FROM chats WHERE id=? AND user_id=?").get(chatId, user.id) as
        | {
            id: number;
            mode: Route;
            memory: string;
            memory_pending: string;
            memory_meta: string;
            persona_bio: string;
            user_note: string;
            selected_persona_id: number | null;
            gemini_model: string;
            memory_archived_turns: number;
            current_summary?: string;
            user_impersonation?: number;
            target_response_chars?: number;
            status_window_enabled?: number;
          }
        | undefined)
    : undefined;

  const selectedAI = resolveSelectedAI(body.selectedAI, chat?.gemini_model);

  let initialPersonaId: number | null = null;
  if (requestedPersonaId) {
    const pick = validatePersonaSelection(personas, requestedPersonaId);
    initialPersonaId = pick.ok ? pick.persona.id : (pick.fallbackPersona?.id ?? personas[0]?.id ?? null);
  } else {
    initialPersonaId = personas[0]?.id ?? null;
  }

  const isAdultMode = resolveIsAdultMode(isAdultModeInput, chat?.mode ?? "safe");

  if (!chat) {
    if (isContinue) {
      return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
    }
    const initialTargetChars =
      targetResponseCharsInput != null
        ? normalizeTargetResponseChars(targetResponseCharsInput)
        : DEFAULT_TARGET_RESPONSE_CHARS;
    const initialMode: Route = isAdultMode ? "nsfw" : "safe";
    const initialGeminiModel = selectedAI;
    const newChatId = createChatSession({
      userId: user.id,
      characterId: ch.id,
      greeting: ch.greeting,
      mode: initialMode,
      selectedAI: initialGeminiModel,
      userNote: userNoteInput ?? "",
      selectedPersonaId: initialPersonaId,
      targetResponseChars: initialTargetChars,
    });
    chat = db.prepare("SELECT * FROM chats WHERE id=? AND user_id=?").get(newChatId, user.id) as typeof chat;
  } else {
    db.prepare("UPDATE chats SET gemini_model=? WHERE id=?").run(selectedAI, chat.id);
    chat.gemini_model = selectedAI;
    if (userNoteInput !== undefined) {
      db.prepare("UPDATE chats SET user_note=? WHERE id=?").run(userNoteInput, chat.id);
      chat.user_note = userNoteInput;
    }
    if (requestedPersonaId) {
      const pick = validatePersonaSelection(personas, requestedPersonaId);
      const personaId = pick.ok ? pick.persona.id : (pick.fallbackPersona?.id ?? chat.selected_persona_id);
      if (personaId) {
        db.prepare("UPDATE chats SET selected_persona_id=? WHERE id=?").run(personaId, chat.id);
        chat.selected_persona_id = personaId;
      }
    }
  }

  if (!chat) {
    return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  if (userNoteInput !== undefined) {
    const widgetReserved = resolveStatusWidgetReservedChars({
      characterWidgetJson: (ch as { status_widget_json?: string }).status_widget_json,
      chatMode: (chat as { status_widget_mode?: string }).status_widget_mode,
      userWidgetJson: (chat as { user_status_widget_json?: string }).user_status_widget_json,
      stackOrder: (chat as { status_widget_stack_order?: string }).status_widget_stack_order,
      characterAllowUserOverride:
        (ch as { status_widget_allow_user_override?: number }).status_widget_allow_user_override !== 0,
    });
    const noteCheck = validateUserNoteCombined(userNoteInput, widgetReserved);
    if (!noteCheck.ok) {
      return Response.json({ error: noteCheck.error }, { status: 400 });
    }
  }

  const targetResponseChars =
    targetResponseCharsInput != null
      ? normalizeTargetResponseChars(targetResponseCharsInput)
      : normalizeTargetResponseChars(
          accountChatPrefs?.targetResponseChars ?? chat.target_response_chars
        );
  const novelModeEnabledFromBody =
    novelModeEnabledInput !== undefined
      ? normalizeNovelModeEnabled(novelModeEnabledInput)
      : undefined;
  const novelModeEnabled =
    novelModeEnabledFromBody !== undefined
      ? novelModeEnabledFromBody
      : accountChatPrefs?.novelModeEnabled ?? false;

  if (isAdultMode && !user.is_adult) {
    return Response.json(
      { error: "19+ 모드는 성인인증 후 이용할 수 있습니다.", needVerify: true },
      { status: 403 }
    );
  }

  const pointBalance = getPointBalance(user.id);
  if (pointBalance.total < MIN_POINTS_TO_CHAT) {
    return Response.json(
      { error: `포인트가 부족합니다. (보유: ${pointBalance.total.toLocaleString()}P)`, needCharge: true },
      { status: 402 }
    );
  }

  const effectiveUserNote =
    (chat.user_note?.trim() || userNoteRow.user_note?.trim()) ?? "";
  const { persona: selectedPersona, personaId: resolvedPersonaId } = resolveChatSelectedPersona(
    user,
    personas,
    chat.selected_persona_id,
    chat.id
  );
  if (resolvedPersonaId && chat.selected_persona_id !== resolvedPersonaId) {
    chat.selected_persona_id = resolvedPersonaId;
  }

  const personaDescription = selectedPersona?.description ?? "";
  const personaDisplayName = selectedPersona?.name?.trim() || user.nickname;
  const userNotePrompt = formatUserNoteForPrompt(effectiveUserNote);
  const userImpersonation =
    novelModeEnabled ||
    resolveUserImpersonationAllowance({
      personaDescription: selectedPersona?.description ?? "",
      userNote: extractFocusZoneNote(effectiveUserNote),
    });
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    selectedPersona?.gender ?? "other",
    personaDescription,
    { coNarrationEnabled: novelModeEnabled || userImpersonation }
  );
  const { body: noteBody } = parseUserNoteCombined(effectiveUserNote);
  const userContextChars = estimateUserContextChars(userNoteCombinedCharCount(noteBody));

  let messageText = typeof message === "string" ? message.trim() : "";
  let skipUserInsert = false;
  let userMessageId: number | null = null;
  let regenerateMessageId: number | null = null;
  let rejectedAssistantDraft: string | null = null;
  let regenAttemptId: string | null = null;

  if (isContinue) {
    const tailRows = db
      .prepare(
        "SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 1"
      )
      .get(chat.id) as { role: string; content: string; model: string } | undefined;
    if (
      !tailRows ||
      tailRows.role !== "assistant" ||
      tailRows.model === "greeting" ||
      !tailRows.content.trim()
    ) {
      return Response.json(
        { error: "AI 답변이 끝난 뒤에만 자동진행을 사용할 수 있습니다." },
        { status: 400 }
      );
    }
    messageText = CONTINUE_USER_DISPLAY;
  }

  if (regenerate) {
    if (!chat) {
      return Response.json({ error: "재생성할 채팅방이 없습니다." }, { status: 400 });
    }
    const allRows = db
      .prepare("SELECT id, role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
      .all(chat.id) as { id: number; role: string; content: string; model: string }[];

    let lastAssistantId: number | null = null;
    let lastUserContent: string | null = null;
    let lastUserId: number | null = null;
    for (let i = allRows.length - 1; i >= 0; i--) {
      const row = allRows[i];
      if (row.role === "assistant" && row.model !== "greeting") {
        lastAssistantId = row.id;
        for (let j = i - 1; j >= 0; j--) {
          if (allRows[j].role === "user") {
            lastUserContent = allRows[j].content;
            lastUserId = allRows[j].id;
            break;
          }
        }
        break;
      }
    }

    if (!lastAssistantId || !lastUserContent || !lastUserId) {
      return Response.json({ error: "재생성할 AI 답변이 없습니다." }, { status: 400 });
    }

    regenerateMessageId = lastAssistantId;
    rejectedAssistantDraft =
      allRows.find((row) => row.id === lastAssistantId)?.content?.trim() ?? null;
    regenAttemptId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    messageText = lastUserContent;
    userMessageId = lastUserId;
    skipUserInsert = true;

    const regenStatusPolicy = resolveStatusWindowPolicyFromSources({
      userNote: effectiveUserNote || undefined,
      userPersona: userPersonaPrompt ?? undefined,
      userMessage: messageText,
    });
    if (regenStatusPolicy.everyTurn && regenStatusPolicy.formatSpec) {
      markMessageStatusMetaPending(regenerateMessageId, regenStatusPolicy.formatSpec);
    }
  }

  const msgRowsWithId = db
    .prepare("SELECT id, role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chat.id) as {
    id: number;
    role: "user" | "assistant";
    content: string;
    model: string;
  }[];
  const purgedOrphanIds = purgeOrphanUserMessages(db, chat.id, msgRowsWithId);
  const regenerateHistoryDropIds = new Set<number>(purgedOrphanIds);
  if (regenerateMessageId) {
    regenerateHistoryDropIds.add(regenerateMessageId);
    for (let i = msgRowsWithId.length - 1; i >= 0; i--) {
      if (msgRowsWithId[i].id === regenerateMessageId) {
        for (let j = i - 1; j >= 0; j--) {
          if (msgRowsWithId[j].role === "user") {
            regenerateHistoryDropIds.add(msgRowsWithId[j].id);
            break;
          }
        }
        break;
      }
    }
  }
  const msgRows = filterOutMessageIds(msgRowsWithId, [...regenerateHistoryDropIds]).map(
    ({ role, content, model }) => ({ role, content, model })
  );
  const dialogueTurns = messagesToTurns(msgRows);
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  const storedUserMessage = messageText;
  const personaUsesBanmal = personaUsesInformalSpeech(selectedPersona?.description ?? "");
  const autoContinueContext =
    isContinue || (regenerate && isContinueUserMessage(storedUserMessage));
  const autoContinueHistory = autoContinueContext
    ? resolveAutoContinueHistoryTurns(dialogueTurns)
    : null;
  const turnsForRecentHistory = autoContinueHistory?.historyTurns ?? dialogueTurns;
  const continueResumeCtx = autoContinueHistory?.resumeCtx ?? null;
  const displayUserMessage = replaceUserPlaceholder(
    storedUserMessage,
    personaDisplayName,
    user.nickname
  );
  const chatOocRpUnrelated = chatOocSuppressesUserNoteExtras(storedUserMessage);
  const promptUserMessage = autoContinueContext
    ? buildContinueNarrativeCommand({
        personaName: personaDisplayName,
        charName: ch.name,
        usesBanmal: personaUsesBanmal,
        novelModeEnabled,
        regenerate,
        rejectedAssistantDraft,
        resumeAfterOoc: continueResumeCtx,
      })
    : regenerate
      ? oocOverridesRegenerateRpDirective(storedUserMessage)
        ? buildRegenerateOocPriorityPrompt({
            userMessage: displayUserMessage,
            personaName: personaDisplayName,
            charName: ch.name,
            usesBanmal: personaUsesBanmal,
            rejectedAssistantDraft,
            regenAttemptId,
          })
        : buildRegenerateUserPrompt({
            userMessage: displayUserMessage,
            personaName: personaDisplayName,
            charName: ch.name,
            usesBanmal: personaUsesBanmal,
            rejectedAssistantDraft,
            regenAttemptId,
            targetResponseChars,
          })
      : isChatOocRpContinuing(storedUserMessage)
        ? buildChatOocRpContinuingUserPrompt(displayUserMessage)
        : displayUserMessage;
  const { chunks: characterChunks, usedEnglish: usedEnglishCharacterPrompt } =
    loadCharacterChunksForPrompt(
      {
        id: ch.id,
        name: ch.name,
        gender: ch.gender,
        system_prompt: ch.system_prompt,
        world: ch.world,
        example_dialog: ch.example_dialog,
        setting_chunks: (ch as { setting_chunks?: string }).setting_chunks,
        setting_chunks_en: (ch as { setting_chunks_en?: string }).setting_chunks_en,
        prompt_translation_hash: (ch as { prompt_translation_hash?: string }).prompt_translation_hash,
        speech_profile: (ch as { speech_profile?: string }).speech_profile,
      },
      personaDisplayName,
      user.nickname
    );
  const effectiveExampleDialog = resolveExampleDialogForPrompt(ch.example_dialog, ch.name);
  const relationshipNames = resolveRelationshipMetaNames({
    displayName: ch.name,
    systemPrompt: ch.system_prompt,
    chunks: characterChunks,
    userName: personaDisplayName,
  });
  const characterAssets = chatAssets(parseAssets(ch.assets));
  const assetTags = [...new Set(characterAssets.map((a) => a.tag))];
  const memoryTier = resolveMemoryTier(user);
  const memoryCapacity = getChatMemoryCapacity(chat.id);
  const memoryFeatureOn = isMemoryFeatureEnabled();
  if (memoryFeatureOn) {
    syncMemoryFromChat({
      userId: user.id,
      characterId: ch.id,
      chatId: chat.id,
      charName: ch.name,
      tier: memoryTier,
      memoryCapacity,
    });
  }
  const chatMemory = memoryFeatureOn
    ? getOrCreateChatMemory(chat.id, user.id, ch.id, memoryTier)
    : null;

  const billingOpenRouterModelId = resolveOpenRouterModelId(selectedAI);
  const openRouterApiModelId = billingOpenRouterModelId;
  const contextProvider = "openrouter" as const;
  const contextModelId = openRouterApiModelId;
  const historyTokenBudget = resolveHistoryTokenBudget(contextModelId, contextProvider);

  const recentHistoryFull: ChatMsg[] = rawRecentTurnsToHistory(turnsForRecentHistory).map(
    (m) => ({
      ...m,
      content: replaceUserPlaceholder(m.content, personaDisplayName, user.nickname),
    })
  );
  const trimmedHistoryForLorebook = trimHistoryToBudget(recentHistoryFull, historyTokenBudget);
  const recentHistory: ChatMsg[] = recentHistoryFull;
  const shortTermHistory = recentHistory;

  const memoryInjection = await buildMemoryContextForChat({
    chatId: chat.id,
    userId: user.id,
    characterId: ch.id,
    tier: memoryTier,
    memoryCapacity,
    userMessage: autoContinueContext ? CONTINUE_USER_DISPLAY : displayUserMessage,
    modelId: contextModelId,
    provider: contextProvider,
    turnTrace: undefined,
    excludeSummaryTurnStartGte: resolveLorebookExcludeFromTrimmedHistory(
      turnsForRecentHistory,
      trimmedHistoryForLorebook
    ),
  });
  const characterGenres = sanitizeCharacterGenres(
    (() => {
      try {
        return JSON.parse(ch.genres || "[]") as unknown;
      } catch {
        return [];
      }
    })()
  );

  const settingText = collectCharacterSettingText(characterChunks);

  const policyUserMessage = displayUserMessage;

  const statusWidgetTurn = resolveStatusWidgetTurn({
    characterWidgetJson: (ch as { status_widget_json?: string }).status_widget_json,
    chatMode: (chat as { status_widget_mode?: string }).status_widget_mode,
    userWidgetJson: (chat as { user_status_widget_json?: string }).user_status_widget_json,
    stackOrder: (chat as { status_widget_stack_order?: string }).status_widget_stack_order,
    characterAllowUserOverride:
      (ch as { status_widget_allow_user_override?: number }).status_widget_allow_user_override !== 0,
  });
  const chatOocHtmlOutputTurn = chatInputSuppressesStatusWidget(storedUserMessage);
  const statusWidgetActive = statusWidgetTurn.active && !chatOocHtmlOutputTurn;

  const keywordLorebookBlock = loadKeywordLorebookPromptBlock(
    db,
    (ch as { lorebook_id?: number | null }).lorebook_id,
    policyUserMessage
  );

  const statusWindowPolicyForHtml = resolveStatusWindowPolicyFromSources({
    userNote: effectiveUserNote || undefined,
    userPersona: userPersonaPrompt ?? undefined,
    userMessage: policyUserMessage,
    characterSetting: settingText,
  });
  const markdownStatusWindowActive =
    markdownPipeTableStatusWindowActive(statusWindowPolicyForHtml);
  const htmlVisualCardPolicy = chatOocRpUnrelated
    ? applyChatOocExclusiveHtmlPolicy(
        resolveHtmlVisualCardPolicyFromSources({
          userNote: userNotePrompt ?? undefined,
          userPersona: userPersonaPrompt ?? undefined,
          characterSetting: settingText,
          userMessage: policyUserMessage,
          markdownStatusWindowActive,
          statusWidgetActive,
        })
      )
    : resolveHtmlVisualCardPolicyFromSources({
        userNote: userNotePrompt ?? undefined,
        userPersona: userPersonaPrompt ?? undefined,
        characterSetting: settingText,
        userMessage: policyUserMessage,
        markdownStatusWindowActive,
        statusWidgetActive,
      });
  /** Relationship meta — post-process Flash extract (not main-model JSON tail) */
  const mainModelOwnsRelationshipExtract = false;
  /** Flash HTML ON이면 메인 모델 inline HTML(oocHtmlMode) 금지 — Flash가 ```html``` 소유 */
  const oocHtmlMode =
    !autoContinueContext &&
    isOocHtmlRequest(storedUserMessage) &&
    !htmlVisualCardPolicy.enabled;
  const globalLorebookScanText = [
    policyUserMessage,
    userNotePrompt,
    userPersonaPrompt,
    settingText,
  ]
    .filter(Boolean)
    .join("\n");
  const globalLorebookBlock = chatOocRpUnrelated
    ? ""
    : loadGlobalLorebookPromptBlock(db, globalLorebookScanText, globalLorebookScanText);

  const contextBuildInput = {
    charName: ch.name,
    chunks: characterChunks,
    systemPrompt: ch.system_prompt,
    world: ch.world,
    exampleDialog: effectiveExampleDialog,
    userNickname: user.nickname,
    userPersona: userPersonaPrompt,
    userNote: userNotePrompt,
    longTermMemory: memoryFeatureOn ? memoryInjection.text : "",
    archiveMemory: memoryFeatureOn ? memoryInjection.archiveText : "",
    shortTermHistory,
    currentUserMessage: promptUserMessage,
    nsfw: isAdultMode,
    gender: resolveCharacterGender(ch.gender),
    assetTags: assetTags.length > 0 ? assetTags : undefined,
    memoryMeta: memoryFeatureOn
      ? formatMemoryMetaForPrompt(
          normalizeMemoryMeta(parseMemoryMeta(chat.memory_meta), relationshipNames)
        )
      : "",
    modelId: openRouterApiModelId,
    userImpersonation,
    novelModeEnabled,
    personaDisplayName,
    targetResponseChars,
    completedTurns: playableTurnCount,
    userPersonaGender: selectedPersona?.gender ?? "other",
    provider: "openrouter" as const,
    genres: characterGenres,
    useEnglishCharacterPrompt: usedEnglishCharacterPrompt,
    isContinue: autoContinueContext,
    regenerate: !!regenerateMessageId,
    rejectedAssistantDraft: regenerateMessageId ? rejectedAssistantDraft : undefined,
    regenAttemptId: regenerateMessageId ? regenAttemptId : undefined,
    geminiStaticDynamicMode: false,
    keywordLorebookBlock: keywordLorebookBlock || undefined,
    globalLorebookBlock: globalLorebookBlock || undefined,
  };

  const built = buildContext({
    ...contextBuildInput,
    statusWidgetActive: statusWidgetActive,
    mainModelOwnsRelationshipExtract,
    promptDumpSource: "db",
    promptDumpDetail: `chat=${chat.id} user=${user.id} character=${ch.id}`,
  });
  let systemPromptForTurn = built.systemPrompt;
  let openRouterSystemSplitForTurn = built.openRouterSystemSplit;
  if (statusWidgetActive) {
    systemPromptForTurn = applyStatusWidgetSystemPromptOverrides(systemPromptForTurn);
    if (openRouterSystemSplitForTurn) {
      openRouterSystemSplitForTurn = patchOpenRouterSplitForStatusWidget(openRouterSystemSplitForTurn);
    }
  }
  const system = systemPromptForTurn;
  const history: ChatMsg[] = built.history;
  const promptAudit = built.meta.promptAudit;
  const promptAuditRef = promptAudit;
  const trackedSectionsRef = built.meta.trackedSections ?? [];
  const shouldAuditPrompt =
    process.env.PROMPT_AUDIT === "1" || process.env.NODE_ENV === "development";
  if (shouldAuditPrompt && promptAudit) {
    console.log(formatPromptAuditLog(promptAudit, { route: "OpenRouter pre-request" }));
  }
  const settingTextForPolicy = settingText;
  const hairPolicy = resolveHairDescriptionPolicy(
    resolveCharacterGender(ch.gender),
    settingTextForPolicy,
    resolveCharacterGender(selectedPersona?.gender ?? "other")
  );
  const visualPolicy = (() => {
    const fromPrompt = extractVisualAppearancePolicyFromChunks(characterChunks, ch.name, {
      personaName: personaDisplayName,
    });
    if (fromPrompt.hair || fromPrompt.eyes) return fromPrompt;
    if (usedEnglishCharacterPrompt) {
      const fromKorean = extractVisualAppearancePolicyFromChunks(
        loadCharacterChunks(ch),
        ch.name,
        { personaName: personaDisplayName }
      );
      if (fromKorean.hair || fromKorean.eyes) {
        console.warn("[/api/chat] visual policy fallback — English chunks missed hair/eye tags", {
          characterId: ch.id,
          hair: fromKorean.hair,
          eyes: fromKorean.eyes,
        });
        return { ...fromPrompt, ...fromKorean, body: fromPrompt.body ?? fromKorean.body };
      }
    }
    return fromPrompt;
  })();

  const chatRef = chat;
  const selectedAIRef = selectedAI;
  const targetResponseCharsRef = targetResponseChars;
  const recentHistoryRef = recentHistory;
  const resolvedUserMessageRef = promptUserMessage;
  const policyUserMessageRef = policyUserMessage;
  const systemRef = system;
  const openRouterSystemSplitRef = openRouterSystemSplitForTurn;
  const statusWindowPolicyRef = built.statusWindowPolicy;
  const statusArtifactOpts = {
    modelOutputsPlainStatus: false,
    modelOutputsHtmlVisualCard: false,
    stripRelationshipMemoryTail: mainModelOwnsRelationshipExtract,
  };
  const htmlVisualCardPolicyRef = htmlVisualCardPolicy;
  const htmlFlashCoreIdentity = buildCharacterCanonBlock(settingText);
  const htmlFlashContextRef = {
    chatId: chat.id,
    charName: ch.name,
    personaName: personaDisplayName,
    userMessage: messageText,
    userNote: effectiveUserNote,
    userPersona: userPersonaPrompt ?? undefined,
    characterSetting: htmlFlashCoreIdentity,
    canonicalAppearanceBlock: buildFlashCanonicalAppearanceBlock(
      characterChunks,
      ch.name,
      visualPolicy,
      { personaName: personaDisplayName }
    ),
    appearanceSanitizePolicy:
      visualPolicy.hair || visualPolicy.eyes ? visualPolicy : null,
    memoryBlock: memoryFeatureOn ? memoryInjection.text : "",
    archiveMemory: memoryFeatureOn ? memoryInjection.archiveText : "",
    recentHistory: recentHistory,
    loreBlock: [keywordLorebookBlock, globalLorebookBlock].filter(Boolean).join("\n\n"),
  };
  const historyRef = history;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(sseEncode(obj));
      const stages: StageUsage[] = [];
      let fullText = "";
      let streamVisibleTextRef = "";

      try {
        console.log("[/api/chat] routing decision", {
          isAdultModeInput,
          isAdultMode,
          chatMode: chatRef.mode,
          userAdultVerified: !!user.is_adult,
          strategy: "openrouter-direct",
          openRouterModel: openRouterApiModelId,
          billingOpenRouterModel: billingOpenRouterModelId,
          selectedAI: selectedAIRef,
          hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
        });

        send({ type: "status", message: "생성 중…" });

        logMockModeOnce();
        if (isMockApiMode()) {
          console.warn("[/api/chat] MOCK_MODE — LLM HTTP 호출 없음, debug_payload.json 확인");
        }

        const turnApiBudget = new TurnApiBudget();
        const statusMetaEnabled =
          resolveStatusMetaExtractionEnabled({
          htmlReplacesMarkdownStatus: htmlPolicyReplacesMarkdownStatus(htmlVisualCardPolicyRef),
          htmlVisualCardStanding: htmlVisualCardPolicyRef.standing,
          htmlVisualCardEnabled: htmlVisualCardPolicyRef.enabled,
          chatOocRpUnrelated,
          statusWindowEveryTurn: statusWindowPolicyRef?.everyTurn === true,
          userMessage: policyUserMessageRef,
        });

        let openRouterRemovalTraceSteps: RemovalTraceStep[] = [];
        const htmlDisplayOnlyTurn = isHtmlDisplayOnlyTurn(storedUserMessage);
        const oocCreativeHtmlTurn =
          isOocCreativeHtmlTurn(storedUserMessage) || chatOocRpUnrelated;
        const htmlFlashOnlyTurn =
          chatOocRpUnrelated || isHtmlFlashOnlyTurn(storedUserMessage);

        try {
          if (htmlFlashOnlyTurn) {
            console.info("[/api/chat] HTML 전용 턴 — skipping OpenRouter main model", {
              chatId: chatRef.id,
              displayOnly: htmlDisplayOnlyTurn,
              oocCreative: oocCreativeHtmlTurn,
              userMessagePreview: resolvedUserMessageRef.slice(0, 120),
            });
            send({ type: "replace", text: "", instant: true });
            send({ type: "status", message: "HTML 생성 중…" });
            fullText = "";
            streamVisibleTextRef = "";
          } else {
          const orHistory = convertToOpenRouterFormat(historyRef);
          const result = await streamOpenRouterAdultToClient(
            send,
            systemRef,
            orHistory,
            openRouterApiModelId,
            selectedAILabel(selectedAIRef),
            targetResponseCharsRef,
            {
              charName: ch.name,
              personaName: personaDisplayName,
              systemSplit: openRouterSystemSplitRef,
            sessionId: regenerateMessageId
              ? `chat-${chatRef.id}-regen-${regenerateMessageId}-${regenAttemptId ?? Date.now()}`
              : chatRef.id
                  ? `chat-${chatRef.id}`
                  : undefined,
              oocHtmlMode: oocHtmlMode || undefined,
              statusArtifactsOpts: statusArtifactOpts,
              generationOverrides: regenerateMessageId
                ? resolveRegenerateGenerationOverrides(openRouterApiModelId, targetResponseCharsRef)
                : undefined,
            },
            turnApiBudget
          );
          fullText = result.text;
          streamVisibleTextRef = result.streamVisibleText ?? fullText;
          stages.push(result.stage);
          openRouterRemovalTraceSteps = result.removalTraceSteps;
          if (result.recoveryStage) stages.push(result.recoveryStage);
          send({ type: "status", message: "마무리 중…" });
          }

          if (!htmlFlashOnlyTurn && fullText.trim()) {
            const lexiconRewrite = await maybeRewriteNarrationLexicon({
              text: fullText,
              charName: ch.name,
              system: systemRef,
              history: historyRef
                .filter((m): m is ChatMsg & { role: "user" | "assistant" } =>
                  m.role === "user" || m.role === "assistant"
                )
                .map((m) => ({ role: m.role, content: m.content ?? "" })),
              model: openRouterApiModelId,
              targetResponseChars: targetResponseCharsRef,
              requestKind: `chat-${chatRef.id}`,
              turnApiBudget,
            });
            if (lexiconRewrite.rewritten) {
              fullText = lexiconRewrite.text;
              streamVisibleTextRef = lexiconRewrite.text;
              console.info("[/api/chat] narration lexicon rewrite applied", {
                chatId: chatRef.id,
                hits: lexiconRewrite.hits,
              });
            }
          }
        } catch (e) {
          if (e instanceof DegenerationAbortError) {
            console.warn("[/api/chat] OpenRouter DEGENERATION_ABORT — billing skipped");
            send({ type: "reset" });
            send({ type: "error", error: DEGENERATION_USER_MESSAGE });
            controller.close();
            return;
          }
          console.error("[/api/chat] OpenRouter 생성 실패:", (e as Error).message);
          send({ type: "reset" });
          send({
            type: "error",
            error: formatClientApiError(e, "OpenRouter request failed"),
          });
          controller.close();
          return;
        }

        const modelDeliveredText = fullText;
        const routeRemovalTraceSteps: RemovalTraceStep[] = [];
        const traceStep = (stage: string, before: string, after: string, reason: string) =>
          pushRemovalTraceStep(routeRemovalTraceSteps, stage, before, after, reason);

        let traced = modelDeliveredText;
        traced = traceStep(
          "sanitizeStreamArtifacts",
          traced,
          sanitizeStreamArtifacts(traced),
          "sanitizeStreamArtifacts — incomplete [태그:…] and trailing < HTML fragments"
        );
        traced = traceStep(
          "stripNarrativePartLabels",
          traced,
          stripNarrativePartLabels(traced),
          "stripNarrativePartLabels — Part/파트 scene labels"
        );
        traced = traceStep(
          "stripInternalTagLeakage",
          traced,
          stripInternalTagLeakage(traced),
          "stripInternalTagLeakage — XML/internal instruction tags"
        );
        traced = traceStep(
          "sanitizeHairDescriptions",
          traced,
          sanitizeHairDescriptions(traced, hairPolicy),
          "sanitizeHairDescriptions — hair policy violations"
        );
        traced = traceStep(
          "sanitizeVisualAppearance",
          traced,
          sanitizeVisualAppearance(traced, visualPolicy),
          "sanitizeVisualAppearance — visual policy violations"
        );
        traced = traceStep(
          "sanitizeStreamArtifacts_2",
          traced,
          sanitizeStreamArtifacts(traced),
          "sanitizeStreamArtifacts (2nd pass)"
        );
        traced = traceStep(
          "normalizeAiNovelProseLayout",
          traced,
          normalizeAiNovelProseLayout(traced),
          "normalizeAiNovelProseLayout — paragraph/dialogue reflow"
        );
        traced = traceStep(
          "dedupeGlobalParagraphs",
          traced,
          dedupeGlobalParagraphs(traced),
          "dedupeGlobalParagraphs — remove repeated paragraphs from model echo"
        );
        traced = traceStep(
          "sanitizeEmotionTagInText",
          traced,
          sanitizeEmotionTagInText(traced, assetTags),
          "sanitizeEmotionTagInText — disallowed [태그:…] for asset policy"
        );
        traced = traceStep(
          "stripRpMetaLeakage",
          traced,
          stripRpMetaLeakage(traced),
          "stripRpMetaLeakage — RP meta preamble leakage"
        );
        traced = traceStep(
          "stripSceneAnalysisLeakage",
          traced,
          stripSceneAnalysisLeakage(traced),
          "stripSceneAnalysisLeakage — model scene-planning / reasoning leakage"
        );
        fullText = traced;

        const preStatusPartitionText = fullText;
        let statusArtifacts: ReturnType<typeof partitionModelStatusArtifacts>;
        let afterClampText: string;
        let savedText: string;
        let capturedStatusTable: string | null;
        let capturedStatusHtml: string | null;
        let relationshipTailParsed = false;
        let relationshipDeltaFromMain: RelationshipMetaDelta | null = null;

        if (oocHtmlMode) {
          statusArtifacts = {
            prose: fullText,
            capturedTableMarkdown: null,
            capturedHtmlFence: null,
          };
          afterClampText = fullText;
          savedText = traceStep(
            "stripEmotionTagsForDisplay",
            fullText,
            stripEmotionTagsForDisplay(fullText),
            "stripEmotionTagsForDisplay — [태그:…] emotion markers removed for display (oocHtmlMode)"
          );
          savedText = traceStep(
            "preserveStreamFirstProse",
            savedText,
            preserveStreamFirstProse(
              streamVisibleTextRef || preStatusPartitionText,
              savedText,
              targetResponseCharsRef
            ),
            "preserveStreamFirstProse — oocHtmlMode, HTML preserved"
          );
          capturedStatusTable = null;
          capturedStatusHtml = null;
        } else {
          statusArtifacts = partitionModelStatusArtifacts(fullText, statusArtifactOpts);
          const statusProseAfterPartition = statusArtifacts.prose;
          traceStep(
            "partitionModelStatusArtifacts",
            preStatusPartitionText,
            statusProseAfterPartition,
            "stripStatusWindowJsonBlock / splitStatusMarkdownTables / stripTrailingGluedPipeTable / extractModelHtmlVisualFences (partitionModelStatusArtifacts)"
          );
          fullText = traceStep(
            "applyStreamFirstAfterStatusPartition",
            statusProseAfterPartition,
            applyStreamFirstAfterStatusPartition({
              streamVisible: streamVisibleTextRef || preStatusPartitionText,
              prePartitionText: preStatusPartitionText,
              proseAfterPartition: statusProseAfterPartition,
              targetResponseChars: targetResponseCharsRef,
            }),
            "clampResponseLength + preserveStreamFirstProse vs stream-visible baseline (route save path)"
          );
          afterClampText = fullText;
          savedText = traceStep(
            "stripEmotionTagsForDisplay",
            fullText,
            stripEmotionTagsForDisplay(fullText),
            "stripEmotionTagsForDisplay — [태그:…] emotion markers removed for display"
          );
          savedText = traceStep(
            "preserveStreamFirstProse",
            savedText,
            preserveStreamFirstProse(
              streamVisibleTextRef || preStatusPartitionText,
              savedText,
              targetResponseCharsRef
            ),
            "preserveStreamFirstProse — reject >5% loss vs stream-visible baseline"
          );
          capturedStatusTable = statusArtifacts.capturedTableMarkdown;
          capturedStatusHtml = statusArtifacts.capturedHtmlFence;
        }
        if (
          isCatastrophicallyShortResponse(savedText, targetResponseCharsRef) &&
          !isCatastrophicallyShortResponse(modelDeliveredText, targetResponseCharsRef)
        ) {
          console.warn("[/api/chat] sanitizer over-stripped — falling back to model text", {
            sanitizedChars: savedText.length,
            modelChars: modelDeliveredText.trim().length,
          });
          const beforeCatastrophicFallback = savedText;
          savedText = preserveStreamFirstProse(
            streamVisibleTextRef || modelDeliveredText,
            stripEmotionTagsForDisplay(
              clampResponseLength(
                normalizeAiNovelProseLayout(
                  sanitizeEmotionTagInText(
                    sanitizeStreamArtifacts(modelDeliveredText),
                    assetTags
                  )
                ),
                targetResponseCharsRef
              )
            ),
            targetResponseCharsRef
          );
          traceStep(
            "catastrophicSanitizerFallback",
            beforeCatastrophicFallback,
            savedText,
            "isCatastrophicallyShortResponse — fallback to lighter sanitize + clamp on modelDeliveredText"
          );
        }

        if (isTrafficOverloadSystemMessage(savedText)) {
          console.warn("[/api/chat] traffic overload message blocked from DB save");
          sendTrafficOverloadGracefulStream(send);
          controller.close();
          return;
        }

        if (!oocHtmlMode && isDegenerateOutput(savedText)) {
          console.warn("[/api/chat] final token-salad block — not saved, billing skipped", {
            outputChars: savedText.length,
            reason: getDegenerationReason(savedText),
            preview: savedText.slice(0, 120),
          });
          send({ type: "reset" });
          send({ type: "error", error: DEGENERATION_USER_MESSAGE });
          controller.close();
          return;
        }

        let lengthContinuationPasses = 0;
        let proseOnly = extractProseWithoutHtml(savedText) || savedText.trim();

        const sentenceRecoveryBeforeHtml = recoverSentenceCompletionInFullResponse(savedText);
        if (sentenceRecoveryBeforeHtml.recovered) {
          console.info("[sentence-completion-recovery] pre-html", {
            actions: sentenceRecoveryBeforeHtml.actions,
            beforeChars: savedText.length,
            afterChars: sentenceRecoveryBeforeHtml.text.length,
          });
          savedText = traceStep(
            "sentenceCompletionRecovery",
            savedText,
            sentenceRecoveryBeforeHtml.text,
            "recoverSentenceCompletion — prose tail finish before HTML flash attach"
          );
          proseOnly = extractProseWithoutHtml(savedText) || savedText.trim();
        }

        const streamProseBaseline =
          extractProseWithoutHtml(streamVisibleTextRef.trim()) ||
          streamVisibleTextRef.trim();
        const savedProseVisible = visibleAssistantDisplayCharCount(proseOnly);
        const streamProseVisible = visibleAssistantDisplayCharCount(streamProseBaseline);
        if (
          streamProseBaseline &&
          streamProseVisible > savedProseVisible + 150 &&
          streamProseVisible >= savedProseVisible * 1.12
        ) {
          console.warn("[/api/chat] saved prose shorter than stream-visible — restoring before length continuation", {
            savedProseVisible,
            streamProseVisible,
          });
          const beforeStreamProseRestore = savedText;
          savedText = preserveStreamFirstProse(
            streamProseBaseline,
            savedText,
            targetResponseCharsRef
          );
          traceStep(
            "streamProseRestoreBeforeContinuation",
            beforeStreamProseRestore,
            savedText,
            "restore stream-visible prose baseline before length continuation"
          );
          proseOnly = extractProseWithoutHtml(savedText) || savedText.trim();
        }

        if (
          NARRATIVE_LENGTH_CONTINUATION_ENABLED &&
          proseOnly.trim() &&
          needsVisibleLengthContinuation(proseOnly, targetResponseCharsRef)
        ) {
          send({ type: "status", message: "분량 보강 중…" });
          const contResult = await continueNarrativeIfUnderMinimum({
            prose: proseOnly,
            system: systemRef,
            modelId: openRouterApiModelId,
            targetResponseChars: targetResponseCharsRef,
            charName: ch.name,
            turnApiBudget,
            sessionId: regenerateMessageId
              ? `chat-${chatRef.id}-regen-${regenerateMessageId}-${regenAttemptId ?? Date.now()}`
              : chatRef.id
                ? `chat-${chatRef.id}`
                : undefined,
          });
          if (contResult.continued) {
            const beforeContinuation = savedText;
            proseOnly = contResult.prose;
            savedText = preserveStreamFirstProse(
              streamVisibleTextRef || proseOnly,
              proseOnly,
              targetResponseCharsRef
            );
            traceStep(
              "lengthContinuation",
              beforeContinuation,
              savedText,
              "continueNarrativeIfUnderMinimum — prose merge + preserveStreamFirstProse"
            );
            lengthContinuationPasses = 1;
            if (contResult.stage) stages.push(contResult.stage);
          }
        }

        let htmlFlashPasses = 0;
        let flashHtmlUsage: import("@/lib/ai").TokenUsage | null = null;
        let flashPromptEstimateTokens = 0;
        let flashHtmlError: string | null = null;
        let htmlBlockBeforeEnsure: string | null = null;
        const savedBeforeHtmlFlash = savedText;
        if (
          !oocHtmlMode &&
          (htmlVisualCardPolicyRef.enabled || chatOocRpUnrelated || htmlFlashOnlyTurn)
        ) {
          const beforeHtmlPass = savedText;
          proseOnly = resolveProseBaselineForHtmlFlash({
            savedText,
            streamVisible: streamVisibleTextRef,
          });
          if (!proseOnly.trim() && !htmlFlashOnlyTurn) {
            console.warn("[/api/chat] HTML flash skipped — no RP prose baseline", {
              savedChars: savedText.length,
              streamVisibleChars: streamVisibleTextRef.length,
            });
          } else if (
            proseOnly !== extractProseWithoutHtml(savedText) &&
            streamVisibleTextRef.trim().length > 0
          ) {
            console.info("[html-flash] using stream-visible prose baseline", {
              savedProseChars: extractProseWithoutHtml(savedText).length,
              baselineProseChars: proseOnly.length,
            });
          }
          const placement = resolveHtmlFlashPlacement(htmlVisualCardPolicyRef, {
            userMessage: htmlFlashContextRef.userMessage,
            userNote: htmlFlashContextRef.userNote,
            userPersona: htmlFlashContextRef.userPersona ?? undefined,
            characterSetting: htmlFlashContextRef.characterSetting,
          });

          send({
            type: "status",
            message: placement === "bottom" ? "상태창 생성 중…" : "HTML 생성 중…",
          });

          if (proseOnly.trim() || htmlFlashOnlyTurn) {
          if (htmlFlashOnlyTurn) {
            proseOnly = "";
          }
          send({ type: "replace", text: proseOnly, instant: true });
          let htmlBlock: string | null = null;
          try {
            const flashGen = await generateHtmlVisualCardWithFlash({
              ...htmlFlashContextRef,
              assistantProse: proseOnly,
              policy: htmlFlashOnlyTurn
                ? applyChatOocExclusiveHtmlPolicy(htmlVisualCardPolicyRef)
                : htmlVisualCardPolicyRef,
              placement,
              displayUserInputOnly: htmlDisplayOnlyTurn,
              oocCreativeBrief: oocCreativeHtmlTurn && !htmlDisplayOnlyTurn,
              chatOocExclusive: chatOocRpUnrelated,
              htmlOnlyDedicatedTurn: htmlFlashOnlyTurn,
            });
            htmlBlock = flashGen.html;
            flashHtmlUsage = flashGen.usage;
            flashPromptEstimateTokens = flashGen.promptEstimateTokens;
            flashHtmlError = flashGen.flashError ?? null;
            htmlBlockBeforeEnsure = htmlBlock;
          } catch (htmlErr) {
            console.warn("[/api/chat] HTML visual card failed — using server fallback", {
              error: (htmlErr as Error).message,
            });
          }
          if (!htmlBlock && capturedStatusHtml) {
            htmlBlock = capturedStatusHtml;
          }
          if (!htmlBlock && !oocCreativeHtmlTurn && !chatOocRpUnrelated && htmlVisualCardPolicyRef.statusFieldLabels.length > 0) {
            htmlBlock = buildFallbackHtmlVisualCard(htmlVisualCardPolicyRef.statusFieldLabels);
          }
          if (htmlBlock) {
          const oocFlashUserMessage =
            oocCreativeHtmlTurn || chatOocRpUnrelated ? storedUserMessage : "";
          htmlBlock = ensureHtmlVisualCardBlock(
            htmlBlock,
            chatOocRpUnrelated || oocCreativeHtmlTurn ? [] : htmlVisualCardPolicyRef.statusFieldLabels,
            {
              skipGenericFallback:
                htmlFlashOnlyTurn || oocCreativeHtmlTurn || chatOocRpUnrelated,
              oocUserMessage: oocFlashUserMessage,
            }
          );
          }

          savedText = htmlBlock
            ? attachHtmlBlockAtPlacement(
                proseOnly,
                htmlBlock,
                placement,
                chatOocRpUnrelated || oocCreativeHtmlTurn ? [] : htmlVisualCardPolicyRef.statusFieldLabels,
                {
                  skipCompactRebuild:
                    htmlFlashOnlyTurn || oocCreativeHtmlTurn || chatOocRpUnrelated,
                }
              )
            : proseOnly;
          const afterHtmlAttach = traceStep(
            "htmlFlashAttach",
            beforeHtmlPass,
            savedText,
            "attachHtmlBlockAtPlacement — HTML visual card appended at resolved placement"
          );
          savedText = htmlFlashOnlyTurn
            ? savedText.trim()
            : normalizeFullResponsePreservingHtml(
                savedText,
                oocCreativeHtmlTurn || chatOocRpUnrelated ? storedUserMessage : undefined
              );
          traceStep(
            "htmlFlashNormalize",
            afterHtmlAttach,
            savedText,
            "normalizeFullResponsePreservingHtml — HTML fence normalize (no RP prose cap)"
          );
          htmlFlashPasses = 1;
          if (htmlFlashOnlyTurn && savedText.trim()) {
            send({ type: "replace", text: savedText, instant: true });
          }
          }
        }

        const savedBeforePostProcess = savedText;

        const htmlFragmentStrip =
          oocCreativeHtmlTurn || chatOocRpUnrelated
            ? stripBrokenHtmlFragmentPreservingOocBody(savedText, storedUserMessage)
            : stripBrokenHtmlFragmentAtEnd(savedText);
        if (htmlFragmentStrip.stripped) {
          savedText = traceStep(
            "htmlBrokenFragmentStrip",
            savedText,
            htmlFragmentStrip.text,
            "stripBrokenHtmlFragmentAtEnd — final unclosed ```html / tag tail removal"
          );
        }

        if (
          isCatastrophicallyShortResponse(savedText, targetResponseCharsRef) &&
          !isCatastrophicallyShortResponse(savedBeforePostProcess, targetResponseCharsRef)
        ) {
          if (
            htmlFlashPasses > 0 &&
            responseHasHtmlVisualCard(savedBeforePostProcess)
          ) {
            const proseInBefore =
              extractProseWithoutHtml(savedBeforePostProcess).trim() ||
              extractProseWithoutHtml(streamVisibleTextRef).trim() ||
              extractProseWithoutHtml(modelDeliveredText).trim();
            if (proseInBefore.length >= CATASTROPHIC_MIN_RESPONSE_CHARS) {
              console.warn("[/api/chat] post-recovery — keep HTML-attached response", {
                beforeChars: savedText.length,
                restoredChars: savedBeforePostProcess.length,
              });
              savedText = traceStep(
                "postRecoveryHtmlPreserve",
                savedText,
                savedBeforePostProcess,
                "post-recovery — preserve Flash HTML block after broken tail strip"
              );
            }
          } else {
          const proseFallback =
            extractProseWithoutHtml(savedBeforePostProcess).trim() ||
            extractProseWithoutHtml(streamVisibleTextRef).trim() ||
            extractProseWithoutHtml(modelDeliveredText).trim();
          if (proseFallback.length >= CATASTROPHIC_MIN_RESPONSE_CHARS) {
            console.warn("[/api/chat] post-recovery prose restored — broken HTML tail rejected", {
              beforeChars: savedText.length,
              restoredChars: proseFallback.length,
            });
            savedText = traceStep(
              "postRecoveryProseRestore",
              savedText,
              proseFallback,
              "post-recovery — restore RP prose after destructive HTML tail strip"
            );
          }
          }
        }

        proseOnly = extractProseWithoutHtml(savedText) || savedText.trim();

        if (
          htmlFlashOnlyTurn &&
          (oocCreativeHtmlTurn || chatOocRpUnrelated) &&
          savedText.trim()
        ) {
          const savedHtmlInner = unwrapHtmlVisualCardInner(
            splitChatRichBlocks(savedText).find((b) => b.kind === "html")?.text ?? savedText
          );
          if (!isOocCreativeHtmlRichEnough(savedHtmlInner, storedUserMessage)) {
            const preEnsureInner = htmlBlockBeforeEnsure
              ? unwrapHtmlVisualCardInner(htmlBlockBeforeEnsure)
              : "";
            if (
              preEnsureInner &&
              isOocCreativeHtmlRichEnough(preEnsureInner, storedUserMessage)
            ) {
              console.warn("[/api/chat] OOC HTML — restoring pre-post-process Flash block", {
                savedChars: savedText.length,
                restoredChars: htmlBlockBeforeEnsure!.length,
              });
              savedText = htmlBlockBeforeEnsure!;
            } else {
              console.warn("[/api/chat] OOC HTML — inbox body insufficient after post-process", {
                savedPlainChars: savedHtmlInner.length,
              });
              savedText = "";
            }
            proseOnly = savedText.trim();
          }
        }

        if (
          htmlFlashOnlyTurn &&
          !responseHasHtmlVisualCard(savedText) &&
          responseHasHtmlVisualCard(savedBeforePostProcess)
        ) {
          console.warn("[/api/chat] HTML flash-only — restoring HTML stripped by post-process", {
            beforeChars: savedText.length,
            restoredChars: savedBeforePostProcess.length,
          });
          savedText = savedBeforePostProcess;
          proseOnly = savedText.trim();
        }

        if (
          statusWindowPolicyRef?.everyTurn &&
          statusWindowPolicyRef.formatSpec &&
          !responseHasHtmlVisualCard(savedText)
        ) {
          savedText = traceStep(
            "stripModelPlainStatusForFlash",
            savedText,
            stripPlainStatusFromProse(
              savedText,
              statusWindowPolicyRef.formatSpec,
              statusWindowPolicyRef.placement
            ),
            "strip plain status lines — Flash StatusMeta owns display"
          );
          proseOnly = savedText.trim();
        }

        if (htmlFlashOnlyTurn && savedText.trim()) {
          savedText = traceStep(
            "sanitizeVisualAppearanceHtmlFlash",
            savedText,
            sanitizeVisualAppearance(
              sanitizeHairDescriptions(savedText, hairPolicy),
              visualPolicy
            ),
            "HTML flash — visual/hair lock (correct 금발/은발 drift in OOC HTML)"
          );
          proseOnly = extractProseWithoutHtml(savedText) || savedText.trim();
        }

        const visibleForLengthCheck = visibleAssistantDisplayText(savedText);

        if (
          htmlFlashOnlyTurn &&
          !savedText.trim() &&
          htmlBlockBeforeEnsure?.trim() &&
          !oocFlashHtmlMustBeRejected(unwrapHtmlVisualCardInner(htmlBlockBeforeEnsure)) &&
          isOocCreativeHtmlRichEnough(
            unwrapHtmlVisualCardInner(htmlBlockBeforeEnsure),
            storedUserMessage
          )
        ) {
          console.warn("[/api/chat] HTML flash-only — restoring pre-ensure Flash block", {
            beforeEnsureChars: htmlBlockBeforeEnsure.length,
          });
          savedText = htmlBlockBeforeEnsure;
          proseOnly = savedText.trim();
        }

        const billableStages = selectBillableStages(stages);
        const primaryStage = billableStages[0];
        let generationFailure = detectAdultGenerationFailure(
          primaryStage?.finishReason,
          savedText,
          targetResponseCharsRef,
          visibleForLengthCheck
        );

        if (
          generationFailure === "under_length" &&
          htmlFlashOnlyTurn &&
          responseHasHtmlVisualCard(savedText) &&
          isOocCreativeHtmlRichEnough(
            unwrapHtmlVisualCardInner(
              splitChatRichBlocks(savedText).find((b) => b.kind === "html")?.text ?? savedText
            ),
            storedUserMessage
          )
        ) {
          console.warn("[/api/chat] under_length waived — HTML flash-only turn", {
            visibleChars: resolveVisibleTierCharCount(savedText),
            totalChars: savedText.length,
          });
          generationFailure = null;
        }

        if (
          generationFailure === "under_length" &&
          responseHasHtmlVisualCard(savedText) &&
          resolveVisibleTierCharCount(savedText) >= CATASTROPHIC_MIN_RESPONSE_CHARS
        ) {
          console.warn("[/api/chat] under_length waived — HTML visual card present", {
            visibleChars: resolveVisibleTierCharCount(savedText),
            htmlFlashOnly: htmlFlashOnlyTurn,
            totalChars: savedText.length,
          });
          generationFailure = null;
        }

        if (generationFailure) {
          console.warn("[/api/chat] generation failure — billing skipped", {
            generationFailure,
            finishReason: primaryStage?.finishReason,
            outputChars: savedText.length,
            targetResponseChars: targetResponseCharsRef,
            routedTo: htmlFlashOnlyTurn ? "html-only" : "openrouter",
            flashHtmlError,
          });
          // 이미 스트리밍된 본문이 있으면 reset 금지 — 화면이 비었다가 에러만 남는 현상 방지
          if (savedText.trim().length < CATASTROPHIC_MIN_RESPONSE_CHARS) {
            send({ type: "reset" });
          }
          const errorMessage =
            htmlFlashOnlyTurn && generationFailure === "under_length"
              ? htmlFlashFailureUserMessage(flashHtmlError)
              : generationFailureUserMessage(generationFailure);
          send({
            type: "error",
            error: errorMessage,
          });
          controller.close();
          return;
        }

        const stageBillableInput =
          primaryStage?.input ?? estimateTokens(system + history.map((m) => m.content).join(""));
        const billableOpts = {};
        const summedApiOutput = sumOpenRouterStageOutputTokens(stages);
        const summedApiReasoning = sumOpenRouterStageReasoningTokens(stages);
        const summedUpstreamUsd = sumOpenRouterStageUpstreamUsd(stages);
        const apiPromptTokensForCost =
          primaryStage?.apiReportedInputTokens ?? primaryStage?.input ?? stageBillableInput;
        const apiCompletionTokensForCost =
          summedApiOutput > 0
            ? summedApiOutput
            : primaryStage?.apiOutputTokens ?? primaryStage?.output ?? 0;
        const opusApiOutputTokens =
          summedApiOutput > 0
            ? summedApiOutput
            : primaryStage?.apiOutputTokens ?? primaryStage?.output ?? 0;
        const billableApiOutputTokens = billableOpenRouterOutputTokens(
          billingOpenRouterModelId ?? "",
          opusApiOutputTokens,
          summedApiReasoning
        );

        const billableChars = billableOutputChars(savedText, targetResponseCharsRef, billableOpts);

        const billingProvider = "openrouter" as const;
        const receiptFields = stealthReceiptModelFields(selectedAIRef);

        let totalInput: number;
        let totalOutput: number;
        let billing: {
          modelId: string;
          baseCost: number;
          contextSurcharge: number;
          multiplier: number;
          total: number;
          coldStartShieldApplied?: boolean;
          uncappedChargePoints?: number;
          coldStartCostFloorPoints?: number;
        };

        if (htmlFlashOnlyTurn) {
          const flashBilling = computeHtmlFlashOnlyTurnBilling({
            savedTextChars: billableChars,
            userContextChars,
            inputTokens: flashHtmlUsage?.inputTokens,
            outputTokens: flashHtmlUsage?.outputTokens,
            promptEstimateTokens: flashPromptEstimateTokens,
            upstreamCostUsd: flashHtmlUsage?.upstreamCostUsd,
            cacheReadTokens: flashHtmlUsage?.cacheReadTokens,
            cacheWriteTokens: flashHtmlUsage?.cacheWriteTokens,
          });
          totalInput = flashBilling.estimatedInputTokens;
          totalOutput = flashBilling.estimatedOutputTokens;
          billing = {
            modelId: flashBilling.modelId,
            baseCost: flashBilling.baseCost,
            contextSurcharge: flashBilling.contextSurcharge,
            multiplier: flashBilling.multiplier,
            total: flashBilling.total,
          };
        } else {
          totalInput = resolveTurnBillableInput({
            stageInput: stageBillableInput,
            promptAuditTotal: promptAuditRef?.totalAssembledTokens,
          });
          totalOutput =
            billableApiOutputTokens > 0
              ? billableApiOutputTokens
              : billableOutputTokens(
                  primaryStage?.apiOutputTokens ?? 0,
                  savedText,
                  targetResponseCharsRef,
                  billableOpts
                );
          billing = computeTurnBilling({
            provider: billingProvider,
            selectedAI: selectedAIRef,
            openRouterModelId: billingOpenRouterModelId,
            inputTokens: totalInput,
            outputTokens: totalOutput,
            cacheReadTokens: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens,
            cacheWriteTokens: primaryStage?.cacheWriteTokens,
            userContextChars,
            savedTextChars: billableChars,
            completedTurnsBeforeRequest: playableTurnCount,
            modelLabel: selectedAILabel(selectedAIRef),
            upstreamCostUsd: summedUpstreamUsd > 0 ? summedUpstreamUsd : undefined,
            apiPromptTokens: apiPromptTokensForCost,
            apiCompletionTokens: apiCompletionTokensForCost,
          });
        }

        const removalTraceReport = buildRemovalTraceReport({
          rawModelText: modelDeliveredText,
          rawModelTextReason:
            "baseline: modelDeliveredText — post-openRouter finalizeStreamEndProse, pre-route pre-sanitize (sanitizeRepeatedEnding / removeLoopTail not in save path)",
          preRouteSteps: openRouterRemovalTraceSteps,
          steps: routeRemovalTraceSteps,
          finalSavedText: savedText,
        });
        logRemovalTrace(removalTraceReport, {
          chatId: chatRef.id,
          savedVisibleChars: billableChars,
        });

        if (process.env.NODE_ENV !== "production") {
          const cacheOpts = {
            cacheReadTokens: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens,
            cacheWriteTokens: primaryStage?.cacheWriteTokens,
          };
          const opusExplain =
            billingOpenRouterModelId && /opus/i.test(billingOpenRouterModelId)
              ? explainOpenRouterOpusTurnCost(
                  totalInput,
                  totalOutput,
                  billingOpenRouterModelId,
                  billableChars,
                  cacheOpts
                )
              : null;
          const deepSeekExplain =
            billingOpenRouterModelId && isDeepSeekV4ProModel(billingOpenRouterModelId)
              ? explainOpenRouterDeepSeekTurnCost(
                  totalInput,
                  totalOutput,
                  billingOpenRouterModelId,
                  cacheOpts
                )
              : null;
          const geminiBillingBasis =
            summedUpstreamUsd > 0 || apiPromptTokensForCost > 0 || apiCompletionTokensForCost > 0
              ? {
                  upstreamCostUsd: summedUpstreamUsd > 0 ? summedUpstreamUsd : undefined,
                  apiPromptTokens: apiPromptTokensForCost,
                  apiCompletionTokens: apiCompletionTokensForCost,
                }
              : undefined;
          const geminiProExplain =
            billingOpenRouterModelId && isGeminiProOpenRouterModel(billingOpenRouterModelId)
              ? explainOpenRouterGeminiProTurnCost(
                  totalInput,
                  totalOutput,
                  billingOpenRouterModelId,
                  cacheOpts,
                  geminiBillingBasis
                )
              : null;
          console.log("[/api/chat] OpenRouter billing tokens", {
            prompt: totalInput,
            standardInput: primaryStage?.standardInputTokens,
            cacheRead: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens ?? 0,
            cacheWrite: primaryStage?.cacheWriteTokens ?? 0,
            output: totalOutput,
            outputChars: billableChars,
            chargeP: billing.total,
            ...(opusExplain
              ? {
                  opusRawCostKrw: opusExplain.rawCostKrw,
                  opusNormalizedRawCostKrw: opusExplain.normalizedRawCostKrw,
                  opusCharFloorKrw: opusExplain.charFloorKrw,
                  opusCostPlusMarginKrw: opusExplain.costPlusMarginKrw,
                  opusApplied: opusExplain.applied,
                }
              : {}),
            ...(deepSeekExplain
              ? {
                  deepSeekRawCostKrw: deepSeekExplain.rawCostKrw,
                  deepSeekTokenFloorKrw: deepSeekExplain.charFloorKrw,
                  deepSeekCostPlusMarginKrw: deepSeekExplain.costPlusMarginKrw,
                  deepSeekApplied: deepSeekExplain.applied,
                }
              : {}),
            ...(geminiProExplain
              ? {
                  geminiProRawCostKrw: geminiProExplain.rawCostKrw,
                  geminiProCostPlusMarginKrw: geminiProExplain.costPlusMarginKrw,
                  geminiProApplied: geminiProExplain.applied,
                }
              : {}),
          });
        }

        const forcedAbort = billableStages.some((s) => s.loopAborted);
        const degenerationAborted = billableStages.some((s) => s.degenerationAborted);
        const billingWaiverReason = shouldWaiveTurnBilling(savedText, {
            forcedAbort,
            degenerationAborted,
            generationFailure,
            adultMode: true,
            targetResponseChars: targetResponseCharsRef,
          });
        let cost = billingWaiverReason ? 0 : billing.total;

        if (billingWaiverReason && !isMockApiMode()) {
          const modelId = billingOpenRouterModelId ?? "";
          let waiverMin = 0;
          if (isDeepSeekV4ProModel(modelId)) {
            waiverMin = resolveDeepSeekWaiverMinimumCharge(savedText, billingWaiverReason, {
              degenerationAborted,
              targetResponseChars: targetResponseCharsRef,
            });
          } else if (isQwenModel(modelId)) {
            waiverMin = resolveQwenWaiverMinimumCharge(savedText, billingWaiverReason, {
              degenerationAborted,
              targetResponseChars: targetResponseCharsRef,
            });
          } else if (isGemini25ProModel(modelId)) {
            waiverMin = resolveGemini25WaiverMinimumCharge(savedText, billingWaiverReason, {
              degenerationAborted,
              targetResponseChars: targetResponseCharsRef,
            });
          } else if (isGemini31ProModel(modelId)) {
            waiverMin = resolveGemini31WaiverMinimumCharge(savedText, billingWaiverReason, {
              degenerationAborted,
              targetResponseChars: targetResponseCharsRef,
            });
          }
          if (waiverMin > 0) cost = waiverMin;
        }

        const mainBillingCost = cost;

        const draftInput = primaryStage?.input ?? 0;
        // 실제 조립된 프롬프트(promptAudit·trackedSections) 기준 분해 — API에 주입된 텍스트만 집계
        let sysRulesEst = 0;
        let charPromptEst = 0;
        let personaEst = 0;
        let userNoteEst = 0;
        let memoryEst = 0;
        let assetTagEst = 0;
        let memoryMetaEst = 0;

        const audit = promptAuditRef;
        if (audit) {
          charPromptEst =
            audit.breakdown.characterSetting +
            audit.breakdown.worldLore +
            audit.breakdown.dialogueExamples;
          sysRulesEst = audit.breakdown.systemRules;
          personaEst = audit.breakdown.persona;
          userNoteEst = audit.breakdown.userNote;
          memoryEst = audit.breakdown.memory;
        }

        for (const s of trackedSectionsRef) {
          const t = estimateTokens(s.text);
          if (s.id === "rule-asset-tags") assetTagEst += t;
          else if (s.id === "memory-meta") memoryMetaEst += t;
          else if (!audit) {
            if (s.category === "persona") personaEst += t;
            else if (s.category === "userNote") userNoteEst += t;
            else if (s.category === "memory") memoryEst += t;
            else if (s.category === "systemRules") sysRulesEst += t;
            else charPromptEst += t;
          }
        }

        // rule-asset-tags는 systemRules에 포함 — 별도 줄과 이중 집계 방지
        if (audit && assetTagEst > 0) {
          sysRulesEst = Math.max(0, sysRulesEst - assetTagEst);
        }

        let narrativeContextEst = 0;
        let currentMemoryEst = 0;
        for (const s of trackedSectionsRef) {
          const t = estimateTokens(s.text);
          if (s.id === "recent-narrative-context") narrativeContextEst += t;
          else if (s.id === "current-memory") currentMemoryEst += t;
        }
        if (narrativeContextEst === 0 && currentMemoryEst === 0) {
          currentMemoryEst = memoryEst;
        }

        // raw = 전체 대화 → trimHistoryToBudget(DeepSeek 16K / others 8K)
        const historyEst =
          audit?.breakdown.recentConversation ??
          historyRef.reduce((s, m) => s + estimateTokens(m.content ?? ""), 0);

        const sections = [
          { label: "최근 raw 턴", est: historyEst },
          ...(narrativeContextEst > 0
            ? [{ label: "요약·내러티브 (이전 대화)", est: narrativeContextEst }]
            : []),
          { label: "캐릭터 프롬프트", est: charPromptEst },
          { label: "시스템 프롬프트 (고정 규칙)", est: sysRulesEst },
          { label: "장기 기억 (현재기억)", est: currentMemoryEst },
          { label: "선택 페르소나", est: personaEst },
          { label: "유저 노트", est: userNoteEst },
          { label: "에셋 태그", est: assetTagEst },
          { label: "호칭·메타", est: memoryMetaEst },
        ];
        const totalEst = Math.max(1, sections.reduce((s, x) => s + x.est, 0));
        const breakdown = sections
          .map((s) => ({
            label: s.label,
            tokens: Math.round((s.est / totalEst) * draftInput),
            pct: Math.round((s.est / totalEst) * 100),
          }))
          .filter((s) => s.tokens > 0);

        const stageCosts = billableStages.map((s) => ({ ...s, cost }));

        const routeMode: Route = isAdultMode ? "nsfw" : "safe";

        const orCacheReceipt =
          billingProvider === "openrouter"
            ? buildOpenRouterCacheReceiptInfo({
                modelId: billingOpenRouterModelId ?? undefined,
                promptTokens: totalInput,
                cacheReadTokens:
                  primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens,
                cacheWriteTokens: primaryStage?.cacheWriteTokens,
                standardInputTokens: primaryStage?.standardInputTokens,
              })
            : null;

        const billingExchangeRate =
          billingProvider === "openrouter" ? resolveBillingExchangeRateSnapshot() : null;

        const apiInputTokens = htmlFlashOnlyTurn
          ? (flashHtmlUsage?.apiReportedInputTokens ??
            flashHtmlUsage?.inputTokens ??
            totalInput)
          : (primaryStage?.apiReportedInputTokens ?? primaryStage?.input ?? totalInput);
        const apiOutputTokens = htmlFlashOnlyTurn
          ? (flashHtmlUsage?.outputTokens ?? totalOutput)
          : summedApiOutput > 0
            ? summedApiOutput
            : primaryStage?.apiOutputTokens ?? primaryStage?.output ?? totalOutput;
        const apiReasoningOutputTokens =
          summedApiReasoning > 0 ? summedApiReasoning : undefined;
        const apiContentOutputTokens =
          apiReasoningOutputTokens != null
            ? Math.max(0, apiOutputTokens - apiReasoningOutputTokens)
            : undefined;
        const apiCallCount =
          1 +
          Math.max(0, primaryStage?.lengthRecoveryPasses ?? 0) +
          lengthContinuationPasses +
          htmlFlashPasses;

        const usageModel = htmlFlashOnlyTurn ? billing.modelId : receiptFields.model;
        const usageModelLabel = htmlFlashOnlyTurn ? HTML_ONLY_MODEL_LABEL : receiptFields.modelLabel;

        const mainOpenRouterApiRawCostKrw =
          billingProvider === "openrouter" && billingExchangeRate
            ? openRouterRawCostKrw({
                promptTokens: apiInputTokens,
                outputTokens: apiOutputTokens,
                modelId: billingOpenRouterModelId,
                cacheReadTokens:
                  primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens,
                cacheWriteTokens: primaryStage?.cacheWriteTokens,
                upstreamCostUsd:
                  summedUpstreamUsd > 0 ? summedUpstreamUsd : primaryStage?.upstreamCostUsd,
                exchangeRate: billingExchangeRate,
              })
            : null;

        let usageRecord: Usage = {
          input: totalInput,
          output: totalOutput,
          ...(htmlFlashOnlyTurn ? { htmlFlashOnly: true } : {}),
          ...(primaryStage?.lengthRecoveryPasses != null && primaryStage.lengthRecoveryPasses > 0
            ? { lengthRecoveryPasses: primaryStage.lengthRecoveryPasses }
            : {}),
          savedOutputChars: billableChars,
          model: usageModel,
          provider: billingProvider,
          route: routeMode,
          selectedAI: receiptFields.selectedAI,
          cost,
          baseCost: mainBillingCost,
          modelLabel: usageModelLabel,
          estimated:
            htmlFlashOnlyTurn
              ? flashHtmlUsage?.estimated ?? flashPromptEstimateTokens > 0
              : billableStages.some((s) => s.estimated),
          breakdown,
          stages: stageCosts,
          ...( {
                apiInputTokens,
                apiOutputTokens,
                ...(apiReasoningOutputTokens != null
                  ? { apiReasoningOutputTokens, apiContentOutputTokens }
                  : {}),
                ...(apiCallCount > 1 ? { apiCallCount } : {}),
                ...(primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens
                  ? { cacheReadTokens: primaryStage.cacheReadTokens ?? primaryStage.cachedContentTokens }
                  : {}),
                ...(primaryStage?.cacheWriteTokens
                  ? { cacheWriteTokens: primaryStage.cacheWriteTokens }
                  : {}),
                ...(primaryStage?.standardInputTokens != null
                  ? { standardInputTokens: primaryStage.standardInputTokens }
                  : {}),
                ...(summedUpstreamUsd > 0
                  ? { upstreamCostUsd: summedUpstreamUsd }
                  : primaryStage?.upstreamCostUsd != null && primaryStage.upstreamCostUsd > 0
                    ? { upstreamCostUsd: primaryStage.upstreamCostUsd }
                    : {}),
                ...(primaryStage?.cacheDiscountUsd != null && primaryStage.cacheDiscountUsd !== 0
                  ? { cacheDiscountUsd: primaryStage.cacheDiscountUsd }
                  : {}),
                ...(orCacheReceipt?.cacheReadLine
                  ? { cacheReadLine: orCacheReceipt.cacheReadLine }
                  : {}),
                ...(orCacheReceipt?.cacheWriteLine
                  ? { cacheWriteLine: orCacheReceipt.cacheWriteLine }
                  : {}),
                ...(orCacheReceipt
                  ? {
                      cacheRateSummary: orCacheReceipt.rateSummary,
                      cacheFamily: orCacheReceipt.family,
                    }
                  : {}),
              } ),
          ...(billing.coldStartShieldApplied
            ? {
                coldStartShieldApplied: true,
                uncappedChargePoints: billing.uncappedChargePoints,
                coldStartCostFloorPoints: billing.coldStartCostFloorPoints,
              }
            : {}),
          ...(billingWaiverReason && cost <= 0
            ? { billingWaived: true, billingWaiverReason: billingWaiverReason }
            : {}),
          ...(billingProvider === "openrouter" && billingExchangeRate
            ? {
                exchangeRateKrwPerUsd: billingExchangeRate.effectiveKrwPerUsd,
                exchangeRateDateKey: billingExchangeRate.dateKey,
                exchangeRateMode: billingExchangeRate.mode,
                exchangeRateSource: billingExchangeRate.source,
                ...(mainOpenRouterApiRawCostKrw != null
                  ? {
                      apiRawCostKrw: mainOpenRouterApiRawCostKrw,
                      mainApiRawCostKrw: mainOpenRouterApiRawCostKrw,
                    }
                  : {}),
                ...(billingOpenRouterModelId && /opus/i.test(billingOpenRouterModelId)
                  ? {
                      normalizedRawCostKrw: openRouterNormalizedRawCostKrw({
                        promptTokens: apiInputTokens,
                        outputTokens: apiOutputTokens,
                        modelId: billingOpenRouterModelId,
                        exchangeRate: billingExchangeRate,
                      }),
                    }
                  : {}),
              }
            : {}),
        };

        const rawWidgetSourceText = preStatusPartitionText;
        if (mainModelOwnsRelationshipExtract) {
          const relSplit = splitAndNormalizeRelationshipMemoryTail(
            savedText,
            `${messageText}\n${savedText}`,
            relationshipNames
          );
          if (relSplit.parseOk) {
            relationshipTailParsed = true;
            relationshipDeltaFromMain = relSplit.delta;
            savedText = relSplit.prose;
          }
        }
        let statusWidgetValuesPayload: ParsedStatusWidgetTurnValues | null = null;
        if (statusWidgetActive) {
          const widgetResolved = await resolveStatusWidgetTurnValues({
            chatId: chatRef.id,
            modelId: openRouterApiModelId,
            regenerate: !!regenerateMessageId,
            savedText,
            rawWidgetSourceText,
            statusWidgetTurn,
            charName: ch.name,
            personaName: personaDisplayName,
            userMessage: messageText,
            userNote: effectiveUserNote,
            regenerateMessageId: regenerateMessageId ?? undefined,
          });
          savedText = widgetResolved.prose;
          statusWidgetValuesPayload = widgetResolved.values;
          logStatusWidgetTurnTelemetry(widgetResolved.telemetry);
          if (
            widgetResolved.widgetExtractUsage &&
            billingProvider === "openrouter" &&
            billingExchangeRate
          ) {
            if (showFullBillingReceipt) {
              const widgetBilling = applyStatusWidgetBillingCharge(
                usageRecord,
                widgetResolved.widgetExtractUsage,
                billingExchangeRate,
                mainBillingCost
              );
              usageRecord = widgetBilling.record;
              cost = widgetBilling.totalCost;
            } else {
              const widgetReceipt = buildStatusWidgetExtractReceipt(
                widgetResolved.widgetExtractUsage,
                billingExchangeRate
              );
              const widgetCostPoints = statusWidgetApiCostChargePoints(widgetReceipt.apiRawCostKrw);
              cost = mainBillingCost + widgetCostPoints;
              usageRecord = {
                ...usageRecord,
                baseCost: mainBillingCost,
                cost,
              };
            }
          }
        }

        if (visualPolicy.hair || visualPolicy.eyes) {
          savedText = traceStep(
            "sanitizeVisualAppearanceFinal",
            savedText,
            sanitizeVisualAppearance(
              sanitizeHairDescriptions(savedText, hairPolicy),
              visualPolicy
            ),
            "final pass — appearance lock after stream-first / length continuation"
          );
        }

        if (!showFullBillingReceipt) {
          usageRecord = sanitizeUsageForPublicReceipt(usageRecord);
        }

        const createdAt = new Date().toISOString();
        const newVariant = {
          content: savedText,
          model: usageRecord.model,
          usage: usageRecord,
          created_at: createdAt,
        };

        let aiMessageId: number;
        let variantPayload = serializeVariantsForClient([newVariant], 0);
        let snapshotVariantIndex = 0;
        let snapshotVariantCount = 1;

        const statusWidgetValuesJson = statusWidgetValuesPayload
          ? serializeStatusWidgetValuesJson(statusWidgetValuesPayload)
          : "";
        const statusWidgetTurnActiveFlag = statusWidgetActive ? 1 : 0;

        if (regenerateMessageId) {
          const existing = db
            .prepare(
              "SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=? AND chat_id=?"
            )
            .get(regenerateMessageId, chatRef.id) as {
            content: string;
            model: string;
            usage: string | null;
            alternates: string | null;
            active_variant: number | null;
          };
          const { variants: prevVariants } = normalizeMessageVariants(existing);
          const appended = appendMessageVariant(prevVariants, newVariant);
          variantPayload = serializeVariantsForClient(appended.variants, appended.activeVariant);
          snapshotVariantIndex = appended.activeVariant;
          snapshotVariantCount = appended.variants.length;

          db.prepare(
            `UPDATE messages SET content=?, model=?, usage=?, alternates=?, active_variant=?, is_refunded=0,
             status_meta=NULL, status_widget_values_json=?, status_widget_turn_active=? WHERE id=? AND chat_id=?`
          ).run(
            savedText,
            usageRecord.model,
            JSON.stringify(usageRecord),
            JSON.stringify(appended.variants),
            appended.activeVariant,
            statusWidgetValuesJson,
            statusWidgetTurnActiveFlag,
            regenerateMessageId,
            chatRef.id
          );
          aiMessageId = regenerateMessageId;
        } else {
          if (!skipUserInsert) {
            const userMsg = db
              .prepare("INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)")
              .run(chatRef.id, "user", messageText, "");
            userMessageId = Number(userMsg.lastInsertRowid);
            incrementCharacterTotalTurns(db, ch.id);
          }
          const alternatesJson = JSON.stringify([newVariant]);
          const aiMsg = db
            .prepare(
              "INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, status_widget_values_json, status_widget_turn_active) VALUES (?,?,?,?,?,?,?,?,?)"
            )
            .run(
              chatRef.id,
              "assistant",
              savedText,
              usageRecord.model,
              JSON.stringify(usageRecord),
              alternatesJson,
              0,
              statusWidgetValuesJson,
              statusWidgetTurnActiveFlag
            );
          aiMessageId = Number(aiMsg.lastInsertRowid);
        }

        const nextMode: Route = isAdultMode ? "nsfw" : "safe";
        const nextImpersonation = userImpersonation ? 1 : 0;
        const nextTargetChars = targetResponseCharsRef;
        if (
          nextMode !== chatRef.mode ||
          nextImpersonation !== (chatRef.user_impersonation ?? 0) ||
          nextTargetChars !== normalizeTargetResponseChars(chatRef.target_response_chars)
        ) {
          db.prepare(
            "UPDATE chats SET mode=?, user_impersonation=?, target_response_chars=? WHERE id=?"
          ).run(
            nextMode,
            nextImpersonation,
            nextTargetChars,
            chatRef.id
          );
        }

        let balanceAfter = getPointBalance(user.id);
        let deductSlices: DeductionSlice[] = [];
        if (cost > 0) {
          const modelName = usageRecord.modelLabel ?? usageRecord.model ?? "알 수 없음";
          const deducted = deductPoints(
            user.id,
            cost,
            `대화 · ${modelName} (입력토큰 ${totalInput.toLocaleString()} / 출력토큰 ${totalOutput.toLocaleString()})`,
            { messageId: aiMessageId, chatId: chatRef.id }
          );
          balanceAfter = deducted.balance;
          deductSlices = deducted.slices;
          db.prepare("UPDATE messages SET deduction_slices=? WHERE id=?").run(
            JSON.stringify(deductSlices),
            aiMessageId
          );
          try {
            maybeCreditCreatorReward({
              creatorId: ch.creator_id,
              official: ch.official ?? 0,
              characterId: ch.id,
              messageId: aiMessageId,
              consumerUserId: user.id,
              pointsSpent: cost,
            });
          } catch (rewardErr) {
            console.error("[/api/chat] creator reward skipped:", (rewardErr as Error).message);
          }
        }

        if (statusMetaEnabled) {
          scheduleStatusMetaExtraction({
            messageId: aiMessageId,
            chatId: chatRef.id,
            charName: ch.name,
            personaName: personaDisplayName,
            userMessage: messageText,
            assistantProse: savedText,
            userNote: effectiveUserNote,
            formatSpec: statusWindowPolicyRef?.formatSpec ?? null,
            prefilledTableMarkdown: capturedStatusTable,
          });
        }

        send({
          type: "done",
          chatId: chatRef.id,
          messageId: aiMessageId,
          userMessageId,
          mode: nextMode,
          cost,
          totalPointsCost: cost,
          remainingPoints: balanceAfter.total,
          paidPoints: balanceAfter.paid,
          freePoints: balanceAfter.free,
          usage: usageRecord,
          memoryUpdated: true,
          statusMetaPending: statusMetaEnabled,
          statusWidgetActive,
          statusWidgetTurnActive: statusWidgetActive,
          statusWidgetValues: statusWidgetValuesPayload,
          htmlFlashTurn: (htmlVisualCardPolicyRef.enabled || chatOocRpUnrelated) && htmlFlashOnlyTurn,
          showStatusMarkdown: userMessageRequestsStatusWindowOoc(policyUserMessageRef),
          finalContent: savedText,
          ...variantPayload,
        });
        controller.close();

        void (async () => {
          try {
            if (!regenerateMessageId && userMessageId) {
              db.prepare("UPDATE messages SET user_message_id=? WHERE id=?").run(
                userMessageId,
                aiMessageId
              );
            }
            if (regenerateMessageId) {
              recordPreferenceEvent({
                userId: user.id,
                chatId: chatRef.id,
                messageId: aiMessageId,
                eventType: PREFERENCE_EVENT.REGENERATE,
                payload: { variantCount: snapshotVariantCount },
              });
              enqueueScoreRecompute(aiMessageId);
            }
            const contextJson = buildGenerationContextJson({
              promptAudit: built.meta.promptAudit,
              writingStyle: "unified",
              completedTurns: playableTurnCount,
              targetResponseChars: targetResponseCharsRef,
              userImpersonation: !!userImpersonation,
              truncatedMemory: built.meta.truncatedMemory,
              model: usageRecord.model,
              provider: usageRecord.provider ?? billingProvider,
              route: usageRecord.route,
              nsfw: isAdultMode,
              regenerate: !!regenerateMessageId,
              variantIndex: snapshotVariantIndex,
            });
            recordGenerationSnapshot({
              messageId: aiMessageId,
              chatId: chatRef.id,
              userId: user.id,
              characterId: ch.id,
              variantIndex: snapshotVariantIndex,
              userMessageId,
              model: usageRecord.model,
              provider: usageRecord.provider ?? billingProvider,
              route: usageRecord.route,
              writingStyle: "unified",
              nsfw: isAdultMode ? 1 : 0,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              promptHash: computePromptHash(contextJson),
              contextJson,
            });
            await scheduleMemoryUpdate({
              chatId: chatRef.id,
              userId: user.id,
              characterId: ch.id,
              relationshipNames,
              tier: memoryTier,
              memoryCapacity: getChatMemoryCapacity(chatRef.id),
              userMessage: messageText,
              assistantMessage: savedText,
              assistantMessageId: aiMessageId,
              isRegenerate: !!regenerateMessageId,
              previousAssistantMessage: rejectedAssistantDraft ?? undefined,
              route: nextMode,
              relationshipTailParsed,
              relationshipDeltaFromMain,
            });
          } catch (e) {
            console.error("[/api/chat] 후처리 실패:", (e as Error).message);
          }
        })();
      } catch (e) {
        console.error("[/api/chat] SSE 파이프라인 오류:", (e as Error).message);
        if (e instanceof GeminiTrafficOverloadError) {
          sendTrafficOverloadGracefulStream(send);
        } else if (e instanceof DegenerationAbortError) {
          send({ type: "reset" });
          send({ type: "error", error: DEGENERATION_USER_MESSAGE });
        } else {
          send({ type: "error", error: formatClientApiError(e, "Chat pipeline failed") });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
