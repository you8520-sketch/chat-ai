"use client";

import { useEffect, useRef, useState } from "react";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import type { CharacterAsset } from "@/lib/characterAssets";

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

  function togglePublic(index: number) {
    const item = assets[index];
    if (!item) return;
    const isPublic = item.public !== false;
    if (isPublic && assets.filter((a) => a.public !== false).length <= 1) return;
    onChange(assets.map((a, i) => (i === index ? { ...a, public: !isPublic } : a)));
  }

  function toggleChat(index: number) {
    onChange(assets.map((a, i) => (i === index ? { ...a, chat: a.chat === false } : a)));
  }

  function toggleViewerBlur(index: number) {
    onChange(
      assets.map((a, i) => (i === index ? { ...a, viewerBlur: !a.viewerBlur } : a))
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
    onChange(
      assets.map((a, i) => (i === index ? { ...a, tag: trimmed } : a))
    );
  }

  const publicCount = assets.filter((a) => a.public !== false).length;
  const hiddenCount = assets.filter((a) => a.viewerBlur === true).length;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        <span className="text-orange-300/90">태그 클릭</span>하여 수정 · 드래그로 순서 변경 ·{" "}
        <span className="text-emerald-400/90">노출</span>은 소개·카드용(1장 이상) ·{" "}
        <span className="text-violet-400/90">대화</span>는 감정 태그 전환용 ·{" "}
        <span className="text-amber-300/90">가리기</span>는 타 유저 블러
        {publicCount > 0 && (
          <span className="ml-2 text-emerald-400/70">노출 {publicCount}장</span>
        )}
        {hiddenCount > 0 && (
          <span className="ml-2 text-amber-400/70">가림 {hiddenCount}장</span>
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
            className={`group relative cursor-grab overflow-hidden rounded-xl border bg-[#0e1120] active:cursor-grabbing ${
              dragIndex === i ? "border-violet-500/60 opacity-60" : "border-white/10"
            }`}
          >
            <CharacterAssetImage
              src={a.url}
              showHiddenBadge={a.viewerBlur === true}
            />
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300">
              {i + 1}
            </span>
            <div
              className="border-t border-white/10 bg-black/35 px-2 py-1.5"
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
                  className="w-full rounded bg-black/50 px-1 py-0.5 text-center text-[10px] font-bold text-orange-200 outline-none ring-1 ring-orange-400/60"
                  aria-label="감정 태그 수정"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startTagEdit(i)}
                  title="클릭하여 태그 수정"
                  className="w-full truncate rounded bg-orange-500/10 px-1 py-1 text-center text-[11px] font-bold text-orange-200 ring-1 ring-orange-400/20 hover:bg-orange-500/15"
                >
                  {a.tag || "태그 입력"}
                </button>
              )}
            </div>
            <div className="flex border-t border-white/10">
              <button
                type="button"
                onClick={() => togglePublic(i)}
                title={a.public !== false ? "노출 해제 (최소 1장 유지)" : "소개·카드에 노출"}
                className={`flex-1 py-1.5 text-[10px] font-bold transition ${
                  a.public !== false
                    ? "bg-emerald-500/25 text-emerald-300"
                    : "bg-black/40 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                노출{a.public !== false ? " ON" : ""}
              </button>
              <button
                type="button"
                onClick={() => toggleChat(i)}
                title={a.chat !== false ? "대화 전환 해제" : "대화 중 감정 전환 허용"}
                className={`flex-1 border-l border-white/10 py-1.5 text-[10px] font-bold transition ${
                  a.chat !== false
                    ? "bg-violet-500/25 text-violet-300"
                    : "bg-black/40 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                대화{a.chat !== false ? " ON" : ""}
              </button>
            </div>
            <button
              type="button"
              onClick={() => toggleViewerBlur(i)}
              title={
                a.viewerBlur
                  ? "타 유저 가림 해제 (누구나 선명하게)"
                  : "타 유저에게 블러 가림 (제작자는 선명)"
              }
              className={`w-full border-t border-white/10 py-1.5 text-[10px] font-bold transition ${
                a.viewerBlur
                  ? "bg-amber-500/25 text-amber-200"
                  : "bg-black/40 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              가리기{a.viewerBlur ? " ON" : ""}
            </button>
            <button
              type="button"
              onClick={() => onRemove(i)}
              title="에셋 삭제"
              className="absolute right-1 top-1 flex min-h-6 items-center justify-center rounded-full bg-black/80 px-2 text-[10px] font-bold text-white ring-1 ring-white/15 hover:bg-rose-600/90"
            >
              삭제
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
