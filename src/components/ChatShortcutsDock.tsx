"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ChatShortcutInsertResult } from "@/lib/chatShortcutComposer";
import {
  CHAT_SHORTCUT_CONTENT_MAX,
  CHAT_SHORTCUT_DESCRIPTION_MAX,
  CHAT_SHORTCUT_NAME_MAX,
} from "@/lib/chatShortcutComposer";
import { compareShortcutRows, mergeShortcutList } from "@/lib/chatShortcutListSync";

type ShortcutItem = {
  id: number;
  name: string;
  description: string;
  content: string;
  favorite: boolean;
  updatedAt?: string;
};

type Draft = { name: string; description: string; content: string };
type ListPhase = "idle" | "loading" | "ready" | "error";

const emptyDraft = (): Draft => ({ name: "", description: "", content: "" });

const SAVE_FAILURE = "저장하지 못했습니다. 다시 저장해 주세요.";
const FAVORITE_FAILURE = "즐겨찾기를 바꾸지 못했습니다. 다시 시도해 주세요.";
const DELETE_FAILURE = "단축어를 삭제하지 못했습니다. 다시 시도해 주세요.";
const LIST_FAILURE = "단축어 목록을 불러오지 못했습니다.";

const DEFAULT_PLACEMENT = { lift: 4, maxHeight: "min(30rem, calc(100dvh - 18rem))" };
const PANEL_MAX_PX = 480;
const PANEL_MIN_PX = 224;
const PANEL_TOP_RESERVE_PX = 72;

