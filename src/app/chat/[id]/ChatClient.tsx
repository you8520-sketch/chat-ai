"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatRichBlocks from "@/components/ChatRichBlocks";
import StatusMetaCard from "@/components/StatusMetaCard";
import StatusWidgetCard from "@/components/StatusWidgetCard";
import StatusWidgetValuesEditor from "@/components/StatusWidgetValuesEditor";
import NovelText from "@/components/NovelText";
import {
  getDisplayAlignedCanonicalProseBody,
  getCanonicalProseBody,
  logDisplayEditSourceMismatchDev,
  logProseFormattingMismatchDev,
  logProseSourceDivergenceDev,
  logRegeneratedEditFormattingMismatchDev,
  normalizeEditedProseForSave,
  resolveAssistantCanonicalProseSource,
  resolveAssistantEditInitialValue,
} from "@/lib/canonicalProse";
import ChatEmotionPortraitPanel from "@/components/ChatEmotionPortraitPanel";
import ChatSettingsPanel from "@/components/ChatSettingsPanel";
import ChatRoomDisplayQuickRail from "@/components/ChatRoomDisplayQuickRail";
import ChatRoomMobileMenu from "@/components/ChatRoomMobileMenu";
import ChatAssetAlbumModal, { IconAlbum } from "@/components/ChatAssetAlbumModal";
import RelationshipMetaDock from "@/components/RelationshipMetaDock";
import { CONTINUE_USER_DISPLAY, isContinueUserMessage } from "@/lib/continueNarrative";
import { GEMINI_TRAFFIC_OVERLOAD_MESSAGE } from "@/lib/geminiTrafficError";
import { isPaymentsEnabledClient } from "@/lib/paymentsEnabledClient";
import FloatingPointsDeduction from "@/components/FloatingPointsDeduction";
import BookmarksPanel from "@/components/BookmarksPanel";
import MessageBubbleToolbar from "@/components/MessageBubbleToolbar";
import ReportRefundButton from "@/components/ReportRefundButton";
import ChatSelectionQuoteToolbar from "@/components/ChatSelectionQuoteToolbar";
import MessageVariantPicker from "@/components/MessageVariantPicker";
import ChatToast from "@/components/ChatToast";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import GenerationPreparationIndicator from "@/components/GenerationPreparationIndicator";
import {
  sanitizeGenerationPreparationUi,
  type GenerationPreparationUiPayload,
} from "@/lib/generationPreparationUi";
import type { MessageVariant } from "@/lib/messageAlternates";
import {
  assetByUrl,
  findAssetByTag,
  findAssetsByTag,
  getDefaultChatAsset,
  shouldBlurAssetForViewer,
  type CharacterAsset,
} from "@/lib/characterAssets";
import {
  resolveEmotionTag,
  stripEmotionTag,
  stripEmotionTagsForDisplay,
} from "@/lib/emotionTag";
import {
  loadUnlockedCharacterAssetUrls,
  saveCharacterAssetAlbum,
  saveUnlockedCharacterAssetUrls,
} from "@/lib/characterAssetUnlocks";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import { stripInternalTagLeakage, stripRpMetaPreamble } from "@/lib/narrativeRules";
import { stripRepeatedTrailingQuoteMarks } from "@/lib/trailingQuoteSanitizer";
import type { NarrativePov } from "@/lib/narrativePov";
import type { StatusMeta } from "@/lib/statusMeta/types";
import { userMessageRequestsStatusWindowOoc } from "@/lib/statusMeta/ooc";
import { statusMetaDisplayMarkdown, statusMetaHasDisplayContent } from "@/lib/statusMeta/render";
import { resolveUserNoteStatusWindowPolicy, markdownPipeTableStatusWindowActive } from "@/lib/statusWindowNotePolicy";
import { shouldShowStatusMetaCard, chatUsesHtmlVisualStatusWindow } from "@/lib/statusMeta/displayPolicy";
import { partitionPlainStatusBlockForDisplay } from "@/lib/statusMeta/stripArtifacts";
import { resolveActiveVariantContent } from "@/lib/messageAlternates";
import type { Usage } from "@/lib/chatUsage";
import { dispatchPointsDeducted } from "@/lib/pointsEvents";
import {
  USER_SELECTABLE_AI_OPTIONS,
  CHAT_MESSAGE_MAX,
  ASSISTANT_MESSAGE_MAX,
  DEFAULT_TARGET_RESPONSE_CHARS,
  isClaudeSelectedAI,
  selectedAILabel,
  selectedAIOptionMeta,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  modelPickerOptionLabel,
  type ModelPickerPreviewResult,
} from "@/lib/modelTurnCostEstimate";
import { createModelPickerPreviewRequestGate } from "@/lib/modelPickerPreviewRequestGate";
import { globalModelStatusLabel } from "@/lib/userSelectedAI";
import { formatAssistantLengthLabel } from "@/lib/responseLengthConstants";
import {
  collapseStreamCompareText,
  createStreamReveal,
  planStreamRevealCatchUp,
  rawPrefixForCollapsedCompare,
  resolveStreamAppendTail,
  type StreamRevealController,
} from "@/lib/streamReveal";
import { STREAM_SAVE_MIN_RETENTION } from "@/lib/streamFirstSaveConstants";
import { visibleAssistantMessageLength } from "@/lib/chatDisplayLength";
import {
  isWithinReportRefundWindow,
} from "@/lib/reportRefundPolicy";
import {
  clearChatMessageDraft,
  loadChatMessageDraft,
  migrateChatMessageDraft,
  saveChatMessageDraft,
} from "@/lib/chatMessageDraft";
import {
  clearChatStreamDraft,
  createClientRequestId,
  isInFlightGenerationStatus,
  isTerminalGenerationStatus,
  readChatStreamDraft,
  writeChatStreamDraft,
  type GenerationStatus,
} from "@/lib/streamingPersistence";
import {
  generationStatusFromEofResult,
  needsEofReconcile,
  reconcileStreamEof,
  type EofReconcileSnapshot,
} from "@/lib/chatStreamEofReconcile";
import type { PersonaListItem } from "@/lib/userPersonas";
import type { UserNotePresetItem } from "@/lib/userNotePresetTypes";
import type { StatusWidgetPresetItem } from "@/lib/statusWidgetPresetTypes";
import {
  CHAT_LOAD_MORE_TURNS,
  mergeMessagesKeepingOlderPrefix,
  type ChatMessageLike,
} from "@/lib/chatMessagePagination";
import {
  validateUserNoteCombined,
} from "@/lib/userNoteStatusWindow";
import {
  orderedWidgetsForRender,
  parseStoredStatusWidgetValuesJson,
  renderStatusWidgetsForTurn,
  resolveStatusWidgetReservedChars,
  resolveStatusWidgetTurn,
  shouldShowStatusWidgetOnMessage,
  statusWidgetValuesHasContent,
  stripIncompleteStatusWidgetTail,
  type ParsedStatusWidgetTurnValues,
  type StatusWidgetDisplayMode,
  type StatusWidgetSourceMode,
  type StatusWidgetStackOrder,
} from "@/lib/statusWidget";
import { cacheUserChatPrefsClient } from "@/lib/userChatPrefs";
import {
  chatReadabilityRootStyle,
  chatMessageAreaLayoutClass,
  CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS,
  CHAT_MOBILE_PORTRAIT_IMAGE_CLASS,
  CHAT_MESSAGES_COLUMN_CLASS,
  CHAT_MESSAGES_BODY_NO_PORTRAIT_CLASS,
  CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS,
  CHAT_MESSAGES_LIST_NO_PORTRAIT_CLASS,
  CHAT_INPUT_DOCK_NO_PORTRAIT_CLASS,
  CHAT_INFO_STICKY_NO_PORTRAIT_CLASS,
  CHAT_PORTRAIT_GRID_CLASS,
  CHAT_PORTRAIT_INFO_STICKY_CLASS,
  CHAT_PORTRAIT_INFO_STICKY_INNER_CLASS,
  CHAT_PORTRAIT_STICKY_CLASS,
  CHAT_ROOM_TITLE_BAR_CLASS,
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  DEFAULT_CHAT_DISPLAY_PREFS,
  resolveClientDisplayPrefs,
  saveChatDisplayPrefs,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

const CHAT_FETCH_TIMEOUT_MS = 240_000;

function chatStreamAbortMessage(e: unknown): string | null {
  if (e instanceof DOMException && e.name === "TimeoutError") {
    return "응답 시간이 초과되었습니다. 다시 시도해 주세요.";
  }
  if (isBenignChatStreamAbort(e)) return null;
  return null;
}

function isBenignChatStreamAbort(e: unknown): boolean {
  if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
    return true;
  }
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /BodyStreamBuffer was aborted|The operation was aborted|fetch aborted|user aborted|timed out|timeout/i.test(
    msg
  );
}

function isChatFetchTimeout(e: unknown): boolean {
  return e instanceof DOMException && e.name === "TimeoutError";
}

function selectedAIOptionLabel(
  id: SelectedAI,
  preview: ModelPickerPreviewResult | null
): string {
  const meta = selectedAIOptionMeta(id);
  const badgeText =
    meta && "badge" in meta && typeof meta.badge === "string" && meta.badge
      ? meta.badge
      : "";
  const badge = badgeText ? ` [${badgeText}]` : "";
  const displayName = `${selectedAILabel(id)}${badge}`;
  const row = preview?.models.find((m) => m.modelId === id);
  return modelPickerOptionLabel({
    displayName,
    estimatedPoints: row?.estimatedPoints ?? null,
  });
}

export type { Usage };
type Msg = {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  usage?: Usage | null;
  isRefunded?: boolean;
  createdAt?: string;
  reportStatus?: "none" | "pending" | "approved" | "rejected";
  variants?: MessageVariant[];
  activeVariant?: number;
  variantCount?: number;
  statusMeta?: StatusMeta | null;
  statusMetaFormatSpec?: string | null;
  statusMetaPending?: boolean;
  /** UI — status meta slot reserved for this assistant turn */
  statusMetaRequested?: boolean;
  statusMetaFailed?: boolean;
  statusWidgetValues?: ParsedStatusWidgetTurnValues | null;
  /** That assistant turn was generated with widget ON */
  statusWidgetTurnActive?: boolean;
  /** Streaming durability — matches messages.request_id */
  requestId?: string;
  /** Streaming durability — messages.generation_status */
  generationStatus?: GenerationStatus | string;
  /** UI 전용 — DB 미저장 */
  ephemeral?: boolean;
};

function isRetryableGenerationStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "interrupted" || s === "failed_partial" || s === "failed";
}

function isPendingGenerationStatus(status: string | null | undefined): boolean {
  return isInFlightGenerationStatus(status) || isRetryableGenerationStatus(status);
}

/** Keep DB-backed turns on stream failure; only drop optimistic (no-id) pairs. */
function softRollbackTurn(msgs: Msg[], aiIndex: number): Msg[] {
  const assistant = msgs[aiIndex];
  const user = aiIndex > 0 ? msgs[aiIndex - 1] : undefined;
  const assistantPersisted = assistant?.role === "assistant" && assistant.id != null;
  const userPersisted = user?.role === "user" && user.id != null;

  if (assistantPersisted || userPersisted) {
    const copy = [...msgs];
    if (assistant?.role === "assistant") {
      copy[aiIndex] = {
        ...assistant,
        generationStatus: assistant.content.trim() ? "interrupted" : "failed",
      };
    }
    if (user?.role === "user" && !user.generationStatus) {
      copy[aiIndex - 1] = { ...user, generationStatus: user.generationStatus ?? "submitted" };
    }
    return copy;
  }
  return msgs.slice(0, Math.max(0, aiIndex - (user?.role === "user" ? 1 : 0)));
}

type StatusMetaPollResult = {
  meta: StatusMeta | null;
  formatSpec: string | null;
  failed: boolean;
};

/** 재생성 등 동일 message id — SSR initialMessages의 status_meta를 클라이언트에 병합 */
function mergeStatusMetaFieldsById<T extends Msg>(prev: T[], server: T[]): T[] {
  const serverById = new Map(server.filter((m) => m.id != null).map((m) => [m.id!, m]));
  if (serverById.size === 0) return prev;

  return prev.map((m) => {
    if (m.id == null) return m;
    const s = serverById.get(m.id);
    if (!s) return m;

    const serverHasMeta =
      s.statusMeta != null && statusMetaHasDisplayContent(s.statusMeta, s.statusMetaFormatSpec);
    const clientAwaitingFreshMeta =
      m.statusMetaPending === true &&
      (m.statusMeta == null || !statusMetaHasDisplayContent(m.statusMeta, m.statusMetaFormatSpec));

    if (clientAwaitingFreshMeta && (s.statusMetaPending || !serverHasMeta)) return m;

    if (!s.statusMetaRequested && !s.statusMetaPending && !serverHasMeta && !m.statusMetaRequested) {
      return m;
    }

    return {
      ...m,
      statusMeta: s.statusMetaPending ? m.statusMeta : (s.statusMeta ?? m.statusMeta),
      statusMetaPending: s.statusMetaPending ?? false,
      statusMetaRequested: !!(s.statusMetaRequested || m.statusMetaRequested || s.statusMetaPending),
      statusMetaFormatSpec: s.statusMetaFormatSpec ?? m.statusMetaFormatSpec ?? null,
      statusMetaFailed:
        s.statusMetaPending === true
          ? false
          : s.statusMetaFailed === true
            ? true
            : serverHasMeta
              ? false
              : m.statusMetaFailed,
    };
  });
}

async function runStatusMetaPollWithRetry(messageId: number): Promise<StatusMetaPollResult> {
  let result = await pollStatusMetaForMessage(messageId);
  if (!result.failed && result.meta && statusMetaHasDisplayContent(result.meta, result.formatSpec)) {
    return result;
  }
  await new Promise((r) => setTimeout(r, 3000));
  return pollStatusMetaForMessage(messageId);
}

function startStatusMetaPoll(
  messageId: number,
  pollStartedRef: { current: Set<number> },
  setMessages: Dispatch<SetStateAction<Msg[]>>,
  userNote: string,
  markdownStatusWindowActive: boolean,
  onDone: () => void,
  opts?: {
    statusWidgetActive?: boolean;
    userMessage?: string;
    userPersona?: string | null;
  }
) {
  if (pollStartedRef.current.has(messageId)) return;
  pollStartedRef.current.add(messageId);
  void runStatusMetaPollWithRetry(messageId).then((result) => {
    applyStatusMetaPollResult(
      setMessages,
      messageId,
      result,
      userNote,
      markdownStatusWindowActive,
      opts?.userMessage,
      opts?.userPersona,
      opts?.statusWidgetActive
    );
    if (result.failed || !statusMetaHasDisplayContent(result.meta, result.formatSpec)) {
      window.setTimeout(() => pollStartedRef.current.delete(messageId), 45_000);
    }
    onDone();
  });
}

async function pollStatusMetaForMessage(messageId: number): Promise<StatusMetaPollResult> {
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    try {
      const res = await fetch(`/api/chat/status-meta?messageId=${messageId}`);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        pending?: boolean;
        failed?: boolean;
        meta?: StatusMeta | null;
        formatSpec?: string | null;
      };
      if (data.pending) continue;
      const meta = data.meta ?? null;
      const formatSpec = data.formatSpec ?? null;
      if (statusMetaHasDisplayContent(meta, formatSpec)) {
        return { meta, formatSpec, failed: false };
      }
      if (data.failed) {
        return { meta, formatSpec, failed: true };
      }
      if (attempt >= maxAttempts - 4) {
        return { meta, formatSpec, failed: true };
      }
    } catch {
      // retry
    }
  }
  return { meta: null, formatSpec: null, failed: true };
}

function htmlVisualStatusActiveForChat(
  userNote: string,
  markdownStatusWindowActive: boolean,
  userMessage?: string,
  userPersona?: string | null,
  statusWidgetActive?: boolean
): boolean {
  return chatUsesHtmlVisualStatusWindow({
    userNote,
    userPersona: userPersona ?? undefined,
    userMessage,
    markdownStatusWindowActive,
    statusWidgetActive,
  });
}

function applyStatusMetaPollResult(
  setMessages: Dispatch<SetStateAction<Msg[]>>,
  messageId: number,
  result: StatusMetaPollResult,
  userNote?: string,
  markdownStatusWindowActive?: boolean,
  userMessage?: string,
  userPersona?: string | null,
  statusWidgetActive?: boolean
) {
  if (
    htmlVisualStatusActiveForChat(
      userNote ?? "",
      markdownStatusWindowActive === true,
      userMessage,
      userPersona,
      statusWidgetActive
    )
  ) {
    return;
  }
  setMessages((prev) => {
    const copy = [...prev];
    const idx = copy.findIndex((m) => m.id === messageId);
    if (idx < 0) return prev;
    const hasMeta = result.meta != null && statusMetaHasDisplayContent(result.meta, result.formatSpec);
    copy[idx] = {
      ...copy[idx]!,
      statusMeta: result.meta,
      statusMetaFormatSpec: result.formatSpec ?? copy[idx]!.statusMetaFormatSpec ?? null,
      statusMetaPending: false,
      statusMetaRequested: true,
      statusMetaFailed: result.failed || !hasMeta,
    };
    return copy;
  });
}

function resolveAssistantTurnStatusMetaSeed(
  userNote: string,
  markdownStatusWindowActive: boolean,
  userMessage?: string,
  userPersona?: string | null,
  statusWidgetActive?: boolean
): Pick<Msg, "statusMetaPending" | "statusMetaRequested" | "statusMetaFormatSpec" | "statusMetaFailed"> {
  if (
    htmlVisualStatusActiveForChat(
      userNote,
      markdownStatusWindowActive,
      userMessage,
      userPersona,
      statusWidgetActive
    )
  ) {
    return {};
  }
  const policy = resolveUserNoteStatusWindowPolicy(userNote);
  if (!policy.everyTurn || !policy.formatSpec) return {};
  return {
    statusMetaPending: true,
    statusMetaRequested: true,
    statusMetaFailed: false,
    statusMetaFormatSpec: policy.formatSpec,
  };
}

