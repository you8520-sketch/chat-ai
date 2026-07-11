import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  buildRegenerationContextTrace,
  resolveRegenerationContextBoundary,
  type RegenerationMessageRow,
} from "@/lib/regenerationContext";

function parseMessageId(raw: string | null): number | null {
  const cleaned = raw?.trim().replace(/^msg-/i, "") ?? "";
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function requestToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.headers.get("x-admin-debug-token")?.trim() || "";
}

function requireDebugToken(req: Request): boolean {
  const expected = process.env.ADMIN_DEBUG_TOKEN?.trim() ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  return requestToken(req) === expected;
}

export async function GET(req: Request) {
  if (!requireDebugToken(req)) {
    return NextResponse.json({ error: "admin diagnostics access denied" }, { status: 403 });
  }

  const url = new URL(req.url);
  const targetAssistantMessageId = parseMessageId(
    url.searchParams.get("targetAssistantMessageId") ?? url.searchParams.get("messageId")
  );
  if (!targetAssistantMessageId) {
    return NextResponse.json({ error: "targetAssistantMessageId is required" }, { status: 400 });
  }

  const db = getDb();
  const target = db
    .prepare("SELECT chat_id FROM messages WHERE id=? AND role='assistant'")
    .get(targetAssistantMessageId) as { chat_id: number } | undefined;
  if (!target) {
    return NextResponse.json({ error: "target assistant not found" }, { status: 404 });
  }

  const rows = db
    .prepare(
      `SELECT id, role, content, model, user_message_id
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(target.chat_id) as RegenerationMessageRow[];
  const boundary = resolveRegenerationContextBoundary(rows, targetAssistantMessageId);
  const trace = buildRegenerationContextTrace({
    chatId: target.chat_id,
    rows,
    targetAssistantId: targetAssistantMessageId,
    boundary,
    currentInputWrapperSource: boundary ? "parent_user_message" : "unknown",
    clientDraftPresent: false,
  });

  return NextResponse.json({
    targetAssistantMessageId: trace.targetAssistantMessageId,
    parentUserMessageId: trace.parentUserMessageId,
    currentUserInputMessageId: trace.currentUserInputMessageId,
    currentInputWrapperSource: trace.currentInputWrapperSource,
    historyCount: trace.historyMessageIdsBeforeTarget.length,
    historyMessageIdsBeforeTarget: trace.historyMessageIdsBeforeTarget,
    historyUserMessageIdsBeforeTarget: trace.historyUserMessageIdsBeforeTarget,
    excludedAfterTargetCount: trace.excludedMessageIdsAfterTarget.length,
    excludedMessageIdsAfterTarget: trace.excludedMessageIdsAfterTarget,
    duplicateParentInHistory: trace.duplicateParentInHistory,
    messagesAfterTargetIncluded: trace.messagesAfterTargetIncluded,
    draftInputIncluded: trace.draftInputIncluded,
    previousUserIncludedAsCurrent: trace.previousUserIncludedAsCurrent,
    previousUserMessageId: trace.previousUserMessageId,
    currentUserInputHash: trace.currentUserInputHash,
    parentUserContentHash: trace.parentUserContentHash,
    previousUserContentHash: trace.previousUserContentHash,
    reasonCode: trace.reasonCode,
  });
}
