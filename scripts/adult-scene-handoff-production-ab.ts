/**
 * Production-equivalent adult handoff shadow harness.
 *
 * - Uses the real buildContext() and request-body parameter resolution.
 * - Does not open the app DB, mutate route state, or charge points.
 * - `--prepare-origins` produces the final pre-handoff assistant turn with the
 *   assigned Gemini/Luna model.
 * - `--run --runs=2` performs 10 scenes × A/B × 2 = 40 DeepSeek calls.
 * - With no network flag it only assembles and validates all payloads.
 */
import "./lib/server-only-mock";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildContext } from "@/services/contextBuilder";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  selectAdultHandoffRawHistory,
} from "@/lib/adultSceneRouting";
import {
  buildOpenRouterRequestBody,
  resolveOpenRouterMaxTokens,
} from "@/lib/openRouterClient";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterConfig";
import {
  openRouterUsdCostFromRates,
} from "@/lib/openRouterModelPricing";
import { estimateTokens } from "@/lib/tokenEstimate";
import { loadEnvLocal } from "./load-env-local";
import {
  PRODUCTION_HANDOFF_SCENES,
  buildProductionHandoffContext,
  type ProductionHandoffScene,
} from "./lib/adult-handoff-production-fixture";

loadEnvLocal();
// Linked worktrees do not inherit the root worktree's gitignored .env.local.
// Load it read-only for this explicit shadow harness without copying secrets.
if (!process.env.OPENROUTER_API_KEY || !process.env.CHEAPER_INFERENCE_API_KEY) {
  try {
    const rootEnv = readFileSync(resolve(process.cwd(), "..", "..", ".env.local"), "utf8");
    for (const line of rootEnv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Keys remain optional in dry-run mode.
  }
}
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type Arm = "A" | "B";
type Message = { role: "system" | "user" | "assistant"; content: string };
type ProviderUsage = {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  reportedCostUsd: number | null;
  finishReason: string | null;
  actualModel: string | null;
  provider: string | null;
};

type TokenBreakdown = {
  totalPromptTokens: number;
  estimatedComponentTokenSum: number;
  systemAndMasterPromptTokens: number;
  characterAndWorldTokens: number;
  museAndSpeechLockTokens: number;
  memoryAndSummaryTokens: number;
  statusAndTriggerTokens: number;
  rawHistoryTokens: number;
  sceneContinuityPacketTokens: number;
  currentUserInputTokens: number;
  tokenBreakdownError: number;
};

type AssembledCase = {
  sceneId: string;
  sceneLabel: string;
  originModel: ProductionHandoffScene["originModel"];
  arm: Arm;
  model: string;
  targetResponseChars: number;
  maxTokens: number | null;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  messages: Message[];
  rawExchangeCount: number;
  rawMessageCount: number;
  rawCharacterCount: number;
  rawEstimatedTokens: number;
  rawActualPromptTokenContribution: number | null;
  estimatedBreakdown: Omit<
    TokenBreakdown,
    "totalPromptTokens" | "tokenBreakdownError" | "rawActualPromptTokenContribution"
  >;
  payload: Record<string, unknown>;
};

type OutputMetrics = {
  outputTokens: number;
  outputCharactersWithSpaces: number;
  outputCharactersWithoutSpaces: number;
  koreanCharacterCount: number;
  paragraphCount: number;
  finishReason: string | null;
  reachedProductionLengthTarget: boolean;
};

type RunRecord = {
  sampleId: string;
  sceneId: string;
  sceneLabel: string;
  originModel: ProductionHandoffScene["originModel"];
  arm: Arm;
  run: number;
  output: string;
  latencyMs: number;
  usage: ProviderUsage;
  raw: Pick<
    AssembledCase,
    | "rawExchangeCount"
    | "rawMessageCount"
    | "rawCharacterCount"
    | "rawEstimatedTokens"
  > & { rawActualPromptTokenContribution: number };
  tokenBreakdown: TokenBreakdown;
  outputMetrics: OutputMetrics;
  cost: {
    generalModelCostUsd: number | null;
    deepSeekCostUsd: number;
    handoffAdditionalInputCostUsd: number;
    sceneContinuityPacketCostUsd: number;
    hiddenRefusalFallbackCostUsd: number;
    totalUpstreamCostUsd: number;
    estimatedUserPointCharge: null;
    estimatedMargin: null;
  };
};

const OUTPUT_DIR = join(process.cwd(), "data", "adult-scene-handoff-production-ab");
const ORIGINS_PATH = join(OUTPUT_DIR, "general-origins.json");
const CHECKPOINT_PATH = join(OUTPUT_DIR, "checkpoint.json");
const REPORT_PATH = join(OUTPUT_DIR, "results.json");
const BLIND_PATH = join(OUTPUT_DIR, "blind-review.json");
const TARGET_RESPONSE_CHARS = 3200;
const HANDOFF_RAW_MAX_TOKENS = 10_000;

function parseRuns(): number {
  const value = process.argv.find((arg) => arg.startsWith("--runs="))?.split("=")[1];
  const parsed = Number.parseInt(value ?? "2", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

function loadOrigins(): Record<string, string> {
  if (!existsSync(ORIGINS_PATH)) return {};
  return JSON.parse(readFileSync(ORIGINS_PATH, "utf8")) as Record<string, string>;
}

function saveJson(path: string, value: unknown): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function sceneWithPreparedOrigin(
  scene: ProductionHandoffScene,
  origins: Record<string, string>
): ProductionHandoffScene {
  const origin = origins[scene.id]?.trim();
  if (!origin) return scene;
  const history = scene.history.map((message) => ({ ...message }));
  const lastAssistant = history.findLastIndex((message) => message.role === "assistant");
  if (lastAssistant >= 0) history[lastAssistant] = { role: "assistant", content: origin };
  return { ...scene, history };
}

function sectionBuckets(
  built: ReturnType<typeof buildContext>,
  packetTokens: number,
  rawTokens: number,
  currentTokens: number
): AssembledCase["estimatedBreakdown"] {
  let systemAndMasterPromptTokens = 0;
  let characterAndWorldTokens = 0;
  let museAndSpeechLockTokens = 0;
  let memoryAndSummaryTokens = 0;
  let statusAndTriggerTokens = 0;

  for (const section of built.meta.trackedSections ?? []) {
    const tokens = estimateTokens(section.text);
    const signature = `${section.id} ${section.label} ${section.text.slice(0, 180)}`;
    if (
      section.category === "characterSetting" ||
      section.category === "worldLore" ||
      section.category === "dialogueExamples"
    ) {
      characterAndWorldTokens += tokens;
    } else if (/muse|speech|말투|prose style|문체/i.test(signature)) {
      museAndSpeechLockTokens += tokens;
    } else if (/status|trigger|상태창|scenario event/i.test(signature)) {
      statusAndTriggerTokens += tokens;
    } else if (
      section.category === "memory" ||
      /summary|archive|episodic|memory|기억|요약/i.test(signature)
    ) {
      memoryAndSummaryTokens += tokens;
    } else {
      systemAndMasterPromptTokens += tokens;
    }
  }
  const estimatedComponentTokenSum =
    systemAndMasterPromptTokens +
    characterAndWorldTokens +
    museAndSpeechLockTokens +
    memoryAndSummaryTokens +
    statusAndTriggerTokens +
    rawTokens +
    packetTokens +
    currentTokens;
  return {
    estimatedComponentTokenSum,
    systemAndMasterPromptTokens,
    characterAndWorldTokens,
    museAndSpeechLockTokens,
    memoryAndSummaryTokens,
    statusAndTriggerTokens,
    rawHistoryTokens: rawTokens,
    sceneContinuityPacketTokens: packetTokens,
    currentUserInputTokens: currentTokens,
  };
}

function assemble(scene: ProductionHandoffScene, arm: Arm): AssembledCase {
  const raw = selectAdultHandoffRawHistory(scene.history, {
    targetTurns: arm === "A" ? 4 : 6,
    minimumTurns: arm === "A" ? 4 : 2,
    maxTokens: HANDOFF_RAW_MAX_TOKENS,
  });
  const rawMessageCount = raw.history.length;
  if (arm === "A" && (raw.rawTurnsIncluded !== 4 || rawMessageCount !== 8)) {
    throw new Error(
      `${scene.id}/A RAW invariant failed: expected 4 exchanges/8 messages, got ${raw.rawTurnsIncluded}/${rawMessageCount}`
    );
  }
  if (
    arm === "B" &&
    (raw.rawTurnsIncluded < 2 || raw.rawTurnsIncluded > 6 || rawMessageCount !== raw.rawTurnsIncluded * 2)
  ) {
    throw new Error(
      `${scene.id}/B RAW invariant failed: expected up to 6 complete exchanges/12 messages, got ${raw.rawTurnsIncluded}/${rawMessageCount}`
    );
  }
  const built = buildContext(buildProductionHandoffContext(scene, raw.history));
  const builtRaw = built.history.slice(0, -1);
  if (builtRaw.length !== rawMessageCount) {
    throw new Error(
      `${scene.id}/${arm} buildContext changed RAW count: ${rawMessageCount} -> ${builtRaw.length}`
    );
  }
  const packet = buildSceneContinuityPacket(scene.continuityPacket);
  const packetText =
    arm === "B"
      ? appendAdultHandoffPrompt("", packet).trim()
      : "";
  const systemPrompt =
    arm === "B"
      ? appendAdultHandoffPrompt(built.systemPrompt, packet)
      : built.systemPrompt;
  const history = built.history;
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];
  const payload = buildOpenRouterRequestBody(
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    messages,
    false,
    TARGET_RESPONSE_CHARS
  );
  const rawCharacterCount = raw.history.reduce(
    (sum, message) => sum + message.content.length,
    0
  );
  const currentTokens = estimateTokens(scene.currentUserMessage);
  const packetTokens = estimateTokens(packetText);
  const breakdown = sectionBuckets(
    built,
    packetTokens,
    raw.rawTokensIncluded,
    currentTokens
  );
  return {
    sceneId: scene.id,
    sceneLabel: scene.label,
    originModel: scene.originModel,
    arm,
    model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    targetResponseChars: TARGET_RESPONSE_CHARS,
    maxTokens:
      resolveOpenRouterMaxTokens(
        TARGET_RESPONSE_CHARS,
        undefined,
        CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
      ) ?? null,
    systemPrompt,
    history,
    messages,
    rawExchangeCount: raw.rawTurnsIncluded,
    rawMessageCount,
    rawCharacterCount,
    rawEstimatedTokens: raw.rawTokensIncluded,
    rawActualPromptTokenContribution: null,
    estimatedBreakdown: breakdown,
    payload,
  };
}

async function directCompletion(input: {
  model: string;
  messages: Message[];
  provider: "openrouter" | "cheaperinference";
  targetResponseChars: number;
}): Promise<{ text: string; usage: ProviderUsage; latencyMs: number }> {
  const cheaper = input.provider === "cheaperinference";
  const key = cheaper ? resolveCheaperInferenceApiKey() : resolveOpenRouterApiKey();
  const endpoint = cheaper
    ? CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL
    : OPENROUTER_CHAT_COMPLETIONS_URL;
  const headers = cheaper
    ? buildCheaperInferenceHeaders(key)
    : buildOpenRouterHeaders(key);
  const payload = buildOpenRouterRequestBody(
    input.model,
    input.messages,
    false,
    input.targetResponseChars
  );
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(240_000),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `${input.provider} ${response.status}: ${bodyText.slice(0, 500)}`
    );
  }
  const data = JSON.parse(bodyText) as {
    model?: string;
    provider?: string;
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cache_read_input_tokens?: number;
      cache_write_input_tokens?: number;
      reasoning_tokens?: number;
      cost?: number;
    };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error(`empty completion: ${bodyText.slice(0, 500)}`);
  return {
    text,
    latencyMs: Date.now() - started,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(input.messages)),
      completionTokens: data.usage?.completion_tokens ?? estimateTokens(text),
      cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: data.usage?.cache_write_input_tokens ?? 0,
      reasoningTokens: data.usage?.reasoning_tokens ?? 0,
      reportedCostUsd:
        typeof data.usage?.cost === "number" ? data.usage.cost : null,
      finishReason: data.choices?.[0]?.finish_reason ?? null,
      actualModel: data.model ?? null,
      provider: data.provider ?? input.provider,
    },
  };
}

