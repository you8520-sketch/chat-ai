import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { sanitizeCreatorHtml } from "../../../src/lib/creatorProfileHtml";

export const galleryIds = {
  regular: 97001, partner: 97002, official: 97003, empty: 97004,
  single: 97005, legacy: 97006, long: 97007, disabled: 97008,
  viewer: 97009, admin: 97010,
} as const;

/** Only an explicitly bootstrapped, isolated Playwright DB may receive these rows. */
export function seedCreatorGalleryFixture(dataDir: string) {
  const resolved = path.resolve(dataDir);
  if (resolved === path.resolve("data") || resolved === "/data") {
    throw new Error("Creator gallery fixture requires an isolated test data directory");
  }
  const dbPath = path.join(resolved, "app.db");
  if (!fs.existsSync(dbPath)) throw new Error("Bootstrap the isolated server before seeding");
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  const portraits = [
    "primary/b7-black-gold-uniform.webp", "primary/b3-blue-window-full.webp",
    "primary/b5-red-dress-female.webp", "primary/b17-sword-flowers.webp",
    "holdout/b6-black-gold-smirk.webp", "holdout/b11-purple-armor.webp",
  ].map((p) => `/official-supply/style-seeds/romance-fantasy-cluster-b-v1/${p}`);
  try {
    db.transaction(() => {
      for (const [kind, id] of Object.entries(galleryIds)) {
        db.prepare("DELETE FROM profile_comments WHERE target_type='creator' AND target_id=?").run(id);
        db.prepare("DELETE FROM creator_notices WHERE creator_id=?").run(id);
        db.prepare("DELETE FROM characters WHERE creator_id=?").run(id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
        db.prepare("DELETE FROM point_logs WHERE user_id=?").run(id);
        db.prepare("DELETE FROM users WHERE id=?").run(id);
        const nickname = kind === "long" ? `달의서재_${"아주긴제작자이름LongName".repeat(7)}`
          : kind === "official" ? "하브 스토리 스튜디오" : kind === "partner" ? "은유의 정원" : "달의 서재";
        const intro = kind === "empty" || kind === "single" ? "" :
          `<p>오래 머물고 싶은 세계와, 쉽게 잊히지 않는 사람을 만듭니다.</p><p>로맨스 판타지 · 느린 관계 · 이야기 속의 선택</p>`;
        const longHtml = `<h3>이야기가 머무는 곳</h3>${"<p>세계의 작은 틈에서 시작하는 이야기를 씁니다. 인물의 마음을 천천히 따라와 주세요.</p>".repeat(12)}<p><a href="https://example.invalid/${"long-link".repeat(20)}">https://example.invalid/${"long-link".repeat(20)}</a></p><pre>${"long-code".repeat(25)}</pre>`;
        db.prepare(`INSERT INTO users (id,email,nickname,pw_hash,is_adult,nsfw_on,is_admin,
          site_managed,creator_exclusive,creator_comments_enabled,creator_profile_html,creator_notice_html,created_at)
          VALUES (?,?,?,'fixture-unusable',1,?,?,?, ?,?,?,?,'2020-01-01 00:00:00')`)
          .run(id, `gallery-${kind}@example.invalid`, nickname, kind === "admin" ? 1 : 0,
            kind === "admin" ? 1 : 0, kind === "official" ? 1 : 0, kind === "partner" ? 1 : 0,
            kind === "disabled" ? 0 : 1, sanitizeCreatorHtml(kind === "long" ? longHtml : intro),
            kind === "legacy" ? sanitizeCreatorHtml(`<h3>레거시 공지</h3><p>새로운 이야기를 준비하고 있습니다.</p>${longHtml}`) : "<p>구조화 공지가 있으면 숨겨지는 레거시 공지</p>");
        if (kind === "empty" || kind === "single") {
          db.prepare("UPDATE users SET creator_notice_html='' WHERE id=?").run(id);
        }
        db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,'2099-01-01 00:00:00')")
          .run(`gallery-fixture-${kind}`, id);
        db.prepare("INSERT INTO point_logs (user_id,delta,reason) VALUES (?,-500,'isolated-gallery-fixture')").run(id);
        const count = kind === "partner" ? 26 : kind === "empty" ? 0 : kind === "single" ? 1 : 8;
        for (let n = 0; n < count; n++) {
          db.prepare(`INSERT INTO characters (id,creator_id,creator_name,name,tagline,genre,tags,
            official,nsfw,likes,visibility,moderation_status,images,created_at)
            VALUES (?,?,?,?,?,'로맨스 판타지','["서사","느린관계"]',?,?,?,'public','approved',?,?)`)
            .run(id * 100 + n, id, nickname, n === 0 && kind === "long" ? "아주긴작품제목LongTitle".repeat(12) :
              ["달빛 아래의 약속", "겨울의 도서관", "정원에 남긴 편지", "검은 별의 기사", "기억의 온도", "새벽을 걷는 사람"][n % 6],
              "서로 다른 계절을 지나, 당신에게 닿는 이야기.", kind === "official" ? 1 : 0,
              n === 1 ? 1 : 0, 1000 - n * 10, JSON.stringify([portraits[n % portraits.length]]),
              `2026-09-${String(28 - (n % 25)).padStart(2, "0")} 12:00:00`);
        }
        // Deliberately high likes: neither private nor pending may leak into the gallery.
        for (const [n, visibility, moderation] of [[80, "private", "approved"], [81, "public", "pending"]] as const) {
          db.prepare(`INSERT INTO characters (id,creator_id,creator_name,name,likes,visibility,moderation_status)
            VALUES (?,?,?,'공개되면 안 되는 작품',99999,?,?)`).run(id * 100 + n, id, nickname, visibility, moderation);
        }
        if (!["empty", "single", "legacy", "viewer", "admin"].includes(kind)) {
          const noticeCount = kind === "official" ? 1 : 3;
          for (let n = 0; n < noticeCount; n++) {
            db.prepare("INSERT INTO creator_notices (creator_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?)")
              .run(id, n === 0 ? "새로운 이야기와 연재 일정 안내" : `지난 소식 ${n}`,
                kind === "long" && n === 0 ? "긴공지링크https://example.invalid/" + "LongNotice".repeat(70) + "\n" + "새로운 이야기의 업데이트 일정을 안내합니다.\n".repeat(35) :
                  "이번 주 금요일, 새로운 이야기가 열립니다. 기다려 주셔서 고맙습니다.\n기존 작품도 천천히 다듬고 있어요.",
                `2026-10-${String(14 - n).padStart(2, "0")} 09:00:00`, "2026-10-14 09:00:00");
          }
        }
        for (const [n, content, privateFlag, blinded] of [
          [0, "이야기의 분위기가 오래 남아요. 다음 작품도 기다릴게요.", 0, 0],
          [1, "비공개 fixture 댓글", 1, 0], [2, "검수 fixture 원문", 0, 1],
        ] as const) {
          db.prepare(`INSERT INTO profile_comments (target_type,target_id,author_id,author_name,content,
            is_private,is_blinded,created_at) VALUES ('creator',?,?,?,?,?,?, '2026-10-10 12:00:00')`)
            .run(id, galleryIds.viewer, "이야기를 걷는 독자", content, privateFlag, blinded);
        }
      }
    })();
  } finally { db.close(); }
}
