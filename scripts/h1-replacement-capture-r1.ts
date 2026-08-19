/**
 * H1 replacement Gemini source capture (R1) — local audit only.
 * Regenerates assistant message 7 on chat 3; preserves failed audit artifacts.
 *
 *   node --conditions=react-server --import tsx scripts/h1-replacement-capture-r1.ts
 */
import "./lib/server-only-mock";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { getDb } from "@/lib/db";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
import { hashKoreanChunks } from "@/lib/promptTranslation";
import { deserializeCharacterChunks } from "@/utils/characterParser";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import { buildContext } from "@/services/contextBuilder";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { resolveNarrativePov } from "@/lib/narrativePov";
import { parseGenresJson } from "@/lib/characterGenres";
import { resolveCharacterGender } from "@/lib/characterGender";
import { resolveRegenerationContextBoundary } from "@/lib/regenerationContext";
import { endsIncomplete } from "@/lib/responseLength";
import { computePromptHash, buildGenerationContextJson } from "@/lib/feedback/snapshot";
import type { ChatMsg } from "@/lib/ai";

loadEnvLocal();
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";
if (!process.env.DATA_DIR) process.env.DATA_DIR = "data";

const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/deepseek0813-gemini37-human-h1"
);
const ARTIFACT_DIR = "/opt/cursor/artifacts";
const CHAT_ID = 3;
const CHARACTER_ID = 17;
const REGEN_ASSISTANT_ID = 7;
const BASE_URL = process.env.H1_CAPTURE_BASE_URL ?? "http://127.0.0.1:3000";
const COOKIE_FILE = process.env.H1_COOKIE_FILE ?? "/tmp/h1-cookies.txt";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function redactRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  for (const key of Object.keys(clone)) {
    if (/api[_-]?key|authorization|token|secret/i.test(key)) {
      clone[key] = "[REDACTED]";
    }
  }
  return clone;
}

function visibleNoWs(text: string): number {
  return [...text.replace(/\s/g, "")].length;
}

function readCookieHeader(): string {
  if (!fs.existsSync(COOKIE_FILE)) {
    throw new Error(`Missing cookie file: ${COOKIE_FILE}`);
  }
  const lines = fs.readFileSync(COOKIE_FILE, "utf8").split("\n");
  const pairs: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("# ") || line.startsWith("#\t") || line === "#") continue;
    const parts = line.split("\t");
    if (parts.length >= 7 && parts[5] === "session") {
      pairs.push(`session=${parts[6]}`);
    }
  }
  if (!pairs.length) throw new Error("No session cookie in cookie file");
  return pairs.join("; ");
}

type AppSseEvent = Record<string, unknown>;

async function runRegenerateCapture(clientRequestId: string) {
  const startedAt = Date.now();
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: readCookieHeader(),
    },
    body: JSON.stringify({
      characterId: CHARACTER_ID,
      chatId: CHAT_ID,
      regenerate: true,
      regenerateMessageId: REGEN_ASSISTANT_ID,
      messageId: REGEN_ASSISTANT_ID,
      selectedPersonaId: 881000203,
      isAdultMode: true,
      isNsfwMode: true,
      clientRequestId,
      requestId: clientRequestId,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  const httpStatus = res.status;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`POST /api/chat ${httpStatus}: ${errText.slice(0, 500)}`);
  }
  if (!res.body) throw new Error("Missing response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let visibleText = "";
  let doneEvent: AppSseEvent | null = null;
  let errorEvent: string | null = null;
  let totalStreamEvents = 0;
  let contentEvents = 0;
  let usageEventPresent = false;
  let doneEventPresent = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let ev: AppSseEvent;
      try {
        ev = JSON.parse(payload) as AppSseEvent;
      } catch {
        continue;
      }
      totalStreamEvents += 1;
      const type = String(ev.type ?? "");
      if (type === "delta" && typeof ev.text === "string") {
        contentEvents += 1;
        visibleText += ev.text;
      }
      if (type === "replace" && typeof ev.text === "string") {
        contentEvents += 1;
        visibleText = ev.text;
      }
      if (type === "done") {
        doneEventPresent = true;
        doneEvent = ev;
        if (typeof ev.finalContent === "string") visibleText = ev.finalContent;
        if (ev.usage) usageEventPresent = true;
      }
      if (type === "error") {
        errorEvent = String(ev.error ?? "unknown error");
      }
    }
  }

  return {
    httpStatus,
    latencyMs: Date.now() - startedAt,
    visibleText,
    doneEvent,
    errorEvent,
    totalStreamEvents,
    contentEvents,
    usageEventPresent,
    doneEventPresent,
  };
}

