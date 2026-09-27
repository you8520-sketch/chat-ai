/**
 * Real production-data Main RP quality verification (audit-only).
 *
 * Requires a read-only production SQLite copy:
 *   SOURCE_DB_PATH=/path/to/app.db  (file or directory containing app.db)
 *
 * Invariants (unchanged):
 *   TURN_LENGTH_SUPPLEMENT_API_ENABLED=false
 *   MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1
 *   exactly 1 provider call per sample — no retry / continuation / regen supplement
 *
 *   LABEL=real-data-quality REPS=3 \
 *     SOURCE_DB_PATH=/path/to/production-copy.db \
 *     npx tsx scripts/real-data-quality-benchmark.ts
 */
import "./lib/server-only-mock";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import {
  exitIfBenchmarkCheaperInferenceApiKeyMissing,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "../src/lib/chatModels";
import {
  MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
} from "../src/lib/turnApiBudget";
import { resolveRegenerationContextBoundary } from "../src/lib/regenerationContext";
import { isAdminUser } from "../src/lib/isAdminUser";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LABEL = process.env.LABEL?.trim() || "real-data-quality";
const OUT_ROOT = path.join("/opt/cursor/artifacts", LABEL);
const REPS = Math.max(1, Math.min(5, Number(process.env.REPS ?? 3) || 3));
const CHAT_ID = Number(process.env.BENCHMARK_CHAT_ID ?? "707");
const CHARACTER_ID = Number(process.env.BENCHMARK_CHARACTER_ID ?? "18");
const PERSONA_NAME = (process.env.BENCHMARK_PERSONA_NAME ?? "렌").trim();
const MODELS = [
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
];
const ASSISTANT_MSG_ID = process.env.BENCHMARK_ASSISTANT_MESSAGE_ID
  ? Number(process.env.BENCHMARK_ASSISTANT_MESSAGE_ID)
  : null;

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function write(rel: string, content: string | object) {
  const p = path.join(OUT_ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8",
  );
}

function resolveSourceDbPath(): string {
  const raw = process.env.SOURCE_DB_PATH?.trim();
  if (!raw) {
    const fallback = path.join(process.cwd(), "data", "app.db");
    return fallback;
  }
  const resolved = path.resolve(raw);
  if (fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, "app.db");
  }
  return resolved;
}

type StopReport = {
  stop: true;
  reason: string;
  details: Record<string, unknown>;
};

function verifyBaseline(dbPath: string): StopReport | { ok: true; dbPath: string } {
  if (!fs.existsSync(dbPath)) {
    return {
      stop: true,
      reason: "SOURCE_DB_NOT_FOUND",
      details: {
        dbPath,
        hint: "Mount a read-only Railway production copy at SOURCE_DB_PATH",
      },
    };
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const ch = db
      .prepare("SELECT id, name FROM characters WHERE id=?")
      .get(CHARACTER_ID) as { id: number; name: string } | undefined;
    if (!ch) {
      return {
        stop: true,
        reason: "CHARACTER_18_NOT_FOUND",
        details: { dbPath, characterId: CHARACTER_ID },
      };
    }
    if (ch.name.trim() !== "라이크") {
      return {
        stop: true,
        reason: "CHARACTER_NAME_MISMATCH",
        details: { expected: "라이크", actual: ch.name, characterId: CHARACTER_ID },
      };
    }

    const chat = db
      .prepare(
        `SELECT id, character_id, user_id, selected_persona_id, mode, target_response_chars,
                user_note, memory_meta, narrative_pov, user_coauthor_mode
         FROM chats WHERE id=?`,
      )
      .get(CHAT_ID) as Record<string, unknown> | undefined;
    if (!chat) {
      return {
        stop: true,
        reason: "CHAT_707_NOT_FOUND",
        details: { dbPath, chatId: CHAT_ID },
      };
    }
    if (Number(chat.character_id) !== CHARACTER_ID) {
      return {
        stop: true,
        reason: "CHAT_CHARACTER_MISMATCH",
        details: {
          chatId: CHAT_ID,
          expectedCharacterId: CHARACTER_ID,
          actualCharacterId: chat.character_id,
        },
      };
    }

    const persona = chat.selected_persona_id
      ? (db
          .prepare(
            `SELECT p.id, p.name, p.user_id, p.gender, p.description, u.is_admin, u.email, u.nickname
             FROM user_personas p JOIN users u ON u.id = p.user_id WHERE p.id=?`,
          )
          .get(chat.selected_persona_id) as
          | {
              id: number;
              name: string;
              user_id: number;
              gender: string;
              description: string;
              is_admin: number;
              email: string;
              nickname: string;
            }
          | undefined)
      : undefined;

    if (!persona) {
      return {
        stop: true,
        reason: "CHAT_PERSONA_NOT_RESOLVED",
        details: { chatId: CHAT_ID, selected_persona_id: chat.selected_persona_id },
      };
    }
    if (persona.name.trim() !== PERSONA_NAME) {
      return {
        stop: true,
        reason: "PERSONA_NAME_MISMATCH",
        details: { expected: PERSONA_NAME, actual: persona.name, personaId: persona.id },
      };
    }
    if (!isAdminUser({ email: persona.email, is_admin: persona.is_admin })) {
      return {
        stop: true,
        reason: "PERSONA_OWNER_NOT_ADMIN",
        details: { personaId: persona.id, userId: persona.user_id },
      };
    }

    const msgCount = db
      .prepare("SELECT COUNT(*) AS c FROM messages WHERE chat_id=?")
      .get(CHAT_ID) as { c: number };
    if (msgCount.c < 4) {
      return {
        stop: true,
        reason: "CHAT_HISTORY_TOO_SHORT",
        details: { chatId: CHAT_ID, messageCount: msgCount.c },
      };
    }

    return { ok: true, dbPath };
  } finally {
    db.close();
  }
}

