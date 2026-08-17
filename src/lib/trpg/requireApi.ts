import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessTrpg } from "./access";
import { TRPG_BILLING_MODE_FORBIDDEN_MESSAGE, TRPG_BILLING_MODE_LOCKED_MESSAGE, TRPG_FORK_FORBIDDEN_MESSAGE } from "./types";

export async function requireTrpgApi() {
  const user = await getSessionUser();
  if (!user) {
    return { error: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  }
  if (!canAccessTrpg(user)) {
    return { error: NextResponse.json({ error: "TRPG는 관리자만 사용할 수 있습니다." }, { status: 403 }) };
  }
  return { user, db: getDb() };
}

export function trpgFail(e: unknown, fallback = "요청을 처리할 수 없습니다.") {
  const message = e instanceof Error && e.message.trim() ? e.message : fallback;
  const status =
    message === TRPG_BILLING_MODE_FORBIDDEN_MESSAGE
      ? 403
      : message === TRPG_BILLING_MODE_LOCKED_MESSAGE || message === TRPG_FORK_FORBIDDEN_MESSAGE
        ? 409
        : /찾을 수 없/.test(message)
          ? 404
          : 400;
  return NextResponse.json({ error: message }, { status });
}

export function campaignIdFromParams(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error("잘못된 캠페인입니다.");
  return id;
}
