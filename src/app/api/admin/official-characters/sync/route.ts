import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { syncOfficialCharacterInPlace } from "@/lib/officialSupply/inPlaceSync";

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    characterId?: number;
    draftKey?: string;
    mode?: string;
    displayCreatorName?: string;
    apply?: boolean;
  };
  const characterId = Number(body.characterId);
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "characterId가 필요합니다." }, { status: 400 });
  }

  const mode = body.mode === "apply" || body.apply === true ? "apply" : "dry_run";
  try {
    const result = await syncOfficialCharacterInPlace({
      admin,
      characterId,
      draftKey: body.draftKey,
      mode,
      displayCreatorName: body.displayCreatorName,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OfficialSupplyGateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
