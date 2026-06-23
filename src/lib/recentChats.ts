import type Database from "better-sqlite3";
import { formatBranchTitle } from "@/lib/chatTitle";

export type RecentChatCharacter = {
  id: number;
  name: string;
  emoji: string;
  hue: number;
  nsfw: number;
  images: string;
  chat_id: number;
  last_at: string;
};

export type UserChatSession = {
  chat_id: number;
  character_id: number;
  name: string;
  emoji: string;
  hue: number;
  nsfw: number;
  images: string;
  last_content: string | null;
  last_role: string | null;
  last_at: string | null;
  msg_count: number;
  /** 이 채팅방에서 유저가 보낸 메시지 수 (= 대화 턴) */
  user_turn_count: number;
  /** 이 캐릭터와 연 채팅방 개수 (처음부터·분기 포함) */
  character_session_count: number;
  /** 같은 캐릭터 채팅방 중 생성 순서 (1부터) */
  session_ordinal: number;
  chat_created_at: string;
  title: string;
};

export type CharacterChatGroup = {
  character_id: number;
  name: string;
  emoji: string;
  hue: number;
  nsfw: number;
  images: string;
  sessions: UserChatSession[];
  latest_at: string | null;
  total_turns: number;
};

const RECENT_CHAT_LIMIT = 20;
const SESSION_LIST_LIMIT = 50;

/** 사용자가 대화한 캐릭터 목록 (최근 메시지 기준, 캐릭터당 최신 채팅방 1개) */
export function fetchRecentChattedCharacters(
  db: Database.Database,
  userId: number,
  limit = RECENT_CHAT_LIMIT
): RecentChatCharacter[] {
  return db
    .prepare(
      `WITH chat_activity AS (
         SELECT ch.character_id, ch.id AS chat_id,
                COALESCE(
                  (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = ch.id),
                  ch.created_at
                ) AS last_at
         FROM chats ch
         WHERE ch.user_id = ?
       ),
       best AS (
         SELECT character_id, chat_id, last_at,
                ROW_NUMBER() OVER (PARTITION BY character_id ORDER BY last_at DESC) AS rn
         FROM chat_activity
       )
       SELECT c.id, c.name, c.emoji, c.hue, c.nsfw, c.images, b.chat_id, b.last_at
       FROM best b
       JOIN characters c ON c.id = b.character_id
       WHERE b.rn = 1
       ORDER BY b.last_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as RecentChatCharacter[];
}

/** 사용자의 모든 채팅방 (최근 활동 순) */
export function fetchUserChatSessions(
  db: Database.Database,
  userId: number,
  limit = SESSION_LIST_LIMIT
): UserChatSession[] {
  return db
    .prepare(
      `SELECT
         ch.id AS chat_id,
         ch.character_id,
         ch.title,
         ch.created_at AS chat_created_at,
         c.name, c.emoji, c.hue, c.nsfw, c.images,
         (
           SELECT m.content FROM messages m
           WHERE m.chat_id = ch.id AND m.role IN ('user', 'assistant') AND m.model != 'greeting'
           ORDER BY m.id DESC LIMIT 1
         ) AS last_content,
         (
           SELECT m.role FROM messages m
           WHERE m.chat_id = ch.id AND m.role IN ('user', 'assistant') AND m.model != 'greeting'
           ORDER BY m.id DESC LIMIT 1
         ) AS last_role,
         COALESCE(
           (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = ch.id),
           ch.created_at
         ) AS last_at,
         (
           SELECT COUNT(*) FROM messages m
           WHERE m.chat_id = ch.id AND m.role IN ('user', 'assistant')
         ) AS msg_count,
         (
           SELECT COUNT(*) FROM messages m
           WHERE m.chat_id = ch.id AND m.role = 'user'
         ) AS user_turn_count,
         COUNT(*) OVER (PARTITION BY ch.character_id) AS character_session_count,
         ROW_NUMBER() OVER (PARTITION BY ch.character_id ORDER BY ch.id ASC) AS session_ordinal
       FROM chats ch
       JOIN characters c ON c.id = ch.character_id
       WHERE ch.user_id = ?
       ORDER BY last_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as UserChatSession[];
}

/** 특정 캐릭터의 모든 채팅방 (최근 활동 순) */
export function fetchCharacterChatSessions(
  db: Database.Database,
  userId: number,
  characterId: number,
  limit = 20
): UserChatSession[] {
  const all = fetchUserChatSessions(db, userId, 200);
  return all.filter((s) => s.character_id === characterId).slice(0, limit);
}

/** 대화 목록 — 캐릭터별 그룹 (그룹 내 최근 활동 순) */
export function groupSessionsByCharacter(sessions: UserChatSession[]): CharacterChatGroup[] {
  const map = new Map<number, CharacterChatGroup>();

  for (const s of sessions) {
    let g = map.get(s.character_id);
    if (!g) {
      g = {
        character_id: s.character_id,
        name: s.name,
        emoji: s.emoji,
        hue: s.hue,
        nsfw: s.nsfw,
        images: s.images,
        sessions: [],
        latest_at: null,
        total_turns: 0,
      };
      map.set(s.character_id, g);
    }
    g.sessions.push(s);
    g.total_turns += s.user_turn_count;
    if (s.last_at && (!g.latest_at || s.last_at > g.latest_at)) {
      g.latest_at = s.last_at;
    }
  }

  for (const g of map.values()) {
    g.sessions.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
  }

  return Array.from(map.values()).sort((a, b) => (b.latest_at ?? "").localeCompare(a.latest_at ?? ""));
}

export function getBranchDisplayTitle(session: UserChatSession): string {
  return formatBranchTitle(session.title, session.session_ordinal);
}

export function formatChatListTime(iso: string | null): string {
  if (!iso) return "";
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "";

  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}일`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatChatPreview(
  lastRole: string | null,
  lastContent: string | null,
  characterName: string
): string {
  if (!lastContent?.trim()) return "대화를 시작해 보세요";
  const text = lastContent.replace(/\s+/g, " ").trim();
  const trimmed = text.length > 42 ? `${text.slice(0, 42)}…` : text;
  if (lastRole === "user") return `나: ${trimmed}`;
  return `${characterName}: ${trimmed}`;
}

export function formatChatSessionStats(session: UserChatSession): string {
  const parts: string[] = [`${session.user_turn_count.toLocaleString()}턴`];
  return parts.join(" · ");
}

/** 동일 캐릭터의 채팅방이 여러 개일 때 시작일 라벨 */
export function chatSessionLabel(session: UserChatSession): string | null {
  if (session.character_session_count <= 1) return null;
  const d = new Date(
    session.chat_created_at.includes("T")
      ? session.chat_created_at
      : `${session.chat_created_at.replace(" ", "T")}Z`
  );
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
