import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
const db = new Database("/tmp/e43h-data/app.db");
db.pragma("journal_mode = WAL");
db.exec("DELETE FROM messages; DELETE FROM chats; DELETE FROM characters; DELETE FROM trpg_participants; DELETE FROM trpg_campaigns;");
const IMG = "/uploads/daf5931a-b453-4e53-adc3-c5c018dc0509.png";
const IMG2 = "/uploads/ZZSECOND_IMG_SECRET.webp";
const cols = `name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, audience`;
const creator = db.prepare("SELECT id FROM users WHERE email='creator@e43.local'").get().id;
function ch(name, nsfw, emoji, imgs, o) {
  return Number(db.prepare(`INSERT INTO characters (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    name, o, "d", "g", "s", "현대", "[]", nsfw, 1, emoji, 300, creator, "c", "public", "approved",
    JSON.stringify(imgs), JSON.stringify(imgs.map((u) => ({ url: u, tag: "x" }))), 3, nsfw ? "adult" : "all").lastInsertRowid);
}
const LUC = "/uploads/official-pilot-rf-v4-03__rep-a1.webp";
const nsfwId = ch("ZZNSFW_NAME", 1, "🔞", [LUC, IMG2], "ZZNSFW_TAGLINE");
const noimgId = ch("ZZNSFW_NOIMG", 1, "🔞", [], "ZZNSFW_TAGLINE2");
const safeId = ch("ZZSAFE_NAME", 0, "🌿", [IMG], "ZZSAFE_TAGLINE");
function user(email, nick, o) {
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (ex) { db.prepare("UPDATE users SET nickname=?, is_adult=?, nsfw_on=?, is_admin=? WHERE id=?").run(nick, o.adult, o.nsfw_on, o.admin, ex.id); return ex.id; }
  return Number(db.prepare("INSERT INTO users (email,nickname,pw_hash,points,is_adult,nsfw_on,is_admin) VALUES (?,?,?,?,?,?,?)").run(email, nick, "x", 0, o.adult, o.nsfw_on, o.admin).lastInsertRowid);
}
const U = {
  std: user("std@e43.local", "일반회원", { adult: 0, nsfw_on: 0, admin: 0 }),
  adultflag: user("adultflag@e43.local", "성인플래그", { adult: 1, nsfw_on: 1, admin: 0 }),
  adminOn: user("adminon@e43.local", "관리자필터ON", { adult: 1, nsfw_on: 0, admin: 1 }),
  adminOff: user("adminoff@e43.local", "관리자필터OFF", { adult: 1, nsfw_on: 1, admin: 1 }),
};
const tokens = {};
for (const [k, uid] of Object.entries(U)) {
  for (const [cid, tag, t] of [[safeId, "SAFE", 20], [nsfwId, "NSFW", 5], [noimgId, "NOIMG", 8]]) {
    const chat = Number(db.prepare("INSERT INTO chats (user_id,character_id,title,created_at) VALUES (?,?,?,datetime('now', ?))").run(uid, cid, `ZZCHAT_TITLE_${tag}`, `-${t} minutes`).lastInsertRowid);
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chat, "user", "시작");
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chat, "assistant", `ZZNARR_${tag} 은밀한 서술이 이어졌다. "ZZQUOTE_${tag} 대사"`);
  }
  {
    const chat = Number(db.prepare("INSERT INTO chats (user_id,character_id,title,created_at) VALUES (?,?,?,datetime('now', ?))").run(uid, nsfwId, "ZZCHAT_TITLE_NSFW_BRANCH", "-30 minutes").lastInsertRowid);
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chat, "user", "분기 시작");
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chat, "assistant", `ZZNARR_BRANCH 분기 서술이 이어졌다. "ZZQUOTE_BRANCH 대사"`);
  }
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(tok, uid, new Date(Date.now() + 864e5).toISOString());
  tokens[k] = tok;
}
fs.writeFileSync("/tmp/e43h-fixtures.json", JSON.stringify({ tokens, nsfwId, safeId }, null, 1));
console.log(JSON.stringify({ U, nsfwId, safeId }));