function selectAssistantMessageId(dbPath: string): {
  messageId: number;
  reason: string;
} {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (ASSISTANT_MSG_ID != null && Number.isInteger(ASSISTANT_MSG_ID)) {
      const row = db
        .prepare(
          `SELECT id FROM messages WHERE id=? AND chat_id=? AND role='assistant' AND model != 'greeting'`,
        )
        .get(ASSISTANT_MSG_ID, CHAT_ID) as { id: number } | undefined;
      if (!row) throw new Error(`BENCHMARK_ASSISTANT_MESSAGE_ID ${ASSISTANT_MSG_ID} not in chat ${CHAT_ID}`);
      return {
        messageId: row.id,
        reason: "env_BENCHMARK_ASSISTANT_MESSAGE_ID",
      };
    }

    const row = db
      .prepare(
        `SELECT m.id, LENGTH(m.content) AS len
         FROM messages m
         WHERE m.chat_id=? AND m.role='assistant' AND m.model != 'greeting'
           AND m.generation_status IN ('completed', 'complete', 'done', 'saved')
         ORDER BY m.id DESC
         LIMIT 1`,
      )
      .get(CHAT_ID) as { id: number; len: number } | undefined;

    if (!row) {
      const fallback = db
        .prepare(
          `SELECT id FROM messages
           WHERE chat_id=? AND role='assistant' AND model != 'greeting'
           ORDER BY id DESC LIMIT 1`,
        )
        .get(CHAT_ID) as { id: number } | undefined;
      if (!fallback) throw new Error("No assistant message to snapshot");
      return {
        messageId: fallback.id,
        reason: "latest_assistant_any_status",
      };
    }
    return {
      messageId: row.id,
      reason: "latest_completed_assistant",
    };
  } finally {
    db.close();
  }
}

function flatContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

type Capture = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  error: string | null;
  status: number;
  latencyMs: number;
};

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Capture> {
  const started = Date.now();
  const out: Capture = {
    text: "",
    finish: null,
    usage: null,
    error: null,
    status: 0,
    latencyMs: 0,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    out.status = res.status;
    if (!res.ok || !res.body) {
      out.error = sanitizeBenchmarkCredentialText((await res.text()).slice(0, 1500));
      out.latencyMs = Date.now() - started;
      return out;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      const t = line.trim();
      if (!t.startsWith("data:")) return;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as Record<string, unknown>;
        const choice = (ev.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string") out.text += delta.content;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          out.finish = choice.finish_reason;
        }
        if (ev.usage && typeof ev.usage === "object") {
          out.usage = ev.usage as Record<string, unknown>;
        }
      } catch {
        // partial frame
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    buf += dec.decode();
    if (buf.trim()) handle(buf);
  } catch (e) {
    out.error = sanitizeBenchmarkCredentialText(String(e)).slice(0, 1500);
  }
  out.latencyMs = Date.now() - started;
  return out;
}

function usageNumbers(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      prompt_tokens: null as number | null,
      completion_tokens: null as number | null,
      reasoning_tokens: null as number | null,
    };
  }
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? NaN);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? NaN);
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningRaw = details?.reasoning_tokens ?? usage.reasoning_tokens;
  const reasoning =
    reasoningRaw != null && Number.isFinite(Number(reasoningRaw))
      ? Number(reasoningRaw)
      : null;
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : null,
    completion_tokens: Number.isFinite(completion) ? completion : null,
    reasoning_tokens: reasoning,
  };
}