function outputMetrics(text: string, usage: ProviderUsage): OutputMetrics {
  const withSpaces = text.length;
  return {
    outputTokens: usage.completionTokens,
    outputCharactersWithSpaces: withSpaces,
    outputCharactersWithoutSpaces: text.replace(/\s/g, "").length,
    koreanCharacterCount: (text.match(/[가-힣]/g) ?? []).length,
    paragraphCount: text.split(/\n\s*\n/).filter((part) => part.trim()).length,
    finishReason: usage.finishReason,
    reachedProductionLengthTarget: withSpaces >= 2_000 && withSpaces <= 4_000,
  };
}

function actualBreakdown(
  assembled: AssembledCase,
  providerPromptTokens: number
): TokenBreakdown {
  const estimated = assembled.estimatedBreakdown;
  const scale =
    estimated.estimatedComponentTokenSum > 0
      ? providerPromptTokens / estimated.estimatedComponentTokenSum
      : 1;
  const scaled = (value: number) => Math.round(value * scale);
  const result = {
    totalPromptTokens: providerPromptTokens,
    estimatedComponentTokenSum: estimated.estimatedComponentTokenSum,
    systemAndMasterPromptTokens: scaled(estimated.systemAndMasterPromptTokens),
    characterAndWorldTokens: scaled(estimated.characterAndWorldTokens),
    museAndSpeechLockTokens: scaled(estimated.museAndSpeechLockTokens),
    memoryAndSummaryTokens: scaled(estimated.memoryAndSummaryTokens),
    statusAndTriggerTokens: scaled(estimated.statusAndTriggerTokens),
    rawHistoryTokens: scaled(estimated.rawHistoryTokens),
    sceneContinuityPacketTokens: scaled(
      estimated.sceneContinuityPacketTokens
    ),
    currentUserInputTokens: scaled(estimated.currentUserInputTokens),
    tokenBreakdownError:
      providerPromptTokens - estimated.estimatedComponentTokenSum,
  };
  return result;
}

