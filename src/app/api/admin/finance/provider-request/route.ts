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
  const lookup = lookupAdminProviderRequestForensic(providerRequestId, {
    provider,
    db: getDb(),
  });

  const payload = lookup
    ? {
        found: true as const,
        event: lookup.event,
        matchingRowCount: lookup.matchingRowCount,
        duplicateDetected: lookup.duplicateDetected,
      }
    : {
        found: false as const,
        event: null,
        matchingRowCount: 0,
        duplicateDetected: false,
      };
  assertAdminProviderRequestForensicSafePayload(payload);
  return NextResponse.json(payload);
}
