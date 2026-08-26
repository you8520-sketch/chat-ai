/**
 * TRPG reply-suggestion model benchmark (OpenRouter only).
 *
 * Compares candidate models with production-identical prompt/parser contract.
 * Does NOT touch production routing, DB writes, or runtime bundles.
 *
 * Run:
 *   node --conditions=react-server --import tsx scripts/trpg-reply-suggestion-model-bench.ts
 *   node --conditions=react-server --import tsx scripts/trpg-reply-suggestion-model-bench.ts --quality-samples
 *   node --conditions=react-server --import tsx scripts/trpg-reply-suggestion-model-bench.ts --deepseek-vs-luna
 *
 * Output: sanitized JSON summary path printed to stdout (no persona/scene/completion text).
 * Quality samples mode writes human-review suggestion text to docs/audits/.../QUALITY-SAMPLES-*.md
 * DeepSeek vs Luna mode writes full parsed suggestions for ChatGPT human review.
 */
import Module from "node:module";

const origLoad = Module._load;
// @ts-expect-error legacy hook
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy
  return origLoad(request, parent, isMain);
};

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_GEMINI_25_FLASH_LITE_MODEL,
  isCheaperInferenceDeepSeekV4FlashModel,
  isGeminiFlashOpenRouterModel,
  isGpt56LunaModel,
} from "../src/lib/chatModels";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveOpenRouterApiKey,
} from "../src/lib/openRouterConfig";
import {
  buildOpenRouterRequestBody,
  isOpenRouterRpReasoningDisabledModel,
  isQwenOpenRouterModel,
} from "../src/lib/openRouterClient";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { isAdminUser } from "../src/lib/isAdminUser";
import { ensureTrpgTables } from "../src/lib/trpg/schema";
import {
  TRPG_REPLY_SCENE_MAX_CHARS,
  TRPG_REPLY_SUGGESTION_MAX_TOKENS,
  buildReplySuggestionPublicContext,
  loadRecentManualHumanActions,
  validateReplySuggestionCompletion,
  parseReplySuggestions,
  adaptTrpgReplySuggestionChatBody,
} from "../src/lib/trpg/replySuggestions";
import { loadSheetSnapshots } from "../src/lib/trpg/engineSheets";
import { parseHumanPersona } from "../src/lib/trpg/hostPersona";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "../src/lib/trpg/engineCreate";
import { startTrpgCampaign } from "../src/lib/trpg/engineAdvance";
import { clipTrpgChars } from "../src/lib/trpg/campaignLedger";
import type { TrpgReplySuggestion } from "../src/lib/trpg/replySuggestionShared";

loadEnvLocal();
process.env.MOCK_MODE = "0";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const QWEN3_8B_MODEL = "qwen/qwen3-8b";
const MODELS = [
  { key: "gemini", label: "Gemini 2.5 Flash-Lite", modelId: OPENROUTER_GEMINI_25_FLASH_LITE_MODEL },
  { key: "qwen", label: "Qwen3 8B", modelId: QWEN3_8B_MODEL },
] as const;

const RUNS_PER_MODEL = 5;
const CLIENT_TIMEOUT_MS = 60_000;
const INTERLEAVE: Array<(typeof MODELS)[number]["key"]> = [
  "gemini",
  "qwen",
  "gemini",
  "qwen",
  "gemini",
  "qwen",
  "gemini",
  "qwen",
  "gemini",
  "qwen",
];

const QUALITY_SAMPLES_INTERLEAVE: Array<(typeof MODELS)[number]["key"]> = [
  "gemini",
  "qwen",
  "gemini",
  "qwen",
];

const CI_MODELS = [
  {
    key: "deepseek" as const,
    label: "DeepSeek V4 Flash",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    runPrefix: "D",
  },
  {
    key: "luna" as const,
    label: "GPT-5.6 Luna",
    modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    runPrefix: "L",
  },
];

const DEEPSEEK_LUNA_ORDER: Array<(typeof CI_MODELS)[number]["key"]> = [];
for (let i = 1; i <= 10; i += 1) {
  DEEPSEEK_LUNA_ORDER.push("deepseek", "luna");
}

type PersonaSlice = {
  personaId: number | null;
  name: string;
  description: string;
  speechExamples: string;
  source: "production_db" | "participant_db" | "fixture";
};

type PromptBundle = {
  system: string;
  user: string;
  promptChars: number;
  persona: PersonaSlice;
  contextSource: "production_db" | "fixture";
  campaignId: number | null;
  roundId: number | null;
  roundNumber: number | null;
  participantId: number | null;
  durableRowExists: boolean | null;
  sceneKeyword: string;
};

type RunMetric = {
  model: string;
  modelKey: string;
  run: string;
  httpStatus: number | null;
  ttftOrHeadersMs: number | null;
  totalLatencyMs: number | null;
  success: boolean;
  validJson: boolean;
  validSchema: boolean;
  exactly3: boolean;
  stanceGood: boolean;
  stanceNeutral: boolean;
  stanceEvil: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  usageCostUsd: number | null;
  promptChars: number;
  failureClass: string | null;
  quality: {
    koreanNatural: 0 | 1;
    personaVoiceOk: 0 | 1;
    sceneRelevant: 0 | 1;
    actionExecutable: 0 | 1;
    stanceDistinct: 0 | 1;
    noMetaText: 0 | 1;
    qualityScore: number;
  };
  reasoningMode: string;
};

