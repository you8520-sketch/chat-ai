import { getDb } from "@/lib/db";
import { generateShareSlug } from "@/lib/characterVisibility";
import {
  assertWorldShareAvailable,
  canEditWorld,
  canShareWorld,
  loadOwnedWorldRow,
} from "@/lib/worldPermissions";
import { loadBorrowForUser } from "@/lib/worldLibrary";
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
  revoked_at?: string | null;
};

export type WorldBorrowRow = {
  id: number;
  user_id: number;
  world_share_id: number;
  created_at: string;
};

export type WorldSharePublic = {
  shareSlug: string;
  name: string;
  summary: string;
  content: string;
  authorNickname: string;
  createdAt: string;
  available: boolean;
};

export type WorldBorrowResult = {
  ok: true;
  borrow: WorldBorrowRow;
  world: WorldListItem;
  alreadyInLibrary: boolean;
};

export function worldShareApplyPath(slug: string): string {
  return `/world/apply/${slug}`;
}

function loadOwnedWorld(userId: number, worldId: number): WorldRow | undefined {
  return loadOwnedWorldRow(userId, worldId);
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
          `SELECT id, share_slug, user_id, world_id, name, summary, content, created_at, revoked_at
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
  if (!canShareWorld(userId, worldId)) {
    return { error: "세계관을 찾을 수 없거나 공유할 수 없습니다." };
  }
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

function shareAvailabilitySql(alias = "s"): string {
  return `CASE
    WHEN ${alias}.revoked_at IS NOT NULL THEN 0
    WHEN ${alias}.world_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM worlds w WHERE w.id = ${alias}.world_id) THEN 0
    ELSE 1
  END`;
}

export function getWorldShareBySlug(slug: string): WorldSharePublic | null {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare(
      `SELECT s.share_slug, s.name, s.summary, s.content, s.created_at,
              u.nickname AS author_nickname,
              ${shareAvailabilitySql("s")} AS share_available
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
        share_available: number;
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
    available: row.share_available === 1,
  };
}

function loadShareRowBySlug(slug: string): (WorldShareRow & { author_nickname: string }) | null {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id, s.share_slug, s.user_id, s.world_id, s.name, s.summary, s.content, s.created_at, s.revoked_at,
              u.nickname AS author_nickname
       FROM world_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.share_slug = ?`
    )
    .get(trimmed) as (WorldShareRow & { author_nickname: string }) | undefined;
  return row ?? null;
}

export function borrowWorldShareToUser(
  userId: number,
  slug: string
): WorldBorrowResult | { ok: false; error: string; status?: number } {
  const share = loadShareRowBySlug(slug);
  if (!share) return { ok: false, error: "공유 링크를 찾을 수 없습니다.", status: 404 };

  const availability = assertWorldShareAvailable(share.id);
  if (!availability.available) {
    const message =
      availability.reason === "revoked"
        ? "공유가 취소된 세계관입니다."
        : availability.reason === "source_deleted"
          ? "원본 세계관이 삭제되어 더 이상 추가할 수 없습니다."
          : "공유 링크를 찾을 수 없습니다.";
    return { ok: false, error: message, status: 404 };
  }

  const content = share.content.trim();
  if (!content) return { ok: false, error: "세계관 본문이 비어 있습니다.", status: 400 };
  if (content.length > WORLD_CONTENT_LIMIT) {
    return {
      ok: false,
      error: `세계관 본문은 ${WORLD_CONTENT_LIMIT.toLocaleString()}자 이하여야 합니다.`,
      status: 400,
    };
  }

  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM world_borrows WHERE user_id = ? AND world_share_id = ?`)
    .get(userId, share.id) as { id: number } | undefined;

  if (existing) {
    const world = loadBorrowForUser(userId, existing.id);
    if (!world) return { ok: false, error: "빌린 세계관을 찾을 수 없습니다.", status: 404 };
    return {
      ok: true,
      borrow: {
        id: existing.id,
        user_id: userId,
        world_share_id: share.id,
        created_at: world.createdAt,
      },
      world,
      alreadyInLibrary: true,
    };
  }

  const info = db
    .prepare(`INSERT INTO world_borrows (user_id, world_share_id) VALUES (?, ?)`)
    .run(userId, share.id);
  const borrowId = Number(info.lastInsertRowid);
  const world = loadBorrowForUser(userId, borrowId);
  if (!world) return { ok: false, error: "빌린 세계관을 찾을 수 없습니다.", status: 500 };

  return {
    ok: true,
    borrow: {
      id: borrowId,
      user_id: userId,
      world_share_id: share.id,
      created_at: world.createdAt,
    },
    world,
    alreadyInLibrary: false,
  };
}

/** @deprecated PR-1: creates editable copy — use borrowWorldShareToUser instead */
export function importWorldShareToUser(
  userId: number,
  slug: string,
  _nameOverride?: string
): { ok: true; world: WorldListItem } | { ok: false; error: string; status?: number } {
  const result = borrowWorldShareToUser(userId, slug);
  if (!result.ok) return result;
  return { ok: true, world: result.world };
}

export function removeWorldBorrow(userId: number, borrowId: number): { ok: true } | { ok: false; error: string } {
  const db = getDb();
  const info = db
    .prepare(`DELETE FROM world_borrows WHERE id = ? AND user_id = ?`)
    .run(borrowId, userId);
  if (info.changes === 0) return { ok: false, error: "빌린 세계관을 찾을 수 없습니다." };
  return { ok: true };
}

export function revokeWorldShare(
  userId: number,
  slug: string
): { ok: true } | { ok: false; error: string } {
  const share = loadShareRowBySlug(slug);
  if (!share) return { ok: false, error: "공유 링크를 찾을 수 없습니다." };
  if (share.user_id !== userId) return { ok: false, error: "공유를 취소할 권한이 없습니다." };
  if (share.revoked_at) return { ok: true };
  getDb()
    .prepare(`UPDATE world_shares SET revoked_at = datetime('now') WHERE id = ?`)
    .run(share.id);
  return { ok: true };
}

export function revokeWorldSharesForDeletedWorld(worldId: number): void {
  getDb()
    .prepare(
      `UPDATE world_shares
       SET revoked_at = COALESCE(revoked_at, datetime('now'))
       WHERE world_id = ? AND revoked_at IS NULL`
    )
    .run(worldId);
}

export { canEditWorld, canShareWorld };
