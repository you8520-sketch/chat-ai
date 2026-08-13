"use client";

import { useEffect, useRef, useState } from "react";
import ChatDisplayReadabilitySettings from "@/components/ChatDisplayReadabilitySettings";
import { ChatSettingsRailIcon, type ChatSettingsRailIconId } from "@/components/ChatSettingsRailIcons";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import { trpgReadyLabel } from "@/lib/trpg/readyLabel";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import { TRPG_PARTY_CHAT_MAX_CHARS } from "@/lib/trpg/types";
import TrpgInviteLink from "./TrpgInviteLink";

export type TrpgCampaignRailTab = "display" | "sheets" | "ooc";

function tabLabel(tab: TrpgCampaignRailTab): string {
  switch (tab) {
    case "display":
      return "표시";
    case "sheets":
      return "시트";
    case "ooc":
      return "잡담";
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function tabIcon(tab: TrpgCampaignRailTab): ChatSettingsRailIconId {
  switch (tab) {
    case "display":
      return "display";
    case "sheets":
      return "persona";
    case "ooc":
      return "note";
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function tabHint(tab: TrpgCampaignRailTab): string {
  switch (tab) {
    case "display":
      return "글꼴 · 크기 · 문단 · 색";
    case "sheets":
      return "파티 캐릭터 시트";
    case "ooc":
      return "유저끼리만 보는 잡담";
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

export default function TrpgCampaignRail({
  snap,
  displayPrefs,
  onDisplayPrefsChange,
  partyBody,
  onPartyBodyChange,
  onSendParty,
  busy,
  compact,
}: {
  snap: TrpgCampaignSnapshot;
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
  partyBody: string;
  onPartyBodyChange: (value: string) => void;
  onSendParty: () => void;
  busy: boolean;
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

  const tabs: TrpgCampaignRailTab[] = ["display", "sheets", "ooc"];

  return (
    <div ref={rootRef} className="relative flex w-full flex-col">
      {active != null ? (
        <div
          role="dialog"
          aria-label={tabHint(active)}
          className="absolute bottom-auto right-full top-0 z-50 mr-1 flex max-h-[calc(100dvh-6rem)] w-[min(20rem,calc(100vw-3.5rem))] flex-col border border-white/10 bg-[#161616] shadow-[-12px_0_32px_rgba(0,0,0,0.55)]"
        >
          <div className="flex shrink-0 items-center border-b border-white/10 px-3 py-2.5">
            <p className="text-xs font-medium text-zinc-200">{tabHint(active)}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {active === "display" ? (
              <ChatDisplayReadabilitySettings
                displayPrefs={displayPrefs}
                onDisplayPrefsChange={onDisplayPrefsChange}
              />
            ) : null}
            {active === "sheets" ? (
              <div className="space-y-3">
                <ul className="flex flex-wrap gap-1.5">
                  {snap.participants.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-300"
                    >
                      {p.displayName}
                      {p.kind === "ai_character" ? " · AI" : ""}
                      {p.id === snap.viewerParticipantId ? " · 나" : ""}
                      {" · "}
                      {trpgReadyLabel(p.ready)}
                    </li>
                  ))}
                </ul>
                {snap.inviteCode ? (
                  <TrpgInviteLink code={snap.inviteCode} canJoin={false} />
                ) : null}
                {snap.sheets.map((card) => (
                  <div
                    key={card.participantId}
                    className={`rounded-xl border p-3 text-sm text-zinc-200 ${
                      card.isSelf ? "border-violet-400/30 bg-violet-500/10" : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="trpg-sheet-hud" dangerouslySetInnerHTML={{ __html: card.html }} />
                  </div>
                ))}
              </div>
            ) : null}
            {active === "ooc" ? (
              <div>
                <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
                  GM·봇·주사위·시나리오에는 안 들어갑니다.
                </p>
                <ul className="mb-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-[#161922] p-3">
                  {(snap.partyChat ?? []).length === 0 ? (
                    <li className="text-sm text-zinc-500">아직 대화가 없습니다.</li>
                  ) : (
                    (snap.partyChat ?? []).map((msg) => (
                      <li key={msg.id} className="text-sm leading-relaxed">
                        <span className={msg.isSelf ? "font-semibold text-violet-300" : "font-semibold text-zinc-400"}>
                          {msg.name}
                        </span>
                        <span className="ml-2 text-zinc-200">{msg.body}</span>
                      </li>
                    ))
                  )}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSendParty();
                  }}
                  className="flex flex-col gap-2"
                >
                  <input
                    value={partyBody}
                    onChange={(e) => onPartyBodyChange(e.target.value)}
                    maxLength={TRPG_PARTY_CHAT_MAX_CHARS}
                    placeholder="파티원에게 말하기"
                    className="min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
                  />
                  <button
                    type="submit"
                    disabled={busy || !partyBody.trim()}
                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    보내기
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <nav className={compact ? "flex gap-0.5" : "flex flex-col gap-px py-0.5"}>
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            title={`${tabLabel(id)} · ${tabHint(id)}`}
            aria-pressed={active === id}
            onClick={() => setActive((prev) => (prev === id ? null : id))}
            className={`flex flex-col items-center gap-0.5 rounded-md px-0 py-1.5 transition hover:bg-white/[0.06] ${
              active === id ? "bg-white/[0.06] font-semibold text-white" : "text-zinc-100 hover:text-white"
            } ${compact ? "flex-1 py-2" : "w-full"}`}
          >
            <ChatSettingsRailIcon
              id={tabIcon(id)}
              className={compact ? "h-[18px] w-[18px]" : "h-4 w-4"}
            />
            <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
              {tabLabel(id)}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
