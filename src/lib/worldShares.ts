import { getDb } from "@/lib/db";
import { generateShareSlug } from "@/lib/characterVisibility";
import {
  WORLD_CONTENT_LIMIT,
  WORLD_NAME_LIMIT,
  WORLD_SUMMARY_LIMIT,
  rowToWorldListItem,
  type WorldListItem,
  type WorldRow,
} from "@/lib/worlds";

export type WorldShareRow = {
  id: number;
  share_slug: string;
  user_id: number;
  world_id: number | null;
  name: string;
  summary: string;
  content: string;
  created_at: string;
};

export type WorldSharePublic = {
  shareSlug: string;
  name: string;
  summary: string;
  content: string;
  authorNickname: string;
  createdAt: string;
};

export function worldShareApplyPath(slug: string): string {
  return `/world/apply/${slug}`;
}

function loadOwnedWorld(userId: number, worldId: number): WorldRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, creator_id, name, summary, content, created_at, updated_at,
              COALESCE(shared_from_nickname, '') AS shared_from_nickname
       FROM worlds WHERE id = ? AND creator_id = ?`
    )
    .get(worldId, userId) as WorldRow | undefined;
}

function insertShareWithUniqueSlug(
  userId: number,
  worldId: number,
  name: string,
  summary: string,
  content: string
): WorldShareRow {
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const shareSlug = generateShareSlug();
    try {
      const info = db
        .prepare(
          `INSERT INTO world_shares (share_slug, user_id, world_id, name, summary, content)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(shareSlug, userId, worldId, name, summary, content);
      const row = db
        .prepare(
          `SELECT id, share_slug, user_id, world_id, name, summary, content, created_at
           FROM world_shares WHERE id = ?`
        )
        .get(Number(info.lastInsertRowid)) as WorldShareRow;
      return row;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (!/UNIQUE|unique/i.test(msg)) throw e;
    }
  }
  throw new Error("공유 링크 생성에 실패했습니다.");
}

export function createWorldShare(
  userId: number,
  worldId: number
): { share: WorldShareRow; applyPath: string } | { error: string } {
  const world = loadOwnedWorld(userId, worldId);
  if (!world) return { error: "세계관을 찾을 수 없습니다." };
  const share = insertShareWithUniqueSlug(
    userId,
    world.id,
    world.name,
    world.summary,
    world.content
  );
  return { share, applyPath: worldShareApplyPath(share.share_slug) };
}

export function getWorldShareBySlug(slug: string): WorldSharePublic | null {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare(
      `SELECT s.share_slug, s.name, s.summary, s.content, s.created_at,
              u.nickname AS author_nickname
       FROM world_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.share_slug = ?`
    )
    .get(trimmed) as
    | {
        share_slug: string;
        name: string;
        summary: string;
        content: string;
        created_at: string;
        author_nickname: string;
      }
    | undefined;
  if (!row) return null;
  return {
    shareSlug: row.share_slug,
    name: row.name,
    summary: row.summary,
    content: row.content,
    authorNickname: row.author_nickname,
    createdAt: row.created_at,
  };
}

export function importWorldShareToUser(
  userId: number,
  slug: string,
  nameOverride?: string
): { ok: true; world: WorldListItem } | { ok: false; error: string; status?: number } {
  const share = getWorldShareBySlug(slug);
  if (!share) return { ok: false, error: "공유 링크를 찾을 수 없습니다.", status: 404 };

  const name = String(nameOverride ?? share.name)
    .trim()
    .slice(0, WORLD_NAME_LIMIT);
  const summary = share.summary.trim().slice(0, WORLD_SUMMARY_LIMIT);
  const content = share.content.trim();

  if (!name) return { ok: false, error: "세계관 이름을 입력해 주세요.", status: 400 };
  if (!content) return { ok: false, error: "세계관 본문이 비어 있습니다.", status: 400 };
  if (content.length > WORLD_CONTENT_LIMIT) {
    return {
      ok: false,
      error: `세계관 본문은 ${WORLD_CONTENT_LIMIT.toLocaleString()}자 이하여야 합니다.`,
      status: 400,
    };
  }

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, shared_from_nickname, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(userId, name, summary, content, share.authorNickname);

  const id = Number(info.lastInsertRowid);
  const row = db
    .prepare(
      `SELECT id, creator_id, name, summary, content, created_at, updated_at,
              COALESCE(shared_from_nickname, '') AS shared_from_nickname
       FROM worlds WHERE id = ?`
    )
    .get(id) as WorldRow;

  return { ok: true, world: rowToWorldListItem(row) };
}
