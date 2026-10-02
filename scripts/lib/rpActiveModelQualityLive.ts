import crypto from "node:crypto";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveOpenRouterModelId,
} from "@/lib/openRouterConfig";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import { buildContext } from "@/services/contextBuilder";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
  type CanonicalQualificationCase,
  type CanonicalQualificationCaseId,
  type RpQualificationExampleLiteralMode,
} from "./rpModelQualificationFixture";
import { processOpenRouterSupplySseLine } from "./mainRpSupplyLiveQualification";

type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;

export const RP_ACTIVE_MODEL_QUALITY_LIVE_VERSION = 2;
export const RP_ACTIVE_MODEL_QUALITY_LIVE_FLAG = "RP_ACTIVE_MODEL_QUALITY_LIVE";
export const RP_ACTIVE_MODEL_QUALITY_LIVE_TIMEOUT_MS = 120_000;

/**
 * Current active Main-RP picker is the only model owner.
 * Monthly memory-quality evidence uses two bounded cases across every active
 * user-selectable model. A future picker expansion beyond this hard call cap
 * fails before any provider request rather than silently skipping models.
 */
export const RP_ACTIVE_MODEL_QUALITY_MODEL_IDS: readonly SelectedAI[] =
  MAIN_RP_MODEL_IDS;
export const RP_ACTIVE_MODEL_QUALITY_EXCLUDED = Object.freeze([] as const);
export const RP_ACTIVE_MODEL_QUALITY_DEFAULT_CASE_IDS = [
  "memory_current_state_priority",
  "memory_false_shared_event",
] as const satisfies readonly CanonicalQualificationCaseId[];
export const RP_ACTIVE_MODEL_QUALITY_MAX_CALLS = 16;

export type RpActiveModelQualityProbe = {
  modelId: (typeof RP_ACTIVE_MODEL_QUALITY_MODEL_IDS)[number];
  caseId: CanonicalQualificationCaseId;
  targetResponseChars: number;
  reviewFocus: readonly string[];
};

export type RpActiveModelQualityProvider = "cheaperinference" | "openrouter";

export type RpActiveModelQualityTurnResult = {
  modelId: RpActiveModelQualityProbe["modelId"];
  provider: RpActiveModelQualityProvider;
  caseId: CanonicalQualificationCaseId;
  httpStatus: number;
  finishReason: string | null;
  sawDone: boolean;
  text: string;
  visibleChars: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  providerReportedCostUsd: number | null;
  totalSeconds: number;
  requestEvidence: {
    targetResponseChars: number;
    systemPromptSha256: string;
    systemPromptChars: number;
    requestBodySha256: string;
    wireControls: JsonObject;
    provider: RpActiveModelQualityProvider;
    authoringLevel: "NORMAL";
    allowDialogue: true;
    allowMajorActions: true;
    allowInnerPov: false;
    allowIrreversibleFate: false;
    exampleLiteralMode: RpQualificationExampleLiteralMode;
  };
  reviewFocus: readonly string[];
  status: "COMPLETE" | "FAILED";
  error: string | null;
};

