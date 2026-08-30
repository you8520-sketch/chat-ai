import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
  isGeminiFlashOpenRouterModel,
} from "@/lib/chatModels";
import { OPENROUTER_RP_REASONING_GEMINI_FLASH } from "@/lib/openRouterClient";
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

export const CHEAPER_INFERENCE_HEADERS_DEADLINE_MS = 8_000;
export const CHEAPER_INFERENCE_FIRST_VISIBLE_DEADLINE_MS = 12_000;
export const OPENROUTER_FIRST_VISIBLE_DEADLINE_MS = 15_000;
export const BACKGROUND_FLASH_COMPLETION_DEADLINE_MS = 20_000;
export const MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_DEEPSEEK_TURN = 2;
export const MAX_PROVIDER_ATTEMPTS_PER_BACKGROUND_TASK = 2;

export const BACKGROUND_PRIMARY_COMPLETION_MS = {
  short: 20_000,
  trpgReply: 15_000,
  longForm: 45_000,
  sandboxBlueprint: 75_000,
} as const;

export const BACKGROUND_BACKUP_COMPLETION_MS = {
  short: 30_000,
  trpgReply: 25_000,
  longForm: 45_000,
  sandboxBlueprint: 60_000,
} as const;

/** Canonical transport request kind for sandbox Blueprint primary generation only. */
export const TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND = "trpg-sandbox-blueprint";

export const DEEPSEEK_TRANSIENT_NETWORK_CLASSES = [
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "socket hang up",
  "fetch failed",
  "EAI_AGAIN",
  "ENOTFOUND",
] as const;

export const DEEPSEEK_TRANSIENT_HTTP_STATUSES = [500, 502, 503, 504] as const;

export const OPENROUTER_DEEPSEEK_TRUE_OFF_REASONING = {
  effort: "none",
  exclude: true,
} as const;

export type DeepSeekLogicalModel = "pro" | "flash";
export type DeepSeekRouteKind =
  | "adult_handoff"
  | "native_pro"
  | "native_flash"
  | "background_flash";
export type DeepSeekFailoverTrigger =
  | "error"
  | "headers_timeout"
  | "first_visible_timeout"
  | "body_timeout"
  | null;
export type DeepSeekProviderId = "cheaperinference" | "openrouter";

export type DeepSeekFailoverTelemetry = {
  logical_model: string;
  route_kind: DeepSeekRouteKind;
  primary_provider: "cheaperinference";
  backup_provider: "openrouter";
  primary_failure_class: string | null;
  primary_http_status: number | null;
  primary_headers_ms: number | null;
  primary_first_visible_ms: number | null;
  failover_trigger: DeepSeekFailoverTrigger;
  backup_headers_ms: number | null;
  backup_first_visible_ms: number | null;
  backup_success: boolean;
  provider_attempt_count: number;
};

export type DeepSeekProviderTransport = {
  provider: DeepSeekProviderId;
  endpoint: string;
  headers: Record<string, string>;
};

export type DeepSeekAssembledRequest = {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export type DeepSeekFailoverDeadlines = {
  headersMs?: number;
  firstVisibleMs?: number;
  backupFirstVisibleMs?: number;
  completionMs?: number;
  backupCompletionMs?: number;
};

export type DeepSeekPhysicalAttemptLifecycle = {
  physicalAttemptOrdinal: number;
  provider: DeepSeekProviderId;
  model: string;
  success: boolean;
  httpStatus: number | null;
};

export type DeepSeekFailoverHooks = {
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onTelemetry?: (telemetry: DeepSeekFailoverTelemetry) => void;
  onPhysicalAttemptStart?: (
    info: Pick<DeepSeekPhysicalAttemptLifecycle, "physicalAttemptOrdinal" | "provider" | "model">
  ) => void;
  onPhysicalAttemptFinish?: (info: DeepSeekPhysicalAttemptLifecycle) => void;
};

export class DeepSeekProviderFailoverError extends Error {
  readonly retryable: boolean;
  readonly providerAttemptCount: number;
  readonly primaryFailureClass: string | null;
  readonly primaryHttpStatus: number | null;
  readonly telemetry: DeepSeekFailoverTelemetry;

  constructor(opts: {
    message: string;
    retryable: boolean;
    telemetry: DeepSeekFailoverTelemetry;
  }) {
    super(opts.message);
    this.name = "DeepSeekProviderFailoverError";
    this.retryable = opts.retryable;
    this.providerAttemptCount = opts.telemetry.provider_attempt_count;
    this.primaryFailureClass = opts.telemetry.primary_failure_class;
    this.primaryHttpStatus = opts.telemetry.primary_http_status;
    this.telemetry = opts.telemetry;
  }
}

export class DeepSeekDeterministicProviderError extends Error {
  readonly httpStatus: number | null;
  readonly failureClass: string;
  readonly failover = false as const;

  constructor(opts: {
    message: string;
    httpStatus?: number | null;
    failureClass: string;
  }) {
    super(opts.message);
    this.name = "DeepSeekDeterministicProviderError";
    this.httpStatus = opts.httpStatus ?? null;
    this.failureClass = opts.failureClass;
  }
}

const DETERMINISTIC_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);
const FAILOVER_HTTP_STATUSES = new Set<number>(DEEPSEEK_TRANSIENT_HTTP_STATUSES);
const SOCKET_ERROR_RE =
  /UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed/i;

