"use client";

import { useEffect, useId, useState } from "react";
import type { ChatShortcutInsertResult } from "@/lib/chatShortcutComposer";
import {
  CHAT_SHORTCUT_CONTENT_MAX,
  CHAT_SHORTCUT_DESCRIPTION_MAX,
  CHAT_SHORTCUT_NAME_MAX,
} from "@/lib/chatShortcutComposer";

type ShortcutItem = {
  id: number;
  name: string;
  description: string;
  content: string;
  favorite: boolean;
  updatedAt?: string;
};

type Draft = { name: string; description: string; content: string };

const emptyDraft = (): Draft => ({ name: "", description: "", content: "" });

export function ChatShortcutsDock({
  insertDisabled,
  onInsert,
  onCloseFocus,
}: {
  insertDisabled: boolean;
  onInsert: (content: string) => ChatShortcutInsertResult;
  onCloseFocus: () => void;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ShortcutItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/chat/shortcuts");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { shortcuts?: ShortcutItem[] };
      if (!cancelled) setItems(data.shortcuts ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function closePanel() {
    setOpen(false);
    setFormOpen(false);
    setNotice("");
    onCloseFocus();
  }

  async function saveDraft() {
    setBusy(true);
    setNotice("");
    const payload = {
      name: draft.name,
      description: draft.description,
      content: draft.content,
    };
    const res = await fetch(
      editingId == null ? "/api/chat/shortcuts" : `/api/chat/shortcuts/${editingId}`,
      {
        method: editingId == null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      shortcut?: ShortcutItem;
    };
    setBusy(false);
    if (!res.ok || !data.shortcut) {
      setNotice(data.error || "단축어를 저장하지 못했습니다.");
      return;
    }
    setItems((prev) => {
      const without = prev.filter((item) => item.id !== data.shortcut!.id);
      return [data.shortcut!, ...without].sort(sortShortcuts);
    });
    setSelectedId(data.shortcut.id);
    setEditingId(null);
    setFormOpen(false);
    setDraft(emptyDraft());
  }

  async function toggleFavorite(item: ShortcutItem) {
    setBusy(true);
    setNotice("");
    const res = await fetch(`/api/chat/shortcuts/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !item.favorite }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      shortcut?: ShortcutItem;
    };
    setBusy(false);
    if (!res.ok || !data.shortcut) {
      setNotice(data.error || "즐겨찾기를 바꾸지 못했습니다.");
      return;
    }
    setItems((prev) =>
      prev.map((row) => (row.id === data.shortcut!.id ? data.shortcut! : row)).sort(sortShortcuts)
    );
  }

  async function remove(item: ShortcutItem) {
    setBusy(true);
    setNotice("");
    const res = await fetch(`/api/chat/shortcuts/${item.id}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error || "단축어를 삭제하지 못했습니다.");
      return;
    }
    setItems((prev) => prev.filter((row) => row.id !== item.id));
    if (selectedId === item.id) setSelectedId(null);
    setConfirmDeleteId(null);
  }

  function insertSelected() {
    if (!selected) return;
    const result = onInsert(selected.content);
    if (result.action === "defer") {
      setNotice(result.message);
      return;
    }
    if (result.action === "reject") {
      setNotice(result.message);
      return;
    }
    setNotice("");
    setOpen(false);
    onCloseFocus();
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="chat-shortcuts-open"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`-my-1.5 h-8 shrink-0 rounded-md border px-2 text-[11px] font-semibold transition min-[576px]:my-0 min-[576px]:h-auto min-[576px]:px-1.5 min-[576px]:py-0.5 ${
          open
            ? "border-violet-400/50 bg-violet-500/15 text-violet-200"
            : "border-white/10 bg-[#1a1a1a] text-zinc-300 hover:border-white/20 hover:text-white"
        }`}
      >
        단축어
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="개인 단축어"
          data-testid="chat-shortcuts-panel"
          className="absolute bottom-full left-0 z-30 mb-1 flex max-h-[min(18rem,42dvh)] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-white/15 bg-[#161616] shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
            <p className="text-[11px] font-semibold text-zinc-200">개인 단축어</p>
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] text-violet-200 hover:bg-white/5"
                onClick={() => {
                  setFormOpen(true);
                  setEditingId(null);
                  setDraft(emptyDraft());
                  setNotice("");
                }}
              >
                새로 만들기
              </button>
              <button
                type="button"
                data-testid="chat-shortcuts-close"
                className="rounded-md px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
                onClick={closePanel}
              >
                닫기
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {items.length === 0 ? (
              <p className="text-[11px] text-zinc-400">저장한 단축어가 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.id} className="rounded-md border border-white/10 bg-black/20">
                    <div className="flex items-start gap-1 px-1.5 py-1">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setSelectedId(item.id);
                          setNotice("");
                          setConfirmDeleteId(null);
                        }}
                      >
                        <span className="block truncate text-[12px] font-semibold text-zinc-100">
                          {item.favorite ? "★ " : ""}
                          {item.name}
                        </span>
                        {item.description ? (
                          <span className="block truncate text-[10px] text-zinc-400">{item.description}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        aria-pressed={item.favorite}
                        aria-label={item.favorite ? `${item.name} 즐겨찾기 해제` : `${item.name} 즐겨찾기`}
                        disabled={busy}
                        className="shrink-0 rounded px-1.5 py-1 text-[11px] text-amber-200 hover:bg-white/5 disabled:opacity-40"
                        onClick={() => void toggleFavorite(item)}
                      >
                        {item.favorite ? "★" : "☆"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {selected ? (
              <div className="mt-2 rounded-md border border-violet-500/30 bg-violet-500/5 p-2" data-testid="chat-shortcuts-preview">
                <p className="text-[11px] font-semibold text-violet-100">{selected.name}</p>
                <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-zinc-100">
                  {selected.content}
                </pre>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    data-testid="chat-shortcuts-insert"
                    disabled={insertDisabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={insertSelected}
                    className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                  >
                    입력창에 넣기
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-zinc-200"
                    onClick={() => {
                      setFormOpen(true);
                      setEditingId(selected.id);
                      setDraft({
                        name: selected.name,
                        description: selected.description,
                        content: selected.content,
                      });
                    }}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-rose-400/30 px-2 py-1 text-[11px] text-rose-200"
                    onClick={() => setConfirmDeleteId(selected.id)}
                  >
                    삭제
                  </button>
                </div>
                {confirmDeleteId === selected.id ? (
                  <button
                    type="button"
                    data-testid="chat-shortcuts-delete-confirm"
                    disabled={busy}
                    className="mt-2 text-[11px] text-rose-300 underline"
                    onClick={() => void remove(selected)}
                  >
                    이 단축어를 삭제합니다
                  </button>
                ) : null}
              </div>
            ) : null}
            {formOpen ? (
              <form
                className="mt-2 space-y-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDraft();
                }}
              >
                <input
                  data-testid="chat-shortcuts-name"
                  value={draft.name}
                  maxLength={CHAT_SHORTCUT_NAME_MAX}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="이름"
                  className="w-full rounded-md border border-white/15 bg-[#1a1a1a] px-2 py-1 text-[12px] text-zinc-100"
                />
                <input
                  data-testid="chat-shortcuts-description"
                  value={draft.description}
                  maxLength={CHAT_SHORTCUT_DESCRIPTION_MAX}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, description: event.target.value.replace(/[\r\n]/g, "") }))
                  }
                  placeholder="한 줄 설명 (선택)"
                  className="w-full rounded-md border border-white/15 bg-[#1a1a1a] px-2 py-1 text-[12px] text-zinc-100"
                />
                <textarea
                  data-testid="chat-shortcuts-content"
                  value={draft.content}
                  maxLength={CHAT_SHORTCUT_CONTENT_MAX}
                  onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
                  placeholder="내용"
                  rows={3}
                  className="w-full resize-none rounded-md border border-white/15 bg-[#1a1a1a] px-2 py-1 text-[12px] text-zinc-100"
                />
                <button
                  type="submit"
                  data-testid="chat-shortcuts-save"
                  disabled={busy}
                  className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  저장
                </button>
              </form>
            ) : null}
            {notice ? (
              <p role="status" data-testid="chat-shortcuts-notice" className="mt-2 text-[11px] text-amber-200">
                {notice}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sortShortcuts(a: ShortcutItem, b: ShortcutItem): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  const byTime = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  if (byTime !== 0) return byTime;
  return b.id - a.id;
}
