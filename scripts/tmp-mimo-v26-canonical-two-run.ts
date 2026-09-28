import { performance } from "node:perf_hooks";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { resolveBenchmarkCheaperInferenceApiKey } from "./lib/benchmarkCheaperInferenceCredential";
import {
  RP_MODEL_QUALIFICATION_FIXTURE_VERSION,
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
} from "./lib/rpModelQualificationFixture";

const MODEL = "mimo-v2.6-pro";
const CASE_IDS = new Set(["production_midchat_t1", "false_canon_trap"]);

async function runCase(caseData: ReturnType<typeof buildCanonicalRpQualificationCases>[number], key: string) {
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: MODEL,
    caseData,
    provider: "cheaperinference",
  });
  const built = buildContext(contextInput);

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history,
    modelId: MODEL,
    targetResponseChars: caseData.targetResponseChars,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
      personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
    },
  });

  const requestBody = {
    ...(assembled.requestBody as Record<string, unknown>),
    stream: false,
  };

  const started = performance.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(key),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(180_000),
  });

  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}
  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";

  console.log("BENCH_RESULT " + JSON.stringify({
    fixture_version: RP_MODEL_QUALIFICATION_FIXTURE_VERSION,
    source: CANONICAL_RP_QUALIFICATION_SOURCE,
    model_requested: MODEL,
    model_resolved: typeof json?.model === "string" ? json.model : null,
    case_id: caseData.id,
    runtime_mode: "interactive",
    effective_authoring_delegation: "inactive/default collaborative interactive",
    http_status: res.status,
    finish_reason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    latency_ms: Math.round(performance.now() - started),
    target_response_chars: caseData.targetResponseChars,
    request_reasoning_effort: requestBody.reasoning_effort ?? null,
    request_max_tokens: requestBody.max_tokens ?? null,
    output_chars: [...text].length,
    usage: json?.usage ?? null,
    review_focus: caseData.reviewFocus,
    text,
    error_raw: res.ok ? null : raw.slice(0, 1200),
  }));
}

async function main() {
  const key = resolveBenchmarkCheaperInferenceApiKey();
  if (!key) {
    console.log("BENCH_FATAL missing CHEAPER_INFERENCE_BENCHMARK_API_KEY");
    process.exit(2);
  }

  const selected = buildCanonicalRpQualificationCases().filter((c) => CASE_IDS.has(c.id));
  if (selected.length !== 2) {
    throw new Error("Expected exactly two canonical qualification cases");
  }

  let calls = 0;
  for (const c of selected) {
    calls += 1;
    try {
      await runCase(c, key);
    } catch (error) {
      console.log("BENCH_RESULT " + JSON.stringify({
        fixture_version: RP_MODEL_QUALIFICATION_FIXTURE_VERSION,
        model_requested: MODEL,
        case_id: c.id,
        transport_error: String(error),
      }));
    }
  }

  console.log("BENCH_DONE " + JSON.stringify({ provider_calls: calls }));
}

main().catch((error) => {
  console.error("BENCH_FATAL", error);
  process.exit(1);
});
