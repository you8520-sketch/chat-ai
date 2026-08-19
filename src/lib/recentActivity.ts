import type Database from "better-sqlite3";
import { sanitizeWorldCoverUrl } from "@/lib/worlds";
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
  thumbUrl: string | null;
};

export type RecentActivityEntry = RecentCharacterChatEntry | RecentTrpgCampaignEntry;

const CAMPAIGN_FETCH_LIMIT = RECENT_CHARACTER_LIST_LIMIT;

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

export function parseRecentThumb(images: string | null | undefined): string | null {
  try {
    const arr = JSON.parse(images || "[]") as unknown;
    if (!Array.isArray(arr)) return null;
    const first = arr.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first : null;
  } catch {
    return null;
  }
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
  source_character_id: number | null;
  source_world_id: number | null;
  human_count: number;
  started: number;
};

export function isListedRecentTrpgCampaign(row: {
  started: number;
  human_count: number;
}): boolean {
  return row.started > 0 || row.human_count > 1;
}

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
         ) AS last_activity_at,
         c.source_character_id,
         c.source_world_id,
         (SELECT COUNT(*) FROM trpg_participants hp WHERE hp.campaign_id = c.id AND hp.kind = 'human') AS human_count,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM trpg_rounds r
             WHERE r.campaign_id = c.id AND (r.round_number > 0 OR r.phase != 'NONE')
           ) THEN 1 ELSE 0
         END AS started
       FROM trpg_campaigns c
       WHERE EXISTS (
         SELECT 1 FROM trpg_participants p
         WHERE p.campaign_id = c.id AND p.user_id = ? AND p.kind = 'human'
       )
       ORDER BY last_activity_at DESC, c.id DESC
       LIMIT ?`
    )
    .all(userId, Math.max(1, Math.floor(limit))) as CampaignActivityRow[];

  return rows.filter(isListedRecentTrpgCampaign).map((row) => ({
    kind: "trpg_campaign",
    lastActivityAt: row.last_activity_at,
    href: recentTrpgCampaignHref(row.id),
    title: row.title.trim() || "TRPG 캠페인",
    campaignId: row.id,
    thumbUrl: resolveCampaignThumb(db, row.source_character_id, row.source_world_id),
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

function resolveCampaignThumb(
  db: Database.Database,
  sourceCharacterId: number | null,
  sourceWorldId: number | null
): string | null {
  if (sourceCharacterId) {
    const character = db
      .prepare(`SELECT images FROM characters WHERE id=?`)
      .get(sourceCharacterId) as { images?: string } | undefined;
    const thumb = parseRecentThumb(character?.images);
    if (thumb) return thumb;
  }
  if (sourceWorldId) {
    try {
      const world = db
        .prepare(`SELECT cover_url FROM worlds WHERE id=?`)
        .get(sourceWorldId) as { cover_url?: string } | undefined;
      const cover = sanitizeWorldCoverUrl(world?.cover_url);
      if (cover) return cover;
    } catch {
      return null;
    }
  }
  return null;
}
