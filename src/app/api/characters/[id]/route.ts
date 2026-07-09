import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseAssets } from "@/lib/characterAssets";
import { parseCharacterGender } from "@/lib/characterGender";
import { sanitizeCharacterGenres } from "@/lib/characterGenres";
import { normalizeCreatorRecommendedStyle } from "@/lib/writingStylePreset";
import { speechCreatorFromLegacyExampleDialog } from "@/lib/speechCreatorFields";
import {
  updateCharacterFromForm,
  updateCharacterPublicProfileFromForm,
} from "@/lib/characterFormSave";
import { deleteUserCharacter } from "@/lib/deleteCharacter";
import { listCharacterStatusWidgetTriggers } from "@/lib/statusWidgetTriggers";

type RouteCtx = { params: Promise<{ id: string }> };

function assertOwnerCharacter(characterId: number, userId: number) {
  const db = getDb();
  return db
    .prepare("SELECT id, creator_id, official FROM characters WHERE id=?")
    .get(characterId) as { id: number; creator_id: number | null; official: number } | undefined;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await ctx.params;
  const characterId = Number(id);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "잘못된 캐릭터 ID입니다." }, { status: 400 });
  }

  const row = assertOwnerCharacter(characterId, user.id);
  if (!row) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  if (row.creator_id !== user.id) {
    return NextResponse.json({ error: "본인 캐릭터만 수정할 수 있습니다." }, { status: 403 });
  }
  if (row.official === 1) {
    return NextResponse.json({ error: "공식 캐릭터는 수정할 수 없습니다." }, { status: 403 });
  }

  const db = getDb();
  const c = db
    .prepare(
      `SELECT id, name, tagline, description, greeting, system_prompt, world, world_id, lorebook_id, example_dialog, status_window_prompt, status_widget_json,
              genres, tags, nsfw, emoji, hue, audience, gender, visibility, assets, recommended_writing_style, comments_enabled, creator_comment
       FROM characters WHERE id=?`
    )
    .get(characterId) as {
    id: number;
    name: string;
    tagline: string;
    description: string;
    greeting: string;
    system_prompt: string;
    world: string;
    world_id: number | null;
    lorebook_id: number | null;
    example_dialog: string;
    status_window_prompt: string;
    status_widget_json: string;
    genres: string;
    tags: string;
    nsfw: number;
    emoji: string;
    hue: number;
    audience: string;
    gender: string;
    visibility: string;
    assets: string;
    recommended_writing_style: string;
    comments_enabled: number;
    creator_comment: string;
  };

  let genres: ReturnType<typeof sanitizeCharacterGenres> = [];
  try {
    const parsed = JSON.parse(c.genres || "[]");
    if (Array.isArray(parsed)) genres = sanitizeCharacterGenres(parsed);
  } catch {
    /* ignore */
  }

  let tagList: string[] = [];
  try {
    tagList = JSON.parse(c.tags || "[]");
    if (!Array.isArray(tagList)) tagList = [];
  } catch {
    tagList = [];
  }

  const speech = speechCreatorFromLegacyExampleDialog(c.example_dialog ?? "");
  const assets = parseAssets(c.assets);
  const statusWidgetTriggers = listCharacterStatusWidgetTriggers(db, c.id);

  return NextResponse.json({
    id: c.id,
    name: c.name,
    tagline: c.tagline,
    description: c.description,
    greeting: c.greeting,
    system_prompt: c.system_prompt,
    world: c.world ?? "",
    world_id: c.world_id,
    lorebook_id: c.lorebook_id,
    status_window_prompt: c.status_window_prompt ?? "",
    status_widget_json: c.status_widget_json ?? "",
    status_widget_triggers: statusWidgetTriggers,
    speech_personality: speech.speech_personality,
    speech_traits: speech.speech_traits,
    speech_examples: speech.speech_examples,
    speech_forbidden: speech.speech_forbidden,
    speech_contextual_registers: speech.speech_contextual_registers ?? [],
    genres,
    tags: tagList.join(", "),
    nsfw: c.nsfw === 1,
    emoji: c.emoji,
    hue: c.hue,
    audience: c.audience,
    gender: parseCharacterGender(c.gender) ?? "other",
    visibility: c.visibility,
    recommended_writing_style: normalizeCreatorRecommendedStyle(c.recommended_writing_style),
    comments_enabled: c.comments_enabled !== 0,
    creator_comment: c.creator_comment ?? "",
    assets,
  });
}

export async function PUT(req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await ctx.params;
  const characterId = Number(id);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "잘못된 캐릭터 ID입니다." }, { status: 400 });
  }

  const b = await req.json();
  const result = await updateCharacterFromForm(user, characterId, b);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    visibility: result.visibility,
    requestedVisibility: result.requestedVisibility,
    moderationStatus: result.moderationStatus,
    moderationNote: result.moderationNote,
    sharePath: result.sharePath,
    listed: result.listed,
  });
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await ctx.params;
  const characterId = Number(id);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "잘못된 캐릭터 ID입니다." }, { status: 400 });
  }

  const row = assertOwnerCharacter(characterId, user.id);
  if (!row) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  if (row.creator_id !== user.id) {
    return NextResponse.json({ error: "본인 캐릭터만 수정할 수 있습니다." }, { status: 403 });
  }

  const body = await req.json();
  if (body.scope === "public_profile") {
    const result = await updateCharacterPublicProfileFromForm(user, characterId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      id: result.id,
      visibility: result.visibility,
      requestedVisibility: result.requestedVisibility,
      moderationStatus: result.moderationStatus,
      moderationNote: result.moderationNote,
      sharePath: result.sharePath,
      listed: result.listed,
      profileOnly: true,
    });
  }
  if (body.comments_enabled === undefined) {
    return NextResponse.json({ error: "변경할 설정이 없습니다." }, { status: 400 });
  }

  const enabled = body.comments_enabled ? 1 : 0;
  getDb().prepare("UPDATE characters SET comments_enabled=? WHERE id=?").run(enabled, characterId);
  return NextResponse.json({ ok: true, comments_enabled: enabled === 1 });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await ctx.params;
  const characterId = Number(id);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "잘못된 캐릭터 ID입니다." }, { status: 400 });
  }

  const result = deleteUserCharacter(characterId, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
