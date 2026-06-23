import { getDb } from "@/lib/db";
import { generateShareSlug } from "@/lib/characterVisibility";
import {
  createStatusWidgetPreset,
  getStatusWidgetPresetById,
  sanitizeStatusWidgetPresetTitle,
  validateStatusWidgetPresetInput,
} from "@/lib/statusWidgetPresets";

export type StatusWidgetShareRow = {
  id: number;
  share_slug: string;
  user_id: number;
  title: string;
  widget_json: string;
  created_at: string;
};

export type StatusWidgetSharePublic = {
  shareSlug: string;
  title: string;
  widgetJson: string;
  authorNickname: string;
  createdAt: string;
};

export function statusWidgetShareApplyPath(slug: string): string {
  return `/widget/apply/${slug}`;
}

function insertShareWithUniqueSlug(
  userId: number,
  title: string,
  widgetJson: string
): StatusWidgetShareRow {
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const shareSlug = generateShareSlug();
    try {
      const info = db
        .prepare(
          "INSERT INTO status_widget_shares (share_slug, user_id, title, widget_json) VALUES (?,?,?,?)"
        )
        .run(shareSlug, userId, title, widgetJson);
      const row = db
        .prepare(
          "SELECT id, share_slug, user_id, title, widget_json, created_at FROM status_widget_shares WHERE id=?"
        )
        .get(Number(info.lastInsertRowid)) as StatusWidgetShareRow;
      return row;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (!/UNIQUE|unique/i.test(msg)) throw e;
    }
  }
  throw new Error("공유 링크 생성에 실패했습니다.");
}

export function createStatusWidgetShareFromPreset(
  userId: number,
  presetId: number
): { share: StatusWidgetShareRow; applyPath: string } | { error: string } {
  const preset = getStatusWidgetPresetById(userId, presetId);
  if (!preset) return { error: "상태창을 찾을 수 없습니다." };
  const check = validateStatusWidgetPresetInput(preset.title, preset.widget_json);
  if (!check.ok) return { error: check.error };
  const share = insertShareWithUniqueSlug(userId, preset.title, preset.widget_json);
  return { share, applyPath: statusWidgetShareApplyPath(share.share_slug) };
}

export function createStatusWidgetShareFromJson(
  userId: number,
  title: string,
  widgetJson: string
): { share: StatusWidgetShareRow; applyPath: string } | { error: string } {
  const trimmedTitle = sanitizeStatusWidgetPresetTitle(title);
  const check = validateStatusWidgetPresetInput(trimmedTitle, widgetJson);
  if (!check.ok) return { error: check.error };
  const share = insertShareWithUniqueSlug(userId, trimmedTitle, widgetJson);
  return { share, applyPath: statusWidgetShareApplyPath(share.share_slug) };
}

export function getStatusWidgetShareBySlug(slug: string): StatusWidgetSharePublic | null {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare(
      `SELECT s.share_slug, s.title, s.widget_json, s.created_at, u.nickname AS author_nickname
       FROM status_widget_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.share_slug = ?`
    )
    .get(trimmed) as
    | {
        share_slug: string;
        title: string;
        widget_json: string;
        created_at: string;
        author_nickname: string;
      }
    | undefined;
  if (!row) return null;
  return {
    shareSlug: row.share_slug,
    title: row.title,
    widgetJson: row.widget_json,
    authorNickname: row.author_nickname,
    createdAt: row.created_at,
  };
}

export function importStatusWidgetShareToUserPresets(
  userId: number,
  slug: string,
  titleOverride?: string
): { ok: true; presetId: number } | { ok: false; error: string; status?: number } {
  const share = getStatusWidgetShareBySlug(slug);
  if (!share) return { ok: false, error: "공유 링크를 찾을 수 없습니다.", status: 404 };
  const title = sanitizeStatusWidgetPresetTitle(titleOverride?.trim() || share.title);
  const preset = createStatusWidgetPreset(userId, title, share.widgetJson);
  if (!preset) {
    return { ok: false, error: "내 위젯 보관함에 저장하지 못했습니다.", status: 400 };
  }
  return { ok: true, presetId: preset.id };
}
