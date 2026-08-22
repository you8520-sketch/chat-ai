/**
 * H1S-FAST: one tiny failover canary, then exact frozen H1S quality calls
 * through executeDeepSeekWithProviderFailover.
 *
 * Does not import chat/billing. Does not change the H1S owner.
 *
 * STEP=canary — one isolated pong
 * STEP=h1s    — H1S-R1 / H1S-R2 / H1S-R3 from frozen PR #573 messages
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { loadEnvLocal } from "../load-env-local";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
} from "../../src/lib/chatModels";
import {
  adaptOpenRouterDeepSeekBackupBody,
  executeDeepSeekWithProviderFailover,
  extractVisibleAssistantDeltaFromSseJson,
  resolveDeepSeekPrimaryTransport,
  type DeepSeekFailoverTelemetry,
} from "../../src/lib/deepseekProviderFailover";

loadEnvLocal();

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-h1s-fast");
const FROZEN_MESSAGES_SRC = path.join(
  ROOT,
  "data/ds0813-phase-h1s-fast/frozen/DEEPSEEK_HANDOFF_MESSAGES.json"
);
const EXPECTED_MESSAGES_SHA =
  "e6993bf8a122ba892542da0e98866f56f8fd7d4524178cd0a84f99c70d6e0239";
const H1S_OWNER_CHARS = 725;
const FLOOR = 2700;
const STEP = (process.env.STEP ?? "canary").trim();
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

type ChatMsg = { role: string; content: string };

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function messagesSha(messages: ChatMsg[]): string {
  return sha256(messages.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
}

function writeJson(rel: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE, rel), JSON.stringify(value, null, 2), "utf8");
}

function writeText(rel: string, value: string) {
  writeFileSync(path.join(EVIDENCE, rel), value, "utf8");
}

function requestBody(messages: ChatMsg[]): Record<string, unknown> {
  return {
    model: DEEPSEEK,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.92,
    top_p: 0.92,
    thinking: { type: "disabled" },
    reasoning_effort: "none",
  };
}

function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

function countDialogueParagraphs(text: string): number {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.filter(
    (p) =>
      /[「“"]/.test(p) &&
      p.replace(/[「“"][^」”"]+[」”"]/g, "").trim().length < 24
  ).length;
}

async function consumeStream(response: Response): Promise<{
  text: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  firstVisibleMs: number | null;
  lastVisibleMs: number | null;
}> {
  const started = Date.now();
  if (!response.body) {
    return {
      text: "",
      finishReason: null,
      usage: null,
      firstVisibleMs: null,
      lastVisibleMs: null,
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let text = "";
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | null = null;
  let firstVisibleMs: number | null = null;
  let lastVisibleMs: number | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ finish_reason?: string | null }>;
            usage?: Record<string, unknown>;
          };
          const visible = extractVisibleAssistantDeltaFromSseJson(json);
          if (visible) {
            const now = Date.now() - started;
            if (firstVisibleMs == null) firstVisibleMs = now;
            lastVisibleMs = now;
            text += visible;
          }
          const reason = json.choices?.[0]?.finish_reason;
          if (reason) finishReason = reason;
          if (json.usage) usage = json.usage;
        } catch {
          /* incomplete SSE */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, finishReason, usage, firstVisibleMs, lastVisibleMs };
}

async function callFailover(body: Record<string, unknown>, routeKind: "adult_handoff" | "native_pro") {
  const wallStart = Date.now();
  const primaryTransport = resolveDeepSeekPrimaryTransport();
  const backupBody = adaptOpenRouterDeepSeekBackupBody(
    body,
    OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL
  );
  if (backupBody.model !== OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL) {
    throw new Error(`backup model ${String(backupBody.model)}`);
  }
  let telemetry: DeepSeekFailoverTelemetry | null = null;
  const result = await executeDeepSeekWithProviderFailover({
    routeKind,
    logicalModel: "pro",
    primary: {
      endpoint: primaryTransport.endpoint,
      headers: primaryTransport.headers,
      body,
    },
    backupBody,
    stream: true,
    hooks: {
      onTelemetry: (next) => {
        telemetry = next;
      },
    },
  });
  const consumed = await consumeStream(result.response);
  return {
    usedProvider: result.usedProvider,
    telemetry: telemetry ?? result.telemetry,
    httpStatus: result.response.status,
    ...consumed,
    totalLatencyMs: Date.now() - wallStart,
  };
}

function ensureEvidenceDir() {
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "frozen"), { recursive: true });
}

