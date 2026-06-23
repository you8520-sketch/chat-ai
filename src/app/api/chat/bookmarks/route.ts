import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { fetchUserBookmarks } from "@/lib/bookmarks";
import { getDb } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const bookmarks = fetchUserBookmarks(db, user.id);

  return NextResponse.json({ bookmarks });
}
