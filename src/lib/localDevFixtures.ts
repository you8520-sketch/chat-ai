import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

import { getDataDir, isProductionRuntime } from "@/lib/dataDir";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";

export const LOCAL_UI_FIXTURES_META_KEY = "local_ui_parity_fixtures_v1";
export const LOCAL_UI_LOGIN_PASSWORD = "hav-local-dev";

export const LOCAL_UI_USER_EMAIL = "local-user@hav.invalid";
export const LOCAL_UI_ADMIN_EMAIL = "local-admin@hav.invalid";
export const LOCAL_UI_CREATOR_EMAIL = "local-creator@hav.invalid";
export const LOCAL_UI_OFFICIAL_STUDIO_EMAIL = "official-studio@site-managed.invalid";
export const LOCAL_UI_ROMANCE_STUDIO_EMAIL = "romance-studio@site-managed.invalid";

export const LOCAL_KANG_ID = 13;
export const LOCAL_LUCIAN_ID = 50;
export const LOCAL_SYNTHETIC_ID_START = 9001;
export const LOCAL_SYNTHETIC_COUNT = 18;
export const LOCAL_DRAFT_ID = 9090;
export const LOCAL_FIXTURE_CHAT_TITLE = "[local-fixture] ranking";
export const LOCAL_FIXTURE_WORLD_NAME = "로컬 TRPG 테스트 월드";

const OFFICIAL_PUBLIC_HOST = "https://hav.chat";

const KANG_PUBLIC_IMAGE = {
  filename: "daf5931a-b453-4e53-adc3-c5c018dc0509.png",
  publicPath: "/uploads/daf5931a-b453-4e53-adc3-c5c018dc0509.png",
} as const;

const LUCIAN_PUBLIC_IMAGE = {
  filename: "official-pilot-rf-v4-03__rep-a1.webp",
  publicPath: "/uploads/official-pilot-rf-v4-03__rep-a1.webp",
} as const;

type FixtureUser = {
  email: string;
  nickname: string;
  password: string | null;
  isAdmin: boolean;
  siteManaged: boolean;
  isAdult: boolean;
};

const LOGIN_USERS: FixtureUser[] = [
  {
    email: LOCAL_UI_USER_EMAIL,
    nickname: "로컬유저",
    password: LOCAL_UI_LOGIN_PASSWORD,
    isAdmin: false,
    siteManaged: false,
    isAdult: true,
  },
  {
    email: LOCAL_UI_ADMIN_EMAIL,
    nickname: "로컬관리자",
    password: LOCAL_UI_LOGIN_PASSWORD,
    isAdmin: true,
    siteManaged: false,
    isAdult: true,
  },
  {
    email: LOCAL_UI_CREATOR_EMAIL,
    nickname: "로컬 제작 테스트",
    password: LOCAL_UI_LOGIN_PASSWORD,
    isAdmin: false,
    siteManaged: false,
    isAdult: true,
  },
];

const STUDIO_USERS: FixtureUser[] = [
  {
    email: LOCAL_UI_OFFICIAL_STUDIO_EMAIL,
    nickname: "공식계정",
    password: null,
    isAdmin: false,
    siteManaged: true,
    isAdult: true,
  },
  {
    email: LOCAL_UI_ROMANCE_STUDIO_EMAIL,
    nickname: "로맨스 공식계정",
    password: null,
    isAdmin: false,
    siteManaged: true,
    isAdult: true,
  },
];

const SYNTHETIC_GENRES = [
  "로맨스",
  "로맨스 판타지",
  "현대 판타지",
  "시뮬레이션",
  "현대/일상",
  "학원",
  "판타지",
  "SF",
  "공포/추리",
  "아포칼립스",
] as const;

function isTransientTestDataDir(dir: string): boolean {
  return /(^|\/)tmp-[a-z0-9-]+$/i.test(dir.replace(/\\/g, "/"));
}

