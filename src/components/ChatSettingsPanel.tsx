"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import ChatPersonaEditor, { restorePersonaSnapshot } from "@/components/ChatPersonaEditor";
import PersonaSelector from "@/components/PersonaSelector";
import StatusWidgetChatSettings from "@/components/StatusWidgetChatSettings";
import { ChatPortraitPrefs } from "@/components/ChatStatusPortraitPrefs";
import type { StatusWidgetSourceMode, StatusWidgetDisplayMode } from "@/lib/statusWidget";
import { resolveStatusWidgetReservedChars } from "@/lib/statusWidget";
import type { PersonaListItem } from "@/lib/userPersonas";
import {
  CHAT_FONT_OPTIONS,
  CHAT_FONT_SIZE_PRESETS,
  DEFAULT_CHAT_DISPLAY_PREFS,
  fontSizePresetFromIndex,
  fontSizePresetIndex,
  fontSizePresetLabel,
  formatStreamIntervalLabel,
  STREAM_INTERVAL_MAX,
  STREAM_INTERVAL_MIN,
  STREAM_INTERVAL_STEP,
  withStreamSpeed,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";
import { findResponseLengthTier } from "@/lib/responseLengthConstants";
import { MEMORY_CAPACITY_DEFAULT } from "@/lib/memory/memory-capacity-shared";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import UserNoteSplitEditor from "@/components/UserNoteSplitEditor";
import UserNotePresetPicker from "@/components/UserNotePresetPicker";
import type { UserNotePresetItem } from "@/lib/userNotePresetTypes";
import type { StatusWidgetPresetItem } from "@/lib/statusWidgetPresetTypes";
import type { NarrativePov } from "@/lib/narrativePov";
import {
  parseUserNoteCombined,
  splitUserNoteBodyForEditor,
  mergeUserNoteBodyFromEditor,
  userNoteZoneBreakdown,
  validateUserNoteCombined,
  validateUserNoteFocusPreset,
  extractFocusZoneNote,
  getReferenceBodyFromNote,
  mergePresetFocusIntoChatNote,
  replaceFocusZoneInNote,
  USER_NOTE_FOCUS_MAX,
  USER_NOTE_REFERENCE_MAX,
} from "@/lib/userNoteStatusWindow";
import {
  ChatSettingsRailIcon,
  type ChatSettingsRailIconId,
} from "@/components/ChatSettingsRailIcons";

const MEMORY_FETCH_TIMEOUT_MS = 20_000;
/** 장기기억 히스토리 — 한 페이지당 기록 수 */
const MEMORY_HISTORY_PAGE_SIZE = 8;

export type SettingsTab = "persona" | "note" | "memory" | "display";

type MemoryRecordItem = {
  id: number;
  turnStart: number;
  turnEnd: number;
  turnRangeLabel: string;
  summary: string;
  summaryKind?: string;
  scopeLabel?: string;
  branchStatus?: string | null;
  userEdited: boolean;
  charCount: number;
  isFallbackSummary?: boolean;
};

type MemoryData = {
  longTerm: string;
  lorebook: string;
  recentSummary: string;
  currentMemory?: string;
  archiveSummary: string;
  meta: {
    honorifics: string[];
    items: string[];
    thoughts: string[];
    promises: { text: string; deadline?: string }[];
  };
  limit: number;
  memoryCapacity: number;
  tier: string;
  longTermChars: number;
  totalTurns: number;
  bufferCount: number;
  messagesUntilCompression: number;
  budget: { total: number; pinned: number; recent: number; archive: number };
  memoryRecords?: MemoryRecordItem[];
  memoryRecordMinChars?: number;
  memoryRecordMaxChars?: number;
};

type Props = {
  chatId: number | null;
  memoryRefreshKey: number;
  userNote: string;
  onUserNoteChange: (value: string) => void;
  onSaveUserNote?: (note: string) => Promise<boolean | void>;
  notePresets?: UserNotePresetItem[];
  onNotePresetsChange?: (presets: UserNotePresetItem[]) => void;
  statusWidgetPresets?: StatusWidgetPresetItem[];
  defaultUserNote: string;
  /** 유저 노트 저장 PATCH 진행 중 */
  settingsSaving?: boolean;
  selectedPersona: PersonaListItem | null;
  onPersonaUpdated: (persona: PersonaListItem) => void;
  personas: PersonaListItem[];
  selectedPersonaId: number | null;
  onPersonaSelectedChange: (id: number) => void;
  targetResponseChars: number;
  onTargetResponseCharsChange: (value: number) => void;
  chatTitle: string;
  onChatTitleChange: (value: string) => void;
  contentKind: "character" | "simulation";
  narrativePov: NarrativePov;
  onNarrativePovChange: (value: NarrativePov) => void;
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
  onSaveDisplaySettings?: () => Promise<boolean | void>;
  displaySettingsSaving?: boolean;
  characterWidgetJson?: string;
  statusWidgetMode?: StatusWidgetSourceMode;
  statusWidgetDisplayMode?: StatusWidgetDisplayMode | null;
  userWidgetJson?: string;
  characterWidgetAllowUserOverride?: boolean;
  onStatusWidgetChange?: (saved: {
    mode: StatusWidgetSourceMode;
    displayMode: StatusWidgetDisplayMode;
    userWidgetJson: string;
  }) => void;
  layout?: "rail" | "drawer" | "inline";
  onClose?: () => void;
  relationshipMetaDock?: ReactNode;
  personaSecretBoundaryEnabled?: boolean;
};

const SECTIONS: { id: SettingsTab; label: string; railLabel: string; icon: ChatSettingsRailIconId }[] = [
  { id: "persona", label: "페르소나", railLabel: "페르소나", icon: "persona" },
  { id: "note", label: "유저 노트", railLabel: "유저노트", icon: "note" },
  { id: "memory", label: "장기기억", railLabel: "장기기억", icon: "memory" },
  { id: "display", label: "채팅 설정", railLabel: "채팅설정", icon: "display" },
];

export default function ChatSettingsPanel({
  chatId,
  memoryRefreshKey,
  userNote,
  onUserNoteChange,
  onSaveUserNote,
  notePresets = [],
  onNotePresetsChange,
  statusWidgetPresets = [],
  defaultUserNote,
  settingsSaving = false,
  selectedPersona,
  onPersonaUpdated,
  personas,
  selectedPersonaId,
  onPersonaSelectedChange,
  targetResponseChars,
  onTargetResponseCharsChange,
  chatTitle,
  onChatTitleChange,
  contentKind,
  narrativePov,
  onNarrativePovChange,
  displayPrefs,
  onDisplayPrefsChange,
  onSaveDisplaySettings,
  displaySettingsSaving = false,
  characterWidgetJson = "",
  statusWidgetMode = "character_only",
  statusWidgetDisplayMode = null,
  userWidgetJson = "",
  characterWidgetAllowUserOverride = true,
  onStatusWidgetChange,
  layout = "rail",
  onClose,
  relationshipMetaDock,
  personaSecretBoundaryEnabled = false,
}: Props) {
  const [active, setActive] = useState<SettingsTab | null>(null);
  const [liveWidgetMode, setLiveWidgetMode] = useState(statusWidgetMode);
  const [liveDisplayMode, setLiveDisplayMode] = useState<StatusWidgetDisplayMode | null>(
    statusWidgetDisplayMode
  );
  const [liveUserWidgetJson, setLiveUserWidgetJson] = useState(userWidgetJson);
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [memoryError, setMemoryError] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryRefreshing, setMemoryRefreshing] = useState(false);
  const [memoryPanelTick, setMemoryPanelTick] = useState(0);
  /** One-shot: V3 catch-up only when user opens the memory tab — not on every post-turn refresh. */
  const memoryBackfillOnceRef = useRef(false);
  const memoryLoadedChatIdRef = useRef<number | null>(null);

  useEffect(() => {
    setLiveWidgetMode(statusWidgetMode);
    setLiveDisplayMode(statusWidgetDisplayMode);
    setLiveUserWidgetJson(userWidgetJson);
  }, [statusWidgetMode, statusWidgetDisplayMode, userWidgetJson, chatId]);

  const widgetReservedChars = useMemo(
    () =>
      resolveStatusWidgetReservedChars({
        characterWidgetJson,
        chatMode: liveWidgetMode,
        userWidgetJson: liveUserWidgetJson,
        characterAllowUserOverride: characterWidgetAllowUserOverride,
        displayMode: liveDisplayMode,
      }),
    [
      characterWidgetJson,
      liveWidgetMode,
      liveUserWidgetJson,
      characterWidgetAllowUserOverride,
      liveDisplayMode,
    ]
  );

  const memoryHint =
    chatId == null
      ? "대화 전"
      : memoryData
        ? `${memoryData.longTermChars.toLocaleString()} / ${memoryData.limit.toLocaleString()}자`
        : "";

  useEffect(() => {
    if (chatId == null) {
      setMemoryData(null);
      setMemoryError("");
      setMemoryLoading(false);
      setMemoryRefreshing(false);
      memoryLoadedChatIdRef.current = null;
      return;
    }

    const hadCacheForChat = memoryLoadedChatIdRef.current === chatId;
    if (!hadCacheForChat) {
      setMemoryData(null);
    }

    let cancelled = false;

    if (hadCacheForChat) {
      setMemoryRefreshing(true);
    } else {
      setMemoryLoading(true);
    }
    setMemoryError("");

    const backfill = memoryBackfillOnceRef.current ? "&backfill=1" : "";
    memoryBackfillOnceRef.current = false;
    fetch(`/api/chat/memory?chatId=${chatId}${backfill}`, {
      signal: AbortSignal.timeout(MEMORY_FETCH_TIMEOUT_MS),
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) {
          setMemoryError(j.error);
          if (!hadCacheForChat) setMemoryData(null);
        } else {
          setMemoryData(j as MemoryData);
          memoryLoadedChatIdRef.current = chatId;
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (!hadCacheForChat) {
          setMemoryData(null);
          setMemoryError("기억 정보를 불러오지 못했습니다. (시간 초과 또는 네트워크 오류)");
        }
      })
      .finally(() => {
        if (cancelled) return;
        setMemoryLoading(false);
        setMemoryRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatId, memoryRefreshKey, memoryPanelTick]);

  function sectionHint(id: SettingsTab): string | undefined {
    if (id === "persona") return selectedPersona?.name ?? "선택 안 함";
    if (id === "note") {
      const title = chatTitle.trim();
      const note = userNote.trim() || defaultUserNote.trim();
      if (title) return title;
      if (note) return note.length > 28 ? `${note.slice(0, 28)}…` : note;
      return "비어 있음";
    }
    if (id === "display") {
      const tier = findResponseLengthTier(targetResponseChars);
      return tier.label;
    }
    if (id === "memory") return memoryHint || undefined;
    return undefined;
  }

  function renderSectionContent(id: SettingsTab) {
    if (id === "persona") {
      return (
        <PersonaSection
          chatId={chatId}
          personas={personas}
          selectedPersonaId={selectedPersonaId}
          onPersonaSelectedChange={onPersonaSelectedChange}
          selectedPersona={selectedPersona}
          onPersonaUpdated={onPersonaUpdated}
          personaSecretBoundaryEnabled={personaSecretBoundaryEnabled}
        />
      );
    }
    if (id === "note") {
      return (
        <NoteSection
          chatId={chatId}
          userNote={userNote}
          onUserNoteChange={onUserNoteChange}
          onSaveUserNote={onSaveUserNote}
          notePresets={notePresets}
          defaultUserNote={defaultUserNote}
          settingsSaving={settingsSaving}
          widgetReservedChars={widgetReservedChars}
        />
      );
    }
    if (id === "memory") {
      return (
        <MemorySection
          chatId={chatId}
          data={memoryData}
          loading={memoryLoading}
          refreshing={memoryRefreshing}
          error={memoryError}
          onDataChange={setMemoryData}
          relationshipMetaDock={relationshipMetaDock}
        />
      );
    }
    return (
      <DisplaySection
        chatId={chatId}
        contentKind={contentKind}
        narrativePov={narrativePov}
        onNarrativePovChange={onNarrativePovChange}
        characterWidgetJson={characterWidgetJson}
        statusWidgetMode={statusWidgetMode}
        statusWidgetDisplayMode={statusWidgetDisplayMode}
        userWidgetJson={userWidgetJson}
        characterWidgetAllowUserOverride={characterWidgetAllowUserOverride}
        statusWidgetPresets={statusWidgetPresets}
        onStatusWidgetSaved={(saved) => {
          setLiveWidgetMode(saved.mode);
          setLiveDisplayMode(saved.displayMode);
          setLiveUserWidgetJson(saved.userWidgetJson);
          onStatusWidgetChange?.(saved);
        }}
        onStatusWidgetDraftChange={({ mode, displayMode, userWidgetJson: draftJson }) => {
          setLiveWidgetMode(mode);
          setLiveDisplayMode(displayMode);
          setLiveUserWidgetJson(draftJson);
        }}
        displayPrefs={displayPrefs}
        onDisplayPrefsChange={onDisplayPrefsChange}
        onSaveDisplaySettings={onSaveDisplaySettings}
        displaySettingsSaving={displaySettingsSaving}
      />
    );
  }

  function selectSection(id: SettingsTab) {
    setActive((prev) => {
      const next = prev === id ? null : id;
      if (next === "memory") {
        // Explicit user action — allow at most one panel catch-up batch (server caps at 1)
        memoryBackfillOnceRef.current = true;
        setMemoryPanelTick((t) => t + 1);
      }
      return next;
    });
  }

  function closeFlyout() {
    setActive(null);
    onClose?.();
  }

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (layout !== "rail" || active == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeFlyout();
    }
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) closeFlyout();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [layout, active, onClose]);

  const activeLabel = SECTIONS.find((s) => s.id === active)?.label;

  const flyoutHeaderHidden =
    active === "memory" || active === "persona" || active === "display";
  const flyoutTitleClass =
    active === "note"
      ? "text-xs font-bold text-amber-200"
      : layout === "drawer"
        ? "text-xs font-bold text-zinc-300"
        : "text-xs font-medium text-zinc-200";

  if (layout === "drawer") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#161616]">
        {!flyoutHeaderHidden && (
          <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-3 py-2.5">
            <p className={flyoutTitleClass}>{activeLabel ?? "채팅방 설정"}</p>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                닫기
              </button>
            )}
          </div>
        )}
        <nav className="flex shrink-0 gap-0.5 border-b border-white/5 p-1.5">
          {SECTIONS.map(({ id, label, icon }) => (
            <RailMenuButton
              key={id}
              label={label}
              icon={icon}
              hint={sectionHint(id)}
              active={active === id}
              onClick={() => selectSection(id)}
              compact
            />
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {active ? renderSectionContent(active) : (
            <p className="py-8 text-center text-xs text-zinc-500">메뉴를 선택하세요.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative flex w-full flex-col">
      {active != null && (
        <div
          role="dialog"
          aria-label={activeLabel}
          aria-modal="false"
          className="absolute bottom-auto right-full top-0 z-50 flex max-h-[calc(100dvh-6rem)] w-[min(19rem,calc(100vw-3.5rem))] flex-col border border-white/10 bg-[#161616] shadow-[-12px_0_32px_rgba(0,0,0,0.55)] motion-safe:animate-[settings-flyout-in_0.18s_ease-out]"
        >
          {!flyoutHeaderHidden && (
            <div className="flex shrink-0 items-center border-b border-white/10 px-3 py-2.5">
              <p className={flyoutTitleClass}>{activeLabel}</p>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{renderSectionContent(active)}</div>
        </div>
      )}

      <nav className="flex flex-col gap-px py-0.5">
        {SECTIONS.map(({ id, label, railLabel, icon }) => (
          <RailMenuButton
            key={id}
            label={label}
            railLabel={railLabel}
            icon={icon}
            hint={sectionHint(id)}
            active={active === id}
            onClick={() => selectSection(id)}
          />
        ))}
      </nav>
    </div>
  );
}

function RailMenuButton({
  label,
  railLabel,
  icon,
  hint,
  active,
  onClick,
  compact = false,
}: {
  label: string;
  railLabel?: string;
  icon?: ChatSettingsRailIconId;
  hint?: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const title = hint ? `${label} · ${hint}` : label;
  const tone = active
    ? "text-white font-semibold"
    : "text-zinc-100 hover:text-white";

  if (compact) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        aria-pressed={active}
        className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 transition hover:bg-white/[0.06] ${tone} ${
          active ? "bg-white/[0.06]" : ""
        }`}
      >
        {icon && <ChatSettingsRailIcon id={icon} className="h-[18px] w-[18px]" />}
        <span className="text-[10px] font-medium leading-tight">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 transition hover:bg-white/[0.06] ${tone} ${
        active ? "bg-white/[0.06]" : ""
      }`}
    >
      {icon && <ChatSettingsRailIcon id={icon} className="h-4 w-4" />}
      <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
        {railLabel ?? label}
      </span>
    </button>
  );
}

function SettingsMiniLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 rounded border border-violet-500/30 px-2 py-0.5 text-[10px] text-violet-200/90 hover:bg-violet-500/10"
    >
      {children}
    </Link>
  );
}

function PersonaSection({
  chatId,
  personas,
  selectedPersonaId,
  onPersonaSelectedChange,
  selectedPersona,
  onPersonaUpdated,
  personaSecretBoundaryEnabled = false,
}: {
  chatId: number | null;
  personas: PersonaListItem[];
  selectedPersonaId: number | null;
  onPersonaSelectedChange: (id: number) => void;
  selectedPersona: PersonaListItem | null;
  onPersonaUpdated: (persona: PersonaListItem) => void;
  personaSecretBoundaryEnabled?: boolean;
}) {
  const [personaEditing, setPersonaEditing] = useState(false);
  const [personaRestoring, setPersonaRestoring] = useState(false);
  const personaSnapshotRef = useRef<PersonaListItem | null>(null);

  useEffect(() => {
    setPersonaEditing(false);
    personaSnapshotRef.current = null;
  }, [selectedPersona?.id]);

  async function cancelPersonaEdit() {
    const snap = personaSnapshotRef.current;
    if (snap && selectedPersona) {
      setPersonaRestoring(true);
      await restorePersonaSnapshot(snap, onPersonaUpdated);
      setPersonaRestoring(false);
    }
    setPersonaEditing(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SettingsMiniLink href="/persona#personas">관리</SettingsMiniLink>
      </div>
      <PersonaSelector
        chatId={chatId}
        personas={personas}
        selectedPersonaId={selectedPersonaId}
        onSelectedChange={onPersonaSelectedChange}
        variant="list"
      />
      {selectedPersona ? (
        <>
          <ChatPersonaEditor
            key={selectedPersona.id}
            persona={selectedPersona}
            onUpdated={onPersonaUpdated}
            editing={personaEditing}
            personaSecretBoundaryEnabled={personaSecretBoundaryEnabled}
          />
          <div className="flex justify-end gap-1.5">
            {personaEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => void cancelPersonaEdit()}
                  disabled={personaRestoring}
                  className="rounded-lg border border-white/10 px-3 py-1 text-[11px] text-zinc-400 hover:bg-white/5 disabled:opacity-40"
                >
                  {personaRestoring ? "복원 중…" : "취소"}
                </button>
                <button
                  type="button"
                  onClick={() => setPersonaEditing(false)}
                  className="rounded-lg border border-violet-500/40 px-3 py-1 text-[11px] text-violet-200 hover:bg-violet-500/10"
                >
                  완료
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  personaSnapshotRef.current = selectedPersona;
                  setPersonaEditing(true);
                }}
                className="rounded-lg border border-violet-500/30 px-3 py-1 text-[11px] text-violet-200/90 hover:bg-violet-500/10"
              >
                수정
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="text-center text-xs text-zinc-500">
          위 목록에서 페르소나를 선택하면 내용을 확인·수정할 수 있습니다.
        </p>
      )}
    </div>
  );
}

function NoteSection({
  chatId,
  userNote,
  onUserNoteChange,
  onSaveUserNote,
  notePresets,
  defaultUserNote,
  settingsSaving,
  widgetReservedChars = 0,
}: {
  chatId: number | null;
  userNote: string;
  onUserNoteChange: (value: string) => void;
  onSaveUserNote?: (note: string) => Promise<boolean | void>;
  notePresets: UserNotePresetItem[];
  defaultUserNote: string;
  settingsSaving?: boolean;
  widgetReservedChars?: number;
}) {
  const [noteDraft, setNoteDraft] = useState(userNote);
  const [linkedPresetId, setLinkedPresetId] = useState<number | null>(null);
  const [noteActionMsg, setNoteActionMsg] = useState("");
  const prevChatIdRef = useRef(chatId);

  const savedFocus = extractFocusZoneNote(userNote);
  const savedReference = getReferenceBodyFromNote(userNote);
  const draftFocus = extractFocusZoneNote(noteDraft);
  const draftReference = getReferenceBodyFromNote(noteDraft);
  const focusDirty = draftFocus !== savedFocus;
  const referenceDirty = draftReference !== savedReference;

  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      setNoteDraft(userNote);
      setLinkedPresetId(null);
      setNoteActionMsg("");
      return;
    }
    if (!focusDirty && !referenceDirty) {
      setNoteDraft(userNote);
    }
  }, [chatId, userNote, focusDirty, referenceDirty]);

  function mergeReferenceIntoSavedNote(saved: string, draft: string): string {
    const savedBody = parseUserNoteCombined(saved).body;
    const draftBody = parseUserNoteCombined(draft).body;
    const { focusBody } = splitUserNoteBodyForEditor(savedBody, widgetReservedChars);
    const { referenceBody } = splitUserNoteBodyForEditor(draftBody, widgetReservedChars);
    return mergeUserNoteBodyFromEditor(focusBody, referenceBody, widgetReservedChars);
  }

  async function saveReferenceEdit() {
    setNoteActionMsg("");
    const merged = mergeReferenceIntoSavedNote(userNote, noteDraft);
    const ok = await commitChatSave(
      merged,
      chatId != null ? "참조 구간이 이 방에 저장되었습니다." : "참조 구간이 적용되었습니다."
    );
    if (ok) setNoteDraft(merged);
  }

  function loadPreset(preset: UserNotePresetItem, skipConfirm = false) {
    const currentFocus = extractFocusZoneNote(noteDraft).trim();
    const incomingFocus = extractFocusZoneNote(preset.content).trim();
    if (
      !skipConfirm &&
      currentFocus &&
      currentFocus !== incomingFocus &&
      !window.confirm(
        `「${preset.title}」 고집중 구간을 불러올까요? 참조 구간은 이 방 내용을 유지합니다.`
      )
    ) {
      return;
    }
    const merged = mergePresetFocusIntoChatNote(preset.content, noteDraft);
    setNoteDraft(merged);
    setLinkedPresetId(preset.id);
    setNoteActionMsg(`「${preset.title}」을(를) 불러왔습니다. 「저장」으로 적용하세요.`);
  }

  async function commitChatSave(fullNote: string, message: string) {
    const noteCheck = validateUserNoteCombined(fullNote, widgetReservedChars);
    if (!noteCheck.ok) {
      setNoteActionMsg(noteCheck.error);
      return false;
    }
    const saved = onSaveUserNote ? await onSaveUserNote(fullNote) : true;
    if (saved === false) return false;
    onUserNoteChange(fullNote);
    setNoteDraft(fullNote);
    setNoteActionMsg(message);
    window.setTimeout(() => setNoteActionMsg(""), 3200);
    return true;
  }

  async function saveFocusToRoom() {
    const merged = replaceFocusZoneInNote(userNote, noteDraft);
    const focusCheck = validateUserNoteFocusPreset(extractFocusZoneNote(merged));
    if (!focusCheck.ok) {
      setNoteActionMsg(focusCheck.error);
      return;
    }
    setNoteActionMsg("");
    const ok = await commitChatSave(
      merged,
      chatId != null
        ? "고집중 구간이 이 방에 저장되었습니다."
        : "적용되었습니다. 첫 메시지 전송 시 함께 저장됩니다."
    );
    if (ok) setNoteDraft(merged);
  }

  const focusFooter = (
    <div className="flex flex-wrap justify-end gap-1.5 pt-1">
      <button
        type="button"
        onClick={() => void saveFocusToRoom()}
        disabled={!focusDirty || settingsSaving}
        className="rounded border border-amber-400/50 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
      >
        {settingsSaving ? "저장 중…" : "저장"}
      </button>
    </div>
  );

  const referenceFooter = (
    <div className="flex justify-end gap-1.5 pt-1">
      <button
        type="button"
        onClick={() => void saveReferenceEdit()}
        disabled={!referenceDirty || settingsSaving}
        className="rounded border border-violet-400/50 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-500/25 disabled:opacity-40"
      >
        {settingsSaving ? "저장 중…" : "저장"}
      </button>
    </div>
  );

  return (
    <div className="space-y-3 text-xs">
      {chatId == null && (
        <p className="text-[10px] text-amber-400/90">첫 메시지 전송 시 이 방 설정이 함께 저장됩니다.</p>
      )}
      {settingsSaving && (
        <p className="text-[10px] text-zinc-500">저장 중…</p>
      )}
      {noteActionMsg && (
        <p className="text-[10px] text-violet-300/90">{noteActionMsg}</p>
      )}

      <div className="space-y-2 rounded-lg border border-white/10 bg-[#121218] p-2.5">
        <p className="text-[11px] font-semibold text-zinc-300">불러오기</p>
        <div className="flex flex-wrap items-center gap-2">
          {notePresets.length > 0 ? (
            <div className="min-w-0 flex-1">
              <UserNotePresetPicker
                presets={notePresets}
                selectedPresetId={linkedPresetId}
                onSelect={(preset) => loadPreset(preset)}
                disabled={settingsSaving}
              />
            </div>
          ) : (
            <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-zinc-500">
              저장된 유저 노트가 없습니다. 페르소나 페이지에서 추가하세요.
            </p>
          )}
          <Link
            href="/persona#user-note-presets"
            className="shrink-0 rounded border border-violet-500/35 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200 hover:bg-violet-500/15"
          >
            유저노트 관리
          </Link>
        </div>
      </div>

      {(focusDirty || referenceDirty) && (
        <p className="text-[10px] text-amber-400/80">
          변경 내용이 있습니다. 각 구간 하단의 「저장」을 눌러 이 대화방에 적용하세요.
        </p>
      )}
      <UserNoteSplitEditor
        userNote={noteDraft}
        onUserNoteChange={setNoteDraft}
        defaultUserNote={defaultUserNote}
        focusRows={7}
        referenceRows={9}
        editingFocus
        widgetReservedChars={widgetReservedChars}
        focusFooter={focusFooter}
        referenceFooter={referenceFooter}
      />
    </div>
  );
}