type CallResult = {
  metric: RunMetric;
  suggestions: TrpgReplySuggestion[] | null;
};

type CiHumanReviewRun = {
  sampleId: string;
  modelLabel: string;
  modelId: string;
  modelKey: "deepseek" | "luna";
  runLabel: string;
  httpStatus: number | null;
  totalLatencyMs: number | null;
  success: boolean;
  validJson: boolean;
  validSchema: boolean;
  exactly3: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  usageCostUsd: number | null;
  failureClass: string | null;
  suggestions: TrpgReplySuggestion[] | null;
  textSaved: boolean;
};

type QualitySampleRun = {
  sampleId: string;
  modelKey: "gemini" | "qwen";
  modelId: string;
  runLabel: string;
  httpStatus: number | null;
  totalLatencyMs: number | null;
  success: boolean;
  validSchema: boolean;
  failureClass: string | null;
  suggestions: TrpgReplySuggestion[] | null;
};

const PERSONA_PUBLIC_SELECT =
  "SELECT id, user_id, name, memo, gender, description, speech_examples, image_url, image_focus_x, image_focus_y, created_at FROM user_personas";

function parseArgs(): {
  dbPath: string | null;
  campaignId: number | null;
  qualitySamples: boolean;
  deepseekVsLuna: boolean;
} {
  let dbPath: string | null = null;
  let campaignId: number | null = null;
  let qualitySamples = false;
  let deepseekVsLuna = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--db=")) dbPath = arg.slice(5);
    if (arg.startsWith("--campaign-id=")) campaignId = Number(arg.slice(14)) || null;
    if (arg === "--quality-samples") qualitySamples = true;
    if (arg === "--deepseek-vs-luna") deepseekVsLuna = true;
  }
  return { dbPath, campaignId, qualitySamples, deepseekVsLuna };
}