class DeepSeekBodyDeliveryError extends Error {
  readonly trigger: "body_timeout" | "error";
  readonly httpStatus: number | null;

  constructor(opts: {
    message: string;
    trigger: "body_timeout" | "error";
    httpStatus: number | null;
  }) {
    super(opts.message);
    this.name =
      opts.trigger === "body_timeout" ? "TimeoutError" : "DeepSeekBodyDeliveryError";
    this.trigger = opts.trigger;
    this.httpStatus = opts.httpStatus;
  }
}

export function isDeepSeekPrimaryCheaperInferenceModel(modelId: string): boolean {
  return (
    isCheaperInferenceDeepSeekV4ProModel(modelId) ||
    isCheaperInferenceDeepSeekV4FlashModel(modelId)
  );
}

export function resolveDeepSeekLogicalModel(
  modelId: string
): DeepSeekLogicalModel | null {
  const id = modelId.trim().toLowerCase();
  if (
    isCheaperInferenceDeepSeekV4ProModel(id) ||
    id === OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL
  ) {
    return "pro";
  }
  if (
    isCheaperInferenceDeepSeekV4FlashModel(id) ||
    id === OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL
  ) {
    return "flash";
  }
  return null;
}

export function resolveDeepSeekPrimaryModelId(
  logical: DeepSeekLogicalModel
): string {
  return logical === "pro"
    ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    : CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
}

export function resolveDeepSeekBackupModelId(
  logical: DeepSeekLogicalModel
): string {
  return logical === "pro"
    ? OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL
    : OPENROUTER_GEMINI_31_FLASH_MODEL;
}

export function resolveDeepSeekFailoverRouteKind(input: {
  modelId: string;
  adultHandoff?: boolean;
  background?: boolean;
}): DeepSeekRouteKind | null {
  const logical = resolveDeepSeekLogicalModel(input.modelId);
  if (!logical) return null;
  if (input.background) {
    return logical === "flash" ? "background_flash" : null;
  }
  if (input.adultHandoff && logical === "pro") return "adult_handoff";
  return logical === "pro" ? "native_pro" : "native_flash";
}

export function adaptOpenRouterDeepSeekBackupBody(
  assembledBody: Record<string, unknown>,
  backupModelId: string
): Record<string, unknown> {
  const next = { ...assembledBody };
  next.model = backupModelId;
  delete next.thinking;
  delete next.reasoning_effort;
  delete next.enable_thinking;
  delete next.session_id;
  if (isGeminiFlashOpenRouterModel(backupModelId)) {
    next.reasoning = { ...OPENROUTER_RP_REASONING_GEMINI_FLASH };
  } else {
    next.reasoning = { ...OPENROUTER_DEEPSEEK_TRUE_OFF_REASONING };
  }
  next.include_reasoning = false;
  return next;
}

export function extractVisibleAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

export function extractVisibleAssistantDeltaFromSseJson(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const choice = (
    json as {
      choices?: Array<{
        delta?: {
          content?: unknown;
          text?: unknown;
          reasoning?: unknown;
          reasoning_content?: unknown;
        };
        message?: { content?: unknown };
        text?: unknown;
      }>;
    }
  ).choices?.[0];
  if (!choice) return "";
  const fromDeltaContent = extractVisibleAssistantText(choice.delta?.content);
  if (fromDeltaContent) return fromDeltaContent;
  if (typeof choice.delta?.text === "string" && choice.delta.text) {
    return choice.delta.text;
  }
  const fromMessage = extractVisibleAssistantText(choice.message?.content);
  if (fromMessage) return fromMessage;
  if (typeof choice.text === "string" && choice.text) return choice.text;
  return "";
}

