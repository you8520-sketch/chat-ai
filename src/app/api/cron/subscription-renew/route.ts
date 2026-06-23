import { NextResponse } from "next/server";
import { processDueRenewals } from "@/lib/subscription";

/** 정기결제 배치 — cron에서 1일 1회 호출 (데모: CRON_SECRET 없으면 development만 허용) */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const renewed = processDueRenewals();
  return NextResponse.json({ ok: true, renewed });
}