function resolveReadonlyDbPath(explicit: string | null): string | null {
  const candidates = [
    explicit,
    process.env.BENCH_DB_PATH?.trim(),
    fs.existsSync(getDatabasePath()) ? getDatabasePath() : null,
    fs.existsSync("/data/app.db") ? "/data/app.db" : null,
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

function findAdminUser(db: Database.Database): { id: number; email: string } | null {
  const rows = db
    .prepare(`SELECT id, email, is_admin FROM users ORDER BY id`)
    .all() as Array<{ id: number; email: string; is_admin: number }>;
  for (const row of rows) {
    if (isAdminUser(row)) return { id: row.id, email: row.email };
  }
  return null;
}

function loadAdminPersonaFromDb(db: Database.Database, userId: number): PersonaSlice | null {
  const row = db
    .prepare(`${PERSONA_PUBLIC_SELECT} WHERE user_id=? ORDER BY id LIMIT 1`)
    .get(userId) as
    | {
        id: number;
        name: string;
        description: string;
        speech_examples: string;
      }
    | undefined;
  if (!row?.name?.trim()) return null;
  return {
    personaId: row.id,
    name: row.name.trim(),
    description: row.description ?? "",
    speechExamples: row.speech_examples ?? "",
    source: "production_db",
  };
}

function loadProductionPrompt(db: Database.Database, campaignId: number, userId: number): PromptBundle | null {
  const round = db
    .prepare(
      `SELECT id, round_number, phase FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`
    )
    .get(campaignId) as { id: number; round_number: number; phase: string } | undefined;
  if (!round) return null;
  const me = db
    .prepare(
      `SELECT id, persona_json FROM trpg_participants WHERE campaign_id=? AND user_id=? AND kind='human' LIMIT 1`
    )
    .get(campaignId, userId) as { id: number; persona_json: string } | undefined;
  if (!me) return null;

  const sceneRow = db
    .prepare(
      `SELECT g.narration
       FROM trpg_gm_messages g
       JOIN trpg_rounds r ON r.id = g.round_id
       WHERE r.campaign_id=?
       ORDER BY r.round_number DESC
       LIMIT 1`
    )
    .get(campaignId) as { narration: string } | undefined;

  const admin = findAdminUser(db);
  const personaRow = admin ? loadAdminPersonaFromDb(db, admin.id) : null;
  const participantPersona = parseHumanPersona(me.persona_json);
  const persona: PersonaSlice = personaRow ?? {
    personaId: participantPersona?.personaId ?? null,
    name: participantPersona?.name?.trim() || "플레이어",
    description: participantPersona?.description ?? "",
    speechExamples: participantPersona?.speechExamples ?? "",
    source: personaRow ? "production_db" : "participant_db",
  };

  const sheets = loadSheetSnapshots(db, campaignId);
  const self = sheets.find((s) => s.participantId === me.id) ?? null;
  const prompt = buildReplySuggestionPublicContext({
    scene: sceneRow?.narration ?? "",
    persona,
    recentActions: loadRecentManualHumanActions(db, { campaignId, participantId: me.id }),
    self: self
      ? {
          name: self.name,
          hp: self.hp,
          maxHp: self.maxHp,
          conditions: self.conditions,
          inventory: self.inventory,
          stats: self.stats,
          location: self.location,
        }
      : null,
    party: sheets
      .filter((s) => s.participantId !== me.id)
      .map((s) => ({ name: s.name, hp: s.hp, maxHp: s.maxHp, conditions: s.conditions })),
  });

  const durable = db
    .prepare(
      `SELECT 1 FROM trpg_reply_suggestions WHERE round_id=? AND participant_id=? LIMIT 1`
    )
    .get(round.id, me.id) as { 1: number } | undefined;

  const sceneKeyword =
    (sceneRow?.narration ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24) || "폐역";

  return {
    system: prompt.system,
    user: prompt.user,
    promptChars: prompt.system.length + prompt.user.length,
    persona,
    contextSource: "production_db",
    campaignId,
    roundId: round.id,
    roundNumber: round.round_number,
    participantId: me.id,
    durableRowExists: Boolean(durable),
    sceneKeyword,
  };
}

function padScene(base: string, targetUserChars: number): string {
  const seed = base.trim() || "폐역.platform tracks rust under broken neon.";
  let scene = seed;
  const filler =
    " 바람이 철골 사이를 스치고, 멀리서 열차 바퀴가 금속을 긁는 소리가 간헐적으로 울린다.";
  while (Array.from(scene).length < TRPG_REPLY_SCENE_MAX_CHARS && Array.from(scene).length < 1500) {
    scene += filler;
  }
  return clipTrpgChars(scene, TRPG_REPLY_SCENE_MAX_CHARS);
}

async function buildFixturePrompt(targetChars = 5770): Promise<PromptBundle> {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  const hostPersona = {
    personaId: 901,
    name: "BenchAdmin",
    description:
      "TRPG 벤치용 관리자 페르소나. 짧고 단호하게 말하고, 군더더기 없이 행동을 지시한다. 감정을 드러내기보다 상황 판단을 우선한다.",
    gender: "other" as const,
    speechExamples: "됐어. 내가 앞장 설게.\n지금은 섣불리 움직이지 마.\n먼저 주변부터 확인해.",
  };
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: hostPersona.name,
    viewerUserId: 1,
    hostPersona,
  });
  const statusAfterCreate = (
    db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }
  ).status;
  if (statusAfterCreate === "CHARACTER_SETUP" || statusAfterCreate === "WAITING_FOR_PLAYERS") {
    saveTrpgSheet(db, { campaignId, userId: 1, name: hostPersona.name, stats: EVEN_STATS });
  }
  await startTrpgCampaign(db, {
    campaignId,
    userId: 1,
    deps: {
      skipBilling: true,
      gmCall: async () => ({
        text: `<<<NARRATION>>>\n${padScene("폐역. 습기 찬 공기와 녹슨 레일.", 1400)}\n<<<DELTA>>>\n{"players":[],"location":"폐역","next_round_context":"침입자 확인","campaign_finished":false}`,
      }),
    },
  });
  const hostPersonaSlice = {
    personaId: hostPersona.personaId,
    name: hostPersona.name,
    description: hostPersona.description,
    speechExamples: hostPersona.speechExamples,
    source: "fixture" as const,
  };
  const built = buildReplySuggestionPublicContext({
    scene: padScene("폐역. 습기 찬 공기와 녹슨 레일.", 1600),
    persona: hostPersona,
    recentActions: [
      "복도 끝 문고리를 듣기 위해 귀를 대고 숨을 죽인다.",
      "바닥 먼지 층의 발자국 방향을 손가락으로 짚어 표시한다.",
      "무전기 볼륨을 낮추고 채널 번호를 다시 확인한다.",
      "천장 균열에서 떨어지는 먼지를 피해 벽면으로 몸을 기댄다.",
      "퇴로 후보를 세 군데로 나눠 손짓으로 알린다.",
    ],
    self: {
      name: hostPersona.name,
      hp: 18,
      maxHp: 20,
      conditions: ["긴장"],
      inventory: ["손전등", "삼각대", "무전기", "해머", "밧줄"],
      stats: EVEN_STATS,
      location: "폐역 대합실",
    },
    party: [
      { name: "동료A", hp: 14, maxHp: 20, conditions: ["경상"] },
      { name: "동료B", hp: 20, maxHp: 20, conditions: [] },
      { name: "동료C", hp: 11, maxHp: 18, conditions: ["피로"] },
    ],
  });
  const round = db
    .prepare(`SELECT id, round_number FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`)
    .get(campaignId) as { id: number; round_number: number };
  const participant = db
    .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1 LIMIT 1`)
    .get(campaignId) as { id: number };
  const bundle: PromptBundle = {
    system: built.system,
    user: built.user,
    promptChars: built.system.length + built.user.length,
    persona: hostPersonaSlice,
    contextSource: "fixture",
    campaignId,
    roundId: round.id,
    roundNumber: round.round_number,
    participantId: participant.id,
    durableRowExists: false,
    sceneKeyword: "폐역",
  };
  db.close();
  return bundle;
}

function describeReasoningMode(modelId: string): string {
  if (isQwenOpenRouterModel(modelId)) {
    return "openrouter_rp_reasoning_off:{effort:none,exclude:true}";
  }
  if (isGeminiFlashOpenRouterModel(modelId)) {
    return "openrouter_rp_reasoning_gemini_flash_minimal";
  }
  if (modelId.includes("gemini-2.5-flash-lite")) {
    return "no_explicit_reasoning_param (2.5-flash-lite outside gemini-flash policy set; model default non-thinking)";
  }
  return "unspecified";
}

function buildBenchRequestBody(modelId: string, system: string, user: string): Record<string, unknown> {
  const body = buildOpenRouterRequestBody(
    modelId,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    false,
    null,
    null,
    TRPG_REPLY_SUGGESTION_MAX_TOKENS,
    { temperature: 0.7 }
  );
  body.response_format = { type: "json_object" };
  return body;
}

function describeCiReasoningMode(modelId: string): string {
  if (isCheaperInferenceDeepSeekV4FlashModel(modelId)) {
    return "adaptTrpgReplySuggestionChatBody: thinking.type=disabled, reasoning_effort=none";
  }
  if (isGpt56LunaModel(modelId)) {
    return "adaptCheaperInferenceChatBody: reasoning.effort=none, reasoning_effort=none";
  }
  return "unspecified";
}

function buildCiBenchRequestBody(modelId: string, system: string, user: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stream: false,
    temperature: 0.7,
    max_tokens: TRPG_REPLY_SUGGESTION_MAX_TOKENS,
    response_format: { type: "json_object" },
  };
  if (isCheaperInferenceDeepSeekV4FlashModel(modelId)) {
    return adaptTrpgReplySuggestionChatBody(base);
  }
  if (isGpt56LunaModel(modelId)) {
    return adaptCheaperInferenceChatBody(base);
  }
  throw new Error(`unsupported CI bench model: ${modelId}`);
}

function extractCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0]) return "";
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part ? String((part as { text?: string }).text ?? "") : ""
      )
      .join("");
  }
  return "";
}

function scoreQuality(opts: {
  suggestions: TrpgReplySuggestion[] | null;
  raw: string;
  sceneKeyword: string;
  personaName: string;
}): RunMetric["quality"] {
  const suggestionTexts = opts.suggestions?.map((s) => s.text).join("\n") ?? "";
  const metaBad = /다음과 같|assistant|OpenRouter|모델/i.test(suggestionTexts);
  const koreanNatural =
    suggestionTexts.length > 0 && /[가-힣]/.test(suggestionTexts) && !/\b(the|and|please generate)\b/i.test(suggestionTexts)
      ? 1
      : opts.raw.length > 0 && /[가-힣]/.test(opts.raw)
        ? 1
        : 0;
  const noMetaText = metaBad ? 0 : 1;
  if (!opts.suggestions?.length) {
    return {
      koreanNatural: koreanNatural as 0 | 1,
      personaVoiceOk: 0,
      sceneRelevant: 0,
      actionExecutable: 0,
      stanceDistinct: 0,
      noMetaText: noMetaText as 0 | 1,
      qualityScore: koreanNatural + (noMetaText as number),
    };
  }
  const texts = opts.suggestions.map((s) => s.text);
  const executable = opts.suggestions.every((s) => s.text.trim().length >= 12 && s.actionType) ? 1 : 0;
  const distinct =
    new Set(texts.map((t) => t.trim())).size === 3 &&
    texts.every((t, i) => texts.every((u, j) => i === j || t.slice(0, 12) !== u.slice(0, 12)))
      ? 1
      : 0;
  const sceneRelevant = texts.some((t) => t.includes(opts.sceneKeyword.slice(0, 2))) ? 1 : 1;
  const personaVoiceOk = texts.some((t) => t.length >= 8) ? 1 : 0;
  const parts = [koreanNatural, personaVoiceOk, sceneRelevant, executable, distinct, noMetaText] as const;
  return {
    koreanNatural,
    personaVoiceOk,
    sceneRelevant,
    actionExecutable: executable,
    stanceDistinct: distinct,
    noMetaText: noMetaText as 0 | 1,
    qualityScore: parts.reduce((a, b) => a + b, 0),
  };
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

type BenchModelRef = { modelId: string; key: string };

async function runSingleCall(opts: {
  model: (typeof MODELS)[number];
  runLabel: string;
  prompt: PromptBundle;
}): Promise<CallResult> {
  const reasoningMode = describeReasoningMode(opts.model.modelId);
  const body = buildBenchRequestBody(opts.model.modelId, opts.prompt.system, opts.prompt.user);
  const started = Date.now();
  let ttftMs: number | null = null;
  let httpStatus: number | null = null;
  let raw = "";
  let failureClass: string | null = null;
  let usage = parseOpenRouterUsage(null);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(resolveOpenRouterApiKey()),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    ttftMs = Date.now() - started;
    httpStatus = res.status;
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      failureClass = `http_${res.status}`;
      return finalizeRun(opts, {
        httpStatus,
        ttftMs,
        totalLatencyMs: Date.now() - started,
        raw: "",
        failureClass,
        usage,
        reasoningMode,
      });
    }
    usage = parseOpenRouterUsage(payload?.usage, res.headers);
    raw = extractCompletionText(payload);
    if (!raw.trim()) failureClass = "empty_completion";
  } catch (e) {
    failureClass =
      e instanceof Error && e.name === "AbortError" ? "client_timeout" : e instanceof Error ? e.name : "fetch_error";
    return finalizeRun(opts, {
      httpStatus,
      ttftMs,
      totalLatencyMs: Date.now() - started,
      raw: "",
      failureClass,
      usage,
      reasoningMode,
    });
  }
  return finalizeRun(opts, {
    httpStatus,
    ttftMs,
    totalLatencyMs: Date.now() - started,
    raw,
    failureClass,
    usage,
    reasoningMode,
  });
}

async function runCiSingleCall(opts: {
  model: (typeof CI_MODELS)[number];
  runLabel: string;
  prompt: PromptBundle;
}): Promise<CallResult> {
  const reasoningMode = describeCiReasoningMode(opts.model.modelId);
  const body = buildCiBenchRequestBody(opts.model.modelId, opts.prompt.system, opts.prompt.user);
  const started = Date.now();
  let ttftMs: number | null = null;
  let httpStatus: number | null = null;
  let raw = "";
  let failureClass: string | null = null;
  let usage = parseOpenRouterUsage(null);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    ttftMs = Date.now() - started;
    httpStatus = res.status;
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      failureClass = `http_${res.status}`;
      return finalizeRun(
        { model: opts.model, runLabel: opts.runLabel, prompt: opts.prompt },
        {
          httpStatus,
          ttftMs,
          totalLatencyMs: Date.now() - started,
          raw: "",
          failureClass,
          usage,
          reasoningMode,
        }
      );
    }
    usage = parseOpenRouterUsage(payload?.usage, res.headers);
    raw = extractCompletionText(payload);
    if (!raw.trim()) failureClass = "empty_completion";
  } catch (e) {
    failureClass =
      e instanceof Error && e.name === "AbortError" ? "client_timeout" : e instanceof Error ? e.name : "fetch_error";
    return finalizeRun(
      { model: opts.model, runLabel: opts.runLabel, prompt: opts.prompt },
      {
        httpStatus,
        ttftMs,
        totalLatencyMs: Date.now() - started,
        raw: "",
        failureClass,
        usage,
        reasoningMode,
      }
    );
  }
  return finalizeRun(
    { model: opts.model, runLabel: opts.runLabel, prompt: opts.prompt },
    {
      httpStatus,
      ttftMs,
      totalLatencyMs: Date.now() - started,
      raw,
      failureClass,
      usage,
      reasoningMode,
    }
  );
}

function finalizeRun(
  opts: { model: BenchModelRef; runLabel: string; prompt: PromptBundle },
  result: {
    httpStatus: number | null;
    ttftMs: number | null;
    totalLatencyMs: number;
    raw: string;
    failureClass: string | null;
    usage: ReturnType<typeof parseOpenRouterUsage>;
    reasoningMode: string;
  }
): CallResult {
  let validJson = false;
  let validSchema = false;
  let exactly3 = false;
  let stanceGood = false;
  let stanceNeutral = false;
  let stanceEvil = false;
  let suggestions: TrpgReplySuggestion[] | null = null;
  if (result.raw.trim()) {
    try {
      JSON.parse(result.raw.startsWith("{") ? result.raw : result.raw.slice(result.raw.indexOf("{")));
      validJson = true;
    } catch {
      validJson = false;
    }
    const validated = validateReplySuggestionCompletion(result.raw);
    if (validated.ok) {
      validSchema = true;
      exactly3 = validated.suggestions.length === 3;
      suggestions = validated.suggestions;
      stanceGood = validated.suggestions.some((s) => s.stance === "good");
      stanceNeutral = validated.suggestions.some((s) => s.stance === "neutral");
      stanceEvil = validated.suggestions.some((s) => s.stance === "evil");
    } else {
      try {
        suggestions = parseReplySuggestions(result.raw);
        exactly3 = suggestions.length === 3;
      } catch {
        suggestions = null;
      }
    }
  }
  const success = validSchema && exactly3;
  const quality = scoreQuality({
    suggestions,
    raw: result.raw,
    sceneKeyword: opts.prompt.sceneKeyword,
    personaName: opts.prompt.persona.name,
  });
  return {
    metric: {
      model: opts.model.modelId,
      modelKey: opts.model.key,
      run: opts.runLabel,
      httpStatus: result.httpStatus,
      ttftOrHeadersMs: result.ttftMs,
      totalLatencyMs: result.totalLatencyMs,
      success,
      validJson,
      validSchema,
      exactly3,
      stanceGood,
      stanceNeutral,
      stanceEvil,
      inputTokens: result.usage.promptTokens || null,
      outputTokens: result.usage.completionTokens || null,
      reasoningTokens: result.usage.reasoningTokens || null,
      usageCostUsd: result.usage.upstreamCostUsd ?? null,
      promptChars: opts.prompt.promptChars,
      failureClass: success ? null : result.failureClass ?? "invalid_schema",
      quality,
      reasoningMode: result.reasoningMode,
    },
    suggestions,
  };
}

function summarizeModel(runs: RunMetric[]) {
  const latencies = runs.map((r) => r.totalLatencyMs ?? 0).filter((n) => n > 0);
  const costs = runs.map((r) => r.usageCostUsd).filter((v): v is number => v != null);
  return {
    calls: runs.length,
    success: runs.filter((r) => r.success).length,
    validJson: runs.filter((r) => r.validJson).length,
    validSchema: runs.filter((r) => r.validSchema).length,
    medianLatencyMs: latencies.length ? Math.round(median(latencies)) : null,
    meanLatencyMs: latencies.length ? Math.round(mean(latencies)) : null,
    minLatencyMs: latencies.length ? Math.min(...latencies) : null,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    le3s: latencies.filter((n) => n <= 3000).length,
    le5s: latencies.filter((n) => n <= 5000).length,
    le8s: latencies.filter((n) => n <= 8000).length,
    gt10s: latencies.filter((n) => n > 10000).length,
    timeouts: runs.filter((r) => r.failureClass === "client_timeout").length,
    avgInputTokens: runs.filter((r) => r.inputTokens != null).length
      ? Math.round(mean(runs.map((r) => r.inputTokens ?? 0)))
      : null,
    avgOutputTokens: runs.filter((r) => r.outputTokens != null).length
      ? Math.round(mean(runs.map((r) => r.outputTokens ?? 0)))
      : null,
    avgReasoningTokens: runs.filter((r) => r.reasoningTokens != null).length
      ? Math.round(mean(runs.map((r) => r.reasoningTokens ?? 0)))
      : null,
    avgQuality: runs.length ? Number(mean(runs.map((r) => r.quality.qualityScore)).toFixed(2)) : null,
    avgActualCostUsd: costs.length ? Number(mean(costs).toFixed(6)) : null,
    total5CallCostUsd: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null,
  };
}

function findSuggestionByStance(
  suggestions: TrpgReplySuggestion[] | null,
  stance: TrpgReplySuggestion["stance"]
): TrpgReplySuggestion | null {
  return suggestions?.find((s) => s.stance === stance) ?? null;
}

function formatStanceBlock(stance: "GOOD" | "NEUTRAL" | "EVIL", item: TrpgReplySuggestion | null): string {
  if (!item) {
    return `### ${stance}\n- (missing — schema parse failed)\n`;
  }
  return [
    `### ${stance}`,
    `- actionType: ${item.actionType}`,
    `- stage: ${item.stage}`,
    `- speech: ${item.speech}`,
    `- composed text: ${item.text}`,
    "",
  ].join("\n");
}

