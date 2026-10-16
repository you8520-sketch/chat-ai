import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";

/** Isolated E4-4 search/ranking fixtures. Every name, creator and number is fictional. */
const db = getDb();
const DATA_DIR = process.env.DATA_DIR!;
const SEED_ROOT = "/workspace/public/official-supply/style-seeds";
const SEED_IMAGES = [
  "romance-fantasy-cluster-b-v1/holdout/b10-moon-scene.webp",
  "romance-fantasy-cluster-b-v1/holdout/b11-purple-armor.webp",
  "romance-fantasy-cluster-b-v1/holdout/b14-red-eyes-profile.webp",
  "romance-fantasy-cluster-b-v1/holdout/b6-black-gold-smirk.webp",
  "romance-fantasy-cluster-b-v1/primary/b13-black-red-fur.webp",
  "romance-fantasy-cluster-b-v1/primary/b17-sword-flowers.webp",
  "romance-fantasy-cluster-b-v1/primary/b3-blue-window-full.webp",
  "romance-fantasy-cluster-b-v1/primary/b5-red-dress-female.webp",
  "romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform.webp",
  "romance-fantasy-user-owned-v1/catalog/p4-face-armor-metal.webp",
  "romance-fantasy-user-owned-v1/primary/p1-face-rendering.webp",
  "romance-fantasy-user-owned-v1/primary/p2-costume-material-female.webp",
  "romance-fantasy-user-owned-v1/primary/p3-lighting-composition.webp",
  "romance-fantasy-user-owned-v1/holdout/h2-side-profile.webp",
];
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
const IMGS = SEED_IMAGES.map((rel, i) => {
  const name = `e44-${i}.webp`;
  fs.copyFileSync(path.join(SEED_ROOT, rel), path.join(DATA_DIR, "uploads", name));
  return `/uploads/${name}`;
});

const USER_KEYS = ["admin", "safe", "adminSafe", "maleViewer", "creatorA", "creatorB", "creatorC", "creatorLong", "creatorHidden", "creatorD"];
const EMAILS = USER_KEYS.map((k) => `${k.toLowerCase()}@e44.local`);
const old = db
  .prepare(`SELECT id FROM users WHERE email IN (${EMAILS.map(() => "?").join(",")})`)
  .all(...EMAILS) as { id: number }[];
for (const { id } of old) db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
db.prepare("DELETE FROM chats WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@e44.local')").run();
db.prepare("DELETE FROM characters WHERE share_slug LIKE 'e44%' OR tagline LIKE '[e44]%'").run();

function user(key: string, nick: string, o: { admin?: number; nsfwOn?: number; pref?: string | null } = {}): number {
  const email = `${key.toLowerCase()}@e44.local`;
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  const id =
    ex?.id ??
    Number(db.prepare("INSERT INTO users (email,nickname,pw_hash,points) VALUES (?,?,?,?)").run(email, nick, "x", 2000).lastInsertRowid);
  db.prepare("UPDATE users SET nickname=?, is_adult=1, is_admin=?, nsfw_on=?, pref=? WHERE id=?").run(
    nick,
    o.admin ?? 0,
    o.nsfwOn ?? 0,
    o.pref ?? null,
    id,
  );
  return id;
}

const U: Record<string, number> = {
  admin: user("admin", "성인열람관리자", { admin: 1, nsfwOn: 1 }),
  safe: user("safe", "일반열람자"),
  adminSafe: user("adminSafe", "세이프티켠관리자", { admin: 1, nsfwOn: 0 }),
  maleViewer: user("maleViewer", "남성취향열람자", { pref: "male" }),
  creatorA: user("creatorA", "공방지기"),
  creatorD: user("creatorD", "새벽공방"),
  creatorB: user("creatorB", "달빛서점"),
  creatorC: user("creatorC", "은하작업실"),
  creatorLong: user("creatorLong", "아주아주아주긴이름을가진크리에이터의작업실이름입니다"),
  creatorHidden: user("creatorHidden", "숨은작업실"),
};

const ADJ = ["새벽", "달빛", "은하", "유리", "잿빛", "붉은", "푸른", "고요한", "검은", "금빛"];
const ADJ_BULK = ADJ.slice(1);
const NOUN = ["정원사", "도서관지기", "기사", "연금술사", "사서", "항해사", "조향사", "시계공", "낭독가", "수호자"];
const GENRES = ["로맨스", "로맨스 판타지", "현대 판타지", "판타지", "무협", "SF", "학원", "동양풍", "BL"];

let seq = 0;
type Work = {
  name: string;
  creator?: number;
  creatorName?: string;
  genre?: string;
  tags?: string[];
  nsfw?: number;
  official?: number;
  vis?: "public" | "link" | "private";
  mod?: "pending" | "approved" | "rejected";
  kind?: "character" | "simulation";
  audience?: "all" | "female" | "male";
  img?: number | null;
  turns?: number;
  likes?: number;
  tagline?: string;
};

