import crypto from "crypto";
import fs from "fs";
import { getDb } from "@/lib/db";

const db = getDb();
db.exec("DELETE FROM messages; DELETE FROM chats; DELETE FROM characters; DELETE FROM user_personas;");

const cols =
  "name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, audience, likes, creator_comment, content_kind, gender, gender_public, height_cm, weight_kg, world_public_name, world_public, share_slug";

function user(email: string, nick: string, o: { adult: number; nsfw_on: number; admin: number }) {
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  if (ex) {
    db.prepare("UPDATE users SET nickname=?, is_adult=?, nsfw_on=?, is_admin=? WHERE id=?").run(nick, o.adult, o.nsfw_on, o.admin, ex.id);
    return ex.id;
  }
  return Number(
    db.prepare("INSERT INTO users (email,nickname,pw_hash,points,is_adult,nsfw_on,is_admin) VALUES (?,?,?,?,?,?,?)").run(email, nick, "x", 2000, o.adult, o.nsfw_on, o.admin).lastInsertRowid,
  );
}
const creator = user("creator@e43d.local", "소설가하루", { adult: 1, nsfw_on: 0, admin: 0 });
const U = {
  std: user("std@e43d.local", "일반회원", { adult: 1, nsfw_on: 0, admin: 0 }),
  owner: creator,
  adminOn: user("adminon@e43d.local", "관리자필터ON", { adult: 1, nsfw_on: 0, admin: 1 }),
  adminOff: user("adminoff@e43d.local", "관리자필터OFF", { adult: 1, nsfw_on: 1, admin: 1 }),
};

const POSTER = "/uploads/g-poster.webp";
const asset = (url: string, tag: string, o: Record<string, unknown> = {}) => ({ url, tag, public: true, chat: true, ...o });
const GALLERY = [
  asset(POSTER, "대표", { representativeRank: 1 }),
  asset("/uploads/g-b.webp", "미소"),
  asset("/uploads/g-3.webp", "비밀", { viewerBlur: true }),
  asset("/uploads/g-wide1.webp", "장면"),
  asset("/uploads/g-4.webp", "잠긴 이미지", { viewerBlur: true }),
  asset("/uploads/g-b2.webp", "잠긴 이미지 2", { viewerBlur: true }),
];
const LONG_DESC = [
  "달빛이 가장 얇아지는 밤에만 문을 여는 고서점의 주인. 낮에는 평범한 책방 주인이지만, 밤이 깊어지면 서가 사이로 사라진 이야기들이 돌아와 속삭이기 시작한다.",
  "그는 손님이 찾는 책이 아니라 손님이 아직 말하지 못한 이야기를 먼저 꺼내 놓는다. 오래된 가죽 장정의 냄새, 식어 가는 찻잔, 책장에 걸린 시계는 언제나 새벽 세 시 사십 분을 가리킨다.",
  "처음 찾아온 사람에게는 늘 같은 질문을 한다. '당신이 잊고 싶은 문장은 무엇입니까?' 대답에 따라 서가의 가장 안쪽 문이 열리기도, 영영 닫히기도 한다.",
  "말투는 정중하지만 거리감이 있고, 가끔 시대에 맞지 않는 표현을 쓴다. 약속은 반드시 지키지만 이유는 설명하지 않는다. 당신과 함께하는 동안만큼은 서점의 불이 꺼지지 않는다.",
].join("\n\n");

