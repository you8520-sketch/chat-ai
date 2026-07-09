"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  characterStatusWidgetOrDefault,
  hasCharacterStatusWidget,
  parseStatusWidgetJson,
  resolveStatusWidgetReservedChars,
  serializeStatusWidget,
  statusWidgetModeFromUserToggle,
  statusWidgetTogglesFromMode,
  type StatusWidget,
  type StatusWidgetSourceMode,
} from "@/lib/statusWidget";
import { formatWidgetBudgetHint } from "@/lib/statusWidget/contextBudget";
import type { StatusWidgetPresetItem } from "@/lib/statusWidgetPresetTypes";

type Props = {
  chatId: number | null;
  characterWidgetJson: string;
  initialMode: StatusWidgetSourceMode;
  initialUserWidgetJson: string;
  allowUserOverride: boolean;
  statusWidgetPresets?: StatusWidgetPresetItem[];
  onSaved?: (saved: { mode: StatusWidgetSourceMode; userWidgetJson: string }) => void;
  onDraftChange?: (draft: { mode: StatusWidgetSourceMode; userWidgetJson: string }) => void;
};

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2.5 ${
        disabled ? "opacity-45" : "cursor-pointer hover:bg-white/[0.03]"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-zinc-100">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-violet-600" : "bg-zinc-700"
        } disabled:cursor-not-allowed`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export default function StatusWidgetChatSettings({
  chatId,
  characterWidgetJson,
  initialMode,
  initialUserWidgetJson,
  allowUserOverride,
  statusWidgetPresets = [],
  onSaved,
  onDraftChange,
}: Props) {
  const hasCharacterWidget = hasCharacterStatusWidget(characterWidgetJson);
  const initialToggles = statusWidgetTogglesFromMode(initialMode);

  const [userOn, setUserOn] = useState(initialToggles.userOn);
  const [userWidget, setUserWidget] = useState<StatusWidget>(() =>
    parseStatusWidgetJson(initialUserWidgetJson) ??
      characterStatusWidgetOrDefault(characterWidgetJson)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [linkedPresetId, setLinkedPresetId] = useState<number | null>(null);

  const mode = useMemo(
    () => statusWidgetModeFromUserToggle(userOn, hasCharacterWidget),
    [userOn, hasCharacterWidget]
  );

  useEffect(() => {
    const toggles = statusWidgetTogglesFromMode(initialMode);
    setUserOn(toggles.userOn);
    setUserWidget(
      parseStatusWidgetJson(initialUserWidgetJson) ??
        characterStatusWidgetOrDefault(characterWidgetJson)
    );
    setLinkedPresetId(null);
    setMsg("");
    setErr("");
  }, [initialMode, initialUserWidgetJson, characterWidgetJson, chatId]);

  useEffect(() => {
    onDraftChange?.({
      mode,
      userWidgetJson: serializeStatusWidget(userWidget),
    });
  }, [mode, userWidget, onDraftChange]);

  const widgetReservedChars = useMemo(
    () =>
      resolveStatusWidgetReservedChars({
        characterWidgetJson,
        chatMode: mode,
        userWidgetJson: serializeStatusWidget(userWidget),
        characterAllowUserOverride: allowUserOverride,
      }),
    [characterWidgetJson, mode, userWidget, allowUserOverride]
  );

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
        statusWidgetMode: mode,
        userStatusWidgetJson: serializeStatusWidget(userWidget),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setErr(data.error || "저장에 실패했습니다.");
      return;
    }
    setMsg("저장되었습니다.");
    onSaved?.({
      mode,
      userWidgetJson: serializeStatusWidget(userWidget),
    });
  }, [chatId, mode, userWidget, onSaved]);

  function loadPreset(preset: StatusWidgetPresetItem) {
    const parsed = parseStatusWidgetJson(preset.widget_json);
    if (!parsed) {
      setErr("저장된 상태창 형식이 올바르지 않습니다.");
      return;
    }
    setUserWidget(parsed);
    setUserOn(true);
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
        <p className="mt-2 text-[10px] text-violet-300/90">
          {formatWidgetBudgetHint(widgetReservedChars)}
        </p>
      </div>

      <div className="space-y-2">
        {hasCharacterWidget ? (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
            <p className="text-xs font-semibold text-emerald-200">제작자 위젯 · 필수</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
              캐릭터에 설정된 상태창은 매 턴 자동으로 표시됩니다. 끌 수 없습니다.
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2.5 text-[10px] text-zinc-500">
            이 캐릭터에 제작자 상태창이 없습니다.
          </p>
        )}

        <ToggleRow
          label="내 위젯"
          hint={
            userToggleLocked
              ? "제작자가 커스텀 위젯을 허용하지 않았습니다."
              : "보관함에서 불러온 내 상태창을 표시합니다."
          }
          checked={userOn}
          disabled={userToggleLocked}
          onChange={setUserOn}
        />
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
