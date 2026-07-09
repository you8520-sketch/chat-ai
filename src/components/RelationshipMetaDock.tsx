"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { groupPossessionsByPerson } from "@/lib/relationshipMetaItems";

type RelationshipMeta = {
  honorifics: string[];
  items: string[];
  thoughts: string[];
  promises: { text: string; deadline?: string }[];
  currentLocation?: string;
};

const EMPTY_META: RelationshipMeta = {
  honorifics: [],
  items: [],
  thoughts: [],
  promises: [],
  currentLocation: undefined,
};

type MetaCategory = "items" | "thoughts" | "promises";

function metaTotal(meta: RelationshipMeta) {
  return meta.items.length + meta.thoughts.length + meta.promises.length + meta.honorifics.length;
}

function RelationshipMetaContent({
  meta,
  deletingKey,
  onDelete,
}: {
  meta: RelationshipMeta;
  deletingKey: string | null;
  onDelete: (category: MetaCategory, text: string) => void;
}) {
  const stringGroups: { key: "thoughts"; label: string }[] = [
    { key: "thoughts", label: "캐릭터·NPC 속마음" },
  ];
  const total = metaTotal(meta);

  if (total === 0) {
    return <p className="text-[10px] text-zinc-600">아직 등록된 관계 메모가 없습니다.</p>;
  }

  return (
    <div className="space-y-2.5">
      {meta.honorifics.length > 0 && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-zinc-400">유저 호칭 · 최신 2개</p>
          <ul className="flex flex-col gap-1">
            {meta.honorifics.slice(-2).map((item) => (
              <li key={`honorifics:${item}`} className="rounded-md border border-white/10 bg-[#1a1a1a] px-2 py-1 text-[10px] leading-snug text-zinc-300">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {stringGroups.map(({ key, label }) =>
        meta[key].length > 0 ? (
          <div key={key}>
            <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-zinc-400">{label}</p>
            <ul className="flex flex-col gap-1">
              {meta[key].map((item) => {
                const itemKey = `${key}:${item}`;
                return (
                  <li key={itemKey}>
                    <span className="flex w-full items-start gap-1 rounded-md border border-white/10 bg-[#1a1a1a] px-2 py-1 text-[10px] leading-snug text-zinc-300">
                      <span className="min-w-0 flex-1 break-words">{item}</span>
                      <button
                        type="button"
                        title="삭제"
                        disabled={deletingKey === itemKey}
                        onClick={() => onDelete(key, item)}
                        className="shrink-0 rounded px-0.5 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                        aria-label={`${item} 삭제`}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null
      )}
      {meta.items.length > 0 && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-zinc-400">소지품</p>
          <ul className="flex flex-col gap-1">
            {groupPossessionsByPerson(meta.items).map(({ person, items }) => (
              <li key={person}>
                <span className="flex w-full items-start gap-1 rounded-md border border-white/10 bg-[#1a1a1a] px-2 py-1 text-[10px] leading-snug text-zinc-300">
                  <span className="min-w-0 flex-1 break-words">
                    <span className="text-zinc-400">{person}:</span>{" "}
                    {items.map((item, idx) => {
                      const itemKey = `items:${item.rawEntry}`;
                      return (
                        <span key={`${person}-${item.name}-${idx}`}>
                          {idx > 0 ? ", " : ""}
                          {item.name}
                          <button
                            type="button"
                            title="삭제"
                            disabled={deletingKey === itemKey}
                            onClick={() => onDelete("items", item.rawEntry)}
                            className="ml-0.5 shrink-0 rounded px-0.5 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                            aria-label={`${item.name} 삭제`}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {meta.promises.length > 0 && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-zinc-400">약속</p>
          <ul className="flex flex-col gap-1">
            {meta.promises.map((promise) => {
              const label = promise.deadline
                ? `${promise.text} (기한: ${promise.deadline})`
                : promise.text;
              const itemKey = `promises:${promise.text}`;
              return (
                <li key={itemKey}>
                  <span className="flex w-full items-start gap-1 rounded-md border border-amber-500/20 bg-[#1a1a1a] px-2 py-1 text-[10px] leading-snug text-zinc-300">
                    <span className="min-w-0 flex-1 break-words">{label}</span>
                    <button
                      type="button"
                      title="삭제"
                      disabled={deletingKey === itemKey}
                      onClick={() => onDelete("promises", promise.text)}
                      className="shrink-0 rounded px-0.5 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                      aria-label={`${label} 삭제`}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

type PanelPos = {
  left: number;
  bottom: number;
  width: number;
  maxHeight: number;
};

export default function RelationshipMetaDock({
  chatId,
  refreshKey = 0,
}: {
  chatId: number | null;
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<RelationshipMeta>(EMPTY_META);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const total = metaTotal(meta);

  const loadMeta = useCallback(async () => {
    if (chatId == null) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/chat/memory?chatId=${chatId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "불러오기 실패");
      setMeta({
        honorifics: data.meta?.honorifics ?? [],
        items: data.meta?.items ?? [],
        thoughts: data.meta?.thoughts ?? [],
        promises: data.meta?.promises ?? [],
        currentLocation: data.meta?.currentLocation,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  const updatePanelPosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn || typeof window === "undefined") return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const width = Math.min(Math.max(rect.width, 16 * 16), window.innerWidth - margin * 2);
    const spaceAbove = Math.max(0, rect.top - margin - gap);
    const maxHeight = Math.min(Math.max(spaceAbove, 10 * 16), window.innerHeight * 0.55);
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - margin - width;
    }
    left = Math.max(margin, left);
    setPanelPos({
      left,
      bottom: window.innerHeight - rect.top + gap,
      width,
      maxHeight: Math.max(8 * 16, maxHeight),
    });
  }, []);

  useEffect(() => {
    if (chatId == null) return;
    void loadMeta();
  }, [chatId, refreshKey, loadMeta]);

  useEffect(() => {
    setOpen(false);
    setMeta(EMPTY_META);
    setError("");
    setPanelPos(null);
  }, [chatId]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    updatePanelPosition();
  }, [open, updatePanelPosition, meta, loading]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onReposition() {
      updatePanelPosition();
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePanelPosition]);

  async function deleteItem(category: MetaCategory, text: string) {
    if (chatId == null) return;
    const key = `${category}:${text}`;
    setDeletingKey(key);
    setError("");
    try {
      const res = await fetch("/api/chat/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          action: "deleteRelationshipMetaItem",
          category,
          text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "삭제에 실패했습니다.");
      setMeta({
        honorifics: data.meta?.honorifics ?? [],
        items: data.meta?.items ?? [],
        thoughts: data.meta?.thoughts ?? [],
        promises: data.meta?.promises ?? [],
        currentLocation: data.meta?.currentLocation,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingKey(null);
    }
  }

  if (chatId == null) return null;

  const countLabel = total > 0 ? `${total}개` : "비어 있음";

  const panel =
    open && panelPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="관계 메모"
            className="fixed z-[80] flex flex-col overflow-hidden rounded-lg border border-amber-500/25 bg-[#141210] shadow-xl"
            style={{
              left: panelPos.left,
              bottom: panelPos.bottom,
              width: panelPos.width,
              maxHeight: panelPos.maxHeight,
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/15 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-amber-100/90">관계 메모</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-md border border-amber-400/45 px-2 py-0.5 text-[10px] font-medium text-amber-100 transition hover:border-amber-300/70 hover:bg-amber-500/15 hover:text-white"
                aria-label="관계 메모 닫기"
              >
                닫기
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 [-webkit-overflow-scrolling:touch]">
              {loading && !error && total === 0 ? (
                <p className="text-[10px] text-zinc-500">불러오는 중…</p>
              ) : (
                <RelationshipMetaContent meta={meta} deletingKey={deletingKey} onDelete={deleteItem} />
              )}
              {error && <p className="mt-2 text-[10px] text-rose-400">{error}</p>}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className="relative inline-flex max-w-full items-start">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-left text-[11px] transition ${
          open
            ? "border-amber-500/40 bg-amber-950/20 text-amber-100"
            : "border-amber-500/20 bg-amber-950/10 text-amber-200/90 hover:border-amber-500/35 hover:bg-amber-950/15"
        }`}
        aria-expanded={open}
      >
        <span className="font-semibold">관계 메모</span>
        <span className={`text-[10px] ${total > 0 ? "text-zinc-500" : "text-zinc-600"}`}>{countLabel}</span>
        <span className="text-[10px] text-zinc-500">{open ? "▴" : "▾"}</span>
      </button>
      {panel}
    </div>
  );
}
