import type Database from "better-sqlite3";

export type UserNotificationType =
  | "creator_character"
  | "gift_sent"
  | "gift_received"
  | "payment_success"
  | "payment_cancel"
  | "follow_received"
  | "admin_point_grant";

export type UserNotificationRow = {
  id: number;
  user_id: number;
  type: UserNotificationType;
  ref_id: number;
  actor_id: number | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  emoji: string | null;
  hue: number | null;
  character_name: string | null;
  actor_nickname: string | null;
};

export type NoticeRow = {
  id: number;
  title: string;
  content: string;
  author_name: string;
  created_at: string;
};

function insertNotification(
  db: Database.Database,
  input: {
    userId: number;
    type: UserNotificationType;
    refId: number;
    actorId?: number | null;
    title: string;
    body: string;
  }
) {
  db.prepare(
    `INSERT INTO user_notifications (user_id, type, ref_id, actor_id, title, body)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.userId,
    input.type,
    input.refId,
    input.actorId ?? null,
    input.title,
    input.body
  );
}

export function getUnreadUserNotificationCount(db: Database.Database, userId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM user_notifications WHERE user_id=? AND read_at IS NULL")
    .get(userId) as { c: number };
  return row.c;
}

/** @deprecated use getUnreadUserNotificationCount */
export function getUnreadCreatorNotificationCount(db: Database.Database, userId: number): number {
  return getUnreadUserNotificationCount(db, userId);
}

const USER_NOTIFICATION_SELECT = `
  SELECT n.id, n.user_id, n.type, n.ref_id, n.actor_id, n.title, n.body, n.created_at, n.read_at,
         c.emoji, c.hue, c.name AS character_name, u.nickname AS actor_nickname
  FROM user_notifications n
  LEFT JOIN characters c ON n.type = 'creator_character' AND c.id = n.ref_id
  LEFT JOIN users u ON u.id = n.actor_id`;

export function listUserNotifications(
  db: Database.Database,
  userId: number,
  limit = 50
): UserNotificationRow[] {
  return db
    .prepare(
      `${USER_NOTIFICATION_SELECT}
       WHERE n.user_id = ? AND n.read_at IS NULL
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as UserNotificationRow[];
}

/** 알림 페이지 — 읽음 포함 최근 활동 */
export function listRecentUserNotifications(
  db: Database.Database,
  userId: number,
  limit = 50
): UserNotificationRow[] {
  return db
    .prepare(
      `${USER_NOTIFICATION_SELECT}
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as UserNotificationRow[];
}

/** @deprecated use listUserNotifications */
export function listCreatorNotifications(
  db: Database.Database,
  userId: number,
  limit = 50
): UserNotificationRow[] {
  return listUserNotifications(db, userId, limit);
}

export function listUnreadNotices(
  db: Database.Database,
  readId: number,
  limit = 50
): NoticeRow[] {
  return db
    .prepare(
      `SELECT id, title, content, author_name, created_at
       FROM posts WHERE board='notice' AND id > ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(readId, limit) as NoticeRow[];
}

/** 알림 페이지 — 읽음 포함 최근 공지 */
export function listRecentNotices(db: Database.Database, limit = 20): NoticeRow[] {
  return db
    .prepare(
      `SELECT id, title, content, author_name, created_at
       FROM posts WHERE board='notice'
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as NoticeRow[];
}

export function getTotalUnreadCount(
  db: Database.Database,
  userId: number | null,
  noticeReadId: number
): number {
  const noticeRow = db
    .prepare("SELECT COUNT(*) AS c FROM posts WHERE board='notice' AND id > ?")
    .get(noticeReadId) as { c: number };
  const activityCount = userId ? getUnreadUserNotificationCount(db, userId) : 0;
  return noticeRow.c + activityCount;
}

export function markUserNotificationsRead(db: Database.Database, userId: number) {
  db.prepare(
    "UPDATE user_notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL"
  ).run(userId);
}

/** @deprecated use markUserNotificationsRead */
export function markCreatorNotificationsRead(db: Database.Database, userId: number) {
  markUserNotificationsRead(db, userId);
}

export function notificationHref(n: UserNotificationRow): string {
  switch (n.type) {
    case "creator_character":
      return `/character/${n.ref_id}`;
    case "follow_received":
      return n.actor_id ? `/creator/${n.actor_id}` : "/tab/following";
    case "gift_sent":
    case "gift_received":
    case "payment_success":
    case "payment_cancel":
    case "admin_point_grant":
      return "/points";
    default:
      return "/notifications";
  }
}

export function notificationIcon(type: UserNotificationType): string {
  switch (type) {
    case "creator_character":
      return "✨";
    case "gift_sent":
      return "🎁";
    case "gift_received":
      return "💝";
    case "payment_success":
      return "✅";
    case "payment_cancel":
      return "↩️";
    case "admin_point_grant":
      return "🎉";
    case "follow_received":
      return "👤";
    default:
      return "🔔";
  }
}

export function notifyFollowersOfNewCharacter(
  db: Database.Database,
  creatorId: number,
  creatorName: string,
  characterId: number,
  characterName: string
) {
  const exists = db
    .prepare(
      "SELECT 1 FROM user_notifications WHERE type='creator_character' AND ref_id=? LIMIT 1"
    )
    .get(characterId);
  if (exists) return;

  const followers = db
    .prepare("SELECT user_id FROM follows WHERE creator_id=? AND user_id != ?")
    .all(creatorId, creatorId) as { user_id: number }[];

  const title = `${creatorName}님의 신작`;
  const body = `「${characterName}」 캐릭터가 공개되었습니다.`;

  for (const f of followers) {
    insertNotification(db, {
      userId: f.user_id,
      type: "creator_character",
      refId: characterId,
      actorId: creatorId,
      title,
      body,
    });
  }
}

export function notifyGiftSent(
  db: Database.Database,
  senderId: number,
  giftId: number,
  recipientId: number,
  recipientNickname: string,
  grossAmount: number
) {
  insertNotification(db, {
    userId: senderId,
    type: "gift_sent",
    refId: giftId,
    actorId: recipientId,
    title: "포인트 선물 완료",
    body: `@${recipientNickname}님에게 ${grossAmount.toLocaleString()}P를 선물했습니다.`,
  });
}

export function notifyGiftReceived(
  db: Database.Database,
  recipientId: number,
  giftId: number,
  senderId: number,
  senderNickname: string,
  netAmount: number
) {
  insertNotification(db, {
    userId: recipientId,
    type: "gift_received",
    refId: giftId,
    actorId: senderId,
    title: "포인트 선물 도착",
    body: `@${senderNickname}님이 ${netAmount.toLocaleString()}P를 선물했습니다.`,
  });
}

export function notifyPaymentSuccess(
  db: Database.Database,
  userId: number,
  refId: number,
  title: string,
  body: string
) {
  insertNotification(db, {
    userId,
    type: "payment_success",
    refId,
    title,
    body,
  });
}

export function notifyPaymentCancel(
  db: Database.Database,
  userId: number,
  refId: number,
  title: string,
  body: string
) {
  insertNotification(db, {
    userId,
    type: "payment_cancel",
    refId,
    title,
    body,
  });
}

export function notifyFollowReceived(
  db: Database.Database,
  creatorId: number,
  followerId: number,
  followerNickname: string
) {
  if (creatorId === followerId) return;
  insertNotification(db, {
    userId: creatorId,
    type: "follow_received",
    refId: followerId,
    actorId: followerId,
    title: "새 팔로워",
    body: `@${followerNickname}님이 팔로우했습니다.`,
  });
}

export function notifyAdminPointGrant(
  db: Database.Database,
  recipientId: number,
  logId: number,
  adminId: number,
  amount: number,
  note?: string
) {
  const trimmedNote = note?.trim();
  const body = trimmedNote
    ? `무료 포인트 ${amount.toLocaleString()}P가 지급되었습니다. (${trimmedNote})`
    : `무료 포인트 ${amount.toLocaleString()}P가 지급되었습니다.`;

  insertNotification(db, {
    userId: recipientId,
    type: "admin_point_grant",
    refId: logId,
    actorId: adminId,
    title: "무료 포인트 지급",
    body,
  });
}
