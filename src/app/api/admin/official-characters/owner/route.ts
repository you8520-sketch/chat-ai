import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import {
  transferOfficialCharacterOwnerToAdmin,
  type OfficialOwnerTransferSnapshot,
} from "@/lib/officialSupply/ownerTransfer";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    characterId?: number;
    mode?: string;
    preflightSnapshot?: OfficialOwnerTransferSnapshot;
  };
  const characterId = Number(body.characterId);
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "characterId가 필요합니다." }, { status: 400 });
  }

  try {
    const result = transferOfficialCharacterOwnerToAdmin({
      admin,
      characterId,
      mode: body.mode === "apply" ? "apply" : "dry_run",
      preflightSnapshot: body.preflightSnapshot,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OfficialSupplyGateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
