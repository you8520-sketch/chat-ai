"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  characterStatusWidgetOrDefault,
  displayModeFromEngineMode,
  displayModeFromVisibilityToggles,
  displayModeFromUserChoice,
  displayVisibilityFromMode,
  hasCharacterStatusWidget,
  formatCombinedWidgetBudgetHint,
  STATUS_WIDGET_CONTEXT_MAX,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetJson,
  resolveStatusWidgetReservedBreakdown,
  serializeStatusWidget,
  statusWidgetModeFromToggles,
  statusWidgetTogglesFromMode,
  type StatusWidget,
  type StatusWidgetDisplayMode,
  type StatusWidgetSourceMode,
} from "@/lib/statusWidget";
import type { StatusWidgetPresetItem } from "@/lib/statusWidgetPresetTypes";

type Props = {
  chatId: number | null;
  characterWidgetJson: string;
  initialMode: StatusWidgetSourceMode;
  initialDisplayMode?: StatusWidgetDisplayMode | null;
  initialUserWidgetJson: string;
  allowUserOverride: boolean;
  statusWidgetPresets?: StatusWidgetPresetItem[];
  onSaved?: (saved: {
    mode: StatusWidgetSourceMode;
    displayMode: StatusWidgetDisplayMode;
    userWidgetJson: string;
  }) => void;
  onDraftChange?: (draft: {
    mode: StatusWidgetSourceMode;
    displayMode: StatusWidgetDisplayMode;
    userWidgetJson: string;
  }) => void;
};

