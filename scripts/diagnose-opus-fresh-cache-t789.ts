/**
 * Fresh-cache T7→T8→T9 × 3 sets for CI Opus 5.
 * Diagnostic only — no DB write, no point charge, no production policy change.
 *
 *   node --conditions=react-server --import tsx scripts/diagnose-opus-fresh-cache-t789.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { buildLikeScaleSnapshot } from "../src/lib/opusGeminiSameSnapshotDiagnostic";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { buildContext } from "../src/services/contextBuilder";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL } from "../src/lib/chatModels";
import { resolveHistoryMinTurnFloor } from "../src/lib/hybridMemory";
import {
  flattenOpenRouterMessageContent,
  type OpenRouterChatMessage,
} from "../src/lib/openRouterClient";
import { resolveHistoryCacheBreakpointIndex } from "../src/lib/openRouterCache";

const OUT = path.join("/opt/cursor/artifacts", "opus_fresh_cache_t789_report.log");
const MODEL = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;
const SETS = 3;

function nextUserLine(turnNo: number, salt: string): string {
  return `잠깐만. 거기 보지 마. 나 봐. 그래서 지금은 어떻게 할 거야? (${turnNo}) [${salt}]`;
}

function withFreshPrefix(
  snapshot: ReturnType<typeof buildLikeScaleSnapshot>,
  salt: string
): ReturnType<typeof buildLikeScaleSnapshot> {
  const history = (snapshot.shortTermHistory ?? []).map((m, i) =>
    i === 0 && m.role === "user"
      ? { ...m, content: `${m.content} [cache-id ${salt}]` }
      : m
  );
  const chunks = (snapshot.chunks ?? []).map((chunk, i) =>
    i === 0
      ? { ...chunk, content: `${chunk.content}\n[cache-id ${salt}]` }
      : chunk
  );
  return { ...snapshot, shortTermHistory: history, chunks };
}

function extractAssistantText(json: Record<string, unknown>): string {
  const choices = json.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : block && typeof block === "object" && "text" in block
            ? String((block as { text?: string }).text ?? "")
            : ""
      )
      .join("");
  }
  return "";
}

async function runTurn(opts: {
  snapshot: ReturnType<typeof buildLikeScaleSnapshot>;
  key: string;
}) {
  const built = buildContext({
    ...opts.snapshot,
    modelId: MODEL,
    provider: "cheaperinference",
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: opts.snapshot.charName,
    },
  });
  const body = structuredClone(assembled.requestBody) as Record<string, unknown>;
  body.stream = false;
  body.max_tokens = 8;
  const messages = (Array.isArray(body.messages) ? body.messages : []) as OpenRouterChatMessage[];
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(opts.key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    json = { parseError: rawText.slice(0, 240) };
  }
  const usage = parseOpenRouterUsage(json.usage, res.headers);
  return {
    promptTokens: usage.promptTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    standardInputTokens: usage.standardInputTokens,
    cacheHitPct:
      usage.promptTokens > 0
        ? Math.round((usage.cacheReadTokens / usage.promptTokens) * 1000) / 10
        : 0,
    outputTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    upstreamCostUsd: usage.upstreamCostUsd ?? null,
    historyCacheBreakpointIndex: resolveHistoryCacheBreakpointIndex(messages),
    httpStatus: res.status,
    assistantText: extractAssistantText(json),
    systemPrefix: flattenOpenRouterMessageContent(messages[0]?.content).slice(-48),
  };
}

function classify(sets: Array<{ turns: Array<Record<string, unknown>> }>): "A" | "B" | "C" {
  let t8MissAll = true;
  let t8MissSome = false;
  let t9Broken = false;
  for (const set of sets) {
    const t8 = set.turns[1];
    const t9 = set.turns[2];
    const t8Miss = Number(t8?.cacheReadTokens ?? 0) === 0;
    if (!t8Miss) t8MissAll = false;
    if (t8Miss) t8MissSome = true;
    const t9Read = Number(t9?.cacheReadTokens ?? 0);
    const t9Hit = Number(t9?.cacheHitPct ?? 0);
    const t9Standard = Number(t9?.standardInputTokens ?? 0);
    if (t9Read === 0 || t9Hit < 80 || t9Standard >= 30_000) t9Broken = true;
  }
  if (t9Broken) return "C";
  if (t8MissAll) return "A";
  if (t8MissSome) return "B";
  return "A";
}

async function main() {
  process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || "1";
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) throw new Error("CHEAPER_INFERENCE_API_KEY missing");

  const sets: Array<{ set: number; salt: string; turns: Array<Record<string, unknown>> }> = [];
  for (let setIdx = 1; setIdx <= SETS; setIdx++) {
    const salt = `set${setIdx}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const base = withFreshPrefix(buildLikeScaleSnapshot(), salt);
    const prior = [...(base.shortTermHistory ?? [])];
    let completedTurns = 6;
    const turns: Array<Record<string, unknown>> = [];
    for (const turnNo of [7, 8, 9]) {
      const snapshot = {
        ...base,
        shortTermHistory: prior,
        currentUserMessage: nextUserLine(turnNo, salt),
        completedTurns,
        completedTurnsForMemoryCoverage: completedTurns,
        summarizedTurnCount: 0,
        historyMinTurnFloor: resolveHistoryMinTurnFloor({
          memoryFeatureEnabled: true,
          completedTurns,
          summarizedTurnCount: 0,
        }),
        targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      };
      const row = await runTurn({ snapshot, key });
      const { assistantText, systemPrefix, ...publicRow } = row;
      turns.push({ turn: turnNo, ...publicRow });
      prior.push({ role: "user", content: nextUserLine(turnNo, salt) });
      prior.push({
        role: "assistant",
        content: assistantText || `[empty-assistant-t${turnNo}-${salt}]`,
      });
      completedTurns += 1;
      console.log(JSON.stringify({ set: setIdx, salt, turn: turnNo, systemPrefix, ...publicRow }));
    }
    sets.push({ set: setIdx, salt, turns });
  }

  const caseId = classify(sets);
  const t8MissCount = sets.filter((s) => Number(s.turns[1]?.cacheReadTokens ?? 0) === 0).length;
  const text = [
    "FRESH-CACHE T7→T8→T9 × 3",
    `model: ${MODEL}`,
    "max_tokens: 8 (diagnostic only)",
    "thinking: disabled / effort low",
    `case: ${caseId}`,
    `T8 cacheRead=0 count: ${t8MissCount}/3`,
    "",
    JSON.stringify({ sets, case: caseId, t8MissCount }, null, 2),
  ].join("\n");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text, "utf8");
  console.log(text);
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
