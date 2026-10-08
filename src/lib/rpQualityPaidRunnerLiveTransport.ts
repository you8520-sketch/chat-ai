/**
 * Isolated live transport for the paid runner. Reuses production header,
 * endpoint, and SSE decoder owners. Does not import the PRECALL egress guard.
 * Live vs simulated is an explicit contract (`simulation: true`), not inferred
 * from `fetchImpl` presence. Simulated transports require an injected fixture
 * fetch and never fall back to global `fetch`.
 */
import { buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import {
  buildOpenRouterHeaders,
} from "@/lib/openRouterConfig";
import { readCompatibleCompletionProviderRequestId } from "@/lib/openRouterCompletion";
import {
  decodeOpenAiCompatibleSseResponse,
  isOpenAiCompatibleSseContentType,
  reconstructOpenAiCompatibleCompletionBody,
} from "@/lib/openAiCompatibleSseDecoder";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import {
  experimentSecretUsesProductionKey,
  paidRunnerEndpointMatchesCanonicalOwner,
  paidRunnerRequestBodyFingerprint,
  type PaidRunnerTransport,
  type PaidRunnerTransportResult,
} from "@/lib/rpQualityPaidRunner";
import { MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";

export const RP_QUALITY_PAID_OPENROUTER_KEY_ENV = "RP_QUALITY_PAID_OPENROUTER_KEY";
export const RP_QUALITY_PAID_CHEAPERINFERENCE_KEY_ENV = "RP_QUALITY_PAID_CHEAPERINFERENCE_KEY";
export const RP_QUALITY_PAID_LIVE_EXECUTE_ENV = "RP_QUALITY_PAID_LIVE_EXECUTE";
export const PAID_RUNNER_LIVE_TIMEOUT_MS = 90_000;

export type PaidRunnerLiveTransportOptions = {
  openRouterKey: string;
  cheaperInferenceKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  liveExecuteApproved?: boolean;
  /** Test-only simulated contract. Requires an injected fixture fetch; never uses global fetch. */
  simulation?: true;
};

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function readGenerationId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function assertPaidRunnerExperimentInferenceKeys(keys: {
  openRouterKey: string;
  cheaperInferenceKey: string;
}): void {
  if (!keys.openRouterKey.trim() || !keys.cheaperInferenceKey.trim()) {
    throw new Error("MISSING_INFERENCE_KEY");
  }
  if (
    experimentSecretUsesProductionKey(keys.openRouterKey) ||
    experimentSecretUsesProductionKey(keys.cheaperInferenceKey)
  ) {
    throw new Error("PRODUCTION_KEY_FALLBACK_FORBIDDEN");
  }
}

function readOpenRouterGenerationIdHeader(headers: Headers): string | null {
  const raw = headers.get("x-generation-id");
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function createIsolatedPaidRunnerLiveTransport(
  options: PaidRunnerLiveTransportOptions
): PaidRunnerTransport {
  assertPaidRunnerExperimentInferenceKeys(options);
  const simulated = options.simulation === true;
  if (simulated) {
    if (options.fetchImpl == null) {
      throw new Error("SIMULATED_TRANSPORT_REQUIRES_FETCH_IMPL");
    }
  } else if (options.liveExecuteApproved !== true) {
    throw new Error("LIVE_EXECUTE_NOT_APPROVED");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PAID_RUNNER_LIVE_TIMEOUT_MS;
  return {
    kind: "live",
    realNetwork: !simulated,
    simulation: simulated,
    async post(input): Promise<PaidRunnerTransportResult> {
      if (!paidRunnerEndpointMatchesCanonicalOwner(input.provider, input.endpoint)) {
        return {
          ok: false,
          kind: "malformed",
          httpStatus: null,
          text: "",
          headers: {},
          body: { error: "endpoint_mismatch" },
        };
      }
      if ("max_tokens" in input.body || "max_completion_tokens" in input.body) {
        return {
          ok: false,
          kind: "malformed",
          httpStatus: null,
          text: "",
          headers: {},
          body: { error: "max_tokens_present" },
        };
      }
      paidRunnerRequestBodyFingerprint(input.body);
      const headers =
        input.provider === "openrouter"
          ? buildOpenRouterHeaders(options.openRouterKey)
          : buildCheaperInferenceHeaders(options.cheaperInferenceKey);
      let response: Response;
      try {
        response = await fetchImpl(input.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(input.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind =
          /timeout|aborted/i.test(message)
            ? "timeout"
            : /reset|ECONNRESET/i.test(message)
              ? "connection_reset"
              : "throw";
        return { ok: false, kind, httpStatus: null, text: "", headers: {}, body: {} };
      }
      const responseHeaders = headersToRecord(response.headers);
      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          kind: "http",
          httpStatus: response.status,
          text: "",
          headers: responseHeaders,
          body: {},
        };
      }
      const contentType = response.headers.get("content-type");
      if (!isOpenAiCompatibleSseContentType(contentType)) {
        return {
          ok: false,
          kind: "malformed",
          httpStatus: response.status,
          text: "",
          headers: responseHeaders,
          body: { error: "content_type_mismatch", contentType },
          contentType: contentType ?? undefined,
        };
      }
      let evidence;
      try {
        evidence = await decodeOpenAiCompatibleSseResponse(response);
      } catch {
        return {
          ok: false,
          kind: "throw",
          httpStatus: response.status,
          text: "",
          headers: responseHeaders,
          body: {},
        };
      }
      if (evidence.schemaError === "eof before terminal SSE metadata/DONE") {
        return {
          ok: false,
          kind: "partial_stream",
          httpStatus: response.status,
          text: evidence.text,
          headers: responseHeaders,
          body: reconstructOpenAiCompatibleCompletionBody(evidence),
        };
      }
      if (evidence.schemaError) {
        return {
          ok: false,
          kind: "malformed",
          httpStatus: response.status,
          text: evidence.text,
          headers: responseHeaders,
          body: reconstructOpenAiCompatibleCompletionBody(evidence),
        };
      }
      const jsonGenerationId = evidence.generationId || readGenerationId(evidence.lastJson);
      const headerGenerationId = readOpenRouterGenerationIdHeader(new Headers(responseHeaders));
      if (
        input.provider === "openrouter" &&
        jsonGenerationId &&
        headerGenerationId &&
        jsonGenerationId !== headerGenerationId
      ) {
        return {
          ok: false,
          kind: "malformed",
          httpStatus: response.status,
          text: evidence.text,
          headers: responseHeaders,
          body: { error: "generation_id_header_mismatch" },
        };
      }
      const generationId =
        input.provider === "openrouter" ? jsonGenerationId || headerGenerationId : null;
      const body = {
        ...reconstructOpenAiCompatibleCompletionBody(evidence),
        id: generationId,
      };
      const headerBag = new Headers(response.headers);
      const requestId =
        readCompatibleCompletionProviderRequestId({
          provider: input.provider,
          headers: headerBag,
          body: {
            ...body,
            cheaper_inference: evidence.lastCheaperInference,
          },
        }) ?? "";
      const usage = parseCompatibleUsage({
        usage: evidence.lastUsage,
        cheaperInference: evidence.lastCheaperInference,
        headers: headerBag,
        transportProvider: input.provider,
      });
      return {
        ok: true,
        httpStatus: response.status,
        text: evidence.text,
        finishReason: evidence.finishReason ?? "stop",
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          reasoningTokens: usage.reasoningTokens,
          billedUsd: null,
        },
        requestId,
        headers: responseHeaders,
        body,
        generationId,
        cheaperInference: evidence.lastCheaperInference,
        doneObserved: evidence.doneObserved,
        streamCompleted: evidence.streamCompleted,
        contentType: contentType ?? undefined,
      };
    },
  };
}

export function readPaidRunnerLiveInferenceKeys(
  env: NodeJS.ProcessEnv = process.env
): { openRouterKey: string; cheaperInferenceKey: string } {
  return {
    openRouterKey: env[RP_QUALITY_PAID_OPENROUTER_KEY_ENV]?.trim() ?? "",
    cheaperInferenceKey: env[RP_QUALITY_PAID_CHEAPERINFERENCE_KEY_ENV]?.trim() ?? "",
  };
}

export function paidRunnerLiveExecuteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RP_QUALITY_PAID_LIVE_EXECUTE_ENV] === "1";
}

export function livePaidRunnerUsesCanonicalModels(ids: readonly SelectedAI[]): boolean {
  return JSON.stringify([...ids]) === JSON.stringify([...MAIN_RP_MODEL_IDS]);
}
