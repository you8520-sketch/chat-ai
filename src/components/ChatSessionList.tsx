"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import AdultContentBadge from "@/components/AdultContentBadge";
import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import CharacterChatBranchModal from "@/components/CharacterChatBranchModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { characterPageHref } from "@/lib/chatLinks";
import {
  formatChatListTime,
  formatChatPreview,
  formatChatSessionStats,
  getBranchDisplayTitle,
  groupSessionsByCharacter,
  type CharacterChatGroup,
  type UserChatSession,
} from "@/lib/recentChats";

type Props = {
  sessions: UserChatSession[];
  blurNsfw: boolean;
  activeChatId?: number | null;
  variant?: "sidebar" | "page";
  maxHeightClass?: string;
};

function CharacterThumbLink({
  group,
  hidden,
  size = "md",
}: {
  group: Pick<CharacterChatGroup, "character_id" | "images" | "hue" | "emoji" | "nsfw">;
  hidden: boolean;
  size?: "md" | "lg" | "xl";
}) {
  const thumb = (JSON.parse(group.images || "[]") as string[])[0];
  const w =
    size === "xl" ? "w-full" : size === "lg" ? "w-16 sm:w-[4.5rem]" : "w-11";
  const emojiSize =
    size === "xl" ? "text-4xl" : size === "lg" ? "text-2xl" : "text-base";
  const rounded =
    size === "xl" ? "rounded-none" : "rounded-xl ring-1 ring-white/10 hover:ring-violet-500/40";

  return (
    <Link
      href={characterPageHref(group.character_id, hidden, group.nsfw === 1)}
      title="캐릭터 정보"
      onClick={(e) => e.stopPropagation()}
      className={`relative ${CHARACTER_THUMB_ASPECT} ${w} shrink-0 overflow-hidden transition ${rounded}`}
      style={{ background: `hsl(${group.hue} 60% 20%)` }}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          className={`h-full w-full object-cover object-top ${hidden ? "blur-md" : ""}`}
        />
      ) : (
        <span className={`flex h-full w-full items-center justify-center ${emojiSize}`}>
          {group.emoji}
        </span>
      )}
    </Link>
  );
}

function CharacterChatRow({
  group,
  blurNsfw,
  active,
  variant,
  onOpenBranches,
}: {
  group: CharacterChatGroup;
  blurNsfw: boolean;
  active: boolean;
  variant: "sidebar" | "page";
  onOpenBranches: () => void;
}) {
  const hidden = group.nsfw === 1 && blurNsfw;
  const latest = group.sessions[0];
  const multi = group.sessions.length > 1;
  const isPage = variant === "page";

  const borderClass = active
    ? "border-violet-500/35 bg-violet-500/10"
    : "border-white/5 bg-[#0e1120]/40 hover:border-violet-500/20 hover:bg-white/[0.04]";

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p
          className={`truncate font-bold text-white ${isPage ? "text-lg" : "text-sm"}`}
        >
          {group.name}
          {group.nsfw === 1 && (
            <AdultContentBadge className="ml-1.5 align-middle text-[9px]" />
          )}
        </p>
        <span
          className={`shrink-0 tabular-nums text-zinc-500 ${isPage ? "text-xs" : "text-[11px]"}`}
        >
          {formatChatListTime(latest?.last_at ?? null)}
        </span>
      </div>
      <p className={`mt-1 text-violet-400/85 ${isPage ? "text-sm" : "text-[10px]"}`}>
        {multi
          ? `${group.sessions.length}개 대화 · 누적 ${group.total_turns.toLocaleString()}턴`
          : formatChatSessionStats(latest)}
      </p>
      <p
        className={`mt-1.5 line-clamp-2 leading-relaxed text-zinc-500 ${
          isPage ? "text-sm" : "text-xs"
        }`}
      >
        {multi && latest
          ? `${getBranchDisplayTitle(latest)} · ${formatChatPreview(latest.last_role, latest.last_content, group.name)}`
          : formatChatPreview(latest?.last_role ?? null, latest?.last_content ?? null, group.name)}
      </p>
      {isPage && (
        <p className="mt-3 text-xs font-semibold text-violet-400/70 group-hover:text-violet-300">
          대화 선택하기 →
        </p>
      )}
    </>
  );

  if (isPage) {
    return (
      <div
        className={`group flex h-full flex-col overflow-hidden rounded-2xl border transition ${borderClass}`}
      >
        <CharacterThumbLink group={group} hidden={hidden} size="xl" />
        <button
          type="button"
          onClick={onOpenBranches}
          className="flex min-h-[8.5rem] flex-1 flex-col p-4 text-left sm:min-h-[9rem] sm:p-5"
        >
          {body}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenBranches}
      className={`group flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition ${borderClass}`}
    >
      <CharacterThumbLink group={group} hidden={hidden} size="md" />
      <div className="min-w-0 flex-1">{body}</div>
    </button>
  );
}

export default function ChatSessionList({
  sessions,
  blurNsfw,
  activeChatId,
  variant = "page",
  maxHeightClass = "max-h-[min(28rem,50vh)]",
}: Props) {
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
      if (activeChatId === target.chat_id) {
        router.push(`/chat/${target.character_id}?fresh=1`);
      } else {
        router.refresh();
      }
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleRenameSuccess(updated: UserChatSession) {
    setPickerGroup((current) => {
      if (!current?.sessions.some((s) => s.chat_id === updated.chat_id)) return current;
      return {
        ...current,
        sessions: current.sessions.map((s) => (s.chat_id === updated.chat_id ? updated : s)),
      };
    });
  }

  if (sessions.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-gray-500">
        아직 대화한 캐릭터가 없습니다.
        <br />
        <Link href="/" className="mt-2 inline-block text-violet-400 hover:underline">
          캐릭터 둘러보기
        </Link>
      </p>
    );
  }

  return (
    <>
      {error && (
        <p className="mb-3 px-2 text-center text-xs text-rose-400" role="alert">
          {error}
        </p>
      )}
      <ul
        className={
          variant === "page"
            ? "grid grid-cols-2 gap-3 sm:gap-4"
            : `space-y-2 overflow-y-auto ${maxHeightClass}`
        }
      >
        {groups.map((g) => {
          const groupActive =
            activeChatId != null && g.sessions.some((s) => s.chat_id === activeChatId);
          return (
            <li key={g.character_id} className={variant === "page" ? "min-w-0" : undefined}>
              <CharacterChatRow
                group={g}
                blurNsfw={blurNsfw}
                active={groupActive}
                variant={variant}
                onOpenBranches={() => setPickerGroup(g)}
              />
            </li>
          );
        })}
      </ul>

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
          onRenameSuccess={handleRenameSuccess}
          deletingId={deletingId}
        />
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="대화 삭제"
        message={
          pendingDelete
            ? `「${getBranchDisplayTitle(pendingDelete)}」 대화를 삭제할까요? 메시지와 기록이 영구 삭제되며 되돌릴 수 없습니다.`
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
    </>
  );
}
