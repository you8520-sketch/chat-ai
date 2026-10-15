import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const SR_PREFIX = "SR검증";
export const SR_TAG = "sr캡태그";
export const SR_CAP_TOTAL = 64;

type Row = {
  name: string;
  genre?: string;
  tags?: string[];
  official?: number;
  nsfw?: number;
  visibility?: string;
  moderation?: string;
  turns?: number;
  chatsRecent?: number;
  creatorId?: number | null;
};

/** Only an explicitly bootstrapped, isolated Playwright DB may receive these rows. */
export function seedSearchRankingFixture(dataDir: string) {
  const resolved = path.resolve(dataDir);
  if (resolved === path.resolve("data") || resolved === "/data") {
    throw new Error("Search/ranking fixture requires an isolated test data directory");
  }
  const dbPath = path.join(resolved, "app.db");
  if (!fs.existsSync(dbPath)) throw new Error("Bootstrap the isolated server before seeding");
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  try {
    db.transaction(() => {
      const old = db.prepare("SELECT id FROM characters WHERE name LIKE ?").all(`${SR_PREFIX}%`) as { id: number }[];
      for (const { id } of old) {
        db.prepare("DELETE FROM chats WHERE character_id=?").run(id);
        db.prepare("DELETE FROM characters WHERE id=?").run(id);
      }
      db.prepare("DELETE FROM users WHERE email='sr-fixture@example.invalid'").run();
      const userId = Number(
        db.prepare("INSERT INTO users (email,nickname,pw_hash,points) VALUES ('sr-fixture@example.invalid','SR제작자','x',0)")
          .run().lastInsertRowid,
      );
      const insert = db.prepare(`INSERT INTO characters
        (name,tagline,description,greeting,system_prompt,world,genre,genres,tags,nsfw,official,emoji,hue,
         creator_id,creator_name,visibility,moderation_status,images,assets,total_turns,chats_count,
         audience,likes,gender,participant_min_age,creator_comment,content_kind,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'✨',200,?,?,?,?,'[]','[]',?,0,'all',?,'male',27,'','character','2026-01-01 00:00:00')`);
      const chat = db.prepare("INSERT INTO chats (user_id,character_id,created_at) VALUES (?,?,datetime('now','-1 hours'))");
      const add = (r: Row) => {
        const genre = r.genre ?? "판타지";
        const id = Number(insert.run(
          r.name, `${r.name} 한 줄 소개`, "d", "hi", "p", "w", genre, JSON.stringify([genre]),
          JSON.stringify(r.tags ?? []), r.nsfw ?? 0, r.official ?? 0,
          r.official ? null : (r.creatorId === undefined ? userId : r.creatorId), r.official ? "하브 공식" : "SR제작자",
          r.visibility ?? "public", r.moderation ?? "approved", r.turns ?? 0, 10,
        ).lastInsertRowid);
        for (let i = 0; i < (r.chatsRecent ?? 0); i++) chat.run(userId, id);
        return id;
      };
      add({ name: `${SR_PREFIX} 1위작`, official: 1, turns: 900, chatsRecent: 1 });
      add({ name: `${SR_PREFIX} 2위작`, turns: 800, chatsRecent: 3 });
      add({ name: `${SR_PREFIX} 3위작`, turns: 700, chatsRecent: 2 });
      add({ name: `${SR_PREFIX} 4위작`, turns: 600 });
      add({ name: `${SR_PREFIX} 5위작`, turns: 500 });
      add({ name: `${SR_PREFIX} 비공개`, visibility: "private", turns: 9999, chatsRecent: 9 });
      add({ name: `${SR_PREFIX} 심사중`, moderation: "pending", turns: 9999, chatsRecent: 9 });
      add({ name: `${SR_PREFIX} 성인`, nsfw: 1, turns: 9999, chatsRecent: 9 });
      for (let i = 0; i < SR_CAP_TOTAL; i++) add({ name: `${SR_PREFIX} 캡${String(i).padStart(2, "0")}`, tags: [SR_TAG] });
    })();
  } finally {
    db.close();
  }
}
