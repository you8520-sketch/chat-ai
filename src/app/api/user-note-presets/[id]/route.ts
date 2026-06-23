import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  deleteUserNotePreset,
  getUserNotePresetById,
  sanitizeNotePresetTitle,
  updateUserNotePreset,
  validateNotePresetInput,
} from "@/lib/userNotePresets";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const presetId = Number((await ctx.params).id);
  if (!presetId) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const prev = getUserNotePresetById(user.id, presetId);
  if (!prev) return NextResponse.json({ error: "노트를 찾을 수 없습니다." }, { status: 404 });

  const body = await req.json();
  const title = body.title != null ? sanitizeNotePresetTitle(String(body.title)) : prev.title;
  const content = body.content != null ? String(body.content).trim() : prev.content;
  const check = validateNotePresetInput(title, content);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const preset = updateUserNotePreset(user.id, presetId, { title, content });
  if (!preset) {
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, preset });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const presetId = Number((await ctx.params).id);
  if (!presetId) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const ok = deleteUserNotePreset(user.id, presetId);
  if (!ok) return NextResponse.json({ error: "노트를 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
