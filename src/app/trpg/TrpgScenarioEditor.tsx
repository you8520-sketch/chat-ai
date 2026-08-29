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
  hasLegacyAdvancedPlanFields,
  lintTrpgScenarioPlan,
  type TrpgScenarioDifficulty,
  type TrpgScenarioPlan,
  type TrpgScenarioPlayLength,
} from "@/lib/trpg/scenarioPlan";
import type { TrpgScenarioDraftField, TrpgScenarioDraftMode } from "@/lib/trpg/scenarioDraft";
import {
  confirmLeaveEditor,
  isScenarioEditorDirty,
  SCENARIO_STORY_FIELD_COPY,
  scenarioEditorPersistedSnapshot,
  scenarioEditorSavePayload,
  scenarioEditorSnapshot,
  scenarioHasAiDraftOrigin,
  scrollToScenarioField,
  shouldConfirmScenarioDraftApply,
  shouldOfferScenarioAiEditingTools,
  type ScenarioEditorSnapshot,
} from "@/lib/trpg/scenarioEditorState";
import { scenarioPersistDecision, scenarioPlayCtaLabel, trpgPlayHref } from "@/lib/trpg/scenarioHandoff";
import {
  countFirstCreateFilledFields,
  countFirstCreateRemainingFields,
  evaluateScenarioReadiness,
  scenarioReadinessHeadline,
  type ScenarioReadinessField,
} from "@/lib/trpg/scenarioReadiness";
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
  const [genres, setGenres] = useState<CharacterGenre[]>(() =>
    (initial?.genres ?? []).filter((genre) => genre !== "시뮬레이션")
  );
  const [assets, setAssets] = useState<CharacterAsset[]>(initial?.assets ?? []);
  const [plan, setPlan] = useState<TrpgScenarioPlan>(initial?.scenarioPlan ?? emptyTrpgScenarioPlan());
  const [lockedFields, setLockedFields] = useState<TrpgScenarioDraftField[]>([]);
  const [touchedFields, setTouchedFields] = useState<TrpgScenarioDraftField[]>(() =>
    initial?.scenarioPlan ? ["difficulty", "playLength"] : []
  );
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [storyDetailsOpen, setStoryDetailsOpen] = useState(() => hasLegacyAdvancedPlanFields(initial?.scenarioPlan));
  const [worldExtraOpen, setWorldExtraOpen] = useState(() =>
    Boolean(initial?.worldId && initial?.content.trim())
  );
  const [draftBusy, setDraftBusy] = useState(false);
  const [lintMessages, setLintMessages] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<number | null>(initial?.id ?? null);
  const [scenarioAuthoringActive, setScenarioAuthoringActive] = useState(Boolean(initial?.id));
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
  const savedVisibility = useMemo(() => {
    try {
      const parsed = JSON.parse(savedSnapshot) as { visibility?: TrpgVisibility };
      return parsed.visibility ?? "private";
    } catch {
      return "private" as TrpgVisibility;
    }
  }, [savedSnapshot]);

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
  const bundleWarning = bundleUsed >= TRPG_SCENARIO_BUNDLE_LIMIT * 0.8;
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
  const scenarioAuthoringStarted = scenarioAuthoringActive || lastDraftSnapshot !== null;
  const readiness = useMemo(
    () =>
      evaluateScenarioReadiness({
        title,
        content,
        summary,
        visibility,
        previousVisibility: savedVisibility,
        scenarioPlan: plan,
        npcs: namedNpcs,
        startInventory: namedInventory,
        bundleChars: bundleUsed,
      }),
    [title, content, summary, visibility, savedVisibility, plan, namedNpcs, namedInventory, bundleUsed]
  );
  const persistDecision = scenarioPersistDecision({
    dirty,
    canPlay: readiness.canPlay,
    savedId,
  });
  const playLabel = scenarioPlayCtaLabel(persistDecision);
  const saveStateLabel = savedId ? (dirty ? "수정됨 · 저장 필요" : "저장됨") : "아직 저장되지 않음";
  const offerAiEditingTools = shouldOfferScenarioAiEditingTools({
    hasSessionDraft: lastDraftSnapshot != null,
    hasPersistedAiOrigin: scenarioHasAiDraftOrigin(plan),
    isEditingSaved: savedId != null,
  });
  const showAiFieldChrome = offerAiEditingTools && aiToolsOpen;
  const firstCreateFilled = countFirstCreateFilledFields({ title, scenarioPlan: plan });
  const firstCreateRemaining = countFirstCreateRemainingFields({ title, scenarioPlan: plan });
  const readinessHeadline = scenarioReadinessHeadline(readiness, { firstCreateRemaining });

  function leaveEditor() {
    if (
      !confirmLeaveEditor({
        dirty,
        confirm: () => window.confirm("저장하지 않은 변경이 있습니다. 이 화면을 나갈까요?"),
      })
    ) {
      return;
    }
    router.push(returnHref);
  }

  function revealReadinessField(field: ScenarioReadinessField, section: "story" | "details") {
    if (section === "details" && field !== "bundle") setStoryDetailsOpen(true);
    window.setTimeout(() => scrollToScenarioField(field), 0);
  }

  function patchPlan(partial: Partial<TrpgScenarioPlan>) {
    setScenarioAuthoringActive(true);
    setPlan((prev) => ({ ...prev, ...partial }));
  }

  function editNpcs(updater: (prev: TrpgScenarioNpc[]) => TrpgScenarioNpc[]) {
    setScenarioAuthoringActive(true);
    setNpcs(updater);
  }

  function editVisibility(next: TrpgVisibility) {
    if (next === visibility) return;
    setScenarioAuthoringActive(true);
    setVisibility(next);
  }

  function editGenres(next: CharacterGenre[]) {
    if (next.length === genres.length && next.every((genre, index) => genre === genres[index])) return;
    setScenarioAuthoringActive(true);
    setGenres(next);
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
      setScenarioAuthoringActive(true);
      setAssets(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR);
    }
  }

  function pickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const room = TRPG_SCENARIO_MAX_ASSETS - assets.length;
    setScenarioAuthoringActive(true);
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
    const on = statKeys.includes(key);
    const next = on ? statKeys.filter((item) => item !== key) : [...statKeys, key];
    if (next.length === 0) return;
    setScenarioAuthoringActive(true);
    setStatKeys(defsFromKeys(next).map((definition) => definition.key));
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
    if (
      shouldConfirmScenarioDraftApply({
        mode,
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
    setScenarioAuthoringActive(true);
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
    const submittedFields = currentFields();
    const body = scenarioEditorSavePayload(submittedFields);
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
      const persistedCharacterIds = data.scenario?.characterIds ?? submittedFields.characterIds;
      setCharacterIds(persistedCharacterIds);
      setSavedSnapshot(scenarioEditorPersistedSnapshot(submittedFields, persistedCharacterIds));
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
    if (!showAiFieldChrome) return null;
    const on = lockedFields.includes(field);
    return (
      <button
        type="button"
        data-scenario-ai-lock={field}
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
    if (!showAiFieldChrome) return null;
    return (
      <button
        type="button"
        data-scenario-ai-regen={field}
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
        {scenarioAuthoringStarted ? (
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
          <p className="font-semibold">{readinessHeadline}</p>
          <p className="mt-1 text-xs opacity-80">
            {saveStateLabel}
            {" · "}
            <button type="button" onClick={leaveEditor} className="underline">
              나가기
            </button>
          </p>
          {readiness.status === "blocked" ? (
            <p className="mt-1 text-xs opacity-80" data-scenario-first-create-progress>
              필수 이야기 {firstCreateFilled} / 5
            </p>
          ) : null}
          {readiness.blockers[0] ? (
            <button
              type="button"
              onClick={() => revealReadinessField(readiness.blockers[0]!.field, readiness.blockers[0]!.section)}
              className="mt-2 text-xs font-semibold underline"
            >
              {readiness.blockers[0].message}
            </button>
          ) : readiness.status === "recommended" && readiness.recommendations[0] ? (
            <details className="mt-2 text-xs opacity-80" data-scenario-quality-lint>
              <summary className="cursor-pointer font-semibold">보완하면 더 좋아요</summary>
              <button
                type="button"
                onClick={() =>
                  revealReadinessField(
                    readiness.recommendations[0]!.field,
                    readiness.recommendations[0]!.section
                  )
                }
                className="mt-1 text-left underline"
              >
                {readiness.recommendations[0].message}
              </button>
            </details>
          ) : (
            <p className="mt-1 text-xs opacity-80">이 시나리오는 바로 시작할 수 있습니다.</p>
          )}
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
            세계관만으로도 TRPG를 시작할 수 있습니다. 시나리오는 필요할 때 추가하세요.
          </div>
        )}

        <AppSectionCard title="세계관" titleVariant="prominent">
          <label className="block text-sm font-semibold text-zinc-100">
            세계관 선택
            <select
              value={worldId}
              onChange={(e) => {
                const nextWorldId = e.target.value ? Number(e.target.value) : "";
                setWorldId(nextWorldId);
                setWorldExtraOpen(Boolean(nextWorldId && content.trim()));
              }}
              className="mt-2 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            >
              <option value="">직접 작성</option>
              {catalog.myWorlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          {catalog.myWorlds.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">저장한 세계관이 없어 직접 작성으로 시작합니다.</p>
          ) : null}
          {linkedWorld ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="font-semibold text-zinc-100">{linkedWorld.name}</p>
              {linkedWorld.summary.trim() ? (
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-zinc-400">{linkedWorld.summary}</p>
              ) : null}
              {linkedWorld.content.trim() ? (
                <details className="mt-2 text-xs text-zinc-400">
                  <summary className="cursor-pointer font-semibold text-violet-200">세계관 내용 보기</summary>
                  <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">{linkedWorld.content}</p>
                </details>
              ) : null}
            </div>
          ) : null}
          {!linkedWorld ? (
            <label className="mt-4 block text-sm font-semibold text-zinc-100" data-scenario-field="content">
              {SCENARIO_STORY_FIELD_COPY.content.label}
              <p className="mt-1 text-xs font-normal text-zinc-500">{SCENARIO_STORY_FIELD_COPY.content.helper}</p>
              <textarea
                value={content}
                maxLength={contentMax}
                rows={6}
                onChange={(e) => setContent(e.target.value)}
                placeholder="예: 눈 덮인 북부 공국. 얼음 마법이 흔하며, 오래된 성채 아래에 봉인된 도시가 있다."
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
              />
            </label>
          ) : (
            <div className="mt-4" data-scenario-field="content">
              <button
                type="button"
                aria-expanded={worldExtraOpen}
                onClick={() => setWorldExtraOpen((open) => !open)}
                className="text-sm font-semibold text-violet-200"
              >
                {worldExtraOpen ? "− 덧붙일 설정 접기" : `+ ${SCENARIO_STORY_FIELD_COPY.worldExtra.label}`}
              </button>
              {worldExtraOpen ? (
                <>
                  <p className="mt-2 text-xs text-zinc-500">{SCENARIO_STORY_FIELD_COPY.worldExtra.helper}</p>
                  <textarea
                  aria-label="불러온 세계관에 덧붙일 설정"
                  value={content}
                  maxLength={contentMax}
                  rows={5}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="예: 이 시나리오에서는 북부 공국의 겨울이 유난히 길고, 얼음 마법이 불안정하다."
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
                </>
              ) : null}
            </div>
          )}
          {worldStale ? (
            <p className="mt-2 text-xs text-amber-300">이 시나리오 초안 생성 후 세계관이 수정되었습니다.</p>
          ) : null}
        </AppSectionCard>

        <AppSectionCard title="이야기" titleVariant="prominent">
          <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-violet-300/80">빠르게 시작</p>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-scenario-ai-primary-cta
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
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            직접 작성하려면 아래 기본 항목만 채우면 됩니다. AI 초안은 바로 저장되지 않습니다.
          </p>
          {offerAiEditingTools ? (
            <div className="mb-3">
              <button
                type="button"
                data-scenario-ai-tools
                aria-expanded={aiToolsOpen}
                onClick={() => setAiToolsOpen((open) => !open)}
                className="text-sm font-semibold text-violet-300"
              >
                {aiToolsOpen ? "AI 편집 도구 접기" : "✨ AI 편집 도구"}
              </button>
              {aiToolsOpen ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-scenario-ai-regen-all
                    disabled={draftBusy}
                    onClick={() => void requestDraft("regenerate_all")}
                    className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-200 disabled:opacity-50"
                  >
                    전체 다시 만들기
                  </button>
                  <p className="text-xs text-zinc-500">잠그면 다시 만들 때 유지됩니다.</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <label className="block text-sm text-zinc-300" data-scenario-field="title">
            {SCENARIO_STORY_FIELD_COPY.title.label} *
            <LockButton field="title" />
            <input
              value={title}
              maxLength={TRPG_SCENARIO_TITLE_LIMIT}
              onChange={(e) => {
                setScenarioAuthoringActive(true);
                setTitle(e.target.value);
              }}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="summary">
            {SCENARIO_STORY_FIELD_COPY.summary.label}
            {visibility === "public" ? " *" : " (선택)"}
            <LockButton field="summary" />
            <p className="mt-1 text-xs font-normal text-zinc-500" data-scenario-field-helper="summary">
              {SCENARIO_STORY_FIELD_COPY.summary.helper}
            </p>
            <input
              value={summary}
              maxLength={summaryMax}
              onChange={(e) => {
                setScenarioAuthoringActive(true);
                setSummary(e.target.value);
              }}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="startingSituation">
            {SCENARIO_STORY_FIELD_COPY.startingSituation.label}
            <LockButton field="startingSituation" />
            <RegenButton field="startingSituation" label={SCENARIO_STORY_FIELD_COPY.startingSituation.label} />
            <p className="mt-1 text-xs font-normal text-zinc-500" data-scenario-field-helper="startingSituation">
              {SCENARIO_STORY_FIELD_COPY.startingSituation.helper}
            </p>
            <textarea
              value={plan.startingSituation}
              rows={4}
              onChange={(e) => patchPlan({ startingSituation: e.target.value })}
              placeholder="예: 북부 성채의 통신이 사흘째 끊긴 가운데, 파티는 마지막 보급대와 함께 폐도시에 진입한다."
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="goal">
            {SCENARIO_STORY_FIELD_COPY.goal.label}
            <LockButton field="goal" />
            <RegenButton field="goal" label={SCENARIO_STORY_FIELD_COPY.goal.label} />
            <p className="mt-1 text-xs font-normal text-zinc-500" data-scenario-field-helper="goal">
              {SCENARIO_STORY_FIELD_COPY.goal.helper}
            </p>
            <textarea
              value={plan.goal}
              rows={3}
              onChange={(e) => patchPlan({ goal: e.target.value })}
              placeholder="예: 마지막 신호를 찾아 생존자를 구하고, 연구소에 남을지 떠날지 결정한다."
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300" data-scenario-field="secretContent">
            {SCENARIO_STORY_FIELD_COPY.gmNotes.label}
            <p className="mt-1 text-xs font-normal text-zinc-500" data-scenario-field-helper="secretContent">
              {SCENARIO_STORY_FIELD_COPY.gmNotes.helper}
            </p>
            <textarea
              value={secretContent}
              maxLength={secretMax}
              rows={4}
              onChange={(e) => {
                setScenarioAuthoringActive(true);
                setSecretContent(e.target.value);
              }}
              className="mt-1 w-full rounded-xl border border-amber-500/20 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <button
            type="button"
            data-scenario-story-details
            aria-expanded={storyDetailsOpen}
            onClick={() => setStoryDetailsOpen((open) => !open)}
            className="mt-5 min-h-11 w-full rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-left text-sm font-bold text-violet-100"
          >
            {storyDetailsOpen
              ? "− 고급 설정 접기"
              : hasLegacyAdvancedPlanFields(plan)
                ? "+ 기존 고급 설정 보기"
                : "+ 고급 설정 (선택)"}
          </button>
          {storyDetailsOpen ? (
            <div className="mt-4 space-y-3" data-scenario-story-details-content>
              <label className="block text-sm text-zinc-300" data-scenario-field="centralConflict">
                {SCENARIO_STORY_FIELD_COPY.centralConflict.label}
                <LockButton field="centralConflict" />
                <RegenButton field="centralConflict" label={SCENARIO_STORY_FIELD_COPY.centralConflict.label} />
                <p className="mt-1 text-xs font-normal text-zinc-500" data-scenario-field-helper="centralConflict">
                  {SCENARIO_STORY_FIELD_COPY.centralConflict.helper}
                </p>
                <textarea
                  value={plan.centralConflict}
                  rows={3}
                  onChange={(e) => patchPlan({ centralConflict: e.target.value })}
                  placeholder="예: 성채를 장악하려는 인간 세력과 도시 코어의 확장이 동시에 진행되고 있다."
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300" data-scenario-field="endingConditions">
                {SCENARIO_STORY_FIELD_COPY.endingConditions.label}
                <LockButton field="endingConditions" />
                <RegenButton field="endingConditions" label={SCENARIO_STORY_FIELD_COPY.endingConditions.label} />
                <p className="mt-1 text-xs font-normal text-zinc-500" data-scenario-field-helper="endingConditions">
                  {SCENARIO_STORY_FIELD_COPY.endingConditions.helper}
                </p>
                <textarea
                  value={listText(plan.endingConditions)}
                  rows={4}
                  onChange={(e) => patchPlan({ endingConditions: parseList(e.target.value) })}
                  placeholder={"예: 생존자를 구조하고 연구소에서 탈출한다\n예: 위협을 차단한 뒤 철수한다"}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-sm text-zinc-300">
                GM 비공개 설정 (레거시)
                <LockButton field="secret" />
                <textarea
                  value={plan.secret}
                  rows={3}
                  onChange={(e) => patchPlan({ secret: e.target.value })}
                  placeholder="이전 버전에서 작성된 GM 비공개 설정입니다. 새 메모는 위 GM 추가 설정을 사용하세요."
                  className="mt-1 w-full rounded-xl border border-amber-500/20 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
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
                피해야 할 전개
                <textarea
                  value={listText(plan.forbiddenEvents)}
                  rows={3}
                  onChange={(e) => patchPlan({ forbiddenEvents: parseList(e.target.value) })}
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

        <AppSectionCard title="게임 규칙" titleVariant="prominent">
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
                  <option key={value} value={value}>{label}</option>
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
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm text-zinc-300">
            시작 장소
            <input
              value={startLocation}
              onChange={(e) => {
                setScenarioAuthoringActive(true);
                setStartLocation(e.target.value);
              }}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            시작 소지품 (쉼표로 구분)
            <input
              value={inventoryText}
              onChange={(e) => {
                setScenarioAuthoringActive(true);
                setInventoryText(e.target.value);
              }}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <label className="mt-3 block text-sm text-zinc-300">
            특별 규칙
            <textarea
              value={listText(plan.specialRules)}
              rows={3}
              onChange={(e) => patchPlan({ specialRules: parseList(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
        </AppSectionCard>

        <div data-scenario-field="npcs">
        <AppSectionCard title="조연 / NPC" titleVariant="prominent">
          <label className="mb-4 block text-sm font-semibold text-zinc-100">
            핵심 적 / 보스 (선택)
            <input
              value={plan.boss}
              onChange={(e) => patchPlan({ boss: e.target.value })}
              className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
            />
          </label>
          <h3 className="mb-2 text-base font-bold text-zinc-100">조연 NPC</h3>
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
                    editNpcs((prev) => prev.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
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
                    editNpcs((prev) =>
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
                    editNpcs((prev) =>
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
                    editNpcs((prev) =>
                      prev.map((row, i) => (i === index ? { ...row, systemPrompt: e.target.value } : row))
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <button
                type="button"
                onClick={() => editNpcs((prev) => prev.filter((_, i) => i !== index))}
                className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-rose-200"
              >
                삭제
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={npcs.length >= TRPG_SCENARIO_MAX_NPCS}
            onClick={() => editNpcs((prev) => [...prev, emptyNpc()])}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 disabled:opacity-50"
          >
            + NPC 추가
          </button>
        </AppSectionCard>
        </div>

        <AppSectionCard title="표시 / 공개" titleVariant="prominent">
          <h3 className="text-base font-bold text-zinc-100">표시 및 에셋</h3>
          <p className="text-sm leading-relaxed text-zinc-300">
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
            className="mt-3 min-h-14 w-full rounded-xl border border-violet-400/50 bg-violet-600/15 px-4 py-3 text-base font-bold text-violet-100 shadow-lg shadow-violet-950/20 transition hover:border-violet-300 hover:bg-violet-600/25 disabled:opacity-50"
          >
            + 시나리오 에셋 추가
            <span className="mt-1 block text-xs font-medium text-violet-200/70">
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
          <div className="my-5 border-t border-white/10" />
          <h3 className="mb-3 text-base font-bold text-zinc-100">공개 설정</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => editVisibility("private")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                visibility === "private" ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
              }`}
            >
              비공개
            </button>
            <button
              type="button"
              onClick={() => editVisibility("public")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                visibility === "public" ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
              }`}
            >
              공개 (TRPG 탭)
            </button>
          </div>
          <div className="mt-4">
            <GenrePicker value={genres} onChange={editGenres} excludedGenres={["시뮬레이션"]} />
          </div>
        </AppSectionCard>

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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
        <span
          data-scenario-field="bundle"
          className={`font-semibold tabular-nums ${
            bundleOver ? "text-rose-300" : bundleWarning ? "text-amber-300" : "text-zinc-300"
          }`}
        >
          사용량 {bundleUsed.toLocaleString()} / {TRPG_SCENARIO_BUNDLE_LIMIT.toLocaleString()}자
        </span>
        <span aria-hidden="true">·</span>
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
      description="세계관만으로도 TRPG를 시작할 수 있고, 시나리오는 목표·전개·규칙을 더하는 선택 확장입니다."
      narrow
    >
      <div className="pb-24">
        {form}
        {saveBar}
      </div>
    </AppPageShell>
  );
}
