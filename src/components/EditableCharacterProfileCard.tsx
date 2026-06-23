"use client";

import { useEffect, useRef, useState } from "react";
import type { GeneratedProfile } from "@/lib/generateProfile";
import { normalizeGeneratedProfile, PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { CHARACTER_NAME_LIMIT } from "@/lib/characters";
import CharacterPublicPagePreview, {
  buildPublicCharacterDescription,
} from "@/components/CharacterPublicPagePreview";
import type { LayoutHint } from "@/lib/profileTypography";
import { parseImageUrls } from "@/lib/imageUrls";
import {
  galleryImageUrls,
  normalizeBiographyStructure,
  removeUrlFromImageList,
} from "@/lib/profileMarkdown";
import ProfileImageEditor, {
  MarkdownToolbar,
  PROFILE_IMAGE_DRAG_MIME,
  getTextareaIndexFromPoint,
  insertIntoTextarea,
  insertIntoTextareaAt,
} from "@/components/ProfileImageEditor";
import TagChipInput from "@/components/TagChipInput";

const fieldCls =
  "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40";

type EditDraft = {
  name: string;
  tags: string[];
  summary: string;
  appearance: string;
  biography: string;
  layoutHint: LayoutHint;
  imageUrls: string;
};

function syncGalleryInDraft(draft: EditDraft): EditDraft {
  const all = parseImageUrls(draft.imageUrls);
  const gallery = galleryImageUrls(all, draft.biography);
  return { ...draft, imageUrls: gallery.join("\n") };
}

function toDraft(profile: GeneratedProfile, imageUrls: string[]): EditDraft {
  return syncGalleryInDraft({
    name: profile.name ?? "",
    tags: profile.tags ?? [],
    summary: profile.summary ?? "",
    appearance: profile.appearance ?? "",
    biography: normalizeBiographyStructure(profile.biography ?? ""),
    layoutHint: profile.layoutHint ?? "right",
    imageUrls: imageUrls.join("\n"),
  });
}

function draftToProfile(draft: EditDraft): GeneratedProfile {
  return normalizeGeneratedProfile({
    name: draft.name.trim().slice(0, CHARACTER_NAME_LIMIT) || null,
    tags: draft.tags.length ? draft.tags : null,
    summary: draft.summary.trim().slice(0, 50) || null,
    appearance: draft.appearance.trim() || null,
    biography: draft.biography.trim().slice(0, PROFILE_BIOGRAPHY_LIMIT) || null,
    layoutHint: draft.layoutHint,
  });
}

function parseMarkdownImageUrl(snippet: string): string | null {
  return snippet.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1]?.trim() ?? null;
}

function parseDroppedImageUrl(dataTransfer: DataTransfer): string {
  const mime = dataTransfer.getData(PROFILE_IMAGE_DRAG_MIME);
  if (mime) return mime;
  const plain = dataTransfer.getData("text/plain");
  const fromMarkdown = plain.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1];
  if (fromMarkdown) return fromMarkdown.trim();
  return parseImageUrls(plain)[0] ?? "";
}

