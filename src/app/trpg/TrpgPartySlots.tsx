"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSectionCard } from "@/components/AppPageShell";
import PersonaSelector from "@/components/PersonaSelector";
import TrpgInviteLink from "./TrpgInviteLink";
import { companionSlotViews, remainingAiCompanionSlots } from "@/lib/trpg/partySlots";
import { TRPG_MAX_BOTS } from "@/lib/trpg/types";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import type { PublicPersonaListItem } from "@/lib/userPersonasClient";

type SlotAction = "mine" | "search" | "invite";

type SearchHit = {
  id: number;
  name: string;
  tagline: string;
  emoji: string;
  creatorName: string;
  mine: boolean;
};

export default function TrpgPartySlots({
  snap,
  busy,
  personas,
  selectedPersonaId,
  onPersonaChange,
  onAddCharacter,
}: {
  snap: TrpgCampaignSnapshot;
  busy: boolean;
  personas: PublicPersonaListItem[];
  selectedPersonaId: number | null;
  onPersonaChange: (personaId: number) => void;
  onAddCharacter: (characterId: number) => void;
}) {
  const slots = useMemo(
    () => companionSlotViews(snap.participants, snap.maxSlots),
    [snap.maxSlots, snap.participants]
  );
  const aiLeft = remainingAiCompanionSlots(snap.participants, snap.maxSlots);
  const [action, setAction] = useState<{ index: number; kind: SlotAction } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const pickerOpen = action?.kind === "mine" || action?.kind === "search";

  useEffect(() => {
    if (!pickerOpen || !action) return;
    const scope = action.kind;
    const q = query;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setLoadError("");
        try {
          const params = new URLSearchParams({ scope });
          if (q.trim()) params.set("q", q.trim());
          const res = await fetch(`/api/trpg/characters?${params.toString()}`, { cache: "no-store" });
          const data = (await res.json()) as { characters?: SearchHit[]; error?: string };
          if (!res.ok) throw new Error(data.error || "캐릭터를 불러오지 못했습니다.");
          setHits(Array.isArray(data.characters) ? data.characters : []);
        } catch (e) {
          setHits([]);
          setLoadError(e instanceof Error ? e.message : "캐릭터를 불러오지 못했습니다.");
        } finally {
          setLoading(false);
        }
      })();
    }, action.kind === "search" ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [action, pickerOpen, query]);

  function openSlot(index: number, kind: SlotAction) {
    setAction({ index, kind });
    setQuery("");
    setHits([]);
    setLoadError("");
  }

  return (
    <AppSectionCard title="파티 자리">
      <p className="text-sm leading-relaxed text-zinc-400">
        빈 자리에 플레이어 캐릭터를 넣거나 유저를 부를 수 있습니다. 플레이어 캐릭터는 최대 {TRPG_MAX_BOTS}명이고,
        각자 모델이 돌아갑니다. 시나리오 NPC(모브)는 여기 자리가 아닙니다.
      </p>
      {personas.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-zinc-300">내 페르소나</p>
          <PersonaSelector
            chatId={null}
            personas={personas}
            selectedPersonaId={selectedPersonaId}
            onSelectedChange={onPersonaChange}
            addPersonaHref="/persona#personas"
          />
        </div>
      ) : null}
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {slots.map((slot) => {
          switch (slot.kind) {
            case "empty":
              return (
                <li
                  key={`empty-${slot.index}`}
                  className="flex min-h-[11rem] flex-col rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-3"
                >
                  <p className="text-xs font-semibold text-zinc-500">빈 자리 {slot.index + 1}</p>
                  <div className="mt-3 flex flex-1 flex-col gap-2">
                    <button
                      type="button"
                      disabled={busy || aiLeft <= 0}
                      onClick={() => openSlot(slot.index, "mine")}
                      className="rounded-lg border border-white/10 px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-white/5 disabled:opacity-40"
                    >
                      내가 만든 캐릭터 선택하기
                    </button>
                    <button
                      type="button"
                      disabled={busy || aiLeft <= 0}
                      onClick={() => openSlot(slot.index, "search")}
                      className="rounded-lg border border-white/10 px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-white/5 disabled:opacity-40"
                    >
                      캐릭터 검색하기
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openSlot(slot.index, "invite")}
                      className="rounded-lg border border-white/10 px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-white/5 disabled:opacity-40"
                    >
                      다른 유저 호출하기
                    </button>
                  </div>
                </li>
              );
            case "ai":
              return (
                <li
                  key={`ai-${slot.participant.id}`}
                  className="flex min-h-[11rem] flex-col justify-center rounded-xl border border-violet-400/25 bg-violet-500/5 p-3"
                >
                  <p className="text-xs font-semibold text-violet-200">플레이어 캐릭터</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-50">{slot.participant.displayName}</p>
                </li>
              );
            case "human":
              return (
                <li
                  key={`human-${slot.participant.id}`}
                  className="flex min-h-[11rem] flex-col justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-3"
                >
                  <p className="text-xs font-semibold text-emerald-200">유저</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-50">{slot.participant.displayName}</p>
                  <p className="mt-1 text-xs text-zinc-500">선택한 페르소나로 들어왔습니다.</p>
                </li>
              );
            default: {
              const _exhaustive: never = slot;
              return _exhaustive;
            }
          }
        })}
      </ul>
      {action?.kind === "invite" && snap.inviteCode ? (
        <div className="mt-4">
          <TrpgInviteLink
            code={snap.inviteCode}
            canJoin={snap.participants.length < snap.maxSlots}
          />
        </div>
      ) : null}
      {pickerOpen ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-[#161922] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-100">
              {action?.kind === "mine" ? "내가 만든 캐릭터" : "캐릭터 검색"}
            </p>
            <button
              type="button"
              onClick={() => setAction(null)}
              className="text-xs font-semibold text-zinc-400 hover:text-zinc-200"
            >
              닫기
            </button>
          </div>
          {action?.kind === "search" ? (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름, 소개, 제작자로 찾기"
              className="mt-3 min-h-10 w-full rounded-xl border border-white/10 bg-[#11141f] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
            />
          ) : null}
          {loading ? <p className="mt-3 text-xs text-zinc-500">불러오는 중…</p> : null}
          {loadError ? <p className="mt-3 text-xs text-rose-300">{loadError}</p> : null}
          {!loading && !loadError && hits.length === 0 ? (
            <p className="mt-3 text-xs text-zinc-500">
              {action?.kind === "search" && !query.trim()
                ? "검색어를 입력하면 TRPG에 쓸 수 있는 공개 캐릭터가 나옵니다."
                : "맞는 캐릭터가 없습니다."}
            </p>
          ) : (
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    disabled={busy || aiLeft <= 0}
                    onClick={() => {
                      onAddCharacter(hit.id);
                      setAction(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/5 disabled:opacity-40"
                  >
                    <span className="text-lg">{hit.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-100">{hit.name}</span>
                      <span className="block truncate text-[11px] text-zinc-500">
                        {hit.tagline || (hit.mine ? "내 캐릭터" : `by ${hit.creatorName}`)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </AppSectionCard>
  );
}