export function classifyDeepSeekProviderFailure(input: {
  httpStatus?: number | null;
  error?: unknown;
  trigger?: Exclude<DeepSeekFailoverTrigger, null>;
}): {
  failover: boolean;
  failureClass: string;
  httpStatus: number | null;
} {
  const status =
    typeof input.httpStatus === "number" && Number.isFinite(input.httpStatus)
      ? input.httpStatus
      : extractHttpStatus(input.error);
  if (status != null && DETERMINISTIC_HTTP_STATUSES.has(status)) {
    return {
      failover: false,
      failureClass: `http_${status}`,
      httpStatus: status,
    };
  }
  if (status != null && FAILOVER_HTTP_STATUSES.has(status)) {
    return {
      failover: true,
      failureClass: `http_${status}`,
      httpStatus: status,
    };
  }
  if (status != null && status !== 200) {
    return {
      failover: false,
      failureClass: `http_${status}`,
      httpStatus: status,
    };
  }
  if (input.trigger === "headers_timeout") {
    return {
      failover: true,
      failureClass: "headers_timeout",
      httpStatus: status,
    };
  }
  if (input.trigger === "first_visible_timeout") {
    return {
      failover: true,
      failureClass: "first_visible_timeout",
      httpStatus: status,
    };
  }
  if (input.trigger === "body_timeout") {
    return {
      failover: true,
      failureClass: "body_timeout",
      httpStatus: status,
    };
  }

  const msg = errorMessage(input.error);
  if (SOCKET_ERROR_RE.test(msg)) {
    return {
      failover: true,
      failureClass: classifySocketFailure(msg),
      httpStatus: status,
    };
  }
  if (/AbortError|TimeoutError|aborted due to timeout|deadline exceeded/i.test(msg)) {
    return {
      failover: true,
      failureClass: "timeout",
      httpStatus: status,
    };
  }
  return {
    failover: false,
    failureClass: status != null ? `http_${status}` : "deterministic",
    httpStatus: status,
  };
}

export function resolveBackgroundFlashProviderDeadlines(opts: {
  requestKind?: string;
  existingTimeoutMs?: number;
}): { primaryCompletionMs: number; backupCompletionMs: number } {
  const kind = opts.requestKind ?? "";
  const isSandboxBlueprint = kind === TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND;
  const isLongForm =
    !isSandboxBlueprint &&
    /html-visual-card|background-html|scenario-draft|trpg-scenario|director|background-memory-extract/i.test(
      kind
    );
  const isTrpgReply = /trpg-reply-suggestion|reply-suggestions/i.test(kind);
  const primaryPolicy = isSandboxBlueprint
    ? BACKGROUND_PRIMARY_COMPLETION_MS.sandboxBlueprint
    : isLongForm
      ? BACKGROUND_PRIMARY_COMPLETION_MS.longForm
      : isTrpgReply
        ? BACKGROUND_PRIMARY_COMPLETION_MS.trpgReply
        : BACKGROUND_PRIMARY_COMPLETION_MS.short;
  const backupPolicy = isSandboxBlueprint
    ? BACKGROUND_BACKUP_COMPLETION_MS.sandboxBlueprint
    : isLongForm
      ? BACKGROUND_BACKUP_COMPLETION_MS.longForm
      : isTrpgReply
        ? BACKGROUND_BACKUP_COMPLETION_MS.trpgReply
        : BACKGROUND_BACKUP_COMPLETION_MS.short;
  const existing = opts.existingTimeoutMs;
  const cap =
    existing != null && Number.isFinite(existing) && existing > 0
      ? existing
      : undefined;
  return {
    primaryCompletionMs: cap != null ? Math.min(cap, primaryPolicy) : primaryPolicy,
    backupCompletionMs: cap != null ? Math.min(cap, backupPolicy) : backupPolicy,
  };
}

export function createDeepSeekLogicalTurnLedger() {
  const state = {
    logicalUserTurn: 1,
    visibleAssistantRows: 0,
    visibleAssistantResponses: 0,
    billingDeductions: 0,
    memoryCommits: 0,
    summaryTurnIncrements: 0,
    statusWidgetCommits: 0,
  };
  const bump = (key: keyof typeof state, max: number) => {
    state[key] += 1;
    if (state[key] > max) {
      throw new Error(`[deepseek-failover] ${key} exceeded ${max}`);
    }
  };
  return {
    state,
    commitVisibleAssistant() {
      bump("visibleAssistantRows", 1);
      bump("visibleAssistantResponses", 1);
    },
    commitBilling() {
      bump("billingDeductions", 1);
    },
    commitMemory() {
      bump("memoryCommits", 1);
    },
    commitSummaryTurn() {
      bump("summaryTurnIncrements", 1);
    },
    commitStatusWidget() {
      bump("statusWidgetCommits", 1);
    },
  };
}

export function resolveDeepSeekPrimaryTransport(): DeepSeekProviderTransport {
  return {
    provider: "cheaperinference",
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
  };
}

export function resolveDeepSeekBackupTransport(): DeepSeekProviderTransport | null {
  try {
    return {
      provider: "openrouter",
      endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
      headers: buildOpenRouterHeaders(resolveOpenRouterApiKey()),
    };
  } catch {
    return null;
  }
}

