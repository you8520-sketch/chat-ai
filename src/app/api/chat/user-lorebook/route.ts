import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { resolveSubscriptionMemoryCapability } from "@/lib/subscriptionMemoryCapability";
import {
  loadUserLorebookView,
  normalizeUserLorebookEntries,
  saveUserLorebookEntries,
  type UserLorebookStoredEntry,
} from "@/lib/userLorebook";

function parseChatId(raw: string | null): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function assertChatOwnership(chatId: number, userId: number): boolean {
  const db = getDb();
  return Boolean(
    db.prepare(`SELECT 1 AS ok FROM chats WHERE id=? AND user_id=?`).get(chatId, userId)
  );
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const chatId = parseChatId(new URL(req.url).searchParams.get("chatId"));
  if (!chatId) return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  if (!assertChatOwnership(chatId, user.id)) {
    return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  const capability = resolveSubscriptionMemoryCapability(user);
  const view = loadUserLorebookView(getDb(), chatId, user.id, capability);
  return NextResponse.json({ ok: true, lorebook: view });
}

export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await req.json()) as { chatId?: number; entries?: unknown };
  const chatId = parseChatId(String(body.chatId ?? ""));
  if (!chatId) return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  if (!assertChatOwnership(chatId, user.id)) {
    return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  const normalized = normalizeUserLorebookEntries(body.entries);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const capability = resolveSubscriptionMemoryCapability(user);
  saveUserLorebookEntries(getDb(), chatId, user.id, normalized.entries as UserLorebookStoredEntry[]);
  const view = loadUserLorebookView(getDb(), chatId, user.id, capability);
  return NextResponse.json({ ok: true, lorebook: view });
}
