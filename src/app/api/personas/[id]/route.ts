import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  getPersonaById,
  sanitizePersonaInput,
  validatePersonaContentLength,
} from "@/lib/userPersonas";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const personaId = Number((await params).id);
  if (!personaId) return NextResponse.json({ error: "잘못된 페르소나 ID입니다." }, { status: 400 });

  const existing = getPersonaById(user.id, personaId);
  if (!existing) return NextResponse.json({ error: "페르소나를 찾을 수 없습니다." }, { status: 404 });

  const body = await req.json();
  const { name, memo, gender, description } = sanitizePersonaInput(
    String(body.name ?? existing.name),
    String(body.description ?? existing.description),
    String(body.memo ?? existing.memo ?? ""),
    body.gender ?? existing.gender
  );

  if (!name) {
    return NextResponse.json({ error: "페르소나 이름을 입력하세요." }, { status: 400 });
  }

  const contentCheck = validatePersonaContentLength(description);
  if (!contentCheck.ok) {
    return NextResponse.json({ error: contentCheck.error }, { status: 400 });
  }

  getDb()
    .prepare(
      "UPDATE user_personas SET name=?, memo=?, gender=?, description=? WHERE id=? AND user_id=?"
    )
    .run(name, memo, gender, description, personaId, user.id);

  const persona = getPersonaById(user.id, personaId);

  return NextResponse.json({ ok: true, persona });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const personaId = Number((await params).id);
  if (!personaId) return NextResponse.json({ error: "잘못된 페르소나 ID입니다." }, { status: 400 });

  const existing = getPersonaById(user.id, personaId);
  if (!existing) return NextResponse.json({ error: "페르소나를 찾을 수 없습니다." }, { status: 404 });

  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) AS c FROM user_personas WHERE user_id=?").get(user.id) as {
    c: number;
  }).c;
  if (count <= 1) {
    return NextResponse.json({ error: "최소 1개의 페르소나가 필요합니다." }, { status: 400 });
  }

  const fallback = db
    .prepare("SELECT id FROM user_personas WHERE user_id=? AND id!=? ORDER BY created_at ASC LIMIT 1")
    .get(user.id, personaId) as { id: number };

  db.prepare("UPDATE chats SET selected_persona_id=? WHERE user_id=? AND selected_persona_id=?").run(
    fallback.id,
    user.id,
    personaId
  );
  db.prepare("DELETE FROM user_personas WHERE id=? AND user_id=?").run(personaId, user.id);

  return NextResponse.json({ ok: true, fallbackPersonaId: fallback.id });
}
