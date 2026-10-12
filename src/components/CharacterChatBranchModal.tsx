"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  chatPreviewLabel,
  formatChatListTime,
  formatChatSessionStats,
  getBranchDisplayTitle,
  type CharacterChatGroup,
  type DisplayChatSession,
} from "@/lib/recentChats";
import MaskedChatGlyph from "@/components/MaskedChatGlyph";
import { chatEntryHref, characterPageHref } from "@/lib/chatLinks";
import { CHAT_RESUME_THUMB_ATTR, chatResumeAttrs } from "@/lib/chatResumeTransition";
import { chatRoomHref, requestExplicitChatSession } from "@/lib/chatSessionStartClient";
import { isPlainLeftClick } from "@/lib/menuTransitionSpec";

type Props = {
  open: boolean;
  onClose: () => void;
  characterId: number;
  characterName: string;
  branches: DisplayChatSession[];
  /** 서버가 성인 가림으로 변환한 캐릭터인지 (`toDisplayChatSession`). */
  masked: boolean;
  /** 대표 이미지·색·이모지. D-2 전환이 이 원에서 시작한다. */
  avatar: Pick<CharacterChatGroup, "images" | "hue" | "emoji">;
  onDeleteRequest?: (session: DisplayChatSession) => void;
  onRenameSuccess?: (session: DisplayChatSession) => void;
  deletingId?: number | null;
};

function parseThumb(images: string): string | null {
  try {
    const arr = JSON.parse(images || "[]") as string[];
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

function BranchAvatar({
  avatar,
  hidden,
  className,
}: {
  avatar: Pick<CharacterChatGroup, "images" | "hue" | "emoji">;
  hidden: boolean;
  className: string;
}) {
  const thumb = hidden ? null : parseThumb(avatar.images);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const showImage = thumb !== null && thumb !== failedSrc;

  useEffect(() => {
    const img = imgRef.current;
    if (thumb && img && img.complete && img.naturalWidth === 0) setFailedSrc(thumb);
  }, [thumb]);

  return (
    <span
      {...{ [CHAT_RESUME_THUMB_ATTR]: "" }}
      aria-hidden="true"
      className={`relative block shrink-0 overflow-hidden rounded-full ring-1 ring-white/15 ${className}`}
      style={{ background: `hsl(${avatar.hue} 60% 22%)` }}
    >
      {hidden ? (
        <span className="flex h-full w-full items-center justify-center text-zinc-300">
          <MaskedChatGlyph className="h-4 w-4" />
        </span>
      ) : showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={thumb}
          alt=""
          onError={() => setFailedSrc(thumb)}
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm">{avatar.emoji}</span>
      )}
    </span>
  );
}

export default function CharacterChatBranchModal({
  open,
  onClose,
  characterId,
  characterName,
  branches,
  masked,
  avatar,
  onDeleteRequest,
  onRenameSuccess,
  deletingId = null,
}: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [renameError, setRenameError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  if (!open) return null;

  const hidden = masked;
  const multi = branches.length > 1;
  const latest = branches[0];

  /** 실제 방 확정은 native Link. 전환 마커는 성인 가림(/verify)에는 붙지 않는다. */
  function enterLinkProps(chatId: number) {
    return {
      href: hidden ? "/verify" : chatEntryHref(characterId, { chatId }),
      onClick: (e: MouseEvent<HTMLAnchorElement>) => {
        if (isPlainLeftClick(e)) onClose();
      },
      ...chatResumeAttrs({ characterId, chatId, name: characterName, hidden }),
    };
  }

  async function startFreshChat() {
    if (starting) return;
    if (hidden) {
      onClose();
      router.push("/verify");
      return;
    }
    setStarting(true);
    setStartError("");
    try {
      const { chatId } = await requestExplicitChatSession({
        characterId,
        fresh: true,
      });
      onClose();
      router.push(chatRoomHref(characterId, chatId));
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "채팅을 시작하지 못했습니다.");
      setStarting(false);
    }
  }

  function startRename(session: DisplayChatSession) {
    setEditingId(session.chat_id);
    setEditingTitle(session.masked ? "" : getBranchDisplayTitle(session));
    setRenameError("");
  }

  async function saveRename(session: DisplayChatSession) {
    const nextTitle = editingTitle.trim();
    if (session.masked && !nextTitle) return;
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
      const updated = session.masked ? session : { ...session, title: data.title ?? nextTitle };
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
              href={characterPageHref(characterId, masked, masked)}
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
                    {editingId === b.chat_id ? (
                      <div className="min-w-0 flex-1 px-3 py-3 text-left">
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveRename(b);
                          }}
                        >
                          <input
                            autoFocus
                            value={editingTitle}
                            maxLength={32}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-violet-400"
                            placeholder={b.masked ? "새 대화방 이름" : "대화방 이름"}
                          />
                          <button
                            type="submit"
                            disabled={savingId === b.chat_id || (b.masked && !editingTitle.trim())}
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
                        <p className="mt-0.5 text-[11px] text-violet-400/80">
                          {formatChatSessionStats(b)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                          {chatPreviewLabel(b, characterName)}
                        </p>
                      </div>
                    ) : (
                      <Link
                        {...enterLinkProps(b.chat_id)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-3 text-left"
                      >
                        <BranchAvatar avatar={avatar} hidden={hidden} className="h-8 w-8" />
                        <span className="block min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-white">
                              {getBranchDisplayTitle(b)}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                              {formatChatListTime(b.last_at)}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-violet-400/80">
                            {formatChatSessionStats(b)}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-zinc-500">
                            {chatPreviewLabel(b, characterName)}
                          </span>
                        </span>
                      </Link>
                    )}
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
                        className="mr-1 shrink-0 self-center rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-300/90 hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-40"
                      >
                        {deletingId === b.chat_id ? "…" : "삭제"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            (latest?.masked || latest?.last_content) && (
              <p className="mx-2 line-clamp-3 rounded-xl bg-white/5 px-3 py-3 text-sm leading-relaxed text-gray-300">
                {chatPreviewLabel(latest, characterName)}
              </p>
            )
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-white/5 p-4">
          {!multi && latest && (
            <Link
              {...enterLinkProps(latest.chat_id)}
              className="flex items-center justify-center gap-2.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
            >
              <BranchAvatar avatar={avatar} hidden={hidden} className="h-8 w-8" />
              이어서 대화
            </Link>
          )}
          {!multi && latest && onDeleteRequest && !hidden && (
            <button
              type="button"
              disabled={deletingId === latest.chat_id}
              onClick={() => onDeleteRequest(latest)}
              className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-2.5 text-sm font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
            >
              {deletingId === latest.chat_id ? "삭제 중…" : "이 대화 삭제"}
            </button>
          )}
          <button
            type="button"
            disabled={starting}
            onClick={() => {
              void startFreshChat();
            }}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-60"
          >
            {starting ? "시작하는 중…" : "처음부터 (새 대화)"}
          </button>
          {startError ? (
            <p className="text-xs text-rose-300" role="alert">
              {startError}
            </p>
          ) : null}
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
