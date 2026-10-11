import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";

const DATA = process.env.E43_DATA ?? "/tmp/e43-data";
const db = new Database(`${DATA}/app.db`);
db.pragma("journal_mode = WAL");

const KANG = "/uploads/daf5931a-b453-4e53-adc3-c5c018dc0509.png";
const LUC = "/uploads/official-pilot-rf-v4-03__rep-a1.webp";
const cols = `name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, audience`;

function upsertUser(email, nick, o = {}) {
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (ex) {
    db.prepare("UPDATE users SET nickname=?, pref=?, is_adult=?, nsfw_on=?, is_admin=? WHERE id=?").run(
      nick, o.pref ?? null, o.adult ?? 0, o.nsfw_on ?? 0, o.admin ?? 0, ex.id,
    );
    return ex.id;
  }
  return Number(
    db.prepare("INSERT INTO users (email, nickname, pw_hash, points, pref, is_adult, nsfw_on, is_admin) VALUES (?,?,?,?,?,?,?,?)").run(
      email, nick, "x", 0, o.pref ?? null, o.adult ?? 0, o.nsfw_on ?? 0, o.admin ?? 0,
    ).lastInsertRowid,
  );
}

function setPoints(uid, paid, free) {
  db.prepare("DELETE FROM point_transactions WHERE user_id=?").run(uid);
  const ins = db.prepare("INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at) VALUES (?,?,?,datetime('now','+365 day'))");
  if (paid > 0) ins.run(uid, "PAID", paid);
  if (free > 0) ins.run(uid, "FREE", free);
  db.prepare("UPDATE users SET points=? WHERE id=?").run(paid + free, uid);
}

function setNotifications(uid, n) {
  db.prepare("DELETE FROM user_notifications WHERE user_id=?").run(uid);
  const ins = db.prepare("INSERT INTO user_notifications (user_id, type, ref_id, title, body) VALUES (?,?,?,?,?)");
  for (let i = 0; i < n; i++) ins.run(uid, "creator_character", 1, `새 알림 ${i + 1}`, "내 캐릭터에 새 소식이 도착했어요.");
}

function session(uid) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)").run(tok, uid, new Date(Date.now() + 864e5).toISOString());
  return tok;
}

const creator = upsertUser("creator@e43.local", "creator");
db.exec("DELETE FROM messages; DELETE FROM chats; DELETE FROM characters; DELETE FROM likes;");

const NAMES = ["공식 강이현", "공식 루시안", "일반 세라", "일반 이안", "공식 에녹", "공식 라이크"];
const charIds = NAMES.map((name, i) => {
  const img = i % 2 ? LUC : KANG;
  return Number(
    db.prepare(`INSERT INTO characters (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      name, "테스트 소개 문구", "d", "안녕, 오랜만이야.", "s", "현대 판타지", JSON.stringify(["테스트"]), 0,
      name.startsWith("공식") ? 1 : 0, "✨", 260 + i * 10, creator, "공식계정", "public", "approved",
      JSON.stringify([img]), JSON.stringify([{ url: img, tag: "대표" }]), i + 1, "all",
    ).lastInsertRowid,
  );
});

const users = {
  std: upsertUser("std@e43.local", "하브유저", { pref: "female" }),
  heavy: upsertUser("heavy@e43.local", "아주아주긴닉네임을가진사용자님입니다", { pref: "female", adult: 1 }),
  admin: upsertUser("admin@e43.local", "관리자", { pref: null, adult: 1, nsfw_on: 1, admin: 1 }),
  huge: upsertUser("huge@e43.local", "닉네임이정말로엄청나게길어서잘리는사용자", { pref: "male", adult: 1 }),
};
setPoints(users.std, 0, 0);
setPoints(users.heavy, 9_876_543, 2_469_135);
setPoints(users.admin, 1200, 340);
setPoints(users.huge, 1_999_999_999, 100_000_000);
setNotifications(users.huge, 120);
setNotifications(users.std, 0);
setNotifications(users.heavy, 120);
setNotifications(users.admin, 7);

const chatIds = {};
for (const [key, uid] of Object.entries(users)) {
  chatIds[key] = [];
  charIds.forEach((cid, i) => {
    const chatId = Number(
      db.prepare("INSERT INTO chats (user_id, character_id, created_at) VALUES (?,?,datetime('now', ?))").run(uid, cid, `-${10 + i} minutes`).lastInsertRowid,
    );
    db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)").run(chatId, "assistant", "안녕, 오랜만이야. 오늘은 어디부터 이야기해 볼까?");
    db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)").run(chatId, "user", "일단 앉아서 천천히 얘기하자.");
    db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)").run(chatId, "assistant", "그래, 차분히 들어줄게. 네가 편한 이야기부터 꺼내 줘.");
    chatIds[key].push(chatId);
  });
}

db.prepare("DELETE FROM trpg_participants").run();
db.prepare("DELETE FROM trpg_campaigns").run();
for (const [key, uid] of Object.entries(users)) {
  const cid = Number(
    db.prepare("INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (?,?,?)").run(uid, "폐허 도시의 마지막 열차", "PLAYING").lastInsertRowid,
  );
  db.prepare("INSERT INTO trpg_participants (campaign_id, slot_index, kind, user_id, display_name) VALUES (?,?,?,?,?)").run(cid, 0, "human", uid, key);
}

const out = {
  tokens: Object.fromEntries(Object.entries(users).map(([k, uid]) => [k, session(uid)])),
  chatIds,
  charIds,
};
fs.writeFileSync("/tmp/e43-fixtures.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ users, chatIds: chatIds.std.slice(0, 2) }));
