"use client";

import { useEffect, useRef, useState } from "react";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import type { CharacterAsset } from "@/lib/characterAssets";
import {
  reorderCharacterAssets,
  toggleCharacterAssetViewerBlur,
  updateCharacterAssetTag,
} from "@/lib/characterAssets";
import { cn, studioType } from "@/lib/studioDesign";
import { isAssetHardRejected, isAssetNeedsAdminReview } from "@/lib/assetVisionPolicy";
import { pruneSelectedUrls } from "@/lib/assetManagerGridSelection";
import type { ContentKind } from "@/lib/simulationMode";
import {
  assignAssetsToVisualSubject,
  unassignVisualAssets,
  type VisualSubject,
} from "@/lib/visualSubjects";

export type ManagedAsset = CharacterAsset;

const TAG_MAX_LEN = 30;

type Props = {
  assets: ManagedAsset[];
  allAges?: boolean;
  onChange: (assets: ManagedAsset[]) => void;
  onRemove: (index: number) => void;
  note?: string;
  visualSubjects?: readonly VisualSubject[];
  contentKind?: ContentKind;
};

export default function AssetManagerGrid({
  assets,
  allAges = false,
  onChange,
  onRemove,
  note,
  visualSubjects,
  contentKind = "character",
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftTag, setDraftTag] = useState("");
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [bulkSubjectKey, setBulkSubjectKey] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const suppressSelectionClickRef = useRef(false);

  const assetUrlsList = assets.map((asset) => asset.url);

  useEffect(() => {
    if (editingIndex === null) return;
    tagInputRef.current?.focus();
    tagInputRef.current?.select();
  }, [editingIndex]);

  useEffect(() => {
    setSelectedUrls((current) => {
      const pruned = pruneSelectedUrls(current, assetUrlsList);
      if (pruned.size === current.size) {
        for (const url of current) {
          if (!pruned.has(url)) return pruned;
        }
        return current;
      }
      return pruned;
    });
  }, [assetUrlsList.join("\u0001")]);

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= assets.length || to >= assets.length) return;
    onChange(reorderCharacterAssets(assets, from, to));
  }

  function toggleViewerBlur(index: number) {
    onChange(toggleCharacterAssetViewerBlur(assets, index));
  }

  function startTagEdit(index: number) {
    setEditingIndex(index);
    setDraftTag(assets[index]?.tag ?? "");
  }

  function cancelTagEdit() {
    setEditingIndex(null);
    setDraftTag("");
  }

  function commitTagEdit(index: number) {
    const current = assets[index]?.tag ?? "";
    const trimmed = draftTag.trim().slice(0, TAG_MAX_LEN);
    setEditingIndex(null);
    setDraftTag("");
    if (!trimmed || trimmed === current) return;
    onChange(updateCharacterAssetTag(assets, index, trimmed));
  }

  function assignUrls(urls: readonly string[], subjectKey: string) {
    const filteredUrls = urls.filter((url) => {
      const index = assets.findIndex((asset) => asset.url === url);
      return index !== 0;
    });
    onChange(
      subjectKey
        ? assignAssetsToVisualSubject(assets, filteredUrls, subjectKey)
        : unassignVisualAssets(assets, filteredUrls)
    );
  }

  function toggleSelected(url: string) {
    setSelectedUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function handleImageSelectionToggle(url: string) {
    if (suppressSelectionClickRef.current) return;
    toggleSelected(url);
  }

  function handleImageSelectionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    url: string
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleImageSelectionToggle(url);
    }
  }

  const hiddenCount = assets.filter((a) => a.viewerBlur === true).length;
  const selectionEnabled = Boolean(visualSubjects && visualSubjects.length > 0);

  return (
    <div className="space-y-3">
      <p className={studioType.helper}>
        <span className="text-zinc-200">태그 클릭</span>하여 수정 · 드래그로 순서 변경 ·{" "}
        <span className="text-zinc-200">1번</span>이 카드 대표 이미지 ·{" "}
        <span className="text-zinc-200">가리기</span>는 타 유저 블러(소개·갤러리)
        {selectionEnabled ? (
          <>
            {" "}
            · <span className="text-zinc-200">이미지 클릭</span>으로 일괄 선택
          </>
        ) : null}
        {hiddenCount > 0 && (
          <span className="ml-2 text-zinc-300">가림 {hiddenCount}장</span>
        )}
        {note ? <span className="mt-1 block text-zinc-400">{note}</span> : null}
      </p>
      {selectionEnabled && (
        <div className="space-y-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSelectedUrls(
                  selectedUrls.size === assets.length
                    ? new Set()
                    : new Set(assets.map((asset) => asset.url))
                )
              }
              className="min-h-11 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-200"
            >
              {selectedUrls.size === assets.length ? "전체 선택 해제" : "전체 선택"}
            </button>
            <select
              value={bulkSubjectKey}
              onChange={(event) => setBulkSubjectKey(event.target.value)}
              className="min-h-11 rounded-lg border border-zinc-700 bg-[#080a14] px-3 text-xs text-zinc-100"
            >
              <option value="">
                {contentKind === "character" ? "주인공(메인)" : "미지정"}
              </option>
              {visualSubjects!.map((subject) => (
                <option key={subject.subjectKey} value={subject.subjectKey}>
                  {subject.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={selectedUrls.size === 0}
              onClick={() => {
                assignUrls([...selectedUrls], bulkSubjectKey);
                setSelectedUrls(new Set());
              }}
              className="min-h-11 rounded-lg bg-cyan-700 px-3 text-xs font-semibold text-white disabled:opacity-40"
            >
              선택 이미지 일괄 지정
            </button>
          </div>
          <p className="text-xs text-zinc-400">
            이미지 미리보기를 클릭해 선택한 뒤 인물을 한 번에 지정하거나 미지정으로
            되돌릴 수 있습니다.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {assets.map((a, i) => {
          const hardRejected = isAssetHardRejected(a);
          const reviewPending = isAssetNeedsAdminReview(a);
          const blockUpload = allAges && hardRejected;
          const isSelected = selectedUrls.has(a.url);
          return (
          <div
            key={`${a.url}-${i}`}
            draggable
            onDragStart={() => {
              suppressSelectionClickRef.current = true;
              setDragIndex(i);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              window.setTimeout(() => {
                suppressSelectionClickRef.current = false;
              }, 0);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) reorder(dragIndex, i);
              setDragIndex(null);
              suppressSelectionClickRef.current = true;
              window.setTimeout(() => {
                suppressSelectionClickRef.current = false;
              }, 0);
            }}
            className={cn(
              "group relative cursor-grab overflow-hidden rounded-xl border bg-[#161922] active:cursor-grabbing",
              blockUpload
                ? "border-rose-500/70 ring-1 ring-rose-500/40"
                : reviewPending
                  ? "border-amber-500/50 ring-1 ring-amber-500/30"
                  : hardRejected
                    ? "border-rose-500/50 ring-1 ring-rose-500/25"
                : dragIndex === i
                  ? "border-violet-500/60 opacity-60"
                  : "border-white/10",
            )}
          >
            {selectionEnabled ? (
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`${a.tag || i + 1} 이미지 ${isSelected ? "선택됨" : "선택"}`}
                onClick={() => handleImageSelectionToggle(a.url)}
                onKeyDown={(event) => handleImageSelectionKeyDown(event, a.url)}
                className={cn(
                  "relative block w-full cursor-pointer overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#161922]",
                  isSelected && "ring-2 ring-inset ring-cyan-400/90"
                )}
              >
                <CharacterAssetImage src={a.url} showHiddenBadge={a.viewerBlur === true} />
                {isSelected ? (
                  <span className="pointer-events-none absolute right-2 top-2 z-[5] flex h-7 w-7 items-center justify-center rounded-full bg-cyan-600 text-sm font-bold text-white shadow-lg ring-2 ring-white/20">
                    ✓
                  </span>
                ) : null}
                {isSelected ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] bg-cyan-500/25 py-1 text-center text-[10px] font-semibold text-cyan-50">
                    선택됨
                  </span>
                ) : null}
              </button>
            ) : (
              <CharacterAssetImage src={a.url} showHiddenBadge={a.viewerBlur === true} />
            )}
            {blockUpload ? (
              <div className="pointer-events-none absolute inset-x-0 top-10 z-[3] px-2">
                <p className="rounded-md bg-rose-600/95 px-2 py-1.5 text-center text-[11px] font-semibold leading-snug text-white">
                  유두·성기·항문 노출
                  <br />
                  일반 캐릭터에 넣을 수 없음
                </p>
              </div>
            ) : hardRejected ? (
              <div className="pointer-events-none absolute inset-x-0 top-10 z-[3] px-2">
                <p className="rounded-md bg-rose-600/95 px-2 py-1.5 text-center text-[11px] font-semibold leading-snug text-white">
                  유두·성기·항문 노출
                  <br />
                  저장 시 비공개 반려
                </p>
              </div>
            ) : reviewPending ? (
              <div className="pointer-events-none absolute inset-x-0 top-10 z-[3] px-2">
                <p className="rounded-md bg-amber-600/95 px-2 py-1.5 text-center text-[11px] font-semibold leading-snug text-white">
                  애매한 선정성
                  <br />
                  저장 시 관리자 검수
                </p>
              </div>
            ) : null}
            <div className="absolute left-2 top-2 flex flex-col gap-1">
              <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300">
                {i + 1}
              </span>
              {i === 0 && (
                <span className="rounded bg-cyan-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  메인
                </span>
              )}
            </div>
            <div
              className="border-t border-white/10 bg-black/35 px-2 py-2"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {editingIndex === i ? (
                <input
                  ref={tagInputRef}
                  type="text"
                  value={draftTag}
                  maxLength={TAG_MAX_LEN}
                  onChange={(e) => setDraftTag(e.target.value)}
                  onBlur={() => commitTagEdit(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitTagEdit(i);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelTagEdit();
                    }
                  }}
                  className="min-h-11 w-full rounded-lg border border-white/10 bg-black/50 px-2 text-center text-xs font-semibold text-zinc-100 outline-none focus:border-violet-500/60"
                  aria-label="감정 태그 수정"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startTagEdit(i)}
                  title="클릭하여 태그 수정"
                  className="min-h-11 w-full truncate rounded-lg bg-white/5 px-2 text-center text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                >
                  {a.tag || "태그 입력"}
                </button>
              )}
            </div>
            {visualSubjects && visualSubjects.length > 0 && (
              <div
                className="border-t border-white/10 bg-black/35 px-2 py-2"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <label className="mb-1 block text-[10px] font-medium text-zinc-400">
                  이미지 인물
                </label>
                <select
                  value={a.visualSubjectKey ?? ""}
                  disabled={i === 0}
                  onChange={(event) => assignUrls([a.url], event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-white/10 bg-black/50 px-2 text-xs text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {contentKind === "character" ? "주인공(메인)" : "미지정"}
                  </option>
                  {visualSubjects.map((subject) => (
                    <option key={subject.subjectKey} value={subject.subjectKey}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => toggleViewerBlur(i)}
              disabled={i === 0}
              title={
                i === 0
                  ? "대표(1번) 이미지는 항상 공개입니다"
                  : a.viewerBlur
                    ? "타 유저 가림 해제 (누구나 선명하게)"
                    : "타 유저에게 블러 가림 (제작자는 선명)"
              }
              className={cn(
                "min-h-11 w-full border-t border-white/10 text-xs font-semibold transition",
                i === 0
                  ? "cursor-not-allowed bg-black/25 text-zinc-600"
                  : a.viewerBlur
                    ? "bg-amber-600/30 text-amber-100"
                    : "bg-black/40 text-zinc-500 hover:text-zinc-300",
              )}
            >
              {i === 0 ? "대표 · 공개" : `가리기${a.viewerBlur ? " ON" : ""}`}
            </button>
            <button
              type="button"
              onClick={() => onRemove(i)}
              title="에셋 삭제"
              className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/80 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-rose-600/90"
            >
              삭제
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