function shuffleDeterministic<T>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ah = JSON.stringify(a).split("").reduce((n, c) => (n * 33 + c.charCodeAt(0)) >>> 0, 5381);
    const bh = JSON.stringify(b).split("").reduce((n, c) => (n * 33 + c.charCodeAt(0)) >>> 0, 5381);
    return ah - bh;
  });
}

async function prepareOrigins(): Promise<void> {
  const origins = loadOrigins();
  for (const source of PRODUCTION_HANDOFF_SCENES) {
    const existingLength = origins[source.id]?.length ?? 0;
    if (existingLength >= 2_000 && existingLength <= 4_000) continue;
    if (existingLength > 4_000) {
      origins[source.id] = origins[source.id]!.slice(0, 4_000);
      saveJson(ORIGINS_PATH, origins);
      console.log(
        `[origin] ${source.id}: capped existing provider output ${existingLength} -> 4000 fixture chars`
      );
      continue;
    }
    const historyBeforeLastExchange = source.history.slice(0, -2);
    const originUser = source.history.at(-2);
    if (originUser?.role !== "user") throw new Error(`${source.id}: missing origin user`);
    const model =
      source.originModel === "gemini-3.6-flash"
        ? OPENROUTER_GEMINI_36_FLASH_MODEL
        : CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
    const provider =
      source.originModel === "gemini-3.6-flash"
        ? "openrouter" as const
        : "cheaperinference" as const;
    const contextInput = buildProductionHandoffContext(
      { ...source, currentUserMessage: originUser.content },
      historyBeforeLastExchange
    );
    contextInput.modelId = model;
    contextInput.provider = provider;
    const built = buildContext(contextInput);
    let result: Awaited<ReturnType<typeof directCompletion>> | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = await directCompletion({
        model,
        provider,
        messages: [
          { role: "system", content: built.systemPrompt },
          ...built.history,
        ],
        targetResponseChars: TARGET_RESPONSE_CHARS,
      });
      if (result.text.length >= 2_000) break;
      console.warn(
        `[origin] ${source.id} attempt ${attempt} below 2000 chars (${result.text.length}); retrying once`
      );
    }
    if (!result || result.text.length < 2_000) {
      throw new Error(`${source.id}: origin model did not reach 2000 chars`);
    }
    // Historical fixtures reproduce the site's visible 2k–4k distribution.
    // Preserve the actual provider output prefix and cap only the fixture copy.
    origins[source.id] = result.text.slice(0, 4_000);
    saveJson(ORIGINS_PATH, origins);
    console.log(
      `[origin] ${source.id} ${source.originModel}: provider=${result.text.length} chars, fixture=${origins[source.id]!.length}, ${result.usage.promptTokens}/${result.usage.completionTokens} tokens`
    );
  }
}