function formatQualitySampleSection(run: QualitySampleRun): string {
  const good = findSuggestionByStance(run.suggestions, "good");
  const neutral = findSuggestionByStance(run.suggestions, "neutral");
  const evil = findSuggestionByStance(run.suggestions, "evil");
  return [
    `## ${run.sampleId}`,
    "",
    `- model: \`${run.modelId}\``,
    `- run: ${run.runLabel}`,
    `- httpStatus: ${run.httpStatus ?? "n/a"}`,
    `- totalLatencyMs: ${run.totalLatencyMs ?? "n/a"}`,
    `- success: ${run.success}`,
    `- validSchema: ${run.validSchema}`,
    `- failureClass: ${run.failureClass ?? "none"}`,
    "",
    formatStanceBlock("GOOD", good),
    formatStanceBlock("NEUTRAL", neutral),
    formatStanceBlock("EVIL", evil),
  ].join("\n");
}

function writeQualitySamplesArtifact(opts: {
  prompt: PromptBundle;
  runs: QualitySampleRun[];
  outPath: string;
}): void {
  const lines = [
    "# TRPG reply-suggestion quality samples (human review)",
    "",
    "Synthetic BenchAdmin fixture. Parsed via canonical `validateReplySuggestionCompletion()`.",
    "For ChatGPT human review — not latency benchmark, not automatic quality scores.",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- adminPersonaName: ${opts.prompt.persona.name}`,
    `- promptChars: ${opts.prompt.promptChars}`,
    `- totalProviderCalls: ${opts.runs.length}`,
    `- interleave: GQGQ (retry 0)`,
    "",
    "---",
    "",
    ...opts.runs.map((run) => formatQualitySampleSection(run)),
  ];
  fs.writeFileSync(opts.outPath, lines.join("\n"));
}

function suggestionsTextSaved(suggestions: TrpgReplySuggestion[] | null): boolean {
  return Boolean(
    suggestions?.length === 3 && suggestions.every((s) => s.stance && s.actionType && s.text.trim())
  );
}

function summarizeCiBenchModel(runs: CiHumanReviewRun[]) {
  const latencies = runs.map((r) => r.totalLatencyMs ?? 0).filter((n) => n > 0);
  const costs = runs.map((r) => r.usageCostUsd).filter((v): v is number => v != null);
  return {
    calls: runs.length,
    successCount: runs.filter((r) => r.success).length,
    validSchemaCount: runs.filter((r) => r.validSchema).length,
    timeoutCount: runs.filter((r) => r.failureClass === "client_timeout").length,
    minLatencyMs: latencies.length ? Math.min(...latencies) : null,
    medianLatencyMs: latencies.length ? Math.round(median(latencies)) : null,
    meanLatencyMs: latencies.length ? Math.round(mean(latencies)) : null,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    le3s: latencies.filter((n) => n <= 3000).length,
    le5s: latencies.filter((n) => n <= 5000).length,
    le8s: latencies.filter((n) => n <= 8000).length,
    gt10s: latencies.filter((n) => n > 10000).length,
    avgInputTokens: runs.filter((r) => r.inputTokens != null).length
      ? Math.round(mean(runs.map((r) => r.inputTokens ?? 0)))
      : null,
    avgOutputTokens: runs.filter((r) => r.outputTokens != null).length
      ? Math.round(mean(runs.map((r) => r.outputTokens ?? 0)))
      : null,
    avgReasoningTokens: runs.some((r) => r.reasoningTokens != null)
      ? Math.round(mean(runs.map((r) => r.reasoningTokens ?? 0)))
      : null,
    avgActualCostUsd: costs.length ? Number(mean(costs).toFixed(6)) : null,
    total10CallCostUsd: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null,
  };
}

function formatCiHumanReviewSection(run: CiHumanReviewRun): string {
  const good = findSuggestionByStance(run.suggestions, "good");
  const neutral = findSuggestionByStance(run.suggestions, "neutral");
  const evil = findSuggestionByStance(run.suggestions, "evil");
  const stanceBlock = (label: "GOOD" | "NEUTRAL" | "EVIL", item: TrpgReplySuggestion | null) => {
    if (!item) return `## ${label}\n- (missing — parse failed)\n`;
    return [
      `## ${label}`,
      `- stance: ${item.stance}`,
      `- actionType: ${item.actionType}`,
      `- stage: ${item.stage}`,
      `- speech: ${item.speech}`,
      `- composed text: ${item.text}`,
      "",
    ].join("\n");
  };
  return [
    `# ${run.modelLabel} — ${run.runLabel}`,
    "",
    `- provider: CheaperInference`,
    `- model: \`${run.modelId}\``,
    `- httpStatus: ${run.httpStatus ?? "n/a"}`,
    `- totalLatencyMs: ${run.totalLatencyMs ?? "n/a"}`,
    `- success: ${run.success}`,
    `- validJson: ${run.validJson}`,
    `- validSchema: ${run.validSchema}`,
    `- exactly3: ${run.exactly3}`,
    `- failureClass: ${run.failureClass ?? "none"}`,
    `- textSaved: ${run.textSaved}`,
    "",
    stanceBlock("GOOD", good),
    stanceBlock("NEUTRAL", neutral),
    stanceBlock("EVIL", evil),
    "---",
    "",
  ].join("\n");
}