export function logDeepSeekFailoverTelemetry(
  telemetry: DeepSeekFailoverTelemetry
): void {
  console.info("[deepseek-provider-failover]", {
    logical_model: telemetry.logical_model,
    route_kind: telemetry.route_kind,
    primary_provider: telemetry.primary_provider,
    backup_provider: telemetry.backup_provider,
    primary_failure_class: telemetry.primary_failure_class,
    primary_http_status: telemetry.primary_http_status,
    primary_headers_ms: telemetry.primary_headers_ms,
    primary_first_visible_ms: telemetry.primary_first_visible_ms,
    failover_trigger: telemetry.failover_trigger,
    backup_headers_ms: telemetry.backup_headers_ms,
    backup_first_visible_ms: telemetry.backup_first_visible_ms,
    backup_success: telemetry.backup_success,
    provider_attempt_count: telemetry.provider_attempt_count,
  });
}

export async function executeDeepSeekWithProviderFailover(opts: {
  routeKind: DeepSeekRouteKind;
  logicalModel: DeepSeekLogicalModel;
  primary: DeepSeekAssembledRequest;
  backupBody: Record<string, unknown>;
  stream: boolean;
  deadlines?: DeepSeekFailoverDeadlines;
  hooks?: DeepSeekFailoverHooks;
}): Promise<{
  response: Response;
  telemetry: DeepSeekFailoverTelemetry;
  usedProvider: DeepSeekProviderId;
}> {
  const logicalModelId = resolveDeepSeekPrimaryModelId(opts.logicalModel);
  const telemetry: DeepSeekFailoverTelemetry = {
    logical_model: logicalModelId,
    route_kind: opts.routeKind,
    primary_provider: "cheaperinference",
    backup_provider: "openrouter",
    primary_failure_class: null,
    primary_http_status: null,
    primary_headers_ms: null,
    primary_first_visible_ms: null,
    failover_trigger: null,
    backup_headers_ms: null,
    backup_first_visible_ms: null,
    backup_success: false,
    provider_attempt_count: 1,
  };
  const fetchFn = opts.hooks?.fetchFn ?? globalThis.fetch.bind(globalThis);
  const now = opts.hooks?.now ?? Date.now;
  const headersDeadline =
    opts.deadlines?.headersMs ?? CHEAPER_INFERENCE_HEADERS_DEADLINE_MS;
  const firstVisibleDeadline =
    opts.deadlines?.firstVisibleMs ?? CHEAPER_INFERENCE_FIRST_VISIBLE_DEADLINE_MS;
  const backupFirstVisibleDeadline =
    opts.deadlines?.backupFirstVisibleMs ?? OPENROUTER_FIRST_VISIBLE_DEADLINE_MS;
  const completionDeadline = opts.deadlines?.completionMs;
  const backupCompletionDeadline =
    opts.deadlines?.backupCompletionMs ?? completionDeadline;

  const finish = (
    response: Response,
    usedProvider: DeepSeekProviderId
  ): {
    response: Response;
    telemetry: DeepSeekFailoverTelemetry;
    usedProvider: DeepSeekProviderId;
  } => {
    logDeepSeekFailoverTelemetry(telemetry);
    opts.hooks?.onTelemetry?.(telemetry);
    return { response, telemetry, usedProvider };
  };

  const failBoth = (error: unknown): never => {
    logDeepSeekFailoverTelemetry(telemetry);
    opts.hooks?.onTelemetry?.(telemetry);
    if (error instanceof DeepSeekProviderFailoverError) throw error;
    if (error instanceof DeepSeekDeterministicProviderError) throw error;
    throw new DeepSeekProviderFailoverError({
      message: errorMessage(error),
      retryable: true,
      telemetry,
    });
  };

  const primaryModel =
    typeof opts.primary.body.model === "string" ? opts.primary.body.model : logicalModelId;
  const backupModel =
    typeof opts.backupBody.model === "string"
      ? opts.backupBody.model
      : resolveDeepSeekBackupModelId(opts.logicalModel);

  const finishPrimaryAttempt = (success: boolean, httpStatus: number | null) => {
    opts.hooks?.onPhysicalAttemptFinish?.({
      physicalAttemptOrdinal: 1,
      provider: "cheaperinference",
      model: primaryModel,
      success,
      httpStatus,
    });
  };

  const primaryStarted = now();
  opts.hooks?.onPhysicalAttemptStart?.({
    physicalAttemptOrdinal: 1,
    provider: "cheaperinference",
    model: primaryModel,
  });
  const attemptBackup = async (): Promise<{
    response: Response;
    telemetry: DeepSeekFailoverTelemetry;
    usedProvider: DeepSeekProviderId;
  }> => {
    finishPrimaryAttempt(false, telemetry.primary_http_status);
    opts.hooks?.onPhysicalAttemptStart?.({
      physicalAttemptOrdinal: 2,
      provider: "openrouter",
      model: backupModel,
    });
    try {
      const backupResponse = await runBackup({
        opts,
        telemetry,
        fetchFn,
        now,
        backupFirstVisibleDeadline,
        completionDeadline: backupCompletionDeadline,
      });
      opts.hooks?.onPhysicalAttemptFinish?.({
        physicalAttemptOrdinal: 2,
        provider: "openrouter",
        model: backupModel,
        success: true,
        httpStatus: backupResponse.status,
      });
      return finish(backupResponse, "openrouter");
    } catch (error) {
      opts.hooks?.onPhysicalAttemptFinish?.({
        physicalAttemptOrdinal: 2,
        provider: "openrouter",
        model: backupModel,
        success: false,
        httpStatus: telemetry.primary_http_status,
      });
      throw failBoth(error);
    }
  };

  let primaryResponse: Response;
  try {
    primaryResponse = await fetchCompatible({
      request: opts.primary,
      fetchFn,
      timeoutMs: opts.stream ? headersDeadline : completionDeadline ?? headersDeadline,
      now,
      startedAt: primaryStarted,
      consumeCompleteBody: !opts.stream,
    });
    telemetry.primary_headers_ms = Math.max(0, now() - primaryStarted);
    telemetry.primary_http_status = primaryResponse.status;
  } catch (error) {
    telemetry.primary_headers_ms = Math.max(0, now() - primaryStarted);
    if (error instanceof DeepSeekBodyDeliveryError) {
      const classified = classifyDeepSeekProviderFailure({
        httpStatus: error.httpStatus,
        error,
        trigger: error.trigger === "body_timeout" ? "body_timeout" : undefined,
      });
      const failover =
        classified.failover ||
        error.httpStatus == null ||
        error.httpStatus === 200;
      telemetry.primary_http_status = error.httpStatus;
      telemetry.primary_failure_class = failover
        ? classified.failover
          ? classified.failureClass
          : error.trigger === "body_timeout"
            ? "body_timeout"
            : "body_transport"
        : classified.failureClass;
      telemetry.failover_trigger = failover ? error.trigger : null;
      if (!failover) {
        finishPrimaryAttempt(false, classified.httpStatus);
        throw new DeepSeekDeterministicProviderError({
          message: errorMessage(error),
          httpStatus: classified.httpStatus,
          failureClass: classified.failureClass,
        });
      }
      return attemptBackup();
    }
    const classified = classifyCaughtFetchError(
      error,
      now() - primaryStarted,
      opts.stream ? headersDeadline : completionDeadline ?? headersDeadline
    );
    telemetry.primary_http_status = classified.httpStatus;
    telemetry.primary_failure_class = classified.failureClass;
    telemetry.failover_trigger = classified.failover ? classified.trigger : null;
    if (!classified.failover) {
      finishPrimaryAttempt(false, classified.httpStatus);
      throw new DeepSeekDeterministicProviderError({
        message: errorMessage(error),
        httpStatus: classified.httpStatus,
        failureClass: classified.failureClass,
      });
    }
    return attemptBackup();
  }

  if (!primaryResponse.ok) {
    const bodyText = await safeReadText(primaryResponse);
    const classified = classifyDeepSeekProviderFailure({
      httpStatus: primaryResponse.status,
      error: bodyText,
    });
    telemetry.primary_failure_class = classified.failureClass;
    telemetry.primary_http_status = classified.httpStatus;
    if (!classified.failover) {
      finishPrimaryAttempt(false, classified.httpStatus);
      throw new DeepSeekDeterministicProviderError({
        message: `CheaperInference ${primaryResponse.status}: ${bodyText.slice(0, 240)}`,
        httpStatus: classified.httpStatus,
        failureClass: classified.failureClass,
      });
    }
    telemetry.failover_trigger = "error";
    return attemptBackup();
  }

  if (!opts.stream) {
    finishPrimaryAttempt(true, primaryResponse.status);
    return finish(primaryResponse, "cheaperinference");
  }

  try {
    const gated = await gateStreamFirstVisible({
      response: primaryResponse,
      fetchStartedAt: primaryStarted,
      deadlineMs: firstVisibleDeadline,
      now,
    });
    if (gated.kind === "visible") {
      telemetry.primary_first_visible_ms = gated.firstVisibleMs;
      return finish(gated.response, "cheaperinference");
    }
    telemetry.primary_failure_class = gated.failureClass;
    telemetry.failover_trigger = gated.trigger;
    return attemptBackup();
  } catch (error) {
    if (
      error instanceof DeepSeekDeterministicProviderError ||
      error instanceof DeepSeekProviderFailoverError
    ) {
      throw error;
    }
    const classified = classifyDeepSeekProviderFailure({ error });
    telemetry.primary_failure_class = classified.failureClass;
    telemetry.failover_trigger = classified.failover ? "error" : null;
    if (!classified.failover) {
      finishPrimaryAttempt(false, classified.httpStatus);
      throw new DeepSeekDeterministicProviderError({
        message: errorMessage(error),
        httpStatus: classified.httpStatus,
        failureClass: classified.failureClass,
      });
    }
    return attemptBackup();
  }
}

