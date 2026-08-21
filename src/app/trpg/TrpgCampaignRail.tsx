"use client";

import { useEffect, useRef, useState } from "react";
import ChatDisplayReadabilitySettings from "@/components/ChatDisplayReadabilitySettings";
import { ChatSettingsRailIcon, type ChatSettingsRailIconId } from "@/components/ChatSettingsRailIcons";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import { partyDetailedSheetCards } from "@/lib/trpg/partySheetPresentation";
import { trpgReadyLabel } from "@/lib/trpg/readyLabel";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import TrpgInviteLink from "./TrpgInviteLink";
import TrpgUserChatPanel from "./TrpgUserChatPanel";

export type TrpgCampaignRailTab = "display" | "sheets" | "ooc";

function tabLabel(tab: TrpgCampaignRailTab): string {
  switch (tab) {
    case "display":
      return "표시";
    case "sheets":
      return "시트";
    case "ooc":
      return "유저 채팅";
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
      return "글꼴 · 크기";
    case "sheets":
      return "파티원 시트 · 내 시트는 화면 아래 고정";
    case "ooc":
      return "플레이어끼리만 보이며 GM 진행에는 반영되지 않습니다.";
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

  const tabs: TrpgCampaignRailTab[] = compact ? ["display", "sheets", "ooc"] : ["display", "sheets"];
  const partyDetailedSheets = partyDetailedSheetCards(snap.sheets);

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
              <>
                <ChatDisplayReadabilitySettings
                  displayPrefs={displayPrefs}
                  onDisplayPrefsChange={onDisplayPrefsChange}
                />
              </>
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
                {partyDetailedSheets.length > 0 ? (
                  partyDetailedSheets.map((card) => (
                    <div
                      key={card.participantId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-200"
                    >
                      <div className="trpg-sheet-hud" dangerouslySetInnerHTML={{ __html: card.html }} />
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-zinc-400">
                    다른 파티원이 없습니다.
                  </p>
                )}
              </div>
            ) : null}
            {active === "ooc" ? (
              <div className="h-[min(28rem,60dvh)]">
                <TrpgUserChatPanel
                  snap={snap}
                  partyBody={partyBody}
                  onPartyBodyChange={onPartyBodyChange}
                  onSendParty={onSendParty}
                  busy={busy}
                />
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