type Seed = {
  key: string; name: string; tagline: string; desc?: string; tags?: string[]; nsfw?: number; official?: number;
  images?: string[]; assets?: unknown[]; likes?: number; comment?: string; kind?: string;
  visibility?: string; mod?: string; creatorId?: number; creatorName?: string;
  dossier?: { gender: string; h: number | null; w: number | null; world: string };
};
const seeds: Seed[] = [
  { key: "rich", name: "세라핀 에르하르트", tagline: "달빛 아래서만 문을 여는 고서점의 주인", desc: LONG_DESC, tags: ["고서점", "미스터리", "정중한", "시간", "밤", "비밀"], images: [POSTER], assets: GALLERY, likes: 98, comment: "처음 만드는 캐릭터입니다. 천천히 이야기를 들어 주는 사람을 상상하며 썼어요.", dossier: { gender: "male", h: 183, w: 71, world: "달빛 서가" } },
  { key: "long", name: "아르카디아 연맹 총사령관 레이첼 폰 슈바르츠발트 3세", tagline: "제국의 마지막 전선을 지키는 냉철한 지휘관이지만 밤마다 전사자 명단을 다시 읽으며 이름 하나하나에 짧은 기도를 올리는, 아무에게도 말하지 못한 습관을 가진 사람", desc: LONG_DESC + "\n\n" + LONG_DESC, tags: ["밀리터리", "판타지", "냉철한", "지휘관", "제국", "전쟁", "비밀", "충성", "후회", "서약", "겨울", "북부"], images: [POSTER], assets: GALLERY.slice(0, 3), likes: 80, comment: "긴 이름과 긴 소개 레이아웃 검증용 캐릭터입니다.", dossier: { gender: "female", h: 171, w: 58, world: "아르카디아 연맹령 북부 전선" } },
  { key: "noimg", name: "이름만 있는 캐릭터", tagline: "이미지가 아직 없는 새 캐릭터", desc: "이미지 없이 공개된 캐릭터입니다.", tags: ["신규"], images: [], assets: [], likes: 3 },
  { key: "single", name: "윤하", tagline: "옥상 정원에서 별을 세는 소녀", desc: "옥상 정원에서 별을 세는 소녀의 이야기.", tags: ["일상", "청춘"], images: [POSTER], assets: [asset(POSTER, "대표", { representativeRank: 1 })], likes: 41, dossier: { gender: "female", h: null, w: null, world: "" } },
  { key: "adult", name: "성인 테스트 캐릭터", tagline: "성인 전용 소개 문구", desc: "성인 전용 설명", tags: ["성인"], nsfw: 1, images: ["/uploads/g-b.webp"], assets: [asset("/uploads/g-b.webp", "대표", { representativeRank: 1 })] },
  { key: "private", name: "비공개 캐릭터", tagline: "제작자만 볼 수 있는 캐릭터", desc: "비공개", tags: ["비공개"], visibility: "private", mod: "approved", images: [POSTER], assets: [asset(POSTER, "대표", { representativeRank: 1 })] },
  { key: "official", name: "카이로스", tagline: "시간이 멈춘 도시의 마지막 시계공", desc: LONG_DESC, tags: ["SF", "시계공", "공식"], official: 1, images: ["/uploads/g-b.webp"], assets: [asset("/uploads/g-b.webp", "대표", { representativeRank: 1 }), asset(POSTER, "장면"), asset("/uploads/g-b2.webp", "장면 2")], likes: 91, dossier: { gender: "male", h: 178, w: null, world: "정지된 도시 크로노폴리스" } },
  { key: "sim", name: "도시 괴담 시뮬레이션", tagline: "여럿이 함께 조사하는 다인 시뮬레이션", desc: LONG_DESC, tags: ["시뮬레이션", "괴담"], kind: "simulation", images: ["/uploads/g-b.webp"], assets: [asset("/uploads/g-b.webp", "대표", { representativeRank: 1 })], likes: 12 },
];

const ids: Record<string, number> = {};
for (const s of seeds) {
  const d = s.dossier;
  const pub = (s.visibility ?? "public") as string;
  ids[s.key] = Number(
    db.prepare(`INSERT INTO characters (${cols}) VALUES (${cols.split(",").map(() => "?").join(",")})`).run(
      s.name, s.tagline, s.desc ?? "", "g", "s", "현대 판타지", JSON.stringify(s.tags ?? []), s.nsfw ?? 0, s.official ?? 0, "✨", 260,
      s.official ? creator : s.creatorId ?? creator, s.official ? "공식계정" : s.creatorName ?? "소설가하루", pub, s.mod ?? "approved",
      JSON.stringify(s.images ?? []), JSON.stringify(s.assets ?? []), 200 - (s.likes ?? 0), "all", s.likes ?? 0, s.comment ?? "",
      s.kind ?? "character", d?.gender ?? "other", d ? 1 : 0, d?.h ?? null, d?.w ?? null, d?.world ?? "", d?.world ? 1 : 0,
      pub === "private" ? "e43dprivate" : null,
    ).lastInsertRowid,
  );
}

const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(tok, uid, new Date(Date.now() + 864e5).toISOString());
  tokens[k] = tok;
}
for (const [idx, key] of ["rich", "rich"].entries()) {
  const chat = Number(
    db.prepare("INSERT INTO chats (user_id,character_id,title,created_at) VALUES (?,?,?,datetime('now', ?))").run(U.std, ids[key], `기존 대화 ${idx + 1}`, `-${(idx + 1) * 40} minutes`).lastInsertRowid,
  );
  db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chat, "user", "시작");
  db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chat, "assistant", `서술이 이어졌다. "대사 ${idx + 1}"`);
}
db.prepare("INSERT INTO user_personas (user_id,name,description) VALUES (?,?,?)").run(U.std, "기본 페르소나", "기본");
db.prepare("INSERT INTO user_personas (user_id,name,description) VALUES (?,?,?)").run(U.std, "두 번째 페르소나", "두 번째");

fs.writeFileSync("/tmp/e43d-fixtures.json", JSON.stringify({ tokens, ids }, null, 1));
console.log(JSON.stringify(ids));
