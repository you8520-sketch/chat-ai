import { getDb } from "@/lib/db";
import {
  getWorldLibraryKind,
  getWorldShareAvailability,
  isLegacyBorrowedWorld,
  isWorldReadOnly,
  type WorldLibraryKind,
} from "@/lib/worldPermissions";
import {
  rowToWorldListItem,
  WORLD_SELECT_COLUMNS,
  type WorldListItem,
  type WorldRow,
} from "@/lib/worlds";

export type WorldBorrowRow = {
  id: number;
  user_id: number;
  world_share_id: number;
  created_at: string;
};

function borrowToListItem(row: {
  borrow_id: number;
  borrow_created_at: string;
  share_id: number;
  share_slug: string;
  name: string;
  summary: string;
  content: string;
  share_created_at: string;
  author_nickname: string;
  share_available: number;
}): WorldListItem {
  const available = row.share_available === 1;
  return {
    id: -row.borrow_id,
    name: row.name,
    summary: row.summary,
    content: row.content,
    createdAt: row.borrow_created_at,
    updatedAt: row.share_created_at,
    sharedFromNickname: row.author_nickname,
    trpgEnabled: false,
    trpgVisibility: "private",
    genres: [],
    coverUrl: "",
    libraryKind: "borrowed",
    readOnly: true,
    borrowId: row.borrow_id,
    shareId: row.share_id,
    shareSlug: row.share_slug,
    shareAvailable: available,
  };
}

function ownedRowToListItem(row: WorldRow): WorldListItem {
  const item = rowToWorldListItem(row);
  const kind = getWorldLibraryKind(row);
  return {
    ...item,
    libraryKind: kind,
    readOnly: isWorldReadOnly(row),
  };
}

export function loadUserWorldLibrary(userId: number): WorldListItem[] {
  const db = getDb();

  const owned = (
    db
      .prepare(
        `SELECT ${WORLD_SELECT_COLUMNS}
         FROM worlds WHERE creator_id = ? ORDER BY updated_at DESC, id DESC`
      )
      .all(userId) as WorldRow[]
  ).map(ownedRowToListItem);

  const borrowed = (
    db
      .prepare(
        `SELECT b.id AS borrow_id, b.created_at AS borrow_created_at,
                s.id AS share_id, s.share_slug, s.name, s.summary, s.content, s.created_at AS share_created_at,
                u.nickname AS author_nickname,
                CASE
                  WHEN s.revoked_at IS NOT NULL THEN 0
                  WHEN s.world_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM worlds w WHERE w.id = s.world_id) THEN 0
                  ELSE 1
                END AS share_available
         FROM world_borrows b
         JOIN world_shares s ON s.id = b.world_share_id
         JOIN users u ON u.id = s.user_id
         WHERE b.user_id = ?
         ORDER BY b.created_at DESC, b.id DESC`
      )
      .all(userId) as Array<{
      borrow_id: number;
      borrow_created_at: string;
      share_id: number;
      share_slug: string;
      name: string;
      summary: string;
      content: string;
      share_created_at: string;
      author_nickname: string;
      share_available: number;
    }>
  ).map(borrowToListItem);

  return [...owned, ...borrowed];
}

export function loadBorrowForUser(userId: number, borrowId: number): WorldListItem | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT b.id AS borrow_id, b.created_at AS borrow_created_at,
              s.id AS share_id, s.share_slug, s.name, s.summary, s.content, s.created_at AS share_created_at,
              u.nickname AS author_nickname,
              CASE
                WHEN s.revoked_at IS NOT NULL THEN 0
                WHEN s.world_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM worlds w WHERE w.id = s.world_id) THEN 0
                ELSE 1
              END AS share_available
       FROM world_borrows b
       JOIN world_shares s ON s.id = b.world_share_id
       JOIN users u ON u.id = s.user_id
       WHERE b.id = ? AND b.user_id = ?`
    )
    .get(borrowId, userId) as
    | {
        borrow_id: number;
        borrow_created_at: string;
        share_id: number;
        share_slug: string;
        name: string;
        summary: string;
        content: string;
        share_created_at: string;
        author_nickname: string;
        share_available: number;
      }
    | undefined;
  if (!row) return null;
  return borrowToListItem(row);
}

export function resolveWorldSelectionForUser(
  userId: number,
  opts: { worldId?: number | null; borrowId?: number | null; shareId?: number | null }
):
  | {
      ok: true;
      content: string;
      libraryKind: WorldLibraryKind;
      sourceWorldShareId: number | null;
      worldId: number | null;
    }
  | { ok: false; error: string } {
  const borrowId = opts.borrowId ?? null;
  const shareId = opts.shareId ?? null;
  const worldId = opts.worldId ?? null;

  if (borrowId != null && borrowId > 0) {
    const borrow = loadBorrowForUser(userId, borrowId);
    if (!borrow) return { ok: false, error: "선택한 빌린 세계관을 찾을 수 없습니다." };
    if (borrow.shareId == null) return { ok: false, error: "선택한 빌린 세계관을 찾을 수 없습니다." };
    const availability = getWorldShareAvailability(borrow.shareId);
    if (!availability.available) {
      return { ok: false, error: "더 이상 사용할 수 없는 공유 세계관입니다." };
    }
    return {
      ok: true,
      content: borrow.content,
      libraryKind: "borrowed",
      sourceWorldShareId: borrow.shareId,
      worldId: null,
    };
  }

  if (shareId != null && shareId > 0) {
    const availability = getWorldShareAvailability(shareId);
    if (!availability.available) {
      return { ok: false, error: "더 이상 사용할 수 없는 공유 세계관입니다." };
    }
    const db = getDb();
    const share = db
      .prepare(`SELECT id, content FROM world_shares WHERE id = ?`)
      .get(shareId) as { id: number; content: string } | undefined;
    if (!share) return { ok: false, error: "공유 세계관을 찾을 수 없습니다." };
    const borrowed = db
      .prepare(`SELECT id FROM world_borrows WHERE user_id = ? AND world_share_id = ?`)
      .get(userId, shareId) as { id: number } | undefined;
    if (!borrowed) return { ok: false, error: "라이브러리에 없는 공유 세계관입니다." };
    return {
      ok: true,
      content: share.content,
      libraryKind: "borrowed",
      sourceWorldShareId: share.id,
      worldId: null,
    };
  }

  if (worldId != null && worldId > 0) {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, creator_id, name, summary, content, created_at, updated_at,
                COALESCE(shared_from_nickname, '') AS shared_from_nickname
         FROM worlds WHERE id = ? AND creator_id = ?`
      )
      .get(worldId, userId) as WorldRow | undefined;
    if (!row) return { ok: false, error: "선택한 세계관을 찾을 수 없습니다." };
    return {
      ok: true,
      content: row.content,
      libraryKind: isLegacyBorrowedWorld(row) ? "legacy_borrowed" : "owned",
      sourceWorldShareId: null,
      worldId: row.id,
    };
  }

  return { ok: false, error: "세계관을 선택해 주세요." };
}
