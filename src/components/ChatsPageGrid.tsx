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
  compareActivityAtDesc,
  type RecentTrpgCampaignEntry,
} from "@/lib/recentActivity";
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
  campaigns: RecentTrpgCampaignEntry[];
  blurNsfw: boolean;
};

type ChatListEntry =
  | { kind: "character_chat"; group: CharacterChatGroup; lastActivityAt: string }
  | { kind: "trpg_campaign"; campaign: RecentTrpgCampaignEntry; lastActivityAt: string };

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
  selectionMode,
  selected,
  onToggleSelection,
}: {
  group: CharacterChatGroup;
  blurNsfw: boolean;
  onOpenBranches: () => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelection: () => void;
}) {
  const hidden = group.nsfw === 1 && blurNsfw;
  const latest = group.sessions[0];
  const multi = group.sessions.length > 1;
  const thumb = (JSON.parse(group.images || "[]") as string[])[0];
  const lastLabel = formatLastChatLabel(latest?.last_at ?? null);

  const thumbnail = (
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
        <AdultContentBadge className="absolute left-1 top-1 px-1 text-[8px]" />
      )}
      {selectionMode && (
        <span
          aria-hidden="true"
          className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-sm font-black shadow-lg ${
            selected
              ? "border-rose-300 bg-rose-500 text-white"
              : "border-white/70 bg-black/55 text-transparent"
          }`}
        >
          ✓
        </span>
      )}
    </div>
  );

  const imageClass =
    "w-20 shrink-0 @min-[30rem]/chats:w-[4.25rem] @min-[48rem]/chats:w-20 @min-[64rem]/chats:w-24 @min-[80rem]/chats:w-28";

  return (
    <article
      className={`group flex min-w-0 overflow-hidden rounded-xl border bg-[#131626] transition ${
        selected
          ? "border-rose-400/45 bg-rose-500/[0.08] ring-1 ring-rose-400/20"
          : "border-white/10 hover:border-violet-500/25"
      }`}
    >
      {selectionMode ? (
        <button
          type="button"
          aria-label={`${group.name} 선택`}
          aria-pressed={selected}
          onClick={onToggleSelection}
          className={imageClass}
        >
          {thumbnail}
        </button>
      ) : (
        <Link
          href={characterPageHref(group.character_id, hidden, group.nsfw === 1)}
          title={`${group.name} · 캐릭터 정보`}
          className={imageClass}
        >
          {thumbnail}
        </Link>
      )}

      <button
        type="button"
        aria-pressed={selectionMode ? selected : undefined}
        onClick={selectionMode ? onToggleSelection : onOpenBranches}
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 p-2.5 text-left transition hover:bg-white/[0.03] @min-[30rem]/chats:p-3 @min-[48rem]/chats:gap-1 @min-[64rem]/chats:p-4"
      >
        <div className="flex min-w-0 items-start justify-between gap-1.5 @md/chats:gap-2">
          <h2 className="truncate text-xs font-bold text-zinc-50 @min-[30rem]/chats:text-sm @min-[48rem]/chats:text-base @min-[64rem]/chats:text-lg">
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
          {selectionMode ? (selected ? "선택됨 ✓" : "이 캐릭터 선택") : "대화 선택 →"}
        </p>
      </button>
    </article>
  );
}

function TrpgChatCard({
  campaign,
  selectionMode,
  selected,
  onToggleSelection,
}: {
  campaign: RecentTrpgCampaignEntry;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelection: () => void;
}) {
  const lastLabel = formatLastChatLabel(campaign.lastActivityAt);
  const imageClass =
    "relative flex w-20 shrink-0 items-center justify-center bg-violet-500/10 text-violet-300 @min-[30rem]/chats:w-[4.25rem] @min-[48rem]/chats:w-20 @min-[64rem]/chats:w-24 @min-[80rem]/chats:w-28";
  const thumbnail = (
    <>
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-300/25 bg-violet-500/15 @min-[64rem]/chats:h-14 @min-[64rem]/chats:w-14">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-6 w-6 @min-[64rem]/chats:h-7 @min-[64rem]/chats:w-7">
          <path
            d="M12 2.4 20.2 7v10L12 21.6 3.8 17V7L12 2.4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M12 8.2 15.4 10v4L12 15.8 8.6 14v-4L12 8.2Z" fill="currentColor" opacity="0.85" />
        </svg>
      </span>
      {selectionMode ? (
        <span
          aria-hidden="true"
          className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-sm font-black shadow-lg ${
            selected
              ? "border-rose-300 bg-rose-500 text-white"
              : "border-white/70 bg-black/55 text-transparent"
          }`}
        >
          ✓
        </span>
      ) : null}
    </>
  );
  const body = (
    <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 p-2.5 text-left @min-[30rem]/chats:p-3 @min-[48rem]/chats:gap-1 @min-[64rem]/chats:p-4">
      <span className="flex min-w-0 items-start justify-between gap-1.5 @md/chats:gap-2">
        <span className="truncate text-xs font-bold text-zinc-50 @min-[30rem]/chats:text-sm @min-[48rem]/chats:text-base @min-[64rem]/chats:text-lg">
          {campaign.title}
        </span>
        {lastLabel ? (
          <span className="shrink-0 text-[9px] tabular-nums text-zinc-500 @min-[30rem]/chats:text-[10px] @min-[48rem]/chats:text-[11px] @min-[64rem]/chats:text-xs">
            {lastLabel}
          </span>
        ) : null}
      </span>
      <span className="text-[10px] font-bold text-violet-300 @min-[30rem]/chats:text-[11px] @min-[48rem]/chats:text-xs @min-[64rem]/chats:text-sm">
        TRPG 캠페인
      </span>
      <span className="line-clamp-2 text-[10px] leading-snug text-zinc-500 @min-[30rem]/chats:text-[11px] @min-[48rem]/chats:text-xs @min-[64rem]/chats:text-sm">
        참여했던 방의 장면과 캐릭터 시트를 이어서 확인하세요.
      </span>
      <span className="mt-0.5 text-[10px] font-bold text-violet-400 group-hover:text-violet-300 @min-[30rem]/chats:text-[11px] @min-[48rem]/chats:text-xs @min-[64rem]/chats:text-sm">
        {selectionMode ? (selected ? "선택됨 ✓" : "이 TRPG 방 선택") : "TRPG 방으로 돌아가기 →"}
      </span>
    </span>
  );

  return (
    <article
      data-chat-list-kind="trpg_campaign"
      className={`group flex min-w-0 overflow-hidden rounded-xl border bg-[#131626] transition ${
        selected
          ? "border-rose-400/45 bg-rose-500/[0.08] ring-1 ring-rose-400/20"
          : "border-violet-400/20 hover:border-violet-400/45 hover:bg-violet-500/[0.06]"
      }`}
    >
      {selectionMode ? (
        <button
          type="button"
          aria-label={`${campaign.title} 선택`}
          aria-pressed={selected}
          onClick={onToggleSelection}
          className={imageClass}
        >
          {thumbnail}
        </button>
      ) : (
        <Link href={campaign.href} className={imageClass}>
          {thumbnail}
        </Link>
      )}
      {selectionMode ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onToggleSelection}
          className="flex min-w-0 flex-1 text-left transition hover:bg-white/[0.03]"
        >
          {body}
        </button>
      ) : (
        <Link href={campaign.href} className="flex min-w-0 flex-1">
          {body}
        </Link>
      )}
    </article>
  );
}

