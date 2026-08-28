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
import { normalizeProseLineEndings } from "@/lib/canonicalProse";
import { loadCharacterChunks, loadCharacterChunksForPrompt } from "@/lib/characterChunks";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import { resolveCanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { ensureCanonPlanOnAccess } from "@/lib/canonPlan/lazyCompile";
import {
  computeCanonShadowTurnRecord,
  logCanonShadowTurnRecord,
  shouldRunCanonInjectionSideEffects,
} from "@/lib/canonPlan/shadowD0";
import { buildContext } from "@/services/contextBuilder";
import { resolveNarrativePov } from "@/lib/narrativePov";
import { auditAssembledPrompt, formatPromptAuditLog } from "@/services/promptAudit";
import { invalidateModelPickerInputSnapshot } from "@/services/modelPickerInputSnapshot";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import { deductPoints, getPointBalance, MIN_POINTS_TO_CHAT, computeTurnBilling, computeHtmlFlashOnlyTurnBilling, billableOutputTokens, billableOutputChars, shouldWaiveTurnBilling, isIncompleteStreamUsageUnavailable, resolveDeepSeekWaiverMinimumCharge, resolveQwenWaiverMinimumCharge, resolveGlmWaiverMinimumCharge, resolveKimiWaiverMinimumCharge, resolveMuseWaiverMinimumCharge, resolveGemini36WaiverMinimumCharge, resolveGemini31WaiverMinimumCharge, selectBillableStages, sumOpenRouterStageOutputTokens, sumOpenRouterStageReasoningTokens, sumOpenRouterStageUpstreamUsd, billableOpenRouterOutputTokens, resolveTurnBillableInput, explainOpenRouterOpusTurnCost, explainOpenRouterDeepSeekTurnCost, explainOpenRouterGeminiTurnCost, type DeductionSlice } from "@/lib/points";
import { createChatSession } from "@/lib/chatSessionCreate";
import { incrementCharacterTotalTurns } from "@/lib/characterEngagementStats";
import {
  bootstrapStreamingTurn,
  createDisconnectSafeSend,
  createPartialSaveThrottler,
  findTurnByRequestId,
  finalizeAssistantMessage,
  logStreamingPersistence,
  markAssistantFailed,
  markAssistantInterrupted,
  normalizeClientRequestId,
  persistStreamCompleteContent,
  restoreAssistantFromAlternatesOnFailedRegen,
  type StreamingPersistenceDiag,
} from "@/lib/streamingPersistence";
import { executeAtomicRegenerationFinalize } from "@/lib/personaSecretRegenerationFinalize";
import { hashForensicsText, logStreamTurnForensics } from "@/lib/streamTurnForensics";
import { createStreamPostprocessHeartbeat } from "@/lib/streamPostprocessHeartbeat";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, CHEAPER_INFERENCE_GLM_52_MODEL, isCheaperInferenceModel, isCheaperInferenceQwen38MaxModel, isDeepSeekV4ProModel, isGemini36FlashModel, isGemini31ProModel, isGlmModel, isGpt56TerraModel, isKimiModel, isMuseModel, isQwenModel, selectedAIProvider, type SelectedAI } from "@/lib/chatModels";
import { resolveDeepSeekAdultHandoffTrueOff } from "@/lib/cheaperInferenceConfig";
import { openRouterNormalizedRawCostKrw, openRouterRawCostKrw } from "@/lib/billingRawCost";
import type { Gemini37FlashPricingBreakdown } from "@/lib/gemini37FlashPricing";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { maybeCreditCreatorReward, paidCreatorRewardSpend } from "@/lib/creatorPoints";
import { TurnApiBudget, NARRATIVE_LENGTH_CONTINUATION_ENABLED } from "@/lib/turnApiBudget";
import {
  classifyMuseAcceptance,
  logMuseAcceptanceTelemetry,
  shouldRecordMuseAcceptanceTelemetry,
  stripMuseAcceptanceFromUsage,
  toMuseAcceptanceUsageFields,
  type MuseOwnershipTelemetry,
} from "@/lib/museAcceptanceTelemetry";
import { maybeRewriteNarrationLexicon } from "@/lib/speechLock";
import { isMockApiMode, logMockModeOnce } from "@/lib/mockApiMode";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import { parseAssets, chatAssets } from "@/lib/characterAssets";
import { sanitizeEmotionTagInText, stripEmotionTagsForDisplay } from "@/lib/emotionTag";
import { sanitizeCharacterGenres } from "@/lib/characterGenres";
import { formatCharacterIdentityForBackground, resolveCharacterGender } from "@/lib/characterGender";
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
import { buildSceneMomentumInputFromRoute } from "@/lib/sceneMomentum/routeInput";
import {
  buildSceneMomentumProductionTelemetry,
  logSceneMomentumProductionTelemetry,
  shouldLogSceneMomentumProductionTelemetry,
} from "@/lib/sceneMomentum/productionTelemetry";
import { resolveRelationshipMetaNames } from "@/lib/relationshipMetaCharacterName";
import {
  messagesToTurns,
  countPlayableTurns,
  rawRecentTurnsToHistory,
  selectLongerHistorySuffix,
  ROLLING_SUMMARY_INTERVAL,
} from "@/lib/hybridMemory";
import { resolveHistoryTokenBudget } from "@/lib/contextTrack";
import {
  filterOutMessageIds,
  purgeOrphanUserMessages,
} from "@/lib/chatMessageHygiene";
import {
  buildRegenerationContextTrace,
  logRegenerationContextTrace,
  resolveRegenerationContextBoundary,
} from "@/lib/regenerationContext";
import {
  buildMemoryContextForChat,
  buildMemoryContextForPreview,
  resolveMemoryTier,
  scheduleMemoryUpdate,
} from "@/lib/memory/memory-manager";
import { ensureSummaryBarrier } from "@/lib/memory/memory-rolling-summary";
import { gateChatOnSummaryBarrier } from "@/lib/memory/memory-barrier-route-gate";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "@/lib/memory/memory-constants";
import {
  buildMemoryHealthTelemetry,
  logMemoryHealthTelemetry,
} from "@/lib/memory/memory-health-telemetry";
import {
  analyzeProviderHistoryHealth,
  countRealPlayableHistoryTurns,
  resolveProviderHistoryTurnFloor,
  trimProviderHistoryToBudget,
} from "@/lib/providerHistoryPolicy";
import {
  shouldIncludeOpeningInProviderRaw,
  splitOpeningPlayableTurns,
} from "@/lib/hybridMemory";
import { syncMemoryFromChat } from "@/lib/memory/memory-backfill";
import { reconcileMemoryCoverageFixedPoint } from "@/lib/memoryCoverageReconcile";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { countMemoryEligibleCompletedTurns } from "@/lib/memory/memory-turn-loader";
import {
  CHAT_MESSAGE_MAX,
  selectedAILabel,
} from "@/lib/chatModels";
import { getUserChatSelectedAI } from "@/lib/userSelectedAI";
import { stripRuntimePromptContaminationFromVisibleOutput } from "@/lib/runtimePromptContaminationGuard";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
  type SceneProgressionType,
} from "@/lib/sceneDirective";
import {
  buildLivingSceneDirective,
  renderLivingSceneDirectiveForPrompt,
  type LivingProgressionType,
} from "@/lib/livingSceneDirective";
import { isLivingSceneDirectiveV2EnabledForUser } from "@/lib/livingSceneDirectivePolicy";
import {
  applyTerraPromptCanaryToHistory,
  applyTerraPromptCanaryToSceneDirectiveBlock,
  canaryAppliesCardDialogueNeutral,
  canaryAppliesDialogueIntentUnitLayout,
  DIALOGUE_LAYOUT_OWNER_KO_CANARY,
  DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION,
  extractGreetingFromHistory,
  lockSceneDirectiveToRelationshipAxis,
  logTerraPromptCanaryDebug,
  resolveCanarySceneProgressionAxis,
  resolveCanaryTerraTerminalContract,
  resolveTerraPromptCanary,
  resolveTerraPromptCanaryTemperature,
  shouldRelocateSceneDirectiveToUserTurn,
  type SceneProgressionAxis,
  type TerraPromptCanaryResolution,
} from "@/lib/terraPromptCanary";
import {
  applyRpDiagnosticToHistory,
  applyRpDiagnosticToSceneDirectiveBlock,
  buildRpDiagnosticIntegrity,
  capturePostprocessPipeline,
  logRpDiagnosticCanaryDebug,
  resolveRpDiagnosticCanary,
  resolveRpDiagnosticProgressionAxis,
  rpDiagnosticBypassParagraphNormalize,
  rpDiagnosticBypassDisplayGrouping,
  rpDiagnosticEnablesPipelineCapture,
  shouldRelocateRpDiagnosticSceneDirective,
  type RpDiagnosticCanaryResolution,
} from "@/lib/rpDiagnosticCanary";
import { runWithDiagnosticContext } from "@/lib/diagnosticRequestContext.server";
import {
  normalizeAiNovelProseLayout,
  normalizeAiNovelProsePreDisplay,
  applyDisplayParagraphGrouping,
} from "@/lib/novelParagraphs";
import {
  buildSceneDirectiveV2,
  buildSceneDirectiveV2Telemetry,
  getUpdatedReconvergenceStateFromBuild,
  logSceneDirectiveV2Telemetry,
  renderSceneDirectiveV2ForPrompt,
} from "@/lib/sceneDirectiveV2";
import {
  getSceneDirectiveV2Mode,
  isSceneDirectiveV2ComputeEnabled,
  isSceneDirectiveV2InjectEnabled,
  resolveScenePacingPromptOwner,
} from "@/lib/sceneDirectiveV2Policy";
import {
  commitReconvergenceTransition,
  loadReconvergenceState,
  prepareReconvergenceTransition,
  type PendingReconvergenceTransition,
} from "@/lib/reconvergenceState";
import { extractSimulationCastNames } from "@/lib/simulationMode";
import {
  commitSceneProgressionState,
  loadSceneProgressionState,
} from "@/lib/sceneProgressionState";
import { deriveGenerationPreparationUi } from "@/lib/generationPreparationUi";
import { isMeteredReceiptProvider, stealthReceiptModelFields } from "@/lib/billingDisplay";
import {
  buildLorebookActivationText,
  loadKeywordLorebookPromptBlockFromActivation,
} from "@/lib/keywordLorebooks";
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
import {
  buildOpenRouterCacheReceiptInfo,
  resolveOpenRouterRateSummary,
} from "@/lib/openRouterModelPricing";
import { estimateUserContextChars } from "@/lib/userContextBilling";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { validateUserNoteCombined, userNoteCombinedCharCount, parseUserNoteCombined, extractFocusZoneNote } from "@/lib/userNoteStatusWindow";
import { resolveStatusWidgetReservedChars } from "@/lib/statusWidget";
import { splitAndNormalizeRelationshipMemoryTail } from "@/lib/relationshipMemoryTail";
import { parseUserChatPrefs } from "@/lib/userChatPrefs";
import {
  ensureDefaultPublicPersona,
  formatSelectedPersonaIdentityForBackground,
  getPersonaSecretPayload,
  resolveChatSelectedPersona,
  validatePersonaSelection,
} from "@/lib/userPersonas";
import {
  isPersonaSecretBoundaryEnabled,
  isPersonaSecretDiscoveryEnabled,
} from "@/lib/personaSecretBoundaryPolicy";
import { isPersonaSecretS4LiveProducerEnabled } from "@/lib/personaSecretS4LiveProducerPolicy";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { splitPersonaSecretItems } from "@/lib/personaSecretItems";
import {
  buildRevealedPersonaFactsBlockForPersona,
  detectUserAuthoredPersonaSecretReveals,
  listChatPersonaSecretReveals,
  persistPersonaSecretRevealCandidates,
  type PersonaSecretRevealCandidate,
} from "@/lib/personaSecretReveal";
import {
  buildDeterministicDisclosureIdempotencyKey,
  confirmPersonaSecretDisclosure,
  detectDeterministicDirectDisclosures,
} from "@/lib/personaSecretDirectDisclosure";
import {
  buildPersonaKnowledgeWithS4ForTurn,
  isS4LiveProducerTurnAllowed,
  type S4GenerationTransferContext,
} from "@/lib/s4GenerationTransfer/context";
import { commitAcceptedAssistantS4Transfers } from "@/lib/s4GenerationTransfer/commit";
import { stripS4ServerControlFromText } from "@/lib/controlChannel/serverControlStrip";
import {
  buildGenerationKnowledgeContext,
  personaKnowledgePromptDecisionMeta,
  resolvePersonaKnowledgePromptDecisionForChat,
  withEnsembleRedactedPromptAssembly,
  type PersonaKnowledgePromptDecision,
} from "@/lib/personaKnowledgePromptPolicy";
import {
  extractAndPersistSceneEvidence,
  parseSceneEvidenceExplicitActions,
} from "@/lib/sceneEvidence";
import { runHomeDiscoveryTurn } from "@/lib/personaSecretDiscoveryHomeTurn";
import { runKnowledgeTransfersForTurn } from "@/lib/knowledgeTransfer";
import { extractPublicChatDiscoveryInputs } from "@/lib/personaSecretDiscoveryPublicInput";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { applyScenePresenceActions } from "@/lib/scenePresenceActions";
import { resolveUserImpersonationAllowance } from "@/lib/userImpersonationPolicy";
import { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } from "@/lib/currentTurnUserAuthoringDelegation";
import {
  persistUserCoauthorAfterSuccessfulUserInsert,
  readUserCoauthorMode,
  resolveEffectiveUserAuthoring,
  resolveEffectiveUserAuthoringForRegeneration,
  resolveEffectiveUserAuthoringFromChatColumn,
} from "@/lib/userCoauthorState";
import { resolveChatRuntimeMode } from "@/lib/chatRuntimeMode";
import {
  detectInteractiveUserImpersonation,
  isUserImpersonationAutoRepairEnabled,
  logOwnershipShadowGuardV2,
  logUserImpersonationGuard,
  runOwnershipShadowGuardV2,
} from "@/lib/userImpersonationGuard";
import {
  detectUserPovTakeover,
  logUserPovTakeover,
} from "@/lib/userPovTakeoverDetector";
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
  type MessageVariant,
} from "@/lib/messageAlternates";
import { DegenerationAbortError, MetaLeakageAbortError, DEGENERATION_USER_MESSAGE, isDegenerateOutput, getDegenerationReason, stripUnexpectedForeignScriptLeak } from "@/lib/gibberishGuard";
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
import { stripRepeatedTrailingQuoteMarks } from "@/lib/trailingQuoteSanitizer";
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
import { buildEstimatedReceiptSectionBreakdown } from "@/lib/billingReceiptSectionBreakdown";
import {
  BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL,
  canShowFullBillingReceipt,
  sanitizeUsageForPublicReceipt,
  stripAdultRoutingForClient,
} from "@/lib/billingReceiptAccess";
import { scheduleStatusMetaExtraction, markMessageStatusMetaPending } from "@/lib/statusMeta/job";
import {
  scheduleSuggestedRepliesExtraction,
  markMessageSuggestedRepliesPending,
} from "@/lib/suggestedReplies/job";
import { resolveStatusMetaExtractionEnabled } from "@/lib/statusMeta/displayPolicy";
import {
  applyStatusWidgetSystemPromptOverrides,
  parseStatusWidgetJson,
  patchOpenRouterSplitForStatusWidget,
  resolveStatusWidgetTurn,
  resolveStatusWidgetEngineStatusKeys,
  serializeStatusWidgetValuesJson,
  statusWidgetValuesHasContent,
} from "@/lib/statusWidget";
import {
  creatorTriggerValuesFromPayload,
  shouldEvaluateCreatorStatusTriggers,
} from "@/lib/statusWidget/creatorTriggerEvaluation";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";
import {
  logStatusWidgetTurnTelemetry,
  resolveStatusWidgetTurnValues,
} from "@/lib/statusWidget/telemetry";
import {
  diagnoseStatusWidgetValues,
  logStatusWidgetLiveTrace,
  statusWidgetDiagnosticHash,
} from "@/lib/statusWidget/diagnostics";
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
  buildChatOocSceneResetUserPrompt,
  chatOocSuppressesUserNoteExtras,
  classifyChatOocIntent,
  extractOocRoutingText,
  isChatOocRpContinuing,
  isChatOocSceneReset,
} from "@/lib/chatOocPriority";
import {
  buildOocSceneRenderUserPrompt,
  filterCanonicalMessageRows,
  isCanonAdoptedScene,
  isOocSceneRenderSemantics,
  mergeGenerationSemantics,
  nextPersistedModelRouteState,
  persistGenerationSemanticsOnMessages,
  readGenerationSemantics,
  readOocSceneClientFlags,
  resolveGenerationSemantics,
  shouldCommitCanonicalTurnState,
  OOC_CANON_ADOPTION_COPY,
  type GenerationSemantics,
} from "@/lib/oocSceneRender";
import {
  streamOpenRouterAdultToClient,
  convertToOpenRouterFormat,
} from "@/lib/openRouterAdult";
import {
  buildTerraInstructions,
  isRetryableTerraFinishReason,
} from "@/lib/openAiResponsesClient";
import { formatClientApiError } from "@/lib/apiErrors";
import { refreshCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing.server";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveRegenerateGenerationOverrides } from "@/lib/openRouterClient";
import { sanitizePrimaryModelAssistantHistory } from "@/lib/flashOwnedOutputFirewall";
import {
  getEpisodicMemoryForPrompt,
  logStatusMemoryPipelineDev,
  summarizeEpisodicFactPersistCandidates,
} from "@/lib/episodicMemoryFacts";
import { stripExtractedFactsForClient } from "@/lib/statusWidget/parseValues";
import {
  buildTriggeredScenarioEventsPromptBlock,
  evaluateStatusWidgetTriggersBestEffort,
  loadQueuedStatusTriggerEventsForPrompt,
  markStatusTriggerEventsConsumed,
} from "@/lib/statusWidgetTriggers";
import {
  hasLaterCanonicalTurn,
  isCanonicalDerivedStateGenerationStatus,
  supersedeStatusTriggerEventsForSourceMessage,
} from "@/lib/rpDerivedStateLifecycle";
import {
  evaluateNumericRegenChainReadiness,
  executeAtomicNumericAssistantFinalize,
  listCanonicalEligibleNumericFields,
  resolveNumericCanonicalEligibility,
} from "@/lib/rpNumericState";
import { loadPreviousStatusWidgetValues } from "@/lib/statusWidget/loadPrevious";
import {
  buildPrivateSpeechControlBlock,
  parseCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import {
  advanceModelRouteState,
  appendAdultHandoffPrompt,
  appendAdultHandoffToSystemSplit,
  buildCharacterParticipantIdentityDescription,
  buildAdultProviderRoutingRequest,
  buildGeneralProviderContext,
  boundCanonicalRouteHistoryForProvider,
  buildGeneralRouteBridge,
  buildSceneContinuityPacket,
  classifySceneMode,
  createInitialStreamBuffer,
  decideAdultModelRoute,
  detectClearSceneTransition,
  detectModelRefusal,
  extractHandoffContinuityFromAssistantText,
  hasNewlyEstablishedSexualContext,
  normalizeAdultDialogueProfile,
  parseModelRouteState,
  parseAllowedConsentModes,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
  selectAdultHandoffRawVariants,
  serializeModelRouteState,
  type ActiveModelRoute,
  type CanonicalRouteHistoryMessage,
  type SceneMode,
} from "@/lib/adultSceneRouting";
import {
  invokePreparedAdultRefusalFallback,
  resolveAdultDeliveryPlan,
} from "@/lib/adultDeliveryPlan";
import {
  isAllowedAdultHandoffTargetModel,
  resolveAdultRefusalFallbackModelId,
} from "@/lib/adultHandoffSourceRouting";
import {
  canUseAdultSceneHandoffAdminCanary,
  detectAdultSceneHandoffPromptLeak,
  recordAdultSceneHandoffCanaryLog,
  resolveAdultSceneHandoffCanaryConfig,
  resolveAdultSceneHandoffCanaryStage,
  resolveAdultSceneRoutingEnabledForRequest,
} from "@/lib/adultSceneHandoffCanary";
import { isAdminUser } from "@/lib/isAdminUser";
import { effectiveIsAdult } from "@/lib/adultVerification";
import {
  parseAdultHandoffEnabled,
  resolveChatAdultHandoffEnabled,
} from "@/lib/chatAdultHandoff";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export const dynamic = "force-dynamic";

function sseEncode(obj: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function resolveIsAdultMode(input: unknown, chatMode: string): boolean {
  if (input === true || input === "true" || input === 1 || input === "1") return true;
  if (input === false || input === "false" || input === 0 || input === "0") return false;
  return chatMode === "nsfw";
}

function parseMessageIdInput(input: unknown): number | null {
  if (typeof input === "number" && Number.isInteger(input) && input > 0) return input;
  if (typeof input !== "string") return null;
  const n = Number(input.trim().replace(/^msg-/i, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const { characterId, chatId, message, userNote, selectedPersonaId } = body;
  const regenerate = body.regenerate === true;
  const isContinue = body.isContinue === true;
  const clientRequestId =
    normalizeClientRequestId(body.clientRequestId ?? body.requestId) ??
    `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const isAdultModeInput =
    body.isAdultMode ?? body.isNsfwMode ?? body.nsfwMode;
  const targetResponseCharsInput = body.targetResponseChars ?? body.targetResponseLength;
  const targetAssistantMessageIdInput = parseMessageIdInput(
    body.targetAssistantMessageId ?? body.regenerateMessageId ?? body.messageId
  );

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
  const variantClientOpts = {
    keepInternalAdultRouting: showFullBillingReceipt,
  };
  const userNoteRow = db
    .prepare("SELECT user_note, chat_prefs FROM users WHERE id=?")
    .get(user.id) as { user_note: string; chat_prefs: string };
  const accountChatPrefs = parseUserChatPrefs(userNoteRow?.chat_prefs);
  const userNoteInput =
    typeof userNote === "string" ? userNote.trim() : undefined;
  const personas = ensureDefaultPublicPersona(user.id, user.nickname);
  const requestedPersonaId =
    selectedPersonaId != null && selectedPersonaId !== ""
      ? Number(selectedPersonaId)
      : null;

  const ch = db.prepare("SELECT * FROM characters WHERE id = ?").get(characterId) as {
    id: number;
    name: string;
    description: string;
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
    speech_profile?: string | null;
    speech_personality?: string | null;
    speech_traits?: string | null;
    creator_compiled_description_json?: string | null;
    content_kind?: "character" | "simulation" | null;
    simulation_cast?: string | null;
    adult_dialogue_profile?: string | null;
    adult_status?: string | null;
    participant_min_age?: number | null;
    adult_consent_modes_json?: string | null;
  } | undefined;
  if (!ch) return Response.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });

  if (ch.nsfw && !user.is_adult) {
    return Response.json({ error: "성인용 캐릭터는 성인인증 후 이용할 수 있습니다.", needVerify: true }, { status: 403 });
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
            narrative_pov?: string;
            pov_character_name?: string;
            model_route_state_json?: string;
            adult_handoff_enabled?: number;
          }
        | undefined)
    : undefined;

  /** 전역 선택이 소스 오브 트루스 — body/chat.gemini_model은 라우팅에 사용하지 않음 */
  const isAdminForChat = isAdminUser({
    email: user.email,
    is_admin: userAdminRow?.is_admin ?? 0,
  });
  const selectedAI = getUserChatSelectedAI(db, user.id, { isAdmin: isAdminForChat });

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
    const newChatId = createChatSession({
      userId: user.id,
      characterId: ch.id,
      greeting: ch.greeting,
      mode: initialMode,
      userNote: userNoteInput ?? "",
      selectedPersonaId: initialPersonaId,
      targetResponseChars: initialTargetChars,
      adultHandoffEnabled: resolveChatAdultHandoffEnabled({
        requested: body.adultHandoffEnabled ?? body.adult_handoff_enabled,
        userAdultVerified: effectiveIsAdult(user.is_adult),
      }),
    });
    chat = db.prepare("SELECT * FROM chats WHERE id=? AND user_id=?").get(newChatId, user.id) as typeof chat;
  } else {
    /** Legacy mirror on this chat only (no bulk update). Never read back for routing. */
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

  const personaSecretBoundaryOn = isPersonaSecretBoundaryEnabled({ userId: user.id });
  const personaSecretDiscoveryOn = isPersonaSecretDiscoveryEnabled({
    userId: user.id,
  });
  const personaSecretAuthority = personaSecretDiscoveryOn ? "discovery" : "legacy";

  // PR-S4A: lazy bootstrap main character observer + active scene (idempotent).
  // Discovery kill switch — no observer/scene writes when OFF.
  if (personaSecretDiscoveryOn) {
    bootstrapChatObservers({
      chatId: chat.id,
      characterId: ch.id,
      displayName: typeof ch.name === "string" ? ch.name : "",
      turnNumber: 0,
      userId: user.id,
    });
  }

  if (userNoteInput !== undefined) {
    const widgetReserved = resolveStatusWidgetReservedChars({
      characterWidgetJson: (ch as { status_widget_json?: string }).status_widget_json,
      chatMode: (chat as { status_widget_mode?: string }).status_widget_mode,
      userWidgetJson: (chat as { user_status_widget_json?: string }).user_status_widget_json,
      stackOrder: (chat as { status_widget_stack_order?: string }).status_widget_stack_order,
      displayMode: (chat as { status_widget_display_mode?: string }).status_widget_display_mode,
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
  // Legacy novelModeEnabled (body or saved prefs) → autoContinue compatibility.
  // Never inject `[USER CONTROL MODE - NOVEL / EXPLICIT FULL]`.
  const legacyNovelModeEnabled =
    body.novelModeEnabled === true || accountChatPrefs?.novelModeEnabled === true;
  const novelModeEnabled = false;
  const autoProgressionEnabled = isContinue === true || legacyNovelModeEnabled;

  if (isAdultMode && !user.is_adult) {
    return Response.json(
      { error: "성인용 콘텐츠는 성인인증 후 이용할 수 있습니다.", needVerify: true },
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

  const personaDescription = toPublicPersonaDescription(selectedPersona?.description ?? "");
  const personaDisplayName = selectedPersona?.name?.trim() || user.nickname;
  const userNotePrompt = formatUserNoteForPrompt(effectiveUserNote);
  const oocUserImpersonationAllowed = resolveUserImpersonationAllowance({
    personaDescription,
    userNote: extractFocusZoneNote(effectiveUserNote),
  });
  // Auto progression uses limited_external agency — not full impersonation / possession.
  const userImpersonation = oocUserImpersonationAllowed;
  const currentTurnDelegation = autoProgressionEnabled
    ? INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION
    : resolveEffectiveUserAuthoring({
        persistentMode: readUserCoauthorMode(db, chat.id),
        currentUserInput: typeof message === "string" ? message : "",
      }).delegation;
  let runtimeMode = resolveChatRuntimeMode({
    isContinue: isContinue === true,
    legacyNovelModeEnabled,
    oocUserImpersonationAllowed,
    currentTurnDelegationActive:
      !oocUserImpersonationAllowed && currentTurnDelegation.active,
  });
  let userPersonaPrompt = formatPublicPersonaForPrompt(
    personaDisplayName,
    selectedPersona?.gender ?? "other",
    personaDescription,
    {
      coNarrationEnabled:
        autoProgressionEnabled ||
        novelModeEnabled ||
        oocUserImpersonationAllowed ||
        currentTurnDelegation.active,
    }
  );
  const backgroundPersonaIdentity = formatSelectedPersonaIdentityForBackground(
    personaDisplayName,
    selectedPersona?.gender ?? "other"
  );
  const backgroundCharacterIdentity = formatCharacterIdentityForBackground(
    ch.name,
    resolveCharacterGender(ch.gender)
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
      .prepare(
        "SELECT id, role, content, model, user_message_id FROM messages WHERE chat_id=? ORDER BY id ASC"
      )
      .all(chat.id) as {
      id: number;
      role: string;
      content: string;
      model: string;
      user_message_id: number | null;
    }[];

    const regenBoundary = resolveRegenerationContextBoundary(
      allRows as Array<{
        id: number;
        role: "user" | "assistant";
        content: string;
        model?: string;
        user_message_id?: number | null;
      }>,
      targetAssistantMessageIdInput
    );

    if (!regenBoundary) {
      return Response.json({ error: "재생성할 AI 답변이 없습니다." }, { status: 400 });
    }

    regenerateMessageId = regenBoundary.targetAssistant.id;
    rejectedAssistantDraft =
      regenBoundary.targetAssistant.content.trim() || null;
    regenAttemptId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    messageText = regenBoundary.parentUser.content;
    userMessageId = regenBoundary.parentUser.id;
    skipUserInsert = true;

    // Phase B1-C / B1-C.1: numeric regen gates — fail closed BEFORE model API,
    // billing, background extractor, and streaming placeholder mutation.
    {
      const earlyCharacterWidget = parseStatusWidgetJson(
        (ch as { status_widget_json?: string }).status_widget_json
      );
      const numericRegenEligibility = resolveNumericCanonicalEligibility({
        userId: user.id,
        characterId: ch.id,
      });
      const numericEligibleFields =
        listCanonicalEligibleNumericFields(earlyCharacterWidget);
      if (numericRegenEligibility.eligible && numericEligibleFields.length > 0) {
        if (hasLaterCanonicalTurn(db, chat.id, regenerateMessageId)) {
          return Response.json(
            {
              error: "이 대화는 과거 턴 재생성을 지원하지 않습니다.",
              code: "numeric_state_historical_replay_unsupported",
            },
            { status: 409 }
          );
        }
        // Latest regen: require tip-aligned numeric event chain (no legacy
        // ledger reconstruction). Distinct from historical_replay_unsupported.
        const chainGate = evaluateNumericRegenChainReadiness({
          db,
          chatId: chat.id,
          regenerateMessageId,
          fields: numericEligibleFields,
        });
        if (!chainGate.ok) {
          return Response.json(
            {
              error: chainGate.error,
              code: chainGate.code,
            },
            { status: 409 }
          );
        }
      }
    }

    logRegenerationContextTrace(
      buildRegenerationContextTrace({
        requestId: clientRequestId,
        chatId: chat.id,
        rows: allRows as Array<{
          id: number;
          role: "user" | "assistant";
          content: string;
          model?: string;
          user_message_id?: number | null;
        }>,
        targetAssistantId: regenerateMessageId,
        boundary: regenBoundary,
        currentInputWrapperSource: "parent_user_message",
        clientDraftPresent: typeof message === "string" && message.trim().length > 0,
      })
    );

    const regenStatusPolicy = resolveStatusWindowPolicyFromSources({
      userNote: effectiveUserNote || undefined,
      userPersona: userPersonaPrompt ?? undefined,
      userMessage: messageText,
    });
    if (regenStatusPolicy.everyTurn && regenStatusPolicy.formatSpec) {
      markMessageStatusMetaPending(regenerateMessageId, regenStatusPolicy.formatSpec);
    }
    markMessageSuggestedRepliesPending(regenerateMessageId);
  }

  const msgRowsWithId = db
    .prepare(
      "SELECT id, role, content, model, usage, adult_route_meta_json, generation_status, user_message_id FROM messages WHERE chat_id=? ORDER BY id ASC"
    )
    .all(chat.id) as {
    id: number;
    role: "user" | "assistant";
    content: string;
    model: string;
    usage?: string | null;
    adult_route_meta_json?: string | null;
    generation_status?: string | null;
    user_message_id?: number | null;
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
  const regenerationBoundaryForHistory =
    regenerateMessageId != null
      ? resolveRegenerationContextBoundary(
          msgRowsWithId as Array<{
            id: number;
            role: "user" | "assistant";
            content: string;
            model?: string | null;
            usage?: string | null;
            adult_route_meta_json?: string | null;
            user_message_id?: number | null;
          }>,
          regenerateMessageId
        )
      : null;
  const storedUserMessage = messageText;
  const generationSemantics: GenerationSemantics = resolveGenerationSemantics({
    userMessage: storedUserMessage,
    inherited:
      regenerateMessageId != null
        ? readGenerationSemantics(
            msgRowsWithId.find((row) => row.id === regenerateMessageId)?.usage
          )
        : null,
  });
  const oocSceneRenderTurn = isOocSceneRenderSemantics(generationSemantics);
  if (regenerateMessageId != null) {
    const regenRow = msgRowsWithId.find((row) => row.id === regenerateMessageId);
    if (isCanonAdoptedScene(regenRow?.usage)) {
      return Response.json(
        {
          error: OOC_CANON_ADOPTION_COPY.regenBlocked,
          code: "ooc_canon_adopted_regen_blocked",
        },
        { status: 409 }
      );
    }
  }
  const msgRowsSource = filterCanonicalMessageRows(
    regenerationBoundaryForHistory
      ? regenerationBoundaryForHistory.historyRows
      : filterOutMessageIds(msgRowsWithId, [...regenerateHistoryDropIds])
  );
  const msgRows = msgRowsSource.map(
    ({ role, content, model, usage }) => ({
      role,
      content,
      model: model ?? undefined,
      usage,
    })
  );
  const dialogueTurns = messagesToTurns(msgRows);
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  const personaUsesBanmal = personaUsesInformalSpeech(selectedPersona?.description ?? "");
  const autoContinueContext =
    autoProgressionEnabled ||
    (regenerate && isContinueUserMessage(storedUserMessage));
  const effectiveUserAuthoring = autoContinueContext
    ? null
    : regenerate && userMessageId != null
      ? resolveEffectiveUserAuthoringForRegeneration(db, chat.id, userMessageId)
      : resolveEffectiveUserAuthoringFromChatColumn(db, chat.id, storedUserMessage);
  const currentTurnDelegationForTurn = effectiveUserAuthoring
    ? effectiveUserAuthoring.delegation
    : INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION;
  runtimeMode = resolveChatRuntimeMode({
    isContinue: isContinue === true || (regenerate && isContinueUserMessage(storedUserMessage)),
    legacyNovelModeEnabled,
    oocUserImpersonationAllowed: !autoContinueContext && oocUserImpersonationAllowed,
    currentTurnDelegationActive:
      !autoContinueContext &&
      !oocUserImpersonationAllowed &&
      currentTurnDelegationForTurn.active,
  });
  userPersonaPrompt = formatPublicPersonaForPrompt(
    personaDisplayName,
    selectedPersona?.gender ?? "other",
    personaDescription,
    {
      coNarrationEnabled:
        autoContinueContext ||
        novelModeEnabled ||
        oocUserImpersonationAllowed ||
        currentTurnDelegationForTurn.active,
    }
  );
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
  const htmlFlashOnlyTurn =
    chatOocRpUnrelated || isHtmlFlashOnlyTurn(storedUserMessage);
  const promptUserMessage = oocSceneRenderTurn
    ? buildOocSceneRenderUserPrompt(displayUserMessage)
    : autoContinueContext
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
            coNarrationEnabled:
              autoContinueContext || novelModeEnabled || userImpersonation,
            rejectedAssistantDraft,
            regenAttemptId,
            targetResponseChars,
          })
      : isChatOocSceneReset(storedUserMessage)
        ? buildChatOocSceneResetUserPrompt(displayUserMessage)
        : isChatOocRpContinuing(storedUserMessage)
        ? buildChatOocRpContinuingUserPrompt(displayUserMessage)
        : displayUserMessage;

  const baseAdultRoutingConfig = resolveAdultRoutingConfig();
  const handoffCanaryConfig = resolveAdultSceneHandoffCanaryConfig();
  const isAdminForHandoffCanary = isAdminUser({
    email: user.email,
    is_admin: userAdminRow?.is_admin ?? 0,
  });
  const adultHandoffCanaryAccess = canUseAdultSceneHandoffAdminCanary({
    config: handoffCanaryConfig,
    isAdmin: isAdminForHandoffCanary,
    userId: user.id,
    chatId: chat.id,
  });
  const userAdultVerified = effectiveIsAdult(user.is_adult);
  const chatAdultHandoffEnabled = resolveChatAdultHandoffEnabled({
    persisted: chat.adult_handoff_enabled,
    requested: body.adultHandoffEnabled ?? body.adult_handoff_enabled,
    userAdultVerified,
  });
  if (
    parseAdultHandoffEnabled(body.adultHandoffEnabled ?? body.adult_handoff_enabled) !==
    undefined
  ) {
    db.prepare("UPDATE chats SET adult_handoff_enabled=? WHERE id=?").run(
      chatAdultHandoffEnabled ? 1 : 0,
      chat.id
    );
    chat.adult_handoff_enabled = chatAdultHandoffEnabled ? 1 : 0;
  }
  const adultRoutingConfig = {
    ...baseAdultRoutingConfig,
    enabled: resolveAdultSceneRoutingEnabledForRequest({
      generalEnabled: handoffCanaryConfig.generalEnabled,
      adminCanaryAccess: adultHandoffCanaryAccess,
      chatAdultHandoffEnabled,
    }),
  };
  const priorModelRouteState = parseModelRouteState(chat.model_route_state_json);
  const activeAdultModelId = resolveAdultRefusalFallbackModelId(selectedAI);
  const allowedConsentModes = parseAllowedConsentModes(ch.adult_consent_modes_json);
  const preOocIntent = classifyChatOocIntent(storedUserMessage);
  const preSceneReset = preOocIntent === "rp_scene_reset";
  const preRoutingText =
    preOocIntent === "none"
      ? storedUserMessage
      : extractOocRoutingText(storedUserMessage);
  const requestedConsentMode = resolveEffectiveConsentMode({
    requested: body.adultConsentMode ?? body.adult_consent_mode,
    previous: priorModelRouteState.activeConsentMode,
    currentInput: storedUserMessage,
    allowedConsentModes,
    sceneReset: preSceneReset,
    clearSceneTransition: detectClearSceneTransition(preRoutingText),
  });

  const recentRawForSceneClassification = turnsForRecentHistory
    .slice(-3)
    .flatMap((turn) =>
      turn.assistantOnly ? [turn.assistant] : [turn.user, turn.assistant]
    )
    .join("\n");
  const sceneClassification = classifySceneMode({
    currentInput: storedUserMessage,
    previousSceneMode: priorModelRouteState.currentSceneMode,
    recentRawText: recentRawForSceneClassification,
    adultDialogueProfile: normalizeAdultDialogueProfile(
      ch.adult_dialogue_profile
    ),
    activeConsentMode: requestedConsentMode,
    previousConsentMode: priorModelRouteState.activeConsentMode,
  });
  // Participant age eligibility uses identity fields only. World lore, cast, and
  // system prompt can mention unrelated minors and must not contaminate status.
  const characterParticipantDescription =
    buildCharacterParticipantIdentityDescription({
      adultStatus: ch.adult_status,
      description: ch.description,
      systemPrompt: ch.system_prompt,
      world: ch.world,
      simulationCast: (ch as { simulation_cast?: string }).simulation_cast,
    });
  // Chat-room 「성인모드」 is the operational adult-handoff gate.
  // Home/header 「성인 캐릭터 표시」(nsfw_on) only controls listing visibility.
  // characters.nsfw is listing/content-rating only — not an adult-RP gate.
  const adultContentVisibilityEnabled = chatAdultHandoffEnabled;
  const adultEligibility = resolveAdultEligibility({
    userAdultVerified,
    adultContentVisibilityEnabled,
    participants: [
      {
        adultStatus: ch.adult_status,
        age:
          typeof ch.participant_min_age === "number" &&
          Number.isFinite(ch.participant_min_age)
            ? ch.participant_min_age
            : null,
        description: characterParticipantDescription,
      },
      {
        description: personaDescription,
        isVerifiedAdultUserPersona: userAdultVerified,
      },
    ],
    actualNonConsent: sceneClassification.actualNonConsent,
  });
  const adultRouteDecision = decideAdultModelRoute({
    config: adultRoutingConfig,
    state: priorModelRouteState,
    classification: sceneClassification,
    eligibility: adultEligibility,
    adultDialogueProfile: normalizeAdultDialogueProfile(
      ch.adult_dialogue_profile
    ),
    selectedModelId: selectedAI,
  });

  if (adultRoutingConfig.enabled && adultRouteDecision.shouldBlock) {
    const eligibilityMessage =
      adultRouteDecision.blockReason === "participant_unknown"
        ? "등장인물의 성인 여부를 확인할 수 없어 이 장면을 진행할 수 없습니다."
        : "이 설정에서는 해당 성인 장면을 진행할 수 없습니다.";
    return Response.json({ error: eligibilityMessage }, { status: 400 });
  }
  if (
    adultRoutingConfig.enabled &&
    !isAllowedAdultHandoffTargetModel(activeAdultModelId)
  ) {
    return Response.json(
      { error: "성인 장면 라우팅 모델 설정을 확인해 주세요." },
      { status: 500 }
    );
  }

  const adultDeliveryPlan = resolveAdultDeliveryPlan({
    routingEnabled: adultRoutingConfig.enabled,
    eligibility: adultEligibility,
    silentRefusalFallback: adultRoutingConfig.silentRefusalFallback,
    selectedModelId: selectedAI,
    adultTargetModelId: activeAdultModelId,
    classification: sceneClassification,
    state: priorModelRouteState,
    adultDialogueProfile: normalizeAdultDialogueProfile(
      ch.adult_dialogue_profile
    ),
    providerCapabilities: adultRoutingConfig.providerCapabilities,
    chatAdultModeEnabled: isAdultMode && chatAdultHandoffEnabled,
  });
  const adultFallbackModelId = adultDeliveryPlan.fallbackModelId;

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
        creator_compiled_description_json: (ch as { creator_compiled_description_json?: string }).creator_compiled_description_json,
        appearance_raw: (ch as { appearance_raw?: string }).appearance_raw,
        appearance_compiled: (ch as { appearance_compiled?: string }).appearance_compiled,
      },
      personaDisplayName,
      user.nickname
    );
  let effectiveExampleDialog = resolveExampleDialogForPrompt(ch.example_dialog, ch.name);
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

  const effectiveSelectedAI =
    adultDeliveryPlan.primaryModelId as SelectedAI;
  const primaryProvider = isCheaperInferenceModel(effectiveSelectedAI)
    ? "cheaperinference"
    : selectedAIProvider(effectiveSelectedAI);
  const cheaperPricingRefreshed =
    primaryProvider === "cheaperinference"
      ? await refreshCheaperInferenceCatalogPricing()
      : false;
  const billingOpenRouterModelId =
    primaryProvider === "openrouter"
      ? resolveOpenRouterModelId(effectiveSelectedAI)
      : effectiveSelectedAI;
  const openRouterApiModelId = billingOpenRouterModelId;
  const canonInjectionPolicy = resolveCanonInjectionPolicy(openRouterApiModelId, {
    userId: user.id,
    chatId: chat.id,
  });
  const contextProvider =
    primaryProvider === "cheaperinference" ? "openrouter" : primaryProvider;
  const contextModelId = openRouterApiModelId;
  const historyTokenBudget = resolveHistoryTokenBudget(contextModelId, contextProvider);

  const summarizedTurnCountBeforeBarrier = chatMemory?.summarized_turn_count ?? 0;
  let effectiveSummarizedTurnCount = memoryFeatureOn
    ? summarizedTurnCountBeforeBarrier
    : 0;
  const memorySourceEligibleCompletedTurns = countMemoryEligibleCompletedTurns(chat.id);
  const completedTurnsForMemoryCoverage = memoryFeatureOn
    ? memorySourceEligibleCompletedTurns
    : playableTurnCount;

  if (memoryFeatureOn) {
    const barrier = await ensureSummaryBarrier({
      chatId: chat.id,
      userId: user.id,
      characterId: ch.id,
      charName: ch.name,
      tier: memoryTier,
      memoryCapacity,
      userPersona: personaDisplayName,
      completedTurns: completedTurnsForMemoryCoverage,
    });
    const gate = gateChatOnSummaryBarrier(barrier);
    if (!gate.proceed) {
      return Response.json(gate.response.body, { status: gate.response.status });
    }
    effectiveSummarizedTurnCount = gate.summarizedThrough;
  }

  const providerRawExchangeCount = RAW_HISTORY_COMPLETE_EXCHANGES;
  const { opening: openingTurn, playable: playableTurnsForOpening } =
    splitOpeningPlayableTurns(turnsForRecentHistory);
  const protectOpening = shouldIncludeOpeningInProviderRaw({
    opening: openingTurn,
    summarizedTurnCount: effectiveSummarizedTurnCount,
    memoryFeatureEnabled: memoryFeatureOn,
    playableCount: playableTurnsForOpening.length,
  });
  const providerRawOpts = {
    summarizedTurnCount: effectiveSummarizedTurnCount,
    memoryFeatureEnabled: memoryFeatureOn,
  };
  const canonicalRecentHistoryFull: ChatMsg[] = rawRecentTurnsToHistory(
    turnsForRecentHistory,
    providerRawExchangeCount,
    providerRawOpts
  ).map((m) => ({
      ...m,
      content: replaceUserPlaceholder(m.content, personaDisplayName, user.nickname),
    })
  );
  const providerTrimOpts = {
    minRealPlayableExchanges: providerRawExchangeCount,
    protectOpening,
  };
  const providerHistoryAbsoluteTurnFloor = resolveProviderHistoryTurnFloor({
    minRealPlayableExchanges: providerRawExchangeCount,
    protectOpening,
    history: canonicalRecentHistoryFull,
  });
  const historyMinTurnFloor = providerHistoryAbsoluteTurnFloor;
  const coverageProtectedCanonicalHistory = trimProviderHistoryToBudget(
    canonicalRecentHistoryFull,
    historyTokenBudget,
    providerTrimOpts
  );
  const canonicalRouteHistory: CanonicalRouteHistoryMessage[] = msgRowsSource
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => {
      let sceneMode: SceneMode | undefined;
      let activeRoute: ActiveModelRoute | undefined;
      const storedAdultRouteMeta =
        row.role === "assistant"
          ? row.adult_route_meta_json || row.usage
          : null;
      if (storedAdultRouteMeta) {
        try {
          const parsed = JSON.parse(storedAdultRouteMeta) as {
            sceneModeAfter?: unknown;
            activeRoute?: unknown;
            adultRouting?: {
              sceneModeAfter?: unknown;
              activeRoute?: unknown;
            };
          };
          const routing = parsed.adultRouting ?? parsed;
          if (
            typeof routing.sceneModeAfter === "string"
          ) {
            sceneMode = routing.sceneModeAfter as SceneMode;
          }
          if (
            routing.activeRoute === "adult" ||
            routing.activeRoute === "general"
          ) {
            activeRoute = routing.activeRoute;
          }
        } catch {
          // Legacy usage is allowed to remain unclassified.
        }
      }
      return {
        role: row.role,
        content: replaceUserPlaceholder(
          row.content,
          personaDisplayName,
          user.nickname
        ),
        ...(sceneMode ? { sceneMode } : {}),
        ...(activeRoute ? { activeRoute } : {}),
      };
    });
  let providerRecentHistoryFull: ChatMsg[] = coverageProtectedCanonicalHistory;
  if (
    adultRoutingConfig.enabled &&
    adultRouteDecision.activeRoute === "general" &&
    priorModelRouteState.generalRouteBridge
  ) {
    providerRecentHistoryFull = trimProviderHistoryToBudget(
      buildGeneralProviderContext(
        boundCanonicalRouteHistoryForProvider(canonicalRouteHistory, providerRawExchangeCount, {
          includeOpening: protectOpening,
        }),
        priorModelRouteState.generalRouteBridge
      ),
      historyTokenBudget,
      providerTrimOpts
    );
  }
  let handoffRawTurnsIncluded = 0;
  let handoffRawTokensIncluded = 0;
  let adultHandoffRequiredTurnFloor = 0;
  const trimmedHistoryForLorebook = coverageProtectedCanonicalHistory;
  const recentHistory: ChatMsg[] = canonicalRecentHistoryFull;
  const shortTermHistory = providerRecentHistoryFull;
  const providerHistoryHealth = analyzeProviderHistoryHealth(shortTermHistory);
  const rawCompleteExchanges = providerHistoryHealth.realRawCompleteExchanges;
  const rawHistoryChars = providerHistoryHealth.realRawChars;
  const rawHistoryInternalEstimate = shortTermHistory.reduce(
    (n, m) => n + estimateTokens(m.content ?? ""),
    0
  );
  const unsummarizedCompletedTurns = Math.max(
    0,
    completedTurnsForMemoryCoverage - effectiveSummarizedTurnCount
  );
  console.info("RAW_HISTORY_SELECTED", {
    chat_id: chat.id,
    exchange_count: rawCompleteExchanges,
    chars: rawHistoryChars,
    internal_estimate: rawHistoryInternalEstimate,
  });
  if (rawCompleteExchanges > providerRawExchangeCount) {
    console.warn("RAW_HISTORY_POLICY_VIOLATION", {
      chat_id: chat.id,
      raw_complete_exchanges: rawCompleteExchanges,
      expected: providerRawExchangeCount,
    });
  }

  const keptEligibleRawTurnsForLorebook = Math.min(
    countRealPlayableHistoryTurns(trimmedHistoryForLorebook),
    completedTurnsForMemoryCoverage
  );
  const initialLorebookExcludeTurnStart =
    keptEligibleRawTurnsForLorebook > 0
      ? completedTurnsForMemoryCoverage - keptEligibleRawTurnsForLorebook + 1
      : completedTurnsForMemoryCoverage + 1;
  const initialMemoryInjection = await buildMemoryContextForChat({
    chatId: chat.id,
    userId: user.id,
    characterId: ch.id,
    tier: memoryTier,
    memoryCapacity,
    userMessage: autoContinueContext ? CONTINUE_USER_DISPLAY : displayUserMessage,
    modelId: contextModelId,
    provider: contextProvider,
    turnTrace: undefined,
    excludeSummaryTurnStartGte: initialLorebookExcludeTurnStart,
  });
  let memoryInjection = initialMemoryInjection;
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

  const canonLazyCompileResult = shouldRunCanonInjectionSideEffects(canonInjectionPolicy)
    ? ensureCanonPlanOnAccess(db, ch.id, {
        creator_raw_description: (ch as { creator_raw_description?: string }).creator_raw_description,
        creator_canon_plan_json: (ch as { creator_canon_plan_json?: string }).creator_canon_plan_json,
        world: ch.world,
        system_prompt: ch.system_prompt,
      })
    : null;

  const policyUserMessage = displayUserMessage;

  const statusWidgetTurn = resolveStatusWidgetTurn({
    characterWidgetJson: (ch as { status_widget_json?: string }).status_widget_json,
    chatMode: (chat as { status_widget_mode?: string }).status_widget_mode,
    userWidgetJson: (chat as { user_status_widget_json?: string }).user_status_widget_json,
    stackOrder: (chat as { status_widget_stack_order?: string }).status_widget_stack_order,
    displayMode: (chat as { status_widget_display_mode?: string }).status_widget_display_mode,
    characterAllowUserOverride:
      (ch as { status_widget_allow_user_override?: number }).status_widget_allow_user_override !== 0,
  });
  const chatOocHtmlOutputTurn = chatInputSuppressesStatusWidget(storedUserMessage);
  const statusWidgetActive = statusWidgetTurn.active && !chatOocHtmlOutputTurn;
  const lorebookActivation = buildLorebookActivationText({
    currentUserMessage: policyUserMessage,
    recentTurns: turnsForRecentHistory.map((turn) => ({
      user: replaceUserPlaceholder(turn.user, personaDisplayName, user.nickname),
      assistant: replaceUserPlaceholder(turn.assistant, personaDisplayName, user.nickname),
    })),
  });
  if (process.env.NODE_ENV !== "production") {
    console.warn("[Lorebook] activation source:", {
      currentUserMessageChars: lorebookActivation.currentUserText.length,
      recentRawTurns: lorebookActivation.recentRawTurnCount,
      recentRawMessages: lorebookActivation.recentRawCount,
      activationWindowChars: lorebookActivation.activationText.length,
      maxChars: lorebookActivation.maxChars,
      truncated: lorebookActivation.truncated,
      excludedSummaryMemory: true,
    });
  }

  const activatedKeywordLorebookMatches: Array<{
    entryKey: string;
    keyword: string;
    source: string;
    carryoverTurnsRemaining?: number;
  }> = [];
  const keywordLorebookBlock = loadKeywordLorebookPromptBlockFromActivation(
    db,
    (ch as { lorebook_id?: number | null }).lorebook_id,
    lorebookActivation,
    {
      chatId: chat.id,
      currentTurn: playableTurnCount + 1,
      onMatch: (match) => {
        activatedKeywordLorebookMatches.push({
          entryKey: match.entryKey,
          keyword: match.keyword,
          source: match.source,
          carryoverTurnsRemaining: match.carryoverTurnsRemaining,
        });
      },
    }
  );
  if (process.env.NODE_ENV !== "production" && activatedKeywordLorebookMatches.length > 0) {
    console.warn("[Lorebook] activated entries:", activatedKeywordLorebookMatches);
  }

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
  const s4LiveProducerAllowed =
    personaSecretDiscoveryOn &&
    isPersonaSecretS4LiveProducerEnabled() &&
    isS4LiveProducerTurnAllowed({
      oocHtmlMode,
      oocSceneRenderTurn,
      htmlFlashOnlyTurn,
    });
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
  const queuedStatusTriggerEvents = loadQueuedStatusTriggerEventsForPrompt(
    db,
    chat.id,
    8,
    {
      ...(regenerateMessageId ? { maxSourceTurn: playableTurnCount } : {}),
      needsCharacterValues: statusWidgetTurn.needsCharacterValues,
      allowedStatusKeys: resolveStatusWidgetEngineStatusKeys(statusWidgetTurn),
    }
  );
  const queuedStatusTriggerEventIds = queuedStatusTriggerEvents.map((event) => event.id);
  const triggeredScenarioEventsBlock =
    buildTriggeredScenarioEventsPromptBlock(queuedStatusTriggerEvents);
  const normalizedRelationshipMemoryMeta = memoryFeatureOn
    ? normalizeMemoryMeta(parseMemoryMeta(chat.memory_meta), relationshipNames)
    : null;
  const relationshipMemoryForPrompt = memoryFeatureOn
    ? formatMemoryMetaForPrompt(normalizedRelationshipMemoryMeta!)
    : "";
  const recentChatTextForEpisodicMemory = recentHistory
    .map((m) => m.content)
    .filter(Boolean)
    .join("\n");
  const lorebookTextForEpisodicMemory = [
    keywordLorebookBlock,
    globalLorebookBlock,
  ]
    .filter(Boolean)
    .join("\n");
  const episodicMemory = getEpisodicMemoryForPrompt(db, {
    chatId: chat.id,
    characterId: ch.id,
    userId: user.id,
    currentTurn: memorySourceEligibleCompletedTurns + 1,
    currentUserMessage: policyUserMessage,
    recentChatText: recentChatTextForEpisodicMemory,
    longTermMemoryText: memoryFeatureOn
      ? [memoryInjection.text, memoryInjection.archiveText].filter(Boolean).join("\n")
      : "",
    relationshipMemoryText: relationshipMemoryForPrompt,
    lorebookText: lorebookTextForEpisodicMemory,
    triggeredEventText: triggeredScenarioEventsBlock,
  });
  logMemoryHealthTelemetry(
    buildMemoryHealthTelemetry({
      completedPlayableTurns: completedTurnsForMemoryCoverage,
      summarizedThrough: effectiveSummarizedTurnCount,
      realRawCompleteExchanges: providerHistoryHealth.realRawCompleteExchanges,
      openingInRaw: providerHistoryHealth.openingPreludePresent,
      bridgeInRaw: providerHistoryHealth.generalRouteBridgePresent,
      episodicCandidateCount: episodicMemory.debug.length,
      episodicInjectedCount: episodicMemory.facts.length,
      episodicDuplicateBlockedCount: episodicMemory.debug.filter((d) =>
        Boolean(d.duplicate_reason)
      ).length,
      episodicBudgetBlockedCount: episodicMemory.debug.filter((d) =>
        Boolean(d.budget_reason)
      ).length,
      statusExtractCallCount: 0,
    })
  );
  const privateSpeechControlBlock = buildPrivateSpeechControlBlock(
    parseCreatorDescriptionCompiled(ch.creator_compiled_description_json)
  );
  const livingSceneDirectiveOn = isLivingSceneDirectiveV2EnabledForUser(
    user.id,
    selectedAI
  );
  const sceneDirectiveV2Mode = getSceneDirectiveV2Mode();
  const sceneDirectiveV2Compute = isSceneDirectiveV2ComputeEnabled();
  const sceneDirectiveV2Inject = isSceneDirectiveV2InjectEnabled();
  const sceneProgressionTurn = playableTurnCount + 1;
  const sceneProgressionState = loadSceneProgressionState(chat.id);
  const contentKindForCanary =
    ch.content_kind === "simulation" ? "simulation" : "character";
  const rpDiagnosticCanary: RpDiagnosticCanaryResolution | null = resolveRpDiagnosticCanary({
    userId: user.id,
    modelId: openRouterApiModelId,
    contentKind: contentKindForCanary,
  });
  const terraPromptCanary: TerraPromptCanaryResolution | null = rpDiagnosticCanary
    ? null
    : resolveTerraPromptCanary({
        userId: user.id,
        modelId: openRouterApiModelId,
        contentKind: contentKindForCanary,
      });
  const promptHistory = rpDiagnosticCanary
    ? applyRpDiagnosticToHistory({
        history: shortTermHistory,
        canary: rpDiagnosticCanary,
        characterId: ch.id,
        productionGreeting: ch.greeting ?? "",
      })
    : applyTerraPromptCanaryToHistory({
        history: shortTermHistory,
        canary: terraPromptCanary,
        characterId: ch.id,
        productionGreeting: ch.greeting ?? "",
      });
  if (terraPromptCanary && canaryAppliesCardDialogueNeutral(terraPromptCanary.variant)) {
    // Single-field card canary: drop example dialogue injection only.
    effectiveExampleDialog = "";
  }
  const legacySceneDirective = buildSceneDirective({
    mode: autoContinueContext ? "auto_progression" : "interactive",
    recentMessages: promptHistory,
    currentUserMessage: policyUserMessage,
    memoryText: memoryFeatureOn
      ? [memoryInjection.text, memoryInjection.archiveText].filter(Boolean).join("\n")
      : "",
    relationshipMemoryText: relationshipMemoryForPrompt,
    lorebookText: [keywordLorebookBlock, globalLorebookBlock].filter(Boolean).join("\n"),
    triggeredEventText: triggeredScenarioEventsBlock,
    chatId: chat.id,
    currentTurn: sceneProgressionTurn,
    progressionHistory: sceneProgressionState.recent,
    contentKind: ch.content_kind === "simulation" ? "simulation" : "character",
    primaryCharacterName: ch.name,
    establishedActiveCastNames:
      ch.content_kind === "simulation"
        ? extractSimulationCastNames(ch.simulation_cast ?? "")
        : undefined,
  });
  const sceneDirective = legacySceneDirective;
  const livingSceneDirective = livingSceneDirectiveOn
    ? buildLivingSceneDirective({
        mode: autoContinueContext ? "auto_progression" : "interactive",
        recentMessages: promptHistory,
        currentUserMessage: policyUserMessage,
        triggeredEventText: triggeredScenarioEventsBlock,
        // Grounded pools only — not used for direction classification.
        memoryText: memoryFeatureOn
          ? [memoryInjection.text, memoryInjection.archiveText].filter(Boolean).join("\n")
          : "",
        relationshipMemoryText: relationshipMemoryForPrompt,
        lorebookText: [keywordLorebookBlock, globalLorebookBlock].filter(Boolean).join("\n"),
      })
    : null;
  // Prepare-only: never commit reconvergence until assistant finalize succeeds.
  let pendingReconvergenceTransition: PendingReconvergenceTransition | null = null;
  const eventRestraintV2 =
    sceneDirectiveV2Compute
      ? (() => {
          const namespace = sceneDirectiveV2Inject ? "production" : "shadow";
          const prevReconv = loadReconvergenceState(chat.id, ch.id, namespace);
          const built = buildSceneDirectiveV2({
            mode: autoContinueContext ? "auto_progression" : "interactive",
            recentMessages: shortTermHistory,
            currentUserMessage: policyUserMessage,
            memoryText: memoryFeatureOn
              ? [memoryInjection.text, memoryInjection.archiveText].filter(Boolean).join("\n")
              : "",
            relationshipMemoryText: relationshipMemoryForPrompt,
            lorebookText: [keywordLorebookBlock, globalLorebookBlock]
              .filter(Boolean)
              .join("\n"),
            triggeredEventText: triggeredScenarioEventsBlock,
            reconvergenceState: prevReconv,
            currentTurn: playableTurnCount + 1,
            isRegenerate: Boolean(regenerateMessageId),
          });
          const nextReconv = getUpdatedReconvergenceStateFromBuild(
            {
              mode: autoContinueContext ? "auto_progression" : "interactive",
              recentMessages: shortTermHistory,
              currentUserMessage: policyUserMessage,
              triggeredEventText: triggeredScenarioEventsBlock,
              reconvergenceState: prevReconv,
              currentTurn: playableTurnCount + 1,
              isRegenerate: Boolean(regenerateMessageId),
            },
            built
          );
          pendingReconvergenceTransition = prepareReconvergenceTransition({
            namespace,
            chatId: chat.id,
            characterId: ch.id,
            currentTurn: playableTurnCount + 1,
            currentUserMessage: policyUserMessage,
            recentMessages: shortTermHistory,
            triggerPresent: Boolean(triggeredScenarioEventsBlock?.trim()),
            triggerImpliesReunion: /재회|만남|찾아왔|도착|노크|전화가|메시지가/.test(
              triggeredScenarioEventsBlock || ""
            ),
            requestId: clientRequestId ?? null,
            generationSequence: 0,
            isRegenerate: Boolean(regenerateMessageId),
            previousOverride: prevReconv,
          });
          // If V2 selected reconverge offer, ensure pending next reflects offered state.
          if (
            built.pacingDecision === "reconverge" &&
            !built.reconvergence?.blockedNoGroundedPath
          ) {
            pendingReconvergenceTransition = {
              ...pendingReconvergenceTransition,
              next: {
                ...nextReconv,
                chatId: chat.id,
                characterId: ch.id,
              },
              reconvergenceDue: true,
            };
          } else {
            pendingReconvergenceTransition = {
              ...pendingReconvergenceTransition,
              next: {
                ...pendingReconvergenceTransition.next,
                ...nextReconv,
                chatId: chat.id,
                characterId: ch.id,
              },
            };
          }
          logSceneDirectiveV2Telemetry(
            buildSceneDirectiveV2Telemetry(
              built,
              Boolean(triggeredScenarioEventsBlock?.trim())
            )
          );
          return built;
        })()
      : null;
  // Priority when V2 ON: Event-Restraint V2 is the single scene pacing owner
  // (V1 + Living scene directive are not dual-injected).
  // V2 shadow / OFF: Living canary (if enabled) else legacy V1.
  const scenePacingOwner = resolveScenePacingPromptOwner({
    v2Mode: sceneDirectiveV2Mode,
    livingEnabled: Boolean(livingSceneDirective),
  });
  const canaryProgressionAxis: SceneProgressionAxis | null = rpDiagnosticCanary
    ? resolveRpDiagnosticProgressionAxis({
        canary: rpDiagnosticCanary,
        completedTurns: playableTurnCount,
        contentKind: contentKindForCanary,
        userMessage: policyUserMessage,
        recentMessages: promptHistory,
      })
    : resolveCanarySceneProgressionAxis({
        canary: terraPromptCanary,
        completedTurns: playableTurnCount,
        contentKind: contentKindForCanary,
        userMessage: policyUserMessage,
        recentMessages: promptHistory,
      });
  const sceneDirectiveForRender =
    canaryProgressionAxis === "relationship" &&
    scenePacingOwner !== "event_restraint_v2" &&
    scenePacingOwner !== "living_continuity_director"
      ? lockSceneDirectiveToRelationshipAxis(legacySceneDirective)
      : legacySceneDirective;
  const sceneDirectiveBlock = rpDiagnosticCanary
    ? applyRpDiagnosticToSceneDirectiveBlock({
        block:
          scenePacingOwner === "event_restraint_v2" && eventRestraintV2
            ? renderSceneDirectiveV2ForPrompt(eventRestraintV2)
            : scenePacingOwner === "living_continuity_director" && livingSceneDirective
              ? renderLivingSceneDirectiveForPrompt(livingSceneDirective)
              : renderSceneDirectiveForPrompt(sceneDirectiveForRender),
        canary: rpDiagnosticCanary,
        completedTurns: playableTurnCount,
        progressionAxis: canaryProgressionAxis,
      })
    : applyTerraPromptCanaryToSceneDirectiveBlock({
        block:
          scenePacingOwner === "event_restraint_v2" && eventRestraintV2
            ? renderSceneDirectiveV2ForPrompt(eventRestraintV2)
            : scenePacingOwner === "living_continuity_director" && livingSceneDirective
              ? renderLivingSceneDirectiveForPrompt(livingSceneDirective)
              : renderSceneDirectiveForPrompt(sceneDirectiveForRender),
        canary: terraPromptCanary,
        completedTurns: playableTurnCount,
        progressionAxis: canaryProgressionAxis,
      });
  const relocateSceneDirectiveToUserTurn = rpDiagnosticCanary
    ? shouldRelocateRpDiagnosticSceneDirective(rpDiagnosticCanary, canaryProgressionAxis)
    : shouldRelocateSceneDirectiveToUserTurn(terraPromptCanary, canaryProgressionAxis);
  const canaryTemperature = resolveTerraPromptCanaryTemperature(terraPromptCanary);

  const livingToLegacyProgression = (
    types: LivingProgressionType[]
  ): SceneProgressionType[] => {
    const out: SceneProgressionType[] = [];
    for (const t of types) {
      if (t === "relationship_aftereffect") out.push("relationship");
      else if (t === "character_routine" || t === "established_task") out.push("daily_life");
      else if (t === "environment_continuity") out.push("environment");
      else if (t === "active_thread_consequence") out.push("consequence");
      else if (t === "triggered_event_followthrough") out.push("world_reaction");
      else if (t === "ensemble_aftereffect") out.push("relationship");
      else if (t === "future_intent") out.push("relationship");
    }
    return out.slice(0, 3);
  };

  /** UI-safe allowlist only — never includes nextBeatHint / directive prose. */
  const generationPreparationUi = deriveGenerationPreparationUi({
    runtimeMode,
    progressionTypes:
      scenePacingOwner === "event_restraint_v2" && eventRestraintV2
        ? eventRestraintV2.progressionTypes
        : scenePacingOwner === "living_continuity_director" && livingSceneDirective
          ? livingToLegacyProgression(livingSceneDirective.progressionTypes)
          : legacySceneDirective.progressionTypes,
    recommendedIntensity:
      scenePacingOwner === "event_restraint_v2" && eventRestraintV2
        ? eventRestraintV2.recommendedIntensity
        : scenePacingOwner === "living_continuity_director" && livingSceneDirective
          ? livingSceneDirective.recommendedIntensityInternal
          : legacySceneDirective.recommendedIntensity,
    phase: "preparing",
  });

  const sceneMomentumInput = buildSceneMomentumInputFromRoute({
    shortTermHistory,
    currentUserMessage: policyUserMessage,
    normalizedMemoryMeta: normalizedRelationshipMemoryMeta,
  });

  let revealedPersonaFactsBlock: string | null = null;
  let pendingPersonaSecretRevealCandidates: PersonaSecretRevealCandidate[] = [];
  // PR-S4C: compute once per request — shared by main/rebuild/recovery/snapshot.
  let personaKnowledgePromptDecision: PersonaKnowledgePromptDecision = {
    mode: "ENSEMBLE_REDACTED",
    reasonCode: "MISSING_AUTHORITATIVE_SPEAKER",
  };
  let s4GenerationTransferContext: S4GenerationTransferContext | null = null;
  let personaSecretDescriptionForFacts = "";
  if (personaSecretBoundaryOn && resolvedPersonaId) {
    const secretPayload = getPersonaSecretPayload(user.id, resolvedPersonaId);
    personaSecretDescriptionForFacts = secretPayload?.secretDescription ?? "";

    // Legacy blank-line secret_description compatibility (Discovery OFF only).
    if (
      !personaSecretDiscoveryOn &&
      !autoContinueContext &&
      messageText.trim() &&
      !isContinueUserMessage(messageText) &&
      personaSecretDescriptionForFacts.trim()
    ) {
      pendingPersonaSecretRevealCandidates = detectUserAuthoredPersonaSecretReveals(
        messageText,
        splitPersonaSecretItems(personaSecretDescriptionForFacts)
      );
    }

    if (personaSecretDiscoveryOn) {
      personaKnowledgePromptDecision = resolvePersonaKnowledgePromptDecisionForChat(
        buildGenerationKnowledgeContext({
          contentKind: ch.content_kind,
          simulationCast: ch.simulation_cast ?? ch.system_prompt,
          characterId: ch.id,
        }),
        { chatId: chat.id }
      );

      // S1 direct disclosure runs after durable user-message bootstrap (below),
      // so evidence stores the real sourceMessageId and knowledge writes stay 0 on
      // regenerate/continue/save-failed requests.

      const personaWithS4 = buildPersonaKnowledgeWithS4ForTurn({
        decision: personaKnowledgePromptDecision,
        chatId: chat.id,
        personaId: resolvedPersonaId,
        authority: personaSecretAuthority,
        allowS4: s4LiveProducerAllowed,
      });
      s4GenerationTransferContext = personaWithS4.s4Context;
      revealedPersonaFactsBlock = personaWithS4.block;
    } else {
      // Discovery OFF: legacy reveal-table projection only (no ensemble knowledge).
      revealedPersonaFactsBlock = buildRevealedPersonaFactsBlockForPersona(
        listChatPersonaSecretReveals(chat.id, resolvedPersonaId),
        personaSecretDescriptionForFacts
      );
    }
  }

  const contextBuildInput = {
    charName: ch.name,
    contentKind: ch.content_kind === "simulation" ? "simulation" as const : "character" as const,
    narrativePov: resolveNarrativePov({
      mode: chat.narrative_pov,
      contentKind: ch.content_kind === "simulation" ? "simulation" : "character",
      mainCharacterName: ch.name,
      povCharacterName: chat.pov_character_name,
    }),
    chunks: characterChunks,
    systemPrompt: ch.system_prompt,
    world: ch.world,
    exampleDialog: effectiveExampleDialog,
    speechProfileJson: (ch as { speech_profile?: string }).speech_profile,
    speechPersonality: (ch as { speech_personality?: string }).speech_personality,
    speechTraits: (ch as { speech_traits?: string }).speech_traits,
    characterPersonality: ch.description,
    creatorNarrationStyle: (ch as { narration_style_instructions?: string | null })
      .narration_style_instructions ?? "",
    userNickname: user.nickname,
    userPersona: userPersonaPrompt,
    revealedPersonaFactsBlock: revealedPersonaFactsBlock ?? undefined,
    userNote: userNotePrompt,
    longTermMemory: memoryFeatureOn ? memoryInjection.text : "",
    archiveMemory: memoryFeatureOn ? memoryInjection.archiveText : "",
    shortTermHistory: promptHistory,
    currentUserMessage: promptUserMessage,
    currentTurnAuthoringDelegation: currentTurnDelegationForTurn,
    nsfw: isAdultMode,
    activeConsentMode: requestedConsentMode,
    gender: resolveCharacterGender(ch.gender),
    assetTags: assetTags.length > 0 ? assetTags : undefined,
    memoryMeta: relationshipMemoryForPrompt,
    modelId: openRouterApiModelId,
    userImpersonation,
    novelModeEnabled,
    runtimeMode,
    personaDisplayName,
    userId: user.id,
    chatId: chat.id,
    targetResponseChars,
    completedTurns: playableTurnCount,
    completedTurnsForMemoryCoverage,
    summarizedTurnCount: effectiveSummarizedTurnCount,
    historyMinTurnFloor,
    providerHistoryAbsoluteTurnFloor,
    providerHistoryProtectOpening: protectOpening,
    providerHistoryMinRealPlayableExchanges: providerRawExchangeCount,
    adultHandoffRequiredTurnFloor,
    userPersonaGender: selectedPersona?.gender ?? "other",
    provider: "openrouter" as const,
    genres: characterGenres,
    useEnglishCharacterPrompt: usedEnglishCharacterPrompt,
    isContinue: autoContinueContext,
    regenerate: !!regenerateMessageId,
    rejectedAssistantDraft: regenerateMessageId ? rejectedAssistantDraft : undefined,
    regenAttemptId: regenerateMessageId ? regenAttemptId : undefined,
    geminiStaticDynamicMode: false,
    episodicMemoryBlock: episodicMemory.promptBlock || undefined,
    triggeredScenarioEventsBlock: triggeredScenarioEventsBlock || undefined,
    privateSpeechControlBlock: privateSpeechControlBlock || undefined,
    sceneDirectiveBlock: relocateSceneDirectiveToUserTurn
      ? null
      : sceneDirectiveBlock,
    keywordLorebookBlock: keywordLorebookBlock || undefined,
    globalLorebookBlock: globalLorebookBlock || undefined,
    canonInjectionPolicy: canonInjectionPolicy,
    canonPlan: canonLazyCompileResult?.plan ?? null,
    sceneMomentumInput,
    terraPromptCanary: terraPromptCanary
      ? {
          variant: terraPromptCanary.variant,
          progressionAxis: canaryProgressionAxis,
          relocateSceneDirectiveToUserTurn,
          sceneDirectiveUserTail: relocateSceneDirectiveToUserTurn
            ? sceneDirectiveBlock
            : null,
        }
      : null,
    rpDiagnosticCanary: rpDiagnosticCanary
      ? {
          variant: rpDiagnosticCanary.variant,
          progressionAxis: canaryProgressionAxis,
          relocateSceneDirectiveToUserTurn,
          sceneDirectiveUserTail: relocateSceneDirectiveToUserTurn
            ? sceneDirectiveBlock
            : null,
        }
      : null,
    preserveAdultHandoffRawHistory: false,
  };

  const assembleContext = <T,>(fn: () => T): T =>
    personaKnowledgePromptDecision.mode === "ENSEMBLE_REDACTED"
      ? withEnsembleRedactedPromptAssembly(fn)
      : fn();

  let built = assembleContext(() =>
    buildContext({
      ...contextBuildInput,
      statusWidgetActive: statusWidgetActive,
      mainModelOwnsRelationshipExtract,
      promptDumpSource: "db",
      promptDumpDetail: `chat=${chat.id} user=${user.id} character=${ch.id}`,
    })
  );
  if (memoryFeatureOn) {
    const reconciliation = await reconcileMemoryCoverageFixedPoint({
      initialBuild: built,
      initialMemory: initialMemoryInjection,
      initialLtmCutoff: initialLorebookExcludeTurnStart,
      failSafeLtmCutoff: completedTurnsForMemoryCoverage + 1,
      readCoverage: (context) => ({
        degraded: context.meta.memoryCoverage?.degraded === true,
        firstRawPlayableTurn:
          context.meta.memoryCoverage?.firstRawPlayableTurn ?? null,
        gapTurns: context.meta.memoryCoverage?.gapTurns ?? 0,
        estimatedInputTokens: context.meta.estimatedInputTokens ?? 0,
      }),
      rebuildMemory: (excludeSummaryTurnStartGte) =>
        buildMemoryContextForPreview({
          chatId: chat.id,
          tier: memoryTier,
          memoryCapacity,
          userMessage: autoContinueContext ? CONTINUE_USER_DISPLAY : displayUserMessage,
          modelId: contextModelId,
          provider: contextProvider,
          excludeSummaryTurnStartGte,
        }),
      rebuildContext: (reconciledMemory) =>
        assembleContext(() =>
          buildContext({
            ...contextBuildInput,
            longTermMemory: reconciledMemory.text,
            archiveMemory: reconciledMemory.archiveText,
            statusWidgetActive: statusWidgetActive,
            mainModelOwnsRelationshipExtract,
            promptDumpSource: "db",
            promptDumpDetail: `chat=${chat.id} user=${user.id} character=${ch.id}`,
            suppressMemoryCoverageDegradedLog: true,
          })
        ),
    });
    memoryInjection = reconciliation.memory;
    built = reconciliation.build;
    if (reconciliation.nonconvergent) {
      console.warn("MEMORY_COVERAGE_RECONCILE_NONCONVERGENT", {
        passes: reconciliation.passes,
        initial_first_raw_turn: reconciliation.initialFirstRawTurn,
        final_first_raw_turn: reconciliation.finalFirstRawTurn,
        final_ltm_cutoff: reconciliation.finalLtmCutoff ?? null,
        gap_turns: built.meta.memoryCoverage?.gapTurns ?? 0,
        middle_hole_turns: reconciliation.middleHoleTurns,
        estimated_input_tokens: built.meta.estimatedInputTokens ?? 0,
      });
    }
  }
  if (terraPromptCanary) {
    const assembledUserTurn =
      [...(built.history ?? [])].reverse().find((m) => m.role === "user")?.content ??
      promptUserMessage ??
      "";
    const userTurnTail =
      typeof assembledUserTurn === "string" ? assembledUserTurn.slice(-1500) : "";
    const terraLengthCount = (
      assembledUserTurn.match(/한국어 RP 본문만 3,200자 이상을 기본 목표로/g) ?? []
    ).length;
    const relationshipAxisCount = (
      assembledUserTurn.match(
        /이번 턴의 진행축은 주요 캐릭터와 사용자의 관계·상태 변화다/g
      ) ?? []
    ).length;
    const enumeratedCount = (
      `${assembledUserTurn}\n${sceneDirectiveBlock}`.match(
        /관계, 단서, 환경, NPC, 세계 반응/g
      ) ?? []
    ).length;
    logTerraPromptCanaryDebug({
      requestId: clientRequestId,
      userId: user.id,
      chatId: chat.id,
      characterId: ch.id,
      model: openRouterApiModelId,
      sceneMode: "single_primary",
      canaryVariant: terraPromptCanary.variant,
      progressionAxis: canaryProgressionAxis,
      temperature: canaryTemperature,
      sceneDirectiveFinal: sceneDirectiveBlock,
      greetingInjected: extractGreetingFromHistory(promptHistory),
      terraAdapter: resolveCanaryTerraTerminalContract(terraPromptCanary.variant),
      dialogueLayoutOwner: canaryAppliesDialogueIntentUnitLayout(terraPromptCanary.variant)
        ? DIALOGUE_LAYOUT_OWNER_KO_CANARY
        : DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION,
      userTurnTail1500: userTurnTail,
      providerRaw: null,
      finalText: null,
      metrics: {
        phase: "prompt_assembled",
        completedTurns: playableTurnCount,
        historyLen: promptHistory.length,
        relocateSceneDirectiveToUserTurn,
        relationshipAxisSentenceCount: relationshipAxisCount,
        enumeratedProgressSentenceCount: enumeratedCount,
        terraLengthOwnerCount: terraLengthCount,
        relationshipBeforeLengthOwner:
          relationshipAxisCount > 0 &&
          terraLengthCount > 0 &&
          assembledUserTurn.indexOf("이번 턴의 진행축은 주요 캐릭터와 사용자의 관계·상태 변화다") <
            assembledUserTurn.indexOf("한국어 RP 본문만 3,200자 이상을 기본 목표로"),
      },
    });
  }
  if (
    shouldLogSceneMomentumProductionTelemetry({
      modelId: openRouterApiModelId,
      canaryActualInjection: canonInjectionPolicy.canaryActualInjection,
    }) &&
    built.meta.momentumActivation
  ) {
    logSceneMomentumProductionTelemetry(
      buildSceneMomentumProductionTelemetry({
        requestId: clientRequestId,
        chatId: chat.id,
        modelId: openRouterApiModelId,
        canonInjectionPolicy,
        momentumActivation: built.meta.momentumActivation,
      })
    );
  }
  if (shouldRunCanonInjectionSideEffects(canonInjectionPolicy) && canonLazyCompileResult) {
    logCanonShadowTurnRecord(
      computeCanonShadowTurnRecord({
        policy: canonInjectionPolicy,
        characterId: ch.id,
        charName: ch.name,
        plan: canonLazyCompileResult.plan,
        lazyResult: canonLazyCompileResult,
        fullLegacyCanonChars: buildCharacterCanonBlock(settingText, ch.name).length,
        userMessage: policyUserMessage,
        archiveText: memoryFeatureOn ? memoryInjection.archiveText : "",
      })
    );
  }
  let systemPromptForTurn = built.systemPrompt;
  let openRouterSystemSplitForTurn = built.openRouterSystemSplit;
  if (statusWidgetActive) {
    systemPromptForTurn = applyStatusWidgetSystemPromptOverrides(systemPromptForTurn);
    if (openRouterSystemSplitForTurn) {
      openRouterSystemSplitForTurn = patchOpenRouterSplitForStatusWidget(openRouterSystemSplitForTurn);
    }
  }
  const priorAssistantForHandoff =
    [...turnsForRecentHistory]
      .reverse()
      .map((turn) => turn.assistant?.trim?.() ?? "")
      .find((text) => text.length > 0) ?? "";
  const extractedHandoffContinuity = extractHandoffContinuityFromAssistantText({
    text: priorAssistantForHandoff,
    characterName: ch.name,
    personaName: personaDisplayName,
    currentUserText: storedUserMessage,
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: sceneClassification.sceneReset
      ? "normal"
      : priorModelRouteState.currentSceneMode,
    sexualContextActive: sceneClassification.sceneReset
      ? sceneClassification.sexualContextActive
      : sceneClassification.sexualContextActive ||
        priorModelRouteState.sexualContextActive === true,
    activeConsentMode: requestedConsentMode,
    charactersPresent: [ch.name, personaDisplayName],
    currentPov: contextBuildInput.narrativePov,
    sceneReset: sceneClassification.sceneReset,
    ...(sceneClassification.sceneReset ? {} : extractedHandoffContinuity),
  });
  let fallbackAdultContext:
    | {
        systemPrompt: string;
        history: ChatMsg[];
        openRouterSystemSplit: typeof openRouterSystemSplitForTurn;
        promptAudit: typeof built.meta.promptAudit;
        trackedSections: typeof built.meta.trackedSections;
        rawTurnsIncluded: number;
        rawTokensIncluded: number;
      }
    | null = null;
  if (adultDeliveryPlan.fallbackPrepared && !sceneClassification.hardStop) {
    const fallbackVariants = selectAdultHandoffRawVariants(
      canonicalRecentHistoryFull,
      {
        baseExchanges: adultRoutingConfig.baseRawExchanges,
        targetExchanges: adultRoutingConfig.handoffTargetRawExchanges,
        extraRawTokens: adultRoutingConfig.handoffExtraRawTokens,
      }
    );
    const fallbackRaw = fallbackVariants.handoff;
    const fallbackHistory = selectLongerHistorySuffix(
      fallbackRaw.history,
      coverageProtectedCanonicalHistory
    );
    const fallbackCanonPolicy = resolveCanonInjectionPolicy(
      adultFallbackModelId,
      { userId: user.id, chatId: chat.id }
    );
    const fallbackMemoryInjection = initialMemoryInjection;
    let fallbackBuilt = assembleContext(() =>
      buildContext({
        ...contextBuildInput,
        modelId: adultFallbackModelId,
        provider: "openrouter" as const,
        shortTermHistory: fallbackHistory,
        longTermMemory: fallbackMemoryInjection.text,
        archiveMemory: fallbackMemoryInjection.archiveText,
        preserveAdultHandoffRawHistory: true,
        adultHandoffRequiredTurnFloor: fallbackRaw.rawTurnsIncluded,
        canonInjectionPolicy: fallbackCanonPolicy,
      })
    );
    if (memoryFeatureOn) {
      const fallbackReconciliation = await reconcileMemoryCoverageFixedPoint({
        initialBuild: fallbackBuilt,
        initialMemory: fallbackMemoryInjection,
        initialLtmCutoff: initialLorebookExcludeTurnStart,
        failSafeLtmCutoff: completedTurnsForMemoryCoverage + 1,
        readCoverage: (context) => ({
          degraded: context.meta.memoryCoverage?.degraded === true,
          firstRawPlayableTurn:
            context.meta.memoryCoverage?.firstRawPlayableTurn ?? null,
          gapTurns: context.meta.memoryCoverage?.gapTurns ?? 0,
          estimatedInputTokens: context.meta.estimatedInputTokens ?? 0,
        }),
        rebuildMemory: (excludeSummaryTurnStartGte) =>
          buildMemoryContextForPreview({
            chatId: chat.id,
            tier: memoryTier,
            memoryCapacity,
            userMessage: autoContinueContext ? CONTINUE_USER_DISPLAY : displayUserMessage,
            modelId: adultFallbackModelId,
            provider: "openrouter",
            excludeSummaryTurnStartGte,
          }),
        rebuildContext: (reconciledMemory) =>
          assembleContext(() =>
            buildContext({
              ...contextBuildInput,
              modelId: adultFallbackModelId,
              provider: "openrouter" as const,
              shortTermHistory: fallbackHistory,
              longTermMemory: reconciledMemory.text,
              archiveMemory: reconciledMemory.archiveText,
              preserveAdultHandoffRawHistory: true,
              adultHandoffRequiredTurnFloor: fallbackRaw.rawTurnsIncluded,
              canonInjectionPolicy: fallbackCanonPolicy,
              suppressMemoryCoverageDegradedLog: true,
            })
          ),
      });
      fallbackBuilt = fallbackReconciliation.build;
      if (fallbackReconciliation.nonconvergent) {
        console.warn("MEMORY_COVERAGE_RECONCILE_NONCONVERGENT", {
          passes: fallbackReconciliation.passes,
          initial_first_raw_turn: fallbackReconciliation.initialFirstRawTurn,
          final_first_raw_turn: fallbackReconciliation.finalFirstRawTurn,
          final_ltm_cutoff: fallbackReconciliation.finalLtmCutoff ?? null,
          gap_turns: fallbackBuilt.meta.memoryCoverage?.gapTurns ?? 0,
          middle_hole_turns: fallbackReconciliation.middleHoleTurns,
          estimated_input_tokens: fallbackBuilt.meta.estimatedInputTokens ?? 0,
        });
      }
    }
    let fallbackSystemPrompt = fallbackBuilt.systemPrompt;
    let fallbackSystemSplit = fallbackBuilt.openRouterSystemSplit;
    if (statusWidgetActive) {
      fallbackSystemPrompt = applyStatusWidgetSystemPromptOverrides(
        fallbackSystemPrompt
      );
      if (fallbackSystemSplit) {
        fallbackSystemSplit =
          patchOpenRouterSplitForStatusWidget(fallbackSystemSplit);
      }
    }
    fallbackSystemPrompt = appendAdultHandoffPrompt(
      fallbackSystemPrompt,
      continuityPacket
    );
    fallbackSystemSplit = appendAdultHandoffToSystemSplit(
      fallbackSystemSplit,
      continuityPacket
    );
    fallbackAdultContext = {
      systemPrompt: fallbackSystemPrompt,
      history: fallbackBuilt.history,
      openRouterSystemSplit: fallbackSystemSplit,
      promptAudit: fallbackBuilt.meta.promptAudit,
      trackedSections: fallbackBuilt.meta.trackedSections,
      rawTurnsIncluded: fallbackHistory.filter(
        (message) => message.role === "assistant"
      ).length,
      rawTokensIncluded: fallbackHistory.reduce(
        (total, message) => total + estimateTokens(message.content),
        0
      ),
    };
  }
  let system = systemPromptForTurn;
  let history: ChatMsg[] = built.history;
  let promptAudit = built.meta.promptAudit;
  let promptAuditRef = promptAudit;
  let trackedSectionsRef = built.meta.trackedSections ?? [];
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
  let deliveredSelectedAI: SelectedAI = effectiveSelectedAI;
  let deliveredModelId = openRouterApiModelId;
  let deliveredProvider = primaryProvider;
  let deliveredActiveRoute: ActiveModelRoute = "general";
  let adultFallbackAttempted = false;
  let adultFallbackSucceeded = false;
  let hiddenFallbackOverheadCostUsd = 0;
  let adultRouteStartedAt = requestStartedAt;
  const targetResponseCharsRef = targetResponseChars;
  const recentHistoryRef = recentHistory;
  const resolvedUserMessageRef = promptUserMessage;
  const policyUserMessageRef = policyUserMessage;
  let systemRef = system;
  let openRouterSystemSplitRef = openRouterSystemSplitForTurn;
  let statusWindowPolicyRef = built.statusWindowPolicy;
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
  let historyRef = history;

  // ── Durable turn bootstrap (before model call) ───────────────────────────
  const persistenceDiag: StreamingPersistenceDiag = {
    requestId: clientRequestId,
    userMessageSaved: false,
    assistantPlaceholderCreated: false,
    partialSaveCount: 0,
    lastPartialChars: 0,
    finalized: false,
    interrupted: false,
    postprocessError: false,
    recoveredOnLoad: false,
    reusedExisting: false,
  };

  const existingByRequest = findTurnByRequestId(db, chatRef.id, clientRequestId);
  const alreadyCompletedTurn =
    existingByRequest.assistantMessageId != null &&
    (existingByRequest.assistantStatus === "completed" ||
      existingByRequest.assistantStatus === "ok" ||
      existingByRequest.assistantStatus === "completed_with_postprocess_error");

  const bootstrapped = alreadyCompletedTurn
    ? {
        requestId: clientRequestId,
        userMessageId: existingByRequest.userMessageId,
        assistantMessageId: existingByRequest.assistantMessageId!,
        reusedExisting: true,
        userMessageSaved: true,
        assistantPlaceholderCreated: false,
      }
    : bootstrapStreamingTurn(db, {
        chatId: chatRef.id,
        requestId: clientRequestId,
        userContent: messageText,
        skipUserInsert,
        existingUserMessageId: userMessageId,
        regenerateAssistantId: regenerateMessageId,
        onUserInserted: (insertedUserMessageId) => {
          if (effectiveUserAuthoring) {
            persistUserCoauthorAfterSuccessfulUserInsert(db, {
              chatId: chat.id,
              userMessageId: insertedUserMessageId,
              persistentAfter: effectiveUserAuthoring.persistentAfter,
            });
          }
          incrementCharacterTotalTurns(db, ch.id);
        },
      });
  userMessageId = bootstrapped.userMessageId;
  const persistedAssistantId = bootstrapped.assistantMessageId;
  skipUserInsert = true; // already saved (or regenerate)
  persistenceDiag.userMessageSaved = bootstrapped.userMessageSaved;
  persistenceDiag.assistantPlaceholderCreated = bootstrapped.assistantPlaceholderCreated;
  persistenceDiag.reusedExisting = bootstrapped.reusedExisting;
  if (oocSceneRenderTurn) {
    persistGenerationSemanticsOnMessages(db, {
      userMessageId,
      assistantMessageId: persistedAssistantId,
      semantics: generationSemantics,
    });
  }
  if (
    !personaSecretDiscoveryOn &&
    bootstrapped.userMessageSaved &&
    !oocSceneRenderTurn &&
    personaSecretBoundaryOn &&
    resolvedPersonaId &&
    pendingPersonaSecretRevealCandidates.length > 0
  ) {
    persistPersonaSecretRevealCandidates({
      chatId: chatRef.id,
      personaId: resolvedPersonaId,
      revealedAtTurn: playableTurnCount + 1,
      candidates: pendingPersonaSecretRevealCandidates,
    });
  }

  const publicDiscoveryInputs = extractPublicChatDiscoveryInputs(
    body as Record<string, unknown>
  );

  const discoveryWritesAllowed =
    personaSecretDiscoveryOn &&
    bootstrapped.userMessageSaved &&
    userMessageId != null &&
    !autoContinueContext &&
    !regenerate &&
    !oocSceneRenderTurn &&
    messageText.trim() &&
    !isContinueUserMessage(messageText);

  // PR-S1: direct disclosure first — after durable user-message bootstrap so evidence
  // stores the real sourceMessageId. 0 knowledge/evidence writes on regenerate/continue/save-fail.
  if (discoveryWritesAllowed && resolvedPersonaId) {
    const matches = detectDeterministicDirectDisclosures(
      messageText,
      resolvedPersonaId
    );
    for (const match of matches) {
      confirmPersonaSecretDisclosure({
        chatId: chatRef.id,
        personaId: resolvedPersonaId,
        secretId: match.secret.id,
        characterId: ch.id,
        turnNumber: playableTurnCount + 1,
        sourceMessageId: userMessageId,
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        discoveryRuleId: match.rule.id,
        revealedFactText: match.revealedFactText,
        authority: personaSecretAuthority,
        idempotencyKey: buildDeterministicDisclosureIdempotencyKey({
          chatId: chatRef.id,
          personaId: resolvedPersonaId,
          secretId: match.secret.id,
          characterId: ch.id,
          sourceMessageId: userMessageId,
          turnNumber: playableTurnCount + 1,
        }),
        evidenceJson: { matchedAlias: match.matchedAlias },
      });
    }
  }

  // PR-S4A: user-allowed scene presence only (never SERVER/CREATOR from public body).
  if (discoveryWritesAllowed) {
    if (publicDiscoveryInputs.scenePresenceActions.length > 0) {
      applyScenePresenceActions({
        chatId: chatRef.id,
        turnNumber: playableTurnCount + 1,
        actions: publicDiscoveryInputs.scenePresenceActions,
        userId: user.id,
      });
    }
  }

  // PR-S2A/S2B/S3/S4D: direct disclosure → scene evidence → visual → investigation → transfer → rebuild known-facts.
  // Authoritative outcomes/transfers are NOT read from the public chat body.
  // Shares discoveryWritesAllowed with direct disclosure so a turn whose user message
  // never persisted cannot write evidence/knowledge with a null sourceMessageId.
  if (discoveryWritesAllowed) {
    const sceneActions = parseSceneEvidenceExplicitActions(body.sceneActions);
    if (resolvedPersonaId) {
      runHomeDiscoveryTurn({
        chatId: chatRef.id,
        characterId: ch.id,
        personaId: resolvedPersonaId,
        turnNumber: playableTurnCount + 1,
        sourceMessageId: userMessageId,
        userMessage: messageText,
        explicitSceneActions: sceneActions,
        investigationActions: publicDiscoveryInputs.investigationActions,
        userId: user.id,
      });
    } else {
      extractAndPersistSceneEvidence({
        chatId: chatRef.id,
        characterId: ch.id,
        turnNumber: playableTurnCount + 1,
        sourceMessageId: userMessageId,
        userMessage: messageText,
        explicitActions: sceneActions,
        publicPersonaId: resolvedPersonaId,
        userId: user.id,
      });
    }

    if (resolvedPersonaId) {
      // PR-S4D: user transfers only; server assigns sourceMessageId from saved turn.
      if (
        publicDiscoveryInputs.knowledgeTransferActions.length > 0 &&
        userMessageId != null
      ) {
        runKnowledgeTransfersForTurn({
          chatId: chatRef.id,
          personaId: resolvedPersonaId,
          characterId: ch.id,
          turnNumber: playableTurnCount + 1,
          userActions: publicDiscoveryInputs.knowledgeTransferActions.map(
            (a) => ({
              ...a,
              sourceMessageId: userMessageId,
              actionId: undefined,
              authoritativeEventId: undefined,
            })
          ),
          // Internal-only — never body.knowledgeTransferAuthoritativeActions.
          authoritativeActions: [],
          userId: user.id,
        });
      }

      // PR-S4C: reuse the same request decision (never re-resolve to main-character fallback).
      const rebuiltPersonaWithS4 = buildPersonaKnowledgeWithS4ForTurn({
        decision: personaKnowledgePromptDecision,
        chatId: chatRef.id,
        personaId: resolvedPersonaId,
        authority: personaSecretAuthority,
        allowS4: s4LiveProducerAllowed,
      });
      s4GenerationTransferContext = rebuiltPersonaWithS4.s4Context;
      const updatedKnownFacts = rebuiltPersonaWithS4.block;

      // Same-turn reaction: rebuild prompt after visual/investigation/transfer knowledge transitions.
      if (updatedKnownFacts !== revealedPersonaFactsBlock) {
        revealedPersonaFactsBlock = updatedKnownFacts;
        const rebuilt = assembleContext(() =>
          buildContext({
            ...contextBuildInput,
            revealedPersonaFactsBlock: revealedPersonaFactsBlock ?? undefined,
            statusWidgetActive: statusWidgetActive,
            mainModelOwnsRelationshipExtract,
            promptDumpSource: "db",
            promptDumpDetail: `chat=${chat.id} user=${user.id} character=${ch.id}`,
          })
        );
        systemPromptForTurn = rebuilt.systemPrompt;
        openRouterSystemSplitForTurn = rebuilt.openRouterSystemSplit;
        if (statusWidgetActive) {
          systemPromptForTurn = applyStatusWidgetSystemPromptOverrides(systemPromptForTurn);
          if (openRouterSystemSplitForTurn) {
            openRouterSystemSplitForTurn = patchOpenRouterSplitForStatusWidget(
              openRouterSystemSplitForTurn
            );
          }
        }
        system = systemPromptForTurn;
        history = rebuilt.history;
        promptAudit = rebuilt.meta.promptAudit;
        promptAuditRef = promptAudit;
        trackedSectionsRef = rebuilt.meta.trackedSections ?? [];
        systemRef = system;
        openRouterSystemSplitRef = openRouterSystemSplitForTurn;
        historyRef = history;
        statusWindowPolicyRef = rebuilt.statusWindowPolicy;
      }
    }
  }

  const alreadyBilledForRequest = existingByRequest.alreadyBilled;

  const stream = new ReadableStream({
    async start(controller) {
      const executeStream = async () => {
      const safe = createDisconnectSafeSend(
        (chunk) => controller.enqueue(chunk),
        sseEncode
      );
      const send = safe.send;
      const postprocessHeartbeat = createStreamPostprocessHeartbeat((obj) => send(obj));
      // Immediate heartbeat — mobile clients otherwise sit on a dark/idle screen
      // while prompt assembly + model connect can take tens of seconds.
      send({
        type: "status",
        message: regenerateMessageId ? "재생성 준비 중…" : "생성 중…",
        generationUi: generationPreparationUi,
      });
      const stages: StageUsage[] = [];
      let fullText = "";
      let streamVisibleTextRef = "";
      let rawStreamTextRef = "";
      let rawProsePersisted = false;
      let postprocessStarted = false;
      let widgetExtractLatencyMs: number | null = null;
      let widgetExtractAttempts: number | null = null;
      let widgetExtractResult: string | null = null;
      let sseDoneAttempted = false;
      let mainProviderFinished = false;
      let mainFinishReason: string | null = null;

      const emitStreamTurnForensics = (assistantFinalizeStatus: string | null) => {
        if (!clientRequestId) return;
        const forensicsContent = streamVisibleTextRef || fullText;
        logStreamTurnForensics({
          request_id: clientRequestId,
          chat_id: chatRef.id,
          assistant_message_id: persistedAssistantId,
          model: deliveredModelId ?? null,
          main_provider_finished: mainProviderFinished,
          main_finish_reason: mainFinishReason,
          main_visible_chars: forensicsContent.length,
          raw_prose_persisted: rawProsePersisted,
          postprocess_started: postprocessStarted,
          status_widget_active: statusWidgetActive,
          status_widget_attempts: widgetExtractAttempts,
          status_widget_latency_ms: widgetExtractLatencyMs,
          status_widget_result: widgetExtractResult,
          assistant_finalize_status: assistantFinalizeStatus,
          sse_done_attempted: sseDoneAttempted,
          client_disconnect_seen: safe.isDisconnected(),
          total_server_ms: Date.now() - requestStartedAt,
          content_length: forensicsContent.length,
          content_hash: hashForensicsText(forensicsContent),
        });
      };

      const partialSaver = createPartialSaveThrottler();

      const persistPartialBestEffort = (text: string) => {
        try {
          if (partialSaver.maybeSave(db, persistedAssistantId, text)) {
            persistenceDiag.partialSaveCount = partialSaver.partialSaveCount;
            persistenceDiag.lastPartialChars = partialSaver.lastPartialChars;
          }
        } catch (e) {
          console.warn("[StreamingPersistence] partial save failed", (e as Error).message);
        }
      };

      const clearPartialTimer = () => {
        if (partialTimer) {
          clearInterval(partialTimer);
          partialTimer = null;
        }
      };

      const stopPostprocessHeartbeat = () => {
        postprocessHeartbeat.stop();
      };

      let partialTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (streamVisibleTextRef.trim()) persistPartialBestEffort(streamVisibleTextRef);
      }, 800);

      try {
        send({
          type: "turn_persisted",
          requestId: clientRequestId,
          chatId: chatRef.id,
          userMessageId,
          messageId: persistedAssistantId,
        });

        if (alreadyCompletedTurn) {
          const row = db
            .prepare(`SELECT content, usage FROM messages WHERE id=? AND chat_id=?`)
            .get(persistedAssistantId, chatRef.id) as
            | { content: string; usage: string | null }
            | undefined;
          const content = row?.content ?? "";
          const rawCompletedUsage = row?.usage
            ? (JSON.parse(row.usage) as Usage)
            : null;
          const usage = rawCompletedUsage
            ? stripAdultRoutingForClient(
                stripMuseAcceptanceFromUsage(rawCompletedUsage),
                { keepInternal: showFullBillingReceipt }
              )
            : null;
          send({ type: "replace", text: content, instant: true });
          send({
            type: "done",
            chatId: chatRef.id,
            messageId: persistedAssistantId,
            userMessageId,
            requestId: clientRequestId,
            finalContent: content,
            usage,
            alreadyCompleted: true,
            ...readOocSceneClientFlags(rawCompletedUsage),
          });
          persistenceDiag.finalized = true;
          persistenceDiag.recoveredOnLoad = true;
          logStreamingPersistence(persistenceDiag);
          clearPartialTimer();
          stopPostprocessHeartbeat();
          controller.close();
          return;
        }

        console.log("[/api/chat] routing decision", {
          isAdultModeInput,
          isAdultMode,
          chatMode: chatRef.mode,
          userAdultVerified: !!user.is_adult,
          strategy: `${primaryProvider}-direct`,
          openRouterModel: openRouterApiModelId,
          billingOpenRouterModel: billingOpenRouterModelId,
          selectedAI: selectedAIRef,
          hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
          hasCheaperInferenceKey: Boolean(
            process.env.CHEAPER_INFERENCE_API_KEY?.trim()
          ),
        });

        send({
          type: "status",
          message: "생성 중…",
          generationUi: generationPreparationUi,
        });

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
          const shouldBufferGeneral =
            adultDeliveryPlan.fallbackPrepared && fallbackAdultContext != null;
          const streamGate = createInitialStreamBuffer(
            send,
            shouldBufferGeneral
              ? adultRoutingConfig.initialStreamBufferChars
              : 0
          );
          const sessionId = regenerateMessageId
            ? `chat-${chatRef.id}-regen-${regenerateMessageId}-${regenAttemptId ?? Date.now()}`
            : chatRef.id
              ? `chat-${chatRef.id}`
              : undefined;

          const runStream = async (input: {
            send: (obj: object) => void;
            system: string;
            history: ChatMsg[];
            systemSplit: typeof openRouterSystemSplitRef;
            modelId: string;
            selectedModel: SelectedAI;
            provider: typeof primaryProvider;
            adultRoute: boolean;
            requestKind?: string;
          }) => {
            const requestHistory =
              input.provider === "openai"
                ? input.history
                : convertToOpenRouterFormat(input.history);
            const terraChat = isGpt56TerraModel(input.modelId);
            const requestSystem = terraChat
              ? buildTerraInstructions(input.system)
              : input.system;
            return streamOpenRouterAdultToClient(
              input.send,
              requestSystem,
              requestHistory,
              input.modelId,
              selectedAILabel(input.selectedModel),
              targetResponseCharsRef,
              {
                charName: ch.name,
                personaName: personaDisplayName,
                systemSplit: input.systemSplit,
                sessionId,
                oocHtmlMode: oocHtmlMode || undefined,
                statusArtifactsOpts: statusArtifactOpts,
                requestKind: input.requestKind,
                sceneServerControls: {
                  contentKind:
                    ch.content_kind === "simulation" ? "simulation" : "character",
                  party: false,
                  primaryCharacterName: ch.name,
                  currentUserMessage: policyUserMessage,
                  recentMessages: promptHistory,
                  knownSupportingCastNames: undefined,
                  establishedActiveCastNames:
                    ch.content_kind === "simulation"
                      ? extractSimulationCastNames(ch.simulation_cast ?? "")
                      : undefined,
                  adultModeEnabled: isAdultMode,
                  chatId: chat.id,
                  currentTurn: sceneProgressionTurn,
                  progressionHistory: sceneProgressionState.recent,
                },
                generationOverrides: (() => {
                  const regen = regenerateMessageId
                    ? resolveRegenerateGenerationOverrides(
                        input.modelId,
                        targetResponseCharsRef
                      )
                    : undefined;
                  if (canaryTemperature == null) return regen;
                  return { ...(regen ?? {}), temperature: canaryTemperature };
                })(),
                ...(input.provider === "openai" ||
                input.provider === "cheaperinference" ||
                shouldBufferGeneral
                  ? { allowOpenRouterUnderLengthRecovery: false }
                  : {}),
                ...(input.provider === "cheaperinference"
                  ? { transportProvider: "cheaperinference" as const }
                  : {}),
                ...(resolveDeepSeekAdultHandoffTrueOff({
                  selectedModelId: selectedAIRef,
                  adultHandoffActuallyApplied: input.adultRoute,
                  resolvedTargetModelId: input.modelId,
                })
                  ? { deepSeekAdultHandoffTrueOff: true as const }
                  : {}),
                ...(input.adultRoute
                  ? {
                      providerRouting:
                        buildAdultProviderRoutingRequest(adultRoutingConfig),
                    }
                  : {}),
              },
              turnApiBudget
            );
          };

          const runAdultFallback = async () => {
            adultFallbackAttempted = true;
            streamGate.discard();
            const fallback = fallbackAdultContext!;
            const fallbackResult = await runStream({
              send,
              system: fallback.systemPrompt,
              history: fallback.history,
              systemSplit: fallback.openRouterSystemSplit,
              modelId: adultFallbackModelId,
              selectedModel: adultFallbackModelId as SelectedAI,
              provider: "cheaperinference",
              adultRoute: true,
              requestKind: "adult-general-refusal-fallback",
            });
            adultFallbackSucceeded = true;
            deliveredSelectedAI =
              adultFallbackModelId as SelectedAI;
            deliveredModelId = adultFallbackModelId;
            deliveredProvider = "cheaperinference";
            systemRef = fallback.systemPrompt;
            historyRef = fallback.history;
            openRouterSystemSplitRef = fallback.openRouterSystemSplit;
            promptAuditRef = fallback.promptAudit;
            trackedSectionsRef = fallback.trackedSections ?? [];
            handoffRawTurnsIncluded = fallback.rawTurnsIncluded;
            handoffRawTokensIncluded = fallback.rawTokensIncluded;
            return fallbackResult;
          };

          let result: Awaited<
            ReturnType<typeof streamOpenRouterAdultToClient>
          >;
          try {
            result = await runStream({
              send: streamGate.send,
              system: systemRef,
              history: historyRef,
              systemSplit: openRouterSystemSplitRef,
              modelId: deliveredModelId,
              selectedModel: deliveredSelectedAI,
              provider: deliveredProvider,
              adultRoute: false,
            });
          } catch (primaryError) {
            const adultRefusalFallback =
              await invokePreparedAdultRefusalFallback({
                plan: adultDeliveryPlan,
                fallbackContextAvailable: fallbackAdultContext != null,
                error: primaryError,
                hasVisibleTokens: streamGate.hasVisibleTokens(),
                fallbackAlreadyAttempted: adultFallbackAttempted,
                runFallback: runAdultFallback,
              });
            if (adultRefusalFallback.invoked) {
              result = adultRefusalFallback.result;
            } else {
              streamGate.flush();
              throw primaryError;
            }
          }

          if (!adultFallbackSucceeded) {
            const adultRefusalFallback =
              await invokePreparedAdultRefusalFallback({
                plan: adultDeliveryPlan,
                fallbackContextAvailable: fallbackAdultContext != null,
                text: result.text,
                finishReason: result.stage.finishReason,
                hasVisibleTokens: streamGate.hasVisibleTokens(),
                fallbackAlreadyAttempted: adultFallbackAttempted,
                runFallback: runAdultFallback,
              });
            if (adultRefusalFallback.invoked) {
              hiddenFallbackOverheadCostUsd =
                result.stage.upstreamCostUsd ?? 0;
              result = adultRefusalFallback.result;
            } else {
              streamGate.flush();
            }
          }
          fullText = result.text;
          streamVisibleTextRef = result.streamVisibleText ?? fullText;
          rawStreamTextRef = result.rawStreamText ?? fullText;
          stages.push(result.stage);
          openRouterRemovalTraceSteps = result.removalTraceSteps;
          if (result.recoveryStage) stages.push(result.recoveryStage);
          try {
            persistStreamCompleteContent(db, persistedAssistantId, streamVisibleTextRef || fullText);
            persistenceDiag.lastPartialChars = (streamVisibleTextRef || fullText).length;
            rawProsePersisted = true;
            postprocessStarted = true;
          } catch (persistErr) {
            console.warn(
              "[StreamingPersistence] post-stream save failed",
              (persistErr as Error).message
            );
          }
          send({ type: "status", message: "마무리 중…" });
          postprocessHeartbeat.start("postprocess");
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
              model: deliveredModelId,
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
          clearPartialTimer();
          stopPostprocessHeartbeat();
          if (e instanceof DegenerationAbortError || e instanceof MetaLeakageAbortError) {
            console.warn(
              e instanceof MetaLeakageAbortError
                ? "[/api/chat] OpenRouter META_LEAKAGE_ABORT — billing skipped"
                : "[/api/chat] OpenRouter DEGENERATION_ABORT — billing skipped"
            );
            const partial = streamVisibleTextRef || fullText;
            try {
              markAssistantFailed(db, persistedAssistantId, partial);
              if (regenerateMessageId) {
                restoreAssistantFromAlternatesOnFailedRegen(db, regenerateMessageId, chatRef.id);
              }
              persistenceDiag.interrupted = true;
              logStreamingPersistence(persistenceDiag);
            } catch {
              /* ignore */
            }
            if (e instanceof MetaLeakageAbortError) {
              send({ type: "reset" });
            } else if (partial.trim().length < CATASTROPHIC_MIN_RESPONSE_CHARS) {
              send({ type: "reset" });
            }
            send({ type: "error", error: DEGENERATION_USER_MESSAGE });
            controller.close();
            return;
          }
          console.error("[/api/chat] OpenRouter 생성 실패:", (e as Error).message);
          try {
            markAssistantFailed(db, persistedAssistantId, streamVisibleTextRef || fullText);
            if (regenerateMessageId) {
              restoreAssistantFromAlternatesOnFailedRegen(db, regenerateMessageId, chatRef.id);
            }
            persistenceDiag.interrupted = true;
            logStreamingPersistence(persistenceDiag);
          } catch {
            /* ignore */
          }
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
          "normalizeProseLineEndings",
          traced,
          normalizeProseLineEndings(traced).trimEnd(),
          "normalizeProseLineEndings — canonical prose line endings only"
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
        traced = traceStep(
          "stripRuntimePromptContamination",
          traced,
          stripRuntimePromptContaminationFromVisibleOutput(traced),
          "stripRuntimePromptContamination - speech/status/memory internal metadata leakage"
        );
        traced = traceStep(
          "stripUnexpectedForeignScriptLeak",
          traced,
          stripUnexpectedForeignScriptLeak(traced),
          "stripUnexpectedForeignScriptLeak — accidental Cyrillic/Arabic/Devanagari in Korean RP"
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
          const proseWithoutS4 = stripS4ServerControlFromText(fullText);
          statusArtifacts = {
            prose: proseWithoutS4,
            capturedTableMarkdown: null,
            capturedHtmlFence: null,
          };
          afterClampText = proseWithoutS4;
          savedText = traceStep(
            "stripEmotionTagsForDisplay",
            proseWithoutS4,
            stripEmotionTagsForDisplay(proseWithoutS4),
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
                normalizeProseLineEndings(
                  sanitizeEmotionTagInText(
                    sanitizeStreamArtifacts(modelDeliveredText),
                    assetTags
                  )
                ).trimEnd(),
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
          try {
            markAssistantFailed(db, persistedAssistantId, "");
            if (regenerateMessageId) {
              restoreAssistantFromAlternatesOnFailedRegen(db, regenerateMessageId, chatRef.id);
            }
            persistenceDiag.interrupted = true;
            logStreamingPersistence(persistenceDiag);
          } catch {
            /* ignore */
          }
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
          try {
            markAssistantFailed(db, persistedAssistantId, streamVisibleTextRef || savedText);
            if (regenerateMessageId) {
              restoreAssistantFromAlternatesOnFailedRegen(db, regenerateMessageId, chatRef.id);
            }
            persistenceDiag.interrupted = true;
            logStreamingPersistence(persistenceDiag);
          } catch {
            /* ignore */
          }
          if ((streamVisibleTextRef || savedText).trim().length < CATASTROPHIC_MIN_RESPONSE_CHARS) {
            send({ type: "reset" });
          }
          send({ type: "error", error: DEGENERATION_USER_MESSAGE });
          controller.close();
          return;
        }

        // Interactive user-impersonation detector — log only; never auto-repair unless flagged.
        let ownershipTelemetry: MuseOwnershipTelemetry = null;
        if (!oocHtmlMode) {
          const impersonationHit = detectInteractiveUserImpersonation(savedText, {
            mode: runtimeMode,
            userAliases: [personaDisplayName, user.nickname, "{{user}}", "[B]"].filter(Boolean),
          });
          logUserImpersonationGuard({
            mode: runtimeMode,
            detected: impersonationHit.detected,
            severity: impersonationHit.severity,
            reason: impersonationHit.reason,
            matchedPhrase: impersonationHit.matchedPhrase,
            autoRepairEnabled: isUserImpersonationAutoRepairEnabled(),
            repairAttempted: false,
          });

          const userAuthoredHistory = recentHistoryRef
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .slice(-8);
          const shadowResult = runOwnershipShadowGuardV2({
            mode: runtimeMode,
            text: savedText,
            userAliases: [personaDisplayName, user.nickname, "{{user}}", "[B]"].filter(Boolean),
            actorNames: [ch.name],
            currentUserInput: policyUserMessageRef,
            userAuthoredHistory,
            messageRef: persistedAssistantId,
            chatId: chatRef.id,
            modelId: deliveredModelId,
            route: "/api/chat",
          });
          if (shadowResult) {
            ownershipTelemetry = {
              hardCount: shadowResult.hardCount,
              softCount: shadowResult.softCount,
              categoryBitmask: shadowResult.categoryBitmask,
              confidenceBucket: shadowResult.confidenceBucket,
              processingMs: shadowResult.processingMs,
            };
            logOwnershipShadowGuardV2(shadowResult, {
              mode: runtimeMode,
              text: savedText,
              messageRef: persistedAssistantId,
              chatId: chatRef.id,
              modelId: deliveredModelId,
              route: "/api/chat",
            });
          }

          if (runtimeMode === "auto_progression") {
            const povHit = detectUserPovTakeover(savedText, {
              mode: "auto_progression",
              userAliases: [personaDisplayName, user.nickname, "{{user}}", "[B]"].filter(
                Boolean
              ),
            });
            logUserPovTakeover({ ...povHit, mode: "auto_progression" });
          }
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
          if (!postprocessHeartbeat.isActive()) {
            postprocessHeartbeat.start("postprocess");
          }
          const contResult = await continueNarrativeIfUnderMinimum({
            prose: proseOnly,
            system: systemRef,
            modelId: deliveredModelId,
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
          if (!postprocessHeartbeat.isActive()) {
            postprocessHeartbeat.start(
              placement === "bottom" ? "status_widget" : "postprocess"
            );
          } else if (placement === "bottom") {
            postprocessHeartbeat.setPhase("status_widget");
          }

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

        const billableStages = selectBillableStages(stages, {
          refusalFallbackDelivered: adultFallbackSucceeded,
        });
        const primaryStage = billableStages[0];
        mainProviderFinished = true;
        mainFinishReason = primaryStage?.finishReason ?? null;
        let generationFailure = detectAdultGenerationFailure(
          primaryStage?.finishReason,
          savedText,
          targetResponseCharsRef,
          visibleForLengthCheck
        );
        const terraInterruptedTurn =
          isGpt56TerraModel(deliveredModelId) &&
          isRetryableTerraFinishReason(primaryStage?.finishReason) &&
          resolveVisibleTierCharCount(savedText) >= CATASTROPHIC_MIN_RESPONSE_CHARS;

        if (generationFailure === "under_length" && terraInterruptedTurn) {
          console.warn("[/api/chat] preserving billable partial Terra response", {
            finishReason: primaryStage?.finishReason,
            outputChars: savedText.length,
            targetResponseChars: targetResponseCharsRef,
          });
          generationFailure = null;
        }

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

        // Adult scene explicit exit (OOC stop / clear transition) may return a short
        // general-model acknowledgment. Do not fail the handoff return as under_length.
        const adultExplicitExitThisTurn =
          sceneClassification.hardStop && deliveredActiveRoute === "general";
        if (
          generationFailure === "under_length" &&
          adultExplicitExitThisTurn &&
          savedText.trim().length > 0 &&
          (primaryStage?.finishReason ?? "").toLowerCase() === "stop"
        ) {
          console.warn("[/api/chat] under_length waived — adult explicit scene exit", {
            outputChars: savedText.length,
            routeTriggerReason: adultRouteDecision.routeTriggerReason,
            deliveredModelId,
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
          clearPartialTimer();
          stopPostprocessHeartbeat();
          try {
            markAssistantFailed(db, persistedAssistantId, savedText || streamVisibleTextRef);
            if (regenerateMessageId) {
              restoreAssistantFromAlternatesOnFailedRegen(db, regenerateMessageId, chatRef.id);
            }
            persistenceDiag.interrupted = true;
            logStreamingPersistence(persistenceDiag);
          } catch {
            /* ignore */
          }
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
            messageId: persistedAssistantId,
            userMessageId,
            requestId: clientRequestId,
          });
          controller.close();
          return;
        }
        const persistedGenerationStatus = terraInterruptedTurn
          ? ("interrupted" as const)
          : ("completed" as const);

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
          deliveredModelId ?? "",
          opusApiOutputTokens,
          summedApiReasoning
        );

        const billableChars = billableOutputChars(savedText, targetResponseCharsRef, billableOpts);

        const billingProvider = deliveredProvider;
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
          gemini37FlashPricing?: Gemini37FlashPricingBreakdown;
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
            selectedAI: deliveredSelectedAI,
            openRouterModelId: deliveredModelId,
            inputTokens: totalInput,
            outputTokens: totalOutput,
            reasoningTokens: summedApiReasoning,
            cacheReadTokens: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens,
            cacheWriteTokens: primaryStage?.cacheWriteTokens,
            userContextChars,
            savedTextChars: billableChars,
            completedTurnsBeforeRequest: playableTurnCount,
            modelLabel: selectedAILabel(deliveredSelectedAI),
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
            deliveredModelId && /opus/i.test(deliveredModelId)
              ? explainOpenRouterOpusTurnCost(
                  totalInput,
                  totalOutput,
                  deliveredModelId,
                  billableChars,
                  cacheOpts
                )
              : null;
          const deepSeekExplain =
            deliveredModelId && isDeepSeekV4ProModel(deliveredModelId)
              ? explainOpenRouterDeepSeekTurnCost(
                  totalInput,
                  totalOutput,
                  deliveredModelId,
                  cacheOpts,
                  summedApiReasoning
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
          const geminiExplain =
            deliveredModelId &&
            (isGemini36FlashModel(deliveredModelId) ||
              isGemini31ProModel(deliveredModelId))
              ? explainOpenRouterGeminiTurnCost(
                  totalInput,
                  totalOutput,
                  deliveredModelId,
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
                  deepSeekCacheNeutralChargeKrw: deepSeekExplain.costPlusMarginKrw,
                  deepSeekCostPlusMarginKrw: deepSeekExplain.costPlusMarginKrw,
                  deepSeekApplied: deepSeekExplain.applied,
                }
              : {}),
            ...(geminiExplain
              ? {
                  geminiRawCostKrw: geminiExplain.rawCostKrw,
                  geminiCostPlusMarginKrw: geminiExplain.costPlusMarginKrw,
                  geminiApplied: geminiExplain.applied,
                }
              : {}),
          });
        }

        const forcedAbort = billableStages.some((s) => s.loopAborted);
        const degenerationAborted = billableStages.some((s) => s.degenerationAborted);
        const usageUnavailable = isIncompleteStreamUsageUnavailable({
          finishReason: primaryStage?.finishReason,
          promptTokens: primaryStage?.apiReportedInputTokens ?? 0,
          completionTokens: primaryStage?.apiOutputTokens ?? 0,
        });
        const billingWaiverReason = shouldWaiveTurnBilling(savedText, {
            forcedAbort,
            degenerationAborted,
            generationFailure,
            usageUnavailable,
            adultMode: true,
            targetResponseChars: targetResponseCharsRef,
          });
        let cost = billingWaiverReason ? 0 : billing.total;

        if (billingWaiverReason && !isMockApiMode()) {
          const modelId = deliveredModelId ?? "";
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
          } else if (isGlmModel(modelId)) {
            waiverMin = resolveGlmWaiverMinimumCharge(savedText, billingWaiverReason, {
              degenerationAborted,
              targetResponseChars: targetResponseCharsRef,
            });
          } else if (isKimiModel(modelId)) {
            waiverMin = resolveKimiWaiverMinimumCharge(savedText, billingWaiverReason, {
              degenerationAborted,
              targetResponseChars: targetResponseCharsRef,
            });
          } else if (isMuseModel(modelId)) {
            waiverMin = resolveMuseWaiverMinimumCharge(savedText, billingWaiverReason, {
              degenerationAborted,
              targetResponseChars: targetResponseCharsRef,
            });
          } else if (isGemini36FlashModel(modelId)) {
            waiverMin = resolveGemini36WaiverMinimumCharge(savedText, billingWaiverReason, {
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
        let keywordLoreEst = 0;
        let keywordLoreFromTracked = false;
        for (const s of trackedSectionsRef) {
          const t = estimateTokens(s.text);
          if (s.id === "recent-narrative-context") narrativeContextEst += t;
          else if (s.id === "current-memory") currentMemoryEst += t;
          else if (s.id === "keyword-lorebook") {
            keywordLoreEst += t;
            keywordLoreFromTracked = true;
          }
        }
        if (narrativeContextEst === 0 && currentMemoryEst === 0) {
          currentMemoryEst = memoryEst;
        }
        // OpenRouter puts keyword lore in dynamic user prefix (not trackedSections/worldLore).
        if (!keywordLoreFromTracked && keywordLorebookBlock) {
          keywordLoreEst = estimateTokens(keywordLorebookBlock);
        }
        // Gemini tracks keyword lore under worldLore → rolled into 캐릭터 프롬프트; split it out.
        if (keywordLoreFromTracked && keywordLoreEst > 0) {
          charPromptEst = Math.max(0, charPromptEst - keywordLoreEst);
        }

        // Provider RAW — latest complete exchanges + soft 10K budget
        const historyEst =
          audit?.breakdown.recentConversation ??
          historyRef.reduce((s, m) => s + estimateTokens(m.content ?? ""), 0);

        const sectionEsts = [
          { key: "raw", est: historyEst },
          ...(narrativeContextEst > 0
            ? [{ key: "narrative" as const, est: narrativeContextEst }]
            : []),
          { key: "character" as const, est: charPromptEst },
          { key: "system" as const, est: sysRulesEst },
          { key: "memory" as const, est: currentMemoryEst },
          { key: "persona" as const, est: personaEst },
          { key: "keyword" as const, est: keywordLoreEst },
          { key: "note" as const, est: userNoteEst },
          { key: "asset" as const, est: assetTagEst },
          { key: "rel" as const, est: memoryMetaEst },
        ];
        const splitChars = openRouterSystemSplitRef;
        const breakdown = buildEstimatedReceiptSectionBreakdown({
          sectionEsts: sectionEsts as import("@/lib/billingReceiptSectionBreakdown").ReceiptSectionEstimate[],
          draftInput,
          splitChars,
          charPromptEst,
          rawHistoryChars,
          rawCompleteExchanges,
        });
        const historyChars = historyRef.reduce((n, m) => n + (m.content?.length ?? 0), 0);
        const currentUserChars = historyRef.at(-1)?.content.length ?? 0;
        const assembledPromptChars = {
          system: (systemRef ?? "").length,
          systemRules: splitChars?.systemRulesBlock.length ?? 0,
          characterSettings: splitChars?.characterSettingsBlock.length ?? 0,
          dynamic: splitChars?.dynamicBlock.length ?? 0,
          history: historyChars,
          currentUser: currentUserChars,
          total:
            (systemRef ?? "").length +
            Math.max(0, historyChars - currentUserChars) +
            currentUserChars,
        };

        const stageCosts = billableStages.map((s) => ({ ...s, cost }));

        const routeMode: Route = isAdultMode ? "nsfw" : "safe";

        const meteredReceiptBilling = isMeteredReceiptProvider(billingProvider);

        const orCacheReceipt = meteredReceiptBilling
          ? buildOpenRouterCacheReceiptInfo({
              modelId: deliveredModelId ?? undefined,
              promptTokens: totalInput,
              cacheReadTokens:
                primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens,
              cacheWriteTokens: primaryStage?.cacheWriteTokens,
              standardInputTokens: primaryStage?.standardInputTokens,
            })
          : null;
        const cacheRateSummary = meteredReceiptBilling
          ? (orCacheReceipt?.rateSummary ??
            resolveOpenRouterRateSummary(deliveredModelId))
          : undefined;
        const cacheFamily = meteredReceiptBilling
          ? (orCacheReceipt?.family ??
            (billingProvider === "openai" ? ("openai" as const) : ("unknown" as const)))
          : undefined;

        const billingExchangeRate = meteredReceiptBilling
          ? resolveBillingExchangeRateSnapshot()
          : null;

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
          (adultFallbackAttempted ? 1 : 0) +
          Math.max(0, primaryStage?.lengthRecoveryPasses ?? 0) +
          lengthContinuationPasses +
          htmlFlashPasses;

        const postSceneClassification = adultRoutingConfig.enabled
          ? classifySceneMode({
              currentInput: savedText,
              previousSceneMode: adultRouteDecision.sceneMode,
              recentRawText: `${recentRawForSceneClassification}\n${storedUserMessage}`,
              adultDialogueProfile: normalizeAdultDialogueProfile(
                ch.adult_dialogue_profile
              ),
              activeConsentMode: requestedConsentMode,
            })
          : null;
        const sceneModeAfter: SceneMode = postSceneClassification?.sceneMode ??
          priorModelRouteState.currentSceneMode;
        const nextGeneralBridge =
          adultRoutingConfig.enabled && adultFallbackSucceeded
            ? buildGeneralRouteBridge({
                ...continuityPacket,
                previousSceneMode: sceneModeAfter,
                sexualContextActive:
                  postSceneClassification?.sexualContextActive ??
                  adultRouteDecision.sexualContextActive,
              })
            : priorModelRouteState.generalRouteBridge;
        const transientAdultCapableRoute =
          adultRouteDecision.transientAdultCapableRoute === true;
        const establishedOngoingSexualContext =
          transientAdultCapableRoute &&
          hasNewlyEstablishedSexualContext(
            classifySceneMode({
              currentInput: savedText,
              previousSceneMode: "normal",
              adultDialogueProfile: normalizeAdultDialogueProfile(
                ch.adult_dialogue_profile
              ),
              activeConsentMode: requestedConsentMode,
            })
          );
        const nextModelRouteState = advanceModelRouteState({
          previous: priorModelRouteState,
          deliveredRoute: deliveredActiveRoute,
          sceneModeAfter,
          sexualContextActive:
            postSceneClassification?.sexualContextActive ??
            adultRouteDecision.sexualContextActive,
          routeTriggerReason: adultFallbackSucceeded
            ? "general_model_refusal"
            : adultRouteDecision.routeTriggerReason,
          config: adultRoutingConfig,
          explicitSceneEnd: sceneClassification.hardStop,
          activeConsentMode: requestedConsentMode,
          generalRouteBridge: nextGeneralBridge,
          transientAdultCapableRoute,
          establishedOngoingSexualContext,
        });

        const usageModel = htmlFlashOnlyTurn ? billing.modelId : receiptFields.model;
        const usageModelLabel = htmlFlashOnlyTurn ? HTML_ONLY_MODEL_LABEL : receiptFields.modelLabel;
        const apiRawCostSource: Usage["apiRawCostSource"] =
          summedUpstreamUsd > 0 ||
          (primaryStage?.upstreamCostUsd != null &&
            primaryStage.upstreamCostUsd > 0)
            ? "provider_reported"
            : deliveredProvider === "cheaperinference" &&
                cheaperPricingRefreshed
              ? "live_catalog"
              : "fallback_catalog";

        const mainOpenRouterApiRawCostKrw =
          meteredReceiptBilling && billingExchangeRate
            ? openRouterRawCostKrw({
                promptTokens: apiInputTokens,
                outputTokens: apiOutputTokens,
                modelId: deliveredModelId,
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
          ...(oocSceneRenderTurn
            ? mergeGenerationSemantics({}, generationSemantics)
            : {}),
          ...(htmlFlashOnlyTurn ? { htmlFlashOnly: true } : {}),
          ...(primaryStage?.lengthRecoveryPasses != null && primaryStage.lengthRecoveryPasses > 0
            ? { lengthRecoveryPasses: primaryStage.lengthRecoveryPasses }
            : {}),
          ...(primaryStage?.finishReason
            ? { finishReason: primaryStage.finishReason }
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
          breakdownAllocation: "estimated_section_allocation",
          rawHistoryHealth: {
            rawCompleteExchanges,
            rawMessages: providerHistoryHealth.realRawMessages,
            rawChars: rawHistoryChars,
            rawInternalEstimate: rawHistoryInternalEstimate,
            summaryInterval: ROLLING_SUMMARY_INTERVAL,
            summarizedThroughTurn: effectiveSummarizedTurnCount,
            unsummarizedCompletedTurns,
            realRawCompleteExchanges: providerHistoryHealth.realRawCompleteExchanges,
            realRawMessages: providerHistoryHealth.realRawMessages,
            realRawChars: providerHistoryHealth.realRawChars,
            openingPreludePresent: providerHistoryHealth.openingPreludePresent,
            openingPreludeChars: providerHistoryHealth.openingPreludeChars,
            generalRouteBridgePresent: providerHistoryHealth.generalRouteBridgePresent,
            generalRouteBridgeChars: providerHistoryHealth.generalRouteBridgeChars,
            ...(rawCompleteExchanges > providerRawExchangeCount
              ? { policyViolation: true }
              : {}),
          },
          assembledPromptChars,
          usedEnglishCharacterPrompt,
          characterPromptLanguage: usedEnglishCharacterPrompt
            ? "english"
            : "korean_fallback",
          stages: stageCosts,
          ...( {
                apiInputTokens,
                apiOutputTokens,
                ...(apiReasoningOutputTokens != null
                  ? { apiReasoningOutputTokens, apiContentOutputTokens }
                  : {}),
                ...(apiCallCount > 1 ? { apiCallCount } : {}),
                ...(promptAuditRef?.totalAssembledTokens
                  ? { assembledInputTokens: promptAuditRef.totalAssembledTokens }
                  : {}),
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
                ...(cacheRateSummary
                  ? {
                      cacheRateSummary,
                      ...(cacheFamily ? { cacheFamily } : {}),
                    }
                  : {}),
              } ),
          ...(billing.gemini37FlashPricing
            ? { gemini37FlashPricing: billing.gemini37FlashPricing }
            : {}),
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
          ...(meteredReceiptBilling && billingExchangeRate
            ? {
                exchangeRateKrwPerUsd: billingExchangeRate.effectiveKrwPerUsd,
                exchangeRateDateKey: billingExchangeRate.dateKey,
                exchangeRateMode: billingExchangeRate.mode,
                exchangeRateSource: billingExchangeRate.source,
                ...(mainOpenRouterApiRawCostKrw != null
                  ? {
                      apiRawCostKrw: mainOpenRouterApiRawCostKrw,
                      apiRawCostSource,
                      mainApiRawCostKrw: mainOpenRouterApiRawCostKrw,
                    }
                  : {}),
                ...(deliveredModelId && /opus/i.test(deliveredModelId)
                  ? {
                      normalizedRawCostKrw: openRouterNormalizedRawCostKrw({
                        promptTokens: apiInputTokens,
                        outputTokens: apiOutputTokens,
                        modelId: deliveredModelId,
                        exchangeRate: billingExchangeRate,
                      }),
                    }
                  : {}),
              }
            : {}),
          ...(adultRoutingConfig.enabled
            ? {
                adultRouting: {
                  activeRoute: deliveredActiveRoute,
                  sceneModeBefore: priorModelRouteState.currentSceneMode,
                  sceneModeAfter,
                  routeTriggerReason: adultFallbackSucceeded
                    ? "general_model_refusal"
                    : adultRouteDecision.routeTriggerReason,
                  requestedModel: selectedAIRef,
                  actualModel: deliveredModelId,
                  actualProvider: deliveredProvider,
                  userSelectedModel: selectedAIRef,
                  userSelectedModelLabel: selectedAILabel(selectedAIRef),
                  userSelectedProvider: selectedAIProvider(selectedAIRef),
                  rawTurnsIncluded:
                    handoffRawTurnsIncluded > 0
                      ? handoffRawTurnsIncluded
                      : undefined,
                  rawTokensIncluded:
                    handoffRawTokensIncluded > 0
                      ? handoffRawTokensIncluded
                      : undefined,
                  fallbackAttempted: adultFallbackAttempted,
                  fallbackSucceeded: adultFallbackSucceeded,
                  hiddenFallbackOverheadCostUsd:
                    hiddenFallbackOverheadCostUsd > 0
                      ? hiddenFallbackOverheadCostUsd
                      : undefined,
                  finalDeliveredModelCostUsd:
                    summedUpstreamUsd > 0 ? summedUpstreamUsd : undefined,
                  totalUpstreamCostUsd:
                    summedUpstreamUsd + hiddenFallbackOverheadCostUsd > 0
                      ? summedUpstreamUsd + hiddenFallbackOverheadCostUsd
                      : undefined,
                  userChargedPoints: cost,
                  latencyMs: Date.now() - adultRouteStartedAt,
                },
              }
            : {}),
        };
        invalidateModelPickerInputSnapshot(chatRef.id);

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
          send({ type: "status", message: "상태창 생성 중…" });
          postprocessHeartbeat.setPhase("status_widget");
          const widgetExtractStartedAt = Date.now();
          const widgetResolved = await resolveStatusWidgetTurnValues({
            chatId: chatRef.id,
            modelId: deliveredModelId,
            regenerate: !!regenerateMessageId,
            savedText,
            rawWidgetSourceText,
            statusWidgetTurn,
            charName: ch.name,
            characterIdentity: backgroundCharacterIdentity,
            personaName: personaDisplayName,
            userPersona: backgroundPersonaIdentity,
            userMessage: messageText,
            userNote: effectiveUserNote,
            assistantMessageId: persistedAssistantId,
            regenerateMessageId: regenerateMessageId ?? undefined,
            requestId: clientRequestId ?? null,
            userId: user.id,
            characterId: ch.id,
          });
          savedText = widgetResolved.prose;
          statusWidgetValuesPayload = widgetResolved.values;
          widgetExtractLatencyMs = Date.now() - widgetExtractStartedAt;
          widgetExtractAttempts =
            widgetResolved.widgetExtractDiagnostics?.attempts?.length ?? null;
          widgetExtractResult = widgetResolved.telemetry.resolutionSource;
          logStatusWidgetTurnTelemetry(widgetResolved.telemetry);
          if (showFullBillingReceipt && widgetResolved.widgetExtractDiagnostics) {
            usageRecord = {
              ...usageRecord,
              statusWidgetExtractDiagnostics:
                widgetResolved.widgetExtractDiagnostics,
            };
          }
          if (
            widgetResolved.widgetExtractUsage &&
            widgetResolved.widgetExtractBillingMeta &&
            meteredReceiptBilling &&
            billingExchangeRate
          ) {
            if (showFullBillingReceipt) {
              const widgetBilling = applyStatusWidgetBillingCharge(
                usageRecord,
                widgetResolved.widgetExtractUsage,
                billingExchangeRate,
                mainBillingCost,
                widgetResolved.widgetExtractBillingMeta
              );
              usageRecord = widgetBilling.record;
              cost = widgetBilling.totalCost;
            } else {
              const widgetReceipt = buildStatusWidgetExtractReceipt(
                widgetResolved.widgetExtractUsage,
                billingExchangeRate,
                widgetResolved.widgetExtractBillingMeta
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

        savedText = traceStep(
          "stripRepeatedTrailingQuoteMarks",
          savedText,
          stripRepeatedTrailingQuoteMarks(savedText),
          "remove stray repeated quote marks at assistant output tail"
        );

        if (usageRecord.adultRouting) {
          usageRecord = {
            ...usageRecord,
            adultRouting: {
              ...usageRecord.adultRouting,
              userChargedPoints: cost,
            },
          };
        }
        const internalAdultRouteMeta = usageRecord.adultRouting ?? null;

        // Billing/public base usage (may still include admin receipt fields).
        let baseUsageRecord: Usage = usageRecord;
        if (!showFullBillingReceipt) {
          baseUsageRecord = sanitizeUsageForPublicReceipt(usageRecord);
        }

        // Muse 1-pass acceptance telemetry — DB/context only; never client SSE/variants.
        let museAcceptanceFields: Record<string, unknown> | null = null;
        let dbUsageRecord: Usage = baseUsageRecord;
        if (
          shouldRecordMuseAcceptanceTelemetry(deliveredModelId) &&
          !htmlFlashOnlyTurn
        ) {
          const museTelemetry = classifyMuseAcceptance({
            text: savedText,
            finishReason: primaryStage?.finishReason ?? baseUsageRecord.finishReason,
            ownership: ownershipTelemetry,
            completedTurns: playableTurnCount,
            characterId: ch.id,
            personaId: resolvedPersonaId ?? null,
            modelId: deliveredModelId,
            selectedAI: receiptFields.selectedAI ?? null,
            requestLatencyMs: Date.now() - requestStartedAt,
            cost: baseUsageRecord.cost ?? null,
            isRegenerationRequest: !!regenerateMessageId,
            isContinueRequest: isContinue,
            // Main RP + length supplements only (exclude HTML flash / widget extract).
            apiCallCount:
              1 +
              Math.max(0, primaryStage?.lengthRecoveryPasses ?? 0) +
              lengthContinuationPasses,
          });
          museAcceptanceFields = toMuseAcceptanceUsageFields(museTelemetry);
          dbUsageRecord = { ...baseUsageRecord, museAcceptance: museAcceptanceFields };
          logMuseAcceptanceTelemetry(museTelemetry);
        }
        // Even for full billing receipt admins — never send museAcceptance to clients.
        const clientUsageRecord = stripAdultRoutingForClient(
          stripMuseAcceptanceFromUsage(dbUsageRecord),
          { keepInternal: showFullBillingReceipt }
        );
        if (oocSceneRenderTurn) {
          dbUsageRecord = mergeGenerationSemantics(dbUsageRecord, generationSemantics);
        }
        usageRecord = dbUsageRecord;
        const oocClientFlags = readOocSceneClientFlags(dbUsageRecord);
        const variantUsageRecord: Usage = internalAdultRouteMeta
          ? { ...dbUsageRecord, adultRouting: internalAdultRouteMeta }
          : dbUsageRecord;

        const createdAt = new Date().toISOString();
        let newVariant: MessageVariant = {
          content: savedText,
          model: dbUsageRecord.model,
          usage: variantUsageRecord,
          created_at: createdAt,
          statusWidgetValues: statusWidgetValuesPayload,
          statusWidgetTurnActive: statusWidgetActive,
          generationSequence: 0,
          requestId: clientRequestId ?? null,
          sourceMessageId: regenerateMessageId ?? persistedAssistantId,
        };

        let aiMessageId: number;
        let variantPayload = serializeVariantsForClient(
          [newVariant],
          0,
          variantClientOpts
        );
        let snapshotVariantIndex = 0;
        let snapshotVariantCount = 1;

        const statusWidgetValuesJson = statusWidgetValuesPayload
          ? serializeStatusWidgetValuesJson(statusWidgetValuesPayload)
          : "";
        const statusWidgetTurnActiveFlag = statusWidgetActive ? 1 : 0;
        const statusWidgetSaveDiag = diagnoseStatusWidgetValues({
          resolved: statusWidgetTurn,
          statusWidgetTurnActive: statusWidgetActive,
          values: statusWidgetValuesPayload,
          model: deliveredModelId,
        });
        const statusWidgetSaveReason =
          statusWidgetSaveDiag.reasonCode === "MISSING_REQUIRED_KEYS" &&
          statusWidgetActive &&
          !statusWidgetValuesPayload
            ? "V3_EMPTY_OUTPUT"
            : statusWidgetSaveDiag.reasonCode;
        logStatusWidgetLiveTrace({
          requestId: clientRequestId ?? null,
          chatId: chatRef.id,
          messageId: regenerateMessageId ?? persistedAssistantId,
          phase: "before_db_save",
          statusWidgetTurnActive: statusWidgetActive,
          statusWidgetConfigured: statusWidgetSaveDiag.statusWidgetConfigured,
          expectedKeys: statusWidgetSaveDiag.expectedKeys,
          parsedKeys: statusWidgetSaveDiag.actualKeys,
          normalizedKeys: statusWidgetSaveDiag.normalizedKeys,
          missingKeys: statusWidgetSaveDiag.missingKeys,
          hasUsableValues: statusWidgetSaveDiag.hasUsableValues,
          dbValueShape: statusWidgetSaveDiag.dbValueShape,
          savedToDb: false,
          statusValuesHash: statusWidgetDiagnosticHash(statusWidgetValuesJson),
          reasonCode: statusWidgetSaveReason,
        });

        // Phase B0: derived-state writes (episodic facts, trigger events) are
        // allowed only when this request actually finalized the assistant
        // (not an idempotent duplicate finalize) AND the generation status is
        // canonical. `interrupted` / `failed_partial` / `failed` must not
        // advance derived state.
        let assistantFinalizedThisRequest = false;

        const numericCanonicalEligible =
          statusWidgetTurn.needsCharacterValues &&
          resolveNumericCanonicalEligibility({
            userId: user.id,
            characterId: ch.id,
          }).eligible &&
          listCanonicalEligibleNumericFields(statusWidgetTurn.characterWidget)
            .length > 0;
        const previousCanonicalStatusForNumeric = numericCanonicalEligible
          ? loadPreviousStatusWidgetValues(
              chatRef.id,
              regenerateMessageId ?? persistedAssistantId,
              {
                characterWidget: statusWidgetTurn.characterWidget,
                userWidget: statusWidgetTurn.userWidget,
              }
            )
          : null;

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
          newVariant = {
            ...newVariant,
            generationSequence: prevVariants.length,
            sourceMessageId: regenerateMessageId,
          };
          const appended = appendMessageVariant(prevVariants, newVariant);
          variantPayload = serializeVariantsForClient(
            appended.variants,
            appended.activeVariant,
            variantClientOpts
          );
          snapshotVariantIndex = appended.activeVariant;
          snapshotVariantCount = appended.variants.length;

          let finalizeWrote = false;
          let finalizedStatusJson = statusWidgetValuesJson;
          let finalizePreservedExisting = false;

          if (numericCanonicalEligible) {
            // Phase B1-C: message + numeric + status mirror in ONE transaction.
            // Do NOT call finalizeAssistantMessage + commitNumericStateProposal separately.
            try {
              const atomic = executeAtomicNumericAssistantFinalize(db, {
                assistantMessageId: regenerateMessageId,
                chatId: chatRef.id,
                characterId: ch.id,
                content: savedText,
                model: dbUsageRecord.model,
                usageJson: JSON.stringify(dbUsageRecord),
                variants: appended.variants,
                activeVariant: appended.activeVariant,
                statusWidgetValues: statusWidgetValuesPayload,
                statusWidgetTurnActive: statusWidgetTurnActiveFlag,
                generationStatus: persistedGenerationStatus,
                characterWidget: statusWidgetTurn.characterWidget,
                previousCanonicalStatus: previousCanonicalStatusForNumeric,
                sourceTurn: playableTurnCount + 1,
                requestId: clientRequestId ?? null,
                generationSequence: newVariant.generationSequence ?? appended.activeVariant,
                isRegeneration: true,
              });
              finalizeWrote = atomic.wrote;
              finalizedStatusJson = atomic.statusWidgetValuesJson;
              statusWidgetValuesPayload = atomic.statusWidgetValues;
              variantPayload = serializeVariantsForClient(
                atomic.variants,
                atomic.activeVariant,
                variantClientOpts
              );
              newVariant = {
                ...newVariant,
                statusWidgetValues: atomic.statusWidgetValues,
              };
            } catch (numericFinalizeErr) {
              console.error(
                "[RpNumericState] atomic regen finalize failed:",
                (numericFinalizeErr as Error).message
              );
              throw numericFinalizeErr;
            }
          } else {
            const finalizeResult = executeAtomicRegenerationFinalize(db, {
              assistantMessageId: regenerateMessageId,
              chatId: chatRef.id,
              content: savedText,
              model: dbUsageRecord.model,
              usageJson: JSON.stringify(dbUsageRecord),
              alternatesJson: JSON.stringify(appended.variants),
              activeVariant: appended.activeVariant,
              statusWidgetValuesJson,
              statusWidgetTurnActive: statusWidgetTurnActiveFlag,
              generationStatus: persistedGenerationStatus,
            });
            finalizeWrote = finalizeResult.wrote;
            finalizedStatusJson =
              finalizeResult.statusWidgetValuesJson ?? statusWidgetValuesJson;
            finalizePreservedExisting =
              finalizeResult.preservedExistingStatusValues === true;
          }
          logStatusWidgetLiveTrace({
            requestId: clientRequestId ?? null,
            chatId: chatRef.id,
            messageId: regenerateMessageId,
            phase: "after_db_save",
            statusWidgetTurnActive: statusWidgetActive,
            statusWidgetConfigured: statusWidgetSaveDiag.statusWidgetConfigured,
            expectedKeys: statusWidgetSaveDiag.expectedKeys,
            parsedKeys: statusWidgetSaveDiag.actualKeys,
            normalizedKeys: statusWidgetSaveDiag.normalizedKeys,
            missingKeys: statusWidgetSaveDiag.missingKeys,
            hasUsableValues: statusWidgetSaveDiag.hasUsableValues,
            dbValueShape: statusWidgetSaveDiag.dbValueShape,
            savedToDb: finalizeWrote,
            overwrittenByEmpty: finalizePreservedExisting,
            statusValuesHash: statusWidgetDiagnosticHash(finalizedStatusJson),
            reasonCode: finalizePreservedExisting
              ? "FINALIZE_OVERWROTE_VALUES_PREVENTED"
              : statusWidgetSaveReason,
          });
          logStatusWidgetLiveTrace({
            requestId: clientRequestId ?? null,
            chatId: chatRef.id,
            messageId: regenerateMessageId,
            phase: "after_finalize",
            statusWidgetTurnActive: statusWidgetActive,
            statusWidgetConfigured: statusWidgetSaveDiag.statusWidgetConfigured,
            expectedKeys: statusWidgetSaveDiag.expectedKeys,
            parsedKeys: statusWidgetSaveDiag.actualKeys,
            normalizedKeys: statusWidgetSaveDiag.normalizedKeys,
            missingKeys: statusWidgetSaveDiag.missingKeys,
            hasUsableValues: statusWidgetSaveDiag.hasUsableValues,
            dbValueShape: statusWidgetSaveDiag.dbValueShape,
            savedToDb: finalizeWrote,
            overwrittenByEmpty: finalizePreservedExisting,
            statusValuesHash: statusWidgetDiagnosticHash(finalizedStatusJson),
            reasonCode: finalizePreservedExisting
              ? "FINALIZE_OVERWROTE_VALUES_PREVENTED"
              : statusWidgetSaveReason,
          });
          // Successful regenerate counts as an engagement turn (same counter as new user sends).
          if (finalizeWrote) {
            incrementCharacterTotalTurns(db, ch.id, 1);
          }
          assistantFinalizedThisRequest = finalizeWrote;
          aiMessageId = regenerateMessageId;
        } else {
          let finalizeWrote = false;
          let finalizedStatusJson = statusWidgetValuesJson;
          let finalizePreservedExisting = false;
          const alternatesForFinalize = [newVariant];

          if (numericCanonicalEligible) {
            try {
              const atomic = executeAtomicNumericAssistantFinalize(db, {
                assistantMessageId: persistedAssistantId,
                chatId: chatRef.id,
                characterId: ch.id,
                content: savedText,
                model: usageRecord.model,
                usageJson: JSON.stringify(usageRecord),
                variants: alternatesForFinalize,
                activeVariant: 0,
                statusWidgetValues: statusWidgetValuesPayload,
                statusWidgetTurnActive: statusWidgetTurnActiveFlag,
                generationStatus: persistedGenerationStatus,
                characterWidget: statusWidgetTurn.characterWidget,
                previousCanonicalStatus: previousCanonicalStatusForNumeric,
                sourceTurn: playableTurnCount + 1,
                requestId: clientRequestId ?? null,
                generationSequence: 0,
                isRegeneration: false,
              });
              finalizeWrote = atomic.wrote;
              finalizedStatusJson = atomic.statusWidgetValuesJson;
              statusWidgetValuesPayload = atomic.statusWidgetValues;
              variantPayload = serializeVariantsForClient(
                atomic.variants,
                atomic.activeVariant,
                variantClientOpts
              );
              newVariant = {
                ...newVariant,
                statusWidgetValues: atomic.statusWidgetValues,
              };
            } catch (numericFinalizeErr) {
              console.error(
                "[RpNumericState] atomic finalize failed:",
                (numericFinalizeErr as Error).message
              );
              throw numericFinalizeErr;
            }
          } else {
            const finalizeResult = finalizeAssistantMessage(db, {
              assistantMessageId: persistedAssistantId,
              chatId: chatRef.id,
              content: savedText,
              model: usageRecord.model,
              usageJson: JSON.stringify(usageRecord),
              alternatesJson: JSON.stringify(alternatesForFinalize),
              activeVariant: 0,
              statusWidgetValuesJson,
              statusWidgetTurnActive: statusWidgetTurnActiveFlag,
              generationStatus: persistedGenerationStatus,
            });
            finalizeWrote = finalizeResult.wrote;
            finalizedStatusJson =
              finalizeResult.statusWidgetValuesJson ?? statusWidgetValuesJson;
            finalizePreservedExisting =
              finalizeResult.preservedExistingStatusValues === true;
          }
          logStatusWidgetLiveTrace({
            requestId: clientRequestId ?? null,
            chatId: chatRef.id,
            messageId: persistedAssistantId,
            phase: "after_db_save",
            statusWidgetTurnActive: statusWidgetActive,
            statusWidgetConfigured: statusWidgetSaveDiag.statusWidgetConfigured,
            expectedKeys: statusWidgetSaveDiag.expectedKeys,
            parsedKeys: statusWidgetSaveDiag.actualKeys,
            normalizedKeys: statusWidgetSaveDiag.normalizedKeys,
            missingKeys: statusWidgetSaveDiag.missingKeys,
            hasUsableValues: statusWidgetSaveDiag.hasUsableValues,
            dbValueShape: statusWidgetSaveDiag.dbValueShape,
            savedToDb: finalizeWrote,
            overwrittenByEmpty: finalizePreservedExisting,
            statusValuesHash: statusWidgetDiagnosticHash(finalizedStatusJson),
            reasonCode: finalizePreservedExisting
              ? "FINALIZE_OVERWROTE_VALUES_PREVENTED"
              : statusWidgetSaveReason,
          });
          logStatusWidgetLiveTrace({
            requestId: clientRequestId ?? null,
            chatId: chatRef.id,
            messageId: persistedAssistantId,
            phase: "after_finalize",
            statusWidgetTurnActive: statusWidgetActive,
            statusWidgetConfigured: statusWidgetSaveDiag.statusWidgetConfigured,
            expectedKeys: statusWidgetSaveDiag.expectedKeys,
            parsedKeys: statusWidgetSaveDiag.actualKeys,
            normalizedKeys: statusWidgetSaveDiag.normalizedKeys,
            missingKeys: statusWidgetSaveDiag.missingKeys,
            hasUsableValues: statusWidgetSaveDiag.hasUsableValues,
            dbValueShape: statusWidgetSaveDiag.dbValueShape,
            savedToDb: finalizeWrote,
            overwrittenByEmpty: finalizePreservedExisting,
            statusValuesHash: statusWidgetDiagnosticHash(finalizedStatusJson),
            reasonCode: finalizePreservedExisting
              ? "FINALIZE_OVERWROTE_VALUES_PREVENTED"
              : statusWidgetSaveReason,
          });
          assistantFinalizedThisRequest = finalizeWrote;
          aiMessageId = persistedAssistantId;
          if (userMessageId != null) {
            db.prepare(
              "UPDATE messages SET user_message_id=?, generation_status=? WHERE id=? AND chat_id=?"
            ).run(userMessageId, persistedGenerationStatus, aiMessageId, chatRef.id);
          }
        }
        if (adultRoutingConfig.enabled) {
          db.prepare(
            "UPDATE messages SET adult_route_meta_json=? WHERE id=? AND chat_id=?"
          ).run(
            internalAdultRouteMeta ? JSON.stringify(internalAdultRouteMeta) : "",
            aiMessageId,
            chatRef.id
          );
          const persistedModelRouteState = nextPersistedModelRouteState(
            priorModelRouteState,
            nextModelRouteState,
            generationSemantics
          );
          db.prepare(
            "UPDATE chats SET model_route_state_json=? WHERE id=? AND user_id=?"
          ).run(
            serializeModelRouteState(persistedModelRouteState),
            chatRef.id,
            user.id
          );
          chatRef.model_route_state_json =
            serializeModelRouteState(persistedModelRouteState);
        }
        postprocessHeartbeat.setPhase("finalizing");
        clearPartialTimer();
        persistenceDiag.finalized = true;
        persistenceDiag.partialSaveCount = partialSaver.partialSaveCount;
        persistenceDiag.lastPartialChars = savedText.length;
        logStreamingPersistence(persistenceDiag);
        // World-Motion V1.1: commit progression history only after successful finalize.
        if (shouldCommitCanonicalTurnState(generationSemantics)) {
        try {
          commitSceneProgressionState({
            chatId: chatRef.id,
            turn: sceneProgressionTurn,
            types: sceneDirective.progressionTypes,
          });
        } catch (err) {
          console.warn("[scene-progression] commit failed", err);
        }
        }

        // SceneDirective V2 reconvergence: commit only after authoritative finalize.
        if (pendingReconvergenceTransition && shouldCommitCanonicalTurnState(generationSemantics)) {
          try {
            const commitResult = commitReconvergenceTransition(
              {
                ...pendingReconvergenceTransition,
                generationSequence: snapshotVariantIndex ?? 0,
              },
              { assistantMessageId: aiMessageId ?? null }
            );
            if (
              commitResult.reason === "stale_version" ||
              commitResult.reason === "idempotent_replay"
            ) {
              console.info("[scene-directive-v2] reconvergence commit", commitResult.reason);
            }
          } catch (err) {
            console.warn("[scene-directive-v2] reconvergence commit failed", err);
          }
        }

        // Phase B0: trigger derived-state writes are allowed only when this
        // request actually finalized the assistant (not an idempotent
        // duplicate) AND the generation status is canonical.
        // Status Widget must not persist/reconcile long-term episodic facts.
        // EPISODIC_WRITE_OWNER = 5_TURN_SUMMARY_SEAL.
        const derivedStateAllowed =
          assistantFinalizedThisRequest &&
          isCanonicalDerivedStateGenerationStatus(persistedGenerationStatus) &&
          shouldCommitCanonicalTurnState(generationSemantics);
        const shouldEvaluateCreatorTriggers = shouldEvaluateCreatorStatusTriggers({
          derivedStateAllowed,
          needsCharacterValues: statusWidgetTurn.needsCharacterValues,
          statusValues: statusWidgetValuesPayload,
        });

        // Compatibility telemetry only — Status Widget is not the episodic write owner.
        const extractedFactsForTelemetry = statusWidgetValuesPayload?.extracted_facts ?? [];
        const factPersistSummary = summarizeEpisodicFactPersistCandidates(
          extractedFactsForTelemetry,
          { sourceUserText: messageText }
        );
        const parsedStatusKeys = [
          ...Object.keys(statusWidgetValuesPayload?.character ?? {}),
          ...Object.keys(statusWidgetValuesPayload?.user ?? {}),
        ].sort();
        const expectedStatusKeys = [
          ...(statusWidgetTurn.characterWidget?.fields ?? []).map((f) => f.id).filter(Boolean),
          ...(statusWidgetTurn.userWidget?.fields ?? []).map((f) => f.id).filter(Boolean),
        ].sort();
        logStatusMemoryPipelineDev({
          request_id: clientRequestId ?? null,
          message_id: aiMessageId,
          statusBlockFound: /<<<STATUS_VALUES/i.test(rawWidgetSourceText ?? ""),
          parsedStatusKeys,
          missingRequiredStatusKeys: expectedStatusKeys.filter((k) => !parsedStatusKeys.includes(k)),
          extractedFactsRawCount: factPersistSummary.rawCount,
          extractedFactsValidCount: factPersistSummary.validCount,
          extractedFactsInsertableCount: factPersistSummary.insertableCount,
          extractedFactsSkippedCount: factPersistSummary.skippedCount,
          skippedReasons: factPersistSummary.skippedReasons,
          recallCandidateCount: episodicMemory.debug.length,
          recallInjectedCount: episodicMemory.facts.length,
          recallBlockedReasons: [
            ...new Set(
              episodicMemory.debug
                .map((d) => d.blocked_reason)
                .filter((r): r is string => Boolean(r))
            ),
          ],
          requested_status_mode: statusWidgetTurn.requestedMode,
          effective_status_mode: statusWidgetTurn.mode,
          display_mode: statusWidgetTurn.displayMode,
          needs_character_values: statusWidgetTurn.needsCharacterValues,
          needs_user_values: statusWidgetTurn.needsUserValues,
          status_extract_call_count:
            widgetExtractResult === "v3_extract" || widgetExtractResult === "v3_repair"
              ? 1
              : 0,
          status_trigger_evaluated: shouldEvaluateCreatorTriggers,
        });
        logMemoryHealthTelemetry(
          buildMemoryHealthTelemetry({
            completedPlayableTurns: completedTurnsForMemoryCoverage,
            summarizedThrough: effectiveSummarizedTurnCount,
            realRawCompleteExchanges: providerHistoryHealth.realRawCompleteExchanges,
            openingInRaw: providerHistoryHealth.openingPreludePresent,
            bridgeInRaw: providerHistoryHealth.generalRouteBridgePresent,
            episodicCandidateCount: episodicMemory.debug.length,
            episodicInjectedCount: episodicMemory.facts.length,
            episodicDuplicateBlockedCount: episodicMemory.debug.filter((d) =>
              Boolean(d.duplicate_reason)
            ).length,
            episodicBudgetBlockedCount: episodicMemory.debug.filter((d) =>
              Boolean(d.budget_reason)
            ).length,
            statusExtractCallCount:
              widgetExtractResult === "v3_extract" || widgetExtractResult === "v3_repair"
                ? 1
                : 0,
          })
        );

        if (shouldCommitCanonicalTurnState(generationSemantics)) {
        try {
          markStatusTriggerEventsConsumed(db, queuedStatusTriggerEventIds);
        } catch (e) {
          console.error("[StatusTrigger] consume failed:", (e as Error).message);
        }
        }

        if (derivedStateAllowed) {
          // Regeneration: supersede the prior variant's active trigger events
          // for this source assistant message BEFORE re-evaluating, so a
          // rejected variant cannot be consumed next turn or permanently
          // block a fire_once trigger. Missing event > stale wrong event.
          if (regenerateMessageId) {
            try {
              supersedeStatusTriggerEventsForSourceMessage(
                db,
                chatRef.id,
                regenerateMessageId,
                "regeneration"
              );
            } catch (e) {
              console.error("[StatusTrigger] regen supersede failed:", (e as Error).message);
            }
          }

          if (shouldEvaluateCreatorTriggers) {
            evaluateStatusWidgetTriggersBestEffort(db, {
              chatId: chatRef.id,
              characterId: ch.id,
              sourceTurn: playableTurnCount + 1,
              statusValues: creatorTriggerValuesFromPayload(statusWidgetValuesPayload),
              sourceMessageId: aiMessageId,
              requestId: clientRequestId ?? null,
              generationSequence: snapshotVariantIndex,
            });
          }

          // S4 live producer: post-finalize SERVER_STRUCTURED_TRANSFER only.
          if (
            s4GenerationTransferContext &&
            resolvedPersonaId &&
            aiMessageId != null &&
            typeof preStatusPartitionText === "string" &&
            s4LiveProducerAllowed
          ) {
            try {
              commitAcceptedAssistantS4Transfers({
                rawModelText: preStatusPartitionText,
                finalVisibleText: savedText,
                ctx: s4GenerationTransferContext,
                chatId: chatRef.id,
                personaId: resolvedPersonaId,
                characterId: ch.id,
                turnNumber: playableTurnCount + 1,
                assistantMessageId: aiMessageId,
                userMessageId: userMessageId ?? null,
                db,
              });
            } catch (s4CommitErr) {
              console.error(
                "[S4LiveProducer] commit failed:",
                (s4CommitErr as Error).message
              );
            }
          }

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
        if (cost > 0 && !alreadyBilledForRequest) {
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
            const paidRewardSpend = paidCreatorRewardSpend(deductSlices);
            maybeCreditCreatorReward({
              creatorId: ch.creator_id,
              official: ch.official ?? 0,
              characterId: ch.id,
              messageId: aiMessageId,
              consumerUserId: user.id,
              pointsSpent: paidRewardSpend,
            });
          } catch (rewardErr) {
            console.error("[/api/chat] creator reward skipped:", (rewardErr as Error).message);
          }
        } else if (alreadyBilledForRequest) {
          console.info("[StreamingPersistence] skip duplicate billing", {
            requestId: clientRequestId,
            messageId: aiMessageId,
          });
        }

        if (adultHandoffCanaryAccess && userMessageId != null) {
          try {
            const assistantRowsWritten = Number(
              (
                db.prepare(
                  `SELECT COUNT(*) AS count FROM messages
                   WHERE chat_id=? AND role='assistant' AND user_message_id=?`
                ).get(chatRef.id, userMessageId) as { count: number }
              ).count
            );
            recordAdultSceneHandoffCanaryLog(db, {
              userId: user.id,
              chatId: chatRef.id,
              userMessageId,
              assistantMessageId: aiMessageId,
              canaryStage: resolveAdultSceneHandoffCanaryStage({
                routeBefore: priorModelRouteState.activeRoute,
                routeAfter: deliveredActiveRoute,
              }),
              detectedSceneModeBefore: priorModelRouteState.currentSceneMode,
              detectedSceneModeAfter: sceneModeAfter,
              selectedModel: deliveredModelId,
              selectedProvider: deliveredProvider,
              routingReason: adultFallbackSucceeded
                ? "general_model_refusal"
                : adultRouteDecision.routeTriggerReason,
              fallbackAttempted: adultFallbackAttempted,
              fallbackReason: adultFallbackAttempted
                ? "general_model_refusal"
                : undefined,
              visibleCharacters: savedText.length,
              finishReason: primaryStage?.finishReason ?? undefined,
              assistantRowsWritten,
              pointChargeCount:
                cost > 0 && !alreadyBilledForRequest ? 1 : 0,
              chargedPoints:
                cost > 0 && !alreadyBilledForRequest ? cost : 0,
              promptLeakDetected: detectAdultSceneHandoffPromptLeak(savedText),
              duplicateStreamDetected: assistantRowsWritten !== 1,
              totalLatencyMs: Date.now() - requestStartedAt,
            });
          } catch (canaryLogError) {
            console.error("[/api/chat] adult handoff canary log failed", {
              chatId: chatRef.id,
              messageId: aiMessageId,
              error: (canaryLogError as Error).message,
            });
          }
        }

        if (statusMetaEnabled && shouldCommitCanonicalTurnState(generationSemantics)) {
          scheduleStatusMetaExtraction({
            messageId: aiMessageId,
            chatId: chatRef.id,
            charName: ch.name,
            characterIdentity: backgroundCharacterIdentity,
            personaName: personaDisplayName,
            userPersona: backgroundPersonaIdentity,
            userMessage: messageText,
            assistantProse: savedText,
            userNote: effectiveUserNote,
            formatSpec: statusWindowPolicyRef?.formatSpec ?? null,
            prefilledTableMarkdown: capturedStatusTable,
          });
        }

        const suggestedRepliesEnabled =
          body.suggestedRepliesEnabled !== false &&
          !htmlFlashOnlyTurn &&
          !oocSceneRenderTurn &&
          Boolean(savedText.trim());
        if (suggestedRepliesEnabled) {
          scheduleSuggestedRepliesExtraction({
            messageId: aiMessageId,
            chatId: chatRef.id,
            charName: ch.name,
            personaName: personaDisplayName,
            personaDescription,
            personaSpeechExamples: selectedPersona?.speech_examples ?? null,
            userPersona: backgroundPersonaIdentity,
            userMessage: messageText,
            assistantProse: savedText,
          });
        }

        if (terraPromptCanary) {
          logTerraPromptCanaryDebug({
            requestId: clientRequestId,
            userId: user.id,
            chatId: chatRef.id,
            characterId: ch.id,
            model: openRouterApiModelId,
            sceneMode: "single_primary",
            canaryVariant: terraPromptCanary.variant,
            progressionAxis: canaryProgressionAxis,
            temperature: canaryTemperature,
            sceneDirectiveFinal: sceneDirectiveBlock,
            greetingInjected: extractGreetingFromHistory(promptHistory),
            terraAdapter: resolveCanaryTerraTerminalContract(terraPromptCanary.variant),
            dialogueLayoutOwner: canaryAppliesDialogueIntentUnitLayout(
              terraPromptCanary.variant
            )
              ? DIALOGUE_LAYOUT_OWNER_KO_CANARY
              : DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION,
            userTurnTail1500:
              typeof promptUserMessage === "string" ? promptUserMessage.slice(-1500) : "",
            providerRaw: null,
            finalText: savedText,
            metrics: {
              phase: "final",
              canonicalLength: savedText.length,
              finishReason: clientUsageRecord.finishReason ?? null,
              cost,
              relocateSceneDirectiveToUserTurn,
            },
          });
        }

        if (rpDiagnosticCanary && rpDiagnosticEnablesPipelineCapture(rpDiagnosticCanary.variant)) {
          const providerRawMerged = rawStreamTextRef || fullText;
          const preNormalize = sanitizeStreamArtifacts(providerRawMerged);
          const bypassNormalize = rpDiagnosticBypassParagraphNormalize(rpDiagnosticCanary.variant);
          const preDisplayGrouping = bypassNormalize
            ? preNormalize
            : normalizeAiNovelProsePreDisplay(preNormalize);
          const postDisplayGrouping = bypassNormalize
            ? preDisplayGrouping
            : applyDisplayParagraphGrouping(preDisplayGrouping);
          const postNormalize = postDisplayGrouping;
          const pipelineCapture = capturePostprocessPipeline({
            providerRawMerged,
            preNormalize,
            postNormalize,
            preDisplayGrouping,
            postDisplayGrouping,
            sseFinal: savedText,
            dbSaved: savedText,
          });
          const integrity = buildRpDiagnosticIntegrity({
            userId: user.id,
            chatId: chatRef.id,
            characterId: ch.id,
            characterName: ch.name,
            personaId: resolvedPersonaId,
            personaName: personaDisplayName,
            modelUiId: selectedAIRef,
            resolvedProviderModelId: openRouterApiModelId,
            contentKind: contentKindForCanary,
            canary: rpDiagnosticCanary,
            temperature: canaryTemperature,
          });
          send({
            type: "diagnostic_pipeline",
            requestId: clientRequestId,
            variant: rpDiagnosticCanary.variant,
            integrity,
            metrics: pipelineCapture.metrics,
            pipeline: {
              provider_raw_merged: pipelineCapture.provider_raw_merged,
              pre_normalize: pipelineCapture.pre_normalize,
              pre_display_grouping: pipelineCapture.pre_display_grouping,
              post_display_grouping: pipelineCapture.post_display_grouping,
              sse_final: pipelineCapture.sse_final,
              db_saved: pipelineCapture.db_saved,
            },
          });
          logRpDiagnosticCanaryDebug({
            requestId: clientRequestId,
            integrity,
            pipeline: pipelineCapture,
            promptRedacted: {
              variant: rpDiagnosticCanary.variant,
              progressionAxis: canaryProgressionAxis,
              model: openRouterApiModelId,
              characterId: ch.id,
              chatId: chatRef.id,
              personaId: resolvedPersonaId,
            },
          });
        }

        stopPostprocessHeartbeat();
        sseDoneAttempted = true;
        send({
          type: "done",
          chatId: chatRef.id,
          messageId: aiMessageId,
          userMessageId,
          requestId: clientRequestId,
          mode: nextMode,
          cost,
          totalPointsCost: cost,
          remainingPoints: balanceAfter.total,
          paidPoints: balanceAfter.paid,
          freePoints: balanceAfter.free,
          usage: clientUsageRecord,
          ...(clientUsageRecord.finishReason
            ? { finishReason: clientUsageRecord.finishReason }
            : {}),
          memoryUpdated: true,
          statusMetaPending: statusMetaEnabled,
          suggestedRepliesPending: suggestedRepliesEnabled,
          statusWidgetActive,
          statusWidgetTurnActive: statusWidgetActive,
          statusWidgetValues: statusWidgetValuesPayload
            ? stripExtractedFactsForClient(statusWidgetValuesPayload)
            : null,
          generationStatus: persistedGenerationStatus,
          ...oocClientFlags,
          htmlFlashTurn: (htmlVisualCardPolicyRef.enabled || chatOocRpUnrelated) && htmlFlashOnlyTurn,
          showStatusMarkdown: userMessageRequestsStatusWindowOoc(policyUserMessageRef),
          finalContent: savedText,
          ...variantPayload,
        });
        emitStreamTurnForensics(persistedGenerationStatus);
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
              personaId: resolvedPersonaId ?? null,
              personaKnowledgePrompt: personaKnowledgePromptDecisionMeta(
                personaKnowledgePromptDecision
              ),
              ...(museAcceptanceFields
                ? { museAcceptance: museAcceptanceFields }
                : {}),
              ...(internalAdultRouteMeta
                ? {
                    adultRouting:
                      internalAdultRouteMeta as unknown as Record<string, unknown>,
                  }
                : {}),
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
            if (shouldCommitCanonicalTurnState(generationSemantics)) {
            await scheduleMemoryUpdate({
              chatId: chatRef.id,
              userId: user.id,
              characterId: ch.id,
              relationshipNames,
              tier: memoryTier,
              memoryCapacity: getChatMemoryCapacity(chatRef.id),
              characterIdentity: backgroundCharacterIdentity,
              userMessage: messageText,
              assistantMessage: savedText,
              assistantMessageId: aiMessageId,
              sourceUserMessageId: userMessageId,
              userPersona: backgroundPersonaIdentity,
              isRegenerate: !!regenerateMessageId,
              previousAssistantMessage: rejectedAssistantDraft ?? undefined,
              route: nextMode,
              relationshipTailParsed,
              relationshipDeltaFromMain,
            });
            }
          } catch (e) {
            console.error("[/api/chat] 후처리 실패:", (e as Error).message);
          }
        })();
      } catch (e) {
        clearPartialTimer();
        stopPostprocessHeartbeat();
        console.error("[/api/chat] SSE 파이프라인 오류:", (e as Error).message);
        const partialOnError = streamVisibleTextRef || fullText;
        try {
          if (!persistenceDiag.finalized) {
            // Stream already persisted raw text — post-process failure should not lose it
            if (partialOnError.trim()) {
              db.prepare(
                `UPDATE messages SET content=?, generation_status=?, updated_at=datetime('now') WHERE id=?`
              ).run(partialOnError, "completed_with_postprocess_error", persistedAssistantId);
              persistenceDiag.postprocessError = true;
            } else {
              markAssistantInterrupted(db, persistedAssistantId, partialOnError);
              if (regenerateMessageId) {
                restoreAssistantFromAlternatesOnFailedRegen(db, regenerateMessageId, chatRef.id);
              }
              persistenceDiag.interrupted = true;
            }
            logStreamingPersistence(persistenceDiag);
          }
        } catch {
          /* ignore */
        }
        if (e instanceof GeminiTrafficOverloadError) {
          sendTrafficOverloadGracefulStream(send);
        } else if (e instanceof DegenerationAbortError || e instanceof MetaLeakageAbortError) {
          send({ type: "reset" });
          send({ type: "error", error: DEGENERATION_USER_MESSAGE });
        } else {
          send({ type: "error", error: formatClientApiError(e, "Chat pipeline failed") });
        }
        emitStreamTurnForensics(
          partialOnError.trim() ? "completed_with_postprocess_error" : "interrupted"
        );
        controller.close();
      }
      };

      if (rpDiagnosticCanary) {
        await runWithDiagnosticContext(
          {
            bypassParagraphNormalize: rpDiagnosticBypassParagraphNormalize(
              rpDiagnosticCanary.variant
            ),
            bypassDisplayParagraphGrouping: rpDiagnosticBypassDisplayGrouping(
              rpDiagnosticCanary.variant
            ),
          },
          executeStream
        );
      } else {
        await executeStream();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