function DisplaySection({
  chatId,
  contentKind,
  narrativePov,
  onNarrativePovChange,
  characterWidgetJson,
  statusWidgetMode,
  statusWidgetDisplayMode = null,
  userWidgetJson,
  characterWidgetAllowUserOverride,
  statusWidgetPresets,
  onStatusWidgetSaved,
  onStatusWidgetDraftChange,
  displayPrefs,
  onDisplayPrefsChange,
  onSaveDisplaySettings,
  displaySettingsSaving = false,
}: {
  chatId: number | null;
  contentKind: "character" | "simulation";
  narrativePov: NarrativePov;
  onNarrativePovChange: (value: NarrativePov) => void;
  characterWidgetJson: string;
  statusWidgetMode: StatusWidgetSourceMode;
  statusWidgetDisplayMode?: StatusWidgetDisplayMode | null;
  userWidgetJson: string;
  characterWidgetAllowUserOverride: boolean;
  statusWidgetPresets: StatusWidgetPresetItem[];
  onStatusWidgetSaved: (saved: {
    mode: StatusWidgetSourceMode;
    displayMode: StatusWidgetDisplayMode;
    userWidgetJson: string;
  }) => void;
  onStatusWidgetDraftChange: (draft: {
    mode: StatusWidgetSourceMode;
    displayMode: StatusWidgetDisplayMode;
    userWidgetJson: string;
  }) => void;
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
  onSaveDisplaySettings?: () => Promise<boolean | void>;
  displaySettingsSaving?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5">
        {contentKind === "character" && (
          <NarrativePovSection
            narrativePov={narrativePov}
            onNarrativePovChange={onNarrativePovChange}
          />
        )}
        <StatusWidgetChatSettings
          chatId={chatId}
          characterWidgetJson={characterWidgetJson}
          initialMode={statusWidgetMode}
          initialDisplayMode={statusWidgetDisplayMode}
          initialUserWidgetJson={userWidgetJson}
          allowUserOverride={characterWidgetAllowUserOverride}
          statusWidgetPresets={statusWidgetPresets}
          onSaved={onStatusWidgetSaved}
          onDraftChange={onStatusWidgetDraftChange}
        />
        <div className="border-t border-white/10 pt-1">
          <DisplaySettingsSection
            displayPrefs={displayPrefs}
            onDisplayPrefsChange={onDisplayPrefsChange}
          />
        </div>
      </div>
      <div className="sticky bottom-0 -mx-3 mt-4 border-t border-violet-500/20 bg-[#161616] px-3 pb-1 pt-3">
        <p className="mb-2 text-center text-[10px] leading-relaxed text-zinc-500">
          분량·글꼴·색·스트리밍 — <strong className="text-zinc-400">계정 공통</strong>{" "}
          (모든 대화방)
        </p>
        <button
          type="button"
          disabled={displaySettingsSaving || !onSaveDisplaySettings}
          onClick={() => void onSaveDisplaySettings?.()}
          className="w-full rounded-xl border border-violet-500/50 bg-gradient-to-r from-violet-600/30 to-violet-500/20 py-3.5 text-sm font-bold tracking-wide text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.15)] transition hover:from-violet-600/40 hover:to-violet-500/30 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {displaySettingsSaving ? "저장 중…" : "채팅 설정 저장"}
        </button>
      </div>
    </div>
  );
}

