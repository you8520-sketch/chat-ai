import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createChatShortcut, listChatShortcuts } from "@/lib/chatShortcuts";
import { getDb } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  return NextResponse.json({ shortcuts: listChatShortcuts(getDb(), user.id) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await readJson(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const created = createChatShortcut(getDb(), user.id, {
    name: body.value.name,
    description: body.value.description,
    content: body.value.content,
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: created.status });
  return NextResponse.json({ shortcut: created.shortcut }, { status: 201 });
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