function validateDryRun(origins: Record<string, string>): AssembledCase[] {
  const cases = PRODUCTION_HANDOFF_SCENES.flatMap((source) => {
    const scene = sceneWithPreparedOrigin(source, origins);
    for (const message of scene.history.filter((item) => item.role === "assistant")) {
      if (message.content.length < 2_000 || message.content.length > 4_000) {
        throw new Error(
          `${scene.id}: historical assistant length ${message.content.length} is outside 2000..4000`
        );
      }
    }
    return [assemble(scene, "A"), assemble(scene, "B")];
  });
  const manifest = cases.map((item) => ({
    sceneId: item.sceneId,
    arm: item.arm,
    originModel: item.originModel,
    rawExchangeCount: item.rawExchangeCount,
    rawMessageCount: item.rawMessageCount,
    rawCharacterCount: item.rawCharacterCount,
    rawEstimatedTokens: item.rawEstimatedTokens,
    targetResponseChars: item.targetResponseChars,
    maxTokens: item.maxTokens,
    estimatedBreakdown: item.estimatedBreakdown,
    payloadMessageCount: item.messages.length,
  }));
  saveJson(join(OUTPUT_DIR, "dry-run-manifest.json"), manifest);
  return cases;
}

function evaluateRawGate(cases: AssembledCase[]): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  for (const scene of PRODUCTION_HANDOFF_SCENES) {
    const a = cases.find((item) => item.sceneId === scene.id && item.arm === "A");
    const b = cases.find((item) => item.sceneId === scene.id && item.arm === "B");
    if (!a || !b) {
      failures.push(`${scene.id}: missing arm`);
      continue;
    }
    if (a.rawExchangeCount !== 4 || a.rawMessageCount !== 8) {
      failures.push(
        `${scene.id}: A=${a.rawExchangeCount} exchanges/${a.rawMessageCount} messages`
      );
    }
    if (b.rawExchangeCount < a.rawExchangeCount) {
      failures.push(
        `${scene.id}: B retained fewer exchanges than A (${b.rawExchangeCount} < ${a.rawExchangeCount})`
      );
    }
    if (b.rawExchangeCount > 6 || b.rawMessageCount > 12) {
      failures.push(
        `${scene.id}: B exceeded 6 exchanges/12 messages`
      );
    }
  }
  return { passed: failures.length === 0, failures };
}

