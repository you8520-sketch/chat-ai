import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import {
  syncOfficialCharacterInPlace,
  recompileOfficialCharacterInPlace,
  type OfficialCompileRefreshSnapshot,
  type OfficialInPlacePreflightSnapshot,
} from "@/lib/officialSupply/inPlaceSync";

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    characterId?: number;
    draftKey?: string;
    mode?: string;
    operation?: string;
    displayCreatorName?: string;
    apply?: boolean;
    preflightSnapshot?: OfficialInPlacePreflightSnapshot | OfficialCompileRefreshSnapshot;
  };
  const characterId = Number(body.characterId);
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "characterId가 필요합니다." }, { status: 400 });
  }

  const mode = body.mode === "apply" || body.apply === true ? "apply" : "dry_run";
  if (body.operation != null && body.operation !== "full_sync" && body.operation !== "recompile") {
    return NextResponse.json({ error: "지원하지 않는 갱신 작업입니다." }, { status: 400 });
  }
  try {
    if (body.operation === "recompile") {
      const result = await recompileOfficialCharacterInPlace({
        admin,
        characterId,
        mode,
        preflightSnapshot: body.preflightSnapshot as OfficialCompileRefreshSnapshot | undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await syncOfficialCharacterInPlace({
      admin,
      characterId,
      draftKey: body.draftKey,
      mode,
      displayCreatorName: body.displayCreatorName,
      preflightSnapshot: body.preflightSnapshot as OfficialInPlacePreflightSnapshot | undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OfficialSupplyGateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
