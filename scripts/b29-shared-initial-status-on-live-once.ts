/**
 * B29 one-shot: status-ON full Shared Initial with production schema (post B29 patterns).
 * Not a runner. Guard: B29_SHARED_INITIAL_LIVE=1, benchmark key only.
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { mkdirSync, writeFileSync } from "node:fs";
import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import {
  buildPostTurnSharedInitialResponseFormat,
  buildPostTurnSharedInitialJsonSchema,
  validatePostTurnSharedInitialStructure,
} from "@/lib/postTurnSharedInitial/schema";
import { buildPostTurnSharedInitialSystem, buildPostTurnSharedInitialUserBlock } from "@/lib/postTurnSharedInitial/prompt";
import { runPostTurnSharedInitial } from "@/lib/postTurnSharedInitial/run";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import { parseSharedEpisodicSection } from "@/lib/memory/memory-episodic-shared";
import {
  ASSISTANT_TEXT,
  PREVIOUS_ASSISTANT,
  USER_TEXT,
} from "./fixtures/b29-episodic-synthetic-scene";

async function main(): Promise<void> {
  if (process.env.B29_SHARED_INITIAL_LIVE !== "1") {
    throw new Error("STOP_LIVE_FLAG_REQUIRED");
  }
  const benchmark = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim() ?? "";
  const production = process.env.CHEAPER_INFERENCE_API_KEY?.trim() ?? "";
  if (!benchmark) throw new Error("STOP_NO_BENCHMARK_KEY");
  if (benchmark === production) throw new Error("STOP_BENCHMARK_EQUALS_PRODUCTION");
  delete process.env.OPENROUTER_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = benchmark;

  const prev: Record<string, string> = {};
  for (const k of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) prev[k] = "(자리비움)";

  const input: PostTurnSharedInitialInput = {
    mode: "character",
    charName: "볼프강",
    personaName: "렌",
    characterIdentity: "볼프강: 국경 야영지를 지휘하는 중년의 대장. 과묵하고 규정에 충실하다.",
    userPersona: null,
    personaDescription: null,
    personaSpeechExamples: null,
    userMessage: USER_TEXT,
    assistantProse: ASSISTANT_TEXT,
    previousAssistantProse: PREVIOUS_ASSISTANT,
    characterWidget: DEFAULT_STATUS_WIDGET,
    userWidget: null,
    previousCharacterValues: prev,
    previousUserValues: null,
    primaryModelId: BACKGROUND_OPENROUTER_MODEL,
    includeSuggestions: true,
    includeRelationship: true,
    includeEpisodic: true,
    relationshipRegenContext: null,
    activePromises: [],
    episodicCorrectionCandidates: [],
  };

  const responseFormat = buildPostTurnSharedInitialResponseFormat(input);
  const result = await runPostTurnSharedInitial(input);
  const parsed = result.parsed;
  const episodic = parsed?.episodic ?? parseSharedEpisodicSection(null);
  let root: Record<string, unknown> | null = null;
  try {
    root = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    root = null;
  }
  const schemaStatus =
    root && parsed?.jsonParseOk
      ? validatePostTurnSharedInitialStructure(root, input)
      : "not_reached";

  const userRefusalSpan =
    "나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어";
  const facts = episodic.facts;
  const refusalCaptured = facts.some(
    (f) =>
      f.evidence?.source_role === "user" &&
      (f.fact_text.includes("동의하지") || f.evidence.source_quote.includes(userRefusalSpan))
  );

  const usage = result.usage;
  const artifact = {
    scene: "synthetic B26/B29 status-ON; not production chat 804",
    model: BACKGROUND_OPENROUTER_MODEL,
    temperature: 0.4,
    transportOk: result.transportOk,
    httpStatus: result.httpStatus,
    finishReason: result.finishReason,
    errorCode: result.errorCode,
    jsonParseOk: parsed?.jsonParseOk ?? null,
    schemaStatus,
    statusWidgetOk: parsed?.character?.ok ?? null,
    suggestedRepliesOk: parsed?.suggestedRepliesOk ?? null,
    relationshipPresent: parsed?.relationship?.present ?? null,
    relationshipValid: parsed?.relationship?.valid ?? null,
    episodicPresent: episodic.present,
    episodicValid: episodic.valid,
    rawFactCount: episodic.rawFactCount ?? null,
    validFactCount: facts.length,
    refusalCapturedInValidFacts: refusalCaptured,
    facts: facts.map((f) => ({
      subject: f.subject,
      attribute: f.attribute,
      value: f.value,
      evidence_type: f.evidence_type,
      source_role: f.evidence?.source_role,
      source_quote: f.evidence?.source_quote,
      fact_text: f.fact_text,
    })),
    usage: usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          billedUsd: usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null,
        }
      : null,
    responseFormat,
    wireSchema: buildPostTurnSharedInitialJsonSchema(input),
    providerText: result.text,
  };

  mkdirSync("docs/pr-evidence/pr-b29-schema-align", { recursive: true });
  writeFileSync(
    "docs/pr-evidence/pr-b29-schema-align/live-status-on.json",
    JSON.stringify(artifact, null, 2)
  );
  console.log(
    JSON.stringify({
      transportOk: result.transportOk,
      schemaStatus,
      jsonParseOk: parsed?.jsonParseOk,
      statusWidgetOk: parsed?.character?.ok,
      rawFactCount: episodic.rawFactCount,
      validFactCount: facts.length,
      refusalCaptured,
      billedUsd: artifact.usage?.billedUsd,
    })
  );
}

main().catch((e) => {
  console.error((e as Error).message.slice(0, 400));
  process.exitCode = 1;
});