function withoutEphemeralSystem(messages: Msg[]): ChatMessageLike[] {
  return messages.filter((m) => m.role !== "system") as ChatMessageLike[];
}

function toChatMessageLike(messages: Msg[]): ChatMessageLike[] {
  return messages.filter((m) => m.role !== "system") as ChatMessageLike[];
}

/** variant usage와 row usage가 어긋날 때 위젯 V3 원가 필드 보존 */
function enrichUsageWithBillingExtras(
  primary: Usage | null | undefined,
  supplemental: Usage | null | undefined
): Usage | null {
  if (!primary) return supplemental ?? null;
  if (!supplemental?.statusWidgetExtract) return primary;
  if (primary.statusWidgetExtract) return primary;
  return {
    ...primary,
    statusWidgetExtract: supplemental.statusWidgetExtract,
    mainApiRawCostKrw: supplemental.mainApiRawCostKrw ?? primary.mainApiRawCostKrw,
    apiRawCostKrw: supplemental.apiRawCostKrw ?? primary.apiRawCostKrw,
    apiInputTokens: supplemental.apiInputTokens ?? primary.apiInputTokens,
    apiOutputTokens: supplemental.apiOutputTokens ?? primary.apiOutputTokens,
    apiCallCount: supplemental.apiCallCount ?? primary.apiCallCount,
    upstreamCostUsd: supplemental.upstreamCostUsd ?? primary.upstreamCostUsd,
    stages: supplemental.stages ?? primary.stages,
  };
}

function resolveActiveUsage(
  usage: Usage | null | undefined,
  variants?: MessageVariant[],
  activeVariant?: number
): Usage | null {
  let fromVariant: Usage | null = null;
  if (variants?.length && activeVariant != null && activeVariant >= 0) {
    fromVariant = variants[activeVariant]?.usage ?? null;
  }
  const fromRow = usage ?? null;
  const base = fromVariant ?? fromRow;
  if (!base) return null;
  return enrichUsageWithBillingExtras(base, fromRow) ?? enrichUsageWithBillingExtras(base, fromVariant);
}

/** router.refresh 후 SSR usage(위젯 V3 원가)가 클라이언트에 안 붙은 경우 DB 스냅샷으로 보강 */
function mergeBillingUsageFromServer<T extends Msg>(prev: T[], server: T[]): T[] {
  const serverById = new Map(
    server.filter((m) => m.id != null && m.id > 0).map((m) => [m.id!, m])
  );
  if (serverById.size === 0) return prev;

  return prev.map((m) => {
    if (m.id == null || m.id <= 0) return m;
    const s = serverById.get(m.id);
    if (!s) return m;

    const serverUsage = resolveActiveUsage(s.usage, s.variants, s.activeVariant);
    if (!serverUsage?.statusWidgetExtract) return m;

    const clientUsage = resolveActiveUsage(m.usage, m.variants, m.activeVariant);
    if (clientUsage?.statusWidgetExtract) return m;

    const mergedUsage =
      enrichUsageWithBillingExtras(clientUsage ?? serverUsage, serverUsage) ?? serverUsage;

    return {
      ...m,
      usage: mergedUsage,
      variants: s.variants ?? m.variants,
      activeVariant: s.activeVariant ?? m.activeVariant,
      variantCount: s.variantCount ?? m.variantCount,
    };
  });
}

function findLastTurnIndices(msgs: Msg[]) {
  let lastUserIdx = -1;
  let lastAssistantIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && msgs[i].model !== "greeting") {
      lastAssistantIdx = i;
      break;
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  return { lastUserIdx, lastAssistantIdx };
}

function scanMessagesForPortrait(
  msgs: { role: string; content: string }[],
  assets: CharacterAsset[],
  isCharacterCreator: boolean
): { activeUrl: string | null; activeTag: string | null; unlocked: Set<string> } {
  const defaultAsset = getDefaultChatAsset(assets);
  const unlocked = new Set<string>();
  if (defaultAsset?.url) unlocked.add(defaultAsset.url);

  let activeUrl = defaultAsset?.url ?? null;
  let activeTag: string | null = defaultAsset?.tag ?? null;

  const allowed = assets.filter((a) => a.chat !== false).map((a) => a.tag);

  for (const m of msgs) {
    if (m.role !== "assistant" || !m.content.trim()) continue;
    const { tag } = stripEmotionTag(m.content);
    if (!tag) continue;
    const resolved = resolveEmotionTag(tag, allowed);
    if (!resolved) continue;
    const asset = findAssetByTag(assets, resolved);
    if (!asset) continue;
    if (!isCharacterCreator) {
      for (const matched of findAssetsByTag(assets, resolved)) {
        if (matched.viewerBlur) unlocked.add(matched.url);
      }
    }
    activeUrl = asset.url;
    activeTag = asset.tag;
  }

  return { activeUrl, activeTag, unlocked };
}