function work(w: Work): number {
  seq += 1;
  const vis = w.vis ?? "public";
  const mod = w.mod ?? "approved";
  const imgs = w.img == null ? [] : [IMGS[w.img % IMGS.length]];
  const genre = w.genre ?? GENRES[seq % GENRES.length];
  const created = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + seq * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
  const creatorId = w.official ? null : (w.creator ?? U.creatorA);
  const creatorName = w.creatorName ?? (w.official ? "하브 공식" : (db.prepare("SELECT nickname FROM users WHERE id=?").get(creatorId) as { nickname: string }).nickname);
  const r = db
    .prepare(
      `INSERT INTO characters (name, tagline, description, greeting, system_prompt, world, genre, genres, tags, nsfw, official, emoji, hue,
         creator_id, creator_name, visibility, moderation_status, share_slug, images, assets, total_turns, chats_count,
         audience, likes, gender, participant_min_age, creator_comment, content_kind, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,0,?,?,'male',27,'',?,?)`,
    )
    .run(
      w.name,
      w.tagline ?? `[e44] ${w.name.slice(0, 22)}의 한 줄 소개입니다. 조용히 곁에 머무는 이야기.`,
      "설명",
      "안녕",
      "prompt",
      "world",
      genre,
      JSON.stringify([genre]),
      JSON.stringify(w.tags ?? []),
      w.nsfw ?? 0,
      w.official ?? 0,
      w.kind === "simulation" ? "🎭" : "✨",
      (seq * 37) % 360,
      creatorId,
      creatorName,
      vis,
      mod,
      vis === "link" ? `e44${seq}` : null,
      JSON.stringify(imgs),
      w.turns ?? 0,
      w.audience ?? "all",
      w.likes ?? (seq * 7) % 120,
      w.kind ?? "character",
      created,
    );
  return Number(r.lastInsertRowid);
}

const LONG_NAME =
  "새벽의 끝에서 아주 오래된 도서관의 마지막 사서가 되어 잊혀진 이야기를 지키는 이름이 정말 긴 작품 제목입니다";

// ---------- search: 새벽 (name 10 / creator 3 / tag 3) ----------
const search: Record<string, number> = {};
NOUN.forEach((n, i) => {
  search[`name${i}`] = work({
    name: `새벽 ${n}`,
    creator: [U.creatorB, U.creatorC][i % 2],
    tags: i % 3 === 0 ? ["다정", "잔잔한"] : ["신비", "일상"],
    img: i,
    turns: 3000 - i * 11,
    likes: 90 - i,
  });
});
const creatorMatch = [0, 1, 2].map((i) =>
  work({ name: `공방의 ${ADJ[i + 1]} ${NOUN[i + 2]}`, creator: U.creatorD, tags: ["공방"], img: i + 3, turns: 400 + i, likes: 40 - i }),
);
const tagMatch = [0, 1, 2].map((i) =>
  work({ name: `${ADJ[i + 4]} ${NOUN[i + 1]}`, creator: U.creatorC, tags: ["새벽", "여운"], img: i + 6, turns: 300 + i, likes: 30 - i }),
);
work({ name: LONG_NAME, creator: U.creatorLong, tags: ["새벽"], img: 2, turns: 120, likes: 5 });
work({ name: "새벽 길이테스트", creator: U.creatorLong, tags: ["긴제작자"], img: null, turns: 90, likes: 4 });
// official + adult combos for badge overlap review
work({ name: "새벽의 공식 안내인", official: 1, tags: ["새벽"], img: 8, turns: 8800, likes: 110, genre: "로맨스 판타지" });
work({ name: "새벽 성인 공식 캐릭터", official: 1, nsfw: 1, tags: ["새벽"], img: 4, turns: 8600, likes: 100, genre: "로맨스" });
work({ name: "새벽 성인 사용자 캐릭터", nsfw: 1, creator: U.creatorB, tags: ["새벽"], img: 10, turns: 700, likes: 60, genre: "BL" });
work({ name: "새벽 시뮬레이션 하우스", kind: "simulation", creator: U.creatorC, tags: ["새벽"], img: 12, turns: 650, likes: 59, genre: "시뮬레이션" });
work({ name: "새벽 여성향 전용", audience: "female", creator: U.creatorB, tags: ["새벽"], img: 7, turns: 640, likes: 58, genre: "로맨스" });
// hidden from every listing
work({ name: "새벽 비공개 초안", vis: "private", creator: U.creatorHidden, tags: ["새벽"], img: 1 });
work({ name: "새벽 링크 공개 작품", vis: "link", creator: U.creatorHidden, tags: ["새벽"], img: 2 });
work({ name: "새벽 검수 대기 작품", mod: "pending", creator: U.creatorHidden, tags: ["새벽"], img: 3 });
work({ name: "새벽 반려된 작품", mod: "rejected", creator: U.creatorHidden, tags: ["새벽"], img: 4 });

