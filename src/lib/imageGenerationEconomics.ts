import type Database from "better-sqlite3";

import { CHAT_ROOM_IMAGE_GENERATION_POINTS } from "@/lib/chatImagePricing";
import { resolveCreatorRewardRate } from "@/lib/creatorPoints";

export { CHAT_ROOM_IMAGE_GENERATION_POINTS } from "@/lib/chatImagePricing";
/** Fixed creator reward for an eligible image generation. */
export const CHAT_ROOM_IMAGE_CREATOR_REWARD_CP = 15;

export function creditChatRoomImageCreatorReward(
  db: Database.Database,
  opts: {
    generationId: number;
    creatorId: number | null | undefined;
    consumerUserId: number;
    source: "character" | "trpg_scenario";
  }
): number {
  if (!opts.creatorId || opts.creatorId === opts.consumerUserId) return 0;
  if (resolveCreatorRewardRate(opts.creatorId) <= 0) return 0;

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO image_generation_creator_earnings
        (generation_id, consumer_user_id, creator_id, source, reward_amount)
       VALUES (?,?,?,?,?)`
    )
    .run(
      opts.generationId,
      opts.consumerUserId,
      opts.creatorId,
      opts.source,
      CHAT_ROOM_IMAGE_CREATOR_REWARD_CP
    );
  if (inserted.changes === 0) return 0;

  db.prepare("UPDATE users SET creator_points = ROUND(creator_points + ?, 1) WHERE id=?").run(
    CHAT_ROOM_IMAGE_CREATOR_REWARD_CP,
    opts.creatorId
  );
  db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
    opts.creatorId,
    CHAT_ROOM_IMAGE_CREATOR_REWARD_CP,
    `${opts.source === "trpg_scenario" ? "TRPG 시나리오" : "캐릭터"} 이미지 생성 수익 (생성 #${opts.generationId})`
  );
  return CHAT_ROOM_IMAGE_CREATOR_REWARD_CP;
}
