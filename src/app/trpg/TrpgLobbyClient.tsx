"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppSectionCard } from "@/components/AppPageShell";
import type { TrpgCatalog, TrpgCatalogCharacter, TrpgCatalogWorld } from "@/lib/trpg/catalog";
import type { TrpgScenarioTemplate } from "@/lib/trpg/scenarioTypes";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";

export default function TrpgLobbyClient({
  initialCampaigns,
  catalog,
  characterId,
}: {
  initialCampaigns: TrpgCampaignSnapshot[];
  catalog: TrpgCatalog;
  characterId: number | null;
}) {
  const router = useRouter();
  const [campaigns] = useState(initialCampaigns);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [worldId, setWorldId] = useState<number | "">("");
  const [pickCharacterId, setPickCharacterId] = useState<number | "">(characterId ?? "");

  async function postCampaign(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/trpg/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const selectedCharacter = catalog.myCharacters.find((c) => c.id === pickCharacterId);

  return (
    <div className="space-y-4">
      <AppSectionCard title="새 캠페인">
        <p className="text-sm leading-relaxed text-zinc-400">
          솔로 플레이도 가능합니다. 슬롯은 최대 4명(사람 + AI 캐릭터)이며 GM은 슬롯을 쓰지 않습니다.
          유료 포인트로 라운드를 쓰면 시나리오/세계관 제작자는 기존 크리에이터 포인트 비율을 받고,
          데려온 캐릭터 제작자는 유료 사용분의 최대 5%를 받습니다. 무료 포인트만 쓴 라운드에는 CP가 없습니다.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-300">
            세계관
            <select
              value={worldId}
              onChange={(e) => setWorldId(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            >
              <option value="">선택 안 함</option>
              {catalog.myWorlds.map((w) => (
                <option key={`mine-${w.id}`} value={w.id}>
                  내 세계관 · {w.name}
                </option>
              ))}
              {catalog.publicWorlds
                .filter((w) => !w.mine)
                .map((w) => (
                  <option key={`pub-${w.id}`} value={w.id}>
                    공개 · {w.name} (@{w.creatorName})
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm text-zinc-300">
            캐릭터 (AI 동료)
            <select
              value={pickCharacterId}
              onChange={(e) => setPickCharacterId(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            >
              <option value="">선택 안 함</option>
              {catalog.myCharacters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void postCampaign({
                ...(typeof worldId === "number" ? { worldId } : {}),
                ...(typeof pickCharacterId === "number" ? { characterId: pickCharacterId } : {}),
              })
            }
            className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
          >
            {selectedCharacter ? `${selectedCharacter.name}으로 캠페인 만들기` : "캠페인 만들기"}
          </button>
          <Link
            href="/trpg/scenarios/new"
            className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-200 hover:bg-white/10"
          >
            TRPG 시나리오 만들기
          </Link>
        </div>
      </AppSectionCard>

      <WorldList title="TRPG 공개 세계관" worlds={catalog.publicWorlds} busy={busy} onStart={(id) => void postCampaign({ worldId: id, ...(typeof pickCharacterId === "number" ? { characterId: pickCharacterId } : {}) })} />
      <WorldList title="내 세계관" worlds={catalog.myWorlds} busy={busy} onStart={(id) => void postCampaign({ worldId: id, ...(typeof pickCharacterId === "number" ? { characterId: pickCharacterId } : {}) })} />
      <CharacterList characters={catalog.myCharacters} busy={busy} onStart={(id) => void postCampaign({ characterId: id, ...(typeof worldId === "number" ? { worldId } : {}) })} />
      <ScenarioList title="내 TRPG 시나리오" scenarios={catalog.myScenarios} mine busy={busy} onStart={(id) => void postCampaign({ templateId: id, ...(typeof pickCharacterId === "number" ? { characterId: pickCharacterId } : {}) })} />
      <ScenarioList title="공개 TRPG 시나리오" scenarios={catalog.publicScenarios.filter((s) => !catalog.myScenarios.some((mine) => mine.id === s.id))} busy={busy} onStart={(id) => void postCampaign({ templateId: id, ...(typeof pickCharacterId === "number" ? { characterId: pickCharacterId } : {}) })} />

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

function WorldList({
  title,
  worlds,
  busy,
  onStart,
}: {
  title: string;
  worlds: TrpgCatalogWorld[];
  busy: boolean;
  onStart: (id: number) => void;
}) {
  if (worlds.length === 0) return null;
  return (
    <AppSectionCard title={title}>
      <ul className="space-y-2">
        {worlds.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">{w.name}</p>
              <p className="truncate text-xs text-zinc-500">{w.summary || (w.mine ? "내 세계관" : `@${w.creatorName}`)}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onStart(w.id)}
              className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              시작
            </button>
          </li>
        ))}
      </ul>
    </AppSectionCard>
  );
}

function CharacterList({
  characters,
  busy,
  onStart,
}: {
  characters: TrpgCatalogCharacter[];
  busy: boolean;
  onStart: (id: number) => void;
}) {
  if (characters.length === 0) return null;
  return (
    <AppSectionCard title="내 캐릭터">
      <ul className="space-y-2">
        {characters.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">
                {c.emoji} {c.name}
              </p>
              <p className="truncate text-xs text-zinc-500">{c.tagline}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onStart(c.id)}
              className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              동료로 시작
            </button>
          </li>
        ))}
      </ul>
    </AppSectionCard>
  );
}

function ScenarioList({
  title,
  scenarios,
  mine,
  busy,
  onStart,
}: {
  title: string;
  scenarios: TrpgScenarioTemplate[];
  mine?: boolean;
  busy: boolean;
  onStart: (id: number) => void;
}) {
  if (scenarios.length === 0) return null;
  return (
    <AppSectionCard title={title}>
      <ul className="space-y-2">
        {scenarios.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">{s.title}</p>
              <p className="truncate text-xs text-zinc-500">
                {s.visibility === "private" ? "비공개" : "공개"}
                {s.npcs.length ? ` · NPC ${s.npcs.length}` : ""}
                {s.characterIds.length ? ` · 캐릭터 ${s.characterIds.length}` : ""}
                {s.summary ? ` · ${s.summary}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {mine ? (
                <Link
                  href={`/trpg/scenarios/${s.id}`}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300"
                >
                  수정
                </Link>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => onStart(s.id)}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                시작
              </button>
            </div>
          </li>
        ))}
      </ul>
    </AppSectionCard>
  );
}
