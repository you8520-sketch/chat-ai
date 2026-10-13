import crypto from "crypto";
import fs from "fs";
import { getDb } from "@/lib/db";

/** Isolated E4-3H creator-dashboard fixtures. Every name, number and account is fictional. */
const db = getDb();

const EMAILS = ["newbie", "below", "sprout", "standard", "pro", "blocked", "pending", "other"].map(
  (k) => `${k}@e43h.local`,
);
const ids = db
  .prepare(`SELECT id FROM users WHERE email IN (${EMAILS.map(() => "?").join(",")})`)
  .all(...EMAILS) as { id: number }[];
for (const { id } of ids) {
  db.prepare("DELETE FROM creator_earnings WHERE creator_id=?").run(id);
  db.prepare("DELETE FROM creator_point_logs WHERE user_id=?").run(id);
  db.prepare("DELETE FROM withdrawal_requests WHERE user_id=?").run(id);
  db.prepare("DELETE FROM creator_notices WHERE creator_id=?").run(id);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
  db.prepare("DELETE FROM characters WHERE creator_id=?").run(id);
}

type UserOpts = {
  adult: number;
  cp: number;
  realName?: string;
  html?: string;
  commentsOn?: number;
  likesOn?: number;
  profileCommentsOn?: number;
};
function user(key: string, nick: string, o: UserOpts): number {
  const email = `${key}@e43h.local`;
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  const id =
    ex?.id ??
    Number(
      db
        .prepare("INSERT INTO users (email,nickname,pw_hash,points) VALUES (?,?,?,?)")
        .run(email, nick, "x", 12840).lastInsertRowid,
    );
  db.prepare(
    `UPDATE users SET nickname=?, is_adult=?, real_name=?, creator_points=?, creator_profile_html=?,
       creator_comments_enabled=?, notify_character_likes=?, notify_profile_comments=?, is_admin=0 WHERE id=?`,
  ).run(
    nick,
    o.adult,
    o.realName ?? "",
    o.cp,
    o.html ?? "",
    o.commentsOn ?? 1,
    o.likesOn ?? 1,
    o.profileCommentsOn ?? 1,
    id,
  );
  return id;
}

const IMGS = ["/uploads/g-b.webp", "/uploads/g-poster.webp", "/uploads/g-b2.webp", "/uploads/g-3.webp", "/uploads/g-4.webp"];
let msgSeq = 9_000_000;
type Char = { name: string; pub?: boolean; chats?: number; img?: number; emoji?: string; hue?: number };
type Earn = { day: number; week: number; month: number };

