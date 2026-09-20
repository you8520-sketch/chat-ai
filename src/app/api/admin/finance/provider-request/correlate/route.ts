import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import {
  assertAdminProviderRequestForensicSafePayload,
  BROADER_CORRELATION_WINDOW_SECONDS,
  correlateAdminHistoricalLedger,
  DEFAULT_CORRELATION_WINDOW_SECONDS,
  type AdminHistoricalLedgerCorrelationInput,
} from "@/lib/adminProviderRequestLookup";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function parseCorrelationInput(body: unknown): AdminHistoricalLedgerCorrelationInput | { error: string } {
  if (body == null || typeof body !== "object") {
    return { error: "요청 본문이 필요합니다." };
  }
  const record = body as Record<string, unknown>;
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const requestedAtUtc =
    typeof record.requestedAtUtc === "string" ? record.requestedAtUtc.trim() : "";
  const durationMs = parsePositiveInt(record.durationMs);
  const originalInputTokens = parsePositiveInt(record.originalInputTokens);
  const sentToModelTokens = parsePositiveInt(record.sentToModelTokens);
  const outputTokens = parsePositiveInt(record.outputTokens);

  if (!model) return { error: "model이 필요합니다." };
  if (!requestedAtUtc) return { error: "requestedAtUtc가 필요합니다." };
  if (durationMs == null) return { error: "durationMs가 필요합니다." };
  if (originalInputTokens == null) return { error: "originalInputTokens가 필요합니다." };
  if (sentToModelTokens == null) return { error: "sentToModelTokens가 필요합니다." };
  if (outputTokens == null) return { error: "outputTokens가 필요합니다." };

  let windowSeconds = DEFAULT_CORRELATION_WINDOW_SECONDS;
  if (record.windowSeconds != null) {
    const parsedWindow = parsePositiveInt(record.windowSeconds);
    if (parsedWindow == null || parsedWindow <= 0) {
      return { error: "windowSeconds는 양의 정수여야 합니다." };
    }
    if (parsedWindow > BROADER_CORRELATION_WINDOW_SECONDS) {
      return {
        error: `windowSeconds는 최대 ${BROADER_CORRELATION_WINDOW_SECONDS}초입니다.`,
      };
    }
    windowSeconds = parsedWindow;
  }

  const provider =
    typeof record.provider === "string" && record.provider.trim()
      ? record.provider.trim().toLowerCase()
      : "cheaperinference";

  return {
    provider,
    model,
    requestedAtUtc,
    durationMs,
    originalInputTokens,
    sentToModelTokens,
    outputTokens,
    windowSeconds,
  };
}

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문을 파싱하지 못했습니다." }, { status: 400 });
  }

  const parsed = parseCorrelationInput(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = correlateAdminHistoricalLedger(parsed, getDb());
    assertAdminProviderRequestForensicSafePayload(result);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "correlation failed";
    if (message.includes("invalid requestedAtUtc") || message.includes("invalid durationMs")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    throw error;
  }
}
