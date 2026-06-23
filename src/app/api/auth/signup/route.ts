import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { creditPoints } from "@/lib/points";
import { SIGNUP_BONUS_POINTS } from "@/lib/plans";
import {
  BETA_INVITE_INVALID_MESSAGE,
  BETA_INVITE_REQUIRED_MESSAGE,
  isBetaInviteGateEnabled,
  isValidBetaInviteCode,
} from "@/lib/betaInvite";

export async function POST(req: Request) {
  const { email, nickname, password, pref, inviteCode } = await req.json();
  if (!email || !nickname || !password || password.length < 6) {
    return NextResponse.json({ error: "이메일, 닉네임, 비밀번호(6자 이상)를 입력하세요." }, { status: 400 });
  }
  if (isBetaInviteGateEnabled()) {
    if (!inviteCode?.trim()) {
      return NextResponse.json({ error: BETA_INVITE_REQUIRED_MESSAGE }, { status: 403 });
    }
    if (!isValidBetaInviteCode(inviteCode)) {
      return NextResponse.json({ error: BETA_INVITE_INVALID_MESSAGE }, { status: 403 });
    }
  }
  const storedPref = pref === "all" || pref === null ? null : pref;
  if (!["female", "male", null].includes(storedPref)) {
    return NextResponse.json({ error: "취향(전체/여성향/남성향)을 선택하세요." }, { status: 400 });
  }
  const db = getDb();
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });

  const info = db
    .prepare("INSERT INTO users (email, nickname, pw_hash, pref, points) VALUES (?,?,?,?,0)")
    .run(email, nickname, hashPassword(password), storedPref);
  const userId = Number(info.lastInsertRowid);
  creditPoints(userId, SIGNUP_BONUS_POINTS, "FREE", "신규 가입 보너스");

  const token = createSession(userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 3600, path: "/" });
  return res;
}