export default function ChatsPageGrid({ sessions, campaigns, blurNsfw }: Props) {
  const router = useRouter();
  const groups = useMemo(() => groupSessionsByCharacter(sessions), [sessions]);
  const entries = useMemo<ChatListEntry[]>(
    () =>
      [
        ...groups.map((group) => ({
          kind: "character_chat" as const,
          group,
          lastActivityAt: group.latest_at ?? "",
        })),
        ...campaigns.map((campaign) => ({
          kind: "trpg_campaign" as const,
          campaign,
          lastActivityAt: campaign.lastActivityAt,
        })),
      ].sort((a, b) => compareActivityAtDesc(a.lastActivityAt, b.lastActivityAt)),
    [campaigns, groups]
  );

  const [pickerGroup, setPickerGroup] = useState<CharacterChatGroup | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserChatSession | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<number>>(
    () => new Set()
  );
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<number>>(
    () => new Set()
  );
  const [pendingGroupDelete, setPendingGroupDelete] = useState<CharacterChatGroup[]>([]);
  const [pendingCampaignDelete, setPendingCampaignDelete] = useState<
    RecentTrpgCampaignEntry[]
  >([]);
  const [deletingGroups, setDeletingGroups] = useState(false);
  const [error, setError] = useState("");
  const selectedGroups = groups.filter((group) =>
    selectedCharacterIds.has(group.character_id)
  );
  const selectedCampaigns = campaigns.filter((campaign) =>
    selectedCampaignIds.has(campaign.campaignId)
  );
  const selectedCount = selectedGroups.length + selectedCampaigns.length;
  const allGroupsSelected =
    (groups.length === 0 || selectedGroups.length === groups.length) &&
    (campaigns.length === 0 || selectedCampaigns.length === campaigns.length);
  const canSelectDelete = groups.length > 0 || campaigns.length > 0;

  function stopSelection() {
    if (deletingGroups) return;
    setSelectionMode(false);
    setSelectedCharacterIds(new Set());
    setSelectedCampaignIds(new Set());
    setPendingGroupDelete([]);
    setPendingCampaignDelete([]);
  }

  function toggleCharacterSelection(characterId: number) {
    if (deletingGroups) return;
    setSelectedCharacterIds((current) => {
      const next = new Set(current);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  }

  function toggleCampaignSelection(campaignId: number) {
    if (deletingGroups) return;
    setSelectedCampaignIds((current) => {
      const next = new Set(current);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }

  function toggleAllCharacters() {
    if (deletingGroups) return;
    if (allGroupsSelected) {
      setSelectedCharacterIds(new Set());
      setSelectedCampaignIds(new Set());
      return;
    }
    setSelectedCharacterIds(new Set(groups.map((group) => group.character_id)));
    setSelectedCampaignIds(new Set(campaigns.map((campaign) => campaign.campaignId)));
  }

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

  async function confirmGroupDelete() {
    if (pendingGroupDelete.length === 0 && pendingCampaignDelete.length === 0) return;
    const characterIds = pendingGroupDelete.map((group) => group.character_id);
    const campaignIds = pendingCampaignDelete.map((campaign) => campaign.campaignId);
    setDeletingGroups(true);
    setPendingGroupDelete([]);
    setPendingCampaignDelete([]);
    setError("");
    try {
      if (characterIds.length > 0) {
        const res = await fetch("/api/chat/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ characterIds }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "선택한 캐릭터의 대화 삭제에 실패했습니다.");
          return;
        }
      }
      for (const campaignId of campaignIds) {
        const res = await fetch(`/api/trpg/campaigns/${campaignId}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "선택한 TRPG 방 삭제에 실패했습니다.");
          return;
        }
      }
      setPickerGroup(null);
      setSelectionMode(false);
      setSelectedCharacterIds(new Set());
      setSelectedCampaignIds(new Set());
      router.refresh();
    } catch {
      setError("삭제 시간이 초과되었거나 오류가 발생했습니다.");
    } finally {
      setDeletingGroups(false);
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

  if (sessions.length === 0 && campaigns.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-zinc-400">
        아직 일반 대화나 TRPG 대화가 없습니다.
        <br />
        <span className="mt-3 inline-flex gap-4">
          <Link href="/" className="text-violet-400 hover:underline">
            캐릭터 둘러보기
          </Link>
          <Link href="/trpg" className="text-violet-400 hover:underline">
            TRPG 둘러보기
          </Link>
        </span>
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

      {canSelectDelete ? (
        <div className="mb-3 rounded-xl border border-white/10 bg-[#101321]/80 p-3">
          {selectionMode ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-white">삭제할 대화와 TRPG 방을 선택하세요</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  선택한 캐릭터의 모든 대화방과 TRPG 방이 삭제됩니다. 캐릭터 자체는 유지됩니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleAllCharacters}
                  disabled={deletingGroups}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-white/10 disabled:opacity-40"
                >
                  {allGroupsSelected ? "전체 해제" : "전체 선택"}
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0 || deletingGroups}
                  onClick={() => {
                    setPendingGroupDelete(selectedGroups);
                    setPendingCampaignDelete(selectedCampaigns);
                  }}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-black text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-zinc-600"
                >
                  {deletingGroups
                    ? "삭제 중…"
                    : selectedCount > 0
                      ? `선택한 대화 삭제 (${selectedCount})`
                      : "항목을 선택하세요"}
                </button>
                <button
                  type="button"
                  onClick={stopSelection}
                  disabled={deletingGroups}
                  className="rounded-lg px-3 py-2 text-xs font-bold text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                캐릭터 대화와 TRPG 방을 한꺼번에 정리할 수 있습니다.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectionMode(true);
                  setSelectedCharacterIds(new Set());
                  setSelectedCampaignIds(new Set());
                  setError("");
                }}
                className="shrink-0 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
              >
                선택 삭제
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 @min-[30rem]/chats:grid-cols-2 @min-[30rem]/chats:gap-2.5 @min-[48rem]/chats:gap-3 @min-[64rem]/chats:gap-4 @min-[80rem]/chats:gap-5">
        {entries.map((entry) =>
          entry.kind === "trpg_campaign" ? (
            <TrpgChatCard
              key={`trpg-${entry.campaign.campaignId}`}
              campaign={entry.campaign}
              selectionMode={selectionMode}
              selected={selectedCampaignIds.has(entry.campaign.campaignId)}
              onToggleSelection={() => toggleCampaignSelection(entry.campaign.campaignId)}
            />
          ) : (
            <ChatCharacterCard
              key={`character-${entry.group.character_id}`}
              group={entry.group}
              blurNsfw={blurNsfw}
              onOpenBranches={() => setPickerGroup(entry.group)}
              selectionMode={selectionMode}
              selected={selectedCharacterIds.has(entry.group.character_id)}
              onToggleSelection={() => toggleCharacterSelection(entry.group.character_id)}
            />
          )
        )}
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

      <ConfirmDialog
        open={pendingGroupDelete.length > 0 || pendingCampaignDelete.length > 0}
        title={
          pendingGroupDelete.length > 0 && pendingCampaignDelete.length > 0
            ? "선택한 대화 삭제"
            : pendingCampaignDelete.length > 0
              ? "선택한 TRPG 방 삭제"
              : "선택한 캐릭터의 대화 전체 삭제"
        }
        message={
          pendingGroupDelete.length > 0 && pendingCampaignDelete.length > 0
            ? `선택한 캐릭터 대화 ${pendingGroupDelete.length}개와 TRPG 방 ${pendingCampaignDelete.length}개를 삭제할까요? 캐릭터 자체는 유지되지만 대화와 캠페인 기록은 영구 삭제되어 복구할 수 없습니다.`
            : pendingCampaignDelete.length > 0
              ? `선택한 TRPG 방 ${pendingCampaignDelete.length}개를 삭제할까요? 장면, 주사위, 시트가 영구 삭제되며 되돌릴 수 없습니다.`
              : pendingGroupDelete.length > 0
                ? `선택한 ${pendingGroupDelete.length}명 캐릭터와 나눈 모든 대화방을 삭제할까요? 캐릭터 자체는 삭제되지 않지만, 메시지와 기억은 영구 삭제되어 복구할 수 없습니다.`
                : ""
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        danger
        onConfirm={confirmGroupDelete}
        onCancel={() => {
          setPendingGroupDelete([]);
          setPendingCampaignDelete([]);
          setError("");
        }}
      />
    </div>
  );
}
