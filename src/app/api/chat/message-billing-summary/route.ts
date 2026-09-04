import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadUserMessageBillingSummaryForOwnedMessage } from "@/lib/messageBillingSummaryServer";

export const dynamic = "force-dynamic";

/** User-safe owned-message billing summary — no admin forensic fields. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const url = new URL(req.url);
  const messageId = Number(url.searchParams.get("messageId"));
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  }

  const result = loadUserMessageBillingSummaryForOwnedMessage({
    userId: user.id,
    messageId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.summary, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
