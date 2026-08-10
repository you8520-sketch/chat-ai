/**
 * Bench-only runtime capture for 6-turn summary source-range regression checks.
 * Writes JSON under bench/summary_capture/ when BENCH_SUMMARY_SOURCE_CAPTURE=1.
 * Never mutates summary logic — observe-only.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { benchSummarySourceCaptureEnabled } from "@/lib/benchAbFlags";

export type BenchSummarySourceTurn = {
  turnIndex: number;
  user: string;
  assistant: string;
};

export type BenchSummaryCapturePayload = {
  phase: "pre_llm" | "post_llm" | "error";
  capturedAt: string;
  chatId: number;
  batchStart: number;
  endTurn: number;
  summaryStartTurn: number;
  summaryEndTurn: number;
  observedSourceTurnCount: number;
  observedSourceTurnIndexes: number[];
  sourceTurns: BenchSummarySourceTurn[];
  dialoguePreviewChars: number;
  dialogue: string;
  summaryText?: string;
  summaryChars?: number;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    cached_input_tokens?: number | null;
    reasoning_tokens?: number | null;
    cost?: number | null;
  } | null;
  latencyMs?: number | null;
  error?: string;
};

function captureDir(): string {
  return join(process.cwd(), "bench", "summary_capture");
}

export function captureBenchSummaryEvidence(
  payload: BenchSummaryCapturePayload
): string | null {
  if (!benchSummarySourceCaptureEnabled()) return null;
  try {
    const dir = captureDir();
    mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      `chat_${payload.chatId}_${payload.phase}_${payload.summaryStartTurn}-${payload.summaryEndTurn}_${Date.now()}.json`
    );
    writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    console.info(
      `[bench-summary-capture] wrote ${file} turns=${payload.observedSourceTurnIndexes.join(",")}`
    );
    return file;
  } catch (e) {
    console.warn("[bench-summary-capture] write failed:", (e as Error).message);
    return null;
  }
}
