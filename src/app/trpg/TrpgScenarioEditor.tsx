"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppPageShell, AppSectionCard } from "@/components/AppPageShell";
import GenrePicker from "@/components/GenrePicker";
import StudioSaveBar from "@/components/studio/StudioSaveBar";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import type { CharacterGenre } from "@/lib/characterGenres";
import {
  TRPG_SCENARIO_CONTENT_LIMIT,
  TRPG_SCENARIO_MAX_BOTS,
  TRPG_SCENARIO_MAX_NPCS,
  TRPG_SCENARIO_SECRET_LIMIT,
  TRPG_SCENARIO_SUMMARY_LIMIT,
  TRPG_SCENARIO_TITLE_LIMIT,
  type TrpgScenarioNpc,
  type TrpgScenarioTemplate,
} from "@/lib/trpg/scenarioTypes";
import { DEFAULT_TRPG_STAT_DEFS, suggestBotStats } from "@/lib/trpg/stats";
import type { TrpgVisibility } from "@/lib/trpg/types";

function emptyNpc(): TrpgScenarioNpc {
  return { name: "", description: "", greeting: "", systemPrompt: "", stats: null };
}

export default function TrpgScenarioEditor({
  catalog,
  initial,
  embedded = false,
  returnHref = "/trpg",
}: {
  catalog: TrpgCatalog;
  initial?: TrpgScenarioTemplate | null;
  embedded?: boolean;
  returnHref?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [secretContent, setSecretContent] = useState(initial?.secretContent ?? "");
  const [worldId, setWorldId] = useState<number | "">(initial?.worldId ?? "");
  const [visibility, setVisibility] = useState<TrpgVisibility>(initial?.visibility ?? "private");
  const [startLocation, setStartLocation] = useState(initial?.startLocation ?? "");
  const [inventoryText, setInventoryText] = useState((initial?.startInventory ?? []).join(", "));
  const [stats, setStats] = useState<Record<string, number>>(
    () => initial?.defaultPcStats ?? { str: 5, dex: 5, int: 5, wis: 5, cha: 5, con: 5 }
  );
  const [npcs, setNpcs] = useState<TrpgScenarioNpc[]>(initial?.npcs?.length ? initial.npcs : []);
  const [characterIds, setCharacterIds] = useState<number[]>(initial?.characterIds ?? []);
  const [genres, setGenres] = useState<CharacterGenre[]>(initial?.genres ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const spent = Object.values(stats).reduce((a, b) => a + b, 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      title,
      summary,
      content,
      secretContent,
      worldId: worldId === "" ? null : worldId,
      visibility,
      startLocation,
      startInventory: inventoryText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      defaultPcStats: stats,
      npcs: npcs.filter((n) => n.name.trim()),
      characterIds,
      genres,
    };
    try {
      const res = await fetch(initial ? `/api/trpg/scenarios/${initial.id}` : "/api/trpg/scenarios", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; scenario?: TrpgScenarioTemplate };
      if (!res.ok) throw new Error(data.error || "저장에 실패했습니다.");
      router.push(returnHref);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했습니다.");
      setBusy(false);
    }
  }

  const form = (
      <form id={embedded ? "studio-trpg-scenario-form" : undefined} onSubmit={(e) => void save(e)} className="space-y-4">
        <AppSectionCard title="기본">
          <label className="block text-sm text-zinc-300">
            제목 *
            <input
              value={title}
              maxLength={TRPG_SCENARIO_TITLE_LIMIT}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            한 줄 요약
            <input
              value={summary}
              maxLength={TRPG_SCENARIO_SUMMARY_LIMIT}
              onChange={(e) => setSummary(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            시나리오 본문 *
            <textarea
              value={content}
              maxLength={TRPG_SCENARIO_CONTENT_LIMIT}
              rows={10}
              onChange={(e) => setContent(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            숨겨진 설정 (비밀)
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              진범, 반전, GM만 알아야 할 설정. 플레이어 화면·봇 자리에는 안 나갑니다. 공개 시나리오여도 이 칸은 숨깁니다.
            </span>
            <textarea
              value={secretContent}
              maxLength={TRPG_SCENARIO_SECRET_LIMIT}
              rows={6}
              onChange={(e) => setSecretContent(e.target.value)}
              placeholder="예: 역무원은 이미 죽은 사람이다. 유령 기차의 목적지는 산 자들의 마을이 아니다."
              className="mt-1 w-full rounded-xl border border-amber-500/20 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            연결 세계관
            <select
              value={worldId}
              onChange={(e) => setWorldId(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            >
              <option value="">없음</option>
              {catalog.myWorlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setVisibility("private")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                visibility === "private" ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
              }`}
            >
              비공개
            </button>
            <button
              type="button"
              onClick={() => setVisibility("public")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                visibility === "public" ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
              }`}
            >
              공개 (TRPG 탭)
            </button>
          </div>
          <div className="mt-4">
            <GenrePicker value={genres} onChange={setGenres} />
          </div>
        </AppSectionCard>

        <AppSectionCard title="시작 위치 · 기본 PC 시트">
          <p className="mb-3 text-sm text-zinc-400">
            플레이어 시트 초안입니다. 자동 배분은 시나리오 본문 키워드로 30포인트를 나눕니다. 캠페인 시작 전에 다시 고칠 수 있습니다.
          </p>
          <label className="block text-sm text-zinc-300">
            시작 장소
            <input
              value={startLocation}
              onChange={(e) => setStartLocation(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            시작 소지품 (쉼표로 구분)
            <input
              value={inventoryText}
              onChange={(e) => setInventoryText(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DEFAULT_TRPG_STAT_DEFS.map((def) => (
              <label key={def.key} className="text-sm text-zinc-300">
                {def.label}
                <input
                  type="number"
                  min={def.min}
                  max={def.max}
                  value={stats[def.key] ?? def.min}
                  onChange={(e) => setStats((prev) => ({ ...prev, [def.key]: Number(e.target.value) }))}
                  className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">합계 {spent} / 30</p>
          <button
            type="button"
            onClick={() => setStats(suggestBotStats([title, summary, content].join("\n")))}
            className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200"
          >
            본문으로 자동 배분
          </button>
        </AppSectionCard>

        <AppSectionCard title="시나리오 NPC (모브)">
          <p className="mb-3 text-sm text-zinc-400">
            이야기 진행을 돕는 모브입니다. 플레이어 캐릭터가 아니며 모델 자리를 쓰지 않습니다. 최대{" "}
            {TRPG_SCENARIO_MAX_NPCS}명. 이름·소개는 장면에 나가고, 말투·진행 메모는 GM만 봅니다.
          </p>
          {npcs.map((npc, index) => (
            <div key={index} className="mb-3 rounded-xl border border-white/10 p-3">
              <input
                value={npc.name}
                placeholder="이름"
                onChange={(e) =>
                  setNpcs((prev) => prev.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
                }
                className="min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
              />
              <textarea
                value={npc.description}
                placeholder="소개 (장면에 나감)"
                rows={2}
                onChange={(e) =>
                  setNpcs((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, description: e.target.value } : row))
                  )
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
              />
              <textarea
                value={npc.greeting}
                placeholder="말투 힌트 (GM만)"
                rows={2}
                onChange={(e) =>
                  setNpcs((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, greeting: e.target.value } : row))
                  )
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
              />
              <textarea
                value={npc.systemPrompt}
                placeholder="진행 메모 (GM만, 플레이어·모델 자리에 안 나감)"
                rows={3}
                onChange={(e) =>
                  setNpcs((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, systemPrompt: e.target.value } : row))
                  )
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setNpcs((prev) => prev.filter((_, i) => i !== index))}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-rose-200"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={npcs.length >= TRPG_SCENARIO_MAX_NPCS}
            onClick={() => setNpcs((prev) => [...prev, emptyNpc()])}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 disabled:opacity-50"
          >
            모브 NPC 추가
          </button>
        </AppSectionCard>

        <AppSectionCard title="플레이어 캐릭터">
          <p className="mb-3 text-sm text-zinc-400">
            유저와 함께 TR하는 캐릭터입니다. 최대 {TRPG_SCENARIO_MAX_BOTS}명이고, 각자 모델이 돌아갑니다. 시나리오
            NPC(모브)와는 별개입니다. 다른 제작자 캐릭터를 데려오면 유료 포인트 사용 시 그 제작자에게 최대 5% CP가
            갑니다. 공식 캐릭터는 CP가 없습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            {catalog.myCharacters.map((c) => {
              const on = characterIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setCharacterIds((prev) => {
                      if (on) return prev.filter((id) => id !== c.id);
                      if (prev.length >= TRPG_SCENARIO_MAX_BOTS) return prev;
                      return [...prev, c.id];
                    })
                  }
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    on ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
                  }`}
                >
                  {c.emoji} {c.name}
                </button>
              );
            })}
          </div>
        </AppSectionCard>

        {error ? (
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
        ) : null}

        {embedded ? null : (
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "저장 중…" : "시나리오 저장"}
          </button>
        )}
      </form>
  );

  if (embedded) {
    return (
      <div className="pb-24">
        {form}
        <StudioSaveBar
          formId="studio-trpg-scenario-form"
          saveType="submit"
          saveLabel={busy ? "저장 중…" : "시나리오 저장"}
          saveDisabled={busy}
          error={error || null}
        />
      </div>
    );
  }

  return (
    <AppPageShell
      title={initial ? "TRPG 시나리오 수정" : "TRPG 시나리오 만들기"}
      description="세계관·기본 PC 시트·모브 NPC·플레이어 캐릭터를 한 묶음으로 저장합니다. 공개/비공개는 목록 노출이고, 숨겨진 설정은 플레이어에게 보이지 않고 GM만 봅니다."
      narrow
    >
      {form}
    </AppPageShell>
  );
}
