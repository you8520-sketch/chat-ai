/** 장기기억 동기화 — npx tsx scripts/sync-chat-memory.ts [chatId] [--force] */
import { readFileSync } from "fs";
import { resolve } from "path";
import Database from "better-sqlite3";
import { syncAndCompressMemoryFromChat } from "../src/lib/memory/memory-backfill";
import { MEMORY_CAPACITY_DEFAULT, normalizeMemoryCapacity } from "../src/lib/memory/memory-capacity";
import { updateChatMemory, getOrCreateChatMemory } from "../src/lib/memory/memory-db";
import { catchUpRollingSummaries, loadTurnsForCharacter } from "../src/lib/memory/memory-rolling-summary";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function resolveTier(user: { sub_plan?: string | null }): "free" | "basic" | "pro" {
  if (user.sub_plan === "basic" || user.sub_plan === "pro") return user.sub_plan;
  return "free";
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const argChatId = args.find((a) => /^\d+$/.test(a)) ? Number(args.find((a) => /^\d+$/.test(a))) : null;

  const db = new Database(resolve(process.cwd(), "data/app.db"));

  let chat: {
    id: number;
    user_id: number;
    character_id: number;
    title: string;
    current_summary: string;
    char_name: string;
    memory_capacity?: number;
  };

  if (argChatId) {
    const row = db
      .prepare(
        `SELECT c.id, c.user_id, c.character_id, c.title, c.current_summary, c.memory_capacity, ch.name AS char_name
         FROM chats c JOIN characters ch ON ch.id = c.character_id WHERE c.id=?`
      )
      .get(argChatId) as typeof chat | undefined;
    if (!row) {
      console.error(`chat ${argChatId} 없음`);
      process.exit(1);
    }
    chat = row;
  } else {
    const row = db
      .prepare(
        `SELECT c.id, c.user_id, c.character_id, c.title, c.current_summary, c.memory_capacity, ch.name AS char_name
         FROM chats c JOIN characters ch ON ch.id = c.character_id
         ORDER BY c.id DESC LIMIT 1`
      )
      .get() as typeof chat | undefined;
    if (!row) {
      console.error("채팅방 없음");
      process.exit(1);
    }
    chat = row;
  }

  const user = db
    .prepare("SELECT id, sub_plan FROM users WHERE id=?")
    .get(chat.user_id) as { id: number; sub_plan?: string | null };

  const tier = resolveTier(user);
  console.log(`[sync] chat=${chat.id} char=${chat.char_name} user=${chat.user_id} tier=${tier}${force ? " (force rebuild)" : ""}`);

  if (force) {
    const turns = loadTurnsForCharacter(chat.user_id, chat.character_id);
    getOrCreateChatMemory(chat.id, chat.user_id, chat.character_id, tier);
    updateChatMemory(chat.id, chat.user_id, chat.character_id, {
      recent_summary: "",
      archive_summary: "",
      summarized_turn_count: 0,
      message_count: turns.length,
      membership_tier: tier,
      last_compressed_at: null,
    });
    db.prepare("UPDATE chats SET current_summary=? WHERE id=?").run("", chat.id);
    console.log(`[sync] force reset — ${turns.length} turns, pinned facts kept`);
  }

  const before = db
    .prepare(
      `SELECT message_count, summarized_turn_count, length(recent_summary) AS len, recent_summary
       FROM character_memories WHERE user_id=? AND character_id=?`
    )
    .get(chat.user_id, chat.character_id) as
    | { message_count: number; summarized_turn_count: number; len: number; recent_summary: string }
    | undefined;

  console.log("[sync] before:", before ?? "(no memory row)");

  const ok = force
    ? false
    : await syncAndCompressMemoryFromChat({
        userId: chat.user_id,
        characterId: chat.character_id,
        chatId: chat.id,
        charName: chat.char_name,
        tier,
        memoryCapacity: normalizeMemoryCapacity(chat.memory_capacity ?? MEMORY_CAPACITY_DEFAULT),
      });

  // catch up all pending 5-turn batches
  let totalBatches = 0;
  let rounds = 0;
  while (rounds < 20) {
    const mem = db
      .prepare(
        `SELECT message_count, summarized_turn_count FROM character_memories WHERE user_id=? AND character_id=?`
      )
      .get(chat.user_id, chat.character_id) as
      | { message_count: number; summarized_turn_count: number }
      | undefined;
    if (!mem || mem.message_count - mem.summarized_turn_count < 5) break;
    const n = await catchUpRollingSummaries({
      userId: chat.user_id,
      characterId: chat.character_id,
      chatId: chat.id,
      charName: chat.char_name,
      tier,
      memoryCapacity: normalizeMemoryCapacity(chat.memory_capacity ?? MEMORY_CAPACITY_DEFAULT),
      maxRounds: 5,
    });
    if (n === 0) break;
    totalBatches += n;
    rounds++;
    console.log(`[sync] catch-up round ${rounds}, batches=${n}`);
  }

  const after = db
    .prepare(
      `SELECT message_count, summarized_turn_count, length(recent_summary) AS len, recent_summary
       FROM character_memories WHERE user_id=? AND character_id=?`
    )
    .get(chat.user_id, chat.character_id) as
    | { message_count: number; summarized_turn_count: number; len: number; recent_summary: string }
    | undefined;

  const chatSummary = db
    .prepare("SELECT length(current_summary) AS len, current_summary FROM chats WHERE id=?")
    .get(chat.id) as { len: number; current_summary: string };

  console.log("[sync] after:", after);
  console.log("[sync] chats.current_summary len:", chatSummary?.len ?? 0);
  if (after?.recent_summary) {
    console.log("\n--- recent_summary preview ---\n");
    console.log(after.recent_summary.slice(0, 800));
  }
  console.log(`\n[sync] done batches=${totalBatches}`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
