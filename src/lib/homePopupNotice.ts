import type Database from "better-sqlite3";

export type HomePopupNotice = {
  id: number;
  enabled: number;
  title: string;
  content: string;
  background_color: string;
  image_url: string;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

export type HomePopupNoticeInput = {
  enabled?: boolean;
  title?: string;
  content?: string;
  backgroundColor?: string;
  imageUrl?: string;
  startsAt?: string | null;
  endsAt?: string | null;
};

const TITLE_MAX = 80;
const CONTENT_MAX = 600;
const URL_MAX = 500;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeDateTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace("T", " ").slice(0, 16);
}

export function normalizeHomePopupNoticeInput(input: HomePopupNoticeInput) {
  const title = (input.title ?? "").trim().slice(0, TITLE_MAX);
  const content = (input.content ?? "").trim().slice(0, CONTENT_MAX);
  const backgroundColor = COLOR_RE.test(input.backgroundColor ?? "")
    ? input.backgroundColor!
    : "#21183a";
  const imageUrl = (input.imageUrl ?? "").trim().slice(0, URL_MAX);
  const startsAt = normalizeDateTime(input.startsAt);
  const endsAt = normalizeDateTime(input.endsAt);

  return {
    enabled: input.enabled === false ? 0 : 1,
    title,
    content,
    backgroundColor,
    imageUrl,
    startsAt,
    endsAt,
  };
}

export function getHomePopupNotice(db: Database.Database): HomePopupNotice | null {
  return (
    (db
      .prepare(
        `SELECT id, enabled, title, content, background_color, image_url, starts_at, ends_at, updated_at
         FROM home_popup_notices
         WHERE id = 1`
      )
      .get() as HomePopupNotice | undefined) ?? null
  );
}

export function getActiveHomePopupNotice(db: Database.Database): HomePopupNotice | null {
  return (
    (db
      .prepare(
        `SELECT id, enabled, title, content, background_color, image_url, starts_at, ends_at, updated_at
         FROM home_popup_notices
         WHERE id = 1
           AND enabled = 1
           AND TRIM(content) <> ''
           AND (starts_at IS NULL OR starts_at <= datetime('now'))
           AND (ends_at IS NULL OR ends_at >= datetime('now'))`
      )
      .get() as HomePopupNotice | undefined) ?? null
  );
}

export function saveHomePopupNotice(
  db: Database.Database,
  input: HomePopupNoticeInput,
  adminId: number
): HomePopupNotice {
  const next = normalizeHomePopupNoticeInput(input);
  db.prepare(
    `INSERT INTO home_popup_notices (
       id, enabled, title, content, background_color, image_url, starts_at, ends_at, updated_by, updated_at
     ) VALUES (
       1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
     )
     ON CONFLICT(id) DO UPDATE SET
       enabled=excluded.enabled,
       title=excluded.title,
       content=excluded.content,
       background_color=excluded.background_color,
       image_url=excluded.image_url,
       starts_at=excluded.starts_at,
       ends_at=excluded.ends_at,
       updated_by=excluded.updated_by,
       updated_at=datetime('now')`
  ).run(
    next.enabled,
    next.title,
    next.content,
    next.backgroundColor,
    next.imageUrl,
    next.startsAt,
    next.endsAt,
    adminId
  );

  return getHomePopupNotice(db)!;
}
