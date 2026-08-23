import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";

type MessageForensicRow = {
  id: number;
  created_at: string;
  updated_at: string;
  usage: string | null;
};

type LedgerForensicRow = {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  request_kind: string;
  input_tokens: number;
  output_tokens: number;
  estimated: number;
  cost_krw: number;
};

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

  const messageId = parseMessageId(new URL(req.url).searchParams.get("messageId"));
  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  const db = getDb();
  ensureAdminFinanceTables(db);

  const message = db
    .prepare(
      `SELECT id, created_at, updated_at, usage
       FROM messages
       WHERE id = ?`
    )
    .get(messageId) as MessageForensicRow | undefined;

  if (!message) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const windowStart = db
    .prepare(`SELECT datetime(?, '-10 minutes') AS value`)
    .get(message.created_at) as { value: string };
  const windowEnd = db
    .prepare(
      `SELECT datetime(COALESCE(NULLIF(?, ''), ?), '+30 minutes') AS value`
    )
    .get(message.updated_at, message.created_at) as { value: string };

  const ledgerRows = db
    .prepare(
      `SELECT id, created_at, provider, model, request_kind, input_tokens, output_tokens, estimated, cost_krw
       FROM api_cost_ledger
       WHERE request_kind LIKE 'background-status-widget-extract%'
         AND created_at BETWEEN ? AND ?
       ORDER BY created_at ASC`
    )
    .all(windowStart.value, windowEnd.value) as LedgerForensicRow[];

  return NextResponse.json({
    messageId,
    message,
    ledgerWindow: {
      start: windowStart.value,
      end: windowEnd.value,
    },
    ledgerRows,
  });
}
