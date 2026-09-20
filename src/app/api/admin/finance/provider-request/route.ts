import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import {
  assertAdminProviderRequestForensicSafePayload,
  lookupAdminProviderRequestForensic,
} from "@/lib/adminProviderRequestLookup";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const url = new URL(req.url);
  const providerRequestId = url.searchParams.get("providerRequestId")?.trim() ?? "";
  if (!providerRequestId) {
    return NextResponse.json(
      { error: "providerRequestId가 필요합니다." },
      { status: 400 }
    );
  }

  const provider = url.searchParams.get("provider")?.trim().toLowerCase() || "cheaperinference";
  const event = lookupAdminProviderRequestForensic(providerRequestId, {
    provider,
    db: getDb(),
  });

  const payload = event ? { found: true as const, event } : { found: false as const, event: null };
  assertAdminProviderRequestForensicSafePayload(payload);
  return NextResponse.json(payload);
}
