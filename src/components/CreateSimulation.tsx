"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AssetManagerGrid, { type ManagedAsset } from "@/components/AssetManagerGrid";
import GenrePicker from "@/components/GenrePicker";
import ToggleSwitch from "@/components/ToggleSwitch";
import { StudioBackLink } from "@/components/studio/StudioEmptyState";
import type { CharacterGenre } from "@/lib/characterGenres";
import {
  AI_LEARNING_LIMIT,
  AI_LEARNING_MIN,
  GREETING_LIMIT,
  TAGLINE_LIMIT,
} from "@/lib/characterFormLimits";
import { CHARACTER_NAME_LIMIT } from "@/lib/characters";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import {
  buildSimulationSystemPrompt,
  SIMULATION_CAST_EXAMPLE,
} from "@/lib/simulationMode";
import {
  cn,
  studioInputClass,
  studioSelectClass,
  studioSurface,
  studioType,
} from "@/lib/studioDesign";
import type { WorldListItem } from "@/lib/worlds";

const MAX_IMAGES = 20;

type SimulationForm = {
  name: string;
  tagline: string;
  description: string;
  world: string;
  simulation_cast: string;
  simulation_rules: string;
  greeting: string;
  genres: CharacterGenre[];
  tags: string;
  audience: "all" | "female" | "male";
  visibility: "public" | "link" | "private";
  nsfw: boolean;
  comments_enabled: boolean;
};

type ImportCharacter = {
  id: number;
  name: string;
  tagline: string;
  creatorName: string;
  owned: boolean;
  nsfw: boolean;
  promptChars: number;
  thumbnail: string | null;
};

type SelectedImport = {
  characterId: number;
  name: string;
  creatorName: string;
  promptChars: number;
};

const EMPTY_FORM: SimulationForm = {
  name: "",
  tagline: "",
  description: "",
  world: "",
  simulation_cast: "",
  simulation_rules: "",
  greeting: "",
  genres: [],
  tags: "",
  audience: "all",
  visibility: "public",
  nsfw: false,
  comments_enabled: true,
};

function draftKey(userId: number, editId: number | null) {
  return `hobbyai.simulationDraft.v1:${userId}:${editId ?? "new"}`;
}

function Counter({ now, max }: { now: number; max: number }) {
  return (
    <span className={cn("text-xs tabular-nums", now > max ? "font-bold text-rose-400" : "text-zinc-500")}>
      {now.toLocaleString()} / {max.toLocaleString()}자
    </span>
  );
}

function Field({
  label,
  helper,
  counter,
  children,
}: {
  label: string;
  helper?: string;
  counter?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-sm font-semibold text-zinc-200">
        <span>{label}</span>
        {counter}
      </span>
      {children}
      {helper ? <span className={cn(studioType.helper, "mt-1.5 block")}>{helper}</span> : null}
    </label>
  );
}

