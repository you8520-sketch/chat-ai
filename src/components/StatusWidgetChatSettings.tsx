"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  displayModeFromEngineMode,
  displayModeFromVisibilityToggles,
  displayVisibilityFromMode,
  hasCharacterStatusWidget,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetJson,
  statusWidgetModeForDefinitions,
  type StatusWidgetDisplayMode,
} from "@/lib/statusWidget";

type Props = {
  chatId: number | null;
  characterWidgetJson: string;
  personaWidgetJson: string;
  initialDisplayMode?: StatusWidgetDisplayMode | null;
  allowUserOverride: boolean;
  onSaved?: (saved: { displayMode: StatusWidgetDisplayMode }) => void;
};

function StatusDisplayToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-zinc-100">{label}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          checked
            ? "border-violet-400/55 bg-violet-500/15 text-violet-200"
            : "border-white/10 bg-[#1a1a1a] text-zinc-500"
        }`}
      >
        {checked ? "ON" : "OFF"}
      </button>
    </div>
  );
}

export default function StatusWidgetChatSettings({
  chatId,
  characterWidgetJson,
  personaWidgetJson,
  initialDisplayMode = null,
  allowUserOverride,
  onSaved,
}: Props) {
  const creatorAvailable = hasCharacterStatusWidget(characterWidgetJson);
  const personaAvailable =
    allowUserOverride && Boolean(parseStatusWidgetJson(personaWidgetJson));
  const defaultDisplayMode = useMemo(
    () =>
      displayModeFromEngineMode(
        statusWidgetModeForDefinitions({
          characterWidgetJson,
          personaWidgetJson,
          characterAllowUserOverride: allowUserOverride,
        })
      ),
    [characterWidgetJson, personaWidgetJson, allowUserOverride]
  );
  const [displayMode, setDisplayMode] = useState<StatusWidgetDisplayMode>(
    initialDisplayMode ?? defaultDisplayMode
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDisplayMode(initialDisplayMode ?? defaultDisplayMode);
    setError("");
  }, [chatId, initialDisplayMode, defaultDisplayMode]);

  const visibility = displayVisibilityFromMode(displayMode);
  const creatorVisible = creatorAvailable && visibility.creatorVisible;
  const personaVisible = personaAvailable && visibility.userVisible;

  async function saveVisibility(creatorOn: boolean, personaOn: boolean) {
    if (!chatId || saving) return;
    const previous = displayMode;
    const next = displayModeFromVisibilityToggles(creatorOn, personaOn);
    setDisplayMode(next);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, statusWidgetDisplayMode: next }),
      });
      const data = (await res.json()) as {
        error?: string;
        statusWidgetDisplayMode?: unknown;
      };
      if (!res.ok) {
        setDisplayMode(previous);
        setError(data.error || "상태창 표시 설정을 저장하지 못했습니다.");
        return;
      }
      const saved =
        parseStatusWidgetDisplayMode(
          typeof data.statusWidgetDisplayMode === "string"
            ? data.statusWidgetDisplayMode
            : null
        ) ?? next;
      setDisplayMode(saved);
      onSaved?.({ displayMode: saved });
    } catch {
      setDisplayMode(previous);
      setError("상태창 표시 설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2 text-xs">
      <h3 className="text-sm font-bold text-white">상태창</h3>
      <StatusDisplayToggle
        label="제작자 상태창"
        hint={
          creatorAvailable
            ? "캐릭터 제작자가 설정한 상태창을 표시합니다."
            : "제작자가 설정한 상태창이 없습니다."
        }
        checked={creatorVisible}
        disabled={!chatId || saving || !creatorAvailable}
        onChange={(next) => void saveVisibility(next, personaVisible)}
      />
      <StatusDisplayToggle
        label="내 상태창"
        hint={
          !allowUserOverride
            ? "제작자가 내 상태창 사용을 허용하지 않았습니다."
            : personaAvailable
              ? "현재 페르소나에 설정한 상태창을 표시합니다."
              : "페르소나에서 사용할 상태창을 설정할 수 있습니다."
        }
        checked={personaVisible}
        disabled={!chatId || saving || !personaAvailable}
        onChange={(next) => void saveVisibility(creatorVisible, next)}
      />
      {allowUserOverride && !personaAvailable ? (
        <div className="flex justify-end">
          <Link href="/persona#personas" className="text-[10px] text-violet-300 hover:underline">
            페르소나 상태창 설정 →
          </Link>
        </div>
      ) : null}
      {saving ? <p className="text-[10px] text-zinc-500">저장 중…</p> : null}
      {error ? <p className="text-[10px] text-rose-400">{error}</p> : null}
    </section>
  );
}
