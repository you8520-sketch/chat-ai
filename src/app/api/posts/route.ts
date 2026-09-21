import { NextResponse } from "next/server";

/** Public board write endpoints removed — inquiry board retired. */
export async function POST() {
  return NextResponse.json({ error: "쓰기 권한이 없는 게시판입니다." }, { status: 403 });
}