function writeDeepSeekVsLunaArtifacts(opts: {
  prompt: PromptBundle;
  runs: CiHumanReviewRun[];
  mdPath: string;
  jsonPath: string;
}): void {
  const deepseekRuns = opts.runs.filter((r) => r.modelKey === "deepseek");
  const lunaRuns = opts.runs.filter((r) => r.modelKey === "luna");
  const mdLines = [
    "# TRPG reply-suggestion human review — DeepSeek V4 Flash vs GPT-5.6 Luna",
    "",
    "CheaperInference only. Same BenchAdmin fixture prompt as #652 OpenRouter benchmark.",
    "Parsed via canonical `validateReplySuggestionCompletion()` / `parseReplySuggestions()`.",
    "Model names shown for ChatGPT human review. No automatic quality scores.",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- personaSource: ${opts.prompt.persona.source}`,
    `- adminPersonaName: ${opts.prompt.persona.name}`,
    `- promptChars: ${opts.prompt.promptChars}`,
    `- totalProviderCalls: ${opts.runs.length}`,
    `- interleave: D1 L1 D2 L2 … D10 L10 (retry 0)`,
    `- deepseekModel: \`${CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL}\``,
    `- lunaModel: \`${CHEAPER_INFERENCE_GPT_56_LUNA_MODEL}\``,
    `- deepseekReasoningMode: ${describeCiReasoningMode(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL)}`,
    `- lunaReasoningMode: ${describeCiReasoningMode(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL)}`,
    "",
    "---",
    "",
    ...opts.runs.map((run) => formatCiHumanReviewSection(run)),
  ];
  fs.writeFileSync(opts.mdPath, mdLines.join("\n"));

  const summary = {
    generatedAt: new Date().toISOString(),
    promptChars: opts.prompt.promptChars,
    personaSource: opts.prompt.persona.source,
    adminPersonaName: opts.prompt.persona.name,
    deepseekModel: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    lunaModel: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    totalProviderCalls: opts.runs.length,
    deepseekReasoningMode: describeCiReasoningMode(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    lunaReasoningMode: describeCiReasoningMode(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
    deepseek: summarizeCiBenchModel(deepseekRuns),
    luna: summarizeCiBenchModel(lunaRuns),
    runs: opts.runs.map((r) => ({
      model: r.modelId,
      modelLabel: r.modelLabel,
      run: r.runLabel,
      httpStatus: r.httpStatus,
      totalLatencyMs: r.totalLatencyMs,
      success: r.success,
      validJson: r.validJson,
      validSchema: r.validSchema,
      exactly3: r.exactly3,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      reasoningTokens: r.reasoningTokens,
      actualUsageCostUsd: r.usageCostUsd,
      failureClass: r.failureClass,
      textSaved: r.textSaved,
    })),
  };
  fs.writeFileSync(opts.jsonPath, JSON.stringify(summary, null, 2));
}

async function runDeepSeekVsLuna(): Promise<void> {
  console.log("[bench] deepseek-vs-luna mode (20 provider calls, D1 L1 … D10 L10)");
  const prompt = await buildFixturePrompt(5770);
  const runCounters: Record<string, number> = { deepseek: 0, luna: 0 };
  const allRuns: CiHumanReviewRun[] = [];

  for (const key of DEEPSEEK_LUNA_ORDER) {
    const model = CI_MODELS.find((m) => m.key === key)!;
    runCounters[key] += 1;
    const runLabel = `${model.runPrefix}${runCounters[key]}`;
    const { metric, suggestions } = await runCiSingleCall({ model, runLabel, prompt });
    const textSaved = suggestionsTextSaved(suggestions);
    allRuns.push({
      sampleId: runLabel,
      modelLabel: model.label,
      modelId: model.modelId,
      modelKey: key,
      runLabel,
      httpStatus: metric.httpStatus,
      totalLatencyMs: metric.totalLatencyMs,
      success: metric.success,
      validJson: metric.validJson,
      validSchema: metric.validSchema,
      exactly3: metric.exactly3,
      inputTokens: metric.inputTokens,
      outputTokens: metric.outputTokens,
      reasoningTokens: metric.reasoningTokens,
      usageCostUsd: metric.usageCostUsd,
      failureClass: metric.failureClass,
      suggestions,
      textSaved,
    });
    process.stdout.write(
      `${runLabel} ${model.label} success=${metric.success} textSaved=${textSaved} latency=${metric.totalLatencyMs}ms\n`
    );
  }

  const outDir = path.join(process.cwd(), "docs/audits/trpg-reply-suggestion-model-bench");
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, "DEEPSEEK-VS-LUNA-HUMAN-REVIEW-2026-08-26.md");
  const jsonPath = path.join(outDir, "deepseek-vs-luna-2026-08-26.json");
  writeDeepSeekVsLunaArtifacts({ prompt, runs: allRuns, mdPath, jsonPath });
  console.log(
    JSON.stringify({
      ok: true,
      mode: "deepseek-vs-luna",
      mdPath,
      jsonPath,
      calls: allRuns.length,
      textSavedCount: allRuns.filter((r) => r.textSaved).length,
    })
  );
}

async function runQualitySamples(): Promise<void> {
  console.log("[bench] quality-samples mode (4 provider calls, GQGQ)");
  const prompt = await buildFixturePrompt(5770);
  const runCounters: Record<string, number> = { gemini: 0, qwen: 0 };
  const sampleRuns: QualitySampleRun[] = [];

  for (const key of QUALITY_SAMPLES_INTERLEAVE) {
    const model = MODELS.find((m) => m.key === key)!;
    runCounters[key] += 1;
    const runLabel = `${key === "gemini" ? "G" : "Q"}${runCounters[key]}`;
    const sampleId =
      key === "gemini" ? `GEMINI_SAMPLE_${runCounters[key]}` : `QWEN_SAMPLE_${runCounters[key]}`;
    const { metric, suggestions } = await runSingleCall({ model, runLabel, prompt });
    sampleRuns.push({
      sampleId,
      modelKey: key,
      modelId: model.modelId,
      runLabel,
      httpStatus: metric.httpStatus,
      totalLatencyMs: metric.totalLatencyMs,
      success: metric.success,
      validSchema: metric.validSchema,
      failureClass: metric.failureClass,
      suggestions,
    });
    process.stdout.write(
      `${sampleId} ${model.modelId} success=${metric.success} latency=${metric.totalLatencyMs}ms\n`
    );
  }

  const outDir = path.join(process.cwd(), "docs/audits/trpg-reply-suggestion-model-bench");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "QUALITY-SAMPLES-2026-08-26.md");
  writeQualitySamplesArtifact({ prompt, runs: sampleRuns, outPath });
  console.log(JSON.stringify({ ok: true, mode: "quality-samples", outPath, calls: sampleRuns.length }));
}

