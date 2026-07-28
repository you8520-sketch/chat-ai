import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseCharacterGender } from "@/lib/characterGender";
import {
  ensureDefaultPersona,
  getPersonaById,
  listUserPersonas,
  PERSONA_IMAGE_FOCUS_DEFAULT,
  sanitizePersonaImageFocus,
  sanitizePersonaImageUrl,
  sanitizePersonaInput,
  validatePersonaContentLength,
  validatePersonaSecretContentLength,
} from "@/lib/userPersonas";
import { USER_PERSONA_MAX_COUNT } from "@/lib/persona";
import { isPersonaSecretBoundaryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import { savePersonaWithSecretCompilation } from "@/lib/personaSaveWithSecrets";

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
  const { name, memo, gender, description, secret_description } = sanitizePersonaInput(
    String(body.name ?? ""),
    String(body.description ?? ""),
    String(body.memo ?? ""),
    body.gender,
    String(body.secret_description ?? "")
  );
  const imageUrl = sanitizePersonaImageUrl(body.image_url);
  const imageFocusX = sanitizePersonaImageFocus(
    body.image_focus_x,
    PERSONA_IMAGE_FOCUS_DEFAULT.x
  );
  const imageFocusY = sanitizePersonaImageFocus(
    body.image_focus_y,
    PERSONA_IMAGE_FOCUS_DEFAULT.y
  );

  if (!name) {
    return NextResponse.json({ error: "페르소나 이름을 입력하세요." }, { status: 400 });
  }
  if (body.image_url != null && String(body.image_url).trim() && !imageUrl) {
    return NextResponse.json({ error: "대표 이미지 URL이 올바르지 않습니다." }, { status: 400 });
  }

  const contentCheck = validatePersonaContentLength(description);
  if (!contentCheck.ok) {
    return NextResponse.json({ error: contentCheck.error }, { status: 400 });
  }
  const boundaryOn = isPersonaSecretBoundaryEnabled({ userId: user.id });
  const secretCheck = validatePersonaSecretContentLength(secret_description);
  if (!secretCheck.ok) {
    return NextResponse.json({ error: secretCheck.error }, { status: 400 });
  }

  const db = getDb();
  const personaCount = (db.prepare("SELECT COUNT(*) AS c FROM user_personas WHERE user_id=?").get(user.id) as {
    c: number;
  }).c;
  if (personaCount >= USER_PERSONA_MAX_COUNT) {
    return NextResponse.json(
      { error: `페르소나는 최대 ${USER_PERSONA_MAX_COUNT.toLocaleString()}개까지 만들 수 있습니다.` },
      { status: 400 }
    );
  }

  const saved = savePersonaWithSecretCompilation({
    userId: user.id,
    fields: {
      name,
      memo,
      gender,
      description,
      secret_description,
      image_url: imageUrl,
      image_focus_x: imageFocusX,
      image_focus_y: imageFocusY,
    },
    db,
  });
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: saved.status });
  }
  const persona = getPersonaById(user.id, saved.personaId);

  return NextResponse.json({
    ok: true,
    persona,
    ...(saved.compile ? { compile: saved.compile } : {}),
    ...(saved.compilePreservedPrior ? { compilePreservedPrior: true } : {}),
  });
}