export type RpActiveModelQualityLiveReport = {
  version: number;
  generatedAt: string;
  source: typeof CANONICAL_RP_QUALIFICATION_SOURCE;
  modelIds: readonly RpActiveModelQualityProbe["modelId"][];
  excludedModels: typeof RP_ACTIVE_MODEL_QUALITY_EXCLUDED;
  ordinaryInputAuthoringLevel: "NORMAL";
  providerCalls: number;
  maxProviderCalls: number;
  qualityScoreGenerated: false;
  results: RpActiveModelQualityTurnResult[];
  notes: string[];
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function controls(body: JsonObject): JsonObject {
  const keys = [
    "model",
    "max_tokens",
    "temperature",
    "top_p",
    "thinking",
    "reasoning",
    "reasoning_effort",
    "output_config",
    "stream",
  ] as const;
  const out: JsonObject = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}

function modelLabel(modelId: SelectedAI): string {
  return (
    MAIN_RP_USER_SELECTABLE_OPTIONS.find((option) => option.id === modelId)?.label ??
    modelId
  );
}

export function buildRpActiveModelQualityPlan(
  caseIds: readonly CanonicalQualificationCaseId[] = RP_ACTIVE_MODEL_QUALITY_DEFAULT_CASE_IDS,
  modelIds: readonly SelectedAI[] = RP_ACTIVE_MODEL_QUALITY_MODEL_IDS
): RpActiveModelQualityProbe[] {
  const uniqueModelIds = [...new Set(modelIds)];
  for (const modelId of uniqueModelIds) {
    if (!MAIN_RP_MODEL_IDS.includes(modelId)) {
      throw new Error(`Quality model is no longer active Main RP: ${modelId}`);
    }
  }

  const selectedCaseIds = new Set(caseIds);
  const cases = buildCanonicalRpQualificationCases().filter(
    (entry) => selectedCaseIds.has(entry.id)
  );
  if (cases.length !== selectedCaseIds.size) {
    const known = new Set(buildCanonicalRpQualificationCases().map((entry) => entry.id));
    const unknown = [...selectedCaseIds].filter((id) => !known.has(id));
    throw new Error(`Unknown RP quality case id(s): ${unknown.join(", ")}`);
  }
  const plan = uniqueModelIds.flatMap((modelId) =>
    cases.map((caseData) => ({
      modelId,
      caseId: caseData.id,
      targetResponseChars: caseData.targetResponseChars,
      reviewFocus: caseData.reviewFocus,
    }))
  );

  if (plan.length > RP_ACTIVE_MODEL_QUALITY_MAX_CALLS) {
    throw new Error(
      `RP quality plan exceeds provider-call budget: ${plan.length}/${RP_ACTIVE_MODEL_QUALITY_MAX_CALLS}`
    );
  }
  return plan;
}

export function buildRpActiveModelQualityRequest(input: {
  modelId: RpActiveModelQualityProbe["modelId"];
  caseData: CanonicalQualificationCase;
  sessionId: string;
  exampleLiteralMode?: RpQualificationExampleLiteralMode;
}): {
  provider: RpActiveModelQualityProvider;
  url: string;
  body: JsonObject;
  evidence: RpActiveModelQualityTurnResult["requestEvidence"];
} {
  const provider = selectedAIProvider(input.modelId);
  if (provider !== "cheaperinference" && provider !== "openrouter") {
    throw new Error(`Unsupported Main RP quality provider: ${provider}`);
  }
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: input.modelId,
    caseData: input.caseData,
    provider,
    exampleLiteralMode: input.exampleLiteralMode ?? "raw",
  });
  const delegation = contextInput.currentTurnAuthoringDelegation;
  if (
    delegation?.allowDialogue !== true ||
    delegation.allowMajorActions !== true ||
    delegation.allowInnerPov === true ||
    delegation.allowIrreversibleFate === true
  ) {
    throw new Error(
      `Qualification fixture is not NORMAL interactive authoring for ${input.caseData.id}`
    );
  }

  const built = buildContext(contextInput);
  const wireModelId =
    provider === "openrouter"
      ? resolveOpenRouterModelId(input.modelId)
      : input.modelId;
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: wireModelId,
    targetResponseChars: input.caseData.targetResponseChars,
    messageOpts: {
      transportProvider: provider,
      charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
      personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
      sessionId: input.sessionId,
    },
    stream: true,
  });
  const body = {
    ...(wire.requestBody as JsonObject),
    stream: true,
    stream_options: { include_usage: true },
  };

  return {
    provider,
    url:
      provider === "openrouter"
        ? OPENROUTER_CHAT_COMPLETIONS_URL
        : buildCheaperInferenceChatCompletionsUrl({
            promptCacheSession: input.sessionId,
          }),
    body,
    evidence: {
      targetResponseChars: input.caseData.targetResponseChars,
      systemPromptSha256: sha256(built.systemPrompt),
      systemPromptChars: built.systemPrompt.length,
      requestBodySha256: sha256(JSON.stringify(body)),
      wireControls: controls(body),
      provider,
      authoringLevel: "NORMAL",
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: false,
      allowIrreversibleFate: false,
      exampleLiteralMode: input.exampleLiteralMode ?? "raw",
    },
  };
}

