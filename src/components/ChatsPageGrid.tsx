"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import CharacterChatBranchModal from "@/components/CharacterChatBranchModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { characterPageHref } from "@/lib/chatLinks";
import {
  formatChatListTime,
  formatChatPreview,
  getBranchDisplayTitle,
  groupSessionsByCharacter,
  type CharacterChatGroup,
  type UserChatSession,
} from "@/lib/recentChats";

type Props = {
  sessions: UserChatSession[];
  blurNsfw: boolean;
};

function formatLastChatLabel(iso: string | null): string {
  const t = formatChatListTime(iso);
  if (!t) return "";
  if (t === "방금") return "방금 대화";
  return `${t} 전 대화`;
}

function ChatCharacterCard({
  group,
  blurNsfw,
  onOpenBranches,
}: {
  group: CharacterChatGroup;
  blurNsfw: boolean;
  onOpenBranches: () => void;
}) {
  const hidden = group.nsfw === 1 && blurNsfw;
  const latest = group.sessions[0];
  const multi = group.sessions.length > 1;
  const thumb = (JSON.parse(group.images || "[]") as string[])[0];
  const lastLabel = formatLastChatLabel(latest?.last_at ?? null);

  return (
    <article className="group flex min-w-0 overflow-hidden rounded-lg border border-white/5 bg-[#131626] transition hover:border-violet-500/25 @min-[48rem]/chats:rounded-xl">
      <Link
        href={characterPageHref(group.character_id, hidden, group.nsfw === 1)}
        title={`${group.name} · 캐릭터 정보`}
        className="w-20 shrink-0 @min-[30rem]/chats:w-[4.25rem] @min-[48rem]/chats:w-20 @min-[64rem]/chats:w-24 @min-[80rem]/chats:w-28"
      >
        <div
          className={`relative ${CHARACTER_THUMB_ASPECT} h-full w-full overflow-hidden`}
          style={{ background: `hsl(${group.hue} 60% 20%)` }}
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt={group.name}
              className={`h-full w-full object-cover object-top ${hidden ? "blur-md" : ""}`}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xl @min-[48rem]/chats:text-2xl @min-[64rem]/chats:text-3xl">
              {group.emoji}
            </span>
          )}
          {group.nsfw === 1 && (
            <span className="absolute left-1 top-1 rounded bg-rose-600 px-1 py-0.5 text-[8px] font-bold text-white">
              19
            </span>
          )}
        </div>
      </Link>

      <button
        type="button"
        onClick={onOpenBranches}
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 p-2.5 text-left transition hover:bg-white/[0.03] @min-[30rem]/chats:p-3 @min-[48rem]/chats:gap-1 @min-[64rem]/chats:p-4"
      >
        <div className="flex min-w-0 items-start justify-between gap-1.5 @md/chats:gap-2">
          <h2 className="truncate text-xs font-bold text-white @min-[30rem]/chats:text-sm @min-[48rem]/chats:text-base @min-[64rem]/chats:text-lg">
            {group.name}
          </h2>
          {lastLabel && (
            <span className="shrink-0 text-[9px] tabular-nums text-zinc-500 @min-[30rem]/chats:text-[10px] @min-[48rem]/chats:text-[11px] @min-[64rem]/chats:text-xs">
              {lastLabel}
            </span>
          )}
        </div>

        <p className="text-[10px] font-medium text-violet-400/90 @min-[30rem]/chats:text-[11px] @min-[48rem]/chats:text-xs @min-[64rem]/chats:text-sm">
          {multi
            ? `${group.total_turns.toLocaleString()}턴 · ${group.sessions.length}개 대화`
            : `${latest?.user_turn_count.toLocaleString() ?? 0}턴`}
        </p>

        <p className="line-clamp-2 text-[10px] leading-snug text-zinc-500 @min-[30rem]/chats:text-[11px] @min-[48rem]/chats:text-xs @min-[64rem]/chats:line-clamp-3 @min-[64rem]/chats:text-sm">
          {multi && latest
            ? formatChatPreview(latest.last_role, latest.last_content, group.name)
            : formatChatPreview(latest?.last_role ?? null, latest?.last_content ?? null, group.name)}
        </p>

        <p className="mt-0.5 text-[10px] font-bold text-violet-400 group-hover:text-violet-300 @min-[30rem]/chats:text-[11px] @min-[48rem]/chats:text-xs @min-[64rem]/chats:text-sm">
          대화 선택 →
        </p>
      </button>
    </article>
  );
}

export default function ChatsPageGrid({ sessions, blurNsfw }: Props) {
  const router = useRouter();
  const groups = useMemo(() => groupSessionsByCharacter(sessions), [sessions]);

  const [pickerGroup, setPickerGroup] = useState<CharacterChatGroup | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserChatSession | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeletingId(target.chat_id);
    setError("");
    try {
      const res = await fetch("/api/chat/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ chatId: target.chat_id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "삭제에 실패했습니다.");
        return;
      }
      setPendingDelete(null);
      if (pickerGroup?.sessions.some((s) => s.chat_id === target.chat_id)) {
        const remaining = pickerGroup.sessions.filter((s) => s.chat_id !== target.chat_id);
        if (remaining.length === 0) setPickerGroup(null);
        else setPickerGroup({ ...pickerGroup, sessions: remaining });
      }
      router.refresh();
    } catch {
      setError("삭제 시간이 초과되었거나 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  if (sessions.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-gray-500">
        아직 대화한 캐릭터가 없습니다.
        <br />
        <Link href="/" className="mt-3 inline-block text-violet-400 hover:underline">
          캐릭터 둘러보기
        </Link>
      </p>
    );
  }

  return (
    <div className="chats-page-grid w-full">
      {error && (
        <p className="mb-4 text-center text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 @min-[30rem]/chats:grid-cols-2 @min-[30rem]/chats:gap-2.5 @min-[48rem]/chats:gap-3 @min-[64rem]/chats:gap-4 @min-[80rem]/chats:gap-5">
        {groups.map((g) => (
          <ChatCharacterCard
            key={g.character_id}
            group={g}
            blurNsfw={blurNsfw}
            onOpenBranches={() => setPickerGroup(g)}
          />
        ))}
      </div>

      {pickerGroup && (
        <CharacterChatBranchModal
          open
          onClose={() => setPickerGroup(null)}
          characterId={pickerGroup.character_id}
          characterName={pickerGroup.name}
          branches={pickerGroup.sessions}
          blurNsfw={blurNsfw}
          nsfw={pickerGroup.nsfw === 1}
          onDeleteRequest={setPendingDelete}
          deletingId={deletingId}
        />
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="대화 삭제"
        message={
          pendingDelete
            ? `「${getBranchDisplayTitle(pendingDelete)}」 대화를 삭제할까요? 메시지와 기록이 permanent 삭제되며 되돌릴 수 없습니다.`
            : ""
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        danger
        onConfirm={confirmDelete}
        onCancel={() => {
          setPendingDelete(null);
          setError("");
        }}
      />
    </div>
  );
}
