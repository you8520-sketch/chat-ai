/**
 * Phase D.2 §9–14 — CI reasoning parameter alias test (A/B/C, 8 each).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d2-reasoning-alias.ts
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
  aliasVariantOrder,
  buildCiAliasBody,
  reasoningControlHash,
  reasoningControlKeys,
} from "./lib/gemini31PhaseD2Usage";
import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  median,
  probeStreamRequest,
  summarizeProbeRun,
} from "./lib/gemini31PhaseDProbe";
import { sha256 } from "./lib/gemini31PhaseD2Usage";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";

loadEnvLocal();

const OUT = "/opt/cursor/artifacts/gemini31-phase-d2-reasoning/reasoning-alias.json";
const BLOCKS = 8;

async function probeAlias(
  variant: "A" | "B" | "C",
  userMessage: string,
  productionBase: Record<string, unknown>
) {
  const messages = [
    { role: "system" as const, content: PHASE_D_MINIMAL_SYSTEM },
    { role: "user" as const, content: userMessage },
  ];
  const body = buildCiAliasBody(messages, variant, productionBase);
  const keys = reasoningControlKeys(body);
  if (keys.length !== (variant === "C" ? 0 : 1)) {
    throw new Error(`variant ${variant} reasoning controls: ${keys.join(",")}`);
  }

  const result = await probeStreamRequest({
    provider: "cheaperinference",
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
    requestBody: body,
  });

  return {
    variant,
    reasoning_control_keys: keys,
    reasoning_control_hash: reasoningControlHash(body),
    messages_hash: sha256(JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content })))),
    ...summarizeProbeRun(result),
    ci_route_metadata: result.ciRouteMetadata,
  };
}

async function main() {
  const productionBase = assemblePrimaryRpRequest({
    system: PHASE_D_MINIMAL_SYSTEM,
    history: [{ role: "user", content: PHASE_D_USER_TURNS[0]! }],
    modelId: "gemini-3.1-pro-preview",
    messageOpts: { transportProvider: "cheaperinference" },
    stream: true,
  }).requestBody;

  console.log("Preflight variant B...");
  try {
    await probeAlias("B", PHASE_D_USER_TURNS[0]!, productionBase);
  } catch (e) {
    const blocked = {
      generatedAt: new Date().toISOString(),
      ALIAS_B_SUPPORTED: "NO",
      error: (e as Error).message,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(blocked, null, 2));
    console.log(JSON.stringify(blocked, null, 2));
    return;
  }

  const allRuns: Awaited<ReturnType<typeof probeAlias>>[] = [];
  for (let block = 0; block < BLOCKS; block++) {
    const prompt = PHASE_D_USER_TURNS[block % PHASE_D_USER_TURNS.length]!;
    const order = aliasVariantOrder(block);
    for (const variant of order) {
      console.log(`Block ${block + 1}/${BLOCKS} variant ${variant}...`);
      allRuns.push(await probeAlias(variant, prompt, productionBase));
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  const pick = (v: "A" | "B" | "C", field: "reasoning_tokens" | "request_to_first_visible_ms") =>
    median(
      allRuns
        .filter((r) => r.variant === v)
        .map((r) => r[field])
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    );

  const aReasoning = pick("A", "reasoning_tokens");
  const bReasoning = pick("B", "reasoning_tokens");
  const cReasoning = pick("C", "reasoning_tokens");
  const aVisible = pick("A", "request_to_first_visible_ms");
  const bVisible = pick("B", "request_to_first_visible_ms");
  const cVisible = pick("C", "request_to_first_visible_ms");

  let lowFieldBehavior = "INCONCLUSIVE";
  if (aReasoning != null && bReasoning != null && cReasoning != null) {
    const bVsA = bReasoning / Math.max(aReasoning, 1);
    const aVsC = aReasoning / Math.max(cReasoning, 1);
    if (bVsA < 0.75 && bVisible != null && aVisible != null && bVisible < aVisible * 0.85) {
      lowFieldBehavior = "B_BETTER";
    } else if (bVsA > 1.25 && aVisible != null && bVisible != null && aVisible < bVisible * 0.85) {
      lowFieldBehavior = "A_BETTER";
    } else if (Math.abs(bVsA - 1) < 0.15 && Math.abs(aVsC - 1) < 0.15) {
      lowFieldBehavior = "ALL_SAME";
    } else if (Math.abs(bVsA - 1) < 0.15) {
      lowFieldBehavior = "A_B_SAME";
    }
  }

  let contract: string = "UNKNOWN";
  if (lowFieldBehavior === "B_BETTER") contract = "SUSPECT";
  else if (lowFieldBehavior === "A_B_SAME" || lowFieldBehavior === "ALL_SAME") contract = "SUPPORTED";

  const report = {
    generatedAt: new Date().toISOString(),
    ALIAS_B_SUPPORTED: "YES",
    ALIAS_TEST: {
      A_REASONING_EFFORT_LOW: "reasoning_effort=low",
      B_REASONING_OBJECT_LOW: "reasoning={effort:low}",
      C_OMITTED: "no reasoning control",
    },
    LOW_FIELD_BEHAVIOR: lowFieldBehavior,
    CURRENT_CI_REASONING_FIELD_CONTRACT: contract,
    A_REASONING_P50: aReasoning,
    B_REASONING_P50: bReasoning,
    C_REASONING_P50: cReasoning,
    A_FIRST_VISIBLE_P50: aVisible,
    B_FIRST_VISIBLE_P50: bVisible,
    C_FIRST_VISIBLE_P50: cVisible,
    A_vs_B_REASONING_RATIO: aReasoning != null && bReasoning != null ? bReasoning / Math.max(aReasoning, 1) : null,
    A_vs_C_REASONING_RATIO: aReasoning != null && cReasoning != null ? aReasoning / Math.max(cReasoning, 1) : null,
    runs: allRuns,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
