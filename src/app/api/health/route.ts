import { NextResponse } from "next/server";
import { isAdultVerificationSkipped } from "@/lib/adultVerification";
import { isDemoEnv } from "@/lib/demo";

/** 배포 확인 — /api/health에서 git SHA·베타 플래그 확인 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "playai",
    skipAdultVerification: isAdultVerificationSkipped(),
    demoEnv: isDemoEnv(),
    gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    gitBranch: process.env.RAILWAY_GIT_BRANCH ?? null,
    buildBanner: "slide-v1", // HomeCreateEventBanner 슬라이드+3000P 배너
  });
}
