/**
 * Structured production-safe stream turn forensics — no RP prose bodies.
 */

import { createHash } from "node:crypto";

export type StreamTurnForensics = {
  request_id: string;
  chat_id: number;
  assistant_message_id: number;
  model: string | null;
  main_provider_finished: boolean;
  main_finish_reason: string | null;
  main_visible_chars: number;
  raw_prose_persisted: boolean;
  postprocess_started: boolean;
  status_widget_active: boolean;
  status_widget_attempts: number | null;
  status_widget_latency_ms: number | null;
  status_widget_result: string | null;
  assistant_finalize_status: string | null;
  sse_done_attempted: boolean;
  client_disconnect_seen: boolean;
  total_server_ms: number;
  content_length: number;
  content_hash: string | null;
};

export function hashForensicsText(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}

export function logStreamTurnForensics(record: StreamTurnForensics): void {
  console.info("[StreamTurnForensics]", record);
}
