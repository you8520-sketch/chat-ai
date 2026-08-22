"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AppPageShell, AppSectionCard } from "@/components/AppPageShell";
import AssetManagerGrid from "@/components/AssetManagerGrid";
import GenrePicker from "@/components/GenrePicker";
import StudioSaveBar from "@/components/studio/StudioSaveBar";
import { defaultAssetFlags, withAssetSize, type CharacterAsset } from "@/lib/characterAssets";
import type { CharacterGenre } from "@/lib/characterGenres";
import { measureImageUrl } from "@/lib/measureImageSize";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import {
  TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR,
  TRPG_SCENARIO_MAX_ASSETS,
  assertScenarioAssetOrientations,
} from "@/lib/trpg/scenarioAssets";
import {
  emptyTrpgScenarioPlan,
  lintTrpgScenarioPlan,
  type TrpgScenarioDifficulty,
  type TrpgScenarioPlan,
  type TrpgScenarioPlayLength,
} from "@/lib/trpg/scenarioPlan";
import type { TrpgScenarioDraftField, TrpgScenarioDraftMode } from "@/lib/trpg/scenarioDraft";
import {
  isScenarioEditorDirty,
  optionalDepthFilled,
  scenarioEditorSavePayload,
  scenarioEditorSnapshot,
  scrollToScenarioField,
  shouldConfirmScenarioDraftApply,
  type ScenarioEditorSnapshot,
} from "@/lib/trpg/scenarioEditorState";
import { scenarioPersistDecision, scenarioPlayCtaLabel, trpgPlayHref } from "@/lib/trpg/scenarioHandoff";
import { evaluateScenarioReadiness, type ScenarioReadinessField } from "@/lib/trpg/scenarioReadiness";
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

function listText(items: string[]): string {
  return items.join("\n");
}

function parseList(text: string): string[] {
  return text
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const PLAY_LENGTH_LABEL: Record<TrpgScenarioPlayLength, string> = {
  short: "짧게",
  medium: "보통",
  long: "길게",
  open_ended: "열린 결말",
};

const DIFFICULTY_LABEL: Record<TrpgScenarioDifficulty, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
  deadly: "치명적",
};

const SCENARIO_DRAFT_TIMEOUT_MESSAGE =
  "AI 초안 생성이 예상보다 오래 걸렸습니다. 작성 중인 내용은 그대로 보존되었습니다. 잠시 후 다시 시도해 주세요.";

function scenarioDraftErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /aborted due to timeout|timed out|timeout/i.test(error.message)
    ) {
      return SCENARIO_DRAFT_TIMEOUT_MESSAGE;
    }
    if (error.message.trim()) return error.message;
  }
  return "AI 초안에 실패했습니다.";
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
  const [assets, setAssets] = useState<CharacterAsset[]>(initial?.assets ?? []);
  const [plan, setPlan] = useState<TrpgScenarioPlan>(initial?.scenarioPlan ?? emptyTrpgScenarioPlan());
  const [lockedFields, setLockedFields] = useState<TrpgScenarioDraftField[]>([]);
  const [touchedFields, setTouchedFields] = useState<TrpgScenarioDraftField[]>(() =>
    initial?.scenarioPlan ? ["difficulty", "playLength"] : []
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [lintMessages, setLintMessages] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<number | null>(initial?.id ?? null);
  const [characterIds, setCharacterIds] = useState<number[]>(initial?.characterIds ?? []);
  const fileRef = useRef<HTMLInputElement>(null);

  function currentFields(): ScenarioEditorSnapshot {
    return {
      title,
      summary,
      content,
      secretContent,
      worldId,
      visibility,
      startLocation,
      inventoryText,
      statKeys,
      npcs,
      genres,
      assets,
      plan,
      characterIds,
    };
  }

  const [savedSnapshot, setSavedSnapshot] = useState(() => scenarioEditorSnapshot(currentFields()));
  const [lastDraftSnapshot, setLastDraftSnapshot] = useState<string | null>(null);

  const namedNpcs = npcs.filter((n) => n.name.trim());
  const linkedWorld = typeof worldId === "number" ? catalog.myWorlds.find((w) => w.id === worldId) : undefined;
  const bundleUsed = countScenarioBundleChars({
    worldSummary: linkedWorld?.summary,
    worldContent: linkedWorld?.content,
    summary,
    content,
    secretContent,
    npcs: namedNpcs,
    scenarioPlan: plan,
  });
  const bundleOver = bundleUsed > TRPG_SCENARIO_BUNDLE_LIMIT;
  const worldChars = countScenarioBundleChars({
    worldSummary: linkedWorld?.summary,
    worldContent: linkedWorld?.content,
  });
  const scenarioChars = countScenarioBundleChars({ summary, content, scenarioPlan: plan });
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
  const worldStale =
    Boolean(plan.provenance?.sourceWorldId) &&
    linkedWorld &&
    plan.provenance?.sourceWorldId === linkedWorld.id &&
    plan.provenance.sourceWorldUpdatedAt &&
    linkedWorld.updatedAt &&
    plan.provenance.sourceWorldUpdatedAt !== linkedWorld.updatedAt;
  const namedInventory = inventoryText.split(",").map((item) => item.trim()).filter(Boolean);
  const dirty = isScenarioEditorDirty(currentFields(), savedSnapshot);
  const hasManualEdits = lastDraftSnapshot
    ? isScenarioEditorDirty(currentFields(), lastDraftSnapshot)
    : dirty;
  const readiness = useMemo(
    () =>
      evaluateScenarioReadiness({
        title,
        content,
        summary,
        scenarioPlan: plan,
        npcs: namedNpcs,
        startInventory: namedInventory,
        bundleChars: bundleUsed,
      }),
    [title, content, summary, plan, namedNpcs, namedInventory, bundleUsed]
  );
  const persistDecision = scenarioPersistDecision({
    dirty,
    canPlay: readiness.canPlay,
    savedId,
  });
  const playLabel = scenarioPlayCtaLabel(persistDecision);
  const depthFilled = optionalDepthFilled({
    summary,
    content,
    secretContent,
    worldId,
    startLocation,
    inventoryText,
    npcs,
    genres,
    assets,
    visibility,
    plan,
  });
  const saveStateLabel = savedId ? (dirty ? "수정됨 · 저장 필요" : "저장됨") : "아직 저장되지 않음";

  function revealReadinessField(field: ScenarioReadinessField, section: "story" | "details") {
    if (section === "details") setDetailsOpen(true);
    if (field === "advanced" || field === "npcs" || field === "bundle") {
      setDetailsOpen(true);
      if (field === "advanced") setAdvancedOpen(true);
    }
    window.setTimeout(() => scrollToScenarioField(field), 0);
  }

  function patchPlan(partial: Partial<TrpgScenarioPlan>) {
    setPlan((prev) => ({ ...prev, ...partial }));
  }

  function toggleLock(field: TrpgScenarioDraftField) {
    setLockedFields((prev) => (prev.includes(field) ? prev.filter((item) => item !== field) : [...prev, field]));
  }

  function fallbackAssetTag(index: number): string {
    return `장면 ${index + 1}`;
  }

  function commitAssets(next: CharacterAsset[]) {
    try {
      assertScenarioAssetOrientations(next);
      setAssets(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR);
    }
  }

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const room = TRPG_SCENARIO_MAX_ASSETS - assets.length;
    setFiles([...files, ...Array.from(list)].slice(0, room));
  }

  async function tagPendingFiles() {
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    setProgress(`에셋 ${files.length}장 업로드 중…`);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = (await up.json()) as { urls?: unknown; error?: string };
      if (!up.ok) {
        setError(upData.error || "에셋 업로드에 실패했습니다.");
        return;
      }
      const uploadedUrls = Array.isArray(upData.urls)
        ? upData.urls.filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0)
        : [];
      if (uploadedUrls.length === 0) {
        setError("업로드된 이미지 URL을 확인하지 못했습니다.");
        return;
      }
      setProgress("이미지 장면 태그 분석 중…");
      let taggedAssets: Array<{ url: string; tag: string }> = [];
      try {
        const tagRes = await fetch("/api/assets/tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: uploadedUrls }),
        });
        const tagData = (await tagRes.json()) as { assets?: unknown };
        if (tagRes.ok && Array.isArray(tagData.assets)) {
          taggedAssets = tagData.assets.filter(
            (a: unknown): a is { url: string; tag: string } =>
              !!a &&
              typeof a === "object" &&
              typeof (a as { url?: unknown }).url === "string" &&
              typeof (a as { tag?: unknown }).tag === "string"
          );
        }
      } catch {
        /* fallback tags below */
      }
      const byUrl = new Map(taggedAssets.map((asset) => [asset.url, asset]));
      const measured = await Promise.all(uploadedUrls.map((url) => measureImageUrl(url)));
      const accepted: CharacterAsset[] = [];
      let rejected = 0;
      uploadedUrls.forEach((url, i) => {
        const index = assets.length + accepted.length;
        const sized = withAssetSize(
          {
            url,
            tag: byUrl.get(url)?.tag.trim() || fallbackAssetTag(index),
            ...defaultAssetFlags(assets, i),
          },
          measured[i]?.width,
          measured[i]?.height
        );
        if (index > 0 && !sized.orientation) {
          rejected += 1;
          return;
        }
        if (index > 0 && sized.orientation !== "landscape") {
          rejected += 1;
          return;
        }
        accepted.push(sized);
      });
      if (accepted.length > 0) commitAssets([...assets, ...accepted]);
      setFiles([]);
      if (rejected > 0) {
        setError(`${TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR} ${rejected}장은 추가하지 않았습니다.`);
      }
    } catch {
      setError("에셋 업로드 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function toggleStatKey(key: string) {
    setStatKeys((prev) => {
      const on = prev.includes(key);
      const next = on ? prev.filter((k) => k !== key) : [...prev, key];
      if (next.length === 0) return prev;
      return defsFromKeys(next).map((d) => d.key);
    });
  }

  function markTouched(field: TrpgScenarioDraftField) {
    setTouchedFields((prev) => (prev.includes(field) ? prev : [...prev, field]));
  }

  function existingDraft() {
    return {
      title,
      summary,
      content,
      secretContent,
      startLocation,
      startInventory: inventoryText.split(",").map((s) => s.trim()).filter(Boolean),
      npcs: namedNpcs,
      plan,
      touchedFields,
    };
  }

  async function requestDraft(mode: TrpgScenarioDraftMode, selectedFields: TrpgScenarioDraftField[] = []) {
    if (draftBusy) return;
    const existing = existingDraft();
    if (
      shouldConfirmScenarioDraftApply({
        mode,
        existing,
        selectedFields,
        lockedFields,
        hasManualEdits,
      })
    ) {
      const ok = window.confirm(
        mode === "regenerate_all"
          ? "작성한 이야기 항목을 전부 다시 만들까요? 잠근 항목만 유지됩니다."
          : "직접 수정한 항목을 다시 만들까요? 확인 후에만 덮어씁니다."
      );
      if (!ok) return;
    }
    setDraftBusy(true);
    setError("");
    try {
      const res = await fetch("/api/trpg/scenarios/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldId: worldId === "" ? null : worldId,
          mode,
          selectedFields,
          lockedFields,
          existingDraft: existingDraft(),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        draft?: {
          title: string;
          summary: string;
          startLocation: string;
          startInventory: string[];
          npcs: TrpgScenarioNpc[];
          plan: TrpgScenarioPlan;
        };
        lint?: Array<{ message: string }>;
        readiness?: ReturnType<typeof scoreTrpgScenarioReadiness>;
      };
      if (!res.ok) {
        const failure = new Error(data.error || "AI 초안을 만들지 못했습니다.");
        if (data.code === "SCENARIO_DRAFT_TIMEOUT") failure.name = "TimeoutError";
        throw failure;
      }
      if (!data.draft) throw new Error("AI 초안이 비어 있습니다.");
      const nextTitle = data.draft.title || title;
      const nextSummary = data.draft.summary || summary;
      const nextLocation = data.draft.startLocation || startLocation;
      const nextInventory = data.draft.startInventory.length
        ? data.draft.startInventory.join(", ")
        : inventoryText;
      const nextNpcs = data.draft.npcs.length ? data.draft.npcs : npcs;
      setTitle(nextTitle);
      setSummary(nextSummary);
      setStartLocation(nextLocation);
      if (data.draft.startInventory.length) setInventoryText(nextInventory);
      if (data.draft.npcs.length) setNpcs(nextNpcs);
      setPlan(data.draft.plan);
      setLastDraftSnapshot(
        scenarioEditorSnapshot({
          ...currentFields(),
          title: nextTitle,
          summary: nextSummary,
          startLocation: nextLocation,
          inventoryText: nextInventory,
          npcs: nextNpcs,
          plan: data.draft.plan,
        })
      );
      setTouchedFields((prev) => [...new Set<TrpgScenarioDraftField>([...prev, "difficulty", "playLength"])]);
      setLintMessages((data.lint ?? []).map((item) => item.message));
      if (data.draft.plan.majorEvents.length || data.draft.npcs.length) setDetailsOpen(true);
    } catch (err) {
      setError(scenarioDraftErrorMessage(err));
    } finally {
      setDraftBusy(false);
    }
  }

  async function persist(): Promise<number | null> {
    if (busy) return null;
    if (bundleOver) {
      setError(scenarioBundleLimitError(bundleUsed));
      return null;
    }
    if (!readiness.canSave) {
      const first = readiness.blockers[0];
      setError(first?.message || "플레이에 필요한 항목이 부족합니다.");
      if (first) revealReadinessField(first.field, first.section);
      return null;
    }
    const issues = lintTrpgScenarioPlan({
      plan,
      title,
      summary,
      content,
      npcs: namedNpcs,
      startInventory: namedInventory,
      bundleChars: bundleUsed,
      bundleLimit: TRPG_SCENARIO_BUNDLE_LIMIT,
    });
    setLintMessages(issues.map((item) => item.message));
    setBusy(true);
    setError("");
    const body = scenarioEditorSavePayload(currentFields());
    try {
      const targetId = savedId ?? initial?.id ?? null;
      const res = await fetch(targetId ? `/api/trpg/scenarios/${targetId}` : "/api/trpg/scenarios", {
        method: targetId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; scenario?: TrpgScenarioTemplate };
      if (!res.ok) throw new Error(data.error || "저장에 실패했습니다.");
      const id = data.scenario?.id ?? targetId;
      if (!id) throw new Error("저장된 시나리오 ID를 확인하지 못했습니다.");
      setSavedId(id);
      setCharacterIds(data.scenario?.characterIds ?? characterIds);
      setSavedSnapshot(scenarioEditorSnapshot({
        ...currentFields(),
        characterIds: data.scenario?.characterIds ?? characterIds,
      }));
      return id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했습니다.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function play() {
    if (busy || draftBusy) return;
    if (persistDecision === "blocked") {
      const first = readiness.blockers[0];
      setError(first?.message || "플레이에 필요한 항목이 부족합니다.");
      if (first) revealReadinessField(first.field, first.section);
      return;
    }
    if (persistDecision === "navigate" && savedId) {
      router.push(trpgPlayHref(savedId));
      return;
    }
    const id = await persist();
    if (!id) return;
    router.push(trpgPlayHref(id));
  }

  function LockButton({ field }: { field: TrpgScenarioDraftField }) {
    const on = lockedFields.includes(field);
    return (
      <button
        type="button"
        onClick={() => toggleLock(field)}
        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          on ? "bg-amber-500/20 text-amber-200" : "border border-white/10 text-zinc-500"
        }`}
      >
        {on ? "잠김" : "잠금"}
      </button>
    );
  }

  function RegenButton({ field, label }: { field: TrpgScenarioDraftField; label: string }) {
    return (
      <button
        type="button"
        disabled={draftBusy}
        onClick={() => void requestDraft("regenerate_selected", [field])}
        className="ml-2 text-[10px] font-semibold text-violet-300 disabled:opacity-40"
      >
        {label}만 다시 만들기
      </button>
    );
  }

  const form = (
      <form id="studio-trpg-scenario-form" onSubmit={(e) => void save(e)} className="space-y-4">
        <div
          data-scenario-readiness={readiness.status}
          className={`rounded-xl border px-3 py-2 text-sm ${
            readiness.status === "blocked"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-100"
              : readiness.status === "recommended"
                ? "border-amber-500/20 bg-amber-500/10 text-amber-50"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-50"
          }`}
        >
          <p className="font-semibold">
            {readiness.status === "blocked"
              ? "아직 플레이할 수 없습니다"
              : readiness.status === "recommended"
                ? "플레이 가능 · 보완하면 더 좋아요"
                : "플레이 가능"}
          </p>
          <p className="mt-1 text-xs opacity-80">
            {saveStateLabel}
            {" · "}
            <button type="button" onClick={() => router.push(returnHref)} className="underline">
              나가기
            </button>
          </p>
          {readiness.blockers[0] ? (
            <button
              type="button"
              onClick={() => revealReadinessField(readiness.blockers[0]!.field, readiness.blockers[0]!.section)}
              className="mt-2 text-xs font-semibold underline"
            >
              {readiness.blockers[0].message}
            </button>
          ) : readiness.recommendations[0] ? (
            <p className="mt-1 text-xs opacity-80">{readiness.recommendations[0].message}</p>
          ) : (
            <p className="mt-1 text-xs opacity-80">이 시나리오는 바로 시작할 수 있습니다.</p>
          )}
        </div>

        <AppSectionCard title="이야기">
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={draftBusy}
              onClick={() => void requestDraft("fill_empty")}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {draftBusy ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                  {typeof worldId === "number" ? "세계관 분석 · 시나리오 구성 중…" : "시나리오 구성 중…"}
                </>
              ) : (
                "✨ AI로 시나리오 초안 만들기"
              )}
            </button>
            <button
              type="button"
              disabled={draftBusy}
              onClick={() => void requestDraft("regenerate_all")}
              className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-200 disabled:opacity-50"
            >
              전체 다시 만들기
            </button>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            제목과 시작·갈등·목표·종료 조건만 있으면 테스트 플레이할 수 있습니다. AI 초안은 바로 저장되지 않습니다.
          </p>
          <label className="block text-sm text-zinc-300" data-scenario-field="title">
            제목 *
            <LockButton field="title" />
            <input
              value={title}
              maxLength={TRPG_SCENARIO_TITLE_LIMIT}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="startingSituation">
            시작 상황
            <LockButton field="startingSituation" />
            <RegenButton field="startingSituation" label="시작 상황" />
            <textarea
              value={plan.startingSituation}
              rows={4}
              onChange={(e) => patchPlan({ startingSituation: e.target.value })}
              placeholder="예: 북부 성채의 통신이 사흘째 끊긴 가운데, 파티는 마지막 보급대와 함께 폐도시에 진입한다."
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="centralConflict">
            중심 갈등
            <LockButton field="centralConflict" />
            <RegenButton field="centralConflict" label="중심 갈등" />
            <textarea
              value={plan.centralConflict}
              rows={3}
              onChange={(e) => patchPlan({ centralConflict: e.target.value })}
              placeholder="예: 성채를 장악하려는 인간 세력과 도시 코어의 확장이 동시에 진행되고 있다."
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="goal">
            목표
            <LockButton field="goal" />
            <textarea
              value={plan.goal}
              rows={3}
              onChange={(e) => patchPlan({ goal: e.target.value })}
              placeholder="한 가지 행동만 강요하지 말고, 파티가 개입할 이유를 적습니다."
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="endingConditions">
            종료 조건 (줄마다 하나)
            <LockButton field="endingConditions" />
            <textarea
              value={listText(plan.endingConditions)}
              rows={4}
              onChange={(e) => patchPlan({ endingConditions: parseList(e.target.value) })}
              placeholder={"예: 코어의 확장을 막거나 협상한다\n예: 생존자를 이끌고 철수한다"}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
        </AppSectionCard>

        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          className="text-sm font-semibold text-violet-300"
        >
          {detailsOpen ? "세부 설정 접기" : "더 자세히 설정"}
          {!detailsOpen && depthFilled ? <span className="ml-2 text-xs font-medium text-amber-200">설정됨</span> : null}
        </button>

        {detailsOpen ? (
        <div className="space-y-4">
        <AppSectionCard title="세계관">
          <p className="text-sm text-zinc-300">기존 세계관 불러오기</p>
          <p className="mt-1 text-xs text-zinc-500">
            세계관을 고르면 해당 설정을 따르고, 고르지 않으면 입력한 자료를 바탕으로 독립 시나리오를 구성합니다.
          </p>
          {catalog.myWorlds.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">아직 저장한 세계관 문서가 없습니다.</p>
          ) : (
            <select
              value={worldId}
              onChange={(e) => setWorldId(e.target.value ? Number(e.target.value) : "")}
              className="mt-2 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            >
              <option value="">없음 — 독립 시나리오</option>
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
          {worldStale ? (
            <p className="mt-2 text-xs text-amber-300">이 시나리오 초안 생성 후 세계관이 수정되었습니다.</p>
          ) : null}
        </AppSectionCard>

        <AppSectionCard title="이야기 보강">
          <label className="block text-sm text-zinc-300">
            한 줄 요약
            <LockButton field="summary" />
            <input
              value={summary}
              maxLength={summaryMax}
              onChange={(e) => setSummary(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            비밀 (GM 전용)
            <LockButton field="secret" />
            <textarea
              value={plan.secret}
              rows={3}
              onChange={(e) => patchPlan({ secret: e.target.value })}
              placeholder="플레이어와 AI 캐릭터에게는 절대 직접 보여주지 않습니다."
              className="mt-1 w-full rounded-xl border border-amber-500/20 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="mt-4 text-sm font-semibold text-violet-300"
          >
            {advancedOpen ? "고급 설정 접기" : "고급 설정 펼치기"}
          </button>
          {advancedOpen ? (
            <div className="mt-3 space-y-3">
              <label className="block text-sm text-zinc-300">
                주요 사건 (강제 순서가 아닌 가능/조건부 사건)
                <LockButton field="majorEvents" />
                <RegenButton field="majorEvents" label="사건" />
                <textarea
                  value={listText(plan.majorEvents)}
                  rows={4}
                  onChange={(e) => patchPlan({ majorEvents: parseList(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                단서
                <LockButton field="clues" />
                <RegenButton field="clues" label="단서" />
                <textarea
                  value={listText(plan.clues)}
                  rows={4}
                  onChange={(e) => patchPlan({ clues: parseList(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                금지 사건
                <textarea
                  value={listText(plan.forbiddenEvents)}
                  rows={3}
                  onChange={(e) => patchPlan({ forbiddenEvents: parseList(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                보스 (없어도 됩니다)
                <input
                  value={plan.boss}
                  onChange={(e) => patchPlan({ boss: e.target.value })}
                  className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                특별 규칙
                <textarea
                  value={listText(plan.specialRules)}
                  rows={3}
                  onChange={(e) => patchPlan({ specialRules: parseList(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-zinc-300">
                  난이도
                  <select
                    value={plan.difficulty}
                    onChange={(e) => {
                      markTouched("difficulty");
                      patchPlan({ difficulty: e.target.value as TrpgScenarioDifficulty });
                    }}
                    className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
                  >
                    {Object.entries(DIFFICULTY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-zinc-300">
                  플레이 길이
                  <select
                    value={plan.playLength}
                    onChange={(e) => {
                      markTouched("playLength");
                      patchPlan({ playLength: e.target.value as TrpgScenarioPlayLength });
                    }}
                    className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
                  >
                    {Object.entries(PLAY_LENGTH_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm text-zinc-300">
                클라이맥스
                <LockButton field="climax" />
                <RegenButton field="climax" label="클라이맥스" />
                <textarea
                  value={plan.climax}
                  rows={3}
                  onChange={(e) => patchPlan({ climax: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                엔딩 후보 (고정 분기가 아님)
                <textarea
                  value={listText(plan.endingCandidates)}
                  rows={3}
                  onChange={(e) => patchPlan({ endingCandidates: parseList(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                세력 변화
                <textarea
                  value={listText(plan.factionChanges)}
                  rows={3}
                  onChange={(e) => patchPlan({ factionChanges: parseList(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                GM 연출
                <textarea
                  value={plan.gmDirection}
                  rows={3}
                  onChange={(e) => patchPlan({ gmDirection: e.target.value })}
                  placeholder="예: 코즈믹 호러 중심, 전투보다 탐험, 플레이어 결정을 대신하지 않음"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
            </div>
          ) : null}
        </AppSectionCard>

        <AppSectionCard title="추가 GM 메모">
          <label className="block text-sm text-zinc-300" data-scenario-field="content">
            전체 시나리오 본문 (선택 · 직접 추가 설정)
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              이야기 설계가 있으면 비워도 됩니다. 예전처럼 본문만 있어도 저장됩니다.
            </span>
            <textarea
              value={content}
              maxLength={contentMax}
              rows={6}
              onChange={(e) => setContent(e.target.value)}
              placeholder="예: 눈 덮인 북부 공국. 얼음 마법이 흔하다."
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            숨겨진 설정 (추가 GM 비밀 메모)
            <textarea
              value={secretContent}
              maxLength={secretMax}
              rows={4}
              onChange={(e) => setSecretContent(e.target.value)}
              className="mt-1 w-full rounded-xl border border-amber-500/20 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
        </AppSectionCard>

        <AppSectionCard title="게임 규칙">
          <p className="mb-3 text-sm text-zinc-400">
            이 시나리오 시트에 넣을 상태값만 고르세요. 숫자는 참가자가 로비에서 5–15로 배분합니다.
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

        <div data-scenario-field="npcs">
        <AppSectionCard title="캐릭터 / NPC">
          <p className="mb-3 text-sm text-zinc-400">
            조연 설정입니다. GM이 참고해서 등장시키며, 플레이어 자리도 아닙니다. 최대 {TRPG_SCENARIO_MAX_NPCS}명.
            <RegenButton field="npcs" label="NPC" />
          </p>
          {npcs.map((npc, index) => (
            <div key={index} className="mb-3 rounded-xl border border-white/10 p-3">
              <label className="block text-sm text-zinc-300">
                이름
                <input
                  value={npc.name}
                  placeholder="예: 역무원"
                  maxLength={remainingScenarioFieldMax(
                    bundleUsed,
                    npc.name.trim().length,
                    TRPG_SCENARIO_NPC_NAME_LIMIT
                  )}
                  onChange={(e) =>
                    setNpcs((prev) => prev.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
                  }
                  className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
                />
              </label>
              <label className="mt-3 block text-sm text-zinc-300">
                설정
                <textarea
                  value={npc.description}
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
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="mt-3 block text-sm text-zinc-300">
                말투 (선택)
                <textarea
                  value={npc.greeting}
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
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="mt-3 block text-sm text-zinc-300">
                진행 메모 (선택)
                <textarea
                  value={npc.systemPrompt}
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
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <button
                type="button"
                onClick={() => setNpcs((prev) => prev.filter((_, i) => i !== index))}
                className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-rose-200"
              >
                삭제
              </button>
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
        </div>

        <AppSectionCard title="표시 및 에셋">
          <p className="text-xs text-zinc-500">
            1번 대표 이미지는 가로·세로 모두 가능하고, 나머지 장면 에셋은 가로로 긴 이미지만 사용할 수 있습니다.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={assets.length + files.length >= TRPG_SCENARIO_MAX_ASSETS}
            className="mt-3 w-full min-h-11 rounded-xl border border-dashed border-white/15 bg-[#161922] py-3 text-sm font-semibold text-zinc-200 hover:border-violet-400/40"
          >
            + 시나리오 에셋 추가
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              {assets.length + files.length} / {TRPG_SCENARIO_MAX_ASSETS}장 · 1번 이후는 가로 이미지
            </span>
          </button>
          {files.length > 0 ? (
            <button
              type="button"
              onClick={() => void tagPendingFiles()}
              disabled={busy}
              className="mt-2 w-full min-h-11 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {progress || `${files.length}장 업로드 · 태깅`}
            </button>
          ) : null}
          {assets.length > 0 ? (
            <div className="mt-3">
              <AssetManagerGrid
                assets={assets}
                onChange={commitAssets}
                onRemove={(index) => commitAssets(assets.filter((_, i) => i !== index))}
                note="1번은 카드 대표. 2번부터는 가로로 긴 장면만 유지됩니다."
              />
            </div>
          ) : null}
        </AppSectionCard>

        <AppSectionCard title="공개 설정">
          <p
            data-scenario-field="bundle"
            className={`text-base font-semibold tabular-nums tracking-tight ${
              bundleOver ? "text-rose-400" : "text-amber-300"
            }`}
          >
            세계관+시나리오+비밀+NPC {bundleUsed.toLocaleString()} / {TRPG_SCENARIO_BUNDLE_LIMIT.toLocaleString()}자
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            불러온 세계관과 이 시나리오에 추가로 쓰는 본문·이야기 설계·숨겨진 설정·NPC를 합쳐{" "}
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
        </div>
        ) : null}

        {error || bundleOver || lintMessages.length ? (
          <div className="space-y-2">
            {error || bundleOver ? (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error || scenarioBundleLimitError(bundleUsed)}
              </p>
            ) : null}
            {lintMessages.length ? (
              <ul className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                {lintMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

      </form>
  );

  const saveBar = (
    <StudioSaveBar
      formId="studio-trpg-scenario-form"
      saveType="submit"
      saveLabel={busy ? "저장 중…" : dirty || !savedId ? "저장" : "저장됨"}
      saveDisabled={busy || draftBusy || bundleOver || (!dirty && Boolean(savedId))}
      error={error || (bundleOver ? scenarioBundleLimitError(bundleUsed) : null)}
      secondary={{
        label: busy ? "이동 중…" : playLabel,
        onClick: () => void play(),
        disabled: busy || draftBusy || persistDecision === "blocked",
        flash: persistDecision !== "blocked",
        hint: persistDecision === "blocked" ? "필수 항목을 먼저 채워 주세요" : saveStateLabel,
      }}
    >
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span data-scenario-save-cta>{saveStateLabel}</span>
        <span data-scenario-play-cta>{playLabel}</span>
      </div>
    </StudioSaveBar>
  );

  if (embedded) {
    return (
      <div className="pb-24">
        {form}
        {saveBar}
      </div>
    );
  }

  return (
    <AppPageShell
      title={initial ? "TRPG 시나리오 수정" : "TRPG 시나리오 만들기"}
      description="제목과 이야기 뼈대만 있으면 바로 테스트 플레이할 수 있습니다. 세부 설정은 나중에 채워도 됩니다."
      narrow
    >
      <div className="pb-24">
        {form}
        {saveBar}
      </div>
    </AppPageShell>
  );
}