async function runCanary() {
  ensureEvidenceDir();
  const messages: ChatMsg[] = [{ role: "user", content: "Reply with exactly: pong" }];
  const body = requestBody(messages);
  writeJson("CANARY_REQUEST.json", {
    NOTE: "tiny isolated canary; no DB/billing/chat mutation",
    body,
    backup_model: OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
  });
  try {
    const result = await callFailover(body, "native_pro");
    const visible = result.text.trim();
    const report = {
      LIVE_CANARY_PRIMARY_STATUS: result.telemetry.primary_http_status,
      LIVE_CANARY_PRIMARY_FAILURE_CLASS: result.telemetry.primary_failure_class,
      LIVE_CANARY_FAILOVER_TRIGGER: result.telemetry.failover_trigger,
      LIVE_CANARY_USED_PROVIDER: result.usedProvider,
      LIVE_CANARY_BACKUP_SUCCESS: result.telemetry.backup_success,
      LIVE_CANARY_VISIBLE: visible,
      LIVE_CANARY_PROVIDER_ATTEMPTS: result.telemetry.provider_attempt_count,
      FINISH_REASON: result.finishReason,
      USAGE: result.usage,
      TTFT_MS: result.firstVisibleMs,
      TOTAL_LATENCY_MS: result.totalLatencyMs,
      CANARY_SUCCESS: /pong/i.test(visible),
    };
    writeJson("CANARY.json", report);
    writeText("CANARY_RAW.txt", result.text);
    return report;
  } catch (error) {
    const report = {
      LIVE_CANARY_PRIMARY_STATUS: null,
      LIVE_CANARY_USED_PROVIDER: null,
      LIVE_CANARY_BACKUP_SUCCESS: false,
      LIVE_CANARY_VISIBLE: "",
      LIVE_CANARY_PROVIDER_ATTEMPTS: null,
      CANARY_SUCCESS: false,
      ERROR: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
    writeJson("CANARY.json", report);
    writeJson("CANARY_STOP.json", {
      STOP: true,
      H1S_QUALITY_REVALIDATION_BLOCKED: true,
      CANARY_SUCCESS: false,
    });
    return report;
  }
}

function loadFrozenH1SMessages(): ChatMsg[] {
  if (!existsSync(FROZEN_MESSAGES_SRC)) {
    throw new Error(`missing frozen H1S messages: ${FROZEN_MESSAGES_SRC}`);
  }
  const messages = JSON.parse(readFileSync(FROZEN_MESSAGES_SRC, "utf8")) as ChatMsg[];
  const sha = messagesSha(messages);
  if (sha !== EXPECTED_MESSAGES_SHA) {
    throw new Error(`H1S messages SHA drifted: ${sha}`);
  }
  const system = messages[0]?.content ?? "";
  const owner = system.slice(system.lastIndexOf("현재 사용자 턴 전체가 최신 장면 상태다."));
  if (owner.length !== H1S_OWNER_CHARS) {
    throw new Error(`H1S owner chars ${owner.length}, expected ${H1S_OWNER_CHARS}`);
  }
  return messages;
}

async function runH1S() {
  ensureEvidenceDir();
  const messages = loadFrozenH1SMessages();
  const body = requestBody(messages);
  writeJson("H1S_REQUEST_ENVELOPE.json", {
    model: body.model,
    temperature: body.temperature,
    top_p: body.top_p,
    thinking: body.thinking,
    reasoning_effort: body.reasoning_effort,
    stream: body.stream,
    stream_options: body.stream_options,
    MESSAGE_COUNT: messages.length,
    H1S_FINAL_MESSAGES_SHA: messagesSha(messages),
    H1S_OWNER_CHARS,
  });
  const keys = ["H1S-R1", "H1S-R2", "H1S-R3"] as const;
  const rows: Record<string, unknown>[] = [];
  for (const key of keys) {
    const result = await callFailover(body, "adult_handoff");
    const visible = result.text.replace(/\r/g, "");
    const paragraphs = countParagraphs(visible);
    const dialogueParagraphs = countDialogueParagraphs(visible);
    const row = {
      KEY: key,
      USED_PROVIDER: result.usedProvider,
      PROVIDER_ATTEMPT_COUNT: result.telemetry.provider_attempt_count,
      PRIMARY_HTTP_STATUS: result.telemetry.primary_http_status,
      PRIMARY_FAILURE_CLASS: result.telemetry.primary_failure_class,
      FAILOVER_TRIGGER: result.telemetry.failover_trigger,
      BACKUP_SUCCESS: result.telemetry.backup_success,
      HTTP_STATUS: result.httpStatus,
      VISIBLE_CHARS: visible.length,
      UNDER_LENGTH: visible.length >= FLOOR ? false : visible.length > 0 ? true : null,
      QUALITY_SAMPLE: visible.length > 0 && result.httpStatus === 200,
      INPUT_TOKENS:
        (result.usage?.prompt_tokens as number | undefined) ??
        (result.usage?.input_tokens as number | undefined) ??
        null,
      OUTPUT_TOKENS:
        (result.usage?.completion_tokens as number | undefined) ??
        (result.usage?.output_tokens as number | undefined) ??
        null,
      TTFT: result.firstVisibleMs,
      TOTAL_LATENCY: result.totalLatencyMs,
      PARAGRAPHS: paragraphs,
      DIALOGUE_PARAGRAPHS: dialogueParagraphs,
      DIALOGUE_RATIO:
        paragraphs === 0 ? 0 : Number((dialogueParagraphs / paragraphs).toFixed(3)),
      FINISH_REASON: result.finishReason,
      RAW_SHA256: sha256(visible),
      USAGE: result.usage,
      TELEMETRY: result.telemetry,
    };
    writeJson(`raw/${key}.meta.json`, row);
    writeText(`raw/${key}.txt`, visible);
    rows.push(row);
  }
  writeJson("H1S_LIVE.json", rows);
  return rows;
}

async function main() {
  ensureEvidenceDir();
  if (STEP === "canary") {
    const report = await runCanary();
    console.log(JSON.stringify(report, null, 2));
    if (!report.CANARY_SUCCESS) process.exitCode = 2;
    return;
  }
  if (STEP === "h1s") {
    const rows = await runH1S();
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  throw new Error(`unknown STEP=${STEP}`);
}

void main();
