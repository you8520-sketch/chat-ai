import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { resolveOwnerPersonaEditorAccess } from "@/lib/personaOwnerEditorAccess";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  const personaId = Number((await params).id);
  const access = resolveOwnerPersonaEditorAccess({
    user: user ? { id: user.id } : null,
    personaId,
  });

  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, ...(access.code ? { code: access.code } : {}) },
      { status: access.status }
    );
  }

  return NextResponse.json(
    {
      persona: access.persona,
      capabilities: { personaSecretSettings: access.capability },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
