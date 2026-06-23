"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { groupPossessionsByPerson } from "@/lib/relationshipMetaItems";

type RelationshipMeta = {
  honorifics: string[];
  items: string[];
  thoughts: string[];
  promises: { text: string; deadline?: string }[];
};

const EMPTY_META: RelationshipMeta = {
  honorifics: [],
  items: [],
  thoughts: [],
  promises: [],
};

type MetaCategory = "honorifics" | "items" | "thoughts" | "promises";

function metaTotal(meta: RelationshipMeta) {
  return meta.honorifics.length + meta.items.length + meta.thoughts.length + meta.promises.length;
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
  const stringGroups: { key: "honorifics" | "thoughts"; label: string }[] = [
    { key: "honorifics", label: "호칭" },
    { key: "thoughts", label: "캐릭터·NPC 속마음" },
  ];
  const total = metaTotal(meta);

  if (total === 0) {
    return <p className="text-[10px] text-zinc-600">아직 등록된 관계 메모가 없습니다.</p>;
  }

  return (
    <div className="space-y-2.5">
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
  const rootRef = useRef<HTMLDivElement>(null);

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
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (chatId == null) return;
    void loadMeta();
  }, [chatId, refreshKey, loadMeta]);

  useEffect(() => {
    setOpen(false);
    setMeta(EMPTY_META);
    setError("");
  }, [chatId]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (!open) return;
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

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
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingKey(null);
    }
  }

  if (chatId == null) return null;

  const countLabel =
    total > 0 ? `${total}개` : "비어 있음";

  return (
    <div ref={rootRef} className="relative inline-flex max-w-full items-start">
      <button
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
      {open && (
        <div
          role="dialog"
          aria-label="관계 메모"
          className="absolute bottom-full left-0 z-50 mb-1.5 w-max max-w-[min(calc(100vw-1.5rem),16rem)] rounded-lg border border-amber-500/25 bg-[#141210] shadow-xl"
        >
          <div className="flex items-center justify-end gap-2 border-b border-amber-500/15 px-2.5 py-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-md border border-amber-400/45 px-2 py-0.5 text-[10px] font-medium text-amber-100 transition hover:border-amber-300/70 hover:bg-amber-500/15 hover:text-white"
              aria-label="관계 메모 닫기"
            >
              닫기
            </button>
          </div>
          <div className="max-h-[min(15rem,42dvh)] overflow-y-auto p-2.5 scrollbar-hide">
            {loading && !error && total === 0 ? (
              <p className="text-[10px] text-zinc-500">불러오는 중…</p>
            ) : (
              <RelationshipMetaContent meta={meta} deletingKey={deletingKey} onDelete={deleteItem} />
            )}
            {error && <p className="mt-2 text-[10px] text-rose-400">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