const OCCURRENCE_PATTERNS: Record<string, RegExp[]> = {
  DIRECT_EMOTION_LABEL: [
    /(?:불안|무서|걱정|화가|슬퍼|당황|설레|짜증|분노|우울|외로|기쁨|행복)(?:했|졌|난|났|돼|함|스러)/,
    /(?:느꼈다|느껴졌다|감정이)/,
  ],
  SHOW_THROUGH_BEHAVIOR: [
    /(?:시선|눈빛|표정|입꼬리|미간|호흡|숨|손끝|어깨|걸음|거리|자세|고개)/,
  ],
  INNER_MONOLOGUE_OVERUSE: [/(?:생각|마음|머릿속|뇌리|의식|자문|스스로)/],
  SENSORY_GROUNDING: [/(?:냄새|향|소리|온기|차가|따뜻|촉|질감|맛|바람|공기)/],
  ENVIRONMENT_DETAIL: [/(?:복도|로비|식당|창|천장|벽|바닥|조명|그림자|공간)/],
  APPEARANCE_DETAIL: [/(?:머리|눈|피부|옷|재킷|키|체형|외모|이목)/],
  SEMANTIC_REPETITION: [],
  MICRO_ACTION_LOOP: [/(?:손가락|눈을|시선을|숨을).{0,40}(?:손가락|눈을|시선을|숨을)/],
  EXPLANATION_AFTER_SHOWING: [/(?:라는\s*뜻|때문이었다|의미였|것이었다|듯했다)\s*[\.\!]?$/m],
  PSEUDO_CLINICAL_EXPLANATION: [/(?:심리|분석|패턴|지표|데이터|통계|메커니즘)/],
  AGENCY_VIOLATION: [/(?:렌이\s*(?:말|외쳐|고함|선언|결정|선택))/],
  REGISTER_VIOLATION: [/(?:「|」)/, /(?:라고\s*말했(?:다|어)?\s*[\.\!]?$)/m],
  LAYOUT_VIOLATION: [],
};

function annotateOccurrences(text: string): Record<string, { hit: boolean; evidence: string[] }> {
  const out: Record<string, { hit: boolean; evidence: string[] }> = {};
  for (const [key, patterns] of Object.entries(OCCURRENCE_PATTERNS)) {
    const evidence: string[] = [];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[0]) evidence.push(m[0].slice(0, 120));
    }
    out[key] = { hit: evidence.length > 0, evidence: evidence.slice(0, 3) };
  }
  return out;
}

async function buildOwnerMap() {
  const { COMMON_PROSE_BLOCK } = await import("../src/lib/advancedProseNsfwGuidelines");
  const {
    DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
    DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
  } = await import("../src/lib/deepseekPromptStructure");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  return {
    COMMON_PROSE: {
      owner: "src/lib/advancedProseNsfwGuidelines.ts COMMON_PROSE_BLOCK",
      approxTokens: estimateTokens(COMMON_PROSE_BLOCK),
    },
    deepseek_style_stack: {
      bottom_style_only: DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 120) + "…",
      length_single_call_present: DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK.includes("SINGLE CALL"),
      note: "DeepSeek wire adds bottom style reminder + length single-call block via openRouterAdult",
    },
    gemini_37: {
      owner: "Shared COMMON_PROSE + model adapter in openRouterAdult / contextBuilder",
    },
    production_invariants: {
      TURN_LENGTH_SUPPLEMENT_API_ENABLED,
      MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
    },
  };
}

