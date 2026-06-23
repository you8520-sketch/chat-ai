"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { groupSessionsByCharacter, type UserChatSession } from "@/lib/recentChats";

const DEFAULT_MAX_ICONS = 10;
const COLLAPSED_MAX_ICONS = 8;

function parseThumb(images: string): string | null {
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

type Props = {
  sessions: UserChatSession[];
  blurNsfw: boolean;
  compact?: boolean;
  maxIcons?: number;
  showHeader?: boolean;
};

export default function SidebarRecentChatIcons({
  sessions,
  blurNsfw,
  compact = false,
  maxIcons,
  showHeader = false,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCharacterId = pathname.match(/^\/chat\/(\d+)/)?.[1] ?? null;
  const activeChatId = searchParams.get("chat");

  const limit = maxIcons ?? (compact ? COLLAPSED_MAX_ICONS : DEFAULT_MAX_ICONS);

  const recentGroups = useMemo(
    () => groupSessionsByCharacter(sessions).slice(0, limit),
    [sessions, limit]
  );

  if (recentGroups.length === 0) {
    if (!showHeader) return null;
    return (
      <p className="px-1 py-2 text-left text-[11px] text-zinc-600">
        아직 대화한 캐릭터가 없습니다.
      </p>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        compact ? "" : ""
      }`}
    >
      {showHeader && (
        <div className="mb-1 flex shrink-0 items-center justify-between px-0.5">
          <p className="text-[11px] font-medium text-zinc-200">최근 대화</p>
          <Link href="/chats" className="text-[10px] font-medium text-zinc-200 hover:text-white">
            전체
          </Link>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
        {recentGroups.map((g) => {
          const latest = g.sessions[0];
          const hidden = g.nsfw === 1 && blurNsfw;
          const active = activeChatId
            ? latest.chat_id === Number(activeChatId)
            : activeCharacterId === String(g.character_id);
          return (
            <RecentChatRow
              key={g.character_id}
              session={{ ...latest, images: g.images, hue: g.hue, emoji: g.emoji }}
              characterName={g.name}
              hidden={hidden}
              active={active}
              compact={compact}
            />
          );
        })}
      </div>
    </div>
  );
}
