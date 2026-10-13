import crypto from "crypto";
import fs from "fs";
import { getDb } from "@/lib/db";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";

const db = getDb();
db.exec("DELETE FROM messages; DELETE FROM chats; DELETE FROM characters; DELETE FROM user_personas;");

function user(email: string, nick: string, o: { adult: number; admin: number }) {
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  if (ex) {
    db.prepare("UPDATE users SET nickname=?, is_adult=?, is_admin=?, points=2000 WHERE id=?").run(nick, o.adult, o.admin, ex.id);
    return ex.id;
  }
  return Number(
    db.prepare("INSERT INTO users (email,nickname,pw_hash,points,is_adult,nsfw_on,is_admin) VALUES (?,?,?,?,?,?,?)")
      .run(email, nick, "x", 2000, o.adult, 0, o.admin).lastInsertRowid,
  );
}
const U = {
  creator: user("creator@e43f.local", "소설가하루", { adult: 1, admin: 0 }),
  minor: user("minor@e43f.local", "미성년회원", { adult: 0, admin: 0 }),
  other: user("other@e43f.local", "다른제작자", { adult: 1, admin: 0 }),
};

const SENT = [
  "이 도시의 서쪽 끝에는 달빛이 가장 얇아지는 시간에만 문을 여는 고서점이 있다.",
  "주인은 손님이 잊고 싶은 문장을 하나씩 받아 두꺼운 장부에 옮겨 적고, 대신 아직 읽히지 않은 이야기를 한 권 내어 준다.",
  "그는 목소리를 높이는 법이 없고, 거절할 때에도 먼저 차를 따라 주는 사람이다.",
  "서점의 규칙은 단순하다. 문이 닫히기 전에 도착한 사람만 맞이하고, 읽은 문장은 돌려주지 않으며, 책장을 옮기는 소리가 들려도 돌아보지 않는다.",
  "손끝은 늘 차갑지만 난로 앞에서는 오래 머무르고, 감정이 흔들릴 때면 안경을 벗어 천천히 닦는 습관이 있다.",
];
function fill(n: number, seed = 0): string {
  let out = "";
  let i = seed;
  while (out.length < n) {
    out += SENT[i % SENT.length] + (i % 4 === 3 ? "\n\n" : " ");
    i++;
  }
  return out.slice(0, n).trimEnd().padEnd(n, "。");
}
const POSTER = "/uploads/g-poster.webp";
const asset = (url: string, tag: string, o: Record<string, unknown> = {}) => ({ url, tag, public: true, chat: true, ...o });
const GALLERY = [
  asset(POSTER, "대표", { representativeRank: 1 }),
  asset("/uploads/g-b.webp", "미소"),
  asset("/uploads/g-3.webp", "비밀", { viewerBlur: true }),
  asset("/uploads/g-wide1.webp", "장면"),
  asset("/uploads/g-wide2.webp", "장면2"),
  asset("/uploads/g-b2.webp", "표정"),
];
const widgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const cols =
  "name, tagline, description, greeting, system_prompt, world, genres, tags, nsfw, official, emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, audience, likes, status_widget_json, gender, participant_min_age, creator_comment";
function character(o: { name: string; tagline: string; world: string; prompt: string; assets: unknown[]; creator: number; widget?: string }) {
  return Number(
    db.prepare(`INSERT INTO characters (${cols}) VALUES (${cols.split(",").map(() => "?").join(",")})`).run(
      o.name, o.tagline, "고서점 주인", "달빛이 가장 얇아지는 밤, 서점의 종이 울렸다.", o.prompt, o.world,
      JSON.stringify(["romance_fantasy"]), JSON.stringify(["고서점", "달빛"]), 0, 0, "✨", 260, o.creator, "소설가하루",
      "public", "approved", JSON.stringify(o.assets.map((a) => (a as { url: string }).url)), JSON.stringify(o.assets), 0, "all", 0,
      o.widget ?? widgetJson, "male", 27, "",
    ).lastInsertRowid,
  );
}
const chars = {
  full: character({ name: "세라핀 에르하르트", tagline: "달빛 아래서만 문을 여는 고서점의 주인", world: fill(2500, 0), prompt: fill(4000, 1), assets: GALLERY, creator: U.creator }),
  long: character({
    name: "아주 긴 이름을 가진 캐릭터의 이름이 한 줄을 넘어가는 경우를 확인하기",
    tagline: "한 줄 소개는 오십 자 이내로 제한되지만 이 정도 길이로 길게 채워 본다 길게 길게",
    world: fill(1800, 2), prompt: fill(2600, 3), assets: GALLERY.slice(0, 1), creator: U.creator,
  }),
  noimg: character({ name: "이미지 없는 캐릭터", tagline: "이미지 0장", world: fill(1000, 0), prompt: fill(800, 2), assets: [], creator: U.creator }),
  other: character({ name: "다른 제작자의 캐릭터", tagline: "접근 차단 확인", world: fill(600, 0), prompt: fill(600, 1), assets: GALLERY.slice(0, 1), creator: U.other }),
};
const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(tok, uid, new Date(Date.now() + 864e5).toISOString());
  tokens[k] = tok;
}
fs.writeFileSync("/tmp/e43f-fixtures.json", JSON.stringify({ tokens, users: U, chars }, null, 1));
console.log(JSON.stringify({ U, chars }));