function char(creator: number, nick: string, c: Char, earn: Earn | null, rate: number): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO characters (name, tagline, description, greeting, system_prompt, world, genres, tags, nsfw, official, emoji, hue,
           creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, chats_count, audience, likes,
           gender, participant_min_age, creator_comment)
         VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,'[]',0,?,'all',?,'male',27,'')`,
      )
      .run(
        c.name,
        "소개",
        "설명",
        "안녕",
        "prompt",
        "world",
        "[]",
        "[]",
        c.emoji ?? "✨",
        c.hue ?? 260,
        creator,
        nick,
        c.pub === false ? "private" : "public",
        c.pub === false ? "pending" : "approved",
        c.img == null ? "[]" : JSON.stringify([IMGS[c.img % IMGS.length]]),
        c.chats ?? 120,
        (c.chats ?? 120) % 97,
      ).lastInsertRowid,
  );
  if (earn) {
    const rows: [string, number][] = [
      ["now", earn.day],
      ["-2 days", earn.week],
      ["-10 days", earn.month],
    ];
    for (const [offset, spent] of rows) {
      if (spent <= 0) continue;
      db.prepare(
        `INSERT INTO creator_earnings (creator_id, character_id, message_id, consumer_user_id, points_spent, reward_amount, reversed, created_at)
         VALUES (?,?,?,?,?,?,0,datetime('now', ?))`,
      ).run(creator, id, msgSeq++, 1, spent, Math.round(spent * rate * 10) / 10, offset === "now" ? "-1 hours" : offset);
    }
  }
  return id;
}

function reversedEarning(creator: number, characterId: number, spent: number, rate: number) {
  db.prepare(
    `INSERT INTO creator_earnings (creator_id, character_id, message_id, consumer_user_id, points_spent, reward_amount, reversed, created_at)
     VALUES (?,?,?,?,?,?,1,datetime('now','-1 days'))`,
  ).run(creator, characterId, msgSeq++, 1, spent, Math.round(spent * rate * 10) / 10);
}

function withdrawal(
  uid: number,
  cp: number,
  status: "PENDING" | "APPROVED" | "REJECTED" | "FAILED",
  daysAgo: number,
  holder: string,
) {
  const tax = Math.round(cp * 0.033);
  const fee = Math.round(cp * (0.2 - 0.033));
  const info = JSON.stringify({
    bankName: "가상은행",
    accountNumber: "000000000000",
    accountHolder: holder,
    accountMasked: "********0000",
  });
  db.prepare(
    `INSERT INTO withdrawal_requests (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, created_at, processed_at)
     VALUES (?,?,?,?,?,?,?,datetime('now', ?), CASE WHEN ? = 'PENDING' THEN NULL ELSE datetime('now', ?) END)`,
  ).run(uid, cp, tax, fee, cp - tax - fee, info, status, `-${daysAgo} days`, status, `-${Math.max(0, daysAgo - 3)} days`);
}

function log(uid: number, delta: number, reason: string) {
  db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(uid, delta, reason);
}

function notice(uid: number, title: string, content: string, daysAgo: number) {
  db.prepare(
    "INSERT INTO creator_notices (creator_id, title, content, created_at, updated_at) VALUES (?,?,?,datetime('now',?),datetime('now',?))",
  ).run(uid, title, content, `-${daysAgo} days`, `-${daysAgo} days`);
}

const LONG_HTML =
  "<h2>안녕하세요, 가상 제작자입니다</h2>" +
  "<p>세계관과 캐릭터 제작 방향을 소개합니다. 이 문장은 레이아웃 확인을 위한 가상의 긴 소개문입니다.</p>".repeat(24) +
  "<ul><li>주 1회 업데이트</li><li>피드백 환영</li></ul>";

const U = {
  newbie: user("newbie", "처음제작자", { adult: 0, cp: 0 }),
  below: user("below", "조건미달제작자", { adult: 1, cp: 0, realName: "김가상" }),
  sprout: user("sprout", "새싹제작자", { adult: 1, cp: 1250.5, realName: "이가상" }),
  standard: user("standard", "일반제작자", {
    adult: 1,
    cp: 45_000,
    realName: "박가상",
    html: "<h2>일반 제작자</h2><p>가상 소개입니다.</p>",
  }),
  pro: user("pro", "프로제작자", { adult: 1, cp: 3_250_000.5, realName: "최가상", html: LONG_HTML, commentsOn: 0, likesOn: 1, profileCommentsOn: 0 }),
  blocked: user("blocked", "출금불가제작자", { adult: 0, cp: 12_000, realName: "" }),
  pending: user("pending", "지급대기제작자", { adult: 1, cp: 80_000, realName: "정가상" }),
  other: user("other", "다른제작자", { adult: 1, cp: 777_777, realName: "한가상" }),
};

// 조건 미달: 캐릭터 1개 (새싹 조건 캐릭터 2개 미만) / 수익 없음
char(U.below, "조건미달제작자", { name: "첫 번째 캐릭터", pub: false, chats: 3 }, null, 0);

// 새싹: 캐릭터 3개, 공개 1개
const spr = [
  char(U.sprout, "새싹제작자", { name: "달빛 서점의 주인", chats: 420, img: 0 }, { day: 300, week: 1800, month: 2400 }, 0.04),
  char(U.sprout, "새싹제작자", { name: "비공개 초안", pub: false, chats: 5 }, null, 0.04),
  char(U.sprout, "새싹제작자", { name: "별빛 도서관 사서", pub: false, chats: 12, img: 1 }, { day: 0, week: 0, month: 700 }, 0.04),
];
log(U.sprout, 96, "earn");
log(U.sprout, 72, "earn");

// 일반: 공개 3개, 통합 대화 5천 이상
const stdChars = [
  char(U.standard, "일반제작자", { name: "서쪽 항구의 고서 수선공", chats: 3200, img: 0, hue: 200 }, { day: 5200, week: 38_000, month: 91_000 }, 0.08),
  char(U.standard, "일반제작자", { name: "겨울 궁정의 서기관", chats: 2400, img: 1, hue: 330 }, { day: 0, week: 21_000, month: 64_000 }, 0.08),
  char(U.standard, "일반제작자", { name: "아침 시장 약초상", chats: 900, img: 2, hue: 120 }, { day: 800, week: 3_000, month: 12_000 }, 0.08),
  char(U.standard, "일반제작자", { name: "수익 없는 신작", chats: 12, img: 3, hue: 40 }, null, 0.08),
];
reversedEarning(U.standard, stdChars[0], 1200, 0.08);
log(U.standard, 416, "earn");
log(U.standard, -5000, "exchange");
log(U.standard, 128, "earn");
withdrawal(U.standard, 30_000, "APPROVED", 40, "박가상");
withdrawal(U.standard, 31_000, "REJECTED", 25, "박가상");
withdrawal(U.standard, 33_000, "FAILED", 12, "박가상");
notice(U.standard, "11월 업데이트 예고", "신규 캐릭터 두 명을 공개할 예정입니다.", 3);

// 프로: 공개 8개 포함 12개, 매우 긴 이름, 큰 금액
const proNames = [
  "아주 긴 이름의 캐릭터가 한 줄을 넘어가서 두 줄 이상으로 이어지는 경우를 확인하기 위한 예시 캐릭터",
  "폐허가 된 천문대의 마지막 관측자",
  "안개 낀 항구의 밀수업자",
  "왕립 연금술 학회 수석",
  "북쪽 성채의 기사단장",
  "붉은 달 아래의 점술사",
  "도서관 지하의 사서",
  "길 잃은 열차의 차장",
  "비공개 실험작 A",
  "비공개 실험작 B",
  "수익 없는 신작",
  "또 다른 수익 없는 신작",
];
const proEarn: Earn[] = [
  { day: 140_000, week: 900_000, month: 1_700_000 },
  { day: 60_000, week: 410_000, month: 800_000 },
  { day: 0, week: 260_000, month: 520_000 },
  { day: 22_000, week: 90_000, month: 210_000 },
  { day: 0, week: 40_000, month: 90_000 },
  { day: 3_000, week: 12_000, month: 31_000 },
  { day: 0, week: 0, month: 9_000 },
  { day: 0, week: 0, month: 2_000 },
];
proNames.forEach((name, i) => {
  char(
    U.pro,
    "프로제작자",
    { name, pub: i < 8, chats: 21_000 - i * 400, img: i % 5, hue: (i * 47) % 360, emoji: i % 2 ? "🌙" : "📚" },
    proEarn[i] ?? null,
    0.12,
  );
});
log(U.pro, 16_800, "earn");
log(U.pro, -100_000, "exchange");
withdrawal(U.pro, 500_000, "APPROVED", 70, "최가상");
withdrawal(U.pro, 250_000, "APPROVED", 38, "최가상");
notice(U.pro, "공지: 서버 점검 안내", "내일 새벽 2시부터 30분간 캐릭터 응답이 느려질 수 있습니다.", 6);
notice(U.pro, "신작 공개", "세 번째 시리즈를 공개했습니다. 많은 의견 부탁드립니다.\n의견은 댓글로 남겨 주세요.", 2);
notice(U.pro, "아주 긴 제목의 공지가 한 줄을 넘어가서 줄바꿈이 필요한 경우를 확인하기 위한 가상의 제목입니다", "본문", 1);

// 출금 불가: 성인인증 없음, CP 부족
char(U.blocked, "출금불가제작자", { name: "인증 전 캐릭터 A", chats: 2800, img: 4 }, { day: 100, week: 600, month: 1100 }, 0.08);
char(U.blocked, "출금불가제작자", { name: "인증 전 캐릭터 B", chats: 2600, img: 2 }, { day: 0, week: 300, month: 800 }, 0.08);

// 지급 대기: 이미 신청 접수
char(U.pending, "지급대기제작자", { name: "대기 중 캐릭터 A", chats: 3100, img: 0 }, { day: 900, week: 5000, month: 16_000 }, 0.08);
char(U.pending, "지급대기제작자", { name: "대기 중 캐릭터 B", chats: 2900, img: 3 }, { day: 0, week: 2000, month: 6_000 }, 0.08);
withdrawal(U.pending, 60_000, "PENDING", 2, "정가상");

// 다른 제작자: 개인정보 경계 확인용 (다른 사용자에게 노출되면 안 됨)
char(U.other, "다른제작자", { name: "경계 확인 캐릭터", chats: 100, img: 1 }, { day: 0, week: 0, month: 123_456 }, 0.04);

const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(
    tok,
    uid,
    new Date(Date.now() + 864e5).toISOString(),
  );
  tokens[k] = tok;
}
fs.writeFileSync("/tmp/e43h-fixtures.json", JSON.stringify({ tokens, users: U, spr }, null, 1));
console.log(JSON.stringify({ U }));
