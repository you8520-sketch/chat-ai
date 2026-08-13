"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppSectionCard } from "@/components/AppPageShell";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";

export default function TrpgLobbyClient({
  initialCampaigns,
  characterId,
}: {
  initialCampaigns: TrpgCampaignSnapshot[];
  characterId: number | null;
}) {
  const router = useRouter();
  const [campaigns] = useState(initialCampaigns);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createCampaign() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/trpg/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(characterId ? { characterId } : {}),
      });
      const data = (await res.json()) as { campaignId?: number; error?: string };
      if (!res.ok || !data.campaignId) throw new Error(data.error || "캠페인을 만들지 못했습니다.");
      router.push(`/trpg/${data.campaignId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패했습니다.");
      setBusy(false);
    }
  }

  async function joinCampaign(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/trpg/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { campaignId?: number; error?: string };
      if (!res.ok || !data.campaignId) throw new Error(data.error || "참가하지 못했습니다.");
      router.push(`/trpg/${data.campaignId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <AppSectionCard title="새 캠페인">
        <p className="text-sm leading-relaxed text-zinc-400">
          솔로 플레이도 가능합니다. 슬롯은 최대 4명(사람 + AI 캐릭터)이며 GM은 슬롯을 쓰지 않습니다.
          {characterId ? " 선택한 캐릭터가 AI 동료로 들어갑니다." : ""}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void createCampaign()}
          className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
        >
          {characterId ? "이 캐릭터로 캠페인 만들기" : "빈 캠페인 만들기"}
        </button>
      </AppSectionCard>

      <AppSectionCard title="초대 코드로 참가">
        <form onSubmit={(e) => void joinCampaign(e)} className="flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="초대 코드"
            className="min-h-10 min-w-[10rem] flex-1 rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50"
          >
            참가
          </button>
        </form>
      </AppSectionCard>

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
      ) : null}

      <AppSectionCard title="내 캠페인">
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/trpg/${c.id}`}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm transition hover:bg-white/[0.06]"
                >
                  <span className="font-medium text-zinc-100">{c.title}</span>
                  <span className="text-xs text-zinc-500">
                    {c.round.number}라운드 · {c.round.phase === "NONE" ? c.campaignStatus : c.round.phase}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AppSectionCard>
    </div>
  );
}
