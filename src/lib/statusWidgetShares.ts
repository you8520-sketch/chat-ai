import { getDb } from "@/lib/db";
import { generateShareSlug } from "@/lib/characterVisibility";
import { parseStatusWidgetJson, serializeStatusWidget } from "@/lib/statusWidget";
import {
  createStatusWidgetPreset,
  getStatusWidgetPresetById,
  sanitizeStatusWidgetPresetTitle,
  validateStatusWidgetPresetInput,
} from "@/lib/statusWidgetPresets";
import {
  parseStatusWidgetShareSort,
  parseStatusWidgetShareVisibility,
  readStatusWidgetShareVisibility,
  resolveIncomingStatusWidgetShareVisibility,
  type PublicStatusWidgetShareCard,
  type StatusWidgetShareSort,
  type StatusWidgetShareVisibility,
} from "@/lib/statusWidgetShareTypes";
import type { StatusWidget } from "@/lib/statusWidget/types";

export type {
  PublicStatusWidgetShareCard,
  StatusWidgetShareSort,
  StatusWidgetShareVisibility,
} from "@/lib/statusWidgetShareTypes";

export type StatusWidgetShareRow = {
  id: number;
  share_slug: string;
  user_id: number;
  title: string;
  widget_json: string;
  created_at: string;
  visibility: StatusWidgetShareVisibility;
};

export type StatusWidgetSharePublic = {
  shareSlug: string;
  title: string;
  widgetJson: string;
  authorNickname: string;
  authorUserId: number;
  createdAt: string;
  visibility: StatusWidgetShareVisibility;
};

type ShareWriteResult =
  | { share: StatusWidgetShareRow; applyPath: string }
  | { error: string; status: number };

export function statusWidgetShareApplyPath(slug: string): string {
  return `/widget/apply/${slug}`;
}

function canonicalShareWidgetJson(widgetJson: string): string | null {
  const parsed = parseStatusWidgetJson(widgetJson);
  if (!parsed) return null;
  return serializeStatusWidget(parsed);
}

function readShareRow(id: number): StatusWidgetShareRow {
  const row = getDb()
    .prepare(
      `SELECT id, share_slug, user_id, title, widget_json, created_at, visibility
       FROM status_widget_shares WHERE id=?`
    )
    .get(id) as Omit<StatusWidgetShareRow, "visibility"> & { visibility: unknown };
  return { ...row, visibility: readStatusWidgetShareVisibility(row.visibility) };
}

function insertShareWithUniqueSlug(
  userId: number,
  title: string,
  widgetJson: string,
  visibility: StatusWidgetShareVisibility
): StatusWidgetShareRow {
  const db = getDb();
  const stored = canonicalShareWidgetJson(widgetJson);
  if (!stored) throw new Error("상태창 데이터가 올바르지 않습니다.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const shareSlug = generateShareSlug();
    try {
      const info = db
        .prepare(
          `INSERT INTO status_widget_shares
             (share_slug, user_id, title, widget_json, visibility)
           VALUES (?,?,?,?,?)`
        )
        .run(shareSlug, userId, title, stored, visibility);
      return readShareRow(Number(info.lastInsertRowid));
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (!/UNIQUE|unique/i.test(msg)) throw e;
    }
  }
  throw new Error("공유 링크 생성에 실패했습니다.");
}

function visibilityFromInput(
  raw: unknown
): { ok: true; visibility: StatusWidgetShareVisibility } | { ok: false; error: string } {
  const visibility = resolveIncomingStatusWidgetShareVisibility(raw);
  if (!visibility) return { ok: false, error: "공개 범위가 올바르지 않습니다." };
  return { ok: true, visibility };
}

export function createStatusWidgetShareFromPreset(
  userId: number,
  presetId: number,
  visibilityInput?: unknown
): ShareWriteResult {
  const preset = getStatusWidgetPresetById(userId, presetId);
  if (!preset) return { error: "상태창을 찾을 수 없습니다.", status: 404 };
  const check = validateStatusWidgetPresetInput(preset.title, preset.widget_json);
  if (!check.ok) return { error: check.error, status: 400 };
  const visibility = visibilityFromInput(visibilityInput);
  if (!visibility.ok) return { error: visibility.error, status: 400 };
  const share = insertShareWithUniqueSlug(
    userId,
    preset.title,
    preset.widget_json,
    visibility.visibility
  );
  return { share, applyPath: statusWidgetShareApplyPath(share.share_slug) };
}

export function createStatusWidgetShareFromJson(
  userId: number,
  title: string,
  widgetJson: string,
  visibilityInput?: unknown
): ShareWriteResult {
  const trimmedTitle = sanitizeStatusWidgetPresetTitle(title);
  const check = validateStatusWidgetPresetInput(trimmedTitle, widgetJson);
  if (!check.ok) return { error: check.error, status: 400 };
  const visibility = visibilityFromInput(visibilityInput);
  if (!visibility.ok) return { error: visibility.error, status: 400 };
  const share = insertShareWithUniqueSlug(
    userId,
    trimmedTitle,
    widgetJson,
    visibility.visibility
  );
  return { share, applyPath: statusWidgetShareApplyPath(share.share_slug) };
}

