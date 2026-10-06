"use client";

import { useEffect, useRef, useState } from "react";
import ChatDisplayReadabilitySettings from "@/components/ChatDisplayReadabilitySettings";
import ChatStreamSpeedSettings from "@/components/ChatStreamSpeedSettings";
import { ChatSettingsRailIcon } from "@/components/ChatSettingsRailIcons";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

export type TrpgCampaignRailTab = "display";

function tabLabel(tab: TrpgCampaignRailTab): string {
  switch (tab) {
    case "display":
      return "채팅 설정";
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function tabHint(tab: TrpgCampaignRailTab): string {
  switch (tab) {
    case "display":
      return "글꼴 · 크기 · 출력 속도";
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

export default function TrpgCampaignRail({
  displayPrefs,
  onDisplayPrefsChange,
  streamIntervalMs,
  onStreamIntervalMsChange,
  compact,
}: {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
  streamIntervalMs: number;
  onStreamIntervalMsChange: (intervalMs: number) => void;
  compact?: boolean;
}) {
  const [active, setActive] = useState<TrpgCampaignRailTab | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActive(null);
    }
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setActive(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [active]);

  const tabs: TrpgCampaignRailTab[] = ["display"];

  return (
    <div ref={rootRef} className="relative flex w-full flex-col">
      {active != null ? (
        <div
          role="dialog"
          aria-label={tabHint(active)}
          className={`z-50 flex max-h-[calc(100dvh-9rem)] flex-col border border-white/10 bg-[#161616] shadow-[-12px_0_32px_rgba(0,0,0,0.55)] ${
            compact
              ? "absolute inset-x-0 top-full mt-2 w-full rounded-2xl"
              : "absolute right-full top-0 mr-1 w-[min(20rem,calc(100vw-3.5rem))]"
          }`}
        >
          <div className="flex shrink-0 items-center border-b border-white/10 px-3 py-2.5">
            <p className="text-xs font-medium text-zinc-200">{tabHint(active)}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {active === "display" ? (
              <div className="space-y-5">
                <ChatDisplayReadabilitySettings
                  displayPrefs={displayPrefs}
                  onDisplayPrefsChange={onDisplayPrefsChange}
                />
                <ChatStreamSpeedSettings
                  title="출력 속도"
                  streamIntervalMs={streamIntervalMs}
                  onStreamIntervalMsChange={onStreamIntervalMsChange}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <nav className={compact ? "grid grid-cols-1 gap-2" : "flex flex-col gap-px py-0.5"}>
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            title={`${tabLabel(id)} · ${tabHint(id)}`}
            aria-pressed={active === id}
            onClick={() => setActive((prev) => (prev === id ? null : id))}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border px-1 transition hover:bg-white/[0.06] ${
              active === id ? "bg-white/[0.06] font-semibold text-white" : "text-zinc-100 hover:text-white"
            } ${compact ? "min-h-14 border-white/10 bg-white/[0.03] py-2" : "w-full border-transparent py-1.5"}`}
          >
            <ChatSettingsRailIcon
              id="display"
              className={compact ? "h-5 w-5" : "h-4 w-4"}
            />
            <span className={`max-w-full px-0.5 text-center font-medium leading-tight tracking-tight ${compact ? "text-xs" : "text-[9px]"}`}>
              {tabLabel(id)}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
