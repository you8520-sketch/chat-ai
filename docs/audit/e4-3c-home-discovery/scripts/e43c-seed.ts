import crypto from "crypto";
import fs from "fs";
import { getDb } from "@/lib/db";

const db = getDb();
db.exec("DELETE FROM messages; DELETE FROM chats; DELETE FROM characters;");
const IMG = "/uploads/daf5931a-b453-4e53-adc3-c5c018dc0509.png";
const LUC = "/uploads/official-pilot-rf-v4-03__rep-a1.webp";
const cols =
  "name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, audience, likes, contest_pick, contest_rank, created_at";

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

const creator = user("creator@e43c.local", "creator", { adult: 1, nsfw_on: 0, admin: 0 });
const U = {
  std: user("std@e43c.local", "일반회원", { adult: 1, nsfw_on: 0, admin: 0 }),
  adminOn: user("adminon@e43c.local", "관리자필터ON", { adult: 1, nsfw_on: 0, admin: 1 }),
  adminOff: user("adminoff@e43c.local", "관리자필터OFF", { adult: 1, nsfw_on: 1, admin: 1 }),
};

type Seed = { name: string; tagline: string; nsfw: number; img: string; likes: number; contest: number; ageMin: number; genre: string };
const seeds: Seed[] = [
  { name: "세라핀 에르하르트", tagline: "달빛 아래서만 문을 여는 고서점의 주인", nsfw: 0, img: IMG, likes: 98, contest: 0, ageMin: 9000, genre: "현대 판타지" },
  { name: "카이로스", tagline: "시간이 멈춘 도시의 마지막 시계공", nsfw: 0, img: LUC, likes: 91, contest: 1, ageMin: 8800, genre: "SF" },
  { name: "이서윤", tagline: "비 오는 날마다 같은 정류장에서 마주치는 사람", nsfw: 0, img: IMG, likes: 85, contest: 0, ageMin: 8600, genre: "로맨스" },
  { name: "아르카디아 연맹 총사령관 레이첼 폰 슈바르츠발트", tagline: "제국의 마지막 전선을 지키는 냉철한 지휘관", nsfw: 0, img: LUC, likes: 80, contest: 1, ageMin: 8400, genre: "판타지" },
  { name: "윤하", tagline: "옥상 정원에서 별을 세는 소녀", nsfw: 0, img: IMG, likes: 74, contest: 0, ageMin: 8200, genre: "일상" },
  { name: "검은 숲의 수호자", tagline: "숲이 잠든 밤에만 깨어나는 오래된 존재", nsfw: 0, img: LUC, likes: 69, contest: 1, ageMin: 8000, genre: "다크 판타지" },
  { name: "도윤", tagline: "졸업 후 십 년, 다시 만난 동아리방 선배", nsfw: 0, img: IMG, likes: 63, contest: 0, ageMin: 7800, genre: "로맨스" },
  { name: "미라벨", tagline: "도둑 길드에서 가장 느긋한 소매치기", nsfw: 0, img: LUC, likes: 58, contest: 1, ageMin: 7600, genre: "모험" },
  { name: "성인 테스트 캐릭터", tagline: "성인 전용 소개 문구", nsfw: 1, img: LUC, likes: 52, contest: 1, ageMin: 7400, genre: "로맨스" },
  { name: "하윤서", tagline: "새벽 세 시 편의점 아르바이트생", nsfw: 0, img: IMG, likes: 47, contest: 0, ageMin: 7200, genre: "일상" },
  { name: "벨라트릭스", tagline: "마법 학원 도서관의 금서 구역 관리인", nsfw: 0, img: LUC, likes: 41, contest: 1, ageMin: 7000, genre: "판타지" },
  { name: "노아", tagline: "우주 정거장의 외로운 정비사", nsfw: 0, img: IMG, likes: 36, contest: 0, ageMin: 6800, genre: "SF" },
  { name: "한결", tagline: "골목 끝 작은 찻집의 단골 손님", nsfw: 0, img: LUC, likes: 30, contest: 0, ageMin: 6600, genre: "일상" },
  { name: "리엘", tagline: "폐허가 된 성당에서 노래하는 소년", nsfw: 0, img: IMG, likes: 25, contest: 0, ageMin: 1200, genre: "판타지" },
  { name: "소하", tagline: "첫눈이 오는 날 건넨 편지", nsfw: 0, img: LUC, likes: 20, contest: 0, ageMin: 1000, genre: "로맨스" },
  { name: "오르페", tagline: "지하철 막차에서만 만나는 악사", nsfw: 0, img: IMG, likes: 15, contest: 0, ageMin: 800, genre: "현대 판타지" },
  { name: "지안", tagline: "사라진 친구의 일기를 대신 쓰는 사람", nsfw: 0, img: LUC, likes: 10, contest: 0, ageMin: 600, genre: "미스터리" },
  { name: "에이다", tagline: "고장 난 로봇과 함께 사는 발명가", nsfw: 0, img: IMG, likes: 6, contest: 0, ageMin: 400, genre: "SF" },
  { name: "서린", tagline: "폭우 속 등대지기의 마지막 밤", nsfw: 0, img: LUC, likes: 4, contest: 0, ageMin: 200, genre: "미스터리" },
  { name: "루나리아", tagline: "달 뒤편에서 편지를 보내온 낯선 이", nsfw: 0, img: IMG, likes: 2, contest: 0, ageMin: 100, genre: "SF" },
];

let rank = 100;
for (const s of seeds) {
  db.prepare(`INSERT INTO characters (${cols}) VALUES (${cols.split(",").map((c) => (c.trim() === "created_at" ? "datetime('now', ?)" : "?")).join(",")})`)
    .run(
      s.name, s.tagline, "d", "g", "s", s.genre, JSON.stringify(["테스트"]), s.nsfw, 1, "✨", 260, creator, "공식계정",
      "public", "approved", JSON.stringify([s.img]), JSON.stringify([{ url: s.img, tag: "대표" }]), 200 - s.likes,
      s.nsfw ? "adult" : "all", s.likes, s.contest, s.contest ? rank-- : 0, `-${s.ageMin} minutes`,
    );
}

const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(
    tok, uid, new Date(Date.now() + 864e5).toISOString(),
  );
  tokens[k] = tok;
}
fs.writeFileSync("/tmp/e43c-fixtures.json", JSON.stringify({ tokens }, null, 1));
console.log("seeded", seeds.length);
