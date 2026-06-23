import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseCharacterGender } from "@/lib/characterGender";
import {
  ensureDefaultPersona,
  getPersonaById,
  listUserPersonas,
  sanitizePersonaInput,
  validatePersonaContentLength,
} from "@/lib/userPersonas";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const personas = ensureDefaultPersona(user.id, user.nickname);

  return NextResponse.json({ personas });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  if (!parseCharacterGender(body.gender)) {
    return NextResponse.json({ error: "페르소나 성별을 선택하세요." }, { status: 400 });
  }
  const { name, memo, gender, description } = sanitizePersonaInput(
    String(body.name ?? ""),
    String(body.description ?? ""),
    String(body.memo ?? ""),
    body.gender
  );

  if (!name) {
    return NextResponse.json({ error: "페르소나 이름을 입력하세요." }, { status: 400 });
  }

  const contentCheck = validatePersonaContentLength(description);
  if (!contentCheck.ok) {
    return NextResponse.json({ error: contentCheck.error }, { status: 400 });
  }

  const db = getDb();
  const info = db
    .prepare(
      "INSERT INTO user_personas (user_id, name, memo, gender, description, speech_examples) VALUES (?,?,?,?,?,?)"
    )
    .run(user.id, name, memo, gender, description, "");
  const personaId = Number(info.lastInsertRowid);
  const persona = getPersonaById(user.id, personaId);

  return NextResponse.json({ ok: true, persona });
}