export default function ChatClient({
  character,
  creatorName,
  creatorId,
  assets,
  initialChatId,
  initialMessages,
  initialUnlockedAssetUrls = [],
  initialBookmarkedIds,
  initialScrollMessageId = null,
  initialMode,
  hasMemory,
  initialUserNote,
  defaultUserNote,
  initialNotePresets,
  initialStatusWidgetPresets = [],
  initialPersonas,
  initialSelectedPersonaId,
  nickname,
  isAdult,
  userNsfwOn,
  initialSelectedAI,
  initialGlobalModelNotice = null,
  initialTargetResponseChars,
  initialChatTitle = "",
  initialDisplayPrefs,
  initialHasMoreOlder = false,
  initialHiddenTurnCount = 0,
  isCharacterCreator = false,
  initialStatusWidgetMode = "character_only",
  initialStatusWidgetDisplayMode = null,
  initialCharacterWidgetJson = "",
  initialUserWidgetJson = "",
  initialStatusWidgetStackOrder = "character_first",
  characterWidgetAllowUserOverride = true,
  showFullBillingReceipt = false,
  contentKind = "character",
  povCharacterSuggestions = [],
  initialNarrativePov = "third_person",
  initialPovCharacterName = "",
}: {
  character: { id: number; name: string; emoji: string; hue: number; nsfw: number; official?: number };
  creatorName: string;
  creatorId: number | null;
  assets: CharacterAsset[];
  initialChatId: number | null;
  initialMessages: Msg[];
  initialUnlockedAssetUrls?: string[];
  initialHasMoreOlder?: boolean;
  initialHiddenTurnCount?: number;
  initialBookmarkedIds: number[];
  initialScrollMessageId?: number | null;
  initialMode: "safe" | "nsfw";
  hasMemory: boolean;
  initialUserNote: string;
  defaultUserNote: string;
  initialNotePresets: UserNotePresetItem[];
  initialStatusWidgetPresets?: StatusWidgetPresetItem[];
  initialPersonas: PersonaListItem[];
  initialSelectedPersonaId: number | null;
  nickname: string;
  isAdult: boolean;
  userNsfwOn: boolean;
  initialSelectedAI: SelectedAI;
  /** 전역 모델 1회 안내 (SSR에서 consume) */
  initialGlobalModelNotice?: string | null;
  initialTargetResponseChars: number;
  initialChatTitle?: string;
  initialDisplayPrefs?: ChatDisplayPrefs;
  isCharacterCreator?: boolean;
  initialStatusWidgetMode?: StatusWidgetSourceMode;
  initialStatusWidgetDisplayMode?: StatusWidgetDisplayMode | null;
  initialCharacterWidgetJson?: string;
  initialUserWidgetJson?: string;
  initialStatusWidgetStackOrder?: StatusWidgetStackOrder;
  characterWidgetAllowUserOverride?: boolean;
  showFullBillingReceipt?: boolean;
  contentKind?: "character" | "simulation";
  povCharacterSuggestions?: string[];
  initialNarrativePov?: NarrativePov;
  initialPovCharacterName?: string;
}) {
  const router = useRouter();
  const isOfficialCharacter = Number(character.official) === 1;
  const creatorNameDesktopClass = `max-w-32 shrink-0 truncate text-xs underline-offset-2 transition hover:underline ${
    isOfficialCharacter
      ? "font-extrabold text-violet-200 drop-shadow-[0_0_8px_rgba(167,139,250,0.35)] hover:text-white"
      : "font-medium text-zinc-500 hover:text-zinc-300"
  }`;
  const creatorNameMobileClass = `max-w-[7rem] shrink-0 truncate text-[11px] underline-offset-2 transition hover:underline ${
    isOfficialCharacter
      ? "font-bold text-violet-200 drop-shadow-[0_0_8px_rgba(167,139,250,0.35)] hover:text-white"
      : "text-zinc-500 hover:text-zinc-300"
  }`;
  const creatorNameRailClass = `mt-0.5 block max-w-full truncate text-[11px] underline-offset-2 transition hover:underline ${
    isOfficialCharacter
      ? "font-extrabold text-violet-200 drop-shadow-[0_0_8px_rgba(167,139,250,0.35)] hover:text-white"
      : "font-medium text-zinc-500 hover:text-zinc-300"
  }`;
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const statusMetaPollStartedRef = useRef<Set<number>>(new Set());
  const [hasMoreOlder, setHasMoreOlder] = useState(initialHasMoreOlder);
  const [hiddenTurnCount, setHiddenTurnCount] = useState(initialHiddenTurnCount);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [chatId, setChatId] = useState(initialChatId);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<number>>(
    () => new Set(initialBookmarkedIds)
  );
  const scrollMessageIdRef = useRef<number | null>(initialScrollMessageId);
  const scrollHighlightRef = useRef<HTMLElement | null>(null);
  const hasBookmarkScrollTarget =
    initialScrollMessageId != null && initialScrollMessageId > 0;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingRole, setEditingRole] = useState<"user" | "assistant" | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editUserDraft, setEditUserDraft] = useState("");
  const [editWidgetDraft, setEditWidgetDraft] = useState<ParsedStatusWidgetTurnValues>({});
  const [editSaving, setEditSaving] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [input, setInput] = useState(() => loadChatMessageDraft(character.id, initialChatId));
  const draftScopeRef = useRef(`${character.id}:${initialChatId ?? "pending"}`);
  const [loading, setLoading] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string | null>(null);
  /** Pre-first-token preparation panel; cleared when visible text arrives. Not persisted. */
  const [generationPrepUi, setGenerationPrepUi] =
    useState<GenerationPreparationUiPayload | null>(null);
  const [error, setError] = useState("");
  const defaultChatAsset = useMemo(() => getDefaultChatAsset(assets), [assets]);
  const initialPortrait = useMemo(
    () => scanMessagesForPortrait(initialMessages, assets, isCharacterCreator),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 입장·채팅방 전환 시에만 스캔
    [initialChatId, assets, isCharacterCreator]
  );
  const [activePortraitUrl, setActivePortraitUrl] = useState<string | null>(
    () => initialPortrait.activeUrl
  );
  const [activePortraitTag, setActivePortraitTag] = useState<string | null>(
    () => initialPortrait.activeTag
  );
  const [portraitPinned, setPortraitPinned] = useState(false);
  const [characterIntroOpen, setCharacterIntroOpen] = useState(false);
  const [assetAlbumOpen, setAssetAlbumOpen] = useState(false);
  const portraitPinnedRef = useRef(false);
  const initialUnlockedUrls = useMemo(() => {
    const next = new Set(initialPortrait.unlocked);
    for (const url of initialUnlockedAssetUrls) next.add(url);
    for (const url of loadUnlockedCharacterAssetUrls(character.id)) next.add(url);
    return next;
  }, [character.id, initialPortrait, initialUnlockedAssetUrls]);
  const unlockedUrlsRef = useRef<Set<string>>(initialUnlockedUrls);
  const [unlockedUrls, setUnlockedUrls] = useState<Set<string>>(
    () => new Set(initialUnlockedUrls)
  );
  const [displayPrefs, setDisplayPrefs] = useState<ChatDisplayPrefs>(
    () => initialDisplayPrefs ?? DEFAULT_CHAT_DISPLAY_PREFS
  );
  const displayPrefsRef = useRef(displayPrefs);
  const activeStreamRevealRef = useRef<StreamRevealController | null>(null);
  const streamTargetTextRef = useRef("");
  const assistantStreamContentRef = useRef("");
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);
  const nsfwMode = isAdult && userNsfwOn;
  const [selectedAI, setSelectedAI] = useState<SelectedAI>(initialSelectedAI);
  const [userNote, setUserNote] = useState(initialUserNote);
  const [liveStatusWidgetMode, setLiveStatusWidgetMode] =
    useState<StatusWidgetSourceMode>(initialStatusWidgetMode);
  const [liveStatusWidgetDisplayMode, setLiveStatusWidgetDisplayMode] =
    useState<StatusWidgetDisplayMode | null>(initialStatusWidgetDisplayMode);
  const [liveUserWidgetJson, setLiveUserWidgetJson] = useState(initialUserWidgetJson);

  useEffect(() => {
    setLiveStatusWidgetMode(initialStatusWidgetMode);
    setLiveStatusWidgetDisplayMode(initialStatusWidgetDisplayMode);
    setLiveUserWidgetJson(initialUserWidgetJson);
  }, [initialStatusWidgetMode, initialStatusWidgetDisplayMode, initialUserWidgetJson]);

  const statusWidgetTurn = useMemo(
    () =>
      resolveStatusWidgetTurn({
        characterWidgetJson: initialCharacterWidgetJson,
        chatMode: liveStatusWidgetMode,
        userWidgetJson: liveUserWidgetJson,
        stackOrder: initialStatusWidgetStackOrder,
        displayMode: liveStatusWidgetDisplayMode,
        characterAllowUserOverride: characterWidgetAllowUserOverride,
      }),
    [
      initialCharacterWidgetJson,
      liveStatusWidgetMode,
      liveUserWidgetJson,
      initialStatusWidgetStackOrder,
      liveStatusWidgetDisplayMode,
      characterWidgetAllowUserOverride,
    ]
  );
  const statusWidgetActive = statusWidgetTurn.active;

  const widgetReservedChars = useMemo(
    () =>
      resolveStatusWidgetReservedChars({
        characterWidgetJson: initialCharacterWidgetJson,
        chatMode: liveStatusWidgetMode,
        userWidgetJson: liveUserWidgetJson,
        stackOrder: initialStatusWidgetStackOrder,
        displayMode: liveStatusWidgetDisplayMode,
        characterAllowUserOverride: characterWidgetAllowUserOverride,
      }),
    [
      initialCharacterWidgetJson,
      liveStatusWidgetMode,
      liveUserWidgetJson,
      initialStatusWidgetStackOrder,
      liveStatusWidgetDisplayMode,
      characterWidgetAllowUserOverride,
    ]
  );

  const chatStatusFormatSpec = useMemo(
    () => resolveUserNoteStatusWindowPolicy(userNote).formatSpec,
    [userNote]
  );
  const markdownStatusWindowActive = useMemo(
    () => markdownPipeTableStatusWindowActive(resolveUserNoteStatusWindowPolicy(userNote)),
    [userNote]
  );
  const statusWindowPlacement = useMemo(
    () => resolveUserNoteStatusWindowPolicy(userNote).placement,
    [userNote]
  );
  const [notePresets, setNotePresets] = useState(initialNotePresets);
  const [personas, setPersonas] = useState(initialPersonas);
  const [selectedPersonaId, setSelectedPersonaId] = useState(initialSelectedPersonaId);
  const [targetResponseChars, setTargetResponseChars] = useState(initialTargetResponseChars);
  const [chatTitle, setChatTitle] = useState(initialChatTitle);
  const [narrativePov, setNarrativePov] = useState<NarrativePov>(initialNarrativePov);
  const [povCharacterName, setPovCharacterName] = useState(initialPovCharacterName);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [displaySettingsSaving, setDisplaySettingsSaving] = useState(false);
  const settingsSkipAutoSaveRef = useRef(true);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayPrefsPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveInFlightRef = useRef(0);
  const userNoteRef = useRef(userNote);
  userNoteRef.current = userNote;
  const targetResponseCharsRef = useRef(targetResponseChars);
  targetResponseCharsRef.current = targetResponseChars;

  const beginSettingsSave = () => {
    settingsSaveInFlightRef.current += 1;
    setSettingsSaving(true);
  };

  const endSettingsSave = () => {
    settingsSaveInFlightRef.current = Math.max(0, settingsSaveInFlightRef.current - 1);
    setSettingsSaving(settingsSaveInFlightRef.current > 0);
  };

  const handleSelectedAIChange = useCallback(
    async (next: SelectedAI) => {
      if (next === selectedAI) return;
      const switchingToOpus = !isClaudeSelectedAI(selectedAI) && isClaudeSelectedAI(next);
      const prev = selectedAI;
      setSelectedAI(next);
      if (switchingToOpus) {
        setTargetResponseChars(DEFAULT_TARGET_RESPONSE_CHARS);
      }
      try {
        const res = await fetch("/api/user/selected-ai", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedAI: next }),
        });
        const data = (await res.json()) as {
          error?: string;
          selectedAI?: SelectedAI;
          changeNotice?: string | null;
        };
        if (!res.ok) {
          setSelectedAI(prev);
          setToastMsg(data.error || "모델 변경에 실패했습니다.");
          return;
        }
        if (data.selectedAI) setSelectedAI(data.selectedAI);
        if (data.changeNotice) setToastMsg(data.changeNotice);
      } catch {
        setSelectedAI(prev);
        setToastMsg("모델 변경 중 오류가 발생했습니다.");
      }
    },
    [selectedAI]
  );

  const persistChatSettings = useCallback(async () => {
    if (!chatId) return;
    const noteCheck = validateUserNoteCombined(userNoteRef.current, widgetReservedChars);
    if (!noteCheck.ok) {
      setToastMsg(noteCheck.error);
      return;
    }
    beginSettingsSave();
    try {
      const res = await fetch("/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          userNote: userNoteRef.current,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          chatTitle,
          narrativePov,
          povCharacterName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMsg(data.error || "설정 저장에 실패했습니다.");
      }
    } catch {
      setToastMsg("설정 저장 중 오류가 발생했습니다.");
    } finally {
      endSettingsSave();
    }
  }, [chatId, nsfwMode, chatTitle, narrativePov, povCharacterName, widgetReservedChars]);

  const saveUserNote = useCallback(
    async (note: string): Promise<boolean> => {
      const noteCheck = validateUserNoteCombined(note, widgetReservedChars);
      if (!noteCheck.ok) {
        setToastMsg(noteCheck.error);
        return false;
      }
      if (!chatId) return true;
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current);
        settingsSaveTimerRef.current = null;
      }
      beginSettingsSave();
      try {
        const res = await fetch("/api/chat/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            userNote: note,
            isNsfwMode: nsfwMode,
            isAdultMode: nsfwMode,
            chatTitle,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setToastMsg(data.error || "유저 노트 저장에 실패했습니다.");
          return false;
        }
        settingsSkipAutoSaveRef.current = true;
        return true;
      } catch {
        setToastMsg("유저 노트 저장 중 오류가 발생했습니다.");
        return false;
      } finally {
        endSettingsSave();
      }
    },
    [chatId, nsfwMode, chatTitle, widgetReservedChars]
  );

  const persistUserChatPrefs = useCallback(async () => {
    setDisplaySettingsSaving(true);
    try {
      const res = await fetch("/api/user/chat-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chatId ?? undefined,
          targetResponseChars,
          userNote,
          displayPrefs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMsg(data.error || "채팅 설정 저장에 실패했습니다.");
        return false;
      }
      if (data.prefs) {
        cacheUserChatPrefsClient(data.prefs);
        saveChatDisplayPrefs(data.prefs.displayPrefs ?? displayPrefs);
      }
      setToastMsg("채팅 설정이 저장되었습니다. 모든 대화방에 적용됩니다.");
      return true;
    } catch {
      setToastMsg("채팅 설정 저장 중 오류가 발생했습니다.");
      return false;
    } finally {
      setDisplaySettingsSaving(false);
    }
  }, [
    chatId,
    targetResponseChars,
    userNote,
    displayPrefs,
  ]);

  useEffect(() => {
    if (!chatId) return;
    if (settingsSkipAutoSaveRef.current) {
      settingsSkipAutoSaveRef.current = false;
      return;
    }
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(() => {
      void persistChatSettings();
    }, 600);
    return () => {
      if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    };
  }, [chatId, nsfwMode, chatTitle, narrativePov, povCharacterName, persistChatSettings]);

  useEffect(() => {
    if (initialGlobalModelNotice?.trim()) {
      setToastMsg(initialGlobalModelNotice);
    }
  }, [initialChatId, initialGlobalModelNotice]);

  useEffect(() => {
    settingsSkipAutoSaveRef.current = true;
    setUserNote(initialUserNote);
    setNotePresets(initialNotePresets);
    setSelectedAI(initialSelectedAI);
    setMode(initialMode);
    setTargetResponseChars(initialTargetResponseChars);
    setChatTitle(initialChatTitle);
    setNarrativePov(initialNarrativePov);
    setPovCharacterName(initialPovCharacterName);
    // Prefer device localStorage so 에셋 ON/OFF survives leaving the room.
    setDisplayPrefs(resolveClientDisplayPrefs(initialDisplayPrefs ?? DEFAULT_CHAT_DISPLAY_PREFS));
    setSelectedPersonaId(initialSelectedPersonaId);
  }, [
    initialChatId,
    initialUserNote,
    initialNotePresets,
    initialSelectedAI,
    initialMode,
    initialTargetResponseChars,
    initialChatTitle,
    initialNarrativePov,
    initialPovCharacterName,
    initialDisplayPrefs,
    initialSelectedPersonaId,
  ]);

  const [floatDeductionAmount, setFloatDeductionAmount] = useState(0);
  const [floatDeductionTrigger, setFloatDeductionTrigger] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const quoteSelectContainerRef = useRef<HTMLDivElement>(null);
  const inputDockRef = useRef<HTMLDivElement>(null);
  /** true면 새 청크마다 하단으로 스크롤 — 사용자가 위로 올리면 false */
  const followStreamRef = useRef(true);
  /** 스트리밍 중 사용자가 직접 스크롤하면 true — 자동 따라가기 일시 중단 */
  const userScrollLockRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const applyEmotionRef = useRef<(text: string, showUnlockNotice?: boolean) => void>(() => {});
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const inFlightRef = useRef(false);
  const pendingServerSyncRef = useRef(false);
  const chatFetchAbortRef = useRef<AbortController | null>(null);
  const chatMountedRef = useRef(true);

  const beginChatFetch = useCallback((): AbortSignal => {
    chatFetchAbortRef.current?.abort();
    const controller = new AbortController();
    chatFetchAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      controller.abort(new DOMException("Chat fetch timed out", "TimeoutError"));
    }, CHAT_FETCH_TIMEOUT_MS);
    controller.signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
      },
      { once: true }
    );
    return controller.signal;
  }, []);

  useEffect(() => {
    chatMountedRef.current = true;
    return () => {
      chatMountedRef.current = false;
      chatFetchAbortRef.current?.abort();
      chatFetchAbortRef.current = null;
    };
  }, []);

  const syncChatUrl = useCallback(
    (id: number | null) => {
      if (!id || typeof window === "undefined") return;
      const url = new URL(window.location.href);
      if (
        url.searchParams.get("chat") === String(id) &&
        !url.searchParams.has("fresh") &&
        !url.searchParams.has("persona")
      ) {
        return;
      }
      url.searchParams.set("chat", String(id));
      url.searchParams.delete("fresh");
      url.searchParams.delete("persona");
      router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
    },
    [router]
  );

  applyEmotionRef.current = (text: string, showUnlockNotice = true) => {
    const { tag } = stripEmotionTag(text);
    if (!tag || assets.length === 0) return;
    const allowed = assets.filter((a) => a.chat !== false).map((a) => a.tag);
    const resolved = resolveEmotionTag(tag, allowed);
    if (!resolved) return;
    const asset = findAssetByTag(assets, resolved);
    if (!asset) return;

    const wasLocked =
      !isCharacterCreator &&
      asset.viewerBlur === true &&
      !unlockedUrlsRef.current.has(asset.url);

    if (wasLocked) {
      unlockedUrlsRef.current.add(asset.url);
      saveUnlockedCharacterAssetUrls(character.id, unlockedUrlsRef.current);
      setUnlockedUrls(new Set(unlockedUrlsRef.current));
      if (showUnlockNotice) {
        setToastMsg(`「${asset.tag}」 표정 이미지가 해금되었습니다`);
      }
    }

    if (portraitPinnedRef.current) return;
    setActivePortraitUrl(asset.url);
    setActivePortraitTag(asset.tag);
  };

  const handlePortraitSelected = useCallback((asset: CharacterAsset) => {
    setActivePortraitUrl(asset.url);
    setActivePortraitTag(asset.tag);
  }, []);

  const handlePortraitPinnedChange = useCallback((next: boolean) => {
    portraitPinnedRef.current = next;
    setPortraitPinned(next);
  }, []);

  const { lastUserIdx, lastAssistantIdx } = useMemo(
    () => findLastTurnIndices(messages),
    [messages]
  );

  const canContinue = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "system" && m.ephemeral) continue;
      if (m.role !== "assistant") return false;
      if (isPendingGenerationStatus(m.generationStatus)) return false;
      return m.content.trim().length > 0;
    }
    return false;
  }, [messages]);

  /** DB/UI still in-flight even after loading cleared (stuck regen / incomplete SSE). */
  const lastTurnInFlight = useMemo(() => {
    if (lastAssistantIdx < 0) return false;
    const m = messages[lastAssistantIdx];
    return m?.role === "assistant" && isInFlightGenerationStatus(m.generationStatus);
  }, [messages, lastAssistantIdx]);

  const inputLocked = loading || lastTurnInFlight;

  const [pickerPreview, setPickerPreview] = useState<ModelPickerPreviewResult | null>(null);
  const pickerPreviewBaseRef = useRef<number | null>(null);
  const pickerPreviewGateRef = useRef(createModelPickerPreviewRequestGate());

  const fetchPickerPreview = useCallback(
    async (opts: {
      refreshContext?: boolean;
      skipContextBuild?: boolean;
      draftInput?: string;
      inputTokensOverride?: number;
    }) => {
      if (!chatId) return;
      const requestSeq = pickerPreviewGateRef.current.next();
      try {
        const res = await fetch("/api/chat/model-picker-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            targetResponseChars,
            refreshContext: opts.refreshContext === true,
            skipContextBuild: opts.skipContextBuild === true,
            draftInput: opts.inputTokensOverride != null ? undefined : opts.draftInput,
            inputTokensOverride: opts.inputTokensOverride,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as ModelPickerPreviewResult;
        if (!pickerPreviewGateRef.current.isLatest(requestSeq)) return;
        pickerPreviewBaseRef.current = data.baseInputTokens;
        setPickerPreview(data);
      } catch {
        /* non-blocking preview */
      }
    },
    [chatId, targetResponseChars]
  );

  useEffect(() => {
    if (!chatId) return;
    void fetchPickerPreview({ refreshContext: true });
  }, [chatId, messages.length, userNote, selectedPersonaId, targetResponseChars, fetchPickerPreview]);

  useEffect(() => {
    if (!chatId || pickerPreviewBaseRef.current == null) return;
    const draftTok = input.trim() ? Math.max(1, Math.ceil(input.trim().length * 0.9)) : 0;
    const timer = window.setTimeout(() => {
      void fetchPickerPreview({
        skipContextBuild: true,
        inputTokensOverride: pickerPreviewBaseRef.current! + draftTok,
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [chatId, input, fetchPickerPreview]);

  /** Multi-tab: refresh global selected_ai on focus (server remains SoT for generation). */
  useEffect(() => {
    const sync = () => {
      void fetch("/api/user/selected-ai")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { selectedAI?: SelectedAI } | null) => {
          if (data?.selectedAI && data.selectedAI !== selectedAI) {
            setSelectedAI(data.selectedAI);
          }
        })
        .catch(() => {});
    };
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [selectedAI]);

  const clientMaxMessageId = useMemo(
    () => messages.reduce((max, m) => (m.id != null && m.id > max ? m.id : max), 0),
    [messages]
  );

  const activePersonaName = useMemo(
    () => personas.find((p) => p.id === selectedPersonaId)?.name ?? "",
    [personas, selectedPersonaId]
  );

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selectedPersonaId) ?? null,
    [personas, selectedPersonaId]
  );

  const statusWidgetProfileNames = useMemo(
    () => ({
      characterName: character.name,
      personaName: activePersonaName,
      fallbackNickname: nickname,
    }),
    [character.name, activePersonaName, nickname]
  );


  useEffect(() => {
    const scope = `${character.id}:${chatId ?? "pending"}`;
    if (scope === draftScopeRef.current) return;
    draftScopeRef.current = scope;
    setInput(loadChatMessageDraft(character.id, chatId));
  }, [character.id, chatId]);

  useEffect(() => {
    saveChatMessageDraft(character.id, chatId, input);
  }, [character.id, chatId, input]);

  useEffect(() => {
    if (chatId != null) migrateChatMessageDraft(character.id, chatId);
  }, [character.id, chatId]);

  /** Prefer DB; sessionStorage only if DB has not caught up for an in-flight turn. */
  useEffect(() => {
    if (loadingRef.current || inFlightRef.current) return;
    const draft = readChatStreamDraft(character.id, chatId ?? initialChatId);
    if (!draft?.requestId) return;

    setMessages((prev) => {
      const matchAssistant = prev.find(
        (m) => m.role === "assistant" && m.requestId === draft.requestId
      );
      const matchUser = prev.find((m) => m.role === "user" && m.requestId === draft.requestId);

      if (matchAssistant && isTerminalGenerationStatus(matchAssistant.generationStatus)) {
        clearChatStreamDraft(character.id, chatId ?? initialChatId);
        return prev;
      }

      if (
        matchAssistant &&
        isInFlightGenerationStatus(matchAssistant.generationStatus) &&
        draft.assistantPartial.length > (matchAssistant.content?.length ?? 0)
      ) {
        if (process.env.NODE_ENV !== "production") {
          console.log("[StreamingPersistence]", {
            recoveredOnLoad: true,
            request_id: draft.requestId,
            source: "sessionStorage-ahead-of-db",
          });
        }
        return prev.map((m) =>
          m.role === "assistant" && m.requestId === draft.requestId
            ? {
                ...m,
                content: draft.assistantPartial,
                generationStatus: m.generationStatus ?? "generating",
              }
            : m
        );
      }

      if (!matchAssistant && !matchUser && draft.userText) {
        if (process.env.NODE_ENV !== "production") {
          console.log("[StreamingPersistence]", {
            recoveredOnLoad: true,
            request_id: draft.requestId,
            source: "sessionStorage-only",
          });
        }
        return [
          ...prev,
          {
            role: "user" as const,
            content: draft.userText,
            requestId: draft.requestId,
            generationStatus: "submitted",
          },
          {
            role: "assistant" as const,
            content: draft.assistantPartial || "",
            requestId: draft.requestId,
            generationStatus: "generating",
          },
        ];
      }

      return prev;
    });
    // Intentionally once per room scope — not on every messages change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, chatId, initialChatId]);

  useEffect(() => {
    syncChatUrl(initialChatId);
  }, [initialChatId, syncChatUrl]);

  useEffect(() => {
    syncChatUrl(chatId);
  }, [chatId, syncChatUrl]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      router.refresh();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  useEffect(() => {
    if (loadingRef.current || inFlightRef.current) return;

    const serverMaxId = initialMessages.reduce(
      (max, m) => (m.id != null && m.id > max ? m.id : max),
      0
    );

    if (pendingServerSyncRef.current) {
      if (serverMaxId <= clientMaxMessageId) {
        pendingServerSyncRef.current = false;
        setMessages((prev) =>
          mergeMessagesKeepingOlderPrefix<ChatMessageLike>(
            withoutEphemeralSystem(prev),
            toChatMessageLike(initialMessages),
            {
              keepTailWithoutId: loadingRef.current || inFlightRef.current,
            }
          ) as Msg[]
        );
        setHasMoreOlder(initialHasMoreOlder);
        setHiddenTurnCount(initialHiddenTurnCount);
        setBookmarkedIds(new Set(initialBookmarkedIds));
      }
      return;
    }

    // 다른 채팅방으로 전환
    if (initialChatId != null && initialChatId !== chatId) {
      setChatId(initialChatId);
      setMessages(initialMessages);
      setHasMoreOlder(initialHasMoreOlder);
      setHiddenTurnCount(initialHiddenTurnCount);
      setBookmarkedIds(new Set(initialBookmarkedIds));
      return;
    }

    // 스트림 done 직후 chatId만 먼저 생긴 경우 — 서버 props 따라잡기 전에 메시지를 지우지 않음
    if (chatId != null && initialChatId == null) return;

    if (initialChatId == null) return;

    // 서버에 더 새로운 메시지가 있을 때만 동기화
    if (serverMaxId > clientMaxMessageId) {
      setMessages((prev) =>
        mergeMessagesKeepingOlderPrefix<ChatMessageLike>(
          withoutEphemeralSystem(prev),
          toChatMessageLike(initialMessages),
          {
            keepTailWithoutId: loadingRef.current || inFlightRef.current,
          }
        ) as Msg[]
      );
      setHasMoreOlder(initialHasMoreOlder);
      setHiddenTurnCount(initialHiddenTurnCount);
      setBookmarkedIds(new Set(initialBookmarkedIds));
    }
  }, [
    initialChatId,
    initialMessages,
    initialBookmarkedIds,
    initialHasMoreOlder,
    initialHiddenTurnCount,
    chatId,
    clientMaxMessageId,
  ]);

  /** 재생성 — message id 동일 · router.refresh 후 SSR status_meta·영수증 usage 반영 */
  useEffect(() => {
    if (loadingRef.current || inFlightRef.current) return;
    setMessages((prev) =>
      mergeStatusMetaFieldsById(mergeBillingUsageFromServer(prev, initialMessages), initialMessages)
    );
  }, [initialMessages]);

  const portraitRoomRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (portraitRoomRef.current === initialChatId) return;
    portraitRoomRef.current = initialChatId;
    const scanned = scanMessagesForPortrait(initialMessages, assets, isCharacterCreator);
    const nextUnlocked = new Set(scanned.unlocked);
    for (const url of initialUnlockedAssetUrls) nextUnlocked.add(url);
    for (const url of loadUnlockedCharacterAssetUrls(character.id)) nextUnlocked.add(url);
    if (scanned.unlocked.size > 0 || initialUnlockedAssetUrls.length > 0) {
      saveUnlockedCharacterAssetUrls(character.id, nextUnlocked);
    }
    setActivePortraitUrl(scanned.activeUrl);
    setActivePortraitTag(scanned.activeTag);
    unlockedUrlsRef.current = nextUnlocked;
    setUnlockedUrls(new Set(nextUnlocked));
  }, [initialChatId, initialMessages, assets, isCharacterCreator, character.id, initialUnlockedAssetUrls]);

  useEffect(() => {
    displayPrefsRef.current = displayPrefs;
    activeStreamRevealRef.current?.syncOptions();
  }, [displayPrefs]);

  function handlePersonaUpdated(updated: PersonaListItem) {
    setPersonas((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  }

  useEffect(() => {
    setPersonas(initialPersonas);
  }, [initialPersonas]);

  useEffect(() => {
    let cancelled = false;
    async function refreshPersonas() {
      try {
        const res = await fetch("/api/personas", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { personas?: PersonaListItem[] };
        if (cancelled || !Array.isArray(data.personas)) return;
        setPersonas(data.personas);
        setSelectedPersonaId((prev) => {
          if (prev != null && data.personas!.some((p) => p.id === prev)) return prev;
          return data.personas![0]?.id ?? prev;
        });
      } catch {
        /* ignore */
      }
    }
    void refreshPersonas();
    function onVisible() {
      if (document.visibilityState === "visible") void refreshPersonas();
    }
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) void refreshPersonas();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [chatId]);

  const toDisplay = (content: string) => replaceUserPlaceholder(content, activePersonaName, nickname);

  const SCROLL_BOTTOM_THRESHOLD_PX = 80;

  const getInputDockHeight = useCallback(() => inputDockRef.current?.offsetHeight ?? 0, []);
  const getInputDockBottomOffset = useCallback(() => {
    if (typeof window === "undefined") return 0;
    return window.matchMedia("(min-width: 640px)").matches ? 0 : 48;
  }, []);

  /** sticky 입력창 위쪽을 “시각적 하단”으로 간주 */
  const isNearBottom = useCallback(() => {
    if (typeof window === "undefined") return true;
    const dockH = getInputDockHeight();
    const dockBottom = getInputDockBottomOffset();
    const { scrollY, innerHeight } = window;
    const docHeight = document.documentElement.scrollHeight;
    const gap = docHeight - scrollY - innerHeight;
    return gap <= SCROLL_BOTTOM_THRESHOLD_PX + dockH + dockBottom;
  }, [getInputDockHeight, getInputDockBottomOffset]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const anchor = bottomRef.current;
      if (!anchor || typeof window === "undefined") return;
      const dockH = getInputDockHeight();
      const dockBottom = getInputDockBottomOffset();
      const isMobile = !window.matchMedia("(min-width: 640px)").matches;
      const toolbars = document.querySelectorAll<HTMLElement>('[data-chat-message-toolbar="true"]');
      const targetElement =
        toolbars && toolbars.length > 0 ? toolbars[toolbars.length - 1] : anchor;
      const pad = isMobile ? 2 : displayPrefs.showCharacterPortrait ? 4 : 2;
      const rect = targetElement.getBoundingClientRect();
      const targetBottom = window.innerHeight - dockH - dockBottom - pad;
      const delta = rect.bottom - targetBottom;
      if (Math.abs(delta) < 2) return;
      window.scrollTo({
        top: Math.max(0, window.scrollY + delta),
        behavior,
      });
    },
    [getInputDockHeight, getInputDockBottomOffset, displayPrefs.showCharacterPortrait]
  );

  const scheduleScrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      if (!followStreamRef.current || userScrollLockRef.current) return;
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        if (!followStreamRef.current || userScrollLockRef.current) return;
        scrollToBottom(behavior);
      });
    },
    [scrollToBottom]
  );

  useEffect(() => {
    let touchStartY = 0;

    const onScroll = () => {
      if (userScrollLockRef.current) {
        if (isNearBottom()) {
          userScrollLockRef.current = false;
          followStreamRef.current = true;
        } else {
          followStreamRef.current = false;
        }
        return;
      }
      followStreamRef.current = isNearBottom();
    };

    const onWheel = (e: WheelEvent) => {
      if (!loadingRef.current) return;
      if (e.deltaY < 0) {
        userScrollLockRef.current = true;
        followStreamRef.current = false;
        return;
      }
      if (e.deltaY > 0 && isNearBottom()) {
        userScrollLockRef.current = false;
        followStreamRef.current = true;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!loadingRef.current) return;
      const y = e.touches[0]?.clientY ?? touchStartY;
      if (y - touchStartY > 8) {
        userScrollLockRef.current = true;
        followStreamRef.current = false;
      } else if (touchStartY - y > 8 && isNearBottom()) {
        userScrollLockRef.current = false;
        followStreamRef.current = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [isNearBottom]);

  useEffect(() => {
    if (hasBookmarkScrollTarget && scrollMessageIdRef.current != null) return;
    if (!followStreamRef.current || userScrollLockRef.current || loadingOlder) return;
    scheduleScrollToBottom(loading ? "instant" : "smooth");
  }, [messages, loading, loadingOlder, scheduleScrollToBottom, hasBookmarkScrollTarget]);

  /** 채팅방 진입·전환 시 최신 대화가 보이도록 즉시 하단 스크롤 */
  useEffect(() => {
    if (hasBookmarkScrollTarget) {
      followStreamRef.current = false;
      userScrollLockRef.current = true;
      return;
    }
    followStreamRef.current = true;
    userScrollLockRef.current = false;
    const run = () => scrollToBottom("instant");
    run();
    const raf = requestAnimationFrame(() => requestAnimationFrame(run));
    const timer = window.setTimeout(run, 180);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [initialChatId, scrollToBottom, hasBookmarkScrollTarget]);

  useEffect(() => {
    if (loadingRef.current || inFlightRef.current) return;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role !== "assistant" || m.id == null) continue;
      const needsStatusPoll =
        m.statusMetaPending === true ||
        (m.statusMetaRequested === true &&
          m.statusMetaFailed !== true &&
          !statusMetaHasDisplayContent(m.statusMeta, m.statusMetaFormatSpec)) ||
        (m.statusMetaFailed === true && m.statusMetaRequested === true);
      if (!needsStatusPoll) continue;
      let userMsg = "";
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j]?.role === "user") {
          userMsg = messages[j]!.content;
          break;
        }
      }
      if (
        htmlVisualStatusActiveForChat(
          userNote,
          markdownStatusWindowActive,
          userMsg,
          selectedPersona?.description ?? null,
          statusWidgetActive
        )
      ) {
        continue;
      }
      if (statusMetaPollStartedRef.current.has(m.id)) continue;
      startStatusMetaPoll(
        m.id,
        statusMetaPollStartedRef,
        setMessages,
        userNote,
        markdownStatusWindowActive,
        () => router.refresh(),
        {
          statusWidgetActive,
          userMessage: userMsg,
          userPersona: selectedPersona?.description ?? null,
        }
      );
    }
  }, [messages, userNote, markdownStatusWindowActive, router, selectedPersona?.description, statusWidgetActive]);

  const loadOlderMessages = useCallback(async () => {
    if (!chatId || loadingOlder || !hasMoreOlder || loading || inFlightRef.current) return;

    const beforeId = messages.find((m) => m.id != null && m.id > 0)?.id;
    if (!beforeId) return;

    setLoadingOlder(true);
    followStreamRef.current = false;
    userScrollLockRef.current = true;
    const prevScrollHeight = document.documentElement.scrollHeight;
    const prevScrollTop = window.scrollY;

    try {
      const res = await fetch(
        `/api/chat/messages?chatId=${chatId}&beforeMessageId=${beforeId}&turnLimit=${CHAT_LOAD_MORE_TURNS}`
      );
      const data = (await res.json()) as {
        error?: string;
        messages?: Msg[];
        hasMoreOlder?: boolean;
      };
      if (!res.ok) {
        setToastMsg(data.error || "이전 대화를 불러오지 못했습니다.");
        return;
      }
      const batch = data.messages ?? [];
      if (batch.length === 0) {
        setHasMoreOlder(false);
        setHiddenTurnCount(0);
        return;
      }

      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id).filter((id): id is number => id != null));
        const fresh = batch.filter((m) => m.id != null && !seen.has(m.id));
        return [...fresh, ...prev];
      });
      setHasMoreOlder(!!data.hasMoreOlder);
      setHiddenTurnCount((c) => (data.hasMoreOlder ? Math.max(0, c - CHAT_LOAD_MORE_TURNS) : 0));

      requestAnimationFrame(() => {
        const delta = document.documentElement.scrollHeight - prevScrollHeight;
        window.scrollTo({ top: prevScrollTop + delta, behavior: "instant" });
        userScrollLockRef.current = false;
      });
    } catch {
      setToastMsg("이전 대화를 불러오지 못했습니다.");
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, hasMoreOlder, loading, loadingOlder, messages]);

  useEffect(() => {
    const targetId = scrollMessageIdRef.current;
    if (!targetId) return;
    if (!messages.some((m) => m.id === targetId)) return;

    const el = document.getElementById(`msg-${targetId}`);
    if (!el) return;

    scrollMessageIdRef.current = null;
    followStreamRef.current = false;
    userScrollLockRef.current = true;

    const scrollToTarget = () => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    requestAnimationFrame(() => {
      scrollToTarget();
      window.setTimeout(scrollToTarget, 150);
      window.setTimeout(scrollToTarget, 400);
    });

    const prevScrollMargin = el.style.scrollMarginTop;
    el.style.scrollMarginTop = "5rem";
    scrollHighlightRef.current = el;
    window.setTimeout(() => {
      if (scrollHighlightRef.current === el) {
        el.style.scrollMarginTop = prevScrollMargin;
        scrollHighlightRef.current = null;
      }
    }, 2500);
  }, [messages]);

  async function consumeChatStream(res: Response, aiIndex: number) {
    if (!res.body) throw new Error("스트림 본문이 없습니다.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError = "";
    let trafficOverload = "";
    let sawDone = false;
    let sawError = false;
    let persistedAssistantMessageId: number | null = null;
    let eofUnresolved = false;
    let pendingDone: {
      chatId?: number;
      messageId?: number;
      userMessageId?: number | null;
      mode?: "safe" | "nsfw";
      cost?: number;
      totalPointsCost?: number;
      remainingPoints?: number;
      paidPoints?: number;
      freePoints?: number;
      usage?: Usage;
      memoryUpdated?: boolean;
      variants?: MessageVariant[];
      activeVariant?: number;
      variantCount?: number;
      finalContent?: string;
      trafficOverload?: boolean;
      skipPersistence?: boolean;
      statusMetaPending?: boolean;
      htmlFlashTurn?: boolean;
      showStatusMarkdown?: boolean;
      statusWidgetActive?: boolean;
      statusWidgetTurnActive?: boolean;
      statusWidgetValues?: ParsedStatusWidgetTurnValues | null;
    } | null = null;

    /** reset 후 첫 청크까지 기존 텍스트 유지 — "초안 작성 중" 깜빡임 방지 */
    let softResetPending = false;
    /** OpenRouter 종료·후처리 구간 — 비 instant replace/append 무시 (reveal 큐는 계속 재생) */
    let postStreamLocked = false;
    /** OOC/HTML 전용 턴 — V3 비스트리밍·대용량 ```html``` 즉시 표시 */
    let htmlFlashStreamTurn = false;

    assistantStreamContentRef.current = "";
    streamTargetTextRef.current = "";

    const reveal = createStreamReveal(
      {
        onAppend: (chunk) => {
          assistantStreamContentRef.current += chunk;
          const nextContent = assistantStreamContentRef.current;
          setMessages((m) => {
            const copy = [...m];
            const cur = copy[aiIndex];
            if (cur?.role === "assistant") {
              copy[aiIndex] = {
                ...cur,
                content: nextContent,
                generationStatus: cur.generationStatus ?? "generating",
              };
              applyEmotionRef.current(nextContent);
              const rid = cur.requestId;
              if (rid) {
                const userText =
                  copy[aiIndex - 1]?.role === "user" ? copy[aiIndex - 1]!.content : "";
                writeChatStreamDraft(character.id, chatId, {
                  requestId: rid,
                  chatId: chatId ?? 0,
                  userText,
                  assistantPartial: nextContent,
                  updatedAt: Date.now(),
                });
              }
            }
            return copy;
          });
        },
      },
      () => ({
        intervalMs: displayPrefsRef.current.streamIntervalMs,
        charsPerTick: displayPrefsRef.current.streamCharsPerTick,
      })
    );
    activeStreamRevealRef.current = reveal;

    function setAssistantContentInstant(text: string) {
      assistantStreamContentRef.current = text;
      streamTargetTextRef.current = text;
      setMessages((m) => {
        const copy = [...m];
        const cur = copy[aiIndex];
        if (cur?.role === "assistant") {
          copy[aiIndex] = { ...cur, content: text };
          applyEmotionRef.current(text);
        }
        return copy;
      });
    }

    /** 서버 목표 텍스트까지 — 설정 간격으로 큐 재생 (replace·finalContent 포함) */
    function syncStreamToText(newText: string, forceInstant = false) {
      const priorTarget = streamTargetTextRef.current;
      streamTargetTextRef.current = newText;
      if (forceInstant || displayPrefsRef.current.streamIntervalMs <= 0) {
        reveal.reset();
        setAssistantContentInstant(newText);
        return;
      }

      const plan = planStreamRevealCatchUp(
        assistantStreamContentRef.current,
        newText,
        priorTarget,
        streamTargetTextRef.current
      );
      const displayed = assistantStreamContentRef.current;
      if (!plan) {
        if (newText.startsWith(displayed)) {
          const tail = newText.slice(displayed.length);
          if (tail) reveal.enqueue(tail);
        }
        return;
      }

      if (plan.setPrefix === "" && displayed.length > 80) {
        // Full divergence — snap instantly. Never retype the whole reply from char 0.
        reveal.reset();
        setAssistantContentInstant(newText);
        return;
      }

      if (plan.resetQueue || plan.setPrefix !== assistantStreamContentRef.current) {
        reveal.reset();
      }
      if (plan.setPrefix !== assistantStreamContentRef.current) {
        const displayedCollapsed = collapseStreamCompareText(assistantStreamContentRef.current);
        const prefixCollapsed = collapseStreamCompareText(plan.setPrefix);
        if (
          displayedCollapsed !== prefixCollapsed &&
          !assistantStreamContentRef.current.startsWith(plan.setPrefix)
        ) {
          setAssistantContentInstant(plan.setPrefix);
        }
      }
      if (plan.enqueue) reveal.enqueue(plan.enqueue);
    }

    function appendStreamText(text: string, forceAppend = false) {
      if (softResetPending && !forceAppend) {
        softResetPending = false;
        syncStreamToText(text, true);
        return;
      }
      if (forceAppend && reveal.isPaused()) {
        reveal.resume();
      }
      if (forceAppend) {
        softResetPending = false;
      }
      if (reveal.isPaused() && !forceAppend) {
        streamTargetTextRef.current += text;
        return;
      }
      if (displayPrefsRef.current.streamIntervalMs <= 0) {
        setAssistantContentInstant(assistantStreamContentRef.current + text);
      } else {
        const st = streamTargetTextRef.current;
        const displayed = assistantStreamContentRef.current;
        if (text && st.endsWith(text) && st.length - text.length >= displayed.length) {
          return;
        }
        streamTargetTextRef.current += text;
        reveal.enqueue(text);
      }
    }

    /** replace·finalContent — prefix append 우선, 불일치 시 retype 대신 instant snap */
    function applyStreamReplaceTarget(
      target: string,
      opts?: { instant?: boolean; fallbackInstant?: boolean }
    ) {
      softResetPending = false;
      const displayed = assistantStreamContentRef.current;
      const streamTarget = streamTargetTextRef.current;

      const appendTail = resolveStreamAppendTail(displayed, streamTarget, target);
      if (appendTail !== null) {
        appendStreamText(appendTail, true);
        return;
      }
      if (target === streamTarget) {
        return;
      }

      // Same prose / different newlines only — keep streamed paragraph layout (7.10C).
      if (
        displayed &&
        collapseStreamCompareText(displayed) === collapseStreamCompareText(target)
      ) {
        streamTargetTextRef.current = displayed;
        return;
      }

      if (
        displayed.length > 80 &&
        target.length < displayed.length * STREAM_SAVE_MIN_RETENTION
      ) {
        reveal.reset();
        setAssistantContentInstant(target);
        return;
      }

      const cd = collapseStreamCompareText(displayed);
      const cn = collapseStreamCompareText(target);
      if (cd.length >= 40 && cn.startsWith(cd)) {
        const mapped = rawPrefixForCollapsedCompare(target, cd);
        if (mapped.length >= displayed.length * STREAM_SAVE_MIN_RETENTION) {
          if (
            mapped !== displayed &&
            collapseStreamCompareText(mapped) !== collapseStreamCompareText(displayed)
          ) {
            reveal.reset();
            setAssistantContentInstant(mapped);
          }
          const collapsedAppendTail = resolveStreamAppendTail(
            assistantStreamContentRef.current,
            streamTargetTextRef.current,
            target
          );
          if (collapsedAppendTail) appendStreamText(collapsedAppendTail, true);
          return;
        }
      }

      if (
        opts?.instant === true ||
        opts?.fallbackInstant === true ||
        displayPrefsRef.current.streamIntervalMs <= 0
      ) {
        reveal.reset();
        setAssistantContentInstant(target);
        return;
      }

      syncStreamToText(target, false);
    }

    const applyStreamDone = (data: NonNullable<typeof pendingDone>) => {
      setChatId(data.chatId ?? chatId);
      if (data.chatId) {
        migrateChatMessageDraft(character.id, data.chatId);
        syncChatUrl(data.chatId);
      }
      if (data.mode) {
        setMode(data.mode);
      }
      if (data.memoryUpdated) setMemoryRefreshKey((k) => k + 1);
      setMessages((m) => {
        const copy = [...m];
        if (data.userMessageId != null) {
          const userIdx = aiIndex - 1;
          if (userIdx >= 0 && copy[userIdx]?.role === "user") {
            copy[userIdx] = { ...copy[userIdx], id: data.userMessageId ?? undefined };
          }
        }
        const cur = copy[aiIndex];
        if (cur?.role === "assistant") {
          const resolvedUsage =
            data.usage?.statusWidgetExtract
              ? data.usage
              : resolveActiveUsage(data.usage ?? null, data.variants, data.activeVariant);
          const userMsg =
            copy[aiIndex - 1]?.role === "user" ? copy[aiIndex - 1]!.content : "";
          const htmlFlashTurn =
            data.htmlFlashTurn === true ||
            htmlVisualStatusActiveForChat(
              userNote,
              markdownStatusWindowActive,
              userMsg,
              selectedPersona?.description ?? null,
              statusWidgetActive
            );
          const flashScheduled = !htmlFlashTurn && data.statusMetaPending === true;
          const activeVariantSource = resolveActiveVariantContent({
            content: data.finalContent ?? cur.content,
            variants: data.variants,
            activeVariant: data.activeVariant,
          });
          const canonicalDoneContent = getCanonicalProseBody(activeVariantSource);
          logProseSourceDivergenceDev({
            messageId: data.messageId,
            phase: "applyStreamDone",
            streamingSource: assistantStreamContentRef.current || cur.content,
            activeVariantSource,
            displaySource: canonicalDoneContent,
            editSource: canonicalDoneContent,
            usedPreferDisplayedNewlineLayout: false,
            sourceFieldUsedByEditModal: "activeVariant",
          });
          copy[aiIndex] = {
            ...cur,
            id: data.messageId,
            content: canonicalDoneContent,
            model: resolvedUsage?.model ?? data.usage?.model,
            usage: resolvedUsage,
            variants: data.variants,
            activeVariant: data.activeVariant,
            variantCount: data.variantCount,
            generationStatus: "completed",
            requestId: cur.requestId,
            statusMetaPending: flashScheduled,
            statusMetaRequested: flashScheduled,
            statusMetaFailed: htmlFlashTurn ? false : cur.statusMetaFailed,
            statusMeta: htmlFlashTurn ? null : flashScheduled ? null : cur.statusMeta,
            statusMetaFormatSpec: flashScheduled
              ? (chatStatusFormatSpec ?? cur.statusMetaFormatSpec ?? null)
              : htmlFlashTurn
                ? null
                : cur.statusMetaFormatSpec,
            statusWidgetValues: htmlFlashTurn
              ? null
              : data.statusWidgetActive || data.statusWidgetTurnActive
                ? (data.statusWidgetValues ?? null)
                : (data.statusWidgetValues ?? cur.statusWidgetValues ?? null),
            statusWidgetTurnActive: htmlFlashTurn
              ? false
              : (data.statusWidgetTurnActive ??
                (data.statusWidgetActive === true ? true : cur.statusWidgetTurnActive)),
            createdAt: new Date().toISOString(),
            reportStatus: "none",
          };
          if (data.finalContent) applyEmotionRef.current(data.finalContent);
          clearChatStreamDraft(character.id, data.chatId ?? chatId);
        }
        return copy;
      });
      if (data.statusMetaPending && data.messageId && data.htmlFlashTurn !== true) {
        const userMsg =
          messages[aiIndex - 1]?.role === "user" ? messages[aiIndex - 1]!.content : "";
        if (
          htmlVisualStatusActiveForChat(
            userNote,
            markdownStatusWindowActive,
            userMsg,
            selectedPersona?.description ?? null,
            statusWidgetActive
          )
        ) {
          router.refresh();
        } else {
        startStatusMetaPoll(
          data.messageId,
          statusMetaPollStartedRef,
          setMessages,
          userNote,
          markdownStatusWindowActive,
          () => router.refresh(),
          {
            statusWidgetActive,
            userMessage: userMsg,
            userPersona: selectedPersona?.description ?? null,
          }
        );
        }
      } else {
        router.refresh();
      }
    };

    function extractBillingInfo(
      data: NonNullable<typeof pendingDone>
    ): { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number } | undefined {
      const turnCost = data.totalPointsCost ?? data.cost ?? 0;
      if (turnCost <= 0 || data.remainingPoints == null) return undefined;
      return {
        turnCost,
        remainingPoints: data.remainingPoints,
        paidPoints: data.paidPoints ?? 0,
        freePoints: data.freePoints ?? 0,
      };
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          let data: {
            text?: string;
            type?: string;
            message?: string;
            error?: string;
            chatId?: number;
            messageId?: number;
            userMessageId?: number | null;
            requestId?: string;
            mode?: "safe" | "nsfw";
            cost?: number;
            totalPointsCost?: number;
            remainingPoints?: number;
            paidPoints?: number;
            freePoints?: number;
            usage?: Usage;
            memoryUpdated?: boolean;
            statusMetaPending?: boolean;
            showStatusMarkdown?: boolean;
            variants?: MessageVariant[];
            activeVariant?: number;
            variantCount?: number;
            finalContent?: string;
            trafficOverload?: boolean;
            skipPersistence?: boolean;
            forceAppend?: boolean;
            instant?: boolean;
            htmlFlashTurn?: boolean;
            alreadyCompleted?: boolean;
            generationUi?: unknown;
          };
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (data.type === "turn_persisted") {
            const rid = data.requestId;
            const nextChatId = data.chatId ?? chatId;
            if (data.messageId != null && Number.isFinite(data.messageId)) {
              persistedAssistantMessageId = data.messageId;
            }
            if (data.chatId) {
              setChatId(data.chatId);
              migrateChatMessageDraft(character.id, data.chatId);
              syncChatUrl(data.chatId);
            }
            setMessages((m) => {
              const copy = [...m];
              const userIdx = aiIndex - 1;
              if (userIdx >= 0 && copy[userIdx]?.role === "user") {
                copy[userIdx] = {
                  ...copy[userIdx],
                  id: data.userMessageId ?? copy[userIdx].id,
                  requestId: rid ?? copy[userIdx].requestId,
                  generationStatus: copy[userIdx].generationStatus ?? "submitted",
                };
              }
              const cur = copy[aiIndex];
              if (cur?.role === "assistant") {
                copy[aiIndex] = {
                  ...cur,
                  id: data.messageId ?? cur.id,
                  requestId: rid ?? cur.requestId,
                  generationStatus: cur.generationStatus ?? "generating",
                };
              }
              const userText =
                copy[userIdx]?.role === "user" ? copy[userIdx]!.content : "";
              if (rid) {
                writeChatStreamDraft(character.id, nextChatId ?? null, {
                  requestId: rid,
                  chatId: nextChatId ?? 0,
                  userText,
                  assistantPartial: copy[aiIndex]?.content ?? "",
                  updatedAt: Date.now(),
                });
              }
              return copy;
            });
            continue;
          }

          if (data.type === "status") {
            if (data.message) {
              setStreamPhase(data.message);
              if (/HTML|상태창 생성/i.test(data.message)) {
                htmlFlashStreamTurn = true;
              }
            }
            const prep = sanitizeGenerationPreparationUi(data.generationUi);
            if (prep) {
              setGenerationPrepUi(prep);
            }
            // Lock only after the main model stream ends (post-process phases).
            // Pre-stream heartbeats like "생성 중…" / "재생성 준비 중…" must NOT lock.
            if (
              data.message &&
              /마무리|분량 보강|HTML 생성|상태창 생성/i.test(data.message)
            ) {
              postStreamLocked = true;
              setGenerationPrepUi(null);
            }
            continue;
          }

          if (postStreamLocked && data.type !== "done") {
            if (data.type === "replace" && data.text != null && data.instant === true) {
              htmlFlashStreamTurn = true;
              applyStreamReplaceTarget(data.text, { instant: true });
              continue;
            }
            if (data.type === "replace" || data.type === "append" || data.text) {
              continue;
            }
          }

          if (data.type === "reset") {
            reveal.reset();
            softResetPending = true;
            continue;
          }

          if (data.type === "replace" && data.text != null) {
            if (data.text.length > 0 && !postStreamLocked) {
              setGenerationPrepUi(null);
            }
            applyStreamReplaceTarget(data.text, { instant: data.instant === true });
            continue;
          }

          if (data.type === "append" && data.text) {
            reveal.resume();
            setStreamPhase(null);
            setGenerationPrepUi(null);
            appendStreamText(data.text, true);
            continue;
          }

          if (data.text) {
            reveal.resume();
            setStreamPhase(null);
            setGenerationPrepUi(null);
            appendStreamText(data.text);
          }

          if (data.type === "done") {
            sawDone = true;
            if (data.messageId != null && Number.isFinite(data.messageId)) {
              persistedAssistantMessageId = data.messageId;
            }
            if (data.htmlFlashTurn === true) {
              htmlFlashStreamTurn = true;
            }
            if (data.trafficOverload || data.skipPersistence) {
              reveal.reset();
              reveal.flush();
              trafficOverload =
                data.finalContent?.trim() || GEMINI_TRAFFIC_OVERLOAD_MESSAGE;
            } else {
              pendingDone = data;
            }
          }

          if (data.type === "traffic_overload") {
            reveal.reset();
            reveal.flush();
            softResetPending = false;
            trafficOverload = data.message?.trim() || GEMINI_TRAFFIC_OVERLOAD_MESSAGE;
          }

          if (data.type === "error") {
            sawError = true;
            reveal.flush();
            streamError = data.error || "스트리밍 중 오류가 발생했습니다.";
            console.error("[chat] API error:", streamError, data);
          }
        }
      }

      setStreamPhase(null);
      setGenerationPrepUi(null);
      if (pendingDone?.finalContent) {
        postStreamLocked = true;
        applyStreamReplaceTarget(pendingDone.finalContent, {
          instant: htmlFlashStreamTurn || pendingDone.htmlFlashTurn === true,
        });
      }
      if (displayPrefsRef.current.streamIntervalMs > 0 && !htmlFlashStreamTurn) {
        await reveal.waitUntilIdle();
      } else {
        reveal.flush();
      }
      if (pendingDone && !trafficOverload) {
        applyStreamDone(pendingDone);
      } else if (
        !trafficOverload &&
        !streamError &&
        needsEofReconcile({ sawDone, sawError })
      ) {
        const messageIdForReconcile = persistedAssistantMessageId;

        const eofResult = await reconcileStreamEof({
          messageId: messageIdForReconcile,
          fetchSnapshot: async (messageId) => {
            const snapRes = await fetch(`/api/chat/message?messageId=${messageId}`);
            if (!snapRes.ok) return null;
            const body = (await snapRes.json()) as EofReconcileSnapshot & {
              error?: string;
            };
            if (!body?.messageId) return null;
            return body;
          },
        });

        if (eofResult.kind === "completed") {
          const s = eofResult.snapshot;
          applyStreamReplaceTarget(s.content || assistantStreamContentRef.current, {
            instant: true,
          });
          applyStreamDone({
            chatId: s.chatId,
            messageId: s.messageId,
            userMessageId: s.userMessageId ?? null,
            finalContent: s.content,
            usage: (s.usage as Usage | null) ?? undefined,
            variants: s.variants as MessageVariant[] | undefined,
            activeVariant: s.activeVariant,
            variantCount: s.variantCount,
            statusMetaPending: s.statusMetaPending === true,
            statusWidgetTurnActive: s.statusWidgetTurnActive === true,
            statusWidgetActive: s.statusWidgetTurnActive === true,
            statusWidgetValues:
              (s.statusWidgetValues as ParsedStatusWidgetTurnValues | null) ?? null,
          });
        } else {
          eofUnresolved = true;
          const status = generationStatusFromEofResult(eofResult);
          const snapContent =
            eofResult.kind === "terminal" || eofResult.kind === "interrupted"
              ? eofResult.snapshot?.content
              : undefined;
          setMessages((m) => {
            const copy = [...m];
            const cur = copy[aiIndex];
            if (cur?.role === "assistant") {
              copy[aiIndex] = {
                ...cur,
                id: eofResult.snapshot?.messageId ?? cur.id ?? messageIdForReconcile ?? undefined,
                content: (snapContent && snapContent.trim() ? snapContent : cur.content) || cur.content,
                generationStatus: status,
                usage: (eofResult.snapshot?.usage as Usage | null) ?? cur.usage,
                variants: (eofResult.snapshot?.variants as MessageVariant[] | undefined) ?? cur.variants,
                activeVariant: eofResult.snapshot?.activeVariant ?? cur.activeVariant,
                variantCount: eofResult.snapshot?.variantCount ?? cur.variantCount,
                statusWidgetValues:
                  (eofResult.snapshot?.statusWidgetValues as ParsedStatusWidgetTurnValues | null) ??
                  cur.statusWidgetValues,
                statusWidgetTurnActive:
                  eofResult.snapshot?.statusWidgetTurnActive ?? cur.statusWidgetTurnActive,
              };
            }
            return copy;
          });
          if (status === "interrupted" || status === "failed" || status === "failed_partial") {
            clearChatStreamDraft(character.id, chatId);
          }
        }
      }
    } catch (e) {
      reveal.reset();
      reveal.flush();
      const abortMsg = chatStreamAbortMessage(e);
      if (abortMsg) {
        streamError = streamError || abortMsg;
      } else if (!isBenignChatStreamAbort(e)) {
        streamError = streamError || "스트림 수신 중 오류가 발생했습니다.";
        console.error("[chat] stream consume failed:", e);
      }
    } finally {
      activeStreamRevealRef.current = null;
      setStreamPhase(null);
      setGenerationPrepUi(null);
    }

    const billing =
      pendingDone && !trafficOverload ? extractBillingInfo(pendingDone) : undefined;
    return {
      streamError,
      trafficOverload: trafficOverload || undefined,
      billing,
      eofUnresolved,
    };
  }

  function applyStreamBilling(
    billing: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number }
  ) {
    setFloatDeductionAmount(billing.turnCost);
    setFloatDeductionTrigger((t) => t + 1);
    dispatchPointsDeducted({
      totalPointsCost: billing.turnCost,
      remainingPoints: billing.remainingPoints,
      paidPoints: billing.paidPoints,
      freePoints: billing.freePoints,
    });
  }

  /** 실패 턴 롤백 + 안내 — ephemeral system을 히스토리 끝에 두지 않아 canContinue·전송 유지 */
  function applyTrafficOverloadNotice(notice: string, rollbackToIndex: number) {
    setMessages((m) => {
      // Prefer soft-keep when the failed turn was already DB-persisted
      const aiIndex = rollbackToIndex + 1;
      if (m[aiIndex]?.role === "assistant" && (m[aiIndex].id != null || m[rollbackToIndex]?.id != null)) {
        return softRollbackTurn(m, aiIndex);
      }
      return m.slice(0, Math.max(0, rollbackToIndex));
    });
    setError(notice);
  }

  function handlePostStreamResult(
    streamResult: {
      streamError?: string;
      trafficOverload?: string;
      billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
      eofUnresolved?: boolean;
    },
    aiIndex: number,
    opts?: { rollback?: () => void; restoreInput?: string }
  ) {
    if (streamResult.trafficOverload) {
      applyTrafficOverloadNotice(streamResult.trafficOverload, aiIndex - 1);
      if (opts?.restoreInput != null) setInput(opts.restoreInput);
      return;
    }
    if (streamResult.streamError) {
      setError(streamResult.streamError);
      if (opts?.rollback) {
        opts.rollback();
      } else {
        setMessages((m) => softRollbackTurn(m, aiIndex));
      }
      if (opts?.restoreInput != null) setInput(opts.restoreInput);
      return;
    }
    // EOF reconcile already set completed / interrupted on the assistant row.
    // No further action for send/continue — avoid leaving generationStatus stuck.
    if (streamResult.eofUnresolved) {
      setToastMsg("생성이 완료되지 않았습니다. 다시 시도해 주세요.");
    }
  }

  async function handleStreamError(
    res: Response,
    aiIndex: number,
    rollback: () => void,
    restoreInput?: string
  ) {
    // 성공 응답은 Content-Type이 비거나 달라도 스트림 소비로 넘긴다.
    // (일부 환경에서 text/event-stream 헤더가 누락되면 JSON 파싱→롤백으로
    //  재생성 시 본문이 비었다가 다시 채워지는 깜빡임만 발생한다.)
    if (res.ok) return false;

    let data: { error?: string; needVerify?: boolean; needCharge?: boolean } = {};
    try {
      data = await res.json();
    } catch {
      setError(`서버 오류 (${res.status}). 잠시 후 다시 시도해 주세요.`);
      rollback();
      if (restoreInput != null) setInput(restoreInput);
      return true;
    }
    setError(data.error || "오류가 발생했습니다.");
    if (data.needVerify) router.push("/verify");
    if (data.needCharge) {
      router.push(isPaymentsEnabledClient() ? "/points" : "/events/beta-free-points");
    }
    rollback();
    if (restoreInput != null) setInput(restoreInput);
    return true;
  }

  async function sendContinue() {
    if (!canContinue || inFlightRef.current) return;
    inFlightRef.current = true;
    loadingRef.current = true;
    setError("");
    setStreamPhase(null);
    setGenerationPrepUi({ phase: "preparing", badges: [] });
    followStreamRef.current = true;
    userScrollLockRef.current = false;
    scrollToBottom("smooth");
    let aiIndex = 0;
    const clientRequestId = createClientRequestId();
    const statusSeed = resolveAssistantTurnStatusMetaSeed(
      userNote,
      markdownStatusWindowActive,
      undefined,
      undefined,
      statusWidgetActive
    );
    setMessages((m) => {
      aiIndex = m.length + 1;
      return [
        ...m,
        {
          role: "user",
          content: CONTINUE_USER_DISPLAY,
          requestId: clientRequestId,
          generationStatus: "submitted",
        },
        {
          role: "assistant",
          content: "",
          requestId: clientRequestId,
          generationStatus: "generating",
          ...statusSeed,
        },
      ];
    });
    setLoading(true);

    let streamResult:
      | {
          streamError?: string;
          trafficOverload?: string;
          billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
          eofUnresolved?: boolean;
        }
      | undefined;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: beginChatFetch(),
        body: JSON.stringify({
          characterId: character.id,
          chatId,
          isContinue: true,
          clientRequestId,
          selectedAI,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          userNote,
          selectedPersonaId,
          targetResponseChars,
        }),
      });

      const earlyExit = await handleStreamError(res, aiIndex, () => {
        setMessages((m) => softRollbackTurn(m, aiIndex));
      });
      if (earlyExit) return;

      streamResult = await consumeChatStream(res, aiIndex);
      handlePostStreamResult(streamResult, aiIndex, {
        rollback: () => setMessages((m) => softRollbackTurn(m, aiIndex)),
      });
    } catch (e) {
      activeStreamRevealRef.current?.reset();
      if (!chatMountedRef.current && isBenignChatStreamAbort(e)) return;
      const abortMsg = chatStreamAbortMessage(e);
      if (abortMsg) {
        setError(abortMsg);
      } else if (!isBenignChatStreamAbort(e)) {
        setError("네트워크 오류가 발생했습니다.");
      }
      setMessages((m) => softRollbackTurn(m, aiIndex));
    } finally {
      inFlightRef.current = false;
      loadingRef.current = false;
      setLoading(false);
      setStreamPhase(null);
      setGenerationPrepUi(null);
      if (
        streamResult?.billing &&
        !streamResult.streamError &&
        !streamResult.trafficOverload
      ) {
        applyStreamBilling(streamResult.billing);
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || inFlightRef.current) return;
    if (text.length > CHAT_MESSAGE_MAX) {
      setError(`메시지는 ${CHAT_MESSAGE_MAX}자까지 입력할 수 있습니다.`);
      return;
    }
    inFlightRef.current = true;
    loadingRef.current = true;
    setInput("");
    clearChatMessageDraft(character.id, chatId);
    setError("");
    setStreamPhase(null);
    setGenerationPrepUi({ phase: "preparing", badges: [] });
    followStreamRef.current = true;
    userScrollLockRef.current = false;
    scrollToBottom("smooth");
    let aiIndex = 0;
    const clientRequestId = createClientRequestId();
    const userPersonaText = selectedPersona?.description ?? null;
    const statusSeed = resolveAssistantTurnStatusMetaSeed(
      userNote,
      markdownStatusWindowActive,
      text,
      userPersonaText,
      statusWidgetActive
    );
    setMessages((m) => {
      aiIndex = m.length + 1;
      return [
        ...m,
        {
          role: "user",
          content: text,
          requestId: clientRequestId,
          generationStatus: "submitted",
        },
        {
          role: "assistant",
          content: "",
          requestId: clientRequestId,
          generationStatus: "generating",
          ...statusSeed,
        },
      ];
    });
    writeChatStreamDraft(character.id, chatId, {
      requestId: clientRequestId,
      chatId: chatId ?? 0,
      userText: text,
      assistantPartial: "",
      updatedAt: Date.now(),
    });
    setLoading(true);

    let streamResult:
      | {
          streamError?: string;
          trafficOverload?: string;
          billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
          eofUnresolved?: boolean;
        }
      | undefined;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: beginChatFetch(),
        body: JSON.stringify({
          characterId: character.id,
          chatId,
          message: text,
          clientRequestId,
          selectedAI,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          userNote,
          selectedPersonaId,
          targetResponseChars,
        }),
      });

      const earlyExit = await handleStreamError(res, aiIndex, () => {
        setMessages((m) => softRollbackTurn(m, aiIndex));
      }, text);
      if (earlyExit) return;

      streamResult = await consumeChatStream(res, aiIndex);
      handlePostStreamResult(streamResult, aiIndex, {
        rollback: () => setMessages((m) => softRollbackTurn(m, aiIndex)),
        restoreInput: text,
      });
    } catch (e) {
      activeStreamRevealRef.current?.reset();
      if (!chatMountedRef.current && isBenignChatStreamAbort(e)) return;
      const abortMsg = chatStreamAbortMessage(e);
      if (abortMsg) {
        setError(abortMsg);
      } else if (!isBenignChatStreamAbort(e)) {
        setError("네트워크 오류가 발생했습니다.");
      }
      setMessages((m) => {
        const assistant = m[aiIndex];
        const persisted = assistant?.id != null || m[aiIndex - 1]?.id != null;
        if (!persisted) setInput(text);
        return softRollbackTurn(m, aiIndex);
      });
    } finally {
      inFlightRef.current = false;
      loadingRef.current = false;
      setLoading(false);
      setStreamPhase(null);
      setGenerationPrepUi(null);
      if (
        streamResult?.billing &&
        !streamResult.streamError &&
        !streamResult.trafficOverload
      ) {
        applyStreamBilling(streamResult.billing);
      }
    }
  }

  async function regenerate(targetAssistantMessageId?: number) {
    if (inFlightRef.current) {
      setToastMsg("이미 응답을 생성 중입니다. 잠시만 기다려 주세요.");
      return;
    }
    const targetAssistantIdx =
      targetAssistantMessageId != null
        ? messages.findIndex((m) => m.id === targetAssistantMessageId && m.role === "assistant")
        : lastAssistantIdx;
    if (!chatId || targetAssistantIdx < 0) {
      setToastMsg("재생성할 AI 답변이 없습니다.");
      return;
    }
    const prevAssistant = messages[targetAssistantIdx];
    if (!prevAssistant || prevAssistant.role !== "assistant") {
      setToastMsg("재생성할 AI 답변이 없습니다.");
      return;
    }
    const regenIndex = targetAssistantIdx;
    const clientRequestId = createClientRequestId();
    setError("");
    setStreamPhase("재생성 준비 중…");
    setGenerationPrepUi({ phase: "preparing", badges: [] });
    inFlightRef.current = true;
    loadingRef.current = true;
    setLoading(true);
    followStreamRef.current = true;
    userScrollLockRef.current = false;
    scrollToBottom("smooth");

    const statusWindowPolicy = resolveUserNoteStatusWindowPolicy(userNote);
    let regenUserMessage = "";
    for (let i = regenIndex - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "user") {
        regenUserMessage = m.content;
        break;
      }
    }
    const userPersonaText = selectedPersona?.description ?? null;
    const regenStatusWindowActive =
      !htmlVisualStatusActiveForChat(
        userNote,
        markdownStatusWindowActive,
        regenUserMessage,
        userPersonaText,
        statusWidgetActive
      ) &&
      (statusWindowPolicy.everyTurn || !!statusWindowPolicy.formatSpec);

    if (prevAssistant.id != null) {
      statusMetaPollStartedRef.current.delete(prevAssistant.id);
    }

    setMessages((m) => {
      const copy = [...m];
      const cur = copy[regenIndex];
      if (!cur || cur.role !== "assistant") return m;
      // Clear immediately so the generating placeholder shows — keeping the old reply
      // while stream refs were zeroed made the first chunk look like a full restart,
      // and on mobile looked like a frozen dark screen with no progress.
      copy[regenIndex] = {
        ...cur,
        content: "",
        usage: null,
        isRefunded: false,
        variants: undefined,
        activeVariant: undefined,
        variantCount: 1,
        requestId: clientRequestId,
        generationStatus: "generating",
        statusMeta: null,
        statusMetaPending: regenStatusWindowActive,
        statusMetaRequested: regenStatusWindowActive,
        statusMetaFailed: false,
        statusMetaFormatSpec:
          statusWindowPolicy.formatSpec ?? cur.statusMetaFormatSpec ?? null,
        statusWidgetValues: null,
        statusWidgetTurnActive: statusWidgetActive,
      };
      const userIdx = regenIndex - 1;
      if (userIdx >= 0 && copy[userIdx]?.role === "user") {
        copy[userIdx] = {
          ...copy[userIdx],
          requestId: clientRequestId,
        };
      }
      return copy;
    });
    writeChatStreamDraft(character.id, chatId, {
      requestId: clientRequestId,
      chatId,
      userText: regenUserMessage,
      assistantPartial: "",
      updatedAt: Date.now(),
    });

    const restoreAssistant = () => {
      setMessages((m) => {
        const copy = [...m];
        if (copy[regenIndex]?.role === "assistant") {
          // Prefer soft state if DB already bound a new request id
          const cur = copy[regenIndex];
          if (cur.id != null && cur.requestId === clientRequestId && cur.content.trim()) {
            copy[regenIndex] = {
              ...cur,
              generationStatus: "interrupted",
            };
          } else {
            copy[regenIndex] = prevAssistant;
          }
        }
        return copy;
      });
    };

    let streamResult:
      | {
          streamError?: string;
          trafficOverload?: string;
          billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
          eofUnresolved?: boolean;
        }
      | undefined;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: beginChatFetch(),
        body: JSON.stringify({
          characterId: character.id,
          chatId,
          regenerate: true,
          targetAssistantMessageId: prevAssistant.id,
          clientRequestId,
          selectedAI,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          userNote,
          selectedPersonaId,
          targetResponseChars,
        }),
      });

      const earlyExit = await handleStreamError(res, regenIndex, restoreAssistant);
      if (earlyExit) return;

      streamResult = await consumeChatStream(res, regenIndex);
      if (streamResult.trafficOverload) {
        restoreAssistant();
        setError(streamResult.trafficOverload);
      } else if (streamResult.streamError) {
        setError(streamResult.streamError);
        restoreAssistant();
      } else if (streamResult.eofUnresolved) {
        // Shared EOF reconcile already marked interrupted/failed; restore prior
        // variant when regenerate could not reach a completed server row.
        restoreAssistant();
        setToastMsg("생성이 완료되지 않았습니다. 다시 시도해 주세요.");
      }
    } catch (e) {
      activeStreamRevealRef.current?.reset();
      if (!chatMountedRef.current && isBenignChatStreamAbort(e)) return;
      const abortMsg = chatStreamAbortMessage(e);
      if (abortMsg) {
        setError(abortMsg);
      } else if (!isBenignChatStreamAbort(e)) {
        setError("네트워크 오류가 발생했습니다.");
      } else {
        setToastMsg("재생성이 중단되었습니다. 다시 시도해 주세요.");
      }
      restoreAssistant();
    } finally {
      inFlightRef.current = false;
      loadingRef.current = false;
      setLoading(false);
      setStreamPhase(null);
      setGenerationPrepUi(null);
      if (
        streamResult?.billing &&
        !streamResult.streamError &&
        !streamResult.trafficOverload
      ) {
        applyStreamBilling(streamResult.billing);
      }
    }
  }

  async function switchVariant(messageId: number, messageIndex: number, variantIndex: number) {
    if (loading) return;
    try {
      const res = await fetch("/api/chat/message/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, variantIndex }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMsg(data.error || "버전 전환에 실패했습니다.");
        return;
      }
      setMessages((prev) =>
        prev.map((m, idx) =>
          idx === messageIndex
            ? {
                ...m,
                content: data.content,
                usage: data.usage ?? null,
                activeVariant: data.activeVariant,
                variantCount: data.variantCount,
                variants: data.variants,
                ...(htmlVisualStatusActiveForChat(
                  userNote,
                  markdownStatusWindowActive,
                  messages[messageIndex - 1]?.role === "user"
                    ? messages[messageIndex - 1]!.content
                    : undefined,
                  selectedPersona?.description ?? null,
                  statusWidgetActive
                )
                  ? {
                      statusMeta: null,
                      statusMetaPending: false,
                      statusMetaRequested: false,
                    }
                  : {}),
              }
            : m
        )
      );
      applyEmotionRef.current(data.content);
    } catch {
      setToastMsg("네트워크 오류가 발생했습니다.");
    }
  }

  function startEdit(messageId: number, content: string, role: "user" | "assistant") {
    setEditingId(messageId);
    setEditingRole(role);
    const idx = role === "assistant" ? messages.findIndex((m) => m.id === messageId) : -1;
    const asst = idx >= 0 ? messages[idx] : null;
    const activeVariantSource =
      role === "assistant" ? resolveAssistantCanonicalProseSource(asst ?? { content }) : content;
    const canonical =
      role === "assistant"
        ? resolveAssistantEditInitialValue(asst ?? { content })
        : content;
    setEditDraft(canonical);
    if (role === "assistant") {
      const storedCanonical = getCanonicalProseBody(activeVariantSource);
      const displayAligned = getDisplayAlignedCanonicalProseBody(activeVariantSource);
      logProseFormattingMismatchDev({
        messageId,
        storedProse: storedCanonical,
        editModalValue: canonical,
        transform: "startEdit:getCanonicalProseBody",
      });
      logDisplayEditSourceMismatchDev({
        messageId,
        displaySource: displayAligned,
        editSource: canonical,
        contentSource: content,
        activeVariantSource,
        displaySourceKind: "formatNovelProseForDisplay",
        editSourceKind: "canonicalProseBody",
      });
      logProseSourceDivergenceDev({
        messageId,
        phase: "startEdit",
        dbSource: storedCanonical,
        activeVariantSource: storedCanonical,
        displaySource: displayAligned,
        editSource: canonical,
        usedPreferDisplayedNewlineLayout: false,
        sourceFieldUsedByEditModal: asst?.variants?.length ? "activeVariant" : "content",
      });
      if (
        (asst?.variantCount ?? asst?.variants?.length ?? 0) > 1 ||
        (asst?.activeVariant ?? 0) > 0
      ) {
        logRegeneratedEditFormattingMismatchDev({
          messageId,
          storedCanonicalProse: storedCanonical,
          editModalValue: canonical,
          transform: "startEdit:resolveAssistantEditInitialValue",
          fallbackSource: asst?.variants?.length ? "activeVariant" : "content",
        });
      }
      const userMsg = idx > 0 && messages[idx - 1]?.role === "user" ? messages[idx - 1] : null;
      setEditWidgetDraft({
        character: asst?.statusWidgetValues?.character
          ? { ...asst.statusWidgetValues.character }
          : null,
        user: asst?.statusWidgetValues?.user ? { ...asst.statusWidgetValues.user } : null,
      });
      if (userMsg?.id) {
        setEditingUserId(userMsg.id);
        setEditUserDraft(userMsg.content);
      } else {
        setEditingUserId(null);
        setEditUserDraft("");
      }
    } else {
      setEditDraft(content);
      setEditingUserId(null);
      setEditUserDraft("");
      setEditWidgetDraft({});
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingUserId(null);
    setEditingRole(null);
    setEditDraft("");
    setEditUserDraft("");
    setEditWidgetDraft({});
  }

  async function saveEdit(messageId: number) {
    const assistantText =
      editingRole === "assistant"
        ? normalizeEditedProseForSave(editDraft)
        : editDraft.trim();
    const userText = editUserDraft.trim();
    const turnEdit = editingRole === "assistant" && editingUserId != null;

    if (turnEdit) {
      if (!userText) {
        setToastMsg("유저 입력을 입력하세요.");
        return;
      }
      if (userText.length > CHAT_MESSAGE_MAX) {
        setToastMsg(`유저 입력은 ${CHAT_MESSAGE_MAX.toLocaleString()}자까지 입력할 수 있습니다.`);
        return;
      }
    }

    if (!assistantText.trim()) {
      setToastMsg("내용을 입력하세요.");
      return;
    }
    const maxLen = editingRole === "assistant" ? ASSISTANT_MESSAGE_MAX : CHAT_MESSAGE_MAX;
    if (assistantText.length > maxLen) {
      setToastMsg(`메시지는 ${maxLen.toLocaleString()}자까지 입력할 수 있습니다.`);
      return;
    }

    setEditSaving(true);
    try {
      if (turnEdit && editingUserId) {
        const userRes = await fetch("/api/chat/message", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: editingUserId, content: userText }),
        });
        const userData = await userRes.json();
        if (!userRes.ok) {
          setToastMsg(userData.error || "유저 입력 수정에 실패했습니다.");
          return;
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === editingUserId ? { ...m, content: userData.content } : m))
        );
      }

      const res = await fetch("/api/chat/message", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          content: assistantText,
          ...(editingRole === "assistant"
            ? {
                statusWidgetValues: {
                  character: editWidgetDraft.character ?? null,
                  user: editWidgetDraft.user ?? null,
                },
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMsg(data.error || "수정에 실패했습니다.");
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                content: data.content,
                variants: Array.isArray(data.variants) ? data.variants : undefined,
                activeVariant:
                  typeof data.activeVariant === "number" ? data.activeVariant : undefined,
                variantCount:
                  typeof data.variantCount === "number" ? data.variantCount : undefined,
                ...(data.statusWidgetValues != null
                  ? { statusWidgetValues: data.statusWidgetValues }
                  : {}),
              }
            : m
        )
      );
      cancelEdit();
    } catch {
      setToastMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setEditSaving(false);
    }
  }

  function handleTurnDeleted() {
    const { lastUserIdx: uIdx, lastAssistantIdx: aIdx } = findLastTurnIndices(messages);
    const remove = new Set<number>();
    if (uIdx >= 0) remove.add(uIdx);
    if (aIdx >= 0) remove.add(aIdx);
    if (remove.size === 0) return;

    const deletedIds: number[] = [];
    remove.forEach((idx) => {
      const id = messages[idx]?.id;
      if (id) deletedIds.push(id);
    });

    if (deletedIds.length > 0) {
      setBookmarkedIds((b) => {
        const next = new Set(b);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
    }

    setMessages((prev) => prev.filter((_, i) => !remove.has(i)));
    pendingServerSyncRef.current = true;
    router.refresh();
  }

  function renderEditActions(messageId: number, role: "user" | "assistant") {
    const maxLen = role === "assistant" ? ASSISTANT_MESSAGE_MAX : CHAT_MESSAGE_MAX;
    const userOver = editingUserId != null && editUserDraft.length > CHAT_MESSAGE_MAX;
    const overLimit =
      role === "assistant"
        ? editDraft.length > ASSISTANT_MESSAGE_MAX || userOver
        : editDraft.length > maxLen;
    return (
      <>
        <div className="mt-2 flex justify-center gap-2">
          <button
            type="button"
            disabled={editSaving || overLimit}
            onClick={() => saveEdit(messageId)}
            className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            저장
          </button>
          <button
            type="button"
            disabled={editSaving}
            onClick={cancelEdit}
            className="rounded-lg bg-white/5 px-3 py-1 text-xs text-zinc-400 hover:bg-white/10"
          >
            취소
          </button>
        </div>
        <p
          className={`mt-2 text-center text-[11px] tabular-nums ${
            overLimit ? "text-rose-400" : role === "assistant" ? "text-zinc-500" : "text-zinc-600"
          }`}
        >
          {role === "assistant"
            ? editingUserId != null
              ? `유저 ${editUserDraft.length.toLocaleString()} / ${CHAT_MESSAGE_MAX.toLocaleString()}자 · AI ${formatAssistantLengthLabel(
                  visibleAssistantMessageLength(editDraft),
                  targetResponseChars
                )}`
              : formatAssistantLengthLabel(visibleAssistantMessageLength(editDraft), targetResponseChars)
            : `${editDraft.length.toLocaleString()} / ${maxLen.toLocaleString()}자`}
        </p>
      </>
    );
  }

  function shouldShowReportRefundButton(m: Msg): boolean {
    if (m.role !== "assistant" || !m.id || m.id <= 0 || !chatId) return false;
    if (m.model === "greeting" || m.ephemeral) return false;
    if (m.isRefunded || m.reportStatus === "approved") return false;
    if (m.reportStatus === "pending") return true;
    if (!isWithinReportRefundWindow(m.createdAt)) return false;
    const usage = resolveActiveUsage(m.usage, m.variants, m.activeVariant);
    const cost = usage?.cost ?? 0;
    return cost > 0;
  }

  function handleMessageReported(index: number, result: { status: "pending" | "approved" }) {
    setMessages((prev) => {
      const copy = [...prev];
      const cur = copy[index];
      if (!cur) return prev;
      copy[index] = {
        ...cur,
        isRefunded: result.status === "approved" ? true : cur.isRefunded,
        reportStatus: result.status === "approved" ? "approved" : "pending",
      };
      return copy;
    });
    if (result.status === "approved") router.refresh();
  }

  function renderAssistantMessageFooter(
    m: Msg,
    i: number,
    opts: {
      isEditing: boolean;
      showToolbar: boolean;
      onLastTurn: boolean;
    }
  ) {
    if (opts.isEditing) return null;
    const variantPicker =
      opts.showToolbar && (m.variantCount ?? 0) > 1 ? (
        <MessageVariantPicker
          variantCount={m.variantCount ?? 1}
          activeVariant={m.activeVariant ?? 0}
          disabled={loading}
          onSelect={(idx) => switchVariant(m.id!, i, idx)}
        />
      ) : null;

    const showReportRefund = shouldShowReportRefundButton(m);
    const reportRefundPending = m.reportStatus === "pending";

    if (opts.showToolbar) {
      return (
        <MessageBubbleToolbar
          role="assistant"
          messageId={m.id}
          chatId={chatId}
          content={m.content}
          usage={resolveActiveUsage(m.usage, m.variants, m.activeVariant)}
          isRefunded={m.isRefunded}
          bookmarked={bookmarkedIds.has(m.id!)}
          showDelete={opts.onLastTurn}
          showRegenerate={i === lastAssistantIdx && !inputLocked}
          showFork
          disabled={inputLocked}
          showReportRefund={showReportRefund}
          reportRefundPending={reportRefundPending}
          variantPicker={variantPicker}
          compact={!showCharacterPortrait}
          showFullReceipt={showFullBillingReceipt}
          onToast={setToastMsg}
          onBookmarkChange={(id, on) => {
            setBookmarkedIds((prev) => {
              const next = new Set(prev);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            });
          }}
          onEditStart={() => startEdit(m.id!, m.content, "assistant")}
          onTurnDeleted={handleTurnDeleted}
          onFork={(newChatId) => {
            router.push(`/chat/${character.id}?chat=${newChatId}`);
          }}
          onRegenerate={regenerate}
          onRefunded={() => handleMessageReported(i, { status: "approved" })}
          onReportSubmitted={(result) => handleMessageReported(i, result)}
        />
      );
    }

    if (showReportRefund) {
      return (
        <div className="mt-1 flex justify-end">
          <ReportRefundButton
            messageId={m.id!}
            chatId={chatId!}
            isRefunded={m.isRefunded}
            isReportPending={reportRefundPending}
            disabled={loading}
            onToast={setToastMsg}
            onReported={(result) => handleMessageReported(i, result)}
          />
        </div>
      );
    }

    return null;
  }

  function isLastTurnMessage(idx: number, m: Msg) {
    if (idx === lastUserIdx) return true;
    if (idx === lastAssistantIdx && m.role === "assistant") return true;
    return false;
  }

  const handleDisplayPrefsChange = useCallback(
    (next: ChatDisplayPrefs) => {
      const scrollY = typeof window === "undefined" ? null : window.scrollY;
      followStreamRef.current = false;
      userScrollLockRef.current = true;
      setDisplayPrefs(next);
      saveChatDisplayPrefs(next);
      if (scrollY != null) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY, behavior: "instant" });
        });
      }
      // Keep account prefs in sync so SSR re-entry does not reset 에셋 ON/OFF.
      if (displayPrefsPersistTimerRef.current) {
        clearTimeout(displayPrefsPersistTimerRef.current);
      }
      displayPrefsPersistTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            const res = await fetch("/api/user/chat-prefs", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chatId: chatId ?? undefined,
                targetResponseChars: targetResponseCharsRef.current,
                userNote: userNoteRef.current,
                displayPrefs: next,
              }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.prefs) {
              cacheUserChatPrefsClient(data.prefs);
              saveChatDisplayPrefs(data.prefs.displayPrefs ?? next);
            }
          } catch {
            /* local toggle already applied; ignore network errors */
          }
        })();
      }, 400);
    },
    [chatId]
  );

  function renderSettingsPanel(layout: "rail" | "drawer", onClose?: () => void) {
    return (
      <ChatSettingsPanel
        chatId={chatId}
        memoryRefreshKey={memoryRefreshKey}
        relationshipMetaDock={<RelationshipMetaDock chatId={chatId} refreshKey={memoryRefreshKey} />}
        userNote={userNote}
        onUserNoteChange={setUserNote}
        onSaveUserNote={saveUserNote}
        notePresets={notePresets}
        onNotePresetsChange={setNotePresets}
        statusWidgetPresets={initialStatusWidgetPresets}
        defaultUserNote={defaultUserNote}
        settingsSaving={settingsSaving}
        selectedPersona={selectedPersona}
        onPersonaUpdated={handlePersonaUpdated}
        personas={personas}
        selectedPersonaId={selectedPersonaId}
        onPersonaSelectedChange={setSelectedPersonaId}
        targetResponseChars={targetResponseChars}
        onTargetResponseCharsChange={setTargetResponseChars}
        chatTitle={chatTitle}
        onChatTitleChange={setChatTitle}
        contentKind={contentKind}
        narrativePov={narrativePov}
        onNarrativePovChange={setNarrativePov}
        povCharacterName={povCharacterName}
        onPovCharacterNameChange={setPovCharacterName}
        povCharacterSuggestions={povCharacterSuggestions}
        displayPrefs={displayPrefs}
        onDisplayPrefsChange={handleDisplayPrefsChange}
        onSaveDisplaySettings={persistUserChatPrefs}
        displaySettingsSaving={displaySettingsSaving}
        characterWidgetJson={initialCharacterWidgetJson}
        statusWidgetMode={liveStatusWidgetMode}
        statusWidgetDisplayMode={liveStatusWidgetDisplayMode}
        userWidgetJson={liveUserWidgetJson}
        characterWidgetAllowUserOverride={characterWidgetAllowUserOverride}
        onStatusWidgetChange={(saved) => {
          setLiveStatusWidgetMode(saved.mode);
          setLiveStatusWidgetDisplayMode(saved.displayMode);
          setLiveUserWidgetJson(saved.userWidgetJson);
        }}
        layout={layout}
        onClose={onClose}
      />
    );
  }

  const showCharacterPortrait = displayPrefs.showCharacterPortrait;
  const mobilePortraitUrl = activePortraitUrl ?? defaultChatAsset?.url ?? null;
  const mobilePortraitAsset = assetByUrl(assets, mobilePortraitUrl) ?? defaultChatAsset;
  const mobilePortraitBlur = shouldBlurAssetForViewer(
    mobilePortraitAsset ?? undefined,
    isCharacterCreator,
    unlockedUrls
  );
  const unlockedAlbumAssets = useMemo(() => {
    return assets.filter(
      (asset) =>
        asset.chat !== false &&
        (isCharacterCreator || asset.viewerBlur !== true || unlockedUrls.has(asset.url))
    );
  }, [assets, isCharacterCreator, unlockedUrls]);

  useEffect(() => {
    saveCharacterAssetAlbum(
      character.id,
      character.name,
      unlockedAlbumAssets.map((asset) => ({ url: asset.url, tag: asset.tag }))
    );
  }, [character.id, character.name, unlockedAlbumAssets]);

  return (
    <div className="flex min-w-0 flex-1 items-stretch gap-0">
      <div
        className="chat-readability-root flex min-w-0 flex-1 flex-col"
        style={chatReadabilityRootStyle(displayPrefs)}
      >
      <ChatToast message={toastMsg} />
      <ChatAssetAlbumModal
        open={assetAlbumOpen}
        currentCharacterId={character.id}
        currentCharacterName={character.name}
        currentAssets={unlockedAlbumAssets}
        onClose={() => setAssetAlbumOpen(false)}
      />
      {characterIntroOpen && (
        <div
          className="fixed inset-0 z-[115] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="캐릭터 소개"
          onClick={() => setCharacterIntroOpen(false)}
        >
          <section
            className="flex h-[min(86dvh,46rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-violet-200/80">캐릭터 소개</p>
                <h2 className="truncate text-base font-bold text-white">{character.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setCharacterIntroOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-lg text-zinc-300 hover:bg-white/10 hover:text-white"
                aria-label="캐릭터 소개 닫기"
              >
                ×
              </button>
            </div>
            <iframe
              src={`/character/${character.id}?embed=chat-intro`}
              title={`${character.name} 소개`}
              className="min-h-0 flex-1 border-0 bg-[#121212]"
            />
          </section>
        </div>
      )}
      <ChatSelectionQuoteToolbar
        containerRef={quoteSelectContainerRef}
        characterName={character.name}
        creatorName={creatorName}
        disabled={loading || editingId != null}
        onToast={setToastMsg}
      />

      <div
        className={
          showCharacterPortrait
            ? CHAT_PORTRAIT_GRID_CLASS
            : "flex min-h-0 min-w-0 flex-1 flex-col"
        }
      >
        {showCharacterPortrait ? (
          <div className={CHAT_PORTRAIT_INFO_STICKY_CLASS}>
            {/* Full-grid sticky strip; name/album stay in the portrait track only. */}
            <div className={CHAT_PORTRAIT_INFO_STICKY_INNER_CLASS}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <button
                    type="button"
                    onClick={() => setCharacterIntroOpen(true)}
                    className="min-w-0 truncate text-left text-xl font-black leading-tight text-white underline-offset-4 transition hover:text-violet-100 hover:underline"
                    title="캐릭터 소개 보기"
                  >
                    {character.name}
                  </button>
                  {creatorId != null && creatorId > 0 ? (
                    <Link
                      href={`/creator/${creatorId}`}
                      className={creatorNameDesktopClass}
                      title="제작자 페이지"
                    >
                      {creatorName}
                    </Link>
                  ) : creatorName ? (
                    <span className={creatorNameDesktopClass}>
                      {creatorName}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setAssetAlbumOpen(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-100 transition hover:bg-white/[0.08] hover:text-white"
                  title="이미지 앨범"
                  aria-label="이미지 앨범 열기"
                >
                  <IconAlbum className="h-4 w-4" />
                </button>
              </div>
              <div aria-hidden className="min-w-0" />
            </div>
          </div>
        ) : (
          <div className={CHAT_INFO_STICKY_NO_PORTRAIT_CLASS}>
            <div className="flex min-w-0 items-baseline gap-2">
              <button
                type="button"
                onClick={() => setCharacterIntroOpen(true)}
                className="min-w-0 truncate text-left text-xl font-black leading-tight text-white underline-offset-4 transition hover:text-violet-100 hover:underline"
                title="캐릭터 소개 보기"
              >
                {character.name}
              </button>
              {creatorId != null && creatorId > 0 ? (
                <Link
                  href={`/creator/${creatorId}`}
                  className={creatorNameDesktopClass}
                  title="제작자 페이지"
                >
                  {creatorName}
                </Link>
              ) : creatorName ? (
                <span className={creatorNameDesktopClass}>
                  {creatorName}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setAssetAlbumOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-100 transition hover:bg-white/[0.08] hover:text-white"
              title="이미지 앨범"
              aria-label="이미지 앨범 열기"
            >
              <IconAlbum className="h-4 w-4" />
            </button>
          </div>
        )}
        {showCharacterPortrait && (
          <div className={`${CHAT_PORTRAIT_STICKY_CLASS} pl-1 sm:pl-0`}>
            <ChatEmotionPortraitPanel
              characterName={character.name}
              emoji={character.emoji}
              hue={character.hue}
              assets={assets}
              defaultAsset={defaultChatAsset}
              activeUrl={activePortraitUrl}
              unlockedUrls={unlockedUrls}
              viewerIsCreator={isCharacterCreator}
              pinned={portraitPinned}
              onPinnedChange={handlePortraitPinnedChange}
              onActiveAssetChange={handlePortraitSelected}
            />
          </div>
        )}
        <div
          className={
            showCharacterPortrait
              ? CHAT_MESSAGES_COLUMN_CLASS
              : CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS
          }
        >
      <div className={CHAT_ROOM_TITLE_BAR_CLASS}>
        <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-white/[0.06] hover:text-white md:hidden"
            aria-label="뒤로가기"
            title="뒤로가기"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <button
              type="button"
              onClick={() => setCharacterIntroOpen(true)}
              title="캐릭터 소개 보기"
              className="min-w-0 truncate text-base font-bold text-white underline-offset-2 transition hover:underline"
            >
              {character.name}
            </button>
            {creatorId != null && creatorId > 0 ? (
              <Link
                href={`/creator/${creatorId}`}
                title="제작자 페이지"
                className={creatorNameMobileClass}
              >
                {creatorName}
              </Link>
            ) : (
              creatorName ? (
                <span className={creatorNameMobileClass}>
                  {creatorName}
                </span>
              ) : null
            )}
          </div>
          <button
            type="button"
            onClick={() => setAssetAlbumOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08] hover:text-white md:hidden"
            title="이미지 앨범"
            aria-label="이미지 앨범 열기"
          >
            <IconAlbum className="h-4 w-4" />
          </button>
          <ChatRoomMobileMenu
            displayPrefs={displayPrefs}
            onDisplayPrefsChange={handleDisplayPrefsChange}
            settingsPanel={renderSettingsPanel("rail")}
            bookmarksPanel={<BookmarksPanel variant="rail" />}
          />
        </div>
      </div>
      <div className="h-[3.25rem] shrink-0 md:hidden" aria-hidden />
      {showCharacterPortrait && mobilePortraitUrl && (
        <div
          data-testid="mobile-chat-portrait-background"
          className={CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS}
          style={
            {
              ["--mobile-portrait-opacity" as string]:
                displayPrefs.portraitBackgroundOpacity,
              ["--mobile-portrait-scrim-opacity" as string]:
                Math.max(0, 0.18 * (1 - displayPrefs.portraitBackgroundOpacity)),
              ["--mobile-portrait-gradient-opacity" as string]:
                Math.max(0, 0.55 * (1 - displayPrefs.portraitBackgroundOpacity)),
            }
          }
          aria-hidden
        >
          <CharacterAssetImage
            src={mobilePortraitUrl}
            alt=""
            blurForViewer={mobilePortraitBlur}
            className="h-full w-full"
            imgClassName={CHAT_MOBILE_PORTRAIT_IMAGE_CLASS}
            imgTestId="mobile-chat-portrait-image"
          />
          <div className="absolute inset-0 bg-[#121212] opacity-[var(--mobile-portrait-scrim-opacity)]" />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#121212] to-transparent opacity-[var(--mobile-portrait-gradient-opacity)]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#121212] to-transparent opacity-[var(--mobile-portrait-gradient-opacity)]" />
        </div>
      )}
      <div
        className={
          showCharacterPortrait
            ? "relative z-10 bg-transparent px-2 pl-3 pb-4 sm:bg-[#121212] sm:pl-2 sm:pr-1 sm:pb-0"
            : CHAT_MESSAGES_BODY_NO_PORTRAIT_CLASS
        }
        role="presentation"
      >
        <div className={chatMessageAreaLayoutClass(showCharacterPortrait)}>
          <div
            ref={quoteSelectContainerRef}
            className={
              showCharacterPortrait
                ? "min-w-0 space-y-1 pb-8 sm:space-y-2 sm:pb-0"
                : CHAT_MESSAGES_LIST_NO_PORTRAIT_CLASS
            }
          >
          {hasMoreOlder && (
            <div className="mb-6 flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={loadOlderMessages}
                disabled={loadingOlder || !chatId || loading}
                className="rounded-full border border-white/10 bg-[#1a1a1a] px-4 py-2 text-xs text-zinc-300 transition hover:border-orange-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingOlder
                  ? "이전 대화 불러오는 중…"
                  : `이전 글 보기 (${CHAT_LOAD_MORE_TURNS}턴${hiddenTurnCount > 0 ? ` · ${hiddenTurnCount}턴 더` : ""})`}
              </button>
            </div>
          )}
          {messages.map((m, i) => {
            const isEditing = editingId != null && m.id === editingId;
            const editingAssistantIdx =
              editingId != null ? messages.findIndex((x) => x.id === editingId) : -1;
            const isUserTurnEdit =
              editingAssistantIdx > 0 &&
              i === editingAssistantIdx - 1 &&
              m.role === "user" &&
              messages[editingAssistantIdx]?.role === "assistant";
            const showToolbar = !!m.id && m.id > 0 && !!chatId;
            const onLastTurn = isLastTurnMessage(i, m);

            if (m.role === "system") {
              return (
                <p
                  key={m.id ?? `system-${i}`}
                  className="my-4 px-3 text-center text-xs leading-relaxed text-amber-200/90"
                >
                  {m.content}
                </p>
              );
            }

            if (m.role === "user") {
              const waitingForAssistant =
                !loading &&
                i === lastUserIdx &&
                (messages[i + 1]?.role !== "assistant" ||
                  (messages[i + 1]?.role === "assistant" &&
                    !messages[i + 1]!.content.trim() &&
                    messages[i + 1]!.generationStatus === "submitted"));
              return (
                <div
                  key={m.id ?? `user-${i}`}
                  id={m.id ? `msg-${m.id}` : undefined}
                  className={showCharacterPortrait ? "my-10 first:mt-2" : "my-5 first:mt-1 last:mb-0"}
                >
                  <div className="mb-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  {isUserTurnEdit ? (
                    <div className="px-2">
                      <p className="mb-1.5 text-center text-[11px] font-semibold text-zinc-500">유저 입력</p>
                      <textarea
                        value={editUserDraft}
                        maxLength={CHAT_MESSAGE_MAX}
                        onChange={(e) =>
                          setEditUserDraft(e.target.value.slice(0, CHAT_MESSAGE_MAX))
                        }
                        rows={3}
                        className="w-full resize-none rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[13px] text-zinc-300 outline-none focus:border-orange-500/40"
                      />
                    </div>
                  ) : isContinueUserMessage(m.content) ? (
                    <p className="px-2 text-center text-xs italic text-zinc-500">⟳ {CONTINUE_USER_DISPLAY}</p>
                  ) : (
                    <NovelText
                      content={toDisplay(m.content)}
                      display={displayPrefs}
                      variant="user"
                    />
                  )}
                  {waitingForAssistant && (
                    <p className="mt-2 px-2 text-center text-xs text-zinc-500">
                      응답 생성 대기 중
                    </p>
                  )}
                  <div className="mt-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              );
            }

            const genStatus = (m.generationStatus ?? "").toLowerCase();
            const showGeneratingPlaceholder =
              (m.content === "" && loading && i === messages.length - 1) ||
              (m.content === "" && genStatus === "generating" && !loading);
            if (showGeneratingPlaceholder) {
              const prep = generationPrepUi ?? { phase: "preparing" as const, badges: [] };
              return (
                <div key={m.id ?? `asst-loading-${i}`} className="w-full max-w-full">
                  <GenerationPreparationIndicator
                    phase={prep.phase}
                    badges={prep.badges}
                  />
                </div>
              );
            }

            return (
              <article
                key={m.id ?? `asst-${i}`}
                id={m.id ? `msg-${m.id}` : undefined}
                className={showCharacterPortrait && !onLastTurn ? "pb-2" : "pb-0"}
              >
                <div className="min-w-0">
                {isEditing ? (
                  <div className="w-full min-w-0">
                    <p className="mb-1.5 text-center text-[11px] font-semibold text-zinc-500">본문</p>
                    <textarea
                      value={editDraft}
                      maxLength={ASSISTANT_MESSAGE_MAX}
                      onChange={(e) =>
                        setEditDraft(e.target.value.slice(0, ASSISTANT_MESSAGE_MAX))
                      }
                      rows={18}
                      className="min-h-[min(70vh,36rem)] w-full resize-y rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-3 text-zinc-200 outline-none focus:border-orange-500/40"
                      style={{
                        fontSize: "var(--font-size-chat)",
                        lineHeight: "var(--line-height-chat)",
                      }}
                    />
                    {(() => {
                      const showWidgetEdit = shouldShowStatusWidgetOnMessage({
                        model: m.model,
                        statusWidgetTurnActive: m.statusWidgetTurnActive,
                        statusWidgetValues: m.statusWidgetValues,
                        isStreaming: false,
                        displayHidden: statusWidgetTurn.displayMode === "hidden",
                      });
                      if (!showWidgetEdit) return null;
                      const widgetItems = orderedWidgetsForRender(statusWidgetTurn, {
                        character: editWidgetDraft.character ?? {},
                        user: editWidgetDraft.user ?? {},
                      });
                      if (widgetItems.length === 0) return null;
                      return (
                        <StatusWidgetValuesEditor
                          items={widgetItems}
                          draft={editWidgetDraft}
                          onChange={setEditWidgetDraft}
                          profileNames={statusWidgetProfileNames}
                        />
                      );
                    })()}
                    {renderEditActions(m.id!, "assistant")}
                  </div>
                ) : (
                  <>
                    {(() => {
                      const isStreamingThisMessage =
                        (loading && i === messages.length - 1) ||
                        (genStatus === "generating" && i === lastAssistantIdx);
                      const variantContent = isStreamingThisMessage
                        ? m.content
                        : resolveActiveVariantContent(m);
                      const displayBody = stripIncompleteStatusWidgetTail(
                        stripRepeatedTrailingQuoteMarks(
                          stripRpMetaPreamble(
                            stripEmotionTagsForDisplay(
                              stripInternalTagLeakage(variantContent),
                              { streaming: isStreamingThisMessage }
                            )
                          )
                        )
                      );
                      const messageFormatSpec =
                        m.statusMetaFormatSpec ?? chatStatusFormatSpec ?? null;
                      const bodyForDisplayRaw =
                        markdownStatusWindowActive && messageFormatSpec
                          ? partitionPlainStatusBlockForDisplay(
                              displayBody,
                              messageFormatSpec,
                              statusWindowPlacement,
                              { streaming: isStreamingThisMessage }
                            ).prose
                          : displayBody;
                      // Canonical raw into NovelText; display paragraph policy lives only there.
                      const bodyForDisplay = getCanonicalProseBody(bodyForDisplayRaw);
                      const userBefore =
                        i > 0 && messages[i - 1]?.role === "user" ? messages[i - 1] : null;
                      const showOocMarkdown =
                        m.model !== "greeting" &&
                        userBefore?.role === "user" &&
                        userMessageRequestsStatusWindowOoc(userBefore.content) &&
                        m.statusMeta;
                      const statusMarkdown = m.statusMeta
                        ? statusMetaDisplayMarkdown(m.statusMeta, messageFormatSpec)
                        : null;
                      const showStatusMeta = shouldShowStatusMetaCard({
                        messageContent: displayBody,
                        statusMeta: m.statusMeta,
                        statusMetaPending: m.statusMetaPending,
                        statusMetaFailed: m.statusMetaFailed,
                        statusMetaRequested: m.statusMetaRequested,
                        userNote,
                        userPersona: selectedPersona?.description,
                        userMessage: userBefore?.role === "user" ? userBefore.content : undefined,
                        markdownStatusWindowActive,
                        statusWidgetActive,
                        isStreaming: isStreamingThisMessage,
                      });
                      const showStatusWidget = shouldShowStatusWidgetOnMessage({
                        model: m.model,
                        statusWidgetTurnActive: m.statusWidgetTurnActive,
                        statusWidgetValues: m.statusWidgetValues,
                        isStreaming: isStreamingThisMessage,
                        displayHidden: statusWidgetTurn.displayMode === "hidden",
                      });
                      if (
                        process.env.NODE_ENV !== "production" &&
                        !isStreamingThisMessage &&
                        m.statusWidgetTurnActive === true &&
                        !statusWidgetValuesHasContent(m.statusWidgetValues)
                      ) {
                        console.warn("[StatusWidgetRealMessageMissing]", {
                          messageId: m.id ?? null,
                          hasStatusJson: m.statusWidgetValues != null,
                          statusJsonKeys: {
                            character: Object.keys(m.statusWidgetValues?.character ?? {}),
                            user: Object.keys(m.statusWidgetValues?.user ?? {}),
                          },
                          expectedKeys: statusWidgetTurn.characterWidget?.fields.map((f) => f.id) ?? [],
                          missingKeys: statusWidgetTurn.characterWidget?.fields
                            .map((f) => f.id)
                            .filter((id) => {
                              const values = m.statusWidgetValues?.character ?? {};
                              return !Object.prototype.hasOwnProperty.call(values, id);
                            }) ?? [],
                          allPlaceholderValues: true,
                          rendererSource: "ChatClient:shouldShowStatusWidgetOnMessage",
                        });
                      }
                      const widgetRendered =
                        showStatusWidget
                          ? renderStatusWidgetsForTurn(
                              orderedWidgetsForRender(
                                statusWidgetTurn,
                                m.statusWidgetValues ?? {}
                              ),
                              statusWidgetProfileNames
                            )
                          : [];
                      const widgetsTop = widgetRendered.filter((w) => w.widget.placement === "top");
                      const widgetsBottom = widgetRendered.filter(
                        (w) => w.widget.placement !== "top"
                      );
                      const statusMetaCard = m.model !== "greeting" ? (
                        <StatusMetaCard
                          meta={m.statusMeta}
                          formatSpec={messageFormatSpec}
                          pending={m.statusMetaPending}
                          showStatusMeta={showStatusMeta}
                          failed={m.statusMetaFailed}
                          placement={statusWindowPlacement}
                        />
                      ) : null;
                      return (
                        <>
                          {widgetsTop.map((w) => (
                            <StatusWidgetCard
                              key={`${m.id}-widget-${w.source}-top`}
                              html={w.html}
                            />
                          ))}
                          {statusWindowPlacement === "top" ? statusMetaCard : null}
                          <div
                            data-quote-assistant
                            className="select-text [touch-action:pan-y] [-webkit-user-select:text]"
                            style={{ userSelect: "text", WebkitUserSelect: "text", touchAction: "pan-y", WebkitTouchCallout: "default" }}
                          >
                            <ChatRichBlocks
                              key={`${m.id ?? i}-${m.activeVariant ?? 0}`}
                              content={toDisplay(bodyForDisplay)}
                              display={displayPrefs}
                              paragraphMode={m.model === "greeting" ? "author" : "ai"}
                              proseOnly={m.model !== "greeting"}
                              streaming={isStreamingThisMessage}
                            />
                          </div>
                          {widgetsBottom.map((w) => (
                            <StatusWidgetCard
                              key={`${m.id}-widget-${w.source}-bottom`}
                              html={w.html}
                            />
                          ))}
                          {statusWindowPlacement === "bottom" ? statusMetaCard : null}
                          {isStreamingThisMessage && (streamPhase || genStatus === "generating") && (
                            <p className="mt-2 animate-pulse text-sm font-medium text-orange-400/90">
                              {streamPhase ?? "생성 중…"}
                            </p>
                          )}
                          {i === lastAssistantIdx &&
                            !loading &&
                            isRetryableGenerationStatus(m.generationStatus) && (
                              <div className="mt-3 flex justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void regenerate(m.id ?? undefined)}
                                  className="rounded-md border border-white/15 bg-[#1a1a1a] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-orange-500/40 hover:text-white"
                                >
                                  {m.content.trim() ? "이어서 생성" : "다시 생성"}
                                </button>
                              </div>
                            )}
                          {showOocMarkdown && statusMarkdown && !messageFormatSpec && (
                            <NovelText
                              content={statusMarkdown}
                              display={displayPrefs}
                              paragraphMode="ai"
                            />
                          )}
                        </>
                      );
                    })()}
                    {renderAssistantMessageFooter(m, i, {
                      isEditing,
                      showToolbar,
                      onLastTurn,
                    })}
                  </>
                )}
                </div>
              </article>
            );
          })}
          {error && <p className="text-center text-sm text-rose-400">{error}</p>}
          <div ref={bottomRef} className="sm:!mt-0" />
          </div>
        </div>
      </div>

      <div
        ref={inputDockRef}
        className={
          showCharacterPortrait
            ? "sticky bottom-0 z-20 shrink-0 overflow-visible border-t border-white/5 bg-[#121212]/88 px-2 pt-0 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:-mt-2 sm:bg-[#121212] sm:px-0 sm:pt-0 sm:pb-2 sm:backdrop-blur-none"
            : `${CHAT_INPUT_DOCK_NO_PORTRAIT_CLASS} overflow-visible`
        }
      >
        <FloatingPointsDeduction amount={floatDeductionAmount} trigger={floatDeductionTrigger} />
        <div className={`flex flex-wrap items-center gap-2 overflow-visible ${showCharacterPortrait ? "mb-1" : "mb-1"}`}>
          <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-zinc-400 sm:flex-none">
            <span className="flex items-center gap-1.5">
              <span className="shrink-0 font-semibold text-zinc-500">AI</span>
              <select
                value={selectedAI}
                onChange={(e) => void handleSelectedAIChange(e.target.value as SelectedAI)}
                disabled={inputLocked}
                className="max-w-full rounded-md border border-white/10 bg-[#1a1a1a] px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-violet-500/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {USER_SELECTABLE_AI_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {selectedAIOptionLabel(o.id as SelectedAI, pickerPreview)}
                  </option>
                ))}
              </select>
            </span>
            <span className="truncate text-[10px] text-zinc-500">
              {globalModelStatusLabel(selectedAI)}
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex gap-1.5">
            <textarea
              value={input}
              maxLength={CHAT_MESSAGE_MAX}
              onChange={(e) => setInput(e.target.value.slice(0, CHAT_MESSAGE_MAX))}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.ctrlKey || e.metaKey) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (!inputLocked) send();
                }
              }}
              disabled={inputLocked}
              rows={2}
              placeholder="메시지 입력 · 지문은 * * 또는 ( ) · Ctrl+Enter 전송"
              className="min-h-[3.5rem] flex-1 resize-none rounded-lg border border-white/25 bg-[#1a1a1a] px-3 py-2.5 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400/60 focus:ring-1 focus:ring-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[2.75rem] sm:py-2"
              style={{ fontSize: "calc(var(--font-size-chat) + 0.0625rem)", lineHeight: "var(--line-height-chat)" }}
            />
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={sendContinue}
                disabled={inputLocked || !canContinue}
                title="AI 답변 직후 서사를 이어갑니다"
                className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 disabled:opacity-40"
              >
                자동진행
              </button>
              <button
                type="button"
                onClick={send}
                disabled={inputLocked || !input.trim()}
                className="rounded-md border border-violet-500/35 bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
              >
                전송
              </button>
            </div>
          </div>
          <p className="text-right text-[10px] leading-tight tabular-nums">
            <span
              className={`font-semibold ${
                input.length >= CHAT_MESSAGE_MAX ? "text-rose-400" : "text-zinc-300"
              }`}
            >
              {input.length.toLocaleString()} / {CHAT_MESSAGE_MAX.toLocaleString()}자
            </span>
            <span className="text-[10px] text-zinc-500"> · Ctrl+Enter 전송</span>
            {canContinue && !loading && (
              <span className="text-[10px] text-violet-400/80">
                {" "}
                · 자동진행: 유저의 행동과 대사도 함께 출력됩니다
              </span>
            )}
          </p>
        </div>
      </div>
        </div>
      </div>
      </div>

      <aside
        className={`sticky ${CHAT_ROOM_HEADER_OFFSET_CLASS} z-40 hidden w-16 shrink-0 flex-col gap-1 self-start overflow-visible px-1 py-2 md:flex md:w-[68px]`}
      >
        <div className="hidden">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setCharacterIntroOpen(true)}
              className="block max-w-full truncate text-left text-base font-black leading-tight text-white underline-offset-4 transition hover:text-violet-100 hover:underline"
              title="캐릭터 소개 보기"
            >
              {character.name}
            </button>
            {creatorId != null && creatorId > 0 ? (
              <Link
                href={`/creator/${creatorId}`}
                className={creatorNameRailClass}
                title="제작자 페이지"
              >
                {creatorName}
              </Link>
            ) : creatorName ? (
              <p className={creatorNameRailClass}>{creatorName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setAssetAlbumOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-zinc-100 transition hover:bg-white/[0.08] hover:text-white"
            title="이미지 앨범"
            aria-label="이미지 앨범 열기"
          >
            <IconAlbum className="h-4 w-4" />
          </button>
        </div>
        <ChatRoomDisplayQuickRail
          displayPrefs={displayPrefs}
          onDisplayPrefsChange={handleDisplayPrefsChange}
        />
        {renderSettingsPanel("rail")}
        <BookmarksPanel variant="rail" />
      </aside>

    </div>
  );
}