export function shouldInstallLocalUiFixtures(): boolean {
  if (process.env.HAV_LOCAL_UI_FIXTURES !== "1") return false;
  if (process.env.NODE_ENV === "test") return false;
  if (isProductionRuntime()) return false;
  const dataDir = path.resolve(getDataDir());
  if (dataDir === "/data") return false;
  if (isTransientTestDataDir(dataDir)) return false;
  return true;
}

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function hashUnusablePassword(): string {
  return hashPassword(crypto.randomBytes(32).toString("hex"));
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { ok: number } | undefined;
  return row?.ok === 1;
}

function columnNames(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((col) => col.name)
  );
}

function upsertUser(db: Database.Database, user: FixtureUser): number {
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(user.email) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE users
       SET nickname=?, is_admin=?, site_managed=?, is_adult=?, nsfw_on=?,
           onboarding_completed_at=COALESCE(onboarding_completed_at, datetime('now'))
       WHERE id=?`
    ).run(user.nickname, user.isAdmin ? 1 : 0, user.siteManaged ? 1 : 0, user.isAdult ? 1 : 0, 0, existing.id);
    return existing.id;
  }

  const pwHash = user.password ? hashPassword(user.password) : hashUnusablePassword();
  const info = db
    .prepare(
      `INSERT INTO users (email, nickname, pw_hash, points, is_adult, nsfw_on, is_admin, site_managed, onboarding_completed_at)
       VALUES (?,?,?,2000,?,?,?,?,datetime('now'))`
    )
    .run(
      user.email,
      user.nickname,
      pwHash,
      user.isAdult ? 1 : 0,
      0,
      user.isAdmin ? 1 : 0,
      user.siteManaged ? 1 : 0
    );
  return Number(info.lastInsertRowid);
}

function representativeAssets(url: string): string {
  return JSON.stringify([
    {
      url,
      tag: "무표정",
      public: true,
      representativeRank: 1,
    },
  ]);
}

function materializeOfficialImage(
  spec: { filename: string; publicPath: string },
  opts?: { allowNetwork?: boolean }
): string {
  const destDir = path.join(getDataDir(), "uploads");
  const dest = path.join(destDir, spec.filename);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return `/uploads/${spec.filename}`;
  }
  if (opts?.allowNetwork === false || process.env.NODE_ENV === "test") {
    return `${OFFICIAL_PUBLIC_HOST}${spec.publicPath}`;
  }
  fs.mkdirSync(destDir, { recursive: true });
  try {
    execFileSync(
      "curl",
      ["-fsSL", "--max-time", "30", "-o", dest, `${OFFICIAL_PUBLIC_HOST}${spec.publicPath}`],
      { stdio: "ignore" }
    );
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      return `/uploads/${spec.filename}`;
    }
  } catch {
    // Keep the official public URL — cards already accept https:// stored assets.
  }
  return `${OFFICIAL_PUBLIC_HOST}${spec.publicPath}`;
}

function upsertCharacter(
  db: Database.Database,
  row: {
    id: number;
    name: string;
    tagline: string;
    description: string;
    greeting: string;
    systemPrompt: string;
    genre: string;
    genres: string[];
    tags: string[];
    nsfw: 0 | 1;
    official: 0 | 1;
    creatorId: number;
    creatorName: string;
    audience: "all" | "female" | "male";
    gender: string;
    likes: number;
    chatsCount: number;
    totalTurns: number;
    images: string;
    assets: string;
    visibility: "public" | "private";
    createdAtOffset?: string;
    contestPick?: number;
    trpgReuse?: number;
  }
): void {
  const cols = columnNames(db, "characters");
  const existing = db.prepare("SELECT id FROM characters WHERE id=?").get(row.id) as
    | { id: number }
    | undefined;
  const payload = {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    greeting: row.greeting,
    system_prompt: row.systemPrompt,
    genre: row.genre,
    genres: JSON.stringify(row.genres),
    tags: JSON.stringify(row.tags),
    nsfw: row.nsfw,
    official: row.official,
    emoji: "✨",
    hue: 260,
    creator_id: row.creatorId,
    creator_name: row.creatorName,
    likes: row.likes,
    chats_count: row.chatsCount,
    audience: row.audience,
    gender: row.gender,
    images: row.images,
    assets: row.assets,
    visibility: row.visibility,
    moderation_status: "approved",
    contest_pick: row.contestPick ?? 0,
    trpg_reuse_allowed: row.trpgReuse ?? (row.official === 1 ? 1 : 0),
    content_kind: "character",
    total_turns: row.totalTurns,
  };

  if (existing) {
    db.prepare(
      `UPDATE characters
       SET name=@name, tagline=@tagline, description=@description, greeting=@greeting,
           system_prompt=@system_prompt, genre=@genre, genres=@genres, tags=@tags,
           nsfw=@nsfw, official=@official, creator_id=@creator_id, creator_name=@creator_name,
           likes=@likes, chats_count=@chats_count, audience=@audience, gender=@gender,
           images=@images, assets=@assets, visibility=@visibility,
           moderation_status=@moderation_status, contest_pick=@contest_pick,
           trpg_reuse_allowed=@trpg_reuse_allowed, content_kind=@content_kind,
           updated_at=datetime('now')
           ${cols.has("total_turns") ? ", total_turns=@total_turns" : ""}
       WHERE id=@id`
    ).run(payload);
  } else {
    db.prepare(
      `INSERT INTO characters (
         id, name, tagline, description, greeting, system_prompt, genre, genres, tags,
         nsfw, official, emoji, hue, creator_id, creator_name, likes, chats_count,
         audience, gender, images, assets, visibility, moderation_status,
         contest_pick, trpg_reuse_allowed, content_kind
         ${cols.has("total_turns") ? ", total_turns" : ""}
       ) VALUES (
         @id, @name, @tagline, @description, @greeting, @system_prompt, @genre, @genres, @tags,
         @nsfw, @official, @emoji, @hue, @creator_id, @creator_name, @likes, @chats_count,
         @audience, @gender, @images, @assets, @visibility, @moderation_status,
         @contest_pick, @trpg_reuse_allowed, @content_kind
         ${cols.has("total_turns") ? ", @total_turns" : ""}
       )`
    ).run(payload);
  }

  if (row.createdAtOffset) {
    db.prepare(`UPDATE characters SET created_at=datetime('now', ?) WHERE id=?`).run(
      row.createdAtOffset,
      row.id
    );
  }
}

function lucianPublicCopy(): {
  name: string;
  tagline: string;
  description: string;
  greeting: string;
  systemPrompt: string;
  genres: string[];
  tags: string[];
  audience: "all" | "female" | "male";
  gender: string;
} {
  const compiled = loadCompiledOfficialCharacterSource("pilot-rf-03");
  return {
    name: compiled.draft.name,
    tagline: compiled.draft.tagline,
    description: compiled.draft.description,
    greeting: compiled.draft.greeting,
    systemPrompt: compiled.systemPrompt,
    genres: compiled.draft.genres,
    tags: compiled.draft.tags,
    audience: compiled.draft.audience,
    gender: compiled.draft.gender,
  };
}

function ensureRankingChat(db: Database.Database, userId: number, characterId: number): void {
  const existing = db
    .prepare("SELECT id FROM chats WHERE user_id=? AND character_id=? AND title=?")
    .get(userId, characterId, LOCAL_FIXTURE_CHAT_TITLE) as { id: number } | undefined;
  if (existing) return;
  db.prepare(
    `INSERT INTO chats (user_id, character_id, title, created_at)
     VALUES (?,?,?,datetime('now'))`
  ).run(userId, characterId, LOCAL_FIXTURE_CHAT_TITLE);
}

function ensureLike(db: Database.Database, userId: number, characterId: number): void {
  db.prepare("INSERT OR IGNORE INTO likes (user_id, character_id) VALUES (?,?)").run(userId, characterId);
}

function ensureChatUser(db: Database.Database, characterId: number, userId: number): void {
  if (!tableExists(db, "character_chat_users")) return;
  db.prepare(
    "INSERT OR IGNORE INTO character_chat_users (character_id, user_id) VALUES (?,?)"
  ).run(characterId, userId);
}

function ensureTrpgWorld(db: Database.Database, creatorId: number): void {
  if (!tableExists(db, "worlds")) return;
  const existing = db
    .prepare("SELECT id FROM worlds WHERE creator_id=? AND name=?")
    .get(creatorId, LOCAL_FIXTURE_WORLD_NAME) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE worlds SET trpg_enabled=1, trpg_visibility='public', updated_at=datetime('now') WHERE id=?`
    ).run(existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres)
     VALUES (?,?,?,?,1,'public','["판타지"]')`
  ).run(
    creatorId,
    LOCAL_FIXTURE_WORLD_NAME,
    "로컬 UI 검증용 공개 TRPG 월드",
    "로컬 개발 환경에서 TRPG 로비·월드 목록을 채우기 위한 합성 월드입니다. 운영 데이터를 복제하지 않았습니다."
  );
}

export type LocalUiFixtureInstallResult = {
  users: Record<string, number>;
  officialIds: number[];
  syntheticIds: number[];
  imageUrls: string[];
};

export function ensureLocalUiFixtures(
  db: Database.Database,
  opts?: { allowNetwork?: boolean }
): LocalUiFixtureInstallResult {
  if (!tableExists(db, "users") || !tableExists(db, "characters") || !tableExists(db, "app_meta")) {
    throw new Error("local UI fixtures require migrated users/characters/app_meta");
  }

  const users: Record<string, number> = {};
  for (const user of [...LOGIN_USERS, ...STUDIO_USERS]) {
    users[user.email] = upsertUser(db, user);
  }

  const officialStudioId = users[LOCAL_UI_OFFICIAL_STUDIO_EMAIL]!;
  const romanceStudioId = users[LOCAL_UI_ROMANCE_STUDIO_EMAIL]!;
  const creatorId = users[LOCAL_UI_CREATOR_EMAIL]!;
  const localUserId = users[LOCAL_UI_USER_EMAIL]!;

  const kangImage = materializeOfficialImage(KANG_PUBLIC_IMAGE, opts);
  const lucianImage = materializeOfficialImage(LUCIAN_PUBLIC_IMAGE, opts);
  const lucian = lucianPublicCopy();

  upsertCharacter(db, {
    id: LOCAL_KANG_ID,
    name: "강이현",
    tagline: "아포칼립스의 루트 브로커",
    description: "아포칼립스의 루트 브로커.",
    greeting: "아포칼립스의 루트 브로커, 강이현이다.",
    systemPrompt:
      "너는 공개된 공식 캐릭터 강이현이다. 아포칼립스의 루트 브로커로 짧게 대답한다. 로컬 UI 검증용 공개 메타데이터만 사용한다.",
    genre: "아포칼립스",
    genres: ["아포칼립스"],
    tags: ["공식", "아포칼립스"],
    nsfw: 0,
    official: 0,
    creatorId: officialStudioId,
    creatorName: "공식계정",
    audience: "all",
    gender: "male",
    likes: 120,
    chatsCount: 4,
    totalTurns: 40,
    images: JSON.stringify([kangImage]),
    assets: representativeAssets(kangImage),
    visibility: "public",
    trpgReuse: 1,
  });

  upsertCharacter(db, {
    id: LOCAL_LUCIAN_ID,
    name: lucian.name,
    tagline: lucian.tagline,
    description: lucian.description,
    greeting: lucian.greeting,
    systemPrompt: lucian.systemPrompt,
    genre: lucian.genres[0] ?? "로맨스 판타지",
    genres: lucian.genres,
    tags: lucian.tags.length > 0 ? lucian.tags : ["공식", "로맨스 판타지"],
    nsfw: 0,
    official: 1,
    creatorId: romanceStudioId,
    creatorName: "로맨스 공식계정",
    audience: lucian.audience,
    gender: lucian.gender,
    likes: 96,
    chatsCount: 3,
    totalTurns: 28,
    images: JSON.stringify([lucianImage]),
    assets: representativeAssets(lucianImage),
    visibility: "public",
    trpgReuse: 1,
  });

  const syntheticIds: number[] = [];
  for (let i = 0; i < LOCAL_SYNTHETIC_COUNT; i += 1) {
    const id = LOCAL_SYNTHETIC_ID_START + i;
    const genre = SYNTHETIC_GENRES[i % SYNTHETIC_GENRES.length]!;
    const dayOffset = i;
    upsertCharacter(db, {
      id,
      name: `로컬 신작 ${String(i + 1).padStart(2, "0")}`,
      tagline: `${genre} 합성 테스트 카드`,
      description: `로컬 UI 밀도 검증용 합성 캐릭터입니다. 다른 사용자의 콘텐츠가 아닙니다. 장르: ${genre}.`,
      greeting: `로컬 합성 캐릭터 ${i + 1}이다. 테스트용 인사만 한다.`,
      systemPrompt: "너는 로컬 합성 테스트 캐릭터다. 짧게 대답하고 운영 데이터를 흉내 내지 않는다.",
      genre,
      genres: [genre],
      tags: ["로컬", "합성", genre],
      nsfw: 0,
      official: 0,
      creatorId,
      creatorName: "로컬 제작 테스트",
      audience: "all",
      gender: "other",
      likes: 40 - i,
      chatsCount: 1,
      totalTurns: 6,
      images: "[]",
      assets: "[]",
      visibility: "public",
      createdAtOffset: `-${dayOffset} days`,
      trpgReuse: 1,
    });
    syntheticIds.push(id);
  }

  upsertCharacter(db, {
    id: LOCAL_DRAFT_ID,
    name: "로컬 초안 캐릭터",
    tagline: "제작·미리보기 검증용 비공개 초안",
    description: "로컬 제작자 계정 소유의 비공개 초안입니다. 목록에 노출되지 않아야 합니다.",
    greeting: "아직 공개하지 않은 초안이다.",
    systemPrompt: "너는 로컬 비공개 초안이다.",
    genre: "현대/일상",
    genres: ["현대/일상"],
    tags: ["로컬", "초안"],
    nsfw: 0,
    official: 0,
    creatorId,
    creatorName: "로컬 제작 테스트",
    audience: "all",
    gender: "other",
    likes: 0,
    chatsCount: 0,
    totalTurns: 0,
    images: "[]",
    assets: "[]",
    visibility: "private",
  });
  db.prepare("UPDATE characters SET visibility='private', official=0 WHERE id=?").run(LOCAL_DRAFT_ID);

  ensureRankingChat(db, localUserId, LOCAL_KANG_ID);
  ensureRankingChat(db, localUserId, LOCAL_LUCIAN_ID);
  ensureRankingChat(db, localUserId, LOCAL_SYNTHETIC_ID_START);
  ensureLike(db, localUserId, LOCAL_KANG_ID);
  ensureLike(db, localUserId, LOCAL_LUCIAN_ID);
  ensureChatUser(db, LOCAL_KANG_ID, localUserId);
  ensureChatUser(db, LOCAL_LUCIAN_ID, localUserId);
  ensureTrpgWorld(db, localUserId);

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, '1')").run(
    LOCAL_UI_FIXTURES_META_KEY
  );

  return {
    users,
    officialIds: [LOCAL_KANG_ID, LOCAL_LUCIAN_ID],
    syntheticIds,
    imageUrls: [kangImage, lucianImage],
  };
}
