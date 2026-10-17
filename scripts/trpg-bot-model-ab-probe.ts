/**
 * Contract probe — Gemini 3.7 Flash reasoning OFF vs minimum, Luna none.
 * Run before the main benchmark. Does NOT alter production adapters.
 *
 *   npx tsx scripts/trpg-bot-model-ab-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { TRPG_BOT_SYSTEM } from "@/lib/trpg/botActions";
import { buildTrpgBotActionUserBlock } from "@/lib/trpg/botActions";
import { reasoningTokensFromProviderUsage } from "@/lib/trpg/gmCall";
import { parseProviderUsageCostUsd } from "@/lib/trpg/roundEconomics";
import {
  BENCH_GEMINI_MODEL,
  BENCH_LUNA_MODEL,
  BENCH_TEMPERATURE,
  buildBenchBotRequestBody,
  describeModelContract,
} from "./lib/trpgBotModelAb/contracts";
import { FROZEN_FIXTURES } from "./lib/trpgBotModelAb/fixtures";
import { padContextToTargetTokens, estimateInputTokens } from "./lib/trpgBotModelAb/padContext";

loadEnvConfig(process.cwd());

const OUT_DIR = join(process.cwd(), "docs/audits/trpg-bot-model-ab");

type ProbeVariant = {
  label: string;
  patch: (body: Record<string, unknown>) => Record<string, unknown>;
};

const GEMINI_VARIANTS: ProbeVariant[] = [
  {
    label: "gemini_reasoning_effort_none",
    patch: (b) => ({ ...b, reasoning_effort: "none" }),
  },
  {
    label: "gemini_reasoning_effort_low",
    patch: (b) => ({ ...b, reasoning_effort: "low" }),
  },
  {
    label: "gemini_thinking_disabled",
    patch: (b) => ({ ...b, thinking: { type: "disabled" }, reasoning_effort: "none" }),
  },
  {
    label: "gemini_production_adapter",
    patch: (b) => b,
  },
];

async function probeCall(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
  reasoningTokens: number | "unavailable";
  outputTokens: number;
  inputTokens: number;
  costUsd?: number;
  finishReason?: string;
  textLen: number;
}> {
  const started = Date.now();
  const headers = buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey());
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const latencyMs = Date.now() - started;
  const raw = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      latencyMs,
      error: raw.slice(0, 400),
      reasoningTokens: "unavailable",
      outputTokens: 0,
      inputTokens: 0,
      textLen: 0,
    };
  }
  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: Record<string, unknown>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage;
  return {
    ok: true,
    status: res.status,
    latencyMs,
    reasoningTokens: reasoningTokensFromProviderUsage(usage as never),
    outputTokens: Number(usage?.completion_tokens ?? 0),
    inputTokens: Number(usage?.prompt_tokens ?? 0),
    costUsd: parseProviderUsageCostUsd(usage),
    finishReason: data.choices?.[0]?.finish_reason,
    textLen: Array.from(text).length,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixture = FROZEN_FIXTURES[0]!;
  const userRaw = buildTrpgBotActionUserBlock(fixture.ctx);
  const user = buildTrpgBotActionUserBlock(
    padContextToTargetTokens(fixture.ctx, Array.from(userRaw).length, fixture.targetInputTokens)
  );

  const lunaBody = buildBenchBotRequestBody({
    model: BENCH_LUNA_MODEL,
    system: TRPG_BOT_SYSTEM,
    user,
  });
  const lunaContract = describeModelContract(BENCH_LUNA_MODEL, lunaBody);
  const lunaResult = await probeCall(lunaBody);

  const geminiResults: Array<Record<string, unknown>> = [];
  let geminiTrueOffSupported = false;
  let geminiReasoningMode = "low";

  for (const variant of GEMINI_VARIANTS) {
    const base = buildBenchBotRequestBody({
      model: BENCH_GEMINI_MODEL,
      system: TRPG_BOT_SYSTEM,
      user,
    });
    const body = variant.patch(base);
    const contract = describeModelContract(BENCH_GEMINI_MODEL, body);
    const result = await probeCall(body);
    if (variant.label === "gemini_reasoning_effort_none" && result.ok && result.reasoningTokens === 0) {
      geminiTrueOffSupported = true;
      geminiReasoningMode = "none";
    }
    geminiResults.push({
      variant: variant.label,
      contract: contract.adaptedBody,
      result,
    });
  }

  const report = {
    probedAt: new Date().toISOString(),
    fixtureId: fixture.id,
    estimatedInputTokens: estimateInputTokens(TRPG_BOT_SYSTEM + user),
    GEMINI_REQUEST_CONTRACT: {
      productionAdapter: describeModelContract(
        BENCH_GEMINI_MODEL,
        buildBenchBotRequestBody({ model: BENCH_GEMINI_MODEL, system: TRPG_BOT_SYSTEM, user })
      ).adaptedBody,
      GEMINI_TRUE_OFF_SUPPORTED: geminiTrueOffSupported,
      GEMINI_REASONING_MODE: geminiTrueOffSupported ? "none" : "low",
      variants: geminiResults,
    },
    LUNA_REQUEST_CONTRACT: {
      contract: lunaContract.adaptedBody,
      LUNA_TRUE_OFF_SUPPORTED: lunaContract.lunaTrueOffSupported ?? false,
      LUNA_REASONING_MODE: lunaContract.lunaReasoningMode ?? "none",
      probe: lunaResult,
    },
    temperature: BENCH_TEMPERATURE,
    stream: false,
    retry: 0,
  };

  writeFileSync(join(OUT_DIR, "CONTRACT_PROBE.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
