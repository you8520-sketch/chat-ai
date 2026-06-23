import crypto from "crypto";

export type CharacterVisibility = "public" | "link" | "private";
export type ModerationStatus = "pending" | "approved" | "rejected";

/** 목록(신작·랭킹 등)에 노출 가능한 유저 제작 캐릭터 조건 */
export const LISTABLE_USER_CHAR = "visibility='public' AND moderation_status='approved'";

/** 공식 캐릭터 또는 검수 통과 공개 캐릭터 */
export function listableWhere(extra = "1=1"): string {
  return `(official=1 OR (${LISTABLE_USER_CHAR} AND creator_id IS NOT NULL)) AND (${extra})`;
}

export function parseVisibility(v: unknown): CharacterVisibility {
  if (v === "public" || v === "link" || v === "private") return v;
  return "private";
}

export function generateShareSlug(): string {
  return crypto.randomBytes(6).toString("base64url");
}

export type CharacterAccessRow = {
  id: number;
  creator_id: number | null;
  visibility: CharacterVisibility;
  moderation_status: ModerationStatus;
  share_slug: string | null;
  official?: number;
};

/** 캐릭터 상세·채팅 접근 가능 여부 */
export function canAccessCharacter(
  c: CharacterAccessRow,
  viewerUserId: number | null | undefined
): { ok: true } | { ok: false; reason: string } {
  if (c.official === 1) return { ok: true };
  if (c.visibility === "public" && c.moderation_status === "approved") return { ok: true };
  if (c.visibility === "link" && c.moderation_status === "approved") return { ok: true };
  if (viewerUserId != null && c.creator_id === viewerUserId) return { ok: true };
  if (c.visibility === "private") {
    return { ok: false, reason: "비공개 캐릭터입니다. 제작자만 열람할 수 있습니다." };
  }
  if (c.moderation_status === "rejected") {
    return { ok: false, reason: "검수에 반려되어 비공개 처리된 캐릭터입니다." };
  }
  return { ok: false, reason: "아직 공개되지 않은 캐릭터입니다." };
}

export function sharePath(c: { id: number; share_slug?: string | null }): string {
  if (c.share_slug) return `/c/${c.share_slug}`;
  return `/character/${c.id}`;
}

export function visibilityLabel(v: CharacterVisibility): string {
  if (v === "public") return "공개";
  if (v === "link") return "링크 공개";
  return "비공개";
}

export function moderationLabel(s: ModerationStatus): string {
  if (s === "approved") return "검수 통과";
  if (s === "rejected") return "검수 반려";
  return "검수 대기";
}
