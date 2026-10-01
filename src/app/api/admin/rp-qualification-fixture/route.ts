import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { readRpQualificationFixture } from "@/lib/rpQualificationFixture";

function positiveInt(raw: string | null): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function GET(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const url = new URL(req.url);
  const characterId = positiveInt(url.searchParams.get("characterId"));
  const personaName = url.searchParams.get("personaName")?.trim() ?? "";

  if (!characterId || !personaName) {
    return NextResponse.json(
      { error: "characterId and personaName are required" },
      { status: 400 }
    );
  }

  const result = readRpQualificationFixture(getDb(), {
    characterId,
    adminUserId: admin.id,
    adminNickname: admin.nickname,
    personaName,
  });

  if (!result.ok) {
    if (result.code === "character_not_found") {
      return NextResponse.json({ error: result.code }, { status: 404 });
    }
    if (result.code === "persona_not_found") {
      return NextResponse.json({ error: result.code }, { status: 404 });
    }
    return NextResponse.json(
      { error: result.code, candidates: result.candidates },
      { status: 409 }
    );
  }

  return NextResponse.json(result.fixture, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