async function runBenchmark(): Promise<void> {
  console.log("[bench] starting trpg reply-suggestion model benchmark");
  const args = parseArgs();
  const dbPath = resolveReadonlyDbPath(args.dbPath);
  let prompt: PromptBundle;
  if (dbPath) {
    const db = new Database(dbPath, { readonly: true });
    ensureTrpgTables(db);
    const admin = findAdminUser(db);
    if (!admin) throw new Error("admin user not found in readonly db");
    const campaignId = args.campaignId ?? 30;
    const loaded = loadProductionPrompt(db, campaignId, admin.id);
    db.close();
    if (!loaded) throw new Error(`campaign ${campaignId} context unavailable in db`);
    prompt = loaded;
  } else {
    prompt = await buildFixturePrompt(5770);
  }

  const runCounters: Record<string, number> = { gemini: 0, qwen: 0 };
  const allRuns: RunMetric[] = [];
  for (const key of INTERLEAVE) {
    const model = MODELS.find((m) => m.key === key)!;
    runCounters[key] += 1;
    const runLabel = `${key === "gemini" ? "G" : "Q"}${runCounters[key]}`;
    const { metric } = await runSingleCall({ model, runLabel, prompt });
    allRuns.push(metric);
    process.stdout.write(
      `${runLabel} ${model.modelId} success=${metric.success} latency=${metric.totalLatencyMs}ms\n`
    );
  }

  const geminiRuns = allRuns.filter((r) => r.modelKey === "gemini");
  const qwenRuns = allRuns.filter((r) => r.modelKey === "qwen");
  const summary = {
    generatedAt: new Date().toISOString(),
    adminPersonaFound: prompt.persona.source !== "fixture",
    adminPersonaId: prompt.persona.personaId,
    adminPersonaName: prompt.persona.name,
    adminPersonaSource: prompt.persona.source,
    contextSource: prompt.contextSource,
    campaignId: prompt.campaignId,
    roundId: prompt.roundId,
    roundNumber: prompt.roundNumber,
    participantId: prompt.participantId,
    durableRowExists: prompt.durableRowExists,
    promptChars: prompt.promptChars,
    totalProviderCalls: allRuns.length,
    geminiReasoningMode: describeReasoningMode(OPENROUTER_GEMINI_25_FLASH_LITE_MODEL),
    qwenReasoningMode: describeReasoningMode(QWEN3_8B_MODEL),
    gemini: summarizeModel(geminiRuns),
    qwen: summarizeModel(qwenRuns),
    runs: allRuns.map((r) => ({
      ...r,
      quality: r.quality,
    })),
  };

  const outDir = path.join(process.cwd(), "docs/audits/trpg-reply-suggestion-model-bench");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `bench-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, summary: {
    promptChars: summary.promptChars,
    adminPersonaName: summary.adminPersonaName,
    gemini: summary.gemini,
    qwen: summary.qwen,
  } }));
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.deepseekVsLuna) {
    await runDeepSeekVsLuna();
    return;
  }
  if (args.qualitySamples) {
    await runQualitySamples();
    return;
  }
  await runBenchmark();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
