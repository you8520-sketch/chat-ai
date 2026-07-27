import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { ChatImageAlbumMode } from "@/lib/chatImageAlbum";

export const runtime = "nodejs";

type AlbumRow = {
  id: number;
  image_url: string;
  mode: string;
  created_at: string;
};

class RequestError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "RequestError";
  }
}

function positiveInt(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function ensureAlbumTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_image_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER,
      character_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      model TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      result_url TEXT NOT NULL,
      upstream_cost_usd REAL,
      charged_points INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS character_image_album (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      persona_id INTEGER,
      chat_id INTEGER,
      generation_id INTEGER,
      image_url TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'sd',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, character_id, image_url)
    );

    CREATE INDEX IF NOT EXISTS idx_character_image_album_recent
      ON character_image_album(user_id, character_id, created_at DESC, id DESC);
  `);
}

function assertCharacterVisible(userId: number, characterId: number) {
  const character = getDb()
    .prepare("SELECT id, creator_id, visibility FROM characters WHERE id=?")
    .get(characterId) as
    | { id: number; creator_id: number | null; visibility: string }
    | undefined;
  if (!character) throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  if (character.visibility === "private" && character.creator_id !== userId) {
    throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  }
}

function listAlbum(userId: number, characterId: number) {
  return (getDb()
    .prepare(
      `SELECT id, image_url, mode, created_at
       FROM character_image_album
       WHERE user_id=? AND character_id=?
       ORDER BY id DESC
       LIMIT 60`
    )
    .all(userId, characterId) as AlbumRow[]).map((row) => ({
    id: row.id,
    imageUrl: row.image_url,
    mode: (["sd", "emoticon", "couple_stamp", "comic", "illustration"].includes(row.mode)
      ? row.mode
      : "sd") as ChatImageAlbumMode,
    createdAt: row.created_at,
  }));
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const url = new URL(req.url);
    const characterId = positiveInt(url.searchParams.get("characterId"));
    if (!characterId) throw new RequestError("캐릭터 정보가 없습니다.");
    assertCharacterVisible(user.id, characterId);
    ensureAlbumTables();
    return NextResponse.json({
      ok: true,
      album: listAlbum(user.id, characterId),
    });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "앨범을 불러오지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const characterId = positiveInt(body.characterId);
    const imageUrl = String(body.imageUrl ?? "").trim();
    if (!characterId) throw new RequestError("캐릭터 정보가 없습니다.");
    if (!imageUrl.startsWith("/uploads/") || imageUrl.includes("..")) {
      throw new RequestError("저장할 이미지 경로가 올바르지 않습니다.");
    }
    assertCharacterVisible(user.id, characterId);
    ensureAlbumTables();

    const generation = getDb()
      .prepare(
        `SELECT id, persona_id, chat_id, template_id, options_json
         FROM chat_image_generations
         WHERE user_id=? AND character_id=? AND result_url=?
         ORDER BY id DESC LIMIT 1`
      )
      .get(user.id, characterId, imageUrl) as
      | {
          id: number;
          persona_id: number;
          chat_id: number | null;
          template_id: string;
          options_json: string;
        }
      | undefined;
    if (!generation) {
      throw new RequestError("이 계정에서 생성한 이미지만 앨범에 저장할 수 있습니다.", 404);
    }

    let options: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(generation.options_json);
      if (parsed && typeof parsed === "object") options = parsed as Record<string, unknown>;
    } catch {
      options = {};
    }
    const requestedMode = String(options.mode ?? "");
    const mode: ChatImageAlbumMode =
      generation.template_id === "comic_horizontal_2_4" || requestedMode === "comic"
        ? "comic"
        : requestedMode === "illustration"
          ? "illustration"
        : requestedMode === "emoticon"
          ? "emoticon"
          : requestedMode === "couple_stamp"
            ? "couple_stamp"
            : "sd";

    getDb()
      .prepare(
        `INSERT INTO character_image_album (
           user_id, character_id, persona_id, chat_id, generation_id, image_url, mode
         ) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(user_id, character_id, image_url)
         DO UPDATE SET mode=excluded.mode`
      )
      .run(
        user.id,
        characterId,
        generation.persona_id,
        generation.chat_id,
        generation.id,
        imageUrl,
        mode
      );

    return NextResponse.json({
      ok: true,
      saved: true,
      album: listAlbum(user.id, characterId),
    });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "앨범 저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}
