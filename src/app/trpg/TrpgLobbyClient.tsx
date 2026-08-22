"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppSectionCard } from "@/components/AppPageShell";
import TrpgCatalogBrowse from "./TrpgCatalogBrowse";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import {
  EMPTY_TRPG_CATALOG_PLAY_SCORES,
  type TrpgCatalogPlayScores,
} from "@/lib/trpg/catalogPlayScores";
import { parseTrpgInviteInput } from "@/lib/trpg/invite";
import { catalogScenarioById, type TrpgCatalogPick } from "@/lib/trpg/catalogBrowse";
import { resolveScenarioHandoff } from "@/lib/trpg/scenarioHandoff";

export default function TrpgLobbyClient({
  catalog,
  characterIds,
  initialScenarioId,
  playScores = EMPTY_TRPG_CATALOG_PLAY_SCORES,
}: {
  catalog: TrpgCatalog;
  characterIds: number[];
  initialScenarioId?: string;
  playScores?: TrpgCatalogPlayScores;
}) {
  const router = useRouter();
  const handoff = resolveScenarioHandoff(catalog, initialScenarioId);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(handoff.ok || !initialScenarioId ? "" : handoff.error);
  const [pick, setPick] = useState<TrpgCatalogPick | null>(handoff.ok ? handoff.pick : null);

  async function postCampaign(body: Record<string, unknown>) {
    if (busy) return;
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

  async function joinCampaign(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTrpgInviteInput(code);
    if (!parsed) {
      setError("초대 코드 또는 입장 링크를 넣어 주세요.");
      return;
    }
    router.push(`/trpg/join/${parsed}`);
  }

  return (
    <div className="space-y-8">
      {pick?.kind === "scenario" ? (
        <div
          data-scenario-handoff-selected
          className="rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-sm text-violet-50"
        >
          <p className="font-semibold">선택한 시나리오 · {catalogScenarioById(catalog, pick.id)?.scenario.title}</p>
          {catalogScenarioById(catalog, pick.id)?.scenario.summary.trim() ? (
            <p className="mt-1 text-xs text-violet-100/80">
              {catalogScenarioById(catalog, pick.id)?.scenario.summary}
            </p>
          ) : null}
        </div>
      ) : null}

      <TrpgCatalogBrowse
        catalog={catalog}
        playScores={playScores}
        busy={busy}
        pick={pick}
        initialPreview={handoff.ok ? handoff.pick : null}
        onPickWorld={(id) => setPick({ kind: "world", id })}
        onPickScenario={(id) => setPick({ kind: "scenario", id })}
        onStartWorld={(id) => void postCampaign({ worldId: id })}
        onStartScenario={(id) => void postCampaign({ templateId: id })}
      />

      {error ? (
        <div
          data-scenario-handoff-error
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          <p>{error}</p>
          {!handoff.ok && initialScenarioId ? (
            <p className="mt-2 text-xs">
              <Link href="/world/create?tab=scenario" className="font-semibold underline">
                새 시나리오 만들기
              </Link>
              {" · "}
              <Link href="/trpg" className="font-semibold underline">
                목록에서 다시 고르기
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

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
