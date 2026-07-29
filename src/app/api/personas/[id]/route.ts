import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  getPersonaById,
  PERSONA_IMAGE_FOCUS_DEFAULT,
  sanitizePersonaImageFocus,
  sanitizePersonaImageUrl,
  sanitizePersonaInput,
  validatePersonaContentLength,
  validatePersonaSecretContentLength,
} from "@/lib/userPersonas";
import { isPersonaSecretBoundaryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import { preserveLegacySecretBlocksOnPublicDescriptionUpdate } from "@/lib/personaSecretLegacyMarkers";
import { toPublicPersonaClientRow } from "@/lib/personaSecretSerialization";
import {
  deletePersonaSecretData,
  savePersonaWithSecretCompilation,
  type PersonaSecretInput,
} from "@/lib/personaSaveWithSecrets";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const personaId = Number((await params).id);
  if (!personaId) return NextResponse.json({ error: "잘못된 페르소나 ID입니다." }, { status: 400 });

  const existing = getPersonaById(user.id, personaId);
  if (!existing) return NextResponse.json({ error: "페르소나를 찾을 수 없습니다." }, { status: 404 });

  const body = await req.json();
  const secretSupplied = Object.prototype.hasOwnProperty.call(body, "secret_description");
  const descriptionSupplied = Object.prototype.hasOwnProperty.call(body, "description");
  const effectiveDescription = descriptionSupplied
    ? preserveLegacySecretBlocksOnPublicDescriptionUpdate(
        existing.description,
        String(body.description ?? "")
      )
    : existing.description;
  const { name, memo, gender, description, secret_description } = sanitizePersonaInput(
    String(body.name ?? existing.name),
    effectiveDescription,
    String(body.memo ?? existing.memo ?? ""),
    body.gender ?? existing.gender,
    String(body.secret_description ?? existing.secret_description ?? "")
  );
  const imageUrl =
    body.image_url !== undefined
      ? sanitizePersonaImageUrl(body.image_url)
      : sanitizePersonaImageUrl(existing.image_url);
  const imageFocusX = sanitizePersonaImageFocus(
    body.image_focus_x !== undefined ? body.image_focus_x : existing.image_focus_x,
    PERSONA_IMAGE_FOCUS_DEFAULT.x
  );
  const imageFocusY = sanitizePersonaImageFocus(
    body.image_focus_y !== undefined ? body.image_focus_y : existing.image_focus_y,
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
  const secretInput: PersonaSecretInput = secretSupplied
    ? { supplied: true, value: secret_description }
    : { supplied: false };
  if (boundaryOn && secretInput.supplied) {
    const secretCheck = validatePersonaSecretContentLength(secretInput.value);
    if (!secretCheck.ok) {
      return NextResponse.json({ error: secretCheck.error }, { status: 400 });
    }
  }

  const saved = savePersonaWithSecretCompilation({
    userId: user.id,
    personaId,
    fields: {
      name,
      memo,
      gender,
      description,
      secret_description,
      secretInput,
      image_url: imageUrl,
      image_focus_x: imageFocusX,
      image_focus_y: imageFocusY,
    },
  });
  if (!saved.ok) {
    return NextResponse.json(
      { error: saved.error, ...(saved.code ? { code: saved.code } : {}) },
      { status: saved.status }
    );
  }

  const persona = getPersonaById(user.id, personaId);

  return NextResponse.json({
    ok: true,
    persona: persona ? toPublicPersonaClientRow(persona) : null,
    ...(saved.compile ? { compile: saved.compile } : {}),
    ...(saved.compilePreservedPrior ? { compilePreservedPrior: true } : {}),
  });
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

  const tx = db.transaction(() => {
    db.prepare("UPDATE chats SET selected_persona_id=? WHERE user_id=? AND selected_persona_id=?").run(
      fallback.id,
      user.id,
      personaId
    );
    deletePersonaSecretData(personaId, db);
    db.prepare("DELETE FROM user_personas WHERE id=? AND user_id=?").run(personaId, user.id);
  });
  tx();

  return NextResponse.json({ ok: true, fallbackPersonaId: fallback.id });
}
