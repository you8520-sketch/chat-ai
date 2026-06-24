import { NextResponse } from "next/server";
import { isAdultVerificationSkipped } from "@/lib/adultVerification";
import { isDemoEnv } from "@/lib/demo";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "playai",
    skipAdultVerification: isAdultVerificationSkipped(),
    demoEnv: isDemoEnv(),
  });
}
