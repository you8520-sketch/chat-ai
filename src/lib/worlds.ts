export const WORLD_NAME_LIMIT = 40;
export const WORLD_SUMMARY_LIMIT = 100;
export const WORLD_CONTENT_LIMIT = 10000;

export type WorldRow = {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  content: string;
  created_at: string;
  updated_at: string;
  shared_from_nickname?: string;
};

export type WorldListItem = {
  id: number;
  name: string;
  summary: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** 공유받아 추가된 경우 원 작성자 닉네임 */
  sharedFromNickname?: string;
};

export function rowToWorldListItem(row: WorldRow): WorldListItem {
  const sharedFrom = (row.shared_from_nickname ?? "").trim();
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(sharedFrom ? { sharedFromNickname: sharedFrom } : {}),
  };
}
