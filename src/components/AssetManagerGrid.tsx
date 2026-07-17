"use client";

import { useEffect, useRef, useState } from "react";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import type { CharacterAsset } from "@/lib/characterAssets";
import { cn, studioType } from "@/lib/studioDesign";

export type ManagedAsset = CharacterAsset;

const TAG_MAX_LEN = 30;

type Props = {
  assets: ManagedAsset[];
  onChange: (assets: ManagedAsset[]) => void;
  onRemove: (index: number) => void;
};

export default function AssetManagerGrid({ assets, onChange, onRemove }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftTag, setDraftTag] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIndex === null) return;
    tagInputRef.current?.focus();
    tagInputRef.current?.select();
  }, [editingIndex]);

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= assets.length || to >= assets.length) return;
    const next = [...assets];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  function toggleViewerBlur(index: number) {
    onChange(
      assets.map((a, i) => (i === index ? { ...a, viewerBlur: !a.viewerBlur } : a)),
    );
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
    onChange(assets.map((a, i) => (i === index ? { ...a, tag: trimmed } : a)));
  }

  const hiddenCount = assets.filter((a) => a.viewerBlur === true).length;

  return (
    <div className="space-y-3">
      <p className={studioType.helper}>
        <span className="text-zinc-200">태그 클릭</span>하여 수정 · 드래그로 순서 변경 ·{" "}
        <span className="text-zinc-200">1번</span>이 카드 대표 이미지 ·{" "}
        <span className="text-zinc-200">가리기</span>는 타 유저 블러(소개·갤러리)
        {hiddenCount > 0 && (
          <span className="ml-2 text-zinc-300">가림 {hiddenCount}장</span>
        )}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {assets.map((a, i) => (
          <div
            key={`${a.url}-${i}`}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) reorder(dragIndex, i);
              setDragIndex(null);
            }}
            className={cn(
              "group relative cursor-grab overflow-hidden rounded-xl border bg-[#161922] active:cursor-grabbing",
              dragIndex === i ? "border-violet-500/60 opacity-60" : "border-white/10",
            )}
          >
            <CharacterAssetImage src={a.url} showHiddenBadge={a.viewerBlur === true} />
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
            <button
              type="button"
              onClick={() => toggleViewerBlur(i)}
              title={
                a.viewerBlur
                  ? "타 유저 가림 해제 (누구나 선명하게)"
                  : "타 유저에게 블러 가림 (제작자는 선명)"
              }
              className={cn(
                "min-h-11 w-full border-t border-white/10 text-xs font-semibold transition",
                a.viewerBlur
                  ? "bg-amber-600/30 text-amber-100"
                  : "bg-black/40 text-zinc-500 hover:text-zinc-300",
              )}
            >
              가리기{a.viewerBlur ? " ON" : ""}
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
        ))}
      </div>
    </div>
  );
}
