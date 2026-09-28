import crypto from "node:crypto";

import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import { buildContext } from "@/services/contextBuilder";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
  type CanonicalQualificationCase,
  type CanonicalQualificationCaseId,
} from "./rpModelQualificationFixture";
import { processOpenRouterSupplySseLine } from "./mainRpSupplyLiveQualification";

type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;

export const RP_ACTIVE_MODEL_QUALITY_LIVE_VERSION = 1;
export const RP_ACTIVE_MODEL_QUALITY_LIVE_FLAG = "RP_ACTIVE_MODEL_QUALITY_LIVE";
export const RP_ACTIVE_MODEL_QUALITY_LIVE_TIMEOUT_MS = 120_000;
export const RP_ACTIVE_MODEL_QUALITY_MAX_CALLS = 12;

/**
 * Deliberately bounded to the models the user wants reviewed in this round.
 * Terra and Gemini 3.1 remain valid Main RP registry entries, but are excluded
 * from this quality run because the user plans to replace them with newer models.
 */
export const RP_ACTIVE_MODEL_QUALITY_MODEL_IDS = [
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
] as const satisfies readonly SelectedAI[];

export const RP_ACTIVE_MODEL_QUALITY_EXCLUDED = Object.freeze([
  {
    modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    reason: "user_requested_skip_pending_replacement",
  },
  {
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    reason: "user_requested_skip_pending_new_model",
  },
]);

export type RpActiveModelQualityProbe = {
  modelId: (typeof RP_ACTIVE_MODEL_QUALITY_MODEL_IDS)[number];
  caseId: CanonicalQualificationCaseId;
  targetResponseChars: number;
  reviewFocus: readonly string[];
};

export type RpActiveModelQualityTurnResult = {
  modelId: RpActiveModelQualityProbe["modelId"];
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
    authoringLevel: "NORMAL";
    allowDialogue: true;
    allowMajorActions: true;
    allowInnerPov: false;
    allowIrreversibleFate: false;
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
  caseIds?: readonly CanonicalQualificationCaseId[]
): RpActiveModelQualityProbe[] {
  for (const modelId of RP_ACTIVE_MODEL_QUALITY_MODEL_IDS) {
    if (!MAIN_RP_MODEL_IDS.includes(modelId)) {
      throw new Error(`Quality model is no longer active Main RP: ${modelId}`);
    }
  }

  const selectedCaseIds = caseIds ? new Set(caseIds) : null;
  const cases = buildCanonicalRpQualificationCases().filter(
    (entry) => !selectedCaseIds || selectedCaseIds.has(entry.id)
  );
  if (caseIds && cases.length !== selectedCaseIds!.size) {
    const known = new Set(buildCanonicalRpQualificationCases().map((entry) => entry.id));
    const unknown = [...selectedCaseIds!].filter((id) => !known.has(id));
    throw new Error(`Unknown RP quality case id(s): ${unknown.join(", ")}`);
  }
  const plan = RP_ACTIVE_MODEL_QUALITY_MODEL_IDS.flatMap((modelId) =>
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
}): {
  url: string;
  body: JsonObject;
  evidence: RpActiveModelQualityTurnResult["requestEvidence"];
} {
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: input.modelId,
    caseData: input.caseData,
    provider: "cheaperinference",
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
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: input.modelId,
    targetResponseChars: input.caseData.targetResponseChars,
    messageOpts: {
      transportProvider: "cheaperinference",
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
    url: buildCheaperInferenceChatCompletionsUrl({
      promptCacheSession: input.sessionId,
    }),
    body,
    evidence: {
      targetResponseChars: input.caseData.targetResponseChars,
      systemPromptSha256: sha256(built.systemPrompt),
      systemPromptChars: built.systemPrompt.length,
      requestBodySha256: sha256(JSON.stringify(body)),
      wireControls: controls(body),
      authoringLevel: "NORMAL",
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: false,
      allowIrreversibleFate: false,
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
  apiKey: string;
  probe: RpActiveModelQualityProbe;
  caseData: CanonicalQualificationCase;
  sessionId: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<RpActiveModelQualityTurnResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const request = buildRpActiveModelQualityRequest({
    modelId: input.probe.modelId,
    caseData: input.caseData,
    sessionId: input.sessionId,
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
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        ...buildCheaperInferenceHeaders(input.apiKey),
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
    transportProvider: "cheaperinference",
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
  apiKey: string;
  runId: string;
  caseIds?: readonly CanonicalQualificationCaseId[];
  fetchImpl?: FetchLike;
}): Promise<RpActiveModelQualityLiveReport> {
  const cases = new Map(
    buildCanonicalRpQualificationCases().map((entry) => [entry.id, entry])
  );
  const plan = buildRpActiveModelQualityPlan(input.caseIds);
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
        apiKey: input.apiKey,
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
    modelIds: RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
    excludedModels: RP_ACTIVE_MODEL_QUALITY_EXCLUDED,
    ordinaryInputAuthoringLevel: "NORMAL",
    providerCalls: results.length,
    maxProviderCalls: RP_ACTIVE_MODEL_QUALITY_MAX_CALLS,
    qualityScoreGenerated: false,
    results,
    notes: [
      "Raw outputs are evidence for GPT/user review; the runner does not score or rank models.",
      "Terra 5.6 and Gemini 3.1 Pro Preview are intentionally excluded from this round at user request.",
      "All cases use the frozen deployed 조태형(라이크)+관리자 페르소나 렌 fixture with current-main prompt/wire assembly.",
      "Ordinary interactive user-authoring is current product default NORMAL: dialogue/actions allowed, private inner POV and irreversible user fate not allowed.",
      "One provider attempt per model/case; no retry or fallback generation.",
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
    "| Model | Case | Status | HTTP | chars | prompt tok | output tok | reasoning tok | cache read | cost USD | seconds |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${modelLabel(result.modelId)} | ${result.caseId} | ${result.status} | ${result.httpStatus} | ${result.visibleChars} | ${result.promptTokens} | ${result.completionTokens} | ${result.reasoningTokens} | ${result.cacheReadTokens} | ${result.providerReportedCostUsd ?? "n/a"} | ${result.totalSeconds.toFixed(2)} |`
    );
  }

  lines.push("", "## Review boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