export default function CreateSimulation({
  userId,
  editSimulationId = null,
}: {
  userId: number;
  editSimulationId?: number | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const [form, setForm] = useState<SimulationForm>(EMPTY_FORM);
  const [assets, setAssets] = useState<ManagedAsset[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [worlds, setWorlds] = useState<WorldListItem[]>([]);
  const [worldId, setWorldId] = useState<number | null>(null);
  const [imports, setImports] = useState<SelectedImport[]>([]);
  const [importOptions, setImportOptions] = useState<ImportCharacter[]>([]);
  const [importSearch, setImportSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(Boolean(editSimulationId));
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");

  const compiledSystemPrompt = useMemo(
    () => buildSimulationSystemPrompt({ cast: form.simulation_cast, rules: form.simulation_rules }),
    [form.simulation_cast, form.simulation_rules],
  );
  const importedLearningChars = imports.reduce((sum, item) => sum + item.promptChars + 80, 0);
  const learningTotal = form.world.length + compiledSystemPrompt.length + importedLearningChars;

  useEffect(() => {
    fetch("/api/worlds")
      .then((res) => res.json())
      .then((data) => setWorlds(Array.isArray(data.worlds) ? data.worlds : []))
      .catch(() => setWorlds([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch(`/api/simulations/characters?nsfw=${form.nsfw ? "1" : "0"}&q=${encodeURIComponent(importSearch)}`)
        .then((res) => res.json())
        .then((data) => setImportOptions(Array.isArray(data.characters) ? data.characters : []))
        .catch(() => setImportOptions([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [form.nsfw, importSearch]);

  useEffect(() => {
    if (!editSimulationId) {
      try {
        const raw = localStorage.getItem(draftKey(userId, null));
        if (raw) {
          const draft = JSON.parse(raw) as { form?: Partial<SimulationForm>; assets?: ManagedAsset[]; worldId?: number | null; imports?: SelectedImport[] };
          setForm({ ...EMPTY_FORM, ...(draft.form ?? {}) });
          setAssets(Array.isArray(draft.assets) ? draft.assets : []);
          setWorldId(draft.worldId ?? null);
          setImports(Array.isArray(draft.imports) ? draft.imports : []);
          setDraftNotice("자동 저장된 초안을 복원했습니다.");
        }
      } catch {
        /* Ignore damaged browser drafts. */
      }
      restoredRef.current = true;
      return;
    }

    let cancelled = false;
    fetch(`/api/characters/${editSimulationId}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data.error || "시뮬레이션을 불러오지 못했습니다.");
        if (data.content_kind !== "simulation") {
          throw new Error("시뮬레이션이 아닌 콘텐츠입니다. 캐릭터 제작 페이지에서 수정해 주세요.");
        }
        setForm({
          name: String(data.name ?? ""),
          tagline: String(data.tagline ?? ""),
          description: String(data.description ?? ""),
          world: String(data.world ?? ""),
          simulation_cast: String(data.simulation_cast ?? ""),
          simulation_rules: String(data.simulation_rules ?? ""),
          greeting: String(data.greeting ?? ""),
          genres: Array.isArray(data.genres) ? data.genres : [],
          tags: String(data.tags ?? ""),
          audience: (["all", "female", "male"].includes(data.audience) ? data.audience : "all") as SimulationForm["audience"],
          visibility: (["public", "link", "private"].includes(data.visibility) ? data.visibility : "private") as SimulationForm["visibility"],
          nsfw: data.nsfw === true,
          comments_enabled: data.comments_enabled !== false,
        });
        setAssets(Array.isArray(data.assets) ? data.assets : []);
        setWorldId(data.world_id ? Number(data.world_id) : null);
        setImports(Array.isArray(data.simulation_imports) ? data.simulation_imports : []);
        restoredRef.current = true;
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editSimulationId, userId]);

  useEffect(() => {
    if (!restoredRef.current || initialLoading) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey(userId, editSimulationId),
          JSON.stringify({ form, assets, worldId, imports, savedAt: Date.now() }),
        );
        setDraftNotice("이 브라우저에 자동 저장됨");
      } catch {
        /* Ignore quota failures. */
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [assets, editSimulationId, form, imports, initialLoading, userId, worldId]);

  function update<K extends keyof SimulationForm>(key: K, value: SimulationForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_IMAGES - assets.length - files.length;
    const picked = Array.from(list).slice(0, Math.max(0, room));
    setFiles((current) => [...current, ...picked]);
    setPreviews((current) => [...current, ...picked.map((file) => URL.createObjectURL(file))]);
  }

  function removePendingFile(index: number) {
    URL.revokeObjectURL(previews[index] ?? "");
    setFiles((items) => items.filter((_, i) => i !== index));
    setPreviews((items) => items.filter((_, i) => i !== index));
  }

  async function uploadPendingAssets(): Promise<ManagedAsset[]> {
    if (files.length === 0) return assets;
    setProgress(`이미지 ${files.length}장 업로드 중…`);
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    const res = await fetch("/api/upload", { method: "POST", body });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.urls)) {
      throw new Error(data.error || "이미지 업로드에 실패했습니다.");
    }
    const uploaded = data.urls.map((url: string, index: number) => ({
      url,
      tag: index === 0 && assets.length === 0 ? "대표 이미지" : `장면 이미지 ${assets.length + index + 1}`,
      public: true,
      chat: true,
      viewerBlur: assets.length + index > 0,
    }));
    return [...assets, ...uploaded];
  }

  function validate() {
    if (!form.name.trim()) return "시뮬레이션 이름을 입력해 주세요.";
    if (!form.tagline.trim()) return "한 줄 소개를 입력해 주세요.";
    if (!form.world.trim()) return "세계관을 입력해 주세요.";
    if (!form.simulation_cast.trim()) return "등장 캐릭터 설정을 입력해 주세요.";
    if (learningTotal < AI_LEARNING_MIN) return `세계관과 캐릭터 설정을 합쳐 ${AI_LEARNING_MIN.toLocaleString()}자 이상 작성해 주세요.`;
    if (learningTotal > AI_LEARNING_LIMIT) return `세계관과 캐릭터 설정은 합쳐 ${AI_LEARNING_LIMIT.toLocaleString()}자 이하여야 합니다.`;
    if (!form.greeting.trim()) return "시작 장면을 입력해 주세요.";
    if (form.genres.length === 0) return "장르를 1개 이상 선택해 주세요.";
    if (assets.length === 0 && files.length === 0) return "대표 이미지를 1장 이상 추가해 주세요.";
    return "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const finalAssets = await uploadPendingAssets();
      setProgress(editSimulationId ? "시뮬레이션 수정 중…" : "시뮬레이션 만드는 중…");
      const endpoint = editSimulationId ? `/api/characters/${editSimulationId}` : "/api/characters";
      const res = await fetch(endpoint, {
        method: editSimulationId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          world_id: worldId ?? undefined,
          content_kind: "simulation",
          system_prompt: form.simulation_cast,
          assets: finalAssets,
          gender: "other",
          emoji: "🎭",
          hue: 275,
          recommended_writing_style: "balanced",
          simulation_import_ids: imports.map((item) => item.characterId),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장에 실패했습니다.");
      localStorage.removeItem(draftKey(userId, editSimulationId));
      router.push(`/character/${data.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  if (initialLoading) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-sm text-zinc-500">시뮬레이션을 불러오는 중…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-8">
      <StudioBackLink href="/studio?tab=simulations">제작 목록으로</StudioBackLink>
      <div className="mt-4">
        <h1 className={studioType.heading}>{editSimulationId ? "시뮬레이션 수정" : "시뮬레이션 만들기"}</h1>
        <p className={cn(studioType.helper, "mt-2")}>
          여러 캐릭터를 따로 만들 필요 없이, 세계관과 등장인물 설정을 한 번에 작성하면 됩니다.
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <section className={cn(studioSurface.card, "space-y-4 p-4 sm:p-6")}>
          <h2 className="font-bold text-white">1. 기본 정보</h2>
          <Field label="시뮬레이션 이름 *" counter={<Counter now={form.name.length} max={CHARACTER_NAME_LIMIT} />}>
            <input className={studioInputClass} maxLength={CHARACTER_NAME_LIMIT} value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="예: 회색 생태권 — 제3격리구역" />
          </Field>
          <Field label="한 줄 소개 *" counter={<Counter now={form.tagline.length} max={TAGLINE_LIMIT} />}>
            <input className={studioInputClass} maxLength={TAGLINE_LIMIT} value={form.tagline} onChange={(e) => update("tagline", e.target.value)} placeholder="여러 생존자와 감염체가 독립적으로 움직이는 격리구역" />
          </Field>
          <Field label="상세 소개" counter={<Counter now={form.description.length} max={PROFILE_BIOGRAPHY_LIMIT} />} helper="소개 페이지에만 표시되며 AI 설정 글자 수에는 포함되지 않습니다.">
            <textarea className={studioInputClass} rows={5} maxLength={PROFILE_BIOGRAPHY_LIMIT} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="유저가 경험할 분위기, 목표, 특징을 소개해 주세요." />
          </Field>
        </section>

        <section className={cn(studioSurface.card, "space-y-5 border-violet-500/25 p-4 sm:p-6")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-bold text-violet-200">2. AI 학습 영역</h2>
              <p className={cn(studioType.helper, "mt-1")}>형식은 자유입니다. 인물별 이름·성격·말투·목표·관계를 알아볼 수 있게 적어 주세요.</p>
            </div>
            <Counter now={learningTotal} max={AI_LEARNING_LIMIT} />
          </div>

          {worlds.length > 0 ? (
            <Field label="저장한 세계관 불러오기">
              <select
                className={studioSelectClass}
                value={worldId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setWorldId(id);
                  const selected = worlds.find((world) => world.id === id);
                  if (selected) update("world", selected.content);
                }}
              >
                <option value="">직접 작성</option>
                {worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
              </select>
            </Field>
          ) : null}

          <Field label="세계관 *" helper="시대, 장소, 세력, 규칙, 위험 요소와 현재 상황을 자유롭게 작성하세요.">
            <textarea className={studioInputClass} rows={10} value={form.world} onChange={(e) => { setWorldId(null); update("world", e.target.value); }} placeholder="이 세계가 어떻게 돌아가는지 자유롭게 작성하세요." />
          </Field>

          <Field label="등장 캐릭터 설정 *" helper="한 명씩 별도 캐릭터로 등록할 필요가 없습니다. NPC·악역·세력 대표도 이곳에 함께 적을 수 있습니다.">
            <div className="space-y-2">
              <textarea className={studioInputClass} rows={20} value={form.simulation_cast} onChange={(e) => update("simulation_cast", e.target.value)} placeholder={SIMULATION_CAST_EXAMPLE} />
              {!form.simulation_cast.trim() ? (
                <button type="button" onClick={() => update("simulation_cast", SIMULATION_CAST_EXAMPLE)} className="text-xs font-semibold text-violet-300 hover:text-violet-200">예시 형식 넣기</button>
              ) : null}
            </div>
          </Field>

          <p className={cn(studioType.caption, learningTotal < AI_LEARNING_MIN || learningTotal > AI_LEARNING_LIMIT ? "text-amber-300" : "text-zinc-500")}>
            세계관+등장인물+추가 규칙 합계 {AI_LEARNING_MIN.toLocaleString()}~{AI_LEARNING_LIMIT.toLocaleString()}자
          </p>
        </section>

        <section className={cn(studioSurface.card, "space-y-4 p-4 sm:p-6")}>
          <h2 className="font-bold text-white">3. 시작 장면</h2>
          <Field label="첫 메시지·시작 장면 *" counter={<Counter now={form.greeting.length} max={GREETING_LIMIT} />} helper="유저가 처음 입장했을 때 보게 될 장면입니다. 여러 캐릭터가 등장해도 됩니다.">
            <textarea className={studioInputClass} rows={10} maxLength={GREETING_LIMIT} value={form.greeting} onChange={(e) => update("greeting", e.target.value)} placeholder="경보음이 꺼진 뒤, 검문소 안에는 세 사람의 숨소리만 남았다…" />
          </Field>
        </section>

        <section className={cn(studioSurface.card, "space-y-4 p-4 sm:p-6")}>
          <h2 className="font-bold text-white">4. 대표 이미지와 장르</h2>
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={assets.length + files.length >= MAX_IMAGES} className="min-h-20 w-full rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 text-sm font-semibold text-zinc-400 hover:border-violet-500/50 hover:text-violet-200 disabled:opacity-40">
              이미지 추가 · {assets.length + files.length}/{MAX_IMAGES}장
            </button>
            {previews.length > 0 ? (
              <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {previews.map((src, index) => (
                  <div key={src} className="relative overflow-hidden rounded-xl border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="업로드 대기" className="aspect-[2/3] w-full object-cover object-top" />
                    <button type="button" onClick={() => removePendingFile(index)} className="absolute right-1 top-1 rounded-md bg-black/75 px-2 py-1 text-xs text-white">삭제</button>
                  </div>
                ))}
              </div>
            ) : null}
            {assets.length > 0 ? <div className="mt-4"><AssetManagerGrid assets={assets} onChange={setAssets} onRemove={(index) => setAssets((items) => items.filter((_, i) => i !== index))} /></div> : null}
          </div>
          <GenrePicker value={form.genres} onChange={(genres) => update("genres", genres)} disabled={loading} />
          <Field label="태그"><input className={studioInputClass} value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="생존, 다인, 미스터리 (쉼표로 구분)" /></Field>
        </section>

        <details className={cn(studioSurface.card, "group p-4 sm:p-6")}>
          <summary className="cursor-pointer list-none font-bold text-zinc-200">고급 설정 <span className="ml-1 text-xs font-normal text-zinc-500">선택 사항</span></summary>
          <div className="mt-5 space-y-4">
            <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-4">
              <div>
                <p className="text-sm font-semibold text-zinc-200">기존 캐릭터 불러오기</p>
                <p className={cn(studioType.helper, "mt-1")}>
                  선택 사항입니다. 내 캐릭터 또는 원작자가 재사용을 허용한 공개 캐릭터만 표시되며, 원본 설정은 화면에 노출되지 않습니다.
                </p>
              </div>
              {imports.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {imports.map((item) => (
                    <button
                      type="button"
                      key={item.characterId}
                      onClick={() => setImports((current) => current.filter((entry) => entry.characterId !== item.characterId))}
                      className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100"
                      title="클릭하여 제거"
                    >
                      {item.name} <span className="text-cyan-300/60">×</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <input className={studioInputClass} value={importSearch} onChange={(e) => setImportSearch(e.target.value)} placeholder="캐릭터 또는 제작자 검색" />
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {importOptions.map((character) => {
                  const selected = imports.some((item) => item.characterId === character.id);
                  return (
                    <button
                      type="button"
                      key={character.id}
                      disabled={selected || imports.length >= 12}
                      onClick={() => setImports((current) => [...current, {
                        characterId: character.id,
                        name: character.name,
                        creatorName: character.creatorName,
                        promptChars: character.promptChars,
                      }])}
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#0d0f17] p-3 text-left hover:border-cyan-500/35 disabled:opacity-40"
                    >
                      {character.thumbnail ? <img src={character.thumbnail} alt="" className="h-11 w-11 rounded-lg object-cover object-top" /> : <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/5">🎭</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-white">{character.name}</span>
                        <span className="block truncate text-[10px] text-zinc-500">{character.owned ? "내 캐릭터" : `${character.creatorName} · 재사용 허용`}</span>
                      </span>
                      <span className="text-cyan-300">＋</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="시뮬레이션 추가 규칙" helper="장면 전환, 사건 발생, 승패 처리처럼 전체 진행에만 적용할 규칙입니다.">
              <textarea className={studioInputClass} rows={7} value={form.simulation_rules} onChange={(e) => update("simulation_rules", e.target.value)} placeholder="예: 인물은 자신이 직접 알게 된 정보만 사용한다. 위험은 유저에게 유리하게 자동 해결하지 않는다." />
            </Field>
            <Field label="공개 범위">
              <select className={studioSelectClass} value={form.visibility} onChange={(e) => update("visibility", e.target.value as SimulationForm["visibility"])}>
                <option value="public">전체 공개 — 목록과 검색에 노출</option>
                <option value="link">링크 공개 — 주소를 아는 사람만</option>
                <option value="private">비공개 — 나만 이용</option>
              </select>
            </Field>
            <Field label="타깃 취향">
              <select className={studioSelectClass} value={form.audience} onChange={(e) => update("audience", e.target.value as SimulationForm["audience"])}>
                <option value="all">공용</option><option value="female">여성향</option><option value="male">남성향</option>
              </select>
            </Field>
            <ToggleSwitch checked={form.nsfw} onChange={(value) => update("nsfw", value)} label="19+ 시뮬레이션" description="성인인증 및 성인 보기 설정을 완료한 이용자에게만 노출됩니다." />
            <ToggleSwitch checked={form.comments_enabled} onChange={(value) => update("comments_enabled", value)} label="댓글 허용" />
          </div>
        </details>

        {draftNotice ? <p className="text-xs text-zinc-500">{draftNotice}</p> : null}
        {error ? <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p> : null}
        <button type="submit" disabled={loading} className="min-h-12 w-full rounded-xl bg-violet-600 px-5 font-bold text-white transition hover:bg-violet-500 disabled:opacity-50">
          {loading ? progress || "저장 중…" : editSimulationId ? "시뮬레이션 수정 완료" : "시뮬레이션 만들기"}
        </button>
      </form>
    </div>
  );
}