type SseState = {
  text: string;
  finishReason: string | null;
  usage: JsonObject | null;
  resolvedModel: string | null;
  generationId: string | null;
  firstDeltaAtMs: number | null;
  sawDone: boolean;
};

function feedSse(
  chunk: string,
  state: SseState,
  buffer: { value: string }
): void {
  buffer.value += chunk;
  const parts = buffer.value.split("\n");
  buffer.value = parts.pop() ?? "";
  for (const line of parts) processOpenRouterSupplySseLine(line, state);
}

function flushSse(
  decoder: TextDecoder,
  state: SseState,
  buffer: { value: string }
): void {
  const tail = decoder.decode();
  if (tail) buffer.value += tail;
  if (buffer.value.trim()) {
    processOpenRouterSupplySseLine(buffer.value, state);
  }
  buffer.value = "";
}

export async function executeRpActiveModelQualityProbe(input: {
  credentials: Record<RpActiveModelQualityProvider, string>;
  probe: RpActiveModelQualityProbe;
  caseData: CanonicalQualificationCase;
  sessionId: string;
  exampleLiteralMode?: RpQualificationExampleLiteralMode;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<RpActiveModelQualityTurnResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const request = buildRpActiveModelQualityRequest({
    modelId: input.probe.modelId,
    caseData: input.caseData,
    sessionId: input.sessionId,
    exampleLiteralMode: input.exampleLiteralMode ?? "raw",
  });
  const state: SseState = {
    text: "",
    finishReason: null,
    usage: null,
    resolvedModel: null,
    generationId: null,
    firstDeltaAtMs: null,
    sawDone: false,
  };

  const started = now();
  let httpStatus = 0;
  let responseHeaders: Headers | null = null;
  let error: string | null = null;

  try {
    const apiKey = input.credentials[request.provider]?.trim();
    if (!apiKey) {
      throw new Error(`missing_${request.provider}_benchmark_credential`);
    }
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        ...(request.provider === "openrouter"
          ? buildOpenRouterHeaders(apiKey)
          : buildCheaperInferenceHeaders(apiKey)),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(RP_ACTIVE_MODEL_QUALITY_LIVE_TIMEOUT_MS),
    });
    httpStatus = response.status;
    responseHeaders = response.headers;
    if (!response.ok) {
      error = (await response.text()).slice(0, 2_000);
    } else {
      const reader = response.body?.getReader();
      if (!reader) {
        error = "missing_stream_body";
      } else {
        const decoder = new TextDecoder();
        const buffer = { value: "" };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          feedSse(decoder.decode(value, { stream: true }), state, buffer);
        }
        flushSse(decoder, state, buffer);
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const usage = parseCompatibleUsage({
    usage: state.usage,
    headers: responseHeaders,
    transportProvider: request.provider,
  });
  const totalSeconds = Math.max(0, (now() - started) / 1000);
  const complete =
    httpStatus === 200 &&
    error == null &&
    state.sawDone &&
    state.finishReason != null &&
    state.text.trim().length > 0;

  return {
    modelId: input.probe.modelId,
    provider: request.provider,
    caseId: input.probe.caseId,
    httpStatus,
    finishReason: state.finishReason,
    sawDone: state.sawDone,
    text: state.text,
    visibleChars: state.text.length,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    providerReportedCostUsd:
      usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null,
    totalSeconds,
    requestEvidence: request.evidence,
    reviewFocus: input.probe.reviewFocus,
    status: complete ? "COMPLETE" : "FAILED",
    error,
  };
}

export async function runRpActiveModelQualityLive(input: {
  credentials: Record<RpActiveModelQualityProvider, string>;
  runId: string;
  caseIds?: readonly CanonicalQualificationCaseId[];
  modelIds?: readonly SelectedAI[];
  fetchImpl?: FetchLike;
}): Promise<RpActiveModelQualityLiveReport> {
  const cases = new Map(
    buildCanonicalRpQualificationCases().map((entry) => [entry.id, entry])
  );
  const selectedModelIds = input.modelIds ?? RP_ACTIVE_MODEL_QUALITY_MODEL_IDS;
  const plan = buildRpActiveModelQualityPlan(input.caseIds, selectedModelIds);
  const results: RpActiveModelQualityTurnResult[] = [];

  for (const probe of plan) {
    const caseData = cases.get(probe.caseId);
    if (!caseData) throw new Error(`Missing qualification case: ${probe.caseId}`);
    const sessionId = [
      "rp-quality",
      input.runId,
      probe.modelId.replace(/[^a-zA-Z0-9._-]+/g, "-"),
    ]
      .join("-")
      .slice(0, 256);

    // Exactly one generation attempt per planned model/case. No retry/fallback.
    results.push(
      await executeRpActiveModelQualityProbe({
        credentials: input.credentials,
        probe,
        caseData,
        sessionId,
        fetchImpl: input.fetchImpl,
      })
    );
  }

  if (results.length > RP_ACTIVE_MODEL_QUALITY_MAX_CALLS) {
    throw new Error("RP quality runner exceeded provider-call budget");
  }

  return {
    version: RP_ACTIVE_MODEL_QUALITY_LIVE_VERSION,
    generatedAt: new Date().toISOString(),
    source: CANONICAL_RP_QUALIFICATION_SOURCE,
    modelIds: selectedModelIds,
    excludedModels: RP_ACTIVE_MODEL_QUALITY_EXCLUDED,
    ordinaryInputAuthoringLevel: "NORMAL",
    providerCalls: results.length,
    maxProviderCalls: RP_ACTIVE_MODEL_QUALITY_MAX_CALLS,
    qualityScoreGenerated: false,
    results,
    notes: [
      "Raw outputs are evidence for GPT/user review; the runner does not score or rank models.",
      input.modelIds
        ? "This one-shot PR evidence run uses an explicit subset of current Main-RP models; monthly/default runs still derive from the full active registry."
        : "The model set is derived directly from the current Main-RP user-selectable registry; retired/non-chat models are not probed.",
      "The default monthly evidence is bounded to two memory-continuity cases across all active models.",
      "All cases use the frozen deployed 조태형(라이크)+관리자 페르소나 렌 fixture with current-main prompt/wire assembly.",
      "Ordinary interactive user-authoring is current product default NORMAL: dialogue/actions allowed, private inner POV and irreversible user fate not allowed.",
      "Each probe follows the canonical Main-RP registry provider. One provider attempt per model/case; no retry/fallback generation.",
    ],
  };
}

export function renderRpActiveModelQualityMarkdown(
  report: RpActiveModelQualityLiveReport
): string {
  const lines = [
    "# Active Main RP — Human Quality Review Evidence",
    "",
    `- models: ${report.modelIds.map(modelLabel).join(", ")}`,
    `- provider calls: **${report.providerCalls}/${report.maxProviderCalls}**`,
    `- ordinary input authoring: **${report.ordinaryInputAuthoringLevel}**`,
    "- automatic score/ranking: **none**",
    "",
    "## Excluded this round",
    "",
    ...report.excludedModels.map(
      (row) => `- ${modelLabel(row.modelId)}: ${row.reason}`
    ),
    "",
    "## Runtime evidence",
    "",
    "| Model | Provider | Case | Status | HTTP | chars | prompt tok | output tok | reasoning tok | cache read | cost USD | seconds |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${modelLabel(result.modelId)} | ${result.provider} | ${result.caseId} | ${result.status} | ${result.httpStatus} | ${result.visibleChars} | ${result.promptTokens} | ${result.completionTokens} | ${result.reasoningTokens} | ${result.cacheReadTokens} | ${result.providerReportedCostUsd ?? "n/a"} | ${result.totalSeconds.toFixed(2)} |`
    );
  }

  lines.push("", "## Review boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
