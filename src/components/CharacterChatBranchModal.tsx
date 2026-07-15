"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  formatChatListTime,
  formatChatPreview,
  formatChatSessionStats,
  getBranchDisplayTitle,
  type UserChatSession,
} from "@/lib/recentChats";
import { chatEntryHref, characterPageHref } from "@/lib/chatLinks";

type Props = {
  open: boolean;
  onClose: () => void;
  characterId: number;
  characterName: string;
  branches: UserChatSession[];
  blurNsfw: boolean;
  nsfw: boolean;
  onDeleteRequest?: (session: UserChatSession) => void;
  onRenameSuccess?: (session: UserChatSession) => void;
  deletingId?: number | null;
};

export default function CharacterChatBranchModal({
  open,
  onClose,
  characterId,
  characterName,
  branches,
  blurNsfw,
  nsfw,
  onDeleteRequest,
  onRenameSuccess,
  deletingId = null,
}: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [renameError, setRenameError] = useState("");
  if (!open) return null;

  const hidden = nsfw && blurNsfw;
  const multi = branches.length > 1;
  const latest = branches[0];

  function enter(chatId?: number, fresh = false) {
    onClose();
    if (hidden) {
      router.push("/verify");
      return;
    }
    router.push(chatEntryHref(characterId, { chatId, fresh }));
  }

  function startRename(session: UserChatSession) {
    setEditingId(session.chat_id);
    setEditingTitle(getBranchDisplayTitle(session));
    setRenameError("");
  }

  async function saveRename(session: UserChatSession) {
    const nextTitle = editingTitle.trim();
    setSavingId(session.chat_id);
    setRenameError("");
    try {
      const res = await fetch("/api/chat/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: session.chat_id, title: nextTitle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRenameError(data.error || "대화방 이름 변경에 실패했습니다.");
        return;
      }
      const updated = { ...session, title: data.title ?? nextTitle };
      onRenameSuccess?.(updated);
      setEditingId(null);
      setEditingTitle("");
      router.refresh();
    } catch {
      setRenameError("대화방 이름 변경 중 오류가 발생했습니다.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-branch-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(85vh,32rem)] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#131626] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/5 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="chat-branch-title" className="text-lg font-black text-white">
                {characterName}
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                {multi
                  ? `${branches.length}개의 대화 · 최신순`
                  : "이어갈 대화를 선택하세요."}
              </p>
            </div>
            <Link
              href={characterPageHref(characterId, blurNsfw, nsfw)}
              onClick={onClose}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-white/5"
            >
              캐릭터 정보
            </Link>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {renameError && (
            <p className="mb-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
              {renameError}
            </p>
          )}
          {multi ? (
            <ul className="space-y-1">
              {branches.map((b) => (
                <li key={b.chat_id}>
                  <div className="flex items-stretch gap-1 rounded-xl transition hover:bg-white/5">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (editingId !== b.chat_id) enter(b.chat_id);
                      }}
                      onKeyDown={(e) => {
                        if (editingId !== b.chat_id && (e.key === "Enter" || e.key === " ")) enter(b.chat_id);
                      }}
                      className="min-w-0 flex-1 px-3 py-3 text-left"
                    >
                      {editingId === b.chat_id ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveRename(b);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            value={editingTitle}
                            maxLength={32}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-violet-400"
                            placeholder="대화방 이름"
                          />
                          <button
                            type="submit"
                            disabled={savingId === b.chat_id}
                            className="shrink-0 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditingTitle("");
                            }}
                            className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-zinc-400 hover:bg-white/10 hover:text-white"
                          >
                            취소
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-white">
                            {getBranchDisplayTitle(b)}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                            {formatChatListTime(b.last_at)}
                          </span>
                        </div>
                      )}
                      <p className="mt-0.5 text-[11px] text-violet-400/80">
                        {formatChatSessionStats(b)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                        {formatChatPreview(b.last_role, b.last_content, characterName)}
                      </p>
                    </div>
                    {editingId !== b.chat_id && (
                      <button
                        type="button"
                        onClick={() => startRename(b)}
                        className="shrink-0 self-center rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-violet-500/15 hover:text-violet-300"
                      >
                        이름 변경
                      </button>
                    )}
                    {onDeleteRequest && !hidden && (
                      <button
                        type="button"
                        disabled={deletingId === b.chat_id}
                        onClick={() => onDeleteRequest(b)}
                        className="shrink-0 self-center rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-rose-500/15 hover:text-rose-400 disabled:opacity-40"
                      >
                        {deletingId === b.chat_id ? "…" : "삭제"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            latest?.last_content && (
              <p className="mx-2 line-clamp-3 rounded-xl bg-white/5 px-3 py-3 text-sm leading-relaxed text-gray-300">
                {formatChatPreview(latest.last_role, latest.last_content, characterName)}
              </p>
            )
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-white/5 p-4">
          {!multi && latest && (
            <button
              type="button"
              onClick={() => enter(latest.chat_id)}
              className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-500"
            >
              이어서 대화
            </button>
          )}
          <button
            type="button"
            onClick={() => enter(undefined, true)}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10"
          >
            처음부터 (새 대화)
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-300"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
