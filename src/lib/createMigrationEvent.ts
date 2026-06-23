import type Database from "better-sqlite3";
import { creditPoints } from "@/lib/points";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";
import {
  applicationStatusLabel,
  type CreateMigrationApplicationStatus,
} from "@/lib/createMigrationEventShared";

export type { CreateMigrationApplicationStatus };
export { applicationStatusLabel };

export type CreateMigrationEligibleCharacter = {
  id: number;
  name: string;
  tagline: string;
  emoji: string;
  hue: number;
  images: string;
  visibility: string;
  moderation_status: string;
  created_at: string;
};

export type CreateMigrationApplicationRow = {
  id: number;
  user_id: number;
  character_id: number;
  status: CreateMigrationApplicationStatus;
  admin_note: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  character_name: string;
  user_nickname: string;
  user_email: string;
};

const ELIGIBLE_WHERE = `
  c.creator_id = ?
  AND c.official = 0
  AND c.visibility = 'public'
`;

export function listEligibleCharacters(
  db: Database.Database,
  userId: number
): CreateMigrationEligibleCharacter[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.tagline, c.emoji, c.hue, c.images, c.visibility, c.moderation_status, c.created_at
       FROM characters c
       WHERE ${ELIGIBLE_WHERE}
       ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(userId) as CreateMigrationEligibleCharacter[];
}

export function getApplicationByCharacterId(
  db: Database.Database,
  characterId: number
): CreateMigrationApplicationRow | null {
  return (
    (db
      .prepare(
        `SELECT a.id, a.user_id, a.character_id, a.status, a.admin_note, a.reviewed_by, a.reviewed_at, a.created_at,
                c.name AS character_name, u.nickname AS user_nickname, u.email AS user_email
         FROM create_migration_event_applications a
         JOIN characters c ON c.id = a.character_id
         JOIN users u ON u.id = a.user_id
         WHERE a.character_id = ?`
      )
      .get(characterId) as CreateMigrationApplicationRow | undefined) ?? null
  );
}

export function listApplicationsForUser(
  db: Database.Database,
  userId: number
): CreateMigrationApplicationRow[] {
  return db
    .prepare(
      `SELECT a.id, a.user_id, a.character_id, a.status, a.admin_note, a.reviewed_by, a.reviewed_at, a.created_at,
              c.name AS character_name, u.nickname AS user_nickname, u.email AS user_email
       FROM create_migration_event_applications a
       JOIN characters c ON c.id = a.character_id
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(userId) as CreateMigrationApplicationRow[];
}

export function submitCreateMigrationApplication(
  db: Database.Database,
  userId: number,
  characterId: number
): { ok: true; applicationId: number } | { ok: false; error: string; status?: number } {
  const character = db
    .prepare(
      `SELECT id, name, creator_id, official, visibility
       FROM characters WHERE id = ?`
    )
    .get(characterId) as
    | { id: number; name: string; creator_id: number | null; official: number; visibility: string }
    | undefined;

  if (!character) return { ok: false, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  if (character.creator_id !== userId) {
    return { ok: false, error: "본인이 제작한 캐릭터만 신청할 수 있습니다.", status: 403 };
  }
  if (character.official === 1) {
    return { ok: false, error: "공식 캐릭터는 이벤트 대상이 아닙니다.", status: 400 };
  }
  if (character.visibility !== "public") {
    return { ok: false, error: "공개로 저장된 캐릭터만 신청할 수 있습니다.", status: 400 };
  }

  const existing = db
    .prepare("SELECT id, status FROM create_migration_event_applications WHERE character_id = ?")
    .get(characterId) as { id: number; status: CreateMigrationApplicationStatus } | undefined;
  if (existing) {
    if (existing.status === "pending") {
      return { ok: false, error: "이미 신청한 캐릭터입니다. 검토 중입니다.", status: 409 };
    }
    if (existing.status === "approved") {
      return { ok: false, error: "이미 승인·지급 완료된 캐릭터입니다.", status: 409 };
    }
    return { ok: false, error: "이미 신청 이력이 있는 캐릭터입니다.", status: 409 };
  }

  const info = db
    .prepare(
      `INSERT INTO create_migration_event_applications (user_id, character_id)
       VALUES (?, ?)`
    )
    .run(userId, characterId);

  return { ok: true, applicationId: Number(info.lastInsertRowid) };
}

export function listApplicationsForAdmin(
  db: Database.Database,
  status?: CreateMigrationApplicationStatus | "all"
): CreateMigrationApplicationRow[] {
  const filter = status && status !== "all" ? "WHERE a.status = ?" : "";
  const params = status && status !== "all" ? [status] : [];
  return db
    .prepare(
      `SELECT a.id, a.user_id, a.character_id, a.status, a.admin_note, a.reviewed_by, a.reviewed_at, a.created_at,
              c.name AS character_name, u.nickname AS user_nickname, u.email AS user_email
       FROM create_migration_event_applications a
       JOIN characters c ON c.id = a.character_id
       JOIN users u ON u.id = a.user_id
       ${filter}
       ORDER BY
         CASE a.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
         a.created_at DESC`
    )
    .all(...params) as CreateMigrationApplicationRow[];
}

export function reviewCreateMigrationApplication(
  db: Database.Database,
  applicationId: number,
  adminId: number,
  action: "approve" | "reject",
  adminNote = ""
): { ok: true } | { ok: false; error: string; status?: number } {
  const app = db
    .prepare(
      `SELECT a.id, a.user_id, a.character_id, a.status, c.name AS character_name
       FROM create_migration_event_applications a
       JOIN characters c ON c.id = a.character_id
       WHERE a.id = ?`
    )
    .get(applicationId) as
    | {
        id: number;
        user_id: number;
        character_id: number;
        status: CreateMigrationApplicationStatus;
        character_name: string;
      }
    | undefined;

  if (!app) return { ok: false, error: "신청을 찾을 수 없습니다.", status: 404 };
  if (app.status !== "pending") {
    return { ok: false, error: "이미 처리된 신청입니다.", status: 409 };
  }

  if (action === "reject") {
    db.prepare(
      `UPDATE create_migration_event_applications
       SET status='rejected', admin_note=?, reviewed_by=?, reviewed_at=datetime('now')
       WHERE id=?`
    ).run(adminNote.trim(), adminId, applicationId);
    return { ok: true };
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE create_migration_event_applications
       SET status='approved', admin_note=?, reviewed_by=?, reviewed_at=datetime('now')
       WHERE id=?`
    ).run(adminNote.trim(), adminId, applicationId);
    creditPoints(
      app.user_id,
      CREATE_MIGRATION_EVENT_REWARD,
      "FREE",
      `캐릭터 제작·이식 이벤트 — ${app.character_name}`
    );
  })();

  return { ok: true };
}