export async function fetchDeepSeekNonStreamCompletion(opts: {
  request: DeepSeekAssembledRequest;
  timeoutMs: number;
  hooks?: DeepSeekFailoverHooks;
}): Promise<{ response: Response; latencyMs: number }> {
  const fetchFn = opts.hooks?.fetchFn ?? globalThis.fetch.bind(globalThis);
  const now = opts.hooks?.now ?? Date.now;
  const startedAt = now();
  const response = await fetchCompatible({
    request: opts.request,
    fetchFn,
    timeoutMs: opts.timeoutMs,
    now,
    startedAt,
    consumeCompleteBody: true,
  });
  return { response, latencyMs: Math.max(0, now() - startedAt) };
}

export async function executeDeepSeekBackgroundWithProviderFailover(opts: {
  routeKind?: DeepSeekRouteKind;
  logicalModel?: DeepSeekLogicalModel;
  primary: DeepSeekAssembledRequest;
  backupBody?: Record<string, unknown>;
  timeoutMs: number;
  requestKind?: string;
  deadlines?: DeepSeekFailoverDeadlines;
  hooks?: DeepSeekFailoverHooks;
}): Promise<{
  response: Response;
  telemetry: DeepSeekFailoverTelemetry;
  usedProvider: DeepSeekProviderId;
}> {
  const model =
    typeof opts.primary.body.model === "string" ? opts.primary.body.model : "";
  const logical = opts.logicalModel ?? resolveDeepSeekLogicalModel(model) ?? "flash";
  const backupModel = resolveDeepSeekBackupModelId(logical);
  const resolved = resolveBackgroundFlashProviderDeadlines({
    requestKind: opts.requestKind,
    existingTimeoutMs: opts.timeoutMs,
  });
  const primaryCompletionMs =
    opts.deadlines?.completionMs ?? resolved.primaryCompletionMs;
  const backupCompletionMs =
    opts.deadlines?.backupCompletionMs ?? resolved.backupCompletionMs;
  return executeDeepSeekWithProviderFailover({
    routeKind: opts.routeKind ?? "background_flash",
    logicalModel: logical,
    primary: opts.primary,
    backupBody:
      opts.backupBody ??
      adaptOpenRouterDeepSeekBackupBody(opts.primary.body, backupModel),
    stream: false,
    deadlines: {
      completionMs: primaryCompletionMs,
      backupCompletionMs,
      headersMs: primaryCompletionMs,
    },
    hooks: opts.hooks,
  });
}

