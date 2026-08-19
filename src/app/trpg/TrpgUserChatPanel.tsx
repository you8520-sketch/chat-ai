"use client";

import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import { TRPG_PARTY_CHAT_MAX_CHARS } from "@/lib/trpg/types";

export default function TrpgUserChatPanel({
  snap,
  partyBody,
  onPartyBodyChange,
  onSendParty,
  busy,
}: {
  snap: TrpgCampaignSnapshot;
  partyBody: string;
  onPartyBodyChange: (value: string) => void;
  onSendParty: () => void;
  busy: boolean;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col" data-trpg-user-chat-panel>
      <header className="shrink-0 border-b border-white/10 px-3 py-2.5">
        <h2 className="text-sm font-semibold text-zinc-100">유저 채팅</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          플레이어끼리만 보이며 GM 진행에는 반영되지 않습니다.
        </p>
      </header>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
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
        className="shrink-0 space-y-2 border-t border-white/10 px-3 py-3"
      >
        <input
          value={partyBody}
          onChange={(e) => onPartyBodyChange(e.target.value)}
          maxLength={TRPG_PARTY_CHAT_MAX_CHARS}
          placeholder="유저에게 메시지 보내기"
          className="min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
        />
        <button
          type="submit"
          disabled={busy || !partyBody.trim()}
          className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50"
        >
          보내기
        </button>
      </form>
    </section>
  );
}
