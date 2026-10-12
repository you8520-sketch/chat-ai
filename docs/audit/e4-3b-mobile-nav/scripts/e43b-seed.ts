import crypto from "crypto";
import fs from "fs";
import { getDb } from "@/lib/db";
import { createTrpgCampaign } from "@/lib/trpg/engineCreate";

const db = getDb();
db.exec(
  "DELETE FROM messages; DELETE FROM chats; DELETE FROM characters; DELETE FROM trpg_participants; DELETE FROM trpg_campaigns;",
);
const IMG = "/uploads/daf5931a-b453-4e53-adc3-c5c018dc0509.png";
const LUC = "/uploads/official-pilot-rf-v4-03__rep-a1.webp";
const cols =
  "name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, audience";

function user(email: string, nick: string, o: { adult: number; nsfw_on: number; admin: number }) {
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  if (ex) {
    db.prepare("UPDATE users SET nickname=?, is_adult=?, nsfw_on=?, is_admin=? WHERE id=?").run(
      nick, o.adult, o.nsfw_on, o.admin, ex.id,
    );
    return ex.id;
  }
  return Number(
    db
      .prepare("INSERT INTO users (email,nickname,pw_hash,points,is_adult,nsfw_on,is_admin) VALUES (?,?,?,?,?,?,?)")
      .run(email, nick, "x", 2000, o.adult, o.nsfw_on, o.admin).lastInsertRowid,
  );
}

const creator = user("creator@e43b.local", "creator", { adult: 1, nsfw_on: 0, admin: 0 });
const U = {
  std: user("std@e43b.local", "일반회원", { adult: 1, nsfw_on: 0, admin: 0 }),
  adminOn: user("adminon@e43b.local", "관리자필터ON", { adult: 1, nsfw_on: 0, admin: 1 }),
  adminOff: user("adminoff@e43b.local", "관리자필터OFF", { adult: 1, nsfw_on: 1, admin: 1 }),
};

function ch(name: string, nsfw: number, img: string, turns: number, tagline: string) {
  return Number(
    db
      .prepare(`INSERT INTO characters (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        name, tagline, "d", "g", "s", "현대 판타지", JSON.stringify(["테스트"]), nsfw, 1, "✨", 260, creator, "공식계정",
        "public", "approved", JSON.stringify([img]), JSON.stringify([{ url: img, tag: "대표" }]), turns,
        nsfw ? "adult" : "all",
      ).lastInsertRowid,
  );
}
const ids: number[] = [];
for (let i = 1; i <= 8; i++) ids.push(ch(`테스트 캐릭터 ${i}`, 0, i % 2 ? IMG : LUC, 100 - i * 7, `테스트 소개 문구 ${i}`));
const nsfwId = ch("성인 테스트", 1, LUC, 3, "성인 소개");

const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  for (const [idx, cid] of [ids[0], ids[1], nsfwId].entries()) {
    const chat = Number(
      db
        .prepare("INSERT INTO chats (user_id,character_id,title,created_at) VALUES (?,?,?,datetime('now', ?))")
        .run(uid, cid, `대화 ${idx + 1}`, `-${(idx + 1) * 5} minutes`).lastInsertRowid,
    );
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chat, "user", "시작");
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(
      chat, "assistant", `서술이 이어졌다. "대사 ${idx + 1}"`,
    );
  }
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(
    tok, uid, new Date(Date.now() + 864e5).toISOString(),
  );
  tokens[k] = tok;
}

const chatRow = db
  .prepare("SELECT id FROM chats WHERE user_id=? AND character_id=? ORDER BY id LIMIT 1")
  .get(U.std, ids[0]) as { id: number };
const campaignId = createTrpgCampaign(db, {
  hostUserId: U.std,
  hostNickname: "일반회원",
  characterId: ids[0],
  viewerUserId: U.std,
  title: "e43b 테스트 캠페인",
});

fs.writeFileSync(
  "/tmp/e43b-fixtures.json",
  JSON.stringify({ tokens, chatId: chatRow.id, campaignId, ids, nsfwId }, null, 1),
);
console.log(JSON.stringify({ U, chatId: chatRow.id, campaignId }));
