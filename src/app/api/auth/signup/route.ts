import { NextResponse } from "next/server";
import { requestEmailSignup } from "@/lib/emailSignupVerification";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await requestEmailSignup(body, req);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    pending: true,
    email: result.email,
    message: "인증 메일을 보냈습니다. 메일함의 링크를 눌러 가입을 완료해 주세요.",
  });
}
