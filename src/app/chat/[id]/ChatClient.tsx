"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatRichBlocks from "@/components/ChatRichBlocks";
import StatusMetaCard from "@/components/StatusMetaCard";
import StatusWidgetCard from "@/components/StatusWidgetCard";
import NovelText from "@/components/NovelText";
import ChatEmotionPortraitPanel from "@/components/ChatEmotionPortraitPanel";
import ChatSettingsPanel from "@/components/ChatSettingsPanel";
import ChatRoomDisplayQuickRail from "@/components/ChatRoomDisplayQuickRail";
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
import type { MessageVariant } from "@/lib/messageAlternates";
import {
  findAssetByTag,
  getDefaultChatAsset,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { resolveEmotionTag, stripEmotionTag, stripEmotionTagsForDisplay } from "@/lib/emotionTag";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import { stripInternalTagLeakage, stripRpMetaPreamble } from "@/lib/narrativeRules";
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
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  CHAT_MESSAGE_MAX,
  ASSISTANT_MESSAGE_MAX,
  DEFAULT_TARGET_RESPONSE_CHARS,
  isClaudeSelectedAI,
  selectedAILabel,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  formatAssistantLengthLabel,
  CATASTROPHIC_MIN_RESPONSE_CHARS,
} from "@/lib/responseLengthConstants";
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
  stripIncompleteStatusWidgetTail,
  type ParsedStatusWidgetTurnValues,
  type StatusWidgetSourceMode,
  type StatusWidgetStackOrder,
} from "@/lib/statusWidget";
import { cacheUserChatPrefsClient } from "@/lib/userChatPrefs";
import {
  chatReadabilityRootStyle,
  chatMessageAreaLayoutClass,
  CHAT_MESSAGES_COLUMN_CLASS,
  CHAT_MESSAGES_BODY_NO_PORTRAIT_CLASS,
  CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS,
  CHAT_MESSAGES_LIST_NO_PORTRAIT_CLASS,
  CHAT_INPUT_DOCK_NO_PORTRAIT_CLASS,
  CHAT_PORTRAIT_GRID_CLASS,
  CHAT_PORTRAIT_STICKY_CLASS,
  CHAT_PORTRAIT_PANEL_HEIGHT,
  CHAT_ROOM_TITLE_BAR_CLASS,
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  DEFAULT_CHAT_DISPLAY_PREFS,
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

function selectedAIShortLabel(id: SelectedAI): string {
  const opt = SELECTED_AI_OPTIONS.find((o) => o.id === id);
  if (!opt) return selectedAILabel(id);
  return opt.label;
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
  /** UI 전용 — DB 미저장 */
  ephemeral?: boolean;
};

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
    if (!isCharacterCreator && asset.viewerBlur) unlocked.add(asset.url);
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
  initialTargetResponseChars,
  initialChatTitle = "",
  initialDisplayPrefs,
  initialHasMoreOlder = false,
  initialHiddenTurnCount = 0,
  isCharacterCreator = false,
  initialStatusWidgetMode = "character_only",
  initialCharacterWidgetJson = "",
  initialUserWidgetJson = "",
  initialStatusWidgetStackOrder = "character_first",
  characterWidgetAllowUserOverride = true,
  showFullBillingReceipt = false,
}: {
  character: { id: number; name: string; emoji: string; hue: number; nsfw: number };
  creatorName: string;
  creatorId: number | null;
  assets: CharacterAsset[];
  initialChatId: number | null;
  initialMessages: Msg[];
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
  initialTargetResponseChars: number;
  initialChatTitle?: string;
  initialDisplayPrefs?: ChatDisplayPrefs;
  isCharacterCreator?: boolean;
  initialStatusWidgetMode?: StatusWidgetSourceMode;
  initialCharacterWidgetJson?: string;
  initialUserWidgetJson?: string;
  initialStatusWidgetStackOrder?: StatusWidgetStackOrder;
  characterWidgetAllowUserOverride?: boolean;
  showFullBillingReceipt?: boolean;
}) {
  const router = useRouter();
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
  const [editSaving, setEditSaving] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [input, setInput] = useState(() => loadChatMessageDraft(character.id, initialChatId));
  const draftScopeRef = useRef(`${character.id}:${initialChatId ?? "pending"}`);
  const [loading, setLoading] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string | null>(null);
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
  const unlockedUrlsRef = useRef<Set<string>>(initialPortrait.unlocked);
  const [unlockedUrls, setUnlockedUrls] = useState<Set<string>>(
    () => new Set(initialPortrait.unlocked)
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
  const statusWidgetTurn = useMemo(
    () =>
      resolveStatusWidgetTurn({
        characterWidgetJson: initialCharacterWidgetJson,
        chatMode: initialStatusWidgetMode,
        userWidgetJson: initialUserWidgetJson,
        stackOrder: initialStatusWidgetStackOrder,
        characterAllowUserOverride: characterWidgetAllowUserOverride,
      }),
    [
      initialCharacterWidgetJson,
      initialStatusWidgetMode,
      initialUserWidgetJson,
      initialStatusWidgetStackOrder,
      characterWidgetAllowUserOverride,
    ]
  );
  const statusWidgetActive = statusWidgetTurn.active;

  const widgetReservedChars = useMemo(
    () =>
      resolveStatusWidgetReservedChars({
        characterWidgetJson: initialCharacterWidgetJson,
        chatMode: initialStatusWidgetMode,
        userWidgetJson: initialUserWidgetJson,
        stackOrder: initialStatusWidgetStackOrder,
        characterAllowUserOverride: characterWidgetAllowUserOverride,
      }),
    [
      initialCharacterWidgetJson,
      initialStatusWidgetMode,
      initialUserWidgetJson,
      initialStatusWidgetStackOrder,
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
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [displaySettingsSaving, setDisplaySettingsSaving] = useState(false);
  const settingsSkipAutoSaveRef = useRef(true);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveInFlightRef = useRef(0);
  const userNoteRef = useRef(userNote);
  userNoteRef.current = userNote;

  const beginSettingsSave = () => {
    settingsSaveInFlightRef.current += 1;
    setSettingsSaving(true);
  };

  const endSettingsSave = () => {
    settingsSaveInFlightRef.current = Math.max(0, settingsSaveInFlightRef.current - 1);
    setSettingsSaving(settingsSaveInFlightRef.current > 0);
  };

  const handleSelectedAIChange = useCallback(
    (next: SelectedAI) => {
      const switchingToOpus = !isClaudeSelectedAI(selectedAI) && isClaudeSelectedAI(next);
      setSelectedAI(next);
      if (switchingToOpus) {
        setTargetResponseChars(DEFAULT_TARGET_RESPONSE_CHARS);
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
          selectedAI,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          chatTitle,
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
  }, [
    chatId,
    selectedAI,
    nsfwMode,
    chatTitle,
    widgetReservedChars,
  ]);

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
            selectedAI,
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
    [chatId, selectedAI, nsfwMode, chatTitle, widgetReservedChars]
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
  }, [
    chatId,
    selectedAI,
    nsfwMode,
    chatTitle,
    persistChatSettings,
  ]);

  useEffect(() => {
    settingsSkipAutoSaveRef.current = true;
    setUserNote(initialUserNote);
    setNotePresets(initialNotePresets);
    setSelectedAI(initialSelectedAI);
    setMode(initialMode);
    setTargetResponseChars(initialTargetResponseChars);
    setChatTitle(initialChatTitle);
    setDisplayPrefs(initialDisplayPrefs ?? DEFAULT_CHAT_DISPLAY_PREFS);
    setSelectedPersonaId(initialSelectedPersonaId);
  }, [
    initialChatId,
    initialUserNote,
    initialNotePresets,
    initialSelectedAI,
    initialMode,
    initialTargetResponseChars,
    initialChatTitle,
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
      if (url.searchParams.get("chat") === String(id) && !url.searchParams.has("fresh")) return;
      url.searchParams.set("chat", String(id));
      url.searchParams.delete("fresh");
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
      setUnlockedUrls(new Set(unlockedUrlsRef.current));
      if (showUnlockNotice) {
        setToastMsg(`「${asset.tag}」 표정 이미지가 해금되었습니다`);
      }
    }

    setActivePortraitUrl(asset.url);
    setActivePortraitTag(asset.tag);
  };

  const { lastUserIdx, lastAssistantIdx } = useMemo(
    () => findLastTurnIndices(messages),
    [messages]
  );

  const canContinue = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "system" && m.ephemeral) continue;
      return m.role === "assistant" && m.content.trim().length > 0;
    }
    return false;
  }, [messages]);

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
    setActivePortraitUrl(scanned.activeUrl);
    setActivePortraitTag(scanned.activeTag);
    unlockedUrlsRef.current = scanned.unlocked;
    setUnlockedUrls(new Set(scanned.unlocked));
  }, [initialChatId, initialMessages, assets, isCharacterCreator]);

  useEffect(() => {
    displayPrefsRef.current = displayPrefs;
    activeStreamRevealRef.current?.syncOptions();
  }, [displayPrefs]);

  function handlePersonaUpdated(updated: PersonaListItem) {
    setPersonas((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  }

  const toDisplay = (content: string) => replaceUserPlaceholder(content, activePersonaName, nickname);

  const SCROLL_BOTTOM_THRESHOLD_PX = 80;

  const getInputDockHeight = useCallback(() => inputDockRef.current?.offsetHeight ?? 0, []);

  /** sticky 입력창 위쪽을 “시각적 하단”으로 간주 */
  const isNearBottom = useCallback(() => {
    if (typeof window === "undefined") return true;
    const dockH = getInputDockHeight();
    const { scrollY, innerHeight } = window;
    const docHeight = document.documentElement.scrollHeight;
    const gap = docHeight - scrollY - innerHeight;
    return gap <= SCROLL_BOTTOM_THRESHOLD_PX + dockH;
  }, [getInputDockHeight]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const anchor = bottomRef.current;
      if (!anchor || typeof window === "undefined") return;
      const dockH = getInputDockHeight();
      const pad = displayPrefs.showCharacterPortrait ? 12 : 2;
      const rect = anchor.getBoundingClientRect();
      const targetBottom = window.innerHeight - dockH - pad;
      const delta = rect.bottom - targetBottom;
      if (Math.abs(delta) < 2) return;
      window.scrollTo({
        top: Math.max(0, window.scrollY + delta),
        behavior,
      });
    },
    [getInputDockHeight, displayPrefs.showCharacterPortrait]
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
              copy[aiIndex] = { ...cur, content: nextContent };
              applyEmotionRef.current(nextContent);
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
        reveal.reset();
        reveal.enqueue(newText);
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
          copy[aiIndex] = {
            ...cur,
            id: data.messageId,
            content: data.finalContent ?? cur.content,
            model: resolvedUsage?.model ?? data.usage?.model,
            usage: resolvedUsage,
            variants: data.variants,
            activeVariant: data.activeVariant,
            variantCount: data.variantCount,
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
          };
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (data.type === "status") {
            if (data.message) {
              setStreamPhase(data.message);
              if (/HTML|상태창 생성/i.test(data.message)) {
                htmlFlashStreamTurn = true;
              }
            }
            if (data.message !== "생성 중…") {
              postStreamLocked = true;
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
            applyStreamReplaceTarget(data.text, { instant: data.instant === true });
            continue;
          }

          if (data.type === "append" && data.text) {
            reveal.resume();
            setStreamPhase(null);
            appendStreamText(data.text, true);
            continue;
          }

          if (data.text) {
            reveal.resume();
            setStreamPhase(null);
            appendStreamText(data.text);
          }

          if (data.type === "done") {
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
            reveal.flush();
            streamError = data.error || "스트리밍 중 오류가 발생했습니다.";
            console.error("[chat] API error:", streamError, data);
          }
        }
      }

      setStreamPhase(null);
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
      if (pendingDone && !trafficOverload) applyStreamDone(pendingDone);
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
    }

    const billing =
      pendingDone && !trafficOverload ? extractBillingInfo(pendingDone) : undefined;
    return { streamError, trafficOverload: trafficOverload || undefined, billing };
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
    setMessages((m) => m.slice(0, Math.max(0, rollbackToIndex)));
    setError(notice);
  }

  function handlePostStreamResult(
    streamResult: {
      streamError?: string;
      trafficOverload?: string;
      billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
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
        setMessages((m) => {
          const assistant = m[aiIndex];
          const keepPartial =
            assistant?.role === "assistant" &&
            assistant.content.trim().length >= CATASTROPHIC_MIN_RESPONSE_CHARS;
          return keepPartial ? m : m.slice(0, aiIndex);
        });
      }
      if (opts?.restoreInput != null) setInput(opts.restoreInput);
    }
  }

  async function handleStreamError(
    res: Response,
    aiIndex: number,
    rollback: () => void,
    restoreInput?: string
  ) {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      let data: { error?: string; needVerify?: boolean; needCharge?: boolean } = {};
      try {
        data = await res.json();
      } catch {
        setError(
          res.ok
            ? "응답 형식 오류가 발생했습니다."
            : `서버 오류 (${res.status}). 잠시 후 다시 시도해 주세요.`
        );
        rollback();
        if (restoreInput != null) setInput(restoreInput);
        return true;
      }
      if (!res.ok) {
        setError(data.error || "오류가 발생했습니다.");
        if (data.needVerify) router.push("/verify");
        if (data.needCharge) {
          router.push(isPaymentsEnabledClient() ? "/points" : "/events/beta-free-points");
        }
        rollback();
        if (restoreInput != null) setInput(restoreInput);
      }
      return true;
    }
    return false;
  }

  async function sendContinue() {
    if (!canContinue || inFlightRef.current) return;
    inFlightRef.current = true;
    loadingRef.current = true;
    setError("");
    setStreamPhase(null);
    followStreamRef.current = true;
    userScrollLockRef.current = false;
    scrollToBottom("smooth");
    let aiIndex = 0;
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
        { role: "user", content: CONTINUE_USER_DISPLAY },
        { role: "assistant", content: "", ...statusSeed },
      ];
    });
    setLoading(true);

    let streamResult:
      | {
          streamError?: string;
          trafficOverload?: string;
          billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
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
          selectedAI,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          userNote,
          selectedPersonaId,
          targetResponseChars,
        }),
      });

      const earlyExit = await handleStreamError(res, aiIndex, () => {
        setMessages((m) => m.slice(0, -2));
      });
      if (earlyExit) return;

      streamResult = await consumeChatStream(res, aiIndex);
      handlePostStreamResult(streamResult, aiIndex, {
        rollback: () => setMessages((m) => m.slice(0, -2)),
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
      setMessages((m) => m.slice(0, -2));
    } finally {
      inFlightRef.current = false;
      loadingRef.current = false;
      setLoading(false);
      setStreamPhase(null);
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
    followStreamRef.current = true;
    userScrollLockRef.current = false;
    scrollToBottom("smooth");
    let aiIndex = 0;
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
      return [...m, { role: "user", content: text }, { role: "assistant", content: "", ...statusSeed }];
    });
    setLoading(true);

    let streamResult:
      | {
          streamError?: string;
          trafficOverload?: string;
          billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
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
          selectedAI,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          userNote,
          selectedPersonaId,
          targetResponseChars,
        }),
      });

      const earlyExit = await handleStreamError(res, aiIndex, () => {
        setMessages((m) => m.slice(0, -2));
      }, text);
      if (earlyExit) return;

      streamResult = await consumeChatStream(res, aiIndex);
      handlePostStreamResult(streamResult, aiIndex, {
        rollback: () => setMessages((m) => m.slice(0, -2)),
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
      setMessages((m) => m.slice(0, -2));
      setInput(text);
    } finally {
      inFlightRef.current = false;
      loadingRef.current = false;
      setLoading(false);
      setStreamPhase(null);
      if (
        streamResult?.billing &&
        !streamResult.streamError &&
        !streamResult.trafficOverload
      ) {
        applyStreamBilling(streamResult.billing);
      }
    }
  }

  async function regenerate() {
    if (inFlightRef.current || !chatId || lastAssistantIdx < 0) return;
    const prevAssistant = messages[lastAssistantIdx];
    setError("");
    setStreamPhase(null);
    inFlightRef.current = true;
    loadingRef.current = true;
    setLoading(true);
    followStreamRef.current = true;
    userScrollLockRef.current = false;
    scrollToBottom("smooth");

    const statusWindowPolicy = resolveUserNoteStatusWindowPolicy(userNote);
    let regenUserMessage = "";
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
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
      copy[lastAssistantIdx] = {
        ...copy[lastAssistantIdx],
        content: "",
        usage: null,
        isRefunded: false,
        variants: undefined,
        activeVariant: undefined,
        variantCount: 1,
        statusMeta: null,
        statusMetaPending: regenStatusWindowActive,
        statusMetaRequested: regenStatusWindowActive,
        statusMetaFailed: false,
        statusMetaFormatSpec:
          statusWindowPolicy.formatSpec ?? copy[lastAssistantIdx]!.statusMetaFormatSpec ?? null,
        statusWidgetValues: null,
        statusWidgetTurnActive: statusWidgetActive,
      };
      return copy;
    });

    const restoreAssistant = () => {
      setMessages((m) => {
        const copy = [...m];
        if (copy[lastAssistantIdx]) copy[lastAssistantIdx] = prevAssistant;
        return copy;
      });
    };

    let streamResult:
      | {
          streamError?: string;
          trafficOverload?: string;
          billing?: { turnCost: number; remainingPoints: number; paidPoints: number; freePoints: number };
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
          selectedAI,
          isNsfwMode: nsfwMode,
          isAdultMode: nsfwMode,
          userNote,
          selectedPersonaId,
          targetResponseChars,
        }),
      });

      const earlyExit = await handleStreamError(res, lastAssistantIdx, restoreAssistant);
      if (earlyExit) return;

      streamResult = await consumeChatStream(res, lastAssistantIdx);
      if (streamResult.trafficOverload) {
        restoreAssistant();
        setError(streamResult.trafficOverload);
      } else if (streamResult.streamError) {
        setError(streamResult.streamError);
        restoreAssistant();
      }
    } catch (e) {
      activeStreamRevealRef.current?.reset();
      if (!chatMountedRef.current && isBenignChatStreamAbort(e)) return;
      const abortMsg = chatStreamAbortMessage(e);
      if (abortMsg) {
        setError(abortMsg);
      } else if (!isBenignChatStreamAbort(e)) {
        setError("네트워크 오류가 발생했습니다.");
      }
      restoreAssistant();
    } finally {
      inFlightRef.current = false;
      loadingRef.current = false;
      setLoading(false);
      setStreamPhase(null);
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
    setEditDraft(content);
    if (role === "assistant") {
      const idx = messages.findIndex((m) => m.id === messageId);
      const userMsg = idx > 0 && messages[idx - 1]?.role === "user" ? messages[idx - 1] : null;
      if (userMsg?.id) {
        setEditingUserId(userMsg.id);
        setEditUserDraft(userMsg.content);
      } else {
        setEditingUserId(null);
        setEditUserDraft("");
      }
    } else {
      setEditingUserId(null);
      setEditUserDraft("");
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingUserId(null);
    setEditingRole(null);
    setEditDraft("");
    setEditUserDraft("");
  }

  async function saveEdit(messageId: number) {
    const assistantText = editDraft.trim();
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

    if (!assistantText) {
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
        body: JSON.stringify({ messageId, content: assistantText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMsg(data.error || "수정에 실패했습니다.");
        return;
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: data.content } : m))
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

  function renderAssistantLengthHint(content: string, streamingHtmlFlash = false) {
    if (!showFullBillingReceipt) return null;
    if (streamingHtmlFlash) return null;
    const len = visibleAssistantMessageLength(content);
    if (len <= 0) return null;
    return (
      <span className="text-xs font-semibold tabular-nums text-zinc-400">
        {formatAssistantLengthLabel(len, targetResponseChars)}
      </span>
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
    const lengthHint = renderAssistantLengthHint(
      m.content,
      loading &&
        opts.onLastTurn &&
        /HTML|상태창 생성/i.test(streamPhase ?? "")
    );
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
          showRegenerate={i === lastAssistantIdx && !loading}
          showFork
          disabled={loading}
          lengthHint={lengthHint}
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

    if (!lengthHint) return null;
    return (
      <div className="mt-1 flex justify-end">
        {lengthHint}
      </div>
    );
  }

  function isLastTurnMessage(idx: number, m: Msg) {
    if (idx === lastUserIdx) return true;
    if (idx === lastAssistantIdx && m.role === "assistant") return true;
    return false;
  }

  const handleDisplayPrefsChange = useCallback((next: ChatDisplayPrefs) => {
    setDisplayPrefs(next);
    saveChatDisplayPrefs(next);
  }, []);

  function renderSettingsPanel(layout: "rail" | "drawer", onClose?: () => void) {
    return (
      <ChatSettingsPanel
        chatId={chatId}
        memoryRefreshKey={memoryRefreshKey}
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
        displayPrefs={displayPrefs}
        onDisplayPrefsChange={handleDisplayPrefsChange}
        onSaveDisplaySettings={persistUserChatPrefs}
        displaySettingsSaving={displaySettingsSaving}
        characterWidgetJson={initialCharacterWidgetJson}
        statusWidgetMode={initialStatusWidgetMode}
        userWidgetJson={initialUserWidgetJson}
        characterWidgetAllowUserOverride={characterWidgetAllowUserOverride}
        layout={layout}
        onClose={onClose}
      />
    );
  }

  const showCharacterPortrait = displayPrefs.showCharacterPortrait;
  const chatDisplayTitle = chatTitle.trim() || character.name;

  return (
    <div className="-ml-1 flex min-w-0 flex-1 items-stretch gap-0 sm:-ml-2">
      <div
        className="chat-readability-root flex min-w-0 flex-1 flex-col"
        style={chatReadabilityRootStyle(displayPrefs)}
      >
      <ChatToast message={toastMsg} />
      <ChatSelectionQuoteToolbar
        containerRef={quoteSelectContainerRef}
        characterName={character.name}
        creatorName={creatorName}
        disabled={loading || editingId != null}
        onToast={setToastMsg}
      />

      <div className={CHAT_ROOM_TITLE_BAR_CLASS}>
        <div className="flex min-w-0 items-baseline gap-2">
          <Link
            href={`/character/${character.id}`}
            title="캐릭터 정보 보기"
            className="truncate text-lg font-bold text-white underline-offset-2 transition hover:underline sm:text-xl"
          >
            {chatDisplayTitle}
          </Link>
          {creatorId != null && creatorId > 0 ? (
            <Link
              href={`/creator/${creatorId}`}
              title="제작자 페이지"
              className="shrink-0 text-[11px] text-zinc-500 underline-offset-2 transition hover:text-zinc-300 hover:underline sm:text-xs"
            >
              {creatorName}
            </Link>
          ) : (
            creatorName ? (
              <span className="shrink-0 text-[11px] text-zinc-500 sm:text-xs">{creatorName}</span>
            ) : null
          )}
        </div>
      </div>

      <div
        className={
          showCharacterPortrait
            ? CHAT_PORTRAIT_GRID_CLASS
            : "flex min-h-0 min-w-0 flex-1 flex-col"
        }
      >
        {showCharacterPortrait && (
          <div
            className={`${CHAT_PORTRAIT_STICKY_CLASS} pl-1 sm:pl-0`}
            style={{ height: CHAT_PORTRAIT_PANEL_HEIGHT }}
          >
            <ChatEmotionPortraitPanel
              characterName={character.name}
              emoji={character.emoji}
              hue={character.hue}
              assets={assets}
              defaultAsset={defaultChatAsset}
              activeUrl={activePortraitUrl}
              unlockedUrls={unlockedUrls}
              viewerIsCreator={isCharacterCreator}
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
      <div
        className={
          showCharacterPortrait
            ? "bg-[#121212] px-2 pl-3 sm:pl-2 sm:pr-1 pb-4 sm:pb-6"
            : CHAT_MESSAGES_BODY_NO_PORTRAIT_CLASS
        }
        role="presentation"
      >
        <div className={chatMessageAreaLayoutClass(showCharacterPortrait)}>
          <div
            ref={quoteSelectContainerRef}
            className={showCharacterPortrait ? "min-w-0 space-y-2" : CHAT_MESSAGES_LIST_NO_PORTRAIT_CLASS}
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
                  <div className="mt-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              );
            }

            if (m.content === "" && loading && i === messages.length - 1) {
              return (
                <div key={m.id ?? `asst-loading-${i}`}>
                  <p className="animate-pulse text-sm text-zinc-600">
                    {streamPhase ?? `${character.name}이(가) 초안 작성 중…`}
                  </p>
                </div>
              );
            }

            return (
              <article
                key={m.id ?? `asst-${i}`}
                id={m.id ? `msg-${m.id}` : undefined}
                className={showCharacterPortrait ? "pb-2" : "pb-0"}
              >
                <div className="min-w-0">
                {isEditing ? (
                  <div>
                    <textarea
                      value={editDraft}
                      maxLength={ASSISTANT_MESSAGE_MAX}
                      onChange={(e) =>
                        setEditDraft(e.target.value.slice(0, ASSISTANT_MESSAGE_MAX))
                      }
                      rows={6}
                      className="w-full resize-none rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-orange-500/40"
                    />
                    {renderEditActions(m.id!, "assistant")}
                  </div>
                ) : (
                  <>
                    {(() => {
                      const isStreamingThisMessage = loading && i === messages.length - 1;
                      const variantContent = isStreamingThisMessage
                        ? m.content
                        : resolveActiveVariantContent(m);
                      const displayBody = stripIncompleteStatusWidgetTail(
                        stripRpMetaPreamble(
                          stripEmotionTagsForDisplay(stripInternalTagLeakage(variantContent))
                        )
                      );
                      const messageFormatSpec =
                        m.statusMetaFormatSpec ?? chatStatusFormatSpec ?? null;
                      const bodyForDisplay =
                        markdownStatusWindowActive && messageFormatSpec
                          ? partitionPlainStatusBlockForDisplay(
                              displayBody,
                              messageFormatSpec,
                              statusWindowPlacement,
                              { streaming: isStreamingThisMessage }
                            ).prose
                          : displayBody;
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
                      });
                      const widgetRendered =
                        showStatusWidget
                          ? renderStatusWidgetsForTurn(
                              orderedWidgetsForRender(
                                statusWidgetTurn,
                                m.statusWidgetValues ?? {}
                              )
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
                          <ChatRichBlocks
                            key={`${m.id ?? i}-${m.activeVariant ?? 0}`}
                            content={toDisplay(bodyForDisplay)}
                            display={displayPrefs}
                            paragraphMode={m.model === "greeting" ? "author" : "ai"}
                            proseOnly={m.model !== "greeting"}
                            streaming={isStreamingThisMessage}
                          />
                          {widgetsBottom.map((w) => (
                            <StatusWidgetCard
                              key={`${m.id}-widget-${w.source}-bottom`}
                              html={w.html}
                            />
                          ))}
                          {statusWindowPlacement === "bottom" ? statusMetaCard : null}
                          {isStreamingThisMessage && streamPhase && (
                            <p className="mt-2 animate-pulse text-sm text-zinc-600">{streamPhase}</p>
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
          <div ref={bottomRef} />
          </div>
        </div>
      </div>

      <div
        ref={inputDockRef}
        className={
          showCharacterPortrait
            ? "sticky bottom-0 z-10 shrink-0 overflow-visible border-t border-white/5 bg-[#121212] px-2 pl-3 sm:pl-2 sm:pr-1 py-2"
            : `${CHAT_INPUT_DOCK_NO_PORTRAIT_CLASS} overflow-visible`
        }
      >
        <FloatingPointsDeduction amount={floatDeductionAmount} trigger={floatDeductionTrigger} />
        <div className={`flex flex-wrap items-center gap-2 overflow-visible ${showCharacterPortrait ? "mb-1.5" : "mb-1"}`}>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="shrink-0 font-semibold text-zinc-500">AI</span>
            <select
              value={selectedAI}
              onChange={(e) => handleSelectedAIChange(e.target.value as SelectedAI)}
              disabled={loading}
              className="rounded-md border border-white/10 bg-[#1a1a1a] px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-violet-500/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {USER_SELECTABLE_AI_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {selectedAIShortLabel(o.id)}
                </option>
              ))}
            </select>
          </label>

          <RelationshipMetaDock chatId={chatId} refreshKey={memoryRefreshKey} />
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
                  send();
                }
              }}
              rows={2}
              placeholder="메시지 입력 · 지문은 * * 또는 ( ) · Ctrl+Enter 전송"
              className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-white/25 bg-[#1a1a1a] px-3 py-2 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400/60 focus:ring-1 focus:ring-violet-500/35"
              style={{ fontSize: "var(--font-size-chat)", lineHeight: "var(--line-height-chat)" }}
            />
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={sendContinue}
                disabled={loading || !canContinue}
                title="AI 답변 직후 서사를 이어갑니다"
                className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 disabled:opacity-40"
              >
                자동진행
              </button>
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
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
              <span className="text-[10px] text-violet-400/80"> · 자동진행으로 서사 진행 가능</span>
            )}
          </p>
        </div>
      </div>
        </div>
      </div>
      </div>

      <aside
        className={`sticky ${CHAT_ROOM_HEADER_OFFSET_CLASS} z-30 flex w-11 shrink-0 flex-col gap-1 self-start sm:w-12`}
      >
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
