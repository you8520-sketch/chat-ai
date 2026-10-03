import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { listOfficialCharactersForAdmin, resolveCanonicalOfficialOwner } from "@/lib/officialAdminAccess";

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    owner: resolveCanonicalOfficialOwner(),
    characters: listOfficialCharactersForAdmin(),
  });
}
