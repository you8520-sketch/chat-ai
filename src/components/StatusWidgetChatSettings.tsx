"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  characterStatusWidgetOrDefault,
  displayModeFromEngineMode,
  displayModeFromUserChoice,
  engineModeForDisplay,
  hasCharacterStatusWidget,
  formatCombinedWidgetBudgetHint,
  STATUS_WIDGET_CONTEXT_MAX,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetJson,
  resolveStatusWidgetReservedBreakdown,
  serializeStatusWidget,
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

const DISPLAY_OPTIONS: {
  id: StatusWidgetDisplayMode;
  label: string;
  hint: string;
  needsUser?: boolean;
}[] = [
  {
    id: "creator",
    label: "제작자 기본 상태창 보기",
    hint: "제작자가 만든 상태창만 화면에 표시합니다.",
  },
  {
    id: "user",
    label: "내 커스텀 상태창으로 보기",
    hint: "내 위젯만 표시합니다. 제작자 상태값은 내부적으로 계속 생성됩니다.",
    needsUser: true,
  },
  {
    id: "both",
    label: "둘 다 보기",
    hint: "제작자 상태창과 내 커스텀 상태창을 함께 표시합니다.",
    needsUser: true,
  },
  {
    id: "hidden",
    label: "상태창 화면에서 숨기기",
    hint: "화면에서만 숨깁니다. 기억·이벤트용 제작자 상태값은 계속 유지됩니다.",
  },
];

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
  const resolvedDisplay = useMemo(
    () =>
      displayModeFromUserChoice({
        hasCharacterWidget,
        hasUserWidget: hasUserWidget && allowUserOverride,
        preference: displayMode,
      }),
    [hasCharacterWidget, hasUserWidget, allowUserOverride, displayMode]
  );

  const engineMode = useMemo(
    () =>
      engineModeForDisplay(
        resolvedDisplay,
        hasCharacterWidget,
        hasUserWidget && allowUserOverride
      ),
    [resolvedDisplay, hasCharacterWidget, hasUserWidget, allowUserOverride]
  );

  useEffect(() => {
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
      displayMode: resolvedDisplay,
      userWidgetJson: serializeStatusWidget(userWidget),
    });
  }, [engineMode, resolvedDisplay, userWidget, onDraftChange]);

  const widgetReservedBreakdown = useMemo(
    () =>
      resolveStatusWidgetReservedBreakdown({
        characterWidgetJson,
        chatMode: engineMode,
        userWidgetJson: serializeStatusWidget(userWidget),
        characterAllowUserOverride: allowUserOverride,
        displayMode: resolvedDisplay,
      }),
    [characterWidgetJson, engineMode, userWidget, allowUserOverride, resolvedDisplay]
  );
  const widgetReservedChars = widgetReservedBreakdown.totalReservedChars;
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
        statusWidgetDisplayMode: resolvedDisplay,
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
      parseStatusWidgetDisplayMode(data.statusWidgetDisplayMode) ?? resolvedDisplay;
    setMsg("저장되었습니다.");
    onSaved?.({
      mode: engineMode,
      displayMode: savedDisplay,
      userWidgetJson: serializeStatusWidget(userWidget),
    });
  }, [chatId, engineMode, resolvedDisplay, userWidget, onSaved]);

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

  const userToggleLocked = !allowUserOverride;

  return (
    <section className="space-y-3 text-xs">
      <div>
        <h3 className="text-sm font-bold text-white">상태창</h3>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
          HTML은 페르소나 페이지에서 제작 · AI는 값만 채웁니다.
        </p>
        <p className="mt-2 text-[10px] leading-relaxed text-amber-200/90">
          제작자 상태값은 캐릭터 기억과 이벤트 조건에 사용되므로 내부적으로 항상 유지됩니다. 내
          커스텀 상태창은 화면 표시 방식을 바꾸는 기능입니다.
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

      <div className="space-y-2">
        {hasCharacterWidget ? (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
            <p className="text-xs font-semibold text-emerald-200">제작자 상태 · 엔진 필수</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
              캐릭터에 설정된 상태값은 매 턴 생성·저장됩니다. 끌 수 없습니다.
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2.5 text-[10px] text-zinc-500">
            이 캐릭터에 제작자 상태창이 없습니다.
          </p>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-zinc-300">화면 표시</p>
          {DISPLAY_OPTIONS.map((opt) => {
            const disabled =
              userToggleLocked && (opt.id === "user" || opt.id === "both");
            const selected = displayMode === opt.id;
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                  selected
                    ? "border-violet-500/40 bg-violet-500/10"
                    : "border-white/10 bg-[#0e1120] hover:bg-white/[0.03]"
                } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
              >
                <input
                  type="radio"
                  name="status-widget-display"
                  className="mt-0.5"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => !disabled && setDisplayMode(opt.id)}
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-zinc-100">{opt.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                    {disabled
                      ? "제작자가 커스텀 위젯을 허용하지 않았습니다."
                      : opt.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {!userToggleLocked && (
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
