"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppPageShell, AppSectionCard } from "@/components/AppPageShell";
import GenrePicker from "@/components/GenrePicker";
import StudioSaveBar from "@/components/studio/StudioSaveBar";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import type { CharacterGenre } from "@/lib/characterGenres";
import {
  TRPG_SCENARIO_BUNDLE_LIMIT,
  TRPG_SCENARIO_CONTENT_LIMIT,
  TRPG_SCENARIO_MAX_NPCS,
  TRPG_SCENARIO_NPC_DESCRIPTION_LIMIT,
  TRPG_SCENARIO_NPC_GREETING_LIMIT,
  TRPG_SCENARIO_NPC_NAME_LIMIT,
  TRPG_SCENARIO_NPC_PROMPT_LIMIT,
  TRPG_SCENARIO_SECRET_LIMIT,
  TRPG_SCENARIO_SUMMARY_LIMIT,
  TRPG_SCENARIO_TITLE_LIMIT,
  countScenarioBundleChars,
  remainingScenarioFieldMax,
  scenarioBundleLimitError,
  type TrpgScenarioNpc,
  type TrpgScenarioTemplate,
} from "@/lib/trpg/scenarioTypes";
import { DEFAULT_TRPG_STAT_KEYS, TRPG_STAT_CATALOG, defsFromKeys } from "@/lib/trpg/stats";
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
  const [statKeys, setStatKeys] = useState<string[]>(() =>
    initial?.statKeys?.length ? initial.statKeys : [...DEFAULT_TRPG_STAT_KEYS]
  );
  const [npcs, setNpcs] = useState<TrpgScenarioNpc[]>(initial?.npcs?.length ? initial.npcs : []);
  const [genres, setGenres] = useState<CharacterGenre[]>(initial?.genres ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const namedNpcs = npcs.filter((n) => n.name.trim());
  const linkedWorld = typeof worldId === "number" ? catalog.myWorlds.find((w) => w.id === worldId) : undefined;
  const bundleUsed = countScenarioBundleChars({
    worldSummary: linkedWorld?.summary,
    worldContent: linkedWorld?.content,
    summary,
    content,
    secretContent,
    npcs: namedNpcs,
  });
  const bundleOver = bundleUsed > TRPG_SCENARIO_BUNDLE_LIMIT;
  const worldChars = countScenarioBundleChars({
    worldSummary: linkedWorld?.summary,
    worldContent: linkedWorld?.content,
  });
  const scenarioChars = countScenarioBundleChars({ summary, content });
  const secretChars = countScenarioBundleChars({ secretContent });
  const npcChars = countScenarioBundleChars({ npcs: namedNpcs });
  const contentMax = remainingScenarioFieldMax(
    bundleUsed,
    countScenarioBundleChars({ content }),
    TRPG_SCENARIO_CONTENT_LIMIT
  );
  const secretMax = remainingScenarioFieldMax(
    bundleUsed,
    countScenarioBundleChars({ secretContent }),
    TRPG_SCENARIO_SECRET_LIMIT
  );
  const summaryMax = remainingScenarioFieldMax(
    bundleUsed,
    countScenarioBundleChars({ summary }),
    TRPG_SCENARIO_SUMMARY_LIMIT
  );

  function toggleStatKey(key: string) {
    setStatKeys((prev) => {
      const on = prev.includes(key);
      const next = on ? prev.filter((k) => k !== key) : [...prev, key];
      if (next.length === 0) return prev;
      return defsFromKeys(next).map((d) => d.key);
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (bundleOver) {
      setError(scenarioBundleLimitError(bundleUsed));
      return;
    }
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
      defaultPcStats: null,
      statKeys,
      npcs: npcs.filter((n) => n.name.trim()),
      characterIds: [],
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
              maxLength={summaryMax}
              onChange={(e) => setSummary(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            시나리오 본문 *
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              GM이 이번 캠페인에서 참고하는 공개 설정입니다. 배경·장소·이번 이야기 흐름을 적습니다. 세계관도 여기에
              적어도 됩니다. 비워 두면 시나리오가 성립하지 않습니다.
            </span>
            <textarea
              value={content}
              maxLength={contentMax}
              rows={10}
              onChange={(e) => setContent(e.target.value)}
              placeholder="예: 눈 덮인 북부 공국. 얼음 마법이 흔하다. 한밤의 폐역에서 유령 기차를 기다린다."
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <div className="mt-3">
            <p className="text-sm text-zinc-300">이미 만든 세계관 재사용 (선택)</p>
            <p className="mt-1 text-xs font-normal text-zinc-500">
              GM 전용 비밀이 아닙니다. 「캐릭터·시뮬레이션 세계관」에 이미 써 둔 문서를 여러 시나리오에서 다시 쓸 때만
              고르세요. 고르면 그 본문이 시나리오 본문 앞에 붙어 GM 세계 설정에 들어갑니다. 안 골라도 됩니다. 세계관은
              위 본문에 적어도 충분합니다.
            </p>
            {catalog.myWorlds.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">아직 저장한 세계관 문서가 없습니다.</p>
            ) : (
              <select
                value={worldId}
                onChange={(e) => setWorldId(e.target.value ? Number(e.target.value) : "")}
                className="mt-2 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
              >
                <option value="">없음 — 시나리오 본문만 사용</option>
                {catalog.myWorlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            {linkedWorld && (linkedWorld.summary.trim() || linkedWorld.content.trim()) ? (
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-zinc-500">
                붙을 내용: {linkedWorld.summary.trim() || linkedWorld.content.trim()}
              </p>
            ) : null}
          </div>
          <label className="mt-3 block text-sm text-zinc-300">
            숨겨진 설정 (비밀)
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              진범, 반전, GM만 알아야 할 설정. 플레이어 화면·봇 자리에는 안 나갑니다. 공개 시나리오여도 이 칸은 숨깁니다.
            </span>
            <textarea
              value={secretContent}
              maxLength={secretMax}
              rows={6}
              onChange={(e) => setSecretContent(e.target.value)}
              placeholder="예: 역무원은 이미 죽은 사람이다. 유령 기차의 목적지는 산 자들의 마을이 아니다."
              className="mt-1 w-full rounded-xl border border-amber-500/20 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <p
            className={`mt-3 text-base font-semibold tabular-nums tracking-tight ${
              bundleOver ? "text-rose-400" : "text-amber-300"
            }`}
          >
            세계관+시나리오+비밀+NPC {bundleUsed.toLocaleString()} / {TRPG_SCENARIO_BUNDLE_LIMIT.toLocaleString()}자
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            불러온 세계관과 이 시나리오에 추가로 쓰는 본문·숨겨진 설정·NPC를 합쳐{" "}
            {TRPG_SCENARIO_BUNDLE_LIMIT.toLocaleString()}자입니다. 세계관 {worldChars.toLocaleString()} · 시나리오{" "}
            {scenarioChars.toLocaleString()} · 비밀 {secretChars.toLocaleString()} · NPC {npcChars.toLocaleString()}
          </p>
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

        <AppSectionCard title="시작 위치 · 상태값">
          <p className="mb-3 text-sm text-zinc-400">
            이 시나리오 시트에 넣을 상태값만 고르세요. 숫자는 참가자가 페르소나에 맞춰 로비에서 배분하고, AI 캐릭터는
            본문으로 자동 배분하거나 방장이 로비에서 맞춥니다. 일반 세계관만으로 시작하는 캠페인은 힘·민첩·지능·지혜·매력·체력
            6종만 씁니다.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TRPG_STAT_CATALOG.map((entry) => {
              const on = statKeys.includes(entry.key);
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => toggleStatKey(entry.key)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    on ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
                  }`}
                  title={entry.description}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
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
                maxLength={remainingScenarioFieldMax(
                  bundleUsed,
                  npc.name.trim().length,
                  TRPG_SCENARIO_NPC_NAME_LIMIT
                )}
                onChange={(e) =>
                  setNpcs((prev) => prev.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
                }
                className="min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
              />
              <textarea
                value={npc.description}
                placeholder="소개 (장면에 나감)"
                rows={2}
                maxLength={remainingScenarioFieldMax(
                  bundleUsed,
                  npc.description.trim().length,
                  TRPG_SCENARIO_NPC_DESCRIPTION_LIMIT
                )}
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
                maxLength={remainingScenarioFieldMax(
                  bundleUsed,
                  npc.greeting.trim().length,
                  TRPG_SCENARIO_NPC_GREETING_LIMIT
                )}
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
                maxLength={remainingScenarioFieldMax(
                  bundleUsed,
                  npc.systemPrompt.trim().length,
                  TRPG_SCENARIO_NPC_PROMPT_LIMIT
                )}
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

        {error || bundleOver ? (
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error || scenarioBundleLimitError(bundleUsed)}
          </p>
        ) : null}

        {embedded ? null : (
          <button
            type="submit"
            disabled={busy || bundleOver}
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
          saveDisabled={busy || bundleOver}
          error={error || (bundleOver ? scenarioBundleLimitError(bundleUsed) : null)}
        />
      </div>
    );
  }

  return (
    <AppPageShell
      title={initial ? "TRPG 시나리오 수정" : "TRPG 시나리오 만들기"}
      description="시나리오 본문이 GM이 참고하는 이번 이야기입니다. 세계관도 본문에 적어도 되고, 이미 만든 세계관 문서는 선택으로 붙일 수 있습니다. 불러온 세계관과 시나리오 본문·숨겨진 설정·NPC는 합쳐 10,000자입니다. 숨겨진 설정만 GM 전용입니다."
      narrow
    >
      {form}
    </AppPageShell>
  );
}