function loadPreflightAssembly() {
  const db = getDb();
  const chat = db
    .prepare(
      `SELECT id, mode, gemini_model, selected_persona_id, target_response_chars, user_impersonation
       FROM chats WHERE id=?`
    )
    .get(CHAT_ID) as {
    id: number;
    mode: string;
    gemini_model: string;
    selected_persona_id: number | null;
    target_response_chars: number | null;
    user_impersonation: number;
  };

  const rows = db
    .prepare(
      `SELECT id, role, content, model, user_message_id FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(CHAT_ID) as Array<{
    id: number;
    role: "user" | "assistant";
    content: string;
    model: string;
    user_message_id: number | null;
  }>;

  const boundary = resolveRegenerationContextBoundary(rows, REGEN_ASSISTANT_ID);
  if (!boundary) throw new Error("Regeneration boundary not found");

  const humanInput = boundary.parentUser.content;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(CHARACTER_ID) as Record<
    string,
    unknown
  >;
  const personaRow = db
    .prepare("SELECT id, name, gender, description FROM user_personas WHERE id=?")
    .get(chat.selected_persona_id ?? 881000203) as {
    id: number;
    name: string;
    gender: string;
    description: string;
  };

  const stored = deserializeCharacterChunks(String(ch.setting_chunks ?? ""));
  const loaded = loadCharacterChunksForPromptReadOnly(
    {
      id: CHARACTER_ID,
      name: String(ch.name),
      gender: String(ch.gender),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      setting_chunks_en: String(ch.setting_chunks_en ?? ""),
      prompt_translation_hash: stored.length ? hashKoreanChunks(stored) : null,
      speech_profile: String(ch.speech_profile ?? ""),
      creator_compiled_description_json: String(ch.creator_compiled_description_json ?? ""),
      appearance_raw: String(ch.appearance_raw ?? ""),
      appearance_compiled: String(ch.appearance_compiled ?? ""),
    },
    personaRow.name,
    personaRow.name
  );

  const personaPrompt = formatPublicPersonaForPrompt(
    personaRow.name,
    personaRow.gender,
    toPublicPersonaDescription(personaRow.description ?? "")
  );
  const exampleDialog = resolveExampleDialogForPrompt(
    String(ch.example_dialog ?? ""),
    String(ch.name)
  );

  const historyRows = boundary.historyRows.filter((r) => r.role === "user" || r.role === "assistant");
  const shortTermHistory: ChatMsg[] = historyRows.map((r) => ({
    role: r.role,
    content: r.content,
  }));
  const playableTurns = shortTermHistory.filter((m) => m.role === "assistant").length;

  const built = buildContext({
    charName: String(ch.name),
    contentKind: "character",
    narrativePov: resolveNarrativePov({
      mode: "third_person",
      contentKind: "character",
      mainCharacterName: String(ch.name),
    }),
    chunks: loaded.chunks,
    systemPrompt: String(ch.system_prompt ?? ""),
    world: String(ch.world ?? ""),
    exampleDialog,
    speechProfileJson: String(ch.speech_profile ?? ""),
    speechPersonality: String(ch.speech_personality ?? ""),
    speechTraits: String(ch.speech_traits ?? ""),
    characterPersonality: String(ch.description ?? ""),
    userNickname: personaRow.name,
    userPersona: personaPrompt,
    shortTermHistory,
    currentUserMessage: humanInput,
    nsfw: true,
    gender: resolveCharacterGender(String(ch.gender)),
    modelId: chat.gemini_model || "gemini-3.7-flash",
    runtimeMode: "interactive",
    personaDisplayName: personaRow.name,
    targetResponseChars: chat.target_response_chars ?? 3200,
    completedTurns: playableTurns,
    userPersonaGender: personaRow.gender ?? "other",
    provider: "cheaperinference",
    genres: parseGenresJson(String(ch.genres ?? "")),
    useEnglishCharacterPrompt: loaded.usedEnglish,
    regenerate: true,
    rejectedAssistantDraft: boundary.targetAssistant.content.trim() || undefined,
  });

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt || "",
    history: built.history,
    modelId: chat.gemini_model || "gemini-3.7-flash",
    targetResponseChars: chat.target_response_chars ?? 3200,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: String(ch.name),
    },
  });

  const requestBodyJson = JSON.stringify(assembled.requestBody);
  const contextJson = buildGenerationContextJson({
    promptAudit: built.meta.promptAudit,
    writingStyle: "unified",
    completedTurns: playableTurns,
    targetResponseChars: chat.target_response_chars ?? 3200,
    userImpersonation: !!chat.user_impersonation,
    model: chat.gemini_model || "gemini-3.7-flash",
    provider: "cheaperinference",
    route: chat.mode,
    nsfw: true,
  });

  return {
    humanInput,
    humanInputSha: sha256(humanInput),
    humanInputChars: humanInput.length,
    requestBodySha256: sha256(requestBodyJson),
    requestBodyRedacted: redactRequestBody(assembled.requestBody as Record<string, unknown>),
    promptHashPrefix: computePromptHash(contextJson),
    assembledInputTokens: built.meta.promptAudit?.totalAssembledTokens ?? null,
    maxTokens: (assembled.requestBody as { max_tokens?: unknown }).max_tokens ?? null,
    stream: (assembled.requestBody as { stream?: unknown }).stream ?? null,
    model: String((assembled.requestBody as { model?: unknown }).model ?? ""),
    targetResponseChars: chat.target_response_chars ?? 3200,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const requestTimestamp = new Date().toISOString();
  const clientRequestId = `h1_r1_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const preflight = loadPreflightAssembly();
  const preflightPath = path.join(OUT_DIR, "R1_PREFLIGHT_REQUEST.json");
  fs.writeFileSync(
    preflightPath,
    `${JSON.stringify({ requestTimestamp, clientRequestId, ...preflight }, null, 2)}\n`,
    "utf8"
  );

  console.log("[H1-R1] preflight", {
    humanInputChars: preflight.humanInputChars,
    humanInputSha: preflight.humanInputSha,
    requestBodySha256: preflight.requestBodySha256,
    promptHashPrefix: preflight.promptHashPrefix,
    maxTokens: preflight.maxTokens,
  });

  const capture = await runRegenerateCapture(clientRequestId);

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, content, model, usage, request_id, generation_status, created_at, updated_at
       FROM messages WHERE id=?`
    )
    .get(REGEN_ASSISTANT_ID) as {
    id: number;
    content: string;
    model: string;
    usage: string | null;
    request_id: string | null;
    generation_status: string;
    created_at: string;
    updated_at: string;
  };

  const usage = row.usage ? (JSON.parse(row.usage) as Record<string, unknown>) : {};
  const stages = Array.isArray(usage.stages) ? (usage.stages[0] as Record<string, unknown>) : {};
  const finishReason =
    (typeof usage.finishReason === "string" && usage.finishReason) ||
    (typeof stages.finishReason === "string" && stages.finishReason) ||
    (capture.doneEvent?.finishReason as string | undefined) ||
    null;

  const dbText = row.content;
  const serverVisible = capture.visibleText;
  const parity =
    dbText === serverVisible
      ? "true"
      : dbText.trimEnd() === serverVisible.trimEnd()
        ? "trim_only"
        : "false";

  const endsIncompleteFlag = endsIncomplete(dbText);
  const technicallyValid =
    !capture.errorEvent &&
    row.generation_status === "completed" &&
    dbText.trim().length > 200 &&
    !endsIncompleteFlag &&
    parity !== "false";

  const report = {
    DEEPSEEK0813_GEMINI37_H1_SOURCE_R1: true,
    FAILED_SOURCE_PRESERVED: true,
    FAILED_CALL_ID: "cr_mszh62oh_e2gs51ql",
    FAILED_ROOT_CAUSE: "UPSTREAM_STREAM_PREMATURE_EOF",
    HUMAN_INPUT_REUSED_EXACTLY: true,
    HUMAN_INPUT_SHA256: preflight.humanInputSha,
    FIXTURE_CHANGED: false,
    PROMPT_CHANGED: false,
    MAX_TOKENS_CHANGED: false,
    REPLACEMENT_CAPTURE_CALLS: 1,
    REQUEST_TIMESTAMP: requestTimestamp,
    CLIENT_REQUEST_ID: clientRequestId,
    REQUEST_BODY_SHA256: preflight.requestBodySha256,
    PROMPT_HASH_PREFIX: preflight.promptHashPrefix,
    SELECTED_MODEL: preflight.model,
    DELIVERED_MODEL: row.model,
    DELIVERED_PROVIDER: usage.provider ?? "cheaperinference",
    HTTP_STATUS: capture.httpStatus,
    PROVIDER_REQUEST_ID: null,
    APP_SSE_TOTAL_STREAM_EVENTS: capture.totalStreamEvents,
    APP_SSE_CONTENT_EVENTS: capture.contentEvents,
    USAGE_EVENT_PRESENT: capture.usageEventPresent,
    DONE_EVENT_PRESENT: capture.doneEventPresent,
    STREAM_ERROR: capture.errorEvent,
    FINISH_REASON: finishReason,
    SOURCE_VISIBLE_CHARS: dbText.length,
    SOURCE_VISIBLE_CHARS_NO_WS: visibleNoWs(dbText),
    SOURCE_INPUT_TOKENS: usage.input ?? usage.apiInputTokens ?? null,
    SOURCE_OUTPUT_TOKENS: usage.output ?? usage.apiOutputTokens ?? null,
    SOURCE_LATENCY_MS: capture.latencyMs,
    ENDS_INCOMPLETE: endsIncompleteFlag,
    PIPELINE_TEXT_PARITY: parity,
    SERVER_VISIBLE_CHARS: serverVisible.length,
    DB_STORED_CHARS: dbText.length,
    GEMINI_SOURCE_READY: technicallyValid,
    REPEATED_UPSTREAM_STREAM_FAILURE: !technicallyValid && endsIncompleteFlag,
    EXPERIMENTAL_RETRY: 0,
    CONTINUATION: 0,
    RECOVERY: 0,
    DEEPSEEK_CALLS: 0,
  };

  const reportPath = path.join(OUT_DIR, "H1_SOURCE_R1_REPORT.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.copyFileSync(reportPath, path.join(ARTIFACT_DIR, "h1_source_r1_report.json"));

  if (technicallyValid) {
    fs.writeFileSync(path.join(OUT_DIR, "GEMINI_SOURCE_R1_RAW.txt"), dbText, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, "HUMAN_CUT_INPUT_RAW.txt"), preflight.humanInput, "utf8");
    fs.copyFileSync(
      path.join(OUT_DIR, "GEMINI_SOURCE_R1_RAW.txt"),
      path.join(ARTIFACT_DIR, "gemini_source_r1_raw.txt")
    );
  }

  console.log(JSON.stringify(report, null, 2));
  if (!technicallyValid) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("[H1-R1] failed", err);
  process.exit(1);
});
