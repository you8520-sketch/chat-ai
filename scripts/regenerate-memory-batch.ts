/**
 * Re-run LLM summary for chat 38 turns 7-12 (fixes bad fallback record).
 * Usage: node --import tsx scripts/regenerate-memory-batch.ts 38 7
 */
import Database from "better-sqlite3";
import { regenerateMemoryRecordBatch } from "../src/lib/memory/memory-manager.ts";
import { rebuildLorebookFromRecords } from "../src/lib/memory/memory-turn-summary.ts";
import { getOrCreateChatMemory, updateChatMemory } from "../src/lib/memory/memory-db.ts";
import { getChatMemoryCapacity } from "../src/lib/memory/memory-capacity.ts";
import { resolveMemoryTier } from "../src/lib/memory/memory-manager.ts";

async function main() {
  const chatId = Number(process.argv[2] ?? 38);
  const turnStart = Number(process.argv[3] ?? 7);

  const db = new Database("data/app.db");
  const chat = db
    .prepare("SELECT id, user_id, character_id FROM chats WHERE id=?")
    .get(chatId) as { id: number; user_id: number; character_id: number } | undefined;
  if (!chat) {
    console.error("chat not found");
    process.exit(1);
  }
  const char = db
    .prepare("SELECT name FROM characters WHERE id=?")
    .get(chat.character_id) as { name: string };
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(chat.user_id) as {
    id: number;
    subscription_tier?: string;
  };

  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?").run(
    chatId,
    turnStart
  );
  getOrCreateChatMemory(chatId, chat.user_id, chat.character_id, "pro");
  updateChatMemory(chatId, chat.user_id, chat.character_id, {
    summarized_turn_count: turnStart - 1,
    recent_summary: rebuildLorebookFromRecords(chatId),
  });

  const ok = await regenerateMemoryRecordBatch({
    chatId,
    userId: chat.user_id,
    characterId: chat.character_id,
    charName: char.name,
    tier: resolveMemoryTier(user as never),
    memoryCapacity: getChatMemoryCapacity(chatId),
    turnStart,
  });

  const row = db
    .prepare("SELECT summary FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?")
    .get(chatId, turnStart) as { summary: string } | undefined;
  console.log("ok", ok);
  console.log("summary head", row?.summary?.slice(0, 200));
  console.log("is fallback", row?.summary?.includes("…라 말했고"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