// ---------- search: many (판타지 tag, 75 public) ----------
for (let i = 0; i < 75; i++) {
  work({
    name: `${ADJ_BULK[i % 9]} ${NOUN[Math.floor(i / 9) % 10]} ${i + 1}`,
    creator: [U.creatorA, U.creatorB, U.creatorC][i % 3],
    tags: ["판타지", i % 2 ? "모험" : "마법"],
    genre: i % 4 === 0 ? "판타지" : "현대 판타지",
    img: i % 5 === 4 ? null : i,
    turns: 200 + i,
    likes: 20 + (i % 30),
  });
}
// genre-only data
for (let i = 0; i < 5; i++) work({ name: `강호 ${NOUN[i]}`, creator: U.creatorB, genre: "무협", tags: ["강호"], img: i + 2, turns: 160 + i, likes: 50 - i });
work({ name: "궤도 정거장의 사서", creator: U.creatorC, genre: "SF", tags: ["우주"], img: 6, turns: 140, likes: 33 });

// ---------- ranking: dedicated top list with ties ----------
const RANK_TURNS = [9800, 9100, 8700, 8700, 8200, 7600, 7000, 6400, 6400, 6400, 5200];
const rank: number[] = [];
for (let i = 0; i < 56; i++) {
  const turns = i < RANK_TURNS.length ? RANK_TURNS[i] : Math.max(10, 5000 - (i - RANK_TURNS.length) * 97);
  const id = work({
    name:
      i === 1
        ? "이름이 아주 길어서 두 줄이나 세 줄로 줄바꿈되어야 하는 랭킹 상위 작품의 제목입니다"
        : `${ADJ_BULK[(i * 3) % 9]} ${NOUN[(i * 7) % 10]}의 랭킹 ${i + 1}`,
    creator: [U.creatorA, U.creatorB, U.creatorC][i % 3],
    genre: GENRES[i % GENRES.length],
    tags: ["랭킹"],
    img: i === 5 || i === 12 ? null : i,
    turns,
    likes: i >= 2 && i <= 3 ? 80 - i : i >= 7 && i <= 9 ? 70 - i : 60 - (i % 40),
    official: i === 3 ? 1 : 0,
    nsfw: i === 4 ? 1 : 0,
    kind: i === 8 ? "simulation" : "character",
    tagline: `[e44] ${i === 0 ? "가장 많이 사랑받는 작품. 한 번 시작하면 끝까지 듣게 되는 이야기." : "조용히 곁에 머무는 이야기를 건넵니다."}`,
  });
  rank.push(id);
}

// ---------- period activity (chats rows) ----------
function chatsFor(characterId: number, n: number, hoursAgoMax: number) {
  const ins = db.prepare("INSERT INTO chats (user_id, character_id, created_at) VALUES (?,?,?)");
  for (let k = 0; k < n; k++) {
    const h = ((k + 1) / (n + 1)) * hoursAgoMax;
    const at = new Date(Date.now() - h * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
    ins.run(U.safe, characterId, at);
  }
}
// realtime (<6h): 5 characters; daily (<24h): 9; weekly (<168h): 14; monthly (<720h): 20 — ties included
const periodPlan: Array<[number, number, number]> = [
  [rank[3], 14, 5],
  [rank[0], 12, 5],
  [rank[7], 9, 5],
  [rank[1], 9, 5],
  [rank[20], 4, 5],
  [rank[2], 20, 20],
  [rank[10], 16, 22],
  [rank[30], 11, 23],
  [rank[40], 6, 23],
  [rank[5], 30, 160],
  [rank[15], 26, 150],
  [rank[25], 22, 140],
  [rank[35], 18, 120],
  [rank[45], 12, 100],
  [rank[50], 8, 90],
  [rank[6], 35, 700],
  [rank[16], 31, 650],
  [rank[26], 25, 600],
  [rank[36], 19, 500],
  [rank[46], 9, 400],
];
for (const [id, n, h] of periodPlan) chatsFor(id, n, h);

const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(tok, uid, new Date(Date.now() + 30 * 864e5).toISOString());
  tokens[k] = tok;
}
const byName = (n: string) => (db.prepare("SELECT id FROM characters WHERE name=?").get(n) as { id: number } | undefined)?.id;
fs.writeFileSync(
  "/tmp/e44-fixtures.json",
  JSON.stringify({ tokens, users: U, rank, search: { ...search, creatorMatch, tagMatch }, longName: byName(LONG_NAME) }, null, 1),
);
console.log(JSON.stringify({ chars: (db.prepare("SELECT COUNT(*) c FROM characters WHERE tagline LIKE '[e44]%'").get() as { c: number }).c, rank: rank.length }));
