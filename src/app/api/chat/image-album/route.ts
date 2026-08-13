import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  campaignAlbumTitle,
  characterAlbumTitle,
  deleteCampaignAlbumImage,
  deleteCharacterAlbumImage,
  ensureCharacterImageAlbumTable,
  listCampaignAlbum,
  listCharacterAlbum,
  listImageAlbumCatalog,
  saveGeneratedImageToCharacterAlbum,
  type ChatImageAlbumMode,
} from "@/lib/chatImageAlbum";

export const runtime = "nodejs";

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

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const url = new URL(req.url);
    if (url.searchParams.get("catalog") === "1") {
      ensureCharacterImageAlbumTable();
      return NextResponse.json({
        ok: true,
        catalog: listImageAlbumCatalog(user.id),
      });
    }
    const campaignId = positiveInt(url.searchParams.get("campaignId"));
    if (campaignId) {
      return NextResponse.json({
        ok: true,
        kind: "campaign",
        title: campaignAlbumTitle(user.id, campaignId),
        album: listCampaignAlbum(user.id, campaignId),
      });
    }
    const characterId = positiveInt(url.searchParams.get("characterId"));
    if (!characterId) throw new RequestError("캐릭터 정보가 없습니다.");
    assertCharacterVisible(user.id, characterId);
    return NextResponse.json({
      ok: true,
      kind: "character",
      title: characterAlbumTitle(characterId),
      album: listCharacterAlbum(user.id, characterId),
    });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "앨범을 불러오지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const imageUrl = String(body.imageUrl ?? "").trim();
    if (!imageUrl.startsWith("/uploads/") || imageUrl.includes("..")) {
      throw new RequestError("삭제할 이미지 경로가 올바르지 않습니다.");
    }
    const campaignId = positiveInt(body.campaignId);
    if (campaignId) {
      const changes = deleteCampaignAlbumImage({
        userId: user.id,
        campaignId,
        imageUrl,
      });
      if (changes === 0) throw new RequestError("앨범에서 해당 이미지를 찾을 수 없습니다.", 404);
      return NextResponse.json({
        ok: true,
        deleted: true,
        album: listCampaignAlbum(user.id, campaignId),
      });
    }
    const characterId = positiveInt(body.characterId);
    if (!characterId) throw new RequestError("캐릭터 정보가 없습니다.");
    assertCharacterVisible(user.id, characterId);
    const changes = deleteCharacterAlbumImage({
      userId: user.id,
      characterId,
      imageUrl,
    });
    if (changes === 0) throw new RequestError("앨범에서 해당 이미지를 찾을 수 없습니다.", 404);
    return NextResponse.json({
      ok: true,
      deleted: true,
      album: listCharacterAlbum(user.id, characterId),
    });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "앨범 삭제에 실패했습니다.";
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
    ensureCharacterImageAlbumTable();

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
    const campaignId = positiveInt(options.campaignId);
    const campaignTitle =
      typeof options.campaignTitle === "string" ? options.campaignTitle.trim() : "";

    saveGeneratedImageToCharacterAlbum({
      userId: user.id,
      characterId,
      personaId: generation.persona_id,
      chatId: generation.chat_id,
      generationId: generation.id,
      imageUrl,
      mode,
      campaignId,
      campaignTitle: campaignTitle || null,
    });

    return NextResponse.json({
      ok: true,
      saved: true,
      album: campaignId
        ? listCampaignAlbum(user.id, campaignId)
        : listCharacterAlbum(user.id, characterId),
    });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "앨범 저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}
