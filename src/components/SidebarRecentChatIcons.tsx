"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { RecentActivityEntry, RecentTrpgCampaignEntry } from "@/lib/recentActivity";
import type { UserChatSession } from "@/lib/recentChats";

const DEFAULT_MAX_ICONS = 10;
const COLLAPSED_MAX_ICONS = 8;

function parseThumb(images: string | null | undefined): string | null {
  try {
    const arr = JSON.parse(images || "[]") as string[];
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

function lastNarrationSnippet(content: string | null, maxLen = 36): string {
  if (!content?.trim()) return "대화를 시작해 보세요";
  let text = content
    .replace(/<<<STATUS>>>[\s\S]*?<<<\/STATUS>>>/g, "")
    .replace(/<div[\s\S]*?<\/div>/gi, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "…";
  if (text.length > maxLen) return `${text.slice(0, maxLen)}…`;
  return text;
}

function TrpgRecentGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M12 2.4 20.2 7v10L12 21.6 3.8 17V7L12 2.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 8.2 15.4 10v4L12 15.8 8.6 14v-4L12 8.2Z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

function recentActivityActive(pathname: string, chatId: string | null, entry: RecentActivityEntry): boolean {
  switch (entry.kind) {
    case "character_chat": {
      if (chatId) return entry.session.chat_id === Number(chatId);
      return pathname === `/chat/${entry.session.character_id}`;
    }
    case "trpg_campaign":
      return pathname === `/trpg/${entry.campaignId}` || pathname.startsWith(`/trpg/${entry.campaignId}/`);
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

function RecentChatRow({
  session,
  characterName,
  hidden,
  active,
  compact,
}: {
  session: UserChatSession;
  characterName: string;
  hidden: boolean;
  active: boolean;
  compact: boolean;
}) {
  const thumb = parseThumb(session.images);
  const href = hidden ? "/verify" : `/chat/${session.character_id}?chat=${session.chat_id}`;
  const preview = lastNarrationSnippet(session.last_content);

  return (
    <Link
      href={href}
      title={`${characterName} · ${preview}`}
      data-trpg-recent-kind="character_chat"
      className={`flex w-full min-w-0 items-center rounded-lg transition hover:bg-white/[0.06] ${
        compact ? "justify-center px-0 py-0.5" : "gap-2 px-1 py-1"
      } ${active ? "bg-white/[0.06]" : ""}`}
    >
      <span
        className={`relative block h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ${
          active ? "ring-white/30" : "ring-white/10"
        }`}
        style={{ background: `hsl(${session.hue} 60% 22%)` }}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className={`h-full w-full object-cover ${compact ? "object-center" : "object-top"} ${hidden ? "blur-md" : ""}`}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-sm">{session.emoji}</span>
        )}
      </span>
      {!compact && (
        <span className="min-w-0 flex-1 text-left text-[11px] leading-snug text-zinc-300 line-clamp-2">
          {preview}
        </span>
      )}
    </Link>
  );
}

function RecentTrpgRow({
  entry,
  active,
  compact,
}: {
  entry: RecentTrpgCampaignEntry;
  active: boolean;
  compact: boolean;
}) {
  return (
    <Link
      href={entry.href}
      title={entry.title}
      data-trpg-recent-kind="trpg_campaign"
      data-trpg-recent-icon="d20"
      className={`flex w-full min-w-0 items-center rounded-lg transition hover:bg-white/[0.06] ${
        compact ? "justify-center px-0 py-0.5" : "gap-2 px-1 py-1"
      } ${active ? "bg-white/[0.06]" : ""}`}
    >
      <span
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-300 ring-1 ${
          active ? "ring-violet-300/50" : "ring-white/10"
        }`}
      >
        <TrpgRecentGlyph className="h-4 w-4" />
      </span>
      {!compact && (
        <span className="min-w-0 flex-1 text-left text-[11px] font-medium leading-snug text-zinc-200 line-clamp-2">
          {entry.title}
        </span>
      )}
    </Link>
  );
}

function RecentActivityRow({
  entry,
  blurNsfw,
  compact,
  pathname,
  chatId,
}: {
  entry: RecentActivityEntry;
  blurNsfw: boolean;
  compact: boolean;
  pathname: string;
  chatId: string | null;
}) {
  const active = recentActivityActive(pathname, chatId, entry);
  switch (entry.kind) {
    case "character_chat":
      return (
        <RecentChatRow
          session={entry.session}
          characterName={entry.title}
          hidden={entry.session.nsfw === 1 && blurNsfw}
          active={active}
          compact={compact}
        />
      );
    case "trpg_campaign":
      return <RecentTrpgRow entry={entry} active={active} compact={compact} />;
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

type Props = {
  entries: RecentActivityEntry[];
  blurNsfw: boolean;
  compact?: boolean;
  maxIcons?: number;
  showHeader?: boolean;
};

export default function SidebarRecentChatIcons({
  entries,
  blurNsfw,
  compact = false,
  maxIcons,
  showHeader = false,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeChatId = searchParams.get("chat");

  const limit = maxIcons ?? (compact ? COLLAPSED_MAX_ICONS : DEFAULT_MAX_ICONS);
  const displayEntries = useMemo(() => entries.slice(0, limit), [entries, limit]);

  if (displayEntries.length === 0) {
    if (!showHeader) return null;
    return (
      <p className="px-1 py-2 text-left text-[11px] text-zinc-600">
        아직 최근 활동이 없습니다.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {showHeader && (
        <p className="mb-1 px-0.5 text-[11px] font-medium text-zinc-200">최근 활동</p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
        {displayEntries.map((entry) => (
          <RecentActivityRow
            key={entry.kind === "character_chat" ? entry.session.chat_id : `trpg-${entry.campaignId}`}
            entry={entry}
            blurNsfw={blurNsfw}
            compact={compact}
            pathname={pathname}
            chatId={activeChatId}
          />
        ))}
      </div>
    </div>
  );
}