async function runBackup(input: {
  opts: {
    logicalModel: DeepSeekLogicalModel;
    backupBody: Record<string, unknown>;
    stream: boolean;
    hooks?: DeepSeekFailoverHooks;
  };
  telemetry: DeepSeekFailoverTelemetry;
  fetchFn: typeof fetch;
  now: () => number;
  backupFirstVisibleDeadline: number;
  completionDeadline?: number;
}): Promise<Response> {
  const backup = resolveDeepSeekBackupTransport();
  if (!backup) {
    input.telemetry.provider_attempt_count = 1;
    throw new DeepSeekProviderFailoverError({
      message: "NO_OPENROUTER_KEY",
      retryable: true,
      telemetry: input.telemetry,
    });
  }
  input.telemetry.provider_attempt_count = 2;
  const started = input.now();
  let response: Response;
  try {
    response = await fetchCompatible({
      request: {
        endpoint: backup.endpoint,
        headers: backup.headers,
        body: input.opts.backupBody,
      },
      fetchFn: input.fetchFn,
      timeoutMs: input.opts.stream
        ? input.backupFirstVisibleDeadline
        : input.completionDeadline ?? input.backupFirstVisibleDeadline,
      now: input.now,
      startedAt: started,
      consumeCompleteBody: !input.opts.stream,
    });
    input.telemetry.backup_headers_ms = Math.max(0, input.now() - started);
  } catch (error) {
    input.telemetry.backup_headers_ms = Math.max(0, input.now() - started);
    input.telemetry.backup_success = false;
    throw new DeepSeekProviderFailoverError({
      message: errorMessage(error),
      retryable: true,
      telemetry: input.telemetry,
    });
  }
  if (!response.ok) {
    const bodyText = await safeReadText(response);
    input.telemetry.backup_success = false;
    throw new DeepSeekProviderFailoverError({
      message: `OpenRouter ${response.status}: ${bodyText.slice(0, 240)}`,
      retryable: !DETERMINISTIC_HTTP_STATUSES.has(response.status),
      telemetry: input.telemetry,
    });
  }
  if (!input.opts.stream) {
    input.telemetry.backup_success = true;
    return response;
  }
  const gated = await gateStreamFirstVisible({
    response,
    fetchStartedAt: started,
    deadlineMs: input.backupFirstVisibleDeadline,
    now: input.now,
  });
  if (gated.kind === "visible") {
    input.telemetry.backup_first_visible_ms = gated.firstVisibleMs;
    input.telemetry.backup_success = true;
    return gated.response;
  }
  input.telemetry.backup_success = false;
  throw new DeepSeekProviderFailoverError({
    message: `OpenRouter backup failed pre-visible (${gated.failureClass})`,
    retryable: true,
    telemetry: input.telemetry,
  });
}

