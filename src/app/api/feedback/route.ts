import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

const GOOGLE_FEEDBACK_SCRIPT_URL =
  process.env.GOOGLE_SHEETS_FEEDBACK_URL ??
  "https://script.google.com/macros/s/AKfycbwAKAN2-jN79vBDufY5CT8l8Yqytp00b_cg8D4zH-Xg4Tio9BdPpmQ3ekwrNKE9uwKRUA/exec";

const MAX_FEEDBACK_CHARS = 2_000;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const feedbackReason =
    typeof (body as { feedbackReason?: unknown }).feedbackReason === "string"
      ? (body as { feedbackReason: string }).feedbackReason.trim()
      : "";

  if (!feedbackReason) {
    return NextResponse.json({ error: "피드백 내용을 입력해 주세요." }, { status: 400 });
  }
  if (feedbackReason.length > MAX_FEEDBACK_CHARS) {
    return NextResponse.json(
      { error: `피드백은 ${MAX_FEEDBACK_CHARS.toLocaleString()}자까지 입력할 수 있습니다.` },
      { status: 400 }
    );
  }

  const payload = JSON.stringify({
    userId: user.id,
    nickname: user.nickname,
    feedbackReason,
  });

  try {
    const upstream = await fetch(GOOGLE_FEEDBACK_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: payload,
    });

    if (!upstream.ok) {
      console.error("[feedback] Google script error", upstream.status, await upstream.text().catch(() => ""));
      return NextResponse.json({ error: "피드백 전송에 실패했습니다." }, { status: 502 });
    }
  } catch (err) {
    console.error("[feedback] Google script fetch failed", err);
    return NextResponse.json({ error: "피드백 전송에 실패했습니다." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