/** 스마트 미리보기 + 디자인 수정 (실시간 미리보기 · 드래그 이미지 삽입) */
export default function EditableCharacterProfileCard({
  profile,
  imageUrls,
  estimated,
  warning,
  onChange,
  layout = "compact",
  editing: editingProp,
  onEditingChange,
  onEditRequest,
  mode = "default",
  onPersist,
  onPreviewClose,
  viewerDisplayName,
  cardImageUrl = "",
  assetImageUrls = [],
  cardFields,
  creatorComment = "",
  creatorName = "제작자",
  emoji = "🎭",
  hue = 260,
  collapsibleDescription = false,
}: {
  profile: GeneratedProfile;
  imageUrls: string[];
  estimated?: boolean;
  warning?: string;
  onChange: (profile: GeneratedProfile, imageUrls: string[]) => void;
  layout?: "compact" | "page";
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onEditRequest?: () => void;
  mode?: "default" | "preview";
  onPersist?: (profile: GeneratedProfile, imageUrls: string[]) => void;
  /** Fallback when window.close() is blocked (preview mode) */
  onPreviewClose?: () => void;
  /** {{user}} 미리보기 치환 — 페르소나 이름(없으면 닉네임) */
  viewerDisplayName?: string | null;
  /** 홈·카드 대표 — 감정 에셋 노출 1번 (imageUrls와 별개) */
  cardImageUrl?: string;
  /** 감정 에셋 갤러리 URL (제작 탭 업로드) */
  assetImageUrls?: string[];
  /** 제작 탭 홈·카드 필드 — 미리보기 표시·동기화 우선 */
  cardFields?: { name: string; tagline: string; tags: string[] };
  creatorComment?: string;
  creatorName?: string;
  emoji?: string;
  hue?: number;
  collapsibleDescription?: boolean;
}) {
  const [internalEditing, setInternalEditing] = useState(layout === "page" || mode === "preview");
  const isControlled = editingProp !== undefined;
  const isEditing = isControlled ? editingProp : internalEditing;

  const setEditing = (next: boolean) => {
    if (!isControlled) setInternalEditing(next);
    onEditingChange?.(next);
  };

  const [draft, setDraft] = useState<EditDraft>(() => toDraft(profile, imageUrls));
  const [snapshot, setSnapshot] = useState<EditDraft>(() => toDraft(profile, imageUrls));

  const [showApplySuccess, setShowApplySuccess] = useState(false);
  const [applyJustApplied, setApplyJustApplied] = useState(false);

  useEffect(() => {
    if (layout === "page" && editingProp === undefined) {
      setInternalEditing(true);
    }
    if (mode === "preview") {
      setInternalEditing(true);
    }
  }, [layout, editingProp, mode]);

  useEffect(() => {
    if (!isEditing) {
      setDraft(toDraft(profile, imageUrls));
      setSnapshot(toDraft(profile, imageUrls));
      return;
    }
    const name = cardFields?.name ?? profile.name ?? "";
    const tags = cardFields?.tags ?? profile.tags ?? [];
    const summary = cardFields?.tagline ?? profile.summary ?? "";
    setDraft((prev) => {
      const tagsSame =
        prev.tags.length === tags.length && prev.tags.every((t, i) => t === tags[i]);
      if (prev.name === name && tagsSame && prev.summary === summary) return prev;
      return { ...prev, name, tags: [...tags], summary };
    });
  }, [
    profile,
    imageUrls,
    isEditing,
    profile.name,
    profile.tags,
    profile.summary,
    cardFields?.name,
    cardFields?.tagline,
    cardFields?.tags,
  ]);

  function startEdit() {
    if (layout === "compact" && onEditRequest) {
      onEditRequest();
      return;
    }
    const cur = toDraft(profile, imageUrls);
    setDraft(cur);
    setSnapshot(cur);
    setEditing(true);
  }

  function saveEdit() {
    const synced = syncGalleryInDraft(draft);
    const nextProfile = draftToProfile(synced);
    const nextUrls = parseImageUrls(synced.imageUrls);
    onChange(nextProfile, nextUrls);
    onPersist?.(nextProfile, nextUrls);
    if (mode === "preview") {
      setShowApplySuccess(true);
      setApplyJustApplied(true);
      try {
        window.opener?.focus();
      } catch {
        /* ignore */
      }
      window.setTimeout(() => setShowApplySuccess(false), 3000);
      window.setTimeout(() => setApplyJustApplied(false), 2000);
      return;
    }
    setEditing(false);
  }

  function cancelEdit() {
    if (mode === "preview") {
      try {
        window.opener?.focus();
      } catch {
        /* ignore */
      }
      window.close();
      window.setTimeout(() => {
        if (!window.closed) onPreviewClose?.();
      }, 150);
      return;
    }
    setDraft(snapshot);
    setEditing(false);
  }

  const syncedDraft = syncGalleryInDraft(draft);
  const previewUrls = parseImageUrls(syncedDraft.imageUrls);
  const viewGalleryUrls = galleryImageUrls(imageUrls, profile.biography ?? "");

  const setDraftLive = (updater: EditDraft | ((prev: EditDraft) => EditDraft)) => {
    setDraft((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (mode === "preview" || layout === "page") {
        const synced = syncGalleryInDraft(next);
        const profileFromDraft = draftToProfile(synced);
        const merged = normalizeGeneratedProfile({
          ...profileFromDraft,
          name: (cardFields?.name ?? synced.name).trim() || profileFromDraft.name,
          summary: (cardFields?.tagline ?? synced.summary).trim() || profileFromDraft.summary,
          tags: (cardFields?.tags?.length ? cardFields.tags : synced.tags.length ? synced.tags : null),
        });
        onChange(merged, parseImageUrls(synced.imageUrls));
      }
      return next;
    });
  };

  const liveProfile = isEditing ? draftToProfile(syncedDraft) : profile;
  const liveGalleryUrls = isEditing ? previewUrls : viewGalleryUrls;
  const liveTags = cardFields?.tags?.length
    ? cardFields.tags
    : isEditing
      ? syncedDraft.tags
      : (profile.tags ?? []);
  const previewName = (cardFields?.name ?? liveProfile.name ?? "").trim();
  const previewTagline = (cardFields?.tagline ?? liveProfile.summary ?? "").trim();

  const previewDescription = isEditing
    ? (liveProfile.biography ?? "")
    : assetImageUrls.length > 0
      ? (profile.biography ?? "").trim()
      : buildPublicCharacterDescription(viewGalleryUrls, profile.biography ?? "");

  const previewCard = (
    <CharacterPublicPagePreview
      name={previewName}
      tagline={previewTagline}
      tags={liveTags}
      description={previewDescription}
      cardImageUrl={cardImageUrl}
      assetImageUrls={assetImageUrls}
      creatorComment={creatorComment}
      creatorName={creatorName}
      emoji={emoji}
      hue={hue}
      collapsibleDescription={collapsibleDescription}
      viewerDisplayName={viewerDisplayName}
    />
  );

  const headerTitle =
    mode === "preview"
      ? "공개 페이지 미리보기"
      : layout === "page"
        ? "디자인 수정"
        : isEditing
          ? "디자인 수정 중"
          : "스마트 미리보기";

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0d14] shadow-xl shadow-black/30">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0e1120]/95 px-4 py-3 backdrop-blur-sm">
        <div>
          <p className="text-xs font-bold text-cyan-300">{headerTitle}</p>
          {estimated && !isEditing && mode !== "preview" && (
            <p className="text-[10px] text-amber-400/80">데모/추정 변환</p>
          )}
          {isEditing && (
            <p className="text-[10px] text-violet-300/80">
              {mode === "preview"
                ? "이미지 썸네일 → 공개 소개 소스로 드래그 · 아래 실시간 미리보기"
                : "실시간 미리보기 · 이미지를 공개 소개 소스로 드래그해 삽입"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isEditing && layout === "compact" && (
            <p className="max-w-[220px] text-[10px] leading-snug text-gray-500 sm:max-w-none">
              마음에 안 들면{" "}
              <span className="text-violet-300/90">수정하기</span>로 직접 편집할 수 있습니다.
            </p>
          )}
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={saveEdit}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white transition ${
                  mode === "preview" && applyJustApplied
                    ? "bg-emerald-600 hover:bg-emerald-500"
                    : "bg-violet-600 hover:bg-violet-500"
                }`}
              >
                {mode === "preview" ? (applyJustApplied ? "적용됨 ✓" : "적용") : "저장"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700"
              >
                {mode === "preview" ? "닫기" : "취소"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="shrink-0 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:border-violet-400/60 hover:bg-violet-500/20"
            >
              수정하기
            </button>
          )}
        </div>
      </div>

      {showApplySuccess && mode === "preview" ? (
        <div className="sticky top-[52px] z-40 border-b border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-center text-xs font-semibold text-emerald-200">
          제작 페이지에 반영되었습니다
        </div>
      ) : null}

      <div className="p-3 sm:p-4">
        {isEditing ? (
          mode === "preview" || layout === "page" ? (
            <div className="space-y-6">
              <EditForm
                draft={syncedDraft}
                setDraft={mode === "preview" || layout === "page" ? setDraftLive : setDraft}
                previewMode={mode === "preview"}
                lockCardFields={layout === "page" && !!cardFields}
              />
              <div className="min-w-0">
                <p className="mb-2 text-sm font-bold text-violet-300">공개 페이지 미리보기</p>
                <p className="mb-3 text-[11px] leading-relaxed text-gray-500">
                  홈에서 캐릭터 카드를 눌렀을 때 보이는 페이지와 동일 · 소스에서 수정하면{" "}
                  <span className="text-emerald-300/90">즉시</span> 반영됩니다.
                </p>
                <div className="w-full min-w-0 rounded-xl border border-violet-500/20 bg-black/20 p-2 sm:p-3">
                  {previewCard}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <EditForm draft={syncedDraft} setDraft={setDraft} />
              <div className="rounded-xl border border-violet-500/20 bg-black/20 p-2 sm:p-3">
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-violet-300/70">
                  공개 페이지 미리보기
                </p>
                {previewCard}
              </div>
            </div>
          )
        ) : (
          previewCard
        )}
      </div>
    </div>
  );
}

function EditForm({
  draft,
  setDraft,
  previewMode = false,
  lockCardFields = false,
}: {
  draft: EditDraft;
  setDraft: (d: EditDraft) => void;
  previewMode?: boolean;
  lockCardFields?: boolean;
}) {
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const [bioDragOver, setBioDragOver] = useState(false);
  const galleryUrls = parseImageUrls(draft.imageUrls);

  function applyBiography(biography: string) {
    setDraft(syncGalleryInDraft({ ...draft, biography }));
  }

  function insertBio(snippet: string) {
    const movedUrl = parseMarkdownImageUrl(snippet);
    insertIntoTextarea(bioRef.current, snippet, draft.biography, (biography) => {
      let imageUrls = draft.imageUrls;
      if (movedUrl) {
        imageUrls = removeUrlFromImageList(imageUrls, movedUrl);
      }
      setDraft(syncGalleryInDraft({ ...draft, biography, imageUrls }));
    });
  }

  function insertImageUrlAtBioIndex(url: string, index: number) {
    if (!url) return;
    insertIntoTextareaAt(bioRef.current, index, url, draft.biography, (biography) => {
      const imageUrls = removeUrlFromImageList(draft.imageUrls, url);
      setDraft(syncGalleryInDraft({ ...draft, biography, imageUrls }));
    });
  }

  function handleBioDrop(e: React.DragEvent) {
    e.preventDefault();
    setBioDragOver(false);
    const url = parseDroppedImageUrl(e.dataTransfer);
    if (!url || !bioRef.current) return;
    const index = getTextareaIndexFromPoint(bioRef.current, e.clientX, e.clientY);
    insertImageUrlAtBioIndex(url, index);
  }

  function handleBioDragOver(e: React.DragEvent) {
    const hasImage =
      e.dataTransfer.types.includes(PROFILE_IMAGE_DRAG_MIME) ||
      e.dataTransfer.types.includes("text/plain");
    if (!hasImage) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setBioDragOver(true);
    if (bioRef.current) {
      const index = getTextareaIndexFromPoint(bioRef.current, e.clientX, e.clientY);
      bioRef.current.focus();
      bioRef.current.setSelectionRange(index, index);
    }
  }

  const imageGallerySection = (
    <div className="rounded-xl border border-white/10 bg-[#0e1120] p-3">
      <p className="text-xs font-semibold text-gray-300">이미지</p>
      <p className="mt-0.5 text-[10px] text-gray-500">
        URL 입력 → 썸네일 표시 → 공개 소개 소스 편집창으로 드래그해 위치에 삽입
      </p>
      <textarea
        rows={2}
        className={`${fieldCls} mt-2 font-mono text-xs`}
        value={draft.imageUrls}
        onChange={(e) => setDraft(syncGalleryInDraft({ ...draft, imageUrls: e.target.value }))}
        placeholder="https://i.imgur.com/....png"
      />
      <div className="mt-3">
        <ProfileImageEditor
          urls={galleryUrls}
          layoutHint={draft.layoutHint}
          onUrlsChange={(urls) => setDraft(syncGalleryInDraft({ ...draft, imageUrls: urls.join("\n") }))}
          onLayoutChange={(layoutHint) => setDraft({ ...draft, layoutHint })}
          onInsertToBiography={insertBio}
        />
      </div>
    </div>
  );

  const biographyEditor = (
    <div className={previewMode ? "flex min-h-0 flex-1 flex-col" : undefined}>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="block text-xs font-semibold text-gray-400">
          {previewMode
            ? "공개 소개 소스 (사이트 공통 디자인 구조)"
            : `소개 본문 (사이트 공통 형식 · 최대 ${PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자)`}
        </label>
        <span
          className={`text-xs ${draft.biography.length > PROFILE_BIOGRAPHY_LIMIT ? "font-bold text-rose-400" : "text-gray-500"}`}
        >
          {draft.biography.length.toLocaleString()} / {PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자
        </span>
      </div>
      {previewMode && (
        <p className="mb-2 text-[11px] leading-relaxed text-gray-500">
          위 썸네일을 이 편집창으로 드래그하면 놓은 위치에 이미지 주소가 들어가고, 아래 미리보기에
          바로 반영됩니다. {"{{user}}"}는 내 페르소나 이름(없으면 닉네임), {"{{char}}"}는 캐릭터
          카드명으로 표시됩니다.
        </p>
      )}
      <MarkdownToolbar onInsert={insertBio} imageUrls={galleryUrls} />
      <textarea
        ref={bioRef}
        rows={previewMode ? 22 : layoutRows(draft.biography)}
        maxLength={PROFILE_BIOGRAPHY_LIMIT}
        className={`${fieldCls} font-mono text-xs leading-relaxed transition ${
          previewMode ? "min-h-[42vh] flex-1 resize-y" : ""
        } ${bioDragOver ? "border-cyan-400/60 ring-2 ring-cyan-400/30" : ""}`}
        value={draft.biography}
        onChange={(e) => applyBiography(e.target.value)}
        onDragOver={handleBioDragOver}
        onDragLeave={() => setBioDragOver(false)}
        onDrop={handleBioDrop}
        placeholder={
          previewMode
            ? "## 메인 캐릭터\n### 캐릭터 이름\n- **신분:** ...\n- **외형:** ...\n\n## 서브 캐릭터\n### 이름\n- **신분:** ..."
            : "## 배경\n...\n\n![캐릭터](https://...)\n\n## 성격\n- **키워드** 강조"
        }
      />
      {!previewMode && (
        <p className="mt-1 text-[10px] text-gray-600">
          ## 제목 · - 목록 · **굵게** · &gt; 인용 · ![설명](URL) · --- 구분선 · 위 썸네일을 여기로
          드래그해 삽입
        </p>
      )}
    </div>
  );

  const profileMetaFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">이름</label>
        <input
          className={`${fieldCls} ${lockCardFields ? "cursor-not-allowed opacity-70" : ""}`}
          value={draft.name}
          maxLength={CHARACTER_NAME_LIMIT}
          readOnly={lockCardFields}
          onChange={(e) =>
            setDraft({ ...draft, name: e.target.value.slice(0, CHARACTER_NAME_LIMIT) })
          }
        />
        {lockCardFields ? (
          <p className="mt-1 text-[10px] text-emerald-400/80">제작 탭 · 홈·목록 노출에서 수정</p>
        ) : null}
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">태그</label>
        <TagChipInput
          tags={draft.tags}
          onChange={(tags) => setDraft({ ...draft, tags })}
          inputClassName={fieldCls}
          disabled={lockCardFields}
          placeholder="로판"
        />
        <p className="mt-1 text-[10px] text-gray-600">
          {lockCardFields ? "제작 탭 · 홈 카드와 연동" : "제작 탭 · 홈 카드와 연동 · Enter로 추가"}
        </p>
      </div>
      <div className="sm:col-span-2">
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-xs font-semibold text-gray-400">한 줄 소개 (홈·목록 · 50자)</label>
          <span className={`text-xs ${draft.summary.length > 50 ? "font-bold text-rose-400" : "text-gray-500"}`}>
            {draft.summary.length} / 50자
          </span>
        </div>
        <input
          className={`${fieldCls} ${lockCardFields ? "cursor-not-allowed opacity-70" : ""}`}
          value={draft.summary}
          readOnly={lockCardFields}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value.slice(0, 50) })}
        />
        {lockCardFields ? (
          <p className="mt-1 text-[10px] text-violet-400/80">제작 탭 · 홈·목록 노출에서 수정</p>
        ) : null}
      </div>
    </div>
  );

  if (previewMode) {
    return (
      <div className="flex flex-col gap-4">
        {profileMetaFields}
        {imageGallerySection}
        {biographyEditor}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {profileMetaFields}

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">
          {previewMode ? "이미지 URL (한 줄에 하나)" : "갤러리 이미지 URL (한 줄에 하나 · 본문에 넣은 URL은 자동 제외)"}
        </label>
        <textarea
          rows={2}
          className={`${fieldCls} font-mono text-xs`}
          value={draft.imageUrls}
          onChange={(e) => setDraft(syncGalleryInDraft({ ...draft, imageUrls: e.target.value }))}
          placeholder="https://... 또는 /uploads/..."
        />
      </div>

      <ProfileImageEditor
        urls={galleryUrls}
        layoutHint={draft.layoutHint}
        onUrlsChange={(urls) => setDraft(syncGalleryInDraft({ ...draft, imageUrls: urls.join("\n") }))}
        onLayoutChange={(layoutHint) => setDraft({ ...draft, layoutHint })}
        onInsertToBiography={insertBio}
      />

      {!previewMode && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-400">외형</label>
          <textarea
            rows={3}
            className={fieldCls}
            value={draft.appearance}
            onChange={(e) => setDraft({ ...draft, appearance: e.target.value })}
          />
        </div>
      )}
      {biographyEditor}
    </div>
  );
}

function layoutRows(biography: string): number {
  const lines = biography.split("\n").length;
  return Math.min(24, Math.max(12, lines + 2));
}