async function fetchCompatible(opts: {
  request: DeepSeekAssembledRequest;
  fetchFn: typeof fetch;
  timeoutMs: number;
  now: () => number;
  startedAt: number;
  consumeCompleteBody?: boolean;
}): Promise<Response> {
  const controller = new AbortController();
  const remaining = Math.max(1, opts.timeoutMs - (opts.now() - opts.startedAt));
  const timer = setTimeout(() => controller.abort(), remaining);
  let headersReceived = false;
  let httpStatus: number | null = null;
  try {
    const response = await opts.fetchFn(opts.request.endpoint, {
      method: "POST",
      headers: opts.request.headers,
      body: JSON.stringify(opts.request.body),
      signal: controller.signal,
    });
    headersReceived = true;
    httpStatus = response.status;
    if (!opts.consumeCompleteBody) {
      return response;
    }
    try {
      const leftoverMs = Math.max(1, opts.timeoutMs - (opts.now() - opts.startedAt));
      const bytes = await readCompleteBody({
        response,
        leftoverMs,
        httpStatus,
        onTimeout: () => {
          if (!controller.signal.aborted) controller.abort();
        },
      });
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (error instanceof DeepSeekBodyDeliveryError) throw error;
      throw new DeepSeekBodyDeliveryError({
        message: controller.signal.aborted
          ? "body completion deadline exceeded"
          : errorMessage(error) || "body delivery failed",
        trigger: controller.signal.aborted ? "body_timeout" : "error",
        httpStatus,
      });
    }
  } catch (error) {
    if (error instanceof DeepSeekBodyDeliveryError) throw error;
    if (!headersReceived && controller.signal.aborted) {
      const abortError = new Error(
        opts.consumeCompleteBody
          ? "completion deadline exceeded"
          : "headers deadline exceeded"
      );
      abortError.name = "TimeoutError";
      (abortError as Error & { trigger?: string }).trigger = opts.consumeCompleteBody
        ? "body_timeout"
        : "headers_timeout";
      throw abortError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readCompleteBody(opts: {
  response: Response;
  leftoverMs: number;
  httpStatus: number | null;
  onTimeout: () => void;
}): Promise<ArrayBuffer> {
  let leftoverTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      opts.response.arrayBuffer(),
      new Promise<ArrayBuffer>((_, reject) => {
        leftoverTimer = setTimeout(() => {
          opts.onTimeout();
          void opts.response.body?.cancel().catch(() => undefined);
          reject(
            new DeepSeekBodyDeliveryError({
              message: "body completion deadline exceeded",
              trigger: "body_timeout",
              httpStatus: opts.httpStatus,
            })
          );
        }, opts.leftoverMs);
      }),
    ]);
  } finally {
    if (leftoverTimer) clearTimeout(leftoverTimer);
  }
}

async function gateStreamFirstVisible(opts: {
  response: Response;
  fetchStartedAt: number;
  deadlineMs: number;
  now: () => number;
}): Promise<
  | { kind: "visible"; response: Response; firstVisibleMs: number }
  | {
      kind: "failover";
      trigger: Exclude<DeepSeekFailoverTrigger, null>;
      failureClass: string;
    }