export function getStatusWidgetShareBySlug(slug: string): StatusWidgetSharePublic | null {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare(
      `SELECT s.share_slug, s.user_id, s.title, s.widget_json, s.created_at, s.visibility,
              u.nickname AS author_nickname
       FROM status_widget_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.share_slug = ?`
    )
    .get(trimmed) as
    | {
        share_slug: string;
        user_id: number;
        title: string;
        widget_json: string;
        created_at: string;
        visibility: unknown;
        author_nickname: string;
      }
    | undefined;
  if (!row) return null;
  return {
    shareSlug: row.share_slug,
    title: row.title,
    widgetJson: row.widget_json,
    authorNickname: row.author_nickname,
    authorUserId: row.user_id,
    createdAt: row.created_at,
    visibility: readStatusWidgetShareVisibility(row.visibility),
  };
}

export function setStatusWidgetShareVisibility(
  userId: number,
  slug: string,
  visibilityInput: unknown
):
  | { ok: true; visibility: StatusWidgetShareVisibility }
  | { ok: false; error: string; status: number } {
  const visibility = parseStatusWidgetShareVisibility(visibilityInput);
  if (!visibility) {
    return { ok: false, error: "공개 범위가 올바르지 않습니다.", status: 400 };
  }
  const trimmed = slug.trim();
  const row = getDb()
    .prepare("SELECT id, user_id FROM status_widget_shares WHERE share_slug=?")
    .get(trimmed) as { id: number; user_id: number } | undefined;
  if (!row) return { ok: false, error: "공유 링크를 찾을 수 없습니다.", status: 404 };
  if (row.user_id !== userId) {
    return { ok: false, error: "이 공유의 공개 범위를 바꿀 수 없습니다.", status: 403 };
  }
  getDb()
    .prepare("UPDATE status_widget_shares SET visibility=? WHERE id=? AND user_id=?")
    .run(visibility, row.id, userId);
  return { ok: true, visibility };
}

function orderClause(sort: StatusWidgetShareSort): string {
  switch (sort) {
    case "popular":
      return "unique_import_count DESC, s.created_at DESC, s.id DESC";
    case "newest":
      return "s.created_at DESC, s.id DESC";
    default: {
      const _never: never = sort;
      return _never;
    }
  }
}

function publicWidget(widget: StatusWidget): StatusWidget {
  return {
    version: 1,
    name: widget.name,
    htmlTemplate: widget.htmlTemplate,
    fields: widget.fields,
    placement: widget.placement,
    ...(widget.jsxSource?.trim() ? { jsxSource: widget.jsxSource } : {}),
  };
}

export function listPublicStatusWidgetShares(
  sortInput?: unknown
): PublicStatusWidgetShareCard[] {
  const sort = parseStatusWidgetShareSort(sortInput);
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.share_slug, s.user_id, s.title, s.widget_json, s.created_at,
              u.nickname AS author_nickname,
              (SELECT COUNT(*) FROM status_widget_share_imports i WHERE i.share_id = s.id) AS unique_import_count
       FROM status_widget_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.visibility = 'public'
       ORDER BY ${orderClause(sort)}`
    )
    .all() as Array<{
    id: number;
    share_slug: string;
    user_id: number;
    title: string;
    widget_json: string;
    created_at: string;
    author_nickname: string;
    unique_import_count: number;
  }>;

  const cards: PublicStatusWidgetShareCard[] = [];
  for (const row of rows) {
    const widget = parseStatusWidgetJson(row.widget_json);
    if (!widget) continue;
    cards.push({
      id: row.id,
      shareSlug: row.share_slug,
      title: row.title,
      authorNickname: row.author_nickname,
      authorUserId: row.user_id,
      createdAt: row.created_at,
      uniqueImportCount: Number(row.unique_import_count) || 0,
      renderer: widget.jsxSource?.trim() ? "jsx" : "html",
      widget: publicWidget(widget),
    });
  }
  return cards;
}

export function importStatusWidgetShareToUserPresets(
  userId: number,
  slug: string,
  titleOverride?: string
): { ok: true; presetId: number } | { ok: false; error: string; status?: number } {
  const share = getStatusWidgetShareBySlug(slug);
  if (!share) return { ok: false, error: "공유 링크를 찾을 수 없습니다.", status: 404 };
  const shareRow = getDb()
    .prepare("SELECT id FROM status_widget_shares WHERE share_slug=?")
    .get(share.shareSlug) as { id: number } | undefined;
  if (!shareRow) return { ok: false, error: "공유 링크를 찾을 수 없습니다.", status: 404 };
  const title = sanitizeStatusWidgetPresetTitle(titleOverride?.trim() || share.title);
  const preset = createStatusWidgetPreset(userId, title, share.widgetJson);
  if (!preset) {
    return { ok: false, error: "내 위젯 보관함에 저장하지 못했습니다.", status: 400 };
  }
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO status_widget_share_imports (share_id, user_id) VALUES (?, ?)"
    )
    .run(shareRow.id, userId);
  return { ok: true, presetId: preset.id };
}
