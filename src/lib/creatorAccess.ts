import { getDb } from "./db";

/** 유저가 제작한 캐릭터(비공식)가 1개 이상인지 */
export function userHasCreatedCharacters(userId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM characters WHERE creator_id = ? AND official = 0`
    )
    .get(userId) as { c: number };
  return Number(row?.c ?? 0) > 0;
}
