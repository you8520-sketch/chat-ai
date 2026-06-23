"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  formatChatListTime,
  formatChatPreview,
  formatChatSessionStats,
  getBranchDisplayTitle,
  type UserChatSession,
} from "@/lib/recentChats";

type Props = {
  characterId: number;
  characterName: string;
  loggedIn: boolean;
  branches: UserChatSession[];
  selectedPersonaId?: number | null;
};

function chatEntryHref(
  characterId: number,
  opts: { fresh?: boolean; chatId?: number; personaId?: number | null }
): string {
  const params = new URLSearchParams();
  if (opts.fresh) params.set("fresh", "1");
  if (opts.chatId) params.set("chat", String(opts.chatId));
  if (opts.personaId) params.set("persona", String(opts.personaId));
  const q = params.toString();
  return `/chat/${characterId}${q ? `?${q}` : ""}`;
}

export default function StartChatButton({
  characterId,
  characterName,
  loggedIn,
  branches,
  selectedPersonaId = null,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const hasHistory = branches.length > 0;
  const multi = branches.length > 1;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!loggedIn) {
    const loginHref = `/login?redirect=${encodeURIComponent(`/character/${characterId}`)}`;
    return (
      <Link
        href={loginHref}
        className="rounded-full bg-violet-600 px-8 py-3 font-bold text-white hover:bg-violet-500"
      >
        대화 시작하기
      </Link>
    );
  }

  if (!hasHistory) {
    return (
      <Link
        href={chatEntryHref(characterId, { fresh: true, personaId: selectedPersonaId })}
        className="rounded-full bg-violet-600 px-8 py-3 font-bold text-white hover:bg-violet-500"
      >
        대화 시작하기
      </Link>
    );
  }

  const latest = branches[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-violet-600 px-8 py-3 font-bold text-white hover:bg-violet-500"
      >
        대화 시작하기
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-chat-title"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#131626] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="start-chat-title" className="text-lg font-black text-white">
              대화 시작
            </h2>
            <p className="mt-2 text-sm text-gray-400">
              {multi
                ? `${characterName}와(과) ${branches.length}개의 대화가 있습니다. 이어갈 대화를 선택하세요.`
                : "이전 대화가 있습니다."}
            </p>

            {multi ? (
              <ul className="mt-4 max-h-52 space-y-1 overflow-y-auto">
                {branches.map((b) => (
                  <li key={b.chat_id}>
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        router.push(
                          chatEntryHref(characterId, { chatId: b.chat_id, personaId: selectedPersonaId })
                        );
                      }}
                      className="w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-white">
                          {getBranchDisplayTitle(b)}
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-600">
                          {formatChatListTime(b.last_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-violet-400/80">{formatChatSessionStats(b)}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {formatChatPreview(b.last_role, b.last_content, characterName)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              latest?.last_content && (
                <p className="mt-3 line-clamp-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300">
                  {formatChatPreview(latest.last_role, latest.last_content, characterName)}
                </p>
              )
            )}

            <div className="mt-6 flex flex-col gap-3">
              {!multi && latest && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    router.push(
                      chatEntryHref(characterId, { chatId: latest.chat_id, personaId: selectedPersonaId })
                    );
                  }}
                  className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-500"
                >
                  이어서 대화
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  close();
                  router.push(chatEntryHref(characterId, { fresh: true, personaId: selectedPersonaId }));
                }}
                className={`rounded-xl px-4 py-3 text-sm font-bold ${
                  multi
                    ? "border border-white/10 bg-white/5 text-white hover:bg-white/10"
                    : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
                }`}
              >
                처음부터 (새 대화)
              </button>
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-300"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
