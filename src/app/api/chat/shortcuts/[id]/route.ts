import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { deleteChatShortcut, updateChatShortcut } from "@/lib/chatShortcuts";
import { getDb } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const shortcutId = Number((await params).id);
  const body = await readJson(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const updated = updateChatShortcut(getDb(), user.id, shortcutId, {
    name: body.value.name,
    description: body.value.description,
    content: body.value.content,
    favorite: body.value.favorite,
  });
  if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: updated.status });
  return NextResponse.json({ shortcut: updated.shortcut });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const shortcutId = Number((await params).id);
  const deleted = deleteChatShortcut(getDb(), user.id, shortcutId);
  if (!deleted.ok) return NextResponse.json({ error: deleted.error }, { status: deleted.status });
  return NextResponse.json({ ok: true });
}

async function readJson(
  req: Request
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const value = (await req.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "요청 형식이 올바르지 않습니다." };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: "요청 형식이 올바르지 않습니다." };
  }
}
