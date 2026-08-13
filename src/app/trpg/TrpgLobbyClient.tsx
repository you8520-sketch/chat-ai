"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSectionCard } from "@/components/AppPageShell";
import PersonaSelector from "@/components/PersonaSelector";
import TrpgInviteLink from "./TrpgInviteLink";
import type { TrpgCatalog, TrpgCatalogWorld } from "@/lib/trpg/catalog";
import { parseTrpgInviteInput } from "@/lib/trpg/invite";
import { TRPG_SCENARIO_MAX_BOTS, type TrpgScenarioTemplate } from "@/lib/trpg/scenarioTypes";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import type { PublicPersonaListItem } from "@/lib/userPersonasClient";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

export default function TrpgLobbyClient({
  initialCampaigns,
  catalog,
  characterIds,
  personas: initialPersonas,
  initialPersonaId,
}: {
  initialCampaigns: TrpgCampaignSnapshot[];
  catalog: TrpgCatalog;
  characterIds: number[];
  personas: PublicPersonaListItem[];
  initialPersonaId: number | null;
}) {
  const router = useRouter();
  const [campaigns] = useState(initialCampaigns);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [worldId, setWorldId] = useState<number | "">("");
  const [pickCharacterIds, setPickCharacterIds] = useState<number[]>(characterIds);
  const [personas, setPersonas] = useState(initialPersonas);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(
    initialPersonaId ?? initialPersonas[0]?.id ?? null
  );

  useEffect(() => {
    setPersonas(initialPersonas);
  }, [initialPersonas]);

  useEffect(() => {
    if (personas.length === 0) return;
    try {
      const stored = localStorage.getItem(PERSONA_STORAGE_KEY);
      const storedId = stored ? Number(stored) : NaN;
      if (Number.isFinite(storedId) && personas.some((p) => p.id === storedId)) {
        setSelectedPersonaId(storedId);
        return;
      }
    } catch {
      /* ignore */
    }
    setSelectedPersonaId((prev) => {
      if (prev != null && personas.some((p) => p.id === prev)) return prev;
      return initialPersonaId ?? personas[0]?.id ?? null;
    });
  }, [personas, initialPersonaId]);

  function handlePersonaChange(personaId: number) {
    setSelectedPersonaId(personaId);
    try {
      localStorage.setItem(PERSONA_STORAGE_KEY, String(personaId));
    } catch {
      /* ignore */
    }
  }

  function toggleCharacter(id: number) {
    setPickCharacterIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= TRPG_SCENARIO_MAX_BOTS) return prev;
      return [...prev, id];
    });
  }

  async function postCampaign(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/trpg/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          characterIds: pickCharacterIds,
          ...(selectedPersonaId != null ? { personaId: selectedPersonaId } : {}),
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
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/trpg/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: parsed,
          ...(selectedPersonaId != null ? { personaId: selectedPersonaId } : {}),
        }),
      });
      const data = (await res.json()) as { campaignId?: number; error?: string };
      if (!res.ok || !data.campaignId) throw new Error(data.error || "참가하지 못했습니다.");
      router.push(`/trpg/${data.campaignId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했습니다.");
      setBusy(false);
    }
  }

  const selected = catalog.myCharacters.filter((c) => pickCharacterIds.includes(c.id));
  const canJoinStatus = (status: string) =>
    status === "CHARACTER_SETUP" || status === "WAITING_FOR_PLAYERS";

  return (
    <div className="space-y-4">
      <AppSectionCard title="새 캠페인">
        <p className="text-sm leading-relaxed text-zinc-400">
          내 페르소나가 PC입니다. AI 동료는 최대 {TRPG_SCENARIO_MAX_BOTS}명까지 고른 뒤 캠페인을 만듭니다.
          한 명을 골라도 바로 시작되지 않습니다. 사람+AI 합쳐 4자리이며 GM은 슬롯을 쓰지 않습니다.
        </p>
        {personas.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-sm text-zinc-300">내 페르소나</p>
            <PersonaSelector
              chatId={null}
              personas={personas}
              selectedPersonaId={selectedPersonaId}
              onSelectedChange={handlePersonaChange}
              addPersonaHref="/persona#personas"
            />
          </div>
        ) : null}
        <div className="mt-4">
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
        </div>
        <div className="mt-4">
          <p className="text-sm text-zinc-300">
            데려갈 캐릭터 ({pickCharacterIds.length}/{TRPG_SCENARIO_MAX_BOTS})
          </p>
          <p className="mt-1 text-xs text-zinc-500">토글로 고릅니다. 최대 3명. 고른 뒤 아래 캠페인 만들기를 누르세요.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {catalog.myCharacters.length === 0 ? (
              <p className="text-sm text-zinc-500">데려갈 캐릭터가 없습니다.</p>
            ) : (
              catalog.myCharacters.map((c) => {
                const on = pickCharacterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      on ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
                    }`}
                  >
                    {c.emoji} {c.name}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void postCampaign({
                ...(typeof worldId === "number" ? { worldId } : {}),
              })
            }
            className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
          >
            {selected.length
              ? `${selected.map((c) => c.name).join(", ")}와 캠페인 만들기`
              : "캠페인 만들기"}
          </button>
          <Link
            href="/trpg/scenarios/new"
            className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-200 hover:bg-white/10"
          >
            TRPG 시나리오 만들기
          </Link>
        </div>
      </AppSectionCard>

      <WorldList
        title="TRPG 공개 세계관"
        worlds={catalog.publicWorlds}
        busy={busy}
        onStart={(id) => void postCampaign({ worldId: id })}
      />
      <WorldList
        title="내 세계관"
        worlds={catalog.myWorlds}
        busy={busy}
        onStart={(id) => void postCampaign({ worldId: id })}
      />
      <ScenarioList
        title="내 TRPG 시나리오"
        scenarios={catalog.myScenarios}
        mine
        busy={busy}
        onStart={(id) => void postCampaign({ templateId: id })}
      />
      <ScenarioList
        title="공개 TRPG 시나리오"
        scenarios={catalog.publicScenarios.filter((s) => !catalog.myScenarios.some((mine) => mine.id === s.id))}
        busy={busy}
        onStart={(id) => void postCampaign({ templateId: id })}
      />

      <AppSectionCard title="초대 링크·코드로 참가">
        <p className="mb-3 text-sm text-zinc-400">입장 링크를 붙여넣거나 8자리 코드를 넣으면 됩니다.</p>
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

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
      ) : null}

      <AppSectionCard title="내 캠페인">
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((c) => (
              <li key={c.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <Link href={`/trpg/${c.id}`} className="flex items-center justify-between text-sm transition hover:text-violet-200">
                  <span className="font-medium text-zinc-100">{c.title}</span>
                  <span className="text-xs text-zinc-500">
                    {c.round.number}라운드 · {c.round.phase === "NONE" ? c.campaignStatus : c.round.phase}
                  </span>
                </Link>
                {c.inviteCode ? (
                  <TrpgInviteLink code={c.inviteCode} canJoin={canJoinStatus(c.campaignStatus)} />
                ) : null}
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