function ToggleRow({
  label,
  trackingOn,
  trackingDisabled,
  trackingHint,
  displayOn,
  displayDisabled,
  displayHint,
  onTrackingChange,
  onDisplayChange,
  layout,
}: {
  label: string;
  trackingOn: boolean;
  trackingDisabled: boolean;
  trackingHint: string;
  displayOn: boolean;
  displayDisabled: boolean;
  displayHint: string;
  onTrackingChange: (next: boolean) => void;
  onDisplayChange: (next: boolean) => void;
  layout: "table" | "card";
}) {
  const trackingControl = (
    <label
      className={`inline-flex items-center gap-2 ${trackingDisabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={trackingOn}
        disabled={trackingDisabled}
        onChange={(e) => onTrackingChange(e.target.checked)}
      />
      <span className="text-[10px] font-semibold text-zinc-300">{trackingOn ? "ON" : "OFF"}</span>
    </label>
  );

  const displayControl = (
    <label
      className={`inline-flex items-center gap-2 ${displayDisabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={displayOn}
        disabled={displayDisabled}
        onChange={(e) => onDisplayChange(e.target.checked)}
      />
      <span className="text-[10px] font-semibold text-zinc-300">{displayOn ? "ON" : "OFF"}</span>
    </label>
  );

  if (layout === "card") {
    return (
      <div className="rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2.5">
        <p className="text-xs font-semibold text-zinc-100">{label}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-semibold text-zinc-400">상태 추적</p>
            <div className="mt-1">{trackingControl}</div>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{trackingHint}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-zinc-400">화면 표시</p>
            <div className="mt-1">{displayControl}</div>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{displayHint}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-start gap-2 border-b border-white/5 px-3 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-zinc-100">{label}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{trackingHint}</p>
      </div>
      <div className="flex justify-center pt-0.5">{trackingControl}</div>
      <div className="flex justify-center pt-0.5">{displayControl}</div>
    </div>
  );
}

export default function StatusWidgetChatSettings({
  chatId,
  characterWidgetJson,
  initialMode,
  initialDisplayMode = null,
  initialUserWidgetJson,
  allowUserOverride,
  statusWidgetPresets = [],
  onSaved,
  onDraftChange,
}: Props) {
  const hasCharacterWidget = hasCharacterStatusWidget(characterWidgetJson);

  const [engineMode, setEngineMode] = useState<StatusWidgetSourceMode>(initialMode);
  const [displayMode, setDisplayMode] = useState<StatusWidgetDisplayMode>(() => {
    if (initialDisplayMode) return initialDisplayMode;
    return displayModeFromEngineMode(initialMode);
  });
  const [userWidget, setUserWidget] = useState<StatusWidget>(() =>
    parseStatusWidgetJson(initialUserWidgetJson) ??
      characterStatusWidgetOrDefault(characterWidgetJson)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [linkedPresetId, setLinkedPresetId] = useState<number | null>(null);

  const hasUserWidget = Boolean(parseStatusWidgetJson(serializeStatusWidget(userWidget)));
  const userSourceAvailable = allowUserOverride && hasUserWidget;
  const engineToggles = statusWidgetTogglesFromMode(engineMode);
  const displayVisibility = displayVisibilityFromMode(displayMode);

  const effectiveDisplay = useMemo(
    () =>
      displayModeFromUserChoice({
        hasCharacterWidget,
        hasUserWidget: userSourceAvailable,
        preference: displayMode,
      }),
    [hasCharacterWidget, userSourceAvailable, displayMode]
  );

  useEffect(() => {
    setEngineMode(initialMode);
    setDisplayMode(initialDisplayMode ?? displayModeFromEngineMode(initialMode));
    setUserWidget(
      parseStatusWidgetJson(initialUserWidgetJson) ??
        characterStatusWidgetOrDefault(characterWidgetJson)
    );
    setLinkedPresetId(null);
    setMsg("");
    setErr("");
  }, [initialMode, initialDisplayMode, initialUserWidgetJson, characterWidgetJson, chatId]);

  useEffect(() => {
    onDraftChange?.({
      mode: engineMode,
      displayMode: effectiveDisplay,
      userWidgetJson: serializeStatusWidget(userWidget),
    });
  }, [engineMode, effectiveDisplay, userWidget, onDraftChange]);

  const widgetReservedBreakdown = useMemo(
    () =>
      resolveStatusWidgetReservedBreakdown({
        characterWidgetJson,
        chatMode: engineMode,
        userWidgetJson: serializeStatusWidget(userWidget),
        characterAllowUserOverride: allowUserOverride,
        displayMode: effectiveDisplay,
      }),
    [characterWidgetJson, engineMode, userWidget, allowUserOverride, effectiveDisplay]
  );
  const widgetBudgetNearLimit =
    widgetReservedBreakdown.characterReservedChars >= STATUS_WIDGET_CONTEXT_MAX * 0.85 ||
    widgetReservedBreakdown.userReservedChars >= STATUS_WIDGET_CONTEXT_MAX * 0.85;

  const save = useCallback(async () => {
    if (!chatId) return;
    setSaving(true);
    setMsg("");
    setErr("");
    const res = await fetch("/api/chat/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        statusWidgetMode: engineMode,
        statusWidgetDisplayMode: displayMode,
        userStatusWidgetJson: serializeStatusWidget(userWidget),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setErr(data.error || "저장에 실패했습니다.");
      return;
    }
    const savedDisplay =
      parseStatusWidgetDisplayMode(data.statusWidgetDisplayMode) ?? displayMode;
    setMsg("저장되었습니다.");
    onSaved?.({
      mode: engineMode,
      displayMode: savedDisplay,
      userWidgetJson: serializeStatusWidget(userWidget),
    });
  }, [chatId, engineMode, displayMode, userWidget, onSaved]);

  function setEngineToggles(next: { creatorOn: boolean; userOn: boolean }) {
    setEngineMode(statusWidgetModeFromToggles(next.creatorOn, next.userOn));
  }

  function setCreatorDisplayVisible(next: boolean) {
    setDisplayMode(
      displayModeFromVisibilityToggles(next, displayVisibility.userVisible)
    );
  }

  function setUserDisplayVisible(next: boolean) {
    setDisplayMode(
      displayModeFromVisibilityToggles(displayVisibility.creatorVisible, next)
    );
  }

  function loadPreset(preset: StatusWidgetPresetItem) {
    const parsed = parseStatusWidgetJson(preset.widget_json);
    if (!parsed) {
      setErr("저장된 상태창 형식이 올바르지 않습니다.");
      return;
    }
    setUserWidget(parsed);
    if (displayMode === "creator" || displayMode === "hidden") {
      setDisplayMode(hasCharacterWidget ? "both" : "user");
    }
    setLinkedPresetId(preset.id);
    setErr("");
    setMsg(`「${preset.title}」을(를) 불러왔습니다. 저장을 눌러 적용하세요.`);
  }

  const creatorTrackingHint = hasCharacterWidget
    ? "끄면 제작자 상태 추출·트리거·수치가 멈춥니다."
    : "제작자 상태창이 없습니다.";
  const userTrackingHint = !allowUserOverride
    ? "제작자가 커스텀 위젯을 허용하지 않았습니다."
    : "끄면 내 상태창 추출만 멈춥니다.";
  const displayHint = "화면 표시만 바꿉니다. 추적에는 영향 없습니다.";

  return (
    <section className="space-y-3 text-xs">
      <div>
        <h3 className="text-sm font-bold text-white">상태창</h3>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
          추적은 AI가 상태값을 계속 갱신할지 결정합니다. 표시는 채팅 화면에 보일지만
          결정합니다.
        </p>
        <p
          className={`mt-2 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition ${
            widgetBudgetNearLimit
              ? "border-rose-500/50 bg-rose-500/10 text-rose-200"
              : "border-violet-500/20 bg-violet-500/5 text-violet-300/90"
          }`}
        >
          {formatCombinedWidgetBudgetHint(widgetReservedBreakdown)}
        </p>
      </div>

      <div className="hidden sm:block overflow-hidden rounded-lg border border-white/10 bg-[#0e1120]">
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2 border-b border-white/10 px-3 py-2 text-[10px] font-semibold text-zinc-400">
          <span />
          <span className="text-center">상태 추적</span>
          <span className="text-center">화면 표시</span>
        </div>
        <ToggleRow
          layout="table"
          label="제작자 상태창"
          trackingOn={engineToggles.creatorOn}
          trackingDisabled={!hasCharacterWidget}
          trackingHint={creatorTrackingHint}
          displayOn={displayVisibility.creatorVisible}
          displayDisabled={!hasCharacterWidget}
          displayHint={displayHint}
          onTrackingChange={(next) =>
            setEngineToggles({
              creatorOn: next,
              userOn: engineToggles.userOn && userSourceAvailable,
            })
          }
          onDisplayChange={setCreatorDisplayVisible}
        />
        <ToggleRow
          layout="table"
          label="내 상태창"
          trackingOn={engineToggles.userOn && userSourceAvailable}
          trackingDisabled={!allowUserOverride}
          trackingHint={userTrackingHint}
          displayOn={displayVisibility.userVisible}
          displayDisabled={!userSourceAvailable}
          displayHint={displayHint}
          onTrackingChange={(next) =>
            setEngineToggles({
              creatorOn: engineToggles.creatorOn && hasCharacterWidget,
              userOn: next,
            })
          }
          onDisplayChange={setUserDisplayVisible}
        />
      </div>

      <div className="space-y-2 sm:hidden">
        <ToggleRow
          layout="card"
          label="제작자 상태창"
          trackingOn={engineToggles.creatorOn}
          trackingDisabled={!hasCharacterWidget}
          trackingHint={creatorTrackingHint}
          displayOn={displayVisibility.creatorVisible}
          displayDisabled={!hasCharacterWidget}
          displayHint={displayHint}
          onTrackingChange={(next) =>
            setEngineToggles({
              creatorOn: next,
              userOn: engineToggles.userOn && userSourceAvailable,
            })
          }
          onDisplayChange={setCreatorDisplayVisible}
        />
        <ToggleRow
          layout="card"
          label="내 상태창"
          trackingOn={engineToggles.userOn && userSourceAvailable}
          trackingDisabled={!allowUserOverride}
          trackingHint={userTrackingHint}
          displayOn={displayVisibility.userVisible}
          displayDisabled={!userSourceAvailable}
          displayHint={displayHint}
          onTrackingChange={(next) =>
            setEngineToggles({
              creatorOn: engineToggles.creatorOn && hasCharacterWidget,
              userOn: next,
            })
          }
          onDisplayChange={setUserDisplayVisible}
        />
      </div>

      {allowUserOverride && (
        <div className="space-y-2 rounded-lg border border-violet-500/25 bg-violet-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-violet-200">내가 저장한 상태창 불러오기</p>
            <Link
              href="/persona#status-widget-presets"
              className="shrink-0 text-[10px] text-violet-300 hover:underline"
            >
              제작 · 관리 →
            </Link>
          </div>
          {statusWidgetPresets.length === 0 ? (
            <p className="text-[10px] text-zinc-500">
              저장된 상태창이 없습니다. 페르소나 페이지에서 만들 수 있습니다.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {statusWidgetPresets.map((preset) => (
                <li
                  key={preset.id}
                  className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 ${
                    linkedPresetId === preset.id
                      ? "border-violet-500/40 bg-violet-500/10"
                      : "border-white/10 bg-[#1a1a1a]"
                  }`}
                >
                  <span className="min-w-0 truncate text-[11px] font-semibold text-zinc-200">
                    {preset.title}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => loadPreset(preset)}
                    className="shrink-0 rounded border border-violet-500/40 px-2 py-0.5 text-[10px] font-semibold text-violet-200 hover:bg-violet-500/15 disabled:opacity-40"
                  >
                    불러오기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-rose-400">{err}</p>}
      {msg && <p className="text-[10px] text-emerald-400">{msg}</p>}

      <button
        type="button"
        disabled={!chatId || saving}
        onClick={() => void save()}
        className="w-full rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {saving ? "저장 중…" : "상태창 설정 저장"}
      </button>
    </section>
  );
}
