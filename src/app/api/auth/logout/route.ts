import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";

export async function POST() {
  const store = await cookies();
  const token = store.get("session")?.value;
  if (token) getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("session");
  return res;
}
