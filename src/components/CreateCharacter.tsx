"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CharacterGender } from "@/lib/characterGender";
import { GENDER_LABELS } from "@/lib/characterGender";
import {
  assetUrls,
  defaultAssetFlags,
  publicAssetUrls,
} from "@/lib/characterAssets";
import AssetManagerGrid, {
  type ManagedAsset,
} from "@/components/AssetManagerGrid";
import CreatorCommentHtml from "@/components/CreatorCommentHtml";
import CharacterPublicPagePreview from "@/components/CharacterPublicPagePreview";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import {
  speechCreatorCharCount,
  type SpeechContextualRegister,
} from "@/lib/speechCreatorFields";
import StatusWidgetEditor from "@/components/StatusWidgetEditor";
import {
  characterStatusWidgetOrDefault,
  parseStatusWidgetJson,
  serializeStatusWidget,
  type StatusWidget,
} from "@/lib/statusWidget";

import type { WorldListItem } from "@/lib/worlds";
import type { KeywordLorebookListItem } from "@/lib/keywordLorebooks";
import GenrePicker from "@/components/GenrePicker";
import ToggleSwitch from "@/components/ToggleSwitch";
import type { CharacterGenre } from "@/lib/characterGenres";
import { CHARACTER_NAME_LIMIT, CREATOR_COMMENT_LIMIT } from "@/lib/characters";
import {
  AI_LEARNING_LIMIT,
  AI_LEARNING_MIN,
  GREETING_LIMIT,
  TAGLINE_LIMIT,
} from "@/lib/characterFormLimits";
import TagChipInput from "@/components/TagChipInput";
import PublicDescriptionFormatToolbar from "@/components/PublicDescriptionFormatToolbar";
import { parseCharacterTagsInput } from "@/lib/characterTags";
import {
  clearCharacterCreateDraft,
  formatDraftSavedAt,
  loadCharacterCreateDraft,
  saveCharacterCreateDraft,
  type CharacterCreateDraft,
} from "@/lib/characterCreateDraft";

const MAX_IMAGES = 100;

type PageTab = "create" | "preview" | "widget" | "publish";

type TaggedAsset = ManagedAsset;

function normalizeManagedAssets(list: TaggedAsset[]): TaggedAsset[] {
  const next = list.map((a, i) => ({
    url: a.url,
    tag: a.tag,
    public: typeof a.public === "boolean" ? a.public : i === 0,
    chat: typeof a.chat === "boolean" ? a.chat : true,
    viewerBlur: typeof a.viewerBlur === "boolean" ? a.viewerBlur : i !== 0,
  }));
  if (next.length > 0 && !next.some((a) => a.public)) {
    next[0] = { ...next[0], public: true };
  }
  return next;
}

