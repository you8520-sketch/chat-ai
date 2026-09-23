/**
 * Phase D.1 §6–8 — CI LOW self-control (L / D / optional H).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d1-ci-low-self-control.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  buildCiDiagnosticBody,
  median,
  probeStreamRequest,
  summarizeProbeRun,
  type CiReasoningVariant,
} from "./lib/gemini31PhaseDProbe";

loadEnvLocal();

const OUT = "/opt/cursor/artifacts/gemini31-phase-d1-reasoning/ci-low-self-control.json";
const RUNS_PER_VARIANT = 8;

async function probeCiVariant(variant: CiReasoningVariant, userMessage: string) {
  const messages = [
    { role: "system" as const, content: PHASE_D_MINIMAL_SYSTEM },
    { role: "user" as const, content: userMessage },
  ];
  const body = buildCiDiagnosticBody(messages, variant, true);
  return probeStreamRequest({
    provider: "cheaperinference",
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
    requestBody: body,
  });
}

async function main() {
  console.log("Probing CI high variant support (1 call)...");
  let highSupported = false;
  try {
    const hProbe = await probeCiVariant("high", PHASE_D_USER_TURNS[0]!);
    highSupported = hProbe.finishReason != null && hProbe.reasoningTokens >= 0;
    console.log("CI high probe OK, reasoning_tokens=", hProbe.reasoningTokens);
  } catch (e) {
    console.log("CI high not supported or failed:", (e as Error).message.slice(0, 200));
  }

  const variants: CiReasoningVariant[] = highSupported ? ["low", "default", "high"] : ["low", "default"];
  const byVariant: Record<string, ReturnType<typeof summarizeProbeRun>[]> = {};

  for (const variant of variants) {
    byVariant[variant] = [];
    for (let i = 0; i < RUNS_PER_VARIANT; i++) {
      const msg = PHASE_D_USER_TURNS[i % PHASE_D_USER_TURNS.length]!;
      console.log(`CI ${variant} run ${i + 1}/${RUNS_PER_VARIANT}...`);
      const result = await probeCiVariant(variant, msg);
      byVariant[variant]!.push(summarizeProbeRun(result));
      if (i < RUNS_PER_VARIANT - 1) await new Promise((r) => setTimeout(r, 1200));
    }
  }

  const p50 = (variant: CiReasoningVariant, field: keyof ReturnType<typeof summarizeProbeRun>) =>
    median(
      (byVariant[variant] ?? [])
        .map((r) => r[field])
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    );

  const lowReasoning = p50("low", "reasoning_tokens");
  const defaultReasoning = p50("default", "reasoning_tokens");
  const highReasoning = highSupported ? p50("high", "reasoning_tokens") : null;

  const lowVisible = p50("low", "request_to_first_visible_ms");
  const defaultVisible = p50("default", "request_to_first_visible_ms");
  const highVisible = highSupported ? p50("high", "request_to_first_visible_ms") : null;

  let selfControl: string = "INCONCLUSIVE";
  if (lowReasoning != null && defaultReasoning != null) {
    const lowVsDefault = lowReasoning / Math.max(defaultReasoning, 1);
    const lowVsHigh =
      highReasoning != null ? lowReasoning / Math.max(highReasoning, 1) : null;
    const materiallyLower =
      lowVsDefault < 0.75 || (lowVsHigh != null && lowVsHigh < 0.75);
    const materiallyHigherVisible =
      lowVisible != null &&
      defaultVisible != null &&
      lowVisible < defaultVisible * 0.85;
    const similar =
      lowVsDefault > 0.9 &&
      lowVsDefault < 1.1 &&
      (lowVsHigh == null || (lowVsHigh > 0.9 && lowVsHigh < 1.1));

    if (materiallyLower || materiallyHigherVisible) selfControl = "HONORED_DIRECTIONALLY";
    else if (similar) selfControl = "SUSPECT_IGNORED";
  }

  const report = {
    generatedAt: new Date().toISOString(),
    CI_HIGH_SUPPORTED: highSupported,
    CI_LOW_SELF_CONTROL: selfControl,
    CI_LOW_REASONING_P50: lowReasoning,
    CI_DEFAULT_REASONING_P50: defaultReasoning,
    CI_HIGH_REASONING_P50: highReasoning,
    LOW_VS_DEFAULT_RATIO:
      lowReasoning != null && defaultReasoning != null
        ? lowReasoning / Math.max(defaultReasoning, 1)
        : null,
    LOW_VS_HIGH_RATIO:
      lowReasoning != null && highReasoning != null
        ? lowReasoning / Math.max(highReasoning, 1)
        : null,
    CI_LOW_FIRST_VISIBLE_P50: lowVisible,
    CI_DEFAULT_FIRST_VISIBLE_P50: defaultVisible,
    CI_HIGH_FIRST_VISIBLE_P50: highVisible,
    runs: byVariant,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
