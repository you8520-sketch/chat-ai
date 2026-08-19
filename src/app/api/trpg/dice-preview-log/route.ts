import { appendFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import type { TrpgDiceRuntimeInstrument } from "@/lib/trpg/dicePreviewTheme";

const DEBUG_LOG_PATH = "/opt/cursor/logs/debug.log";
const EVENTS = new Set<TrpgDiceRuntimeInstrument["event"]>([
  "DICE_INIT_STARTED",
  "DICE_INITIALIZED",
  "DICE_ROLL_STARTED",
  "DICE_ROLL_RESOLVED",
  "DICE_SETTLE_SOURCE",
  "DICE_ERROR_CODE",
]);

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_TRPG_DICE_PREVIEW !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  const entry = (await request.json().catch(() => null)) as TrpgDiceRuntimeInstrument | null;
  if (!entry || !EVENTS.has(entry.event) || typeof entry.hypothesisId !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  await appendFile(DEBUG_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  return NextResponse.json({ ok: true });
}