async function main() {
  const mainSha = process.env.MAIN_SHA?.trim() || "unknown";
  write("git-baseline.json", {
    recordedAt: new Date().toISOString(),
    originMainSha: mainSha,
    headSha: process.env.HEAD_SHA?.trim() || "unknown",
  });

  if (TURN_LENGTH_SUPPLEMENT_API_ENABLED !== false) {
    throw new Error("benchmark expects TURN_LENGTH_SUPPLEMENT_API_ENABLED=false");
  }
  if (MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN !== 1) {
    throw new Error("benchmark expects MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1");
  }

  const ownerMap = await buildOwnerMap();
  write("owner-map.json", ownerMap);

  const dbPath = resolveSourceDbPath();
  const baseline = verifyBaseline(dbPath);
  write("real-data-proof.json", {
    dbPath,
    sourceDbPathEnv: process.env.SOURCE_DB_PATH ?? null,
    baseline,
  });

  if ("stop" in baseline && baseline.stop) {
    write("STOP_REPORT.json", {
      classification: "ROOT_CAUSE_UNCONFIRMED",
      providerCallsAttempted: 0,
      stopReason: baseline.reason,
      details: baseline.details,
      note: "Provider testing skipped per STOP conditions (§18)",
    });
    console.error("[real-data-quality] STOP:", baseline.reason, baseline.details);
    process.exit(2);
  }

  process.env.DATA_DIR = path.dirname(dbPath);
  const { getDb } = await import("../src/lib/db");
  const db = getDb();

  const selection = selectAssistantMessageId(dbPath);
  write("snapshot-selection.json", selection);

  const rows = db
    .prepare(
      `SELECT id, role, content, model, user_message_id FROM messages WHERE chat_id=? ORDER BY id ASC`,
    )
    .all(CHAT_ID) as Array<{
    id: number;
    role: "user" | "assistant";
    content: string;
    model: string;
    user_message_id: number | null;
  }>;

  const boundary = resolveRegenerationContextBoundary(rows, selection.messageId);
  if (!boundary) {
    write("STOP_REPORT.json", {
      classification: "ROOT_CAUSE_UNCONFIRMED",
      providerCallsAttempted: 0,
      stopReason: "REGENERATION_BOUNDARY_NOT_FOUND",
      messageId: selection.messageId,
    });
    process.exit(2);
  }

  const chat = db
    .prepare("SELECT * FROM chats WHERE id=?")
    .get(CHAT_ID) as Record<string, unknown>;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(CHARACTER_ID) as Record<
    string,
    unknown
  >;
  const personaRow = db
    .prepare("SELECT * FROM user_personas WHERE id=?")
    .get(chat.selected_persona_id) as Record<string, unknown>;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(chat.user_id) as Record<
    string,
    unknown
  >;

  const {
    buildContext,
  } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { loadCharacterChunksForPromptReadOnly } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } =
    await import("../src/lib/chatMemory");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } = await import(
    "../src/lib/currentTurnUserAuthoringDelegation"
  );
  const { resolveExampleDialogForPrompt } = await import("../src/lib/narrationFewShotTemplates");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { parseAssets, chatAssets } = await import("../src/lib/characterAssets");
  const { replaceUserPlaceholder } = await import("../src/lib/userPlaceholder");
  const { messagesToTurns, rawRecentTurnsToHistory, resolveLorebookExcludeFromTrimmedHistory } =
    await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory, trimHistoryToBudget, resolveHistoryTokenBudget } =
    await import("../src/lib/contextTrack");
  const { isMemoryFeatureEnabled } = await import("../src/lib/memory/memory-feature");
  const {
    buildMemoryContextForPreview,
    resolveMemoryTier,
  } = await import("../src/lib/memory/memory-manager");
  const { getChatMemoryCapacity } = await import("../src/lib/memory/memory-capacity");
  const { resolveRelationshipMetaNames } = await import("../src/lib/relationshipMetaCharacterName");

  const personaDisplayName = String(personaRow.name ?? user.nickname ?? PERSONA_NAME).trim();
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    (personaRow.gender as "male" | "female" | "other") ?? "other",
    String(personaRow.description ?? ""),
  );
  const userNotePrompt = formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? ""));

  const loaded = loadCharacterChunksForPromptReadOnly(
    {
      id: CHARACTER_ID,
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      setting_chunks_en: String(ch.setting_chunks_en ?? ""),
      prompt_translation_hash: String(ch.prompt_translation_hash ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
      creator_compiled_description_json: String(ch.creator_compiled_description_json ?? ""),
      appearance_raw: String(ch.appearance_raw ?? ""),
      appearance_compiled: String(ch.appearance_compiled ?? ""),
    },
    personaDisplayName,
    String(user.nickname ?? personaDisplayName),
  );

  const historyRows = boundary.historyRows.filter(
    (r) => r.role === "user" || r.role === "assistant",
  );
  const shortTermHistory = historyRows.map((r) => ({
    role: r.role,
    content: replaceUserPlaceholder(
      r.content,
      personaDisplayName,
      String(user.nickname ?? personaDisplayName),
    ),
  }));
  const currentUserMessage = replaceUserPlaceholder(
    boundary.parentUser.content,
    personaDisplayName,
    String(user.nickname ?? personaDisplayName),
  );
  const completedTurns = shortTermHistory.filter((m) => m.role === "assistant").length;
  const targetResponseChars = Number(chat.target_response_chars ?? 3200);
  const nsfw = String(chat.mode) === "nsfw";
  const genres = sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]")));
  const assetTags = [
    ...new Set(chatAssets(parseAssets(String(ch.assets ?? "[]"))).map((a) => a.tag)),
  ];

  const dialogueTurns = messagesToTurns(
    rows.map(({ role, content, model }) => ({ role, content, model })),
  );
  const sharedModelForMemory = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
  const historyTokenBudget = resolveHistoryTokenBudget(sharedModelForMemory, "openrouter");
  const recentHistoryFull = rawRecentTurnsToHistory(dialogueTurns).map((m) => ({
    ...m,
    content: replaceUserPlaceholder(
      m.content,
      personaDisplayName,
      String(user.nickname ?? personaDisplayName),
    ),
  }));
  const trimmedHistoryForLorebook = trimHistoryToBudget(recentHistoryFull, historyTokenBudget);

  const memoryFeatureOn = isMemoryFeatureEnabled();
  const memoryInjection = memoryFeatureOn
    ? await buildMemoryContextForPreview({
        chatId: CHAT_ID,
        tier: resolveMemoryTier(user as import("@/lib/auth").User),
        memoryCapacity: getChatMemoryCapacity(CHAT_ID),
        userMessage: currentUserMessage,
        modelId: sharedModelForMemory,
        provider: "openrouter",
        excludeSummaryTurnStartGte: resolveLorebookExcludeFromTrimmedHistory(
          dialogueTurns,
          trimmedHistoryForLorebook,
        ),
      })
    : { text: "", mediumTermText: "", archiveText: "" };

  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks: loaded.chunks,
    userName: personaDisplayName,
  });

  const longTermMemory = memoryFeatureOn ? memoryInjection.text : "";
  const memoryMeta = formatMemoryMetaForPrompt(
    normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames),
  );

  const narrativePov = resolveNarrativePov({
    mode: (chat.narrative_pov as "first_person" | "third_person") ?? "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });

  const directive = buildSceneDirective({
    mode: "interactive",
    recentMessages: shortTermHistory,
    currentUserMessage,
    memoryText: longTermMemory,
    relationshipMemoryText: "",
    lorebookText: "",
    triggeredEventText: "",
    chatId: CHAT_ID,
    currentTurn: completedTurns + 1,
    progressionHistory: [],
    contentKind: "character",
    primaryCharacterName: String(ch.name),
  });

  const sharedStateFingerprint = sha256(
    JSON.stringify({
      characterId: CHARACTER_ID,
      chatId: CHAT_ID,
      personaId: personaRow.id,
      messageId: selection.messageId,
      parentUserSha: sha256(currentUserMessage),
      historySha: sha256(JSON.stringify(shortTermHistory)),
      longTermMemorySha: sha256(longTermMemory),
      memoryMetaSha: sha256(memoryMeta),
      targetResponseChars,
      nsfw,
    }),
  );

  write("input-parity.json", {
    sharedStateFingerprint,
    character: { id: CHARACTER_ID, name: ch.name },
    chat: { id: CHAT_ID, mode: chat.mode, targetResponseChars },
    persona: {
      id: personaRow.id,
      name: personaRow.name,
      fingerprint: sha256(String(personaRow.description ?? "")),
    },
    snapshot: {
      assistantMessageId: selection.messageId,
      parentUserMessageId: boundary.parentUser.id,
      selectionReason: selection.reason,
    },
    historyMessageCount: shortTermHistory.length,
    currentUserMessageChars: currentUserMessage.length,
    note: "Model-specific diffs expected only via adapters/generation params on wire",
  });

  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing("REAL_DATA_QUALITY_NOT_RUN");
  const headers = buildCheaperInferenceHeaders(apiKey);

  const assembleForModel = (modelId: string) => {
    const built = buildContext({
      charName: String(ch.name),
      contentKind: "character",
      narrativePov,
      chunks: loaded.chunks,
      systemPrompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      exampleDialog: resolveExampleDialogForPrompt(String(ch.example_dialog ?? ""), String(ch.name)),
      speechProfileJson: String(ch.speech_profile ?? ""),
      characterPersonality: String(ch.description ?? ""),
      userNickname: String(user.nickname ?? personaDisplayName),
      userPersona: userPersonaPrompt,
      userNote: userNotePrompt,
      longTermMemory,
      mediumTermMemoryBlock: memoryFeatureOn ? memoryInjection.mediumTermText : "",
      archiveMemory: memoryFeatureOn ? memoryInjection.archiveText : "",
      shortTermHistory,
      currentUserMessage,
      nsfw,
      gender: resolveCharacterGender(String(ch.gender ?? "")),
      assetTags: assetTags.length ? assetTags : undefined,
      memoryMeta,
      modelId,
      currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
      novelModeEnabled: Number(chat.novel_mode) === 1,
      personaDisplayName,
      targetResponseChars,
      completedTurns,
      userPersonaGender: (personaRow.gender as "male" | "female" | "other") ?? "other",
      provider: "openrouter",
      genres,
      useEnglishCharacterPrompt: loaded.usedEnglish,
      sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
      scenePacingPromptOwner: "legacy_v1",
      promptDumpSource: "db",
      promptDumpDetail: `chat=${CHAT_ID} character=${CHARACTER_ID} snapshot=${selection.messageId}`,
    });

    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history,
      modelId,
      targetResponseChars,
      messageOpts: {
        transportProvider: "cheaperinference",
        charName: String(ch.name),
        personaName: personaDisplayName,
        sceneServerControls: {
          mode: "interactive",
          contentKind: "character",
          party: false,
          primaryCharacterName: String(ch.name),
          currentUserMessage,
          recentMessages: shortTermHistory,
          memoryText: longTermMemory,
          adultModeEnabled: nsfw,
          chatId: CHAT_ID,
          currentTurn: completedTurns + 1,
          progressionHistory: [],
          canonicalSceneDirective: directive,
          skipMotionCue: false,
        },
      },
    });

    const body = {
      ...(wire.requestBody as Record<string, unknown>),
      stream: true,
      stream_options: { include_usage: true },
    };
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const system = flatContent(messages.find((m) => m.role === "system")?.content);
    const lastUser = flatContent([...messages].reverse().find((m) => m.role === "user")?.content);
    return {
      body,
      systemSha: sha256(system),
      lastUserSha: sha256(lastUser),
      promptSections: built.meta.trackedSections?.map((s) => ({
        id: s.id,
        chars: s.text.length,
      })),
    };
  };

  const wireInventory: Record<string, unknown> = {};
  for (const modelId of MODELS) {
    const w = assembleForModel(modelId);
    wireInventory[modelId] = {
      systemSha256: w.systemSha,
      lastUserSha256: w.lastUserSha,
      sections: w.promptSections,
    };
    write(`wire/${modelId}/system-sha256.txt`, w.systemSha);
  }
  write("final-prompt-section-inventory.json", wireInventory);

  const index: Record<string, unknown>[] = [];
  let totalCalls = 0;

  for (const modelId of MODELS) {
    const w = assembleForModel(modelId);
    for (let rep = 1; rep <= REPS; rep++) {
      totalCalls += 1;
      const tag = `${modelId.replace(/\//g, "_")}/r${rep}`;
      console.log(`[real-data-quality] ${tag} call=${totalCalls}`);
      const cap = await streamOnce(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers,
        w.body,
      );
      const visibleChars = visibleAssistantDisplayCharCount(cap.text);
      const usage = usageNumbers(cap.usage);
      write(`raw/${tag}.txt`, cap.text);
      const occurrences = annotateOccurrences(cap.text);
      const row = {
        model: modelId,
        provider: "cheaperinference",
        characterId: CHARACTER_ID,
        personaFingerprint: sha256(String(personaRow.description ?? "")),
        chatId: CHAT_ID,
        snapshotAssistantMessageId: selection.messageId,
        contextFingerprint: sharedStateFingerprint,
        systemPromptSha256: w.systemSha,
        visibleChars,
        ...usage,
        finish_reason: cap.finish,
        latencyMs: cap.latencyMs,
        httpStatus: cap.status,
        error: cap.error,
        occurrences,
      };
      write(`meta/${tag}.json`, row);
      index.push(row);
    }
  }

  write("raw-output-index.json", {
    totalProviderCalls: totalCalls,
    repsPerModel: REPS,
    models: MODELS,
    rows: index,
  });

  write("STOP_REPORT.json", {
    classification: "PENDING_HUMAN_REVIEW",
    providerCallsAttempted: totalCalls,
    note: "Occurrence matrix is heuristic evidence only — no Cursor quality score",
  });

  console.log(`[real-data-quality] done calls=${totalCalls} artifacts=${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