export default function CreateCharacter({
  editCharacterId = null,
  viewerDisplayName,
  creatorDisplayName = "제작자",
  creatorIsPartner = false,
  userId,
}: {
  editCharacterId?: number | null;
  viewerDisplayName?: string;
  creatorDisplayName?: string;
  creatorIsPartner?: boolean;
  userId: number;
}) {
  const router = useRouter();
  const isEditMode = editCharacterId != null && editCharacterId > 0;
  const fileRef = useRef<HTMLInputElement>(null);
  const profilePreviewPanelRef = useRef<HTMLDivElement>(null);
  const publicDescriptionRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    name: "",
    tagline: "",
    description: "",
    greeting: "",
    system_prompt: "",
    world: "",
    speech_personality: "",
    speech_traits: "",
    speech_examples: "",
    speech_forbidden: "",
    speech_contextual_registers: [] as SpeechContextualRegister[],
    status_window_prompt: "",
    genres: [] as CharacterGenre[],
    tags: [] as string[],
    nsfw: false,
    emoji: "✨",
    hue: 260,
    audience: "all",
    gender: "" as "" | CharacterGender,
    visibility: "public" as "public" | "link" | "private",
    recommended_writing_style: "balanced",
    comments_enabled: true,
    creator_comment: "",
  });
  const [assets, setAssets] = useState<TaggedAsset[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [savedWorlds, setSavedWorlds] = useState<WorldListItem[]>([]);
  const [selectedWorldId, setSelectedWorldId] = useState<number | "">("");
  const [worldsLoading, setWorldsLoading] = useState(true);
  const [savedLorebooks, setSavedLorebooks] = useState<
    KeywordLorebookListItem[]
  >([]);
  const [selectedLorebookId, setSelectedLorebookId] = useState<number | "">("");
  const [lorebooksLoading, setLorebooksLoading] = useState(true);
  const [editLoading, setEditLoading] = useState(isEditMode);
  const [editLoadError, setEditLoadError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftFlash, setDraftFlash] = useState(false);
  const [statusWidget, setStatusWidget] = useState<StatusWidget>(() =>
    characterStatusWidgetOrDefault(null),
  );
  const [pageTab, setPageTab] = useState<PageTab>("create");
  const draftRestoredRef = useRef(false);

  function buildDraftSnapshot(): CharacterCreateDraft {
    return {
      savedAt: Date.now(),
      form,
      assets,
      selectedWorldId,
      selectedLorebookId,
      pageTab,
    };
  }

  function applyDraftSnapshot(draft: CharacterCreateDraft) {
    const legacyDescription =
      draft.form.description?.trim() ||
      draft.rawDraft?.trim() ||
      draft.generatedProfile?.biography?.trim() ||
      "";
    setForm({
      ...draft.form,
      description: legacyDescription,
      tags: parseCharacterTagsInput(draft.form.tags),
      speech_contextual_registers: Array.isArray(draft.form.speech_contextual_registers)
        ? draft.form.speech_contextual_registers
        : [],
    });
    setAssets(normalizeManagedAssets(draft.assets));
    setSelectedWorldId(draft.selectedWorldId);
    setSelectedLorebookId(draft.selectedLorebookId);
    setPageTab(
      draft.pageTab === "preview"
        ? "preview"
        : draft.pageTab === "widget"
          ? "widget"
          : draft.pageTab === "publish"
            ? "publish"
            : "create",
    );
    setDraftSavedAt(draft.savedAt);
  }

  function saveDraftLocally() {
    const snapshot = buildDraftSnapshot();
    saveCharacterCreateDraft(userId, editCharacterId ?? null, snapshot);
    setDraftSavedAt(snapshot.savedAt);
    setDraftFlash(true);
    window.setTimeout(() => setDraftFlash(false), 2000);
  }

  useEffect(() => {
    if (isEditMode || draftRestoredRef.current) return;
    const draft = loadCharacterCreateDraft(userId, null);
    if (!draft) return;
    draftRestoredRef.current = true;
    applyDraftSnapshot(draft);
  }, [isEditMode, userId]);

  useEffect(() => {
    if (!isEditMode || editLoading || draftRestoredRef.current) return;
    const draft = loadCharacterCreateDraft(userId, editCharacterId ?? null);
    if (!draft) return;
    draftRestoredRef.current = true;
    setDraftSavedAt(draft.savedAt);
  }, [isEditMode, editLoading, userId, editCharacterId]);

  const aiLearningTotal =
    form.world.length +
    form.system_prompt.length +
    speechCreatorCharCount({
      speech_personality: form.speech_personality,
      speech_traits: form.speech_traits,
      speech_examples: form.speech_examples,
      speech_forbidden: form.speech_forbidden,
      speech_contextual_registers: form.speech_contextual_registers,
    });

  const createRequirements = useMemo(
    () => ({
      hasAsset: assets.length >= 1 && files.length === 0,
      hasMinAiText: aiLearningTotal >= AI_LEARNING_MIN,
      hasGender: !!form.gender,
      hasGreeting: !!form.greeting.trim(),
      hasGenre: form.genres.length >= 1,
    }),
    [
      assets.length,
      files.length,
      aiLearningTotal,
      form.gender,
      form.greeting,
      form.genres.length,
    ],
  );

  const createReady = Object.values(createRequirements).every(Boolean);

  const previewDescription = useMemo(
    () => form.description.trim(),
    [form.description],
  );

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_IMAGES - assets.length;
    const next = [...files, ...Array.from(list)].slice(0, room);
    setFiles(next);
  }

  function removeAsset(i: number) {
    setAssets((a) => normalizeManagedAssets(a.filter((_, idx) => idx !== i)));
  }

  async function tagPendingFiles() {
    if (files.length === 0) return;
    setLoading(true);
    setError("");
    setProgress(`에셋 ${files.length}장 업로드 중…`);

    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    const up = await fetch("/api/upload", { method: "POST", body: fd });
    const upData = await up.json();
    if (!up.ok) {
      setLoading(false);
      setProgress("");
      setError(upData.error);
      return;
    }

    setProgress("Gemini Vision으로 감정 태그 분석 중…");
    const tagRes = await fetch("/api/assets/tag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: upData.urls }),
    });
    const tagData = await tagRes.json();
    if (!tagRes.ok) {
      setLoading(false);
      setProgress("");
      setError(tagData.error);
      return;
    }

    const batch = (tagData.assets as { url: string; tag: string }[]).map(
      (a, i) => ({
        url: a.url,
        tag: a.tag,
        ...defaultAssetFlags(assets, i),
      }),
    );
    setAssets((prev) => normalizeManagedAssets([...prev, ...batch]));
    setFiles([]);
    setLoading(false);
    setProgress("");
  }

  function removeFile(i: number) {
    setFiles((f) => f.filter((_, idx) => idx !== i));
  }

  const filePreviewUrls = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files],
  );

  /** 홈·카드·공개 페이지 좌측 대표 — 감정 에셋 「노출 ON」 순서 1번 */
  const cardImageUrl = useMemo(
    () => publicAssetUrls(assets)[0] ?? "",
    [assets],
  );
  const assetImageUrls = useMemo(() => {
    const uploaded = assetUrls(assets).filter(Boolean);
    if (uploaded.length > 0) return uploaded;
    return filePreviewUrls;
  }, [assets, filePreviewUrls]);

  useEffect(
    () => () => {
      filePreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    },
    [filePreviewUrls],
  );

  useEffect(() => {
    if (!isEditMode || !editCharacterId) return;
    let cancelled = false;
    (async () => {
      setEditLoading(true);
      setEditLoadError("");
      try {
        const res = await fetch(`/api/characters/${editCharacterId}`);
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled)
            setEditLoadError(data.error || "캐릭터를 불러오지 못했습니다.");
          return;
        }
        if (cancelled) return;
        setForm({
          name: data.name ?? "",
          tagline: data.tagline ?? "",
          description: data.description ?? "",
          greeting: data.greeting ?? "",
          system_prompt: data.system_prompt ?? "",
          world: data.world ?? "",
          speech_personality: data.speech_personality ?? "",
          speech_traits: data.speech_traits ?? "",
          speech_examples: data.speech_examples ?? "",
          speech_forbidden: data.speech_forbidden ?? "",
          speech_contextual_registers: Array.isArray(data.speech_contextual_registers)
            ? data.speech_contextual_registers
            : [],
          status_window_prompt: "",
          genres: Array.isArray(data.genres) ? data.genres : [],
          tags: parseCharacterTagsInput(data.tags ?? ""),
          nsfw: !!data.nsfw,
          emoji: data.emoji ?? "✨",
          hue: Number(data.hue) || 260,
          audience: data.audience ?? "all",
          gender: data.gender ?? "",
          visibility: data.visibility ?? "public",
          recommended_writing_style:
            data.recommended_writing_style ?? "balanced",
          comments_enabled: data.comments_enabled !== false,
          creator_comment: data.creator_comment ?? "",
        });
        setAssets(
          normalizeManagedAssets(Array.isArray(data.assets) ? data.assets : []),
        );
        setSelectedWorldId(data.world_id ?? "");
        setSelectedLorebookId(data.lorebook_id ?? "");
        const parsedWidget = parseStatusWidgetJson(data.status_widget_json);
        setStatusWidget(parsedWidget ?? characterStatusWidgetOrDefault(null));
      } catch {
        if (!cancelled)
          setEditLoadError("네트워크 오류로 캐릭터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editCharacterId, isEditMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/worlds");
        if (!res.ok) return;
        const data = (await res.json()) as { worlds?: WorldListItem[] };
        if (!cancelled && Array.isArray(data.worlds)) {
          setSavedWorlds(data.worlds);
        }
      } finally {
        if (!cancelled) setWorldsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lorebooks");
        if (!res.ok) return;
        const data = (await res.json()) as {
          lorebooks?: KeywordLorebookListItem[];
        };
        if (!cancelled && Array.isArray(data.lorebooks)) {
          setSavedLorebooks(data.lorebooks);
        }
      } finally {
        if (!cancelled) setLorebooksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applySavedWorld(worldId: number | "") {
    setSelectedWorldId(worldId);
    if (worldId === "") return;
    const picked = savedWorlds.find((w) => w.id === worldId);
    if (picked) {
      setForm((f) => ({ ...f, world: picked.content }));
    }
  }

  function addSpeechRegister() {
    setForm((f) => ({
      ...f,
      speech_contextual_registers: [
        ...f.speech_contextual_registers,
        {
          label: "",
          condition: "",
          style: "",
          examples: "",
          priority: 80,
        },
      ].slice(0, 8),
    }));
  }

  function updateSpeechRegister(index: number, patch: Partial<SpeechContextualRegister>) {
    setForm((f) => ({
      ...f,
      speech_contextual_registers: f.speech_contextual_registers.map((register, i) =>
        i === index ? { ...register, ...patch } : register,
      ),
    }));
  }

  function removeSpeechRegister(index: number) {
    setForm((f) => ({
      ...f,
      speech_contextual_registers: f.speech_contextual_registers.filter((_, i) => i !== index),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!form.name.trim()) {
      setError("캐릭터 이름(또는 시뮬레이션명)을 입력해 주세요.");
      return;
    }
    if (form.name.length > CHARACTER_NAME_LIMIT) {
      setError(`이름은 ${CHARACTER_NAME_LIMIT}자 이하여야 합니다.`);
      return;
    }
    if (!form.tagline.trim()) {
      setError("한 줄 소개를 입력해 주세요.");
      return;
    }
    if (form.tagline.length > TAGLINE_LIMIT) {
      setError(`한 줄 소개는 ${TAGLINE_LIMIT}자 이하여야 합니다.`);
      return;
    }
    if (!form.system_prompt.trim()) {
      setError("캐릭터 설정은 필수입니다.");
      return;
    }
    if (aiLearningTotal < AI_LEARNING_MIN) {
      setError(
        `말투 설정 + 세계관 + 캐릭터 설정은 합쳐서 ${AI_LEARNING_MIN.toLocaleString()}자 이상 작성해 주세요.`,
      );
      return;
    }
    if (!form.gender) {
      setError("캐릭터 성별(남성/여성/기타)을 선택해 주세요.");
      return;
    }
    if (form.genres.length === 0) {
      setError("장르를 1개 이상 선택해 주세요.");
      return;
    }
    if (!form.greeting.trim()) {
      setError("첫 메세지를 입력해 주세요.");
      return;
    }
    if (aiLearningTotal > AI_LEARNING_LIMIT) {
      setError(
        `세계관/배경 + 캐릭터 설정 + 말투 설정은 합쳐서 ${AI_LEARNING_LIMIT.toLocaleString()}자 이하여야 합니다.`,
      );
      return;
    }
    if (form.greeting.length > GREETING_LIMIT) {
      setError(
        `첫 메세지는 ${GREETING_LIMIT.toLocaleString()}자 이하여야 합니다.`,
      );
      return;
    }
    if (files.length > 0) {
      setError(
        "선택한 이미지를 먼저 「업로드 · 태깅」을 실행한 뒤, 노출·대화 설정을 확인해 주세요.",
      );
      return;
    }
    if (assets.length === 0) {
      setError("감정 에셋 이미지를 1장 이상 업로드해 주세요.");
      return;
    }
    if (assets.length > 0 && !assets.some((a) => a.public)) {
      setError("노출할 이미지를 1장 이상 선택해 주세요.");
      return;
    }
    setLoading(true);
    setError("");

    const finalAssets = normalizeManagedAssets(assets);
    const description = form.description
      .trim()
      .slice(0, PROFILE_BIOGRAPHY_LIMIT);

    setProgress(isEditMode ? "캐릭터 저장 중…" : "캐릭터 생성 중…");
    const res = await fetch(
      isEditMode ? `/api/characters/${editCharacterId}` : "/api/characters",
      {
        method: isEditMode ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          description,
          status_window_prompt: "",
          status_widget_json: serializeStatusWidget(statusWidget),
          assets: finalAssets,
          world_id: selectedWorldId === "" ? undefined : selectedWorldId,
          lorebook_id:
            selectedLorebookId === "" ? undefined : selectedLorebookId,
        }),
      },
    );
    setLoading(false);
    setProgress("");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    if (data.moderationStatus === "rejected") {
      setError(
        `노출 이미지 검수 반려: ${data.moderationNote || "규정 위반"}. 캐릭터는 비공개로 저장되었습니다. 아래에서 수정 후 다시 저장하세요. (새로 만들면 중복됩니다)`,
      );
      router.replace(`/create?edit=${data.id}`);
      return;
    }
    if (data.visibility === "link" && data.sharePath) {
      setError("");
    }
    clearCharacterCreateDraft(userId, editCharacterId ?? null);
    router.push(`/character/${data.id}`);
  }

  const inputCls =
    "w-full rounded-xl border-2 border-violet-500/45 bg-[#0c0e1a] px-4 py-3 text-sm text-violet-50 outline-none ring-0 placeholder:text-gray-500 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.06)] focus:border-violet-400/75 focus:ring-2 focus:ring-violet-400/25 disabled:opacity-50";
  const cls = inputCls;
  const selectCls =
    "rounded-lg border-2 border-violet-500/45 bg-[#0c0e1a] px-3 py-2 text-xs text-violet-100 outline-none ring-0 focus:border-violet-400/75 focus:ring-2 focus:ring-violet-400/25 disabled:opacity-50";
  const cardNameCls = `${inputCls} py-3.5 text-lg font-bold tracking-tight`;
  const cardTaglineCls = `${inputCls} py-3.5 text-base font-semibold`;
  const publicDescriptionCls = `${inputCls} min-h-[320px] resize-y font-mono text-[13px] leading-relaxed`;
  const greetingCls = `${inputCls} min-h-[360px] resize-y py-5 text-lg leading-relaxed`;
  const label = "mb-1 block text-sm font-semibold text-gray-300";
  const sectionGreeting =
    "space-y-4 rounded-2xl border border-violet-500/35 bg-violet-500/[0.08] p-6 sm:p-7";
  const cardLabel = "mb-1 block text-sm font-bold text-emerald-200";
  const cardSubLabel = "mb-1 block text-sm font-bold text-violet-200";
  const tabPanelClass = (tab: PageTab) =>
    `col-start-1 row-start-1 min-w-0 space-y-8 ${
      pageTab === tab ? "" : "invisible pointer-events-none select-none"
    }`;
  const sectionPublic =
    "space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4";
  const sectionPrivate =
    "space-y-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4";
  const sectionMuted =
    "space-y-4 rounded-2xl border border-white/5 bg-[#0a0d14] p-4";

  return (
    <div className="mx-auto mt-4 max-w-6xl px-4 pb-24 lg:pb-12">
      <div>
        <Link
          href="/studio"
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          ← 제작 메뉴
        </Link>
        <h1 className="mt-2 text-xl font-black text-white">
          {isEditMode ? "캐릭터 수정" : "캐릭터 제작"}
        </h1>
        {isEditMode && (
          <p className="mt-1 text-sm text-gray-400">
            저장된 설정을 불러와 수정합니다. 저장 시 RP 프롬프트 청크가 다시
            생성됩니다.
          </p>
        )}
        {editLoading && (
          <p className="mt-2 text-sm text-violet-300">
            캐릭터 정보 불러오는 중…
          </p>
        )}
        {editLoadError && (
          <p className="mt-2 text-sm text-rose-400">{editLoadError}</p>
        )}
      </div>

      <div
        className="mt-6 flex gap-1 rounded-xl border border-white/10 bg-[#0e1120] p-1"
        role="tablist"
        aria-label="캐릭터 제작 탭"
      >
        {(
          [
            ["create", "제작"],
            ["preview", "공개설정 미리보기"],
            ["widget", "상태창"],
            ["publish", "공개 설정"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pageTab === id}
            onClick={() => setPageTab(id)}
            className={`flex-1 rounded-lg px-1 py-2.5 text-[11px] font-bold transition sm:px-2 sm:text-sm ${
              pageTab === id
                ? "bg-violet-600 text-white shadow-sm shadow-violet-900/40"
                : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6">
        <div className="grid">
          <div
            className={tabPanelClass("create")}
            aria-hidden={pageTab !== "create"}
          >
            {/* 0. 홈·목록 노출 (공개) */}
            <section className={sectionPublic}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-emerald-300">
                    홈·목록 노출 정보
                  </h2>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    홈 화면 카드에 표시 · 대표 이미지는 아래 감정 에셋 중 「노출
                    ON」 1번
                  </p>
                </div>
                <VisibilityBadge kind="public" />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className={cardLabel}>
                    이름 (캐릭터명 / 시뮬레이션명) *
                  </label>
                  <Counter now={form.name.length} max={CHARACTER_NAME_LIMIT} />
                </div>
                <input
                  className={cardNameCls}
                  placeholder="예: 리카르트 발크리드, WW2 시뮬레이터"
                  value={form.name}
                  maxLength={CHARACTER_NAME_LIMIT}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      name: e.target.value.slice(0, CHARACTER_NAME_LIMIT),
                    })
                  }
                />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className={cardSubLabel}>한 줄 소개 *</label>
                  <Counter now={form.tagline.length} max={TAGLINE_LIMIT} />
                </div>
                <input
                  className={cardTaglineCls}
                  placeholder="홈·목록에 보이는 짧은 소개 (50자 이내)"
                  value={form.tagline}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tagline: e.target.value.slice(0, TAGLINE_LIMIT),
                    })
                  }
                />
              </div>
              <div>
                <label className={label}>태그</label>
                <p className="mb-1 text-[11px] text-gray-600">
                  홈 카드·공개 페이지와 연동 · Enter로 추가 · 최대 12개
                </p>
                <TagChipInput
                  tags={form.tags}
                  onChange={(tags) => setForm({ ...form, tags })}
                  inputClassName={cls}
                  disabled={loading || editLoading}
                  placeholder="로판"
                />
              </div>
            </section>

            {/* 1. AI 학습 (비공개) */}
            <section className={sectionPrivate}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-violet-300">
                    비공개 설정( AI 대화에만 사용)
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-300/90">
                    글자수가 많아질수록 유저의 포인트 소모가 증가합니다. 항상 기억해야 할 내용이 아니라면
                    로어북을 이용해보세요.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <VisibilityBadge kind="private" />
                  <Counter now={aiLearningTotal} max={AI_LEARNING_LIMIT} />
                </div>
              </div>
              <div>
                <label className={label}>세계관 / 배경</label>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <select
                    className={selectCls}
                    value={selectedWorldId}
                    disabled={worldsLoading}
                    onChange={(e) => {
                      const v = e.target.value;
                      applySavedWorld(v === "" ? "" : Number(v));
                    }}
                  >
                    <option value="">직접 입력</option>
                    {savedWorlds.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.summary ? ` — ${w.summary}` : ""}
                      </option>
                    ))}
                  </select>
                  {!worldsLoading && savedWorlds.length === 0 && (
                    <Link
                      href="/world/create"
                      className="text-xs text-cyan-400 hover:underline"
                    >
                      세계관 먼저 만들기
                    </Link>
                  )}
                  {selectedWorldId !== "" && (
                    <span className="text-[11px] text-cyan-400/80">
                      저장된 세계관 불러옴 · 아래에서 수정 가능
                    </span>
                  )}
                </div>
                <textarea
                  rows={5}
                  className={cls}
                  placeholder="이야기의 배경, 시대, 장소, 세력, 규칙 등"
                  value={form.world}
                  onChange={(e) => {
                    setSelectedWorldId("");
                    setForm({ ...form, world: e.target.value });
                  }}
                />
              </div>
              <div>
                <label className={label}>캐릭터 설정 *</label>
                <p className="mb-1 text-[11px] text-gray-600">
                  성격, 말투 특징, 외모, 배경, 관계, 습관, 가치관 등
                </p>
                <textarea
                  required
                  rows={6}
                  className={cls}
                  placeholder="성격, 말투 특징, 외모, 배경, 관계, 습관, 가치관 등 (대사 예시는 아래 「말투 설정」에 작성)"
                  value={form.system_prompt}
                  onChange={(e) =>
                    setForm({ ...form, system_prompt: e.target.value })
                  }
                />
              </div>
              <div className="space-y-4 rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
                <div>
                  <h3 className="text-sm font-bold text-violet-200">
                    말투 고정
                  </h3>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    평소 말투와 상황별 말투 변화를 나누어 입력하면 장면에 맞는 대사가 더 안정적으로 유지됩니다.
                  </p>
                </div>
                <div>
                  <label className={label}>
                    <span className="text-gray-500">[권장]</span> 기본 말투
                  </label>
                  <textarea
                    rows={3}
                    className={cls}
                    placeholder="예: 평소에는 낮고 무뚝뚝한 반말. 감정을 직접 말하지 않고 짧게 돌려 말한다."
                    value={form.speech_personality}
                    onChange={(e) =>
                      setForm({ ...form, speech_personality: e.target.value })
                    }
                  />
                  <p className="mt-1 text-[11px] text-gray-600">
                    상황별 규칙이 맞지 않을 때 적용되는 캐릭터의 기본 대화 톤입니다.
                  </p>
                </div>
                <div>
                  <label className={label}>
                    <span className="text-gray-500">[권장]</span> 캐릭터 대사 예시{" "}
                    <span className="font-normal text-gray-500">
                      (많을수록 좋음)
                    </span>
                  </label>
                  <textarea
                    rows={8}
                    className={cls}
                    placeholder={
                      '어, 벌써 왔어? 기다리다 졸 뻔했는데.\n그건… 솔직히 나도 잘 모르겠어. 그냥 느낌이 그랬어.\n"오늘은 좀 일찍 자야겠다. 내일 아침에 일 있거든."\n뭐, 그렇게까지 생각할 일까지야?'
                    }
                    value={form.speech_examples}
                    onChange={(e) =>
                      setForm({ ...form, speech_examples: e.target.value })
                    }
                  />
                  <p className="mt-1 text-[11px] text-gray-600">
                    캐릭터 대사만 한 줄씩 · 유저 대사 불필요 · 따옴표 있어도
                    없어도 됩니다
                  </p>
                </div>
                <div className="space-y-3 rounded-xl border border-white/10 bg-black/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-violet-100">
                        상황별 말투
                      </h4>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        공적 자리, 친밀도 상승, 적대 상황처럼 말투가 달라지는 조건을 추가합니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addSpeechRegister}
                      disabled={form.speech_contextual_registers.length >= 8}
                      className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-400/10 disabled:opacity-40"
                    >
                      + 상황별 말투 추가
                    </button>
                  </div>

                  {form.speech_contextual_registers.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-[11px] text-gray-600">
                      필요할 때만 추가하세요. 예: 공적인 자리에서는 짧은 존댓말, 유저와 단둘일 때는 부드러운 반말.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {form.speech_contextual_registers.map((register, index) => (
                        <div
                          key={index}
                          className="space-y-3 rounded-xl border border-white/10 bg-[#0c0e1a] p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-violet-200">
                              #{index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeSpeechRegister(index)}
                              className="text-xs text-gray-500 hover:text-rose-300"
                            >
                              삭제
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className={label}>상황 이름</label>
                              <input
                                className={cls}
                                placeholder="예: 공적인 자리"
                                value={register.label}
                                onChange={(e) =>
                                  updateSpeechRegister(index, {
                                    label: e.target.value.slice(0, 40),
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className={label}>적용 조건</label>
                              <input
                                className={cls}
                                placeholder="예: 상관, 임무 보고, 공개 장소"
                                value={register.condition}
                                onChange={(e) =>
                                  updateSpeechRegister(index, {
                                    condition: e.target.value.slice(0, 160),
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div>
                            <label className={label}>말투 설명</label>
                            <textarea
                              rows={2}
                              className={cls}
                              placeholder="예: 짧고 절제된 존댓말/다나까체. 감정을 드러내지 않고 군인처럼 말한다."
                              value={register.style}
                              onChange={(e) =>
                                updateSpeechRegister(index, {
                                  style: e.target.value.slice(0, 240),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className={label}>대사 예시</label>
                            <textarea
                              rows={3}
                              className={cls}
                              placeholder={'"명령 확인했습니다."\n"즉시 이동하겠습니다."'}
                              value={register.examples}
                              onChange={(e) =>
                                updateSpeechRegister(index, {
                                  examples: e.target.value.slice(0, 600),
                                })
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className={label}>
                    <span className="text-gray-500">[선택]</span> 금지 말투
                  </label>
                  <textarea
                    rows={2}
                    className={cls}
                    placeholder="예: 입니다요, 하세요요, ㅋㅋ, 레전드, 헐, 대박, 밈, 인터넷체, 반말"
                    value={form.speech_forbidden}
                    onChange={(e) =>
                      setForm({ ...form, speech_forbidden: e.target.value })
                    }
                  />
                  <p className="mt-1 text-[11px] text-gray-600">
                    쉼표·줄바꿈으로 구분 · 비우면 기본 금지 목록(혼합 존댓말·밈
                    등)이 적용됩니다
                  </p>
                </div>
                <p className="text-right text-[11px] text-gray-600">
                  말투 설정 + 세계관 + 캐릭터 설정 합계{" "}
                  <span
                    className={
                      aiLearningTotal < AI_LEARNING_MIN
                        ? "font-semibold text-amber-400"
                        : ""
                    }
                  >
                    {aiLearningTotal.toLocaleString()}
                  </span>{" "}
                  / {AI_LEARNING_LIMIT.toLocaleString()}자 · 최소{" "}
                  {AI_LEARNING_MIN.toLocaleString()}자
                </p>
              </div>
              <div>
                <label className={label}>키워드 로어북</label>
                <p className="mb-2 text-[11px] text-gray-600">
                  유저 입력에 키워드가 포함되면 해당 항목 내용이 번역 없이
                  프롬프트에 주입됩니다.
                </p>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <select
                    className={selectCls}
                    value={selectedLorebookId}
                    disabled={lorebooksLoading}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelectedLorebookId(v === "" ? "" : Number(v));
                    }}
                  >
                    <option value="">연결 안 함</option>
                    {savedLorebooks.map((lb) => (
                      <option key={lb.id} value={lb.id}>
                        {lb.name}
                        {lb.summary ? ` — ${lb.summary}` : ""} ({lb.entryCount}
                        항목)
                      </option>
                    ))}
                  </select>
                  {!lorebooksLoading && savedLorebooks.length === 0 && (
                    <Link
                      href="/lorebook/create"
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      로어북 먼저 만들기
                    </Link>
                  )}
                  {savedLorebooks.length > 0 && (
                    <Link
                      href="/lorebook"
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      관리
                    </Link>
                  )}
                </div>
              </div>
            </section>

            {/* 2. 감정 에셋 (비공개) */}
            <section className={sectionMuted}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-gray-200">
                    감정 에셋 이미지
                  </h2>
                  <VisibilityBadge kind="private" />
                </div>
                <span className="text-xs text-gray-500">
                  {assets.length + files.length} / {MAX_IMAGES}장
                </span>
              </div>
              <p className="text-[11px] text-gray-500">
                대화 중 AI가 [태그: …]를 출력하면 해당 이미지로 좌측 초상이
                전환됩니다. 태그는 표정·포즈·상황 모두 가능합니다(예: 부끄러움,
                침대에 누움). 턴 끝 장면과 맞는 태그를 AI가 고릅니다. 업로드 시
                Gemini Vision이 태그를 자동 분석하며, 잘못된 태그는 에셋 하단
                태그를 클릭해 직접 수정할 수 있습니다.
                <br />
                <span className="text-amber-300/90">가리기</span>를 켠 이미지는
                제작자에게만 선명하게 보이고, 다른 유저에게는 블러 처리됩니다.
                새로 올린 이미지는{" "}
                <strong className="text-zinc-400">첫 번째만</strong> 공개·
                비가림, 나머지는 노출 OFF·가림 ON이 기본입니다.
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
                disabled={assets.length + files.length >= MAX_IMAGES}
                className="w-full rounded-xl border-2 border-dashed border-violet-500/40 bg-[#0c0e1a] py-6 text-sm text-violet-200/80 hover:border-violet-400/60 hover:bg-violet-500/5 disabled:opacity-40"
              >
                에셋 이미지 추가 (최대 {MAX_IMAGES}장 · Gemini 자동 태깅)
              </button>

              {files.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-400/90">
                    {files.length}장 선택됨 · 「업로드 · 태깅」 후 노출·대화
                    ON/OFF와 순서를 설정할 수 있습니다.
                  </p>
                  <button
                    type="button"
                    onClick={tagPendingFiles}
                    disabled={loading}
                    className="w-full rounded-xl bg-violet-600/80 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {loading && progress.includes("태그")
                      ? progress
                      : loading && progress.includes("업로드")
                        ? progress
                        : `${files.length}장 업로드 · 태깅`}
                  </button>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${f.size}-${i}`}
                        className="group relative overflow-hidden rounded-xl border border-amber-500/20 bg-[#0e1120]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={filePreviewUrls[i]}
                          alt=""
                          className="aspect-[3/4] w-full object-cover object-top opacity-90"
                        />
                        <span className="absolute bottom-0 left-0 right-0 truncate bg-black/75 px-2 py-1 text-[10px] text-amber-200/90">
                          {f.name}
                        </span>
                        <span className="absolute left-1 top-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                          대기
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white group-hover:flex"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {assets.length > 0 && (
                <AssetManagerGrid
                  assets={assets}
                  onChange={(next) => setAssets(normalizeManagedAssets(next))}
                  onRemove={removeAsset}
                />
              )}
            </section>

            {/* 3. 부가 설정 (비공개) */}
            <section className={sectionMuted}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-gray-400">부가 설정</h2>
                <VisibilityBadge kind="private" />
              </div>
              <div>
                <label className={label}>캐릭터 성별</label>
                <p className="mb-2 text-[11px] text-gray-600">
                  AI가 지문·외형·호칭을 이 성별에 맞게 묘사합니다 · 필수
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(["male", "female", "other"] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setForm({ ...form, gender: value })}
                      className={`rounded-xl border py-3 text-sm font-bold transition ${
                        form.gender === value
                          ? "border-violet-500 bg-violet-600/25 text-violet-200 ring-1 ring-violet-500/50"
                          : "border-violet-500/35 bg-[#0c0e1a] text-gray-400 hover:border-violet-400/55 hover:text-violet-100"
                      }`}
                    >
                      {GENDER_LABELS[value]}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* 4. 첫 메세지 (비공개) */}
            <section className={sectionGreeting}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-violet-100">
                  첫 메세지 · 필수
                </h2>
                <VisibilityBadge kind="private" />
              </div>
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="text-sm text-violet-200/85">
                    대화 시작 시 캐릭터가 보내는 첫 메시지 · 소개 페이지에
                    노출되지 않음
                  </p>
                  <Counter now={form.greeting.length} max={GREETING_LIMIT} />
                </div>
                <div className="mb-3 rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 text-xs leading-relaxed text-gray-300">
                  <p className="font-bold text-violet-200">
                    지문과 대사 구분 (채팅 표시)
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-gray-400">
                    <li>
                      <span className="text-zinc-400">지문</span> (행동·묘사):
                      따옴표 없이 서술하거나{" "}
                      <code className="rounded bg-black/30 px-1 text-zinc-300">
                        *별표*
                      </code>
                      로 감싸기 →{" "}
                      <span className="italic text-zinc-500">회색 이탤릭</span>
                    </li>
                    <li>
                      <span className="text-orange-300">대사</span> (캐릭터 말):
                      반드시{" "}
                      <code className="rounded bg-black/30 px-1 text-orange-200">
                        &quot;큰따옴표&quot;
                      </code>
                      로 감싸기 →{" "}
                      <span className="font-semibold text-orange-300">
                        주황색
                      </span>
                    </li>
                    <li>Enter로 줄바꿈하면 채팅에서 문단이 나뉩니다.</li>
                  </ul>
                </div>
                <textarea
                  rows={14}
                  className={greetingCls}
                  placeholder={`대화 시작 시 캐릭터가 보내는 첫 메시지를 입력하세요.\n\n예:\n*창가에 기대어 연기를 내뿜으며 시선을 올린다.*\n"……왔어?"`}
                  value={form.greeting}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      greeting: e.target.value.slice(0, GREETING_LIMIT),
                    })
                  }
                />
              </div>
            </section>
          </div>

          <div
            className={tabPanelClass("preview")}
            aria-hidden={pageTab !== "preview"}
          >
            <section className={`${sectionPublic} scroll-mt-24`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-emerald-300">
                    공개 캐릭터/세계관 정보
                  </h2>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                    마크다운으로 작성 · 입력하면 아래 미리보기에 실시간 반영 ·{" "}
                    <span className="text-emerald-400/90">이름:</span> 같은 항목
                    제목은 자동 굵게·색상 처리 · 최대{" "}
                    {PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자
                  </p>
                </div>
                <VisibilityBadge kind="public" />
              </div>
              <p className="mt-2 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3.5 py-2.5 text-sm font-medium leading-relaxed text-cyan-100">
                ※ 소개 본문용 이미지 URL을 아래 공개정보 입력란에 넣으면 이미지
                삽입이 가능합니다. (한 줄에 URL 하나, 또는{" "}
                <span className="font-mono text-cyan-200">![이미지](URL)</span>{" "}
                형식)
              </p>
              <PublicDescriptionFormatToolbar
                textareaRef={publicDescriptionRef}
                value={form.description}
                maxLength={PROFILE_BIOGRAPHY_LIMIT}
                onChange={(description) => setForm({ ...form, description })}
              />
              <textarea
                ref={publicDescriptionRef}
                rows={16}
                maxLength={PROFILE_BIOGRAPHY_LIMIT}
                className={publicDescriptionCls}
                placeholder={`이름: 백하율\n성격: 차분하고 관찰력이 뛰어남\n나이: 20대\n\n※ 항목 제목(이름:, 성격:, 나이: 등)은 미리보기에서 자동으로 굵게·색상 표시됩니다.\n※ 더 꾸미려면 텍스트 선택 후 위 「굵게·크게·작게·색상」 버튼을 사용하세요.`}
                value={form.description}
                onChange={(e) =>
                  setForm({
                    ...form,
                    description: e.target.value.slice(
                      0,
                      PROFILE_BIOGRAPHY_LIMIT,
                    ),
                  })
                }
              />
              <p className="text-right text-[11px] text-gray-600">
                {form.description.length.toLocaleString()} /{" "}
                {PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자
              </p>
            </section>

            <section
              ref={profilePreviewPanelRef}
              className={`${sectionPublic} scroll-mt-24`}
            >
              <div>
                <h2 className="text-sm font-bold text-emerald-300">
                  공개 페이지 미리보기
                </h2>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  홈 카드 클릭 시 보이는 화면 · 좌측 대표는 감정 에셋 1번
                </p>
              </div>
              <div className="rounded-xl border border-violet-500/20 bg-black/20 p-2 sm:p-3">
                <CharacterPublicPagePreview
                  name={form.name}
                  tagline={form.tagline}
                  tags={form.tags}
                  description={previewDescription}
                  cardImageUrl={cardImageUrl}
                  galleryAssets={assets}
                  viewerIsCreator
                  assetImageUrls={assetImageUrls}
                  creatorComment={form.creator_comment}
                  creatorName={creatorDisplayName}
                  creatorIsPartner={creatorIsPartner}
                  emoji={form.emoji}
                  hue={form.hue}
                  collapsibleDescription={false}
                  viewerDisplayName={viewerDisplayName}
                />
              </div>
            </section>
          </div>

          <div
            className={tabPanelClass("widget")}
            aria-hidden={pageTab !== "widget"}
          >
            <section className={sectionMuted}>
              <div className="mb-1 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-violet-200">
                    상태창 위젯
                  </h2>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    HTML 레이아웃 제작 · 상태값·지시 토큰 환산 500자
                  </p>
                </div>
                <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] font-bold text-violet-200">
                  기본 적용
                </span>
              </div>
              <StatusWidgetEditor
                value={statusWidget}
                onChange={setStatusWidget}
                disabled={loading}
              />
            </section>
          </div>

          <div
            className={tabPanelClass("publish")}
            aria-hidden={pageTab !== "publish"}
          >
            <section className={sectionMuted}>
              <div>
                <h2 className="text-sm font-bold text-gray-200">노출 · 장르</h2>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  홈·목록 노출 대상과 장르를 설정합니다.
                </p>
              </div>
              <div>
                <label className={label}>타깃</label>
                <p className="mb-2 text-[11px] text-gray-600">
                  홈·목록 노출 대상 · 필수
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["all", "공용"],
                      ["female", "여성향"],
                      ["male", "남성향"],
                    ] as const
                  ).map(([value, audienceLabel]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setForm({ ...form, audience: value })}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        form.audience === value
                          ? "bg-violet-600 text-white"
                          : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                      }`}
                    >
                      {audienceLabel}
                    </button>
                  ))}
                </div>
              </div>
              <GenrePicker
                value={form.genres}
                onChange={(genres) => setForm({ ...form, genres })}
                disabled={loading}
              />
            </section>

            <section className={sectionPrivate}>
              <div>
                <h2 className="text-sm font-bold text-violet-300">
                  공개 · 운영 설정
                </h2>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  NSFW, 공개 범위, 댓글을 설정합니다.
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
                <input
                  type="checkbox"
                  checked={form.nsfw}
                  onChange={(e) => setForm({ ...form, nsfw: e.target.checked })}
                  className="h-5 w-5 accent-rose-600"
                />
                <div>
                  <p className="font-semibold text-rose-300">NSFW 캐릭터</p>
                  <p className="text-xs text-gray-500">
                    성인인증 + 성인 보기 ON 사용자에게만 노출
                  </p>
                </div>
              </label>

              <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4">
                <p className="text-sm font-bold text-violet-200">공개 설정</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  공개·링크 공개 선택 시 노출 이미지가 국내 성인 검열 기준으로
                  자동 검수됩니다. 반려 시 비공개로 저장됩니다.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["public", "공개", "신작·목록에 노출"],
                      ["link", "링크 공개", "URL로만 공유 · 목록 숨김"],
                      ["private", "비공개", "나만 볼 수 있음"],
                    ] as const
                  ).map(([value, title, desc]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setForm({ ...form, visibility: value })}
                      className={`rounded-xl border p-3 text-left transition ${
                        form.visibility === value
                          ? "border-violet-500 bg-violet-600/20 ring-1 ring-violet-500/50"
                          : "border-white/10 bg-[#0e1120] hover:border-white/20"
                      }`}
                    >
                      <p className="text-sm font-bold text-white">{title}</p>
                      <p className="mt-0.5 text-[10px] text-gray-500">{desc}</p>
                    </button>
                  ))}
                </div>
                <div className="mt-4 border-t border-white/10 pt-4">
                  <ToggleSwitch
                    checked={form.comments_enabled}
                    onChange={(next) =>
                      setForm({ ...form, comments_enabled: next })
                    }
                    disabled={loading}
                    label="댓글 허용"
                    description="OFF 시 다른 사용자는 이 캐릭터에 댓글을 보거나 작성할 수 없습니다."
                  />
                </div>
              </div>
            </section>

            <section className={sectionMuted}>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className={label}>제작자 코멘트</label>
                  <Counter
                    now={form.creator_comment.length}
                    max={CREATOR_COMMENT_LIMIT}
                  />
                </div>
                <p className="mb-2 text-[11px] text-gray-600">
                  공개 페이지 캐릭터 설명 하단에 표시 · HTML 사용 가능 (p, b, a,
                  ul, img 등 · script 금지) · 업데이트 안내, 플레이 팁 등 (선택)
                </p>
                <textarea
                  rows={8}
                  className={cls}
                  placeholder="예: v1.2 업데이트 — 말투를 조금 부드럽게 수정했습니다. 플레이 팁: 첫 대화에서 ○○를 언급하면 반응이 좋아요."
                  value={form.creator_comment}
                  maxLength={CREATOR_COMMENT_LIMIT}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      creator_comment: e.target.value.slice(
                        0,
                        CREATOR_COMMENT_LIMIT,
                      ),
                    })
                  }
                />
                {form.creator_comment.trim() ? (
                  <div className="mt-3 rounded-xl border border-white/10 bg-[#0e1120] p-4">
                    <p className="mb-2 text-[10px] font-bold text-gray-500">
                      미리보기
                    </p>
                    <CreatorCommentHtml html={form.creator_comment} />
                  </div>
                ) : null}
              </div>

              {error ? <p className="text-sm text-rose-400">{error}</p> : null}
              {!createReady && !loading && !editLoading ? (
                <ul className="space-y-1 rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3 text-[11px] text-gray-500">
                  <li
                    className={
                      createRequirements.hasAsset ? "text-emerald-400/90" : ""
                    }
                  >
                    {createRequirements.hasAsset ? "✓" : "○"} 제작 탭 · 감정
                    에셋 1장 이상 업로드
                  </li>
                  <li
                    className={
                      createRequirements.hasMinAiText
                        ? "text-emerald-400/90"
                        : ""
                    }
                  >
                    {createRequirements.hasMinAiText ? "✓" : "○"}{" "}
                    말투·세계관·소개 합계 {AI_LEARNING_MIN.toLocaleString()}자
                    이상
                    {!createRequirements.hasMinAiText
                      ? ` (현재 ${aiLearningTotal.toLocaleString()}자)`
                      : ""}
                  </li>
                  <li
                    className={
                      createRequirements.hasGender ? "text-emerald-400/90" : ""
                    }
                  >
                    {createRequirements.hasGender ? "✓" : "○"} 제작 탭 · 캐릭터
                    성별 선택
                  </li>
                  <li
                    className={
                      createRequirements.hasGreeting
                        ? "text-emerald-400/90"
                        : ""
                    }
                  >
                    {createRequirements.hasGreeting ? "✓" : "○"} 제작 탭 · 첫
                    메세지 입력
                  </li>
                  <li
                    className={
                      createRequirements.hasGenre ? "text-emerald-400/90" : ""
                    }
                  >
                    {createRequirements.hasGenre ? "✓" : "○"} 장르 1개 이상 선택
                  </li>
                </ul>
              ) : null}
              <button
                type="submit"
                disabled={
                  loading || editLoading || !!editLoadError || !createReady
                }
                className="w-full rounded-xl bg-violet-600 py-3 font-bold text-white disabled:opacity-50"
              >
                {loading
                  ? progress || "처리 중…"
                  : isEditMode
                    ? "변경사항 저장"
                    : "캐릭터 만들기"}
              </button>
            </section>
          </div>
        </div>

        {error && pageTab !== "publish" ? (
          <p className="text-sm text-rose-400">{error}</p>
        ) : null}
      </form>

      <button
        type="button"
        onClick={saveDraftLocally}
        disabled={editLoading}
        title={
          draftSavedAt
            ? `마지막 임시저장: ${formatDraftSavedAt(draftSavedAt)}`
            : "브라우저에 임시 저장"
        }
        className={`fixed bottom-20 right-4 z-50 flex flex-col items-center rounded-2xl border px-4 py-3 text-sm font-bold shadow-lg shadow-violet-900/40 transition md:bottom-6 md:right-6 ${
          draftFlash
            ? "border-emerald-500/50 bg-emerald-600 text-white shadow-emerald-900/40"
            : "border-violet-500/60 bg-violet-600 text-white hover:border-violet-400 hover:bg-violet-500"
        }`}
      >
        <span>{draftFlash ? "저장됨 ✓" : "임시저장"}</span>
        {draftSavedAt && !draftFlash ? (
          <span className="mt-0.5 text-[10px] font-normal text-violet-200/90">
            {formatDraftSavedAt(draftSavedAt)}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function VisibilityBadge({ kind }: { kind: "public" | "private" }) {
  if (kind === "public") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
        공개
      </span>
    );
  }
  return (
    <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-bold text-gray-500">
      비공개
    </span>
  );
}

function Counter({ now, max }: { now: number; max: number }) {
  return (
    <span
      className={`text-xs ${now > max ? "font-bold text-rose-400" : "text-gray-500"}`}
    >
      {now.toLocaleString()} / {max.toLocaleString()}자
    </span>
  );
}
