/** Production 라이크 (real name 조태형) identity — do not look up by 조태형. */

export const PRODUCTION_LIKE_CHARACTER_ID = 18;
export const PRODUCTION_LIKE_DISPLAY_NAME = "라이크";
export const PRODUCTION_LIKE_REAL_NAME = "조태형";

export type LikeTaehyungIdentityRow = {
  id?: number | string | null;
  name?: string | null;
  description?: string | null;
  system_prompt?: string | null;
  world?: string | null;
  greeting?: string | null;
  example_dialog?: string | null;
  setting_chunks?: string | null;
  speech_profile?: string | null;
};

function settingBlob(row: LikeTaehyungIdentityRow): string {
  return [
    row.description,
    row.system_prompt,
    row.world,
    row.greeting,
    row.example_dialog,
    row.setting_chunks,
    row.speech_profile,
  ]
    .map((v) => String(v ?? ""))
    .join("\n");
}

export function isProductionLikeDisplayName(name: unknown): boolean {
  return String(name ?? "").trim() === PRODUCTION_LIKE_DISPLAY_NAME;
}

export function settingContainsRealName(row: LikeTaehyungIdentityRow): boolean {
  return settingBlob(row).includes(PRODUCTION_LIKE_REAL_NAME);
}

/** Registered name 라이크 + setting real name 조태형. */
export function isProductionLikeTaehyungRecord(row: LikeTaehyungIdentityRow | null | undefined): boolean {
  if (!row) return false;
  return isProductionLikeDisplayName(row.name) && settingContainsRealName(row);
}

export function preferKnownLikeId(rows: LikeTaehyungIdentityRow[]): LikeTaehyungIdentityRow | null {
  const verified = rows.filter(isProductionLikeTaehyungRecord);
  if (verified.length === 0) return null;
  const known = verified.find((row) => Number(row.id) === PRODUCTION_LIKE_CHARACTER_ID);
  return known ?? (verified.length === 1 ? verified[0] : null);
}
