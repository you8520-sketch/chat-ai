import { appendFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isTrpgDiceRuntimeInstrument } from "@/lib/trpg/dicePreviewTheme";

const DEBUG_LOG_PATH = "/opt/cursor/logs/debug.log";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_TRPG_DICE_PREVIEW !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  const entry: unknown = await request.json().catch(() => null);
  if (!isTrpgDiceRuntimeInstrument(entry)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  await appendFile(DEBUG_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  return NextResponse.json({ ok: true });
}
