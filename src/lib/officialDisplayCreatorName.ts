/**
 * Public displayed creator alias for official characters.
 *
 * Internal ownership stays on the site-managed official account.
 * This field is presentation-only (`characters.creator_name`) and is never
 * a login identity, payout beneficiary, or new user row.
 */

export const LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME = "로맨스 공식계정";
export const LUCIAN_CANONICAL_NAME = "루시안 바스케스";

export const OFFICIAL_DISPLAY_CREATOR_NAME_MIN = 2;
export const OFFICIAL_DISPLAY_CREATOR_NAME_MAX = 24;

const CLIENT_ALIAS_KEYS = [
  "creator_name",
  "creatorName",
  "display_creator_name",
  "displayCreatorName",
  "public_creator_name",
  "publicCreatorName",
] as const;

export function rejectClientOfficialDisplayCreatorAssignment(body: Record<string, unknown>): void {
  for (const key of CLIENT_ALIAS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new Error("공개 제작자명은 관리자만 설정할 수 있습니다.");
    }
  }
}

export function takeOfficialDisplayCreatorName(body: Record<string, unknown>): {
  rest: Record<string, unknown>;
  displayCreatorName: string | undefined;
} {
  const rest = { ...body };
  let raw: unknown;
  for (const key of CLIENT_ALIAS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rest, key)) {
      if (raw == null) raw = rest[key];
      delete rest[key];
    }
  }
  if (raw == null) return { rest, displayCreatorName: undefined };
  return { rest, displayCreatorName: String(raw) };
}

export function normalizeOfficialDisplayCreatorName(raw: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "공개 제작자명은 텍스트여야 합니다." };
  }
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < OFFICIAL_DISPLAY_CREATOR_NAME_MIN) {
    return { ok: false, error: `공개 제작자명은 ${OFFICIAL_DISPLAY_CREATOR_NAME_MIN}자 이상이어야 합니다.` };
  }
  if (value.length > OFFICIAL_DISPLAY_CREATOR_NAME_MAX) {
    return { ok: false, error: `공개 제작자명은 ${OFFICIAL_DISPLAY_CREATOR_NAME_MAX}자 이하여야 합니다.` };
  }
  if (/[\r\n\t]/.test(raw)) {
    return { ok: false, error: "공개 제작자명에 줄바꿈을 넣을 수 없습니다." };
  }
  if (/https?:\/\//i.test(value) || /<[^>]+>/.test(value)) {
    return { ok: false, error: "공개 제작자명에 링크나 태그를 넣을 수 없습니다." };
  }
  return { ok: true, value };
}

export function defaultOfficialDisplayCreatorName(characterName: string): string | null {
  return characterName.trim() === LUCIAN_CANONICAL_NAME ? LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME : null;
}