async function runGate(cases: AssembledCase[], runs: number): Promise<void> {
  const checkpoint: RunRecord[] = existsSync(CHECKPOINT_PATH)
    ? JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) as RunRecord[]
    : [];
  for (const record of checkpoint) {
    const assembled = cases.find(
      (item) => item.sceneId === record.sceneId && item.arm === record.arm
    );
    if (!assembled) continue;
    const breakdown = actualBreakdown(assembled, record.usage.promptTokens);
    record.tokenBreakdown = breakdown;
    record.raw.rawActualPromptTokenContribution = breakdown.rawHistoryTokens;
  }
  if (checkpoint.length > 0) saveJson(CHECKPOINT_PATH, checkpoint);
  const done = new Set(checkpoint.map((record) => record.sampleId));
  for (const assembled of cases) {
    for (let run = 1; run <= runs; run++) {
      const sampleId = `${assembled.sceneId}-${assembled.arm}-${run}`;
      if (done.has(sampleId)) continue;
      const result = await directCompletion({
        model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        provider: "cheaperinference",
        messages: assembled.messages,
        targetResponseChars: TARGET_RESPONSE_CHARS,
      });
      const breakdown = actualBreakdown(assembled, result.usage.promptTokens);
      const rawActual = breakdown.rawHistoryTokens;
      const billing = openRouterUsdCostFromRates({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheWriteTokens: result.usage.cacheWriteTokens,
      });
      const inputRate = billing.rates.inputUsdPerM;
      const handoffAdditionalInputCostUsd =
        (Math.max(0, breakdown.rawHistoryTokens) / 1_000_000) * inputRate;
      const sceneContinuityPacketCostUsd =
        (breakdown.sceneContinuityPacketTokens / 1_000_000) * inputRate;
      const record: RunRecord = {
        sampleId,
        sceneId: assembled.sceneId,
        sceneLabel: assembled.sceneLabel,
        originModel: assembled.originModel,
        arm: assembled.arm,
        run,
        output: result.text,
        latencyMs: result.latencyMs,
        usage: result.usage,
        raw: {
          rawExchangeCount: assembled.rawExchangeCount,
          rawMessageCount: assembled.rawMessageCount,
          rawCharacterCount: assembled.rawCharacterCount,
          rawEstimatedTokens: assembled.rawEstimatedTokens,
          rawActualPromptTokenContribution: rawActual,
        },
        tokenBreakdown: breakdown,
        outputMetrics: outputMetrics(result.text, result.usage),
        cost: {
          generalModelCostUsd: null,
          deepSeekCostUsd:
            result.usage.reportedCostUsd ?? billing.usdCost,
          handoffAdditionalInputCostUsd,
          sceneContinuityPacketCostUsd,
          hiddenRefusalFallbackCostUsd: 0,
          totalUpstreamCostUsd:
            result.usage.reportedCostUsd ?? billing.usdCost,
          estimatedUserPointCharge: null,
          estimatedMargin: null,
        },
      };
      checkpoint.push(record);
      saveJson(CHECKPOINT_PATH, checkpoint);
      console.log(
        `[handoff] ${sampleId}: ${result.text.length} chars, ${result.usage.promptTokens}/${result.usage.completionTokens} tokens, ${result.latencyMs} ms`
      );
    }
  }
  saveJson(REPORT_PATH, checkpoint);
  const blind = shuffleDeterministic(
    checkpoint.map((record, index) => ({
      blindId: `sample-${String(index + 1).padStart(3, "0")}`,
      sceneId: record.sceneId,
      originModel: record.originModel,
      output: record.output,
    }))
  );
  saveJson(BLIND_PATH, blind);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (process.argv.includes("--prepare-origins")) {
    await prepareOrigins();
  }
  const origins = loadOrigins();
  const cases = validateDryRun(origins);
  const rawGate = evaluateRawGate(cases);
  saveJson(join(OUTPUT_DIR, "raw-gate.json"), rawGate);
  console.log(
    `[dry-run] ${cases.length} payloads validated through buildContext(); origins=${Object.keys(origins).length}/10; rawGate=${rawGate.passed ? "PASS" : "FAIL"}`
  );
  for (const failure of rawGate.failures) console.error(`[raw-gate] ${failure}`);
  if (process.argv.includes("--run")) {
    if (Object.keys(origins).length !== PRODUCTION_HANDOFF_SCENES.length) {
      throw new Error("Run --prepare-origins first; all 10 actual Gemini/Luna origins are required.");
    }
    if (!rawGate.passed) {
      throw new Error(
        "Production A/B calls blocked: RAW gate failed. Fix or explicitly redesign the RAW budget before spending the 40-call gate."
      );
    }
    await runGate(cases, parseRuns());
  }
  if (process.argv.includes("--probe")) {
    const probeCases = cases.filter((item) => item.sceneId === "romance_entry");
    await runGate(probeCases, 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