export function ChatShortcutsDock({
  insertDisabled,
  onInsert,
  onCloseFocus,
  composerRef,
}: {
  insertDisabled: boolean;
  onInsert: (content: string) => ChatShortcutInsertResult;
  onCloseFocus: () => void;
  composerRef?: RefObject<HTMLElement | null>;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ShortcutItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [listPhase, setListPhase] = useState<ListPhase>("idle");
  const [listError, setListError] = useState("");

  const busyRef = useRef(false);
  const listFlightRef = useRef(false);
  const listSeqRef = useRef(0);
  const listOnceRef = useRef(false);
  const writesRef = useRef(new Map<number, ShortcutItem>());
  const deletesRef = useRef(new Set<number>());
  const draftSessionRef = useRef(0);
  const draftVersionRef = useRef(0);
  const loadListRef = useRef<() => Promise<void>>(async () => {});

  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function loadList() {
    if (listFlightRef.current) return;
    listFlightRef.current = true;
    const seq = ++listSeqRef.current;
    setListPhase("loading");
    setListError("");
    try {
      const res = await fetch("/api/chat/shortcuts");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || LIST_FAILURE);
      }
      const data = (await res.json()) as { shortcuts?: ShortcutItem[] };
      if (seq !== listSeqRef.current) return;
      const server = Array.isArray(data.shortcuts) ? data.shortcuts : [];
      const writes = new Map(writesRef.current);
      const deletes = new Set(deletesRef.current);
      setItems(mergeShortcutList(server, writes, deletes).sort(compareShortcutRows));
      for (const [id, row] of writes) {
        if (writesRef.current.get(id) === row) writesRef.current.delete(id);
      }
      for (const id of deletes) deletesRef.current.delete(id);
      setListPhase("ready");
    } catch (error) {
      if (seq !== listSeqRef.current) return;
      setListPhase("error");
      setListError(error instanceof Error && /[가-힣]/.test(error.message) ? error.message : LIST_FAILURE);
    } finally {
      listFlightRef.current = false;
    }
  }

  loadListRef.current = loadList;

  useEffect(() => {
    if (!open || listOnceRef.current) return;
    listOnceRef.current = true;
    void loadListRef.current();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const root = rootRef.current;
      const composer = composerRef?.current;
      if (!root || !composer) {
        setPlacement(DEFAULT_PLACEMENT);
        return;
      }
      const composerTop = composer.getBoundingClientRect().top;
      const dockTop = root.getBoundingClientRect().top;
      const lift = Math.max(0, Math.round(dockTop - composerTop)) + 4;
      const available = Math.round(composerTop - PANEL_TOP_RESERVE_PX);
      const maxHeight = `${Math.max(PANEL_MIN_PX, Math.min(PANEL_MAX_PX, available))}px`;
      setPlacement((prev) =>
        prev.lift === lift && prev.maxHeight === maxHeight ? prev : { lift, maxHeight }
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [open, composerRef]);

  function closePanel() {
    setOpen(false);
    onCloseFocus();
  }

  function beginDraft(next: Draft, editing: number | null) {
    draftSessionRef.current += 1;
    draftVersionRef.current += 1;
    setFormOpen(true);
    setEditingId(editing);
    setDraft(next);
    setNotice("");
  }

  function cancelDraft() {
    draftSessionRef.current += 1;
    draftVersionRef.current += 1;
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setNotice("");
  }

  function editDraft(key: keyof Draft, value: string) {
    if (draft[key] === value) return;
    draftVersionRef.current += 1;
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function rememberWrite(shortcut: ShortcutItem) {
    writesRef.current.set(shortcut.id, shortcut);
    deletesRef.current.delete(shortcut.id);
    setItems((prev) => {
      const without = prev.filter((item) => item.id !== shortcut.id);
      return [shortcut, ...without].sort(compareShortcutRows);
    });
  }

  async function saveDraft() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    const savedSession = draftSessionRef.current;
    const savedVersion = draftVersionRef.current;
    const payload = {
      name: draft.name,
      description: draft.description,
      content: draft.content,
    };
    const targetId = editingId;
    try {
      const res = await fetch(targetId == null ? "/api/chat/shortcuts" : `/api/chat/shortcuts/${targetId}`, {
        method: targetId == null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; shortcut?: ShortcutItem };
      if (!res.ok || !data.shortcut) throw new Error(data.error || SAVE_FAILURE);
      rememberWrite(data.shortcut);
      if (
        draftSessionRef.current === savedSession &&
        draftVersionRef.current === savedVersion
      ) {
        setSelectedId(data.shortcut.id);
        setEditingId(null);
        setFormOpen(false);
        setDraft(emptyDraft());
        setNotice("");
      }
    } catch (error) {
      if (draftSessionRef.current === savedSession) {
        const message = error instanceof Error && error.message ? error.message : SAVE_FAILURE;
        setNotice(message.includes("다시") ? message : SAVE_FAILURE);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function toggleFavorite(item: ShortcutItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch(`/api/chat/shortcuts/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !item.favorite }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; shortcut?: ShortcutItem };
      if (!res.ok || !data.shortcut) throw new Error(data.error || FAVORITE_FAILURE);
      rememberWrite(data.shortcut);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : FAVORITE_FAILURE;
      setNotice(message.includes("다시") ? message : FAVORITE_FAILURE);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove(item: ShortcutItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch(`/api/chat/shortcuts/${item.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || DELETE_FAILURE);
      deletesRef.current.add(item.id);
      writesRef.current.delete(item.id);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      if (selectedId === item.id) setSelectedId(null);
      setConfirmDeleteId(null);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : DELETE_FAILURE;
      setNotice(message.includes("다시") ? message : DELETE_FAILURE);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function insertSelected() {
    if (!selected || busyRef.current) return;
    const result = onInsert(selected.content);
    if (result.action === "defer") return;
    if (result.action === "reject") {
      setNotice(result.message);
      return;
    }
    setNotice("");
    setOpen(false);
    onCloseFocus();
  }

  const hasDetail = selected != null || formOpen;
  const nameCount = draft.name.length;
  const descriptionCount = draft.description.length;
  const contentCount = draft.content.length;
  const noticeIsFailure = notice !== "" && notice.includes("다시");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="chat-shortcuts-open"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`-my-2 h-9 shrink-0 rounded-md border px-3 text-xs font-semibold transition min-[576px]:my-0 min-[576px]:h-7 min-[576px]:px-2.5 ${
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
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            closePanel();
          }}
          style={{ bottom: `calc(100% + ${placement.lift}px)`, maxHeight: placement.maxHeight }}
          className="absolute left-0 z-30 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#161616] shadow-2xl shadow-black/60"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <p className="min-w-0 truncate text-[13px] font-bold text-zinc-100">
              개인 단축어
              {listPhase === "ready" && items.length > 0 ? (
                <span className="ml-1.5 text-xs font-medium text-zinc-400">{items.length}개</span>
              ) : null}
            </p>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                className="min-h-9 rounded-md border border-violet-400/40 bg-violet-500/10 px-3 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20 min-[576px]:min-h-8"
                onClick={() => beginDraft(emptyDraft(), null)}
              >
                새로 만들기
              </button>
              <button
                type="button"
                data-testid="chat-shortcuts-close"
                className="min-h-9 min-w-10 rounded-md px-3 text-xs font-medium text-zinc-300 transition hover:bg-white/5 hover:text-white min-[576px]:min-h-8"
                onClick={closePanel}
              >
                닫기
              </button>
            </div>
          </div>
          <div
            className={`overflow-y-auto overscroll-contain px-2.5 py-2 ${
              !hasDetail
                ? "min-h-0 flex-1"
                : formOpen
                  ? "max-h-[5.5rem] min-h-[3.5rem] shrink"
                  : "max-h-[9.5rem] min-h-[4.5rem] shrink"
            }`}
          >
            {listPhase === "loading" && items.length === 0 ? (
              <div role="status" className="space-y-1.5">
                <p className="text-xs text-zinc-300">단축어를 불러오는 중…</p>
                <div aria-hidden className="space-y-1.5">
                  {[0, 1, 2].map((row) => (
                    <div key={row} className="h-11 rounded-lg bg-white/5 motion-safe:animate-pulse" />
                  ))}
                </div>
              </div>
            ) : null}
            {listPhase === "error" ? (
              <div
                data-testid="chat-shortcuts-list-error"
                className="flex flex-col gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100"
              >
                <p>{listError || LIST_FAILURE}</p>
                <button
                  type="button"
                  data-testid="chat-shortcuts-list-retry"
                  className="min-h-9 self-start rounded-md border border-amber-300/40 px-3 font-semibold text-amber-50 transition hover:bg-amber-400/10"
                  onClick={() => void loadList()}
                >
                  다시 불러오기
                </button>
              </div>
            ) : null}
            {listPhase === "ready" && items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 px-3 py-4 text-center">
                <p className="text-[13px] font-semibold text-zinc-200">저장한 단축어가 없습니다.</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  자주 쓰는 문장을 저장해 두면 입력창에 바로 넣을 수 있어요.
                </p>
              </div>
            ) : null}
            {items.length > 0 ? (
              <ul className="space-y-1.5">
                {items.map((item) => {
                  const isSelected = item.id === selectedId;
                  return (
                    <li
                      key={item.id}
                      className={`flex items-stretch rounded-lg border transition ${
                        isSelected
                          ? "border-violet-400/60 bg-violet-500/10"
                          : "border-white/10 bg-black/20 hover:border-white/20"
                      }`}
                    >
                      <button
                        type="button"
                        aria-current={isSelected ? "true" : undefined}
                        className="min-h-11 min-w-0 flex-1 rounded-l-lg px-3 py-1.5 text-left"
                        onClick={() => {
                          setSelectedId(item.id);
                          setNotice("");
                          setConfirmDeleteId(null);
                        }}
                      >
                        <span className="block truncate text-[13px] font-semibold text-zinc-100">
                          {item.favorite ? "★ " : ""}
                          {item.name}
                        </span>
                        {item.description ? (
                          <span className="block truncate text-xs text-zinc-400">{item.description}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        aria-pressed={item.favorite}
                        aria-label={item.favorite ? `${item.name} 즐겨찾기 해제` : `${item.name} 즐겨찾기`}
                        disabled={busy}
                        className="w-11 shrink-0 rounded-r-lg text-base text-amber-200 transition hover:bg-white/5 disabled:opacity-40"
                        onClick={() => void toggleFavorite(item)}
                      >
                        {item.favorite ? "★" : "☆"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          {hasDetail ? (
            <div className="min-h-0 shrink overflow-y-auto overscroll-contain border-t border-white/10 bg-[#121212] px-2.5 pt-2">
              {selected && formOpen ? (
                <div
                  data-testid="chat-shortcuts-preview"
                  className="flex items-baseline justify-between gap-2 rounded-lg border border-violet-400/30 bg-violet-500/5 px-3 py-2"
                >
                  <p className="min-w-0 truncate text-xs text-zinc-300">
                    선택한 단축어 · <span className="font-semibold text-violet-100">{selected.name}</span>
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                    {selected.content.length.toLocaleString()}자
                  </span>
                </div>
              ) : null}
              {selected && !formOpen ? (
                <div
                  className="rounded-lg border border-violet-400/30 bg-violet-500/5"
                  data-testid="chat-shortcuts-preview"
                >
                  <div className="px-3 pt-2.5">
                    <p className="text-xs font-medium text-zinc-400">선택한 단축어</p>
                    <p className="mt-0.5 flex items-baseline justify-between gap-2 text-sm font-bold text-violet-100">
                      <span className="min-w-0 break-words">{selected.name}</span>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-zinc-400">
                        {selected.content.length.toLocaleString()}자
                      </span>
                    </p>
                    <pre className="mt-1.5 max-h-[min(8rem,16dvh)] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-black/30 px-2.5 py-2 font-sans text-[13px] leading-relaxed text-zinc-100">
                      {selected.content}
                    </pre>
                  </div>
                  <div className="sticky bottom-0 z-10 mt-2 rounded-b-lg bg-[#171321] px-3 pb-2.5 pt-1">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        data-testid="chat-shortcuts-insert"
                        disabled={insertDisabled || busy}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={insertSelected}
                        className="min-h-10 min-w-[8rem] flex-1 rounded-md bg-violet-600 px-3 text-xs font-bold text-white transition hover:bg-violet-500 disabled:opacity-40 min-[576px]:min-h-9"
                      >
                        입력창에 넣기
                      </button>
                      <button
                        type="button"
                        className="min-h-10 min-w-[3.25rem] rounded-md border border-white/20 px-3 text-xs font-semibold text-zinc-100 transition hover:bg-white/5 min-[576px]:min-h-9"
                        onClick={() =>
                          beginDraft(
                            {
                              name: selected.name,
                              description: selected.description,
                              content: selected.content,
                            },
                            selected.id
                          )
                        }
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="min-h-10 min-w-[3.25rem] rounded-md border border-rose-400/40 px-3 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/10 min-[576px]:min-h-9"
                        onClick={() => setConfirmDeleteId(selected.id)}
                      >
                        삭제
                      </button>
                    </div>
                    {confirmDeleteId === selected.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-500/10 p-2">
                        <button
                          type="button"
                          data-testid="chat-shortcuts-delete-confirm"
                          disabled={busy}
                          className="min-h-10 flex-1 rounded-md bg-rose-600 px-3 text-xs font-bold text-white transition hover:bg-rose-500 disabled:opacity-40 min-[576px]:min-h-9"
                          onClick={() => void remove(selected)}
                        >
                          이 단축어를 삭제합니다
                        </button>
                        <button
                          type="button"
                          className="min-h-10 rounded-md px-3 text-xs font-medium text-zinc-200 hover:bg-white/5 min-[576px]:min-h-9"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          취소
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {formOpen ? (
                <form
                  className="mt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveDraft();
                  }}
                >
                  <p className="text-[13px] font-bold text-zinc-100">
                    {editingId == null ? "새 단축어" : "단축어 수정"}
                  </p>
                  <div className="mt-1.5 space-y-2">
                    <label className="block">
                      <span className="flex items-baseline justify-between text-xs font-medium text-zinc-300">
                        이름
                        <span className="tabular-nums text-zinc-400">
                          {nameCount} / {CHAT_SHORTCUT_NAME_MAX}
                        </span>
                      </span>
                      <input
                        data-testid="chat-shortcuts-name"
                        value={draft.name}
                        maxLength={CHAT_SHORTCUT_NAME_MAX}
                        onChange={(event) => editDraft("name", event.target.value)}
                        placeholder="예: 인사"
                        className="mt-1 min-h-10 w-full rounded-md border border-white/20 bg-[#1a1a1a] px-2.5 py-1.5 text-base text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/60 focus:ring-1 focus:ring-violet-500/35 min-[576px]:text-[13px]"
                      />
                    </label>
                    <label className="block">
                      <span className="flex items-baseline justify-between text-xs font-medium text-zinc-300">
                        한 줄 설명 (선택)
                        <span className="tabular-nums text-zinc-400">
                          {descriptionCount} / {CHAT_SHORTCUT_DESCRIPTION_MAX}
                        </span>
                      </span>
                      <input
                        data-testid="chat-shortcuts-description"
                        value={draft.description}
                        maxLength={CHAT_SHORTCUT_DESCRIPTION_MAX}
                        onChange={(event) =>
                          editDraft("description", event.target.value.replace(/[\r\n]/g, ""))
                        }
                        placeholder="목록에 함께 보입니다"
                        className="mt-1 min-h-10 w-full rounded-md border border-white/20 bg-[#1a1a1a] px-2.5 py-1.5 text-base text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/60 focus:ring-1 focus:ring-violet-500/35 min-[576px]:text-[13px]"
                      />
                    </label>
                    <label className="block">
                      <span className="flex items-baseline justify-between text-xs font-medium text-zinc-300">
                        내용
                        <span
                          className={`tabular-nums ${
                            contentCount >= CHAT_SHORTCUT_CONTENT_MAX ? "text-rose-300" : "text-zinc-400"
                          }`}
                        >
                          {contentCount.toLocaleString()} / {CHAT_SHORTCUT_CONTENT_MAX.toLocaleString()}
                        </span>
                      </span>
                      <textarea
                        data-testid="chat-shortcuts-content"
                        value={draft.content}
                        maxLength={CHAT_SHORTCUT_CONTENT_MAX}
                        onChange={(event) => editDraft("content", event.target.value)}
                        placeholder="입력창에 넣을 문장"
                        rows={3}
                        className="mt-1 min-h-[5rem] w-full resize-none rounded-md border border-white/20 bg-[#1a1a1a] px-2.5 py-1.5 text-base leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/60 focus:ring-1 focus:ring-violet-500/35 min-[576px]:text-[13px]"
                      />
                    </label>
                  </div>
                  <div className="sticky bottom-0 z-10 -mx-2.5 mt-2 border-t border-white/10 bg-[#121212] px-2.5 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-testid="chat-shortcuts-cancel"
                        onClick={cancelDraft}
                        className="min-h-10 shrink-0 rounded-md border border-white/20 px-4 text-xs font-semibold text-zinc-100 transition hover:bg-white/5 min-[576px]:min-h-9"
                      >
                        취소
                      </button>
                      <button
                        type="submit"
                        data-testid="chat-shortcuts-save"
                        disabled={busy}
                        className="min-h-10 min-w-0 flex-1 rounded-md bg-violet-600 px-3 text-xs font-bold text-white transition hover:bg-violet-500 disabled:opacity-40 min-[576px]:min-h-9"
                      >
                        {busy ? "저장 중…" : "저장"}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="h-2" aria-hidden />
              )}
            </div>
          ) : null}
          {notice ? (
            <p
              role="status"
              data-testid="chat-shortcuts-notice"
              className={`shrink-0 border-t px-3 py-2 text-xs leading-relaxed ${
                noticeIsFailure
                  ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
                  : "border-white/10 bg-white/5 text-zinc-200"
              }`}
            >
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
