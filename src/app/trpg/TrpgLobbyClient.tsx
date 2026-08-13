"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppSectionCard } from "@/components/AppPageShell";
import TrpgInviteLink from "./TrpgInviteLink";
import TrpgCampaignTitle from "./TrpgCampaignTitle";
import TrpgCatalogBrowse from "./TrpgCatalogBrowse";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import { parseTrpgInviteInput } from "@/lib/trpg/invite";
import type { TrpgCatalogPick } from "@/lib/trpg/catalogBrowse";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";

export default function TrpgLobbyClient({
  initialCampaigns,
  catalog,
  characterIds,
}: {
  initialCampaigns: TrpgCampaignSnapshot[];
  catalog: TrpgCatalog;
  characterIds: number[];
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<TrpgCatalogPick | null>(null);

  async function postCampaign(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const stored = (() => {
        try {
          const raw = localStorage.getItem("habi:lastPersonaId");
          const id = raw ? Number(raw) : NaN;
          return Number.isInteger(id) && id > 0 ? id : null;
        } catch {
          return null;
        }
      })();
      const res = await fetch("/api/trpg/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          characterIds,
          ...(stored != null ? { personaId: stored } : {}),
        }),
      });
      const data = (await res.json()) as { campaignId?: number; error?: string };
      if (!res.ok || !data.campaignId) throw new Error(data.error || "캠페인을 만들지 못했습니다.");
      router.push(`/trpg/${data.campaignId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패했습니다.");
      setBusy(false);
    }
  }

  async function deleteCampaign(id: number) {
    if (!window.confirm("이 캠페인을 삭제할까요? 초안이든 진행 중이든 복구할 수 없습니다.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/trpg/campaigns/${id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "삭제하지 못했습니다.");
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function joinCampaign(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTrpgInviteInput(code);
    if (!parsed) {
      setError("초대 코드 또는 입장 링크를 넣어 주세요.");
      return;
    }
    router.push(`/trpg/join/${parsed}`);
  }

  const canJoinStatus = (status: string) =>
    status === "CHARACTER_SETUP" || status === "WAITING_FOR_PLAYERS";

  return (
    <div className="space-y-8">
      <TrpgCatalogBrowse
        catalog={catalog}
        busy={busy}
        pick={pick}
        onPickWorld={(id) => setPick({ kind: "world", id })}
        onPickScenario={(id) => setPick({ kind: "scenario", id })}
        onStartWorld={(id) => void postCampaign({ worldId: id })}
        onStartScenario={(id) => void postCampaign({ templateId: id })}
      />

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
      ) : null}

      <AppSectionCard title="내 캠페인">
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-500">
            시작한 캠페인이 없습니다. 세계관·시나리오 카드를 눌러 본문을 읽은 뒤 「캠페인 시작」을 누르면 파티를 구성합니다.
          </p>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((c) => (
              <li key={c.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {c.viewerIsHost ? (
                      <TrpgCampaignTitle
                        campaignId={c.id}
                        title={c.title}
                        canEdit
                        onSaved={(title) =>
                          setCampaigns((prev) => prev.map((row) => (row.id === c.id ? { ...row, title } : row)))
                        }
                      />
                    ) : (
                      <Link href={`/trpg/${c.id}`} className="block truncate text-sm font-medium text-zinc-100 hover:text-violet-200">
                        {c.title}
                      </Link>
                    )}
                    <Link href={`/trpg/${c.id}`} className="text-xs text-zinc-500 hover:text-violet-200">
                      {c.round.number}라운드 · {c.round.phase === "NONE" ? c.campaignStatus : c.round.phase} · 열기
                    </Link>
                  </div>
                  {c.viewerIsHost ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteCampaign(c.id)}
                      className="shrink-0 rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      삭제
                    </button>
                  ) : null}
                </div>
                {c.inviteCode ? (
                  <TrpgInviteLink code={c.inviteCode} canJoin={canJoinStatus(c.campaignStatus)} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AppSectionCard>

      <AppSectionCard title="초대 링크·코드로 참가">
        <p className="mb-3 text-sm text-zinc-400">입장 링크를 붙여넣거나 8자리 코드를 넣으면 페르소나를 고른 뒤 들어갑니다.</p>
        <form onSubmit={(e) => void joinCampaign(e)} className="flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="https://…/trpg/join/코드 또는 초대 코드"
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
    </div>
  );
}