function NarrativePovSection({
  narrativePov,
  onNarrativePovChange,
}: {
  narrativePov: NarrativePov;
  onNarrativePovChange: (value: NarrativePov) => void;
}) {
  const fieldId = useId();
  const radioName = `narrative-pov-${fieldId}`;

  return (
    <section className="space-y-2 border-b border-white/10 pb-5 text-xs">
      <div>
        <p className="font-bold text-violet-300">서술 시점</p>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">이 대화방의 다음 AI 답변부터 적용됩니다.</p>
      </div>
      <label className={`block cursor-pointer rounded-lg border p-3 transition ${narrativePov === "third_person" ? "border-violet-400/55 bg-violet-500/10" : "border-white/10 bg-[#121218] hover:border-white/20"}`}>
        <span className="flex gap-2">
          <input type="radio" name={radioName} checked={narrativePov === "third_person"} onChange={() => onNarrativePovChange("third_person")} className="mt-0.5 accent-violet-500" />
          <span>
            <strong className="block text-zinc-200">3인칭 소설형</strong>
            <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">여러 캐릭터와 사건을 자유롭게 오가며 소설처럼 서술합니다. <span className="text-violet-300">추천·기본값</span></span>
          </span>
        </span>
      </label>
      <label className={`block cursor-pointer rounded-lg border p-3 transition ${narrativePov === "first_person" ? "border-violet-400/55 bg-violet-500/10" : "border-white/10 bg-[#121218] hover:border-white/20"}`}>
        <span className="flex gap-2">
          <input type="radio" name={radioName} checked={narrativePov === "first_person"} onChange={() => onNarrativePovChange("first_person")} className="mt-0.5 accent-violet-500" />
          <span>
            <strong className="block text-zinc-200">1인칭 몰입형</strong>
            <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">한 캐릭터의 눈으로 장면을 경험합니다. 해당 캐릭터가 나의 시점으로 서술합니다.</span>
          </span>
        </span>
      </label>
    </section>
  );
}