> {
  const body = opts.response.body;
  if (!body) {
    return {
      kind: "failover",
      trigger: "error",
      failureClass: "empty_body",
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const prefixChunks: Uint8Array[] = [];
  let visibleChars = 0;
  try {
    while (visibleChars === 0) {
      const remaining = opts.deadlineMs - (opts.now() - opts.fetchStartedAt);
      if (remaining <= 0) {
        await cancelQuietly(reader);
        return {
          kind: "failover",
          trigger: "first_visible_timeout",
          failureClass: "first_visible_timeout",
        };
      }
      const chunk = await readWithDeadline(reader, remaining);
      if (chunk.kind === "timeout") {
        await cancelQuietly(reader);
        return {
          kind: "failover",
          trigger: "first_visible_timeout",
          failureClass: "first_visible_timeout",
        };
      }
      if (chunk.kind === "done") {
        if (visibleChars === 0) {
          await cancelQuietly(reader);
          return {
            kind: "failover",
            trigger: "first_visible_timeout",
            failureClass: "first_visible_timeout",
          };
        }
        break;
      }
      prefixChunks.push(chunk.value);
      buffer += decoder.decode(chunk.value, { stream: true });
      visibleChars += countVisibleAssistantChars(buffer);
    }
  } catch (error) {
    await cancelQuietly(reader);
    if (visibleChars > 0) throw error;
    const classified = classifyDeepSeekProviderFailure({ error });
    return {
      kind: "failover",
      trigger: "error",
      failureClass: classified.failureClass,
    };
  }

  const prefix = concatBytes(prefixChunks);
  const rest = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        reader.releaseLock();
        controller.error(error);
      }
    },
    cancel() {
      return cancelQuietly(reader);
    },
  });
  const stream = prependBytes(prefix, rest);
  return {
    kind: "visible",
    firstVisibleMs: Math.max(0, opts.now() - opts.fetchStartedAt),
    response: new Response(stream, {
      status: opts.response.status,
      statusText: opts.response.statusText,
      headers: opts.response.headers,
    }),
  };
}

function countVisibleAssistantChars(buffer: string): number {
  let visible = 0;
  for (const line of buffer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      visible += extractVisibleAssistantDeltaFromSseJson(JSON.parse(payload)).length;
    } catch {
      /* incomplete SSE json */
    }
  }
  return visible;
}

async function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadlineMs: number
): Promise<
  | { kind: "chunk"; value: Uint8Array }
  | { kind: "done" }
  | { kind: "timeout" }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      reader.read().then((chunk) =>
        chunk.done
          ? ({ kind: "done" } as const)
          : ({ kind: "chunk", value: chunk.value } as const)
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), Math.max(1, deadlineMs));
      }),
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function prependBytes(
  prefix: Uint8Array,
  rest: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (prefix.byteLength > 0) controller.enqueue(prefix);
      const reader = rest.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      return rest.cancel();
    },
  });
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function cancelQuietly(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  try {
    reader.releaseLock();
  } catch {
    /* ignore */
  }
}

function classifyCaughtFetchError(
  error: unknown,
  elapsedMs: number,
  headersDeadlineMs: number
): {
  failover: boolean;
  failureClass: string;
  httpStatus: number | null;
  trigger: Exclude<DeepSeekFailoverTrigger, null>;
} {
  const namedTrigger = (error as { trigger?: unknown })?.trigger;
  const message = errorMessage(error);
  const trigger: Exclude<DeepSeekFailoverTrigger, null> =
    namedTrigger === "body_timeout" ||
    /body completion deadline exceeded|completion deadline exceeded/i.test(message)
      ? "body_timeout"
      : namedTrigger === "headers_timeout" ||
          /headers deadline exceeded/i.test(message) ||
          elapsedMs >= headersDeadlineMs
        ? "headers_timeout"
        : "error";
  const classified = classifyDeepSeekProviderFailure({
    error,
    trigger:
      trigger === "headers_timeout" || trigger === "body_timeout"
        ? trigger
        : undefined,
  });
  return { ...classified, trigger };
}

function extractHttpStatus(error: unknown): number | null {
  if (error && typeof error === "object") {
    if ("httpStatus" in error && typeof (error as { httpStatus?: unknown }).httpStatus === "number") {
      return (error as { httpStatus: number }).httpStatus;
    }
    if ("status" in error && typeof (error as { status?: unknown }).status === "number") {
      return (error as { status: number }).status;
    }
  }
  const match = errorMessage(error).match(/\b([45]\d\d)\b/);
  return match ? Number(match[1]) : null;
}

function classifySocketFailure(message: string): string {
  if (/UND_ERR_SOCKET/i.test(message)) return "UND_ERR_SOCKET";
  if (/ECONNRESET/i.test(message)) return "ECONNRESET";
  if (/ETIMEDOUT/i.test(message)) return "ETIMEDOUT";
  if (/EAI_AGAIN/i.test(message)) return "EAI_AGAIN";
  if (/ENOTFOUND/i.test(message)) return "ENOTFOUND";
  if (/socket hang up/i.test(message)) return "socket_hang_up";
  if (/fetch failed/i.test(message)) return "fetch_failed";
  return "socket";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
