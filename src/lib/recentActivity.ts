import type Database from "better-sqlite3";
import {
  fetchLatestSessionsPerCharacter,
  RECENT_CHARACTER_LIST_LIMIT,
  type UserChatSession,
} from "@/lib/recentChats";

export type RecentActivityKind = "character_chat" | "trpg_campaign";

export type RecentCharacterChatEntry = {
  kind: "character_chat";
  lastActivityAt: string;
  href: string;
  title: string;
  session: UserChatSession;
};

export type RecentTrpgCampaignEntry = {
  kind: "trpg_campaign";
  lastActivityAt: string;
  href: string;
  title: string;
  campaignId: number;
};

export type RecentActivityEntry = RecentCharacterChatEntry | RecentTrpgCampaignEntry;

const CAMPAIGN_FETCH_LIMIT = RECENT_CHARACTER_LIST_LIMIT;

/** Solo CHARACTER_SETUP campaigns stay in the sidebar recent list. */
export const SIDEBAR_SOLO_SETUP_VISIBLE = true;
/** V1 TRPG recent row always uses the D20 glyph — never a source thumb. */
export const TRPG_RECENT_ICON = "D20" as const;
export const TRPG_SOURCE_THUMB = false;

export function normalizeActivityAt(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return raw.includes("T") ? raw : raw.replace(" ", "T");
}

export function compareActivityAtDesc(a: string, b: string): number {
  return normalizeActivityAt(b).localeCompare(normalizeActivityAt(a));
}

export function recentCharacterChatHref(session: Pick<UserChatSession, "character_id" | "chat_id">): string {
  return `/chat/${session.character_id}?chat=${session.chat_id}`;
}

export function recentTrpgCampaignHref(campaignId: number): string {
  return `/trpg/${campaignId}`;
}

export function characterChatsToActivity(
  sessions: readonly UserChatSession[]
): RecentCharacterChatEntry[] {
  return sessions.map((session) => ({
    kind: "character_chat",
    lastActivityAt: session.last_at ?? session.chat_created_at,
    href: recentCharacterChatHref(session),
    title: session.name,
    session,
  }));
}

type CampaignActivityRow = {
  id: number;
  title: string;
  last_activity_at: string;
};

export function fetchRecentTrpgCampaigns(
  db: Database.Database,
  userId: number,
  limit = CAMPAIGN_FETCH_LIMIT
): RecentTrpgCampaignEntry[] {
  if (!hasTrpgCampaignTable(db)) return [];
  const rows = db
    .prepare(
      `SELECT
         c.id,
         c.title,
         COALESCE(
           (SELECT MAX(r.updated_at) FROM trpg_rounds r WHERE r.campaign_id = c.id),
           c.updated_at
         ) AS last_activity_at
       FROM trpg_campaigns c
       WHERE EXISTS (
         SELECT 1 FROM trpg_participants p
         WHERE p.campaign_id = c.id AND p.user_id = ? AND p.kind = 'human'
       )
       ORDER BY last_activity_at DESC, c.id DESC
       LIMIT ?`
    )
    .all(userId, Math.max(1, Math.floor(limit))) as CampaignActivityRow[];

  return rows.map((row) => ({
    kind: "trpg_campaign",
    lastActivityAt: row.last_activity_at,
    href: recentTrpgCampaignHref(row.id),
    title: row.title.trim() || "TRPG 캠페인",
    campaignId: row.id,
  }));
}

export function mergeRecentActivity(
  chats: readonly RecentCharacterChatEntry[],
  campaigns: readonly RecentTrpgCampaignEntry[],
  limit = RECENT_CHARACTER_LIST_LIMIT
): RecentActivityEntry[] {
  return [...chats, ...campaigns]
    .sort((a, b) => compareActivityAtDesc(a.lastActivityAt, b.lastActivityAt))
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function fetchRecentActivity(
  db: Database.Database,
  userId: number,
  limit = RECENT_CHARACTER_LIST_LIMIT,
  opts?: { includeTrpg?: boolean }
): RecentActivityEntry[] {
  const chats = characterChatsToActivity(fetchLatestSessionsPerCharacter(db, userId, limit));
  const campaigns =
    opts?.includeTrpg === false ? [] : fetchRecentTrpgCampaigns(db, userId, limit);
  return mergeRecentActivity(chats, campaigns, limit);
}

export function filterTrpgLobbyCampaigns<T extends { title: string }>(
  campaigns: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...campaigns];
  return campaigns.filter((campaign) => campaign.title.toLowerCase().includes(needle));
}

function hasTrpgCampaignTable(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='trpg_campaigns'`)
    .get() as { ok: number } | undefined;
  return Boolean(row);
}