function DisplaySettingsSection({
  displayPrefs,
  onDisplayPrefsChange,
}: {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
}) {
  const inputCls =
    "w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/40";

  return (
    <div className="space-y-5 text-xs">
      <ChatPortraitPrefs
        displayPrefs={displayPrefs}
        onDisplayPrefsChange={onDisplayPrefsChange}
      />

      <section>
        <p className="mb-2 font-bold text-violet-300">스트리밍 속도</p>
        <p className="mb-2 text-[10px] text-zinc-600">
          AI 답변이 화면에 나타나는 속도 · 즉시(0ms) ~ {STREAM_INTERVAL_MAX}ms · 20ms 단위 · 설정한
          간격으로 일정하게 표시 (읽기 따라가기용)
        </p>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>글자 간격</span>
            <span>{formatStreamIntervalLabel(displayPrefs.streamIntervalMs)}</span>
          </span>
          <input
            type="range"
            min={STREAM_INTERVAL_MIN}
            max={STREAM_INTERVAL_MAX}
            step={STREAM_INTERVAL_STEP}
            value={displayPrefs.streamIntervalMs}
            onChange={(e) =>
              onDisplayPrefsChange(withStreamSpeed(displayPrefs, Number(e.target.value)))
            }
            className="w-full accent-violet-500"
          />
          <span className="mt-1 flex justify-between text-[10px] text-zinc-600">
            <span>즉시</span>
            <span>느리게 ({STREAM_INTERVAL_MAX}ms)</span>
          </span>
        </label>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">글자 크기</p>
        <p className="mb-2 text-[10px] text-zinc-600">
          화면 크기에 맞춘 기본값 위에서 조절 · 변경 즉시 반영 (이 기기)
        </p>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>크기</span>
            <span>{fontSizePresetLabel(displayPrefs.fontSizePreset)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={CHAT_FONT_SIZE_PRESETS.length - 1}
            step={1}
            value={fontSizePresetIndex(displayPrefs.fontSizePreset)}
            onChange={(e) =>
              onDisplayPrefsChange({
                ...displayPrefs,
                fontSizePreset: fontSizePresetFromIndex(Number(e.target.value)),
              })
            }
            className="w-full accent-violet-500"
          />
          <span className="mt-1 flex justify-between text-[10px] text-zinc-600">
            {CHAT_FONT_SIZE_PRESETS.map((p) => (
              <span key={p.id}>{p.label}</span>
            ))}
          </span>
        </label>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">글꼴</p>
        <select
          value={displayPrefs.fontFamily}
          onChange={(e) => onDisplayPrefsChange({ ...displayPrefs, fontFamily: e.target.value })}
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/50"
        >
          {CHAT_FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">글자 색 · 캐릭터</p>
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">지문</span>
            <input
              type="color"
              value={displayPrefs.narrationColor}
              onChange={(e) => onDisplayPrefsChange({ ...displayPrefs, narrationColor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">대사</span>
            <input
              type="color"
              value={displayPrefs.dialogueColor}
              onChange={(e) => onDisplayPrefsChange({ ...displayPrefs, dialogueColor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
        </div>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">글자 색 · 유저</p>
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">지문</span>
            <input
              type="color"
              value={displayPrefs.userNarrationColor}
              onChange={(e) =>
                onDisplayPrefsChange({ ...displayPrefs, userNarrationColor: e.target.value })
              }
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">대사</span>
            <input
              type="color"
              value={displayPrefs.userDialogueColor}
              onChange={(e) =>
                onDisplayPrefsChange({ ...displayPrefs, userDialogueColor: e.target.value })
              }
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
        </div>
      </section>

      <button
        type="button"
        onClick={() => onDisplayPrefsChange({ ...DEFAULT_CHAT_DISPLAY_PREFS })}
        className="w-full rounded-lg border border-white/10 py-2 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      >
        표시 설정 초기화
      </button>
    </div>
  );
}

function MemoryHistoryPager({
  page,
  pageCount,
  disabled,
  onPageChange,
  className = "",
}: {
  page: number;
  pageCount: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const atNewest = page <= 0;
  const atOldest = page >= pageCount - 1;

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border border-white/5 bg-[#121212]/60 px-2 py-1.5 ${className}`}
    >
      <button
        type="button"
        disabled={disabled || atNewest}
        onClick={() => onPageChange(page - 1)}
        className="rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ◀ 최신
      </button>
      <span className="text-[10px] text-zinc-500">
        {page + 1} / {pageCount}
        <span className="ml-1 text-zinc-600">(페이지당 {MEMORY_HISTORY_PAGE_SIZE}개)</span>
      </span>
      <button
        type="button"
        disabled={disabled || atOldest}
        onClick={() => onPageChange(page + 1)}
        className="rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
      >
        과거 ▶
      </button>
    </div>
  );
}

function MemorySection({
  chatId,
  data,
  loading,
  refreshing = false,
  error,
  onDataChange,
  relationshipMetaDock,
}: {
  chatId: number | null;
  data: MemoryData | null;
  loading: boolean;
  refreshing?: boolean;
  error: string;
  onDataChange: React.Dispatch<React.SetStateAction<MemoryData | null>>;
  relationshipMetaDock?: ReactNode;
}) {
  const [lorebookDraft, setLorebookDraft] = useState("");
  const [recordDrafts, setRecordDrafts] = useState<Record<number, string>>({});
  const [savingRecordId, setSavingRecordId] = useState<number | null>(null);
  const [regeneratingRecordId, setRegeneratingRecordId] = useState<number | null>(null);
  const [savingLorebook, setSavingLorebook] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [lorebookEditing, setLorebookEditing] = useState(false);
  const lorebookTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const recordTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [historyPage, setHistoryPage] = useState(0);

  const reversedMemoryRecords = useMemo(
    () => [...(data?.memoryRecords ?? [])].reverse(),
    [data?.memoryRecords]
  );
  const historyPageCount = Math.max(
    1,
    Math.ceil(reversedMemoryRecords.length / MEMORY_HISTORY_PAGE_SIZE)
  );
  const safeHistoryPage = Math.min(historyPage, historyPageCount - 1);
  const historyPageRecords = reversedMemoryRecords.slice(
    safeHistoryPage * MEMORY_HISTORY_PAGE_SIZE,
    safeHistoryPage * MEMORY_HISTORY_PAGE_SIZE + MEMORY_HISTORY_PAGE_SIZE
  );
  const historyRangeStart =
    reversedMemoryRecords.length === 0
      ? 0
      : safeHistoryPage * MEMORY_HISTORY_PAGE_SIZE + 1;
  const historyRangeEnd = Math.min(
    reversedMemoryRecords.length,
    (safeHistoryPage + 1) * MEMORY_HISTORY_PAGE_SIZE
  );

  useEffect(() => {
    setHistoryPage((page) => Math.min(page, Math.max(0, historyPageCount - 1)));
  }, [historyPageCount]);

  useEffect(() => {
    if (!data) return;
    setLorebookDraft(data.lorebook ?? data.recentSummary ?? "");
    setLorebookEditing(false);
    setEditingRecordId(null);
    const drafts: Record<number, string> = {};
    for (const r of data.memoryRecords ?? []) {
      drafts[r.id] = r.summary;
    }
    setRecordDrafts(drafts);
  }, [data]);

  if (chatId == null) {
    return <p className="text-center text-xs text-zinc-500">첫 메시지를 보내면 기억이 쌓입니다.</p>;
  }

  if (loading && !data) {
    return <p className="text-xs text-zinc-500">기억 불러오는 중…</p>;
  }
  if (error && !data) return <p className="text-xs text-rose-400">{error}</p>;
  if (!data) return null;

  const pct = data ? Math.min(100, Math.round((data.longTermChars / data.limit) * 100)) : 0;
  const lorebookMax = data?.memoryCapacity ?? data?.limit ?? MEMORY_CAPACITY_DEFAULT;

  async function refreshMemoryPanel() {
    if (chatId == null) return;
    const res = await fetch(`/api/chat/memory?chatId=${chatId}`, {
      signal: AbortSignal.timeout(MEMORY_FETCH_TIMEOUT_MS),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? "새로고침 실패");
    onDataChange(j as MemoryData);
  }

  async function saveLorebook() {
    if (chatId == null) return;
    setSavingLorebook(true);
    setActionMsg("");
    try {
      const res = await fetch("/api/chat/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, action: "updateLorebook", lorebook: lorebookDraft }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "저장 실패");
      const saved = j.lorebook ?? j.recentSummary ?? lorebookDraft;
      setLorebookDraft(saved);
      onDataChange((prev) =>
        prev
          ? {
              ...prev,
              lorebook: saved,
              recentSummary: saved,
              longTermChars: j.usedChars ?? prev.longTermChars,
            }
          : prev
      );
      setActionMsg("장기기억 수정이 저장되었습니다.");
      setLorebookEditing(false);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setSavingLorebook(false);
    }
  }

  async function saveMemoryRecord(recordId: number) {
    if (chatId == null) return;
    const draft = recordDrafts[recordId] ?? "";
    setSavingRecordId(recordId);
    setActionMsg("");
    try {
      const res = await fetch("/api/chat/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, action: "updateMemoryRecord", recordId, summary: draft }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "저장 실패");
      const updated = j.memoryRecord as MemoryRecordItem;
      onDataChange((prev) =>
        prev
          ? {
              ...prev,
              memoryRecords: prev.memoryRecords?.map((r) =>
                r.id === recordId
                  ? {
                      ...r,
                      summary: updated.summary,
                      userEdited: updated.userEdited,
                      charCount: updated.charCount,
                    }
                  : r
              ),
            }
          : prev
      );
      setActionMsg(`${updated.turnRangeLabel} 기억 기록이 저장되었습니다.`);
      setEditingRecordId(null);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setSavingRecordId(null);
    }
  }

  async function regenerateMemoryRecord(recordId: number) {
    if (chatId == null) return;
    setRegeneratingRecordId(recordId);
    setActionMsg("");
    try {
      const res = await fetch("/api/chat/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, action: "regenerateMemoryRecord", recordId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "재생성 실패");
      const updated = j.memoryRecord as MemoryRecordItem;
      onDataChange((prev) =>
        prev
          ? {
              ...prev,
              memoryRecords: prev.memoryRecords?.map((r) =>
                r.id === recordId ? { ...r, ...updated, isFallbackSummary: false } : r
              ),
            }
          : prev
      );
      setRecordDrafts((prev) => ({ ...prev, [recordId]: updated.summary }));
      setActionMsg(`${updated.turnRangeLabel} 요약을 다시 생성했습니다.`);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setRegeneratingRecordId(null);
    }
  }

  if (loading && !data) {
    return <p className="text-xs text-zinc-500">기억 불러오는 중…</p>;
  }
  if (error && !data) return <p className="text-xs text-rose-400">{error}</p>;
  if (!data) return null;

  const savedLorebook = data.lorebook ?? data.recentSummary ?? "";
  const lorebookDirty = lorebookDraft !== savedLorebook;

  function startLorebookEdit() {
    setLorebookEditing(true);
    window.requestAnimationFrame(() => lorebookTextareaRef.current?.focus());
  }

  function cancelLorebookEdit() {
    setLorebookDraft(savedLorebook);
    setLorebookEditing(false);
  }

  return (
    <div className="space-y-4 text-xs">
      {refreshing && (
        <p className="text-[10px] text-zinc-600">백그라운드 동기화 중…</p>
      )}
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-violet-300">장기기억</span>
          {relationshipMetaDock ? (
            <div className="shrink-0">{relationshipMetaDock}</div>
          ) : null}
        </div>
        {data.messagesUntilCompression > 0 && (
          <p className="mb-1 text-[10px] text-violet-400/80">
            다음 기억 기록까지 {data.messagesUntilCompression}턴 남음 ({ROLLING_SUMMARY_INTERVAL}턴마다 자동 생성)
          </p>
        )}
        {data.messagesUntilCompression === 0 && data.totalTurns >= ROLLING_SUMMARY_INTERVAL && (
          <p className="mb-1 text-[10px] text-violet-400/80">
            {ROLLING_SUMMARY_INTERVAL}턴 기억 기록·장기기억 갱신 중…
          </p>
        )}
        <div className="mb-2 h-1 overflow-hidden rounded bg-white/5">
          <div className="h-full bg-violet-500/70" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-zinc-600">
          사용 {data.longTermChars.toLocaleString()} / {lorebookMax.toLocaleString()}자
        </p>
      </div>

      <div className="rounded-lg border border-violet-500/20 bg-violet-950/10 p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-bold text-violet-200/90">저장된 장기기억</span>
          <span className="text-[9px] text-zinc-500">
            {lorebookDraft.length.toLocaleString()} / {lorebookMax.toLocaleString()}자
          </span>
        </div>
        {lorebookEditing ? (
          <textarea
            ref={lorebookTextareaRef}
            value={lorebookDraft}
            onChange={(e) => setLorebookDraft(e.target.value)}
            rows={6}
            maxLength={lorebookMax}
            placeholder="대화가 진행되면 히스토리가 자동으로 쌓입니다."
            className="max-h-48 w-full resize-none overflow-y-auto rounded-md border border-white/10 bg-[#1a1a1a] p-2 text-[11px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
          />
        ) : (
          <div
            className={`max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed scrollbar-hide ${
              lorebookDraft.trim() ? "text-zinc-300" : "text-zinc-600"
            }`}
          >
            {lorebookDraft.trim() || "대화가 진행되면 히스토리가 자동으로 쌓입니다."}
          </div>
        )}
        <div className="mt-2 flex justify-end gap-1.5">
          {lorebookEditing ? (
            <>
              <button
                type="button"
                onClick={cancelLorebookEdit}
                disabled={savingLorebook}
                className="rounded-lg border border-white/10 px-3 py-1 text-[11px] text-zinc-400 hover:bg-white/5 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveLorebook()}
                disabled={savingLorebook || !lorebookDirty}
                className="rounded-lg border border-violet-500/40 px-3 py-1 text-[11px] text-violet-200 hover:bg-violet-500/10 disabled:opacity-40"
              >
                {savingLorebook ? "저장 중…" : "저장"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startLorebookEdit}
              className="rounded-lg border border-violet-500/30 px-3 py-1 text-[11px] text-violet-200/90 hover:bg-violet-500/10"
            >
              수정
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-violet-500/20 bg-violet-950/10 p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-bold text-violet-200/90">
            히스토리 ({ROLLING_SUMMARY_INTERVAL}턴마다)
          </span>
          <span className="text-[9px] text-zinc-500">
            {reversedMemoryRecords.length > 0
              ? `${historyRangeStart}–${historyRangeEnd} / ${reversedMemoryRecords.length}개`
              : `최대 ${data.memoryRecordMaxChars ?? 600}자`}
          </span>
        </div>
        {(data.memoryRecords?.length ?? 0) === 0 ? (
          <p className="text-[10px] text-zinc-600">
            {data.totalTurns >= ROLLING_SUMMARY_INTERVAL
              ? "기억 기록을 생성 중입니다. 잠시 후 패널을 다시 열어 주세요."
              : data.totalTurns > 0
                ? `다음 기억 기록까지 ${data.messagesUntilCompression}턴 남았습니다.`
                : `대화를 시작하면 ${ROLLING_SUMMARY_INTERVAL}턴마다 기억 기록이 쌓입니다.`}
          </p>
        ) : (
          <>
            {historyPageCount > 1 && (
              <MemoryHistoryPager
                page={safeHistoryPage}
                pageCount={historyPageCount}
                disabled={editingRecordId != null}
                onPageChange={setHistoryPage}
              />
            )}
            <div className="space-y-2">
              {historyPageRecords.map((r) => {
              const draft = recordDrafts[r.id] ?? r.summary;
              const minChars = data.memoryRecordMinChars ?? 400;
              const maxChars = data.memoryRecordMaxChars ?? 600;
              const dirty = draft !== r.summary;
              const isEditing = editingRecordId === r.id;

              return (
                <div
                  key={r.id}
                  className="rounded-md border border-white/10 bg-[#1a1a1a]/80 p-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-violet-300">
                      {r.turnRangeLabel}
                      {r.scopeLabel && (
                        <span className="ml-1.5 font-normal text-zinc-400">· {r.scopeLabel}</span>
                      )}
                      {r.branchStatus === "closed" && (
                        <span className="ml-1 font-normal text-zinc-500">· 종료</span>
                      )}
                      {r.isFallbackSummary && (
                        <span className="ml-1.5 font-normal text-amber-400/90">· 임시 기록</span>
                      )}
                    </span>
                    <span className="text-[9px] text-zinc-500">
                      {draft.length}/{maxChars}자
                      {r.userEdited && <span className="ml-1 text-emerald-400/80">· 수정됨</span>}
                    </span>
                  </div>
                  {isEditing ? (
                    <textarea
                      ref={editingRecordId === r.id ? recordTextareaRef : undefined}
                      value={draft}
                      minLength={minChars}
                      maxLength={maxChars}
                      rows={4}
                      onChange={(e) =>
                        setRecordDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      className="max-h-36 w-full resize-none overflow-y-auto rounded border border-white/10 bg-[#121212] p-2 text-[11px] leading-relaxed text-zinc-200 focus:border-violet-500/40 focus:outline-none"
                    />
                  ) : (
                    <div className="line-clamp-4 max-h-20 overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">
                      {draft}
                    </div>
                  )}
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRecordDrafts((prev) => ({ ...prev, [r.id]: r.summary }));
                            setEditingRecordId(null);
                          }}
                          disabled={savingRecordId === r.id}
                          className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 disabled:opacity-40"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveMemoryRecord(r.id)}
                          disabled={!dirty || savingRecordId === r.id}
                          className="rounded border border-violet-500/40 px-2 py-0.5 text-[10px] text-violet-200 hover:bg-violet-500/10 disabled:opacity-40"
                        >
                          {savingRecordId === r.id ? "저장 중…" : "저장"}
                        </button>
                      </>
                    ) : (
                      <>
                        {r.isFallbackSummary && !r.userEdited && (
                          <button
                            type="button"
                            onClick={() => void regenerateMemoryRecord(r.id)}
                            disabled={
                              regeneratingRecordId === r.id ||
                              editingRecordId != null ||
                              savingRecordId != null
                            }
                            className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-200/90 hover:bg-amber-500/10 disabled:opacity-40"
                          >
                            {regeneratingRecordId === r.id ? "재생성 중…" : "요약 재생성"}
                          </button>
                        )}
                        {(r.summaryKind === "noncanon" || r.summaryKind === "branch_canon") && (
                          <>
                            {r.summaryKind === "noncanon" && (
                              <button
                                type="button"
                                onClick={() =>
                                  void (async () => {
                                    await fetch("/api/chat/memory", {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        chatId,
                                        action: "continueBranch",
                                        recordId: r.id,
                                      }),
                                    });
                                    await refreshMemoryPanel();
                                  })()
                                }
                                className="rounded border border-sky-500/30 px-2 py-0.5 text-[10px] text-sky-200/90 hover:bg-sky-500/10"
                              >
                                이어서 진행
                              </button>
                            )}
                            {r.summaryKind === "branch_canon" &&
                              r.branchStatus === "closed" && (
                              <button
                                type="button"
                                onClick={() =>
                                  void (async () => {
                                    await fetch("/api/chat/memory", {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        chatId,
                                        action: "reopenBranch",
                                        recordId: r.id,
                                      }),
                                    });
                                    await refreshMemoryPanel();
                                  })()
                                }
                                className="rounded border border-sky-500/30 px-2 py-0.5 text-[10px] text-sky-200/90 hover:bg-sky-500/10"
                              >
                                다시 이어가기
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                void (async () => {
                                  await fetch("/api/chat/memory", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      chatId,
                                      action: "adoptMainCanon",
                                      recordId: r.id,
                                    }),
                                  });
                                  await refreshMemoryPanel();
                                })()
                              }
                              className="rounded border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-200/90 hover:bg-emerald-500/10"
                            >
                              본편으로 반영
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void (async () => {
                                  await fetch("/api/chat/memory", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      chatId,
                                      action: "keepNoncanon",
                                      recordId: r.id,
                                    }),
                                  });
                                  await refreshMemoryPanel();
                                })()
                              }
                              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5"
                            >
                              비정사 유지
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void (async () => {
                              if (!window.confirm("이 기억 기록을 삭제할까요?")) return;
                              await fetch("/api/chat/memory", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  chatId,
                                  action: "deleteMemoryRecord",
                                  recordId: r.id,
                                }),
                              });
                              await refreshMemoryPanel();
                            })()
                          }
                          className="rounded border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300/90 hover:bg-rose-500/10"
                        >
                          삭제
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRecordId(r.id);
                            window.requestAnimationFrame(() => recordTextareaRef.current?.focus());
                          }}
                          disabled={regeneratingRecordId === r.id}
                          className="rounded border border-violet-500/30 px-2 py-0.5 text-[10px] text-violet-200/90 hover:bg-violet-500/10 disabled:opacity-40"
                        >
                          수정
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
            {historyPageCount > 1 && (
              <MemoryHistoryPager
                page={safeHistoryPage}
                pageCount={historyPageCount}
                disabled={editingRecordId != null}
                onPageChange={setHistoryPage}
                className="mt-2"
              />
            )}
          </>
        )}
      </div>

      {data.archiveSummary.trim() && (
        <div className="rounded-lg border border-white/5 bg-[#1a1a1a] p-2.5">
          <p className="mb-1 font-bold text-zinc-400">아카이브 (키워드 매칭 시 주입)</p>
          <p className="whitespace-pre-wrap leading-relaxed text-zinc-500">{data.archiveSummary}</p>
        </div>
      )}

      {!data.recentSummary.trim() && !data.archiveSummary.trim() && (
        <p className="whitespace-pre-wrap leading-relaxed text-zinc-500">
          {data.totalTurns > 0
            ? `${ROLLING_SUMMARY_INTERVAL}턴마다 히스토리가 생성되어 현재기억에 누적됩니다.`
            : "대화를 시작하면 히스토리가 현재기억에 자동으로 쌓입니다."}
        </p>
      )}

      <p className="text-[10px] text-zinc-600">전체 대화 {data.totalTurns}턴 · 캐릭터 공유 기억</p>

      {actionMsg && (
        <p className={`text-[10px] ${actionMsg.includes("실패") || actionMsg.includes("오류") ? "text-rose-400" : "text-violet-400/90"}`}>
          {actionMsg}
        </p>
      )}
    </div>
  );
}
