import { createHash } from "node:crypto";
import { getCanonicalProseBody } from "@/lib/canonicalProse";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isDeepSeekModel,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";
import { isNoncanonicalGeneration } from "@/lib/oocSceneRender";

/**
 * DEV/AUDIT-only DeepSeek adult-handoff fixture capture.
 * Not imported by the production chat route. Does not persist ordinary user chats.
 */

export const DEEPSEEK_ADULT_HANDOFF_FIXTURE_CAPTURE_MODE = "dev_audit_only" as const;

export const DEEPSEEK0813_HANDOFF_TRUE_OFF_TRANSPORT = {
  thinking: { type: "disabled" as const },
  reasoning_effort: "none" as const,
};

export const DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS = {
  SOURCE_MIRROR_PRODUCTION: false,
  OPUS_ADAPTER: 0,
  GEMINI31_ADAPTER: 0,
  GEMINI37_ADAPTER: 0,
  ORIGIN_POINTER: 0,
  TURN_OWNERSHIP: 0,
  COMPLETION: 0,
  CURRENT_STAGE_BOUNDARY: 0,
  FINGERPRINT: 0,
} as const;

const INTERNAL_ONLY_MARKERS = [
  "<<<STATUS_VALUES",
  "<<<END_STATUS>>>",
  "[SYSTEM PROMPT]",
  "```json",
  "<tool_call>",
  "<|redacted_reasoning",
  "INTERNAL AION",
  "INTERNAL CONTINUATION",
] as const;

export type FixtureHistoryItem = {
  id?: string | number | null;
  role: string;
  content: string;
  modelId?: string | null;
  usage?: unknown;
  generationKind?: string;
  canonical?: boolean;
};

export type HandoffSessionProvenance = {
  active: boolean;
  sourceModelId: string;
  originAssistantMessageId: string | number | null;
  originAssistantRawSha: string | null;
  targetModelId: string;
  startedAtTurn: number;
  handoffTurnCount: number;
};

export type HandoffFixtureTransportConfig = {
  thinking: { type: "disabled" };
  reasoning_effort: "none";
  reasoning: null;
  include_reasoning: null;
  enable_thinking: null;
};

export type HandoffFixtureRuntimeMetadata = {
  userSelectedModel?: string | null;
  sourceModel?: string | null;
  actualTargetModel?: string | null;
  handoffApplied?: boolean | null;
  handoffSessionId?: string | null;
  handoffTurnIndex?: number | null;
  originAssistantMessageId?: string | number | null;
  originAssistantRawSha?: string | null;
  reasoning_stream_events?: number | null;
  reasoning_chars?: number | null;
  trueOffViolation?: boolean | null;
  ttftMs?: number | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  completionTokens?: number | null;
  cacheReadTokens?: number | null;
  rawCost?: number | null;
  visibleChars?: number | null;
};

export type HandoffFixtureCaptureRecord = {
  captureMode: typeof DEEPSEEK_ADULT_HANDOFF_FIXTURE_CAPTURE_MODE;
  persistOrdinaryUserChats: false;
  sourceModel: string;
  targetModel: string;
  characterSha: string;
  personaSha: string;
  speechLockSha: string;
  worldSha: string;
  systemSha: string;
  historySha: string;
  originAssistantMessageId: string | number | null;
  originAssistantRawSha: string | null;
  currentUserSha: string;
  fullPromptSha: string;
  transport: HandoffFixtureTransportConfig;
  runtime: HandoffFixtureRuntimeMetadata;
};

export type FixturePersistRequest = {
  approvedInternalAuditWorkflow: boolean;
  ordinaryUserChat: boolean;
  persistRawBodies?: boolean;
};

export type FixturePersistPolicy = {
  persistMetadata: boolean;
  persistRawBodies: boolean;
  reason:
    | "ordinary_user_chat_blocked"
    | "not_approved_internal_audit"
    | "approved_audit_metadata_only"
    | "approved_audit_raw";
};

export type CanonicalOriginSelection = {
  messageId: string | number | null;
  raw: string;
  rawSha: string;
  modelId: string | null;
};

export type QaStyleTelemetry = {
  sentenceMedian: number | null;
  paragraphMedian: number | null;
  paragraphP75: number | null;
  dialogueShare: number;
  oneSentenceParagraphShare: number;
};

export type DeepSeekHandoffRoutingClass = {
  isDeepSeekNativeTurn: boolean;
  isDeepSeekAdultHandoff: boolean;
  handoffApplied: boolean;
  targetModelId: string;
  styleAdapterCount: 0;
  turnOwnership: 0;
  originPointer: 0;
  sourceMirror: 0;
};

export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isDeepSeekNativeTurn(userSelectedModelId: string): boolean {
  return isDeepSeekModel(userSelectedModelId);
}

export function isDeepSeekAdultHandoff(input: {
  adultHandoffActive: boolean;
  selectedSourceModelId: string;
  resolvedTargetModelId: string;
}): boolean {
  if (!input.adultHandoffActive) return false;
  if (isDeepSeekNativeTurn(input.selectedSourceModelId)) return false;
  return (
    normalizeDeepSeekV4ProModelId(input.resolvedTargetModelId) ===
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
}

export function classifyDeepSeekHandoffRouting(input: {
  userSelectedModelId: string;
  adultHandoffActive: boolean;
  resolvedTargetModelId: string;
}): DeepSeekHandoffRoutingClass {
  const native = isDeepSeekNativeTurn(input.userSelectedModelId);
  const handoff = isDeepSeekAdultHandoff({
    adultHandoffActive: input.adultHandoffActive,
    selectedSourceModelId: input.userSelectedModelId,
    resolvedTargetModelId: input.resolvedTargetModelId,
  });
  return {
    isDeepSeekNativeTurn: native,
    isDeepSeekAdultHandoff: handoff,
    handoffApplied: handoff,
    targetModelId: handoff
      ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
      : input.resolvedTargetModelId,
    styleAdapterCount: 0,
    turnOwnership: 0,
    originPointer: 0,
    sourceMirror: 0,
  };
}

export function describeDeepSeek0813HandoffTrueOffTransport(): HandoffFixtureTransportConfig {
  return {
    thinking: { ...DEEPSEEK0813_HANDOFF_TRUE_OFF_TRANSPORT.thinking },
    reasoning_effort: DEEPSEEK0813_HANDOFF_TRUE_OFF_TRANSPORT.reasoning_effort,
    reasoning: null,
    include_reasoning: null,
    enable_thinking: null,
  };
}

export function isDeepSeek0813TrueOffTransport(body: Record<string, unknown>): boolean {
  const thinking = body.thinking;
  const thinkingType =
    thinking && typeof thinking === "object" && !Array.isArray(thinking)
      ? String((thinking as { type?: unknown }).type ?? "")
      : "";
  return (
    thinkingType === "disabled" &&
    body.reasoning_effort === "none" &&
    body.reasoning == null &&
    body.include_reasoning == null &&
    body.enable_thinking == null
  );
}

export function evaluateTrueOffStreamInvariant(input: {
  reasoning_stream_events: number;
  reasoning_chars: number;
  providerReasoningTokens?: number | null;
}): { trueOffViolation: boolean } {
  void input.providerReasoningTokens;
  return {
    trueOffViolation:
      input.reasoning_stream_events !== 0 || input.reasoning_chars !== 0,
  };
}

function looksLikeInternalOnlyRaw(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (INTERNAL_ONLY_MARKERS.some((marker) => trimmed.startsWith(marker))) {
    return true;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function selectLastVisibleCanonicalNonDeepSeekAssistant(
  history: FixtureHistoryItem[]
): CanonicalOriginSelection | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row.role !== "assistant") continue;
    if (row.modelId && isDeepSeekModel(row.modelId)) continue;
    if (isNoncanonicalGeneration(row.usage)) continue;
    if (row.generationKind === "ooc_scene_render" && row.canonical === false) {
      continue;
    }
    const raw = getCanonicalProseBody(row.content);
    if (looksLikeInternalOnlyRaw(raw)) continue;
    return {
      messageId: row.id ?? null,
      raw,
      rawSha: sha256Utf8(raw),
      modelId: row.modelId ?? null,
    };
  }
  return null;
}

export function startHandoffSession(input: {
  sourceModelId: string;
  originAssistantMessageId: string | number | null;
  originAssistantRaw: string;
  targetModelId: string;
  startedAtTurn: number;
}): HandoffSessionProvenance {
  return {
    active: true,
    sourceModelId: input.sourceModelId,
    originAssistantMessageId: input.originAssistantMessageId,
    originAssistantRawSha: sha256Utf8(input.originAssistantRaw),
    targetModelId: input.targetModelId,
    startedAtTurn: input.startedAtTurn,
    handoffTurnCount: 0,
  };
}

export function recordDeepSeekHandoffTurn(
  session: HandoffSessionProvenance,
  _nextDeepSeekAssistantMessageId: string | number | null
): HandoffSessionProvenance {
  void _nextDeepSeekAssistantMessageId;
  return {
    ...session,
    originAssistantMessageId: session.originAssistantMessageId,
    originAssistantRawSha: session.originAssistantRawSha,
    handoffTurnCount: session.handoffTurnCount + 1,
  };
}

export function resolveFixturePersistPolicy(
  request: FixturePersistRequest
): FixturePersistPolicy {
  if (request.ordinaryUserChat) {
    return {
      persistMetadata: false,
      persistRawBodies: false,
      reason: "ordinary_user_chat_blocked",
    };
  }
  if (!request.approvedInternalAuditWorkflow) {
    return {
      persistMetadata: false,
      persistRawBodies: false,
      reason: "not_approved_internal_audit",
    };
  }
  if (request.persistRawBodies === true) {
    return {
      persistMetadata: true,
      persistRawBodies: true,
      reason: "approved_audit_raw",
    };
  }
  return {
    persistMetadata: true,
    persistRawBodies: false,
    reason: "approved_audit_metadata_only",
  };
}

export function buildHandoffFixtureCaptureRecord(input: {
  sourceModel: string;
  targetModel: string;
  character: string;
  persona: string;
  speechLock: string;
  world: string;
  system: string;
  history: string;
  originAssistantMessageId: string | number | null;
  originAssistantRaw: string | null;
  currentUser: string;
  fullPrompt: string;
  runtime?: HandoffFixtureRuntimeMetadata;
}): HandoffFixtureCaptureRecord {
  const originSha = input.originAssistantRaw
    ? sha256Utf8(input.originAssistantRaw)
    : null;
  const streamEvents = input.runtime?.reasoning_stream_events ?? null;
  const streamChars = input.runtime?.reasoning_chars ?? null;
  const trueOffViolation =
    streamEvents == null || streamChars == null
      ? input.runtime?.trueOffViolation ?? null
      : evaluateTrueOffStreamInvariant({
          reasoning_stream_events: streamEvents,
          reasoning_chars: streamChars,
          providerReasoningTokens: null,
        }).trueOffViolation;
  return {
    captureMode: DEEPSEEK_ADULT_HANDOFF_FIXTURE_CAPTURE_MODE,
    persistOrdinaryUserChats: false,
    sourceModel: input.sourceModel,
    targetModel: input.targetModel,
    characterSha: sha256Utf8(input.character),
    personaSha: sha256Utf8(input.persona),
    speechLockSha: sha256Utf8(input.speechLock),
    worldSha: sha256Utf8(input.world),
    systemSha: sha256Utf8(input.system),
    historySha: sha256Utf8(input.history),
    originAssistantMessageId: input.originAssistantMessageId,
    originAssistantRawSha: originSha,
    currentUserSha: sha256Utf8(input.currentUser),
    fullPromptSha: sha256Utf8(input.fullPrompt),
    transport: describeDeepSeek0813HandoffTrueOffTransport(),
    runtime: {
      ...input.runtime,
      originAssistantMessageId:
        input.runtime?.originAssistantMessageId ?? input.originAssistantMessageId,
      originAssistantRawSha: input.runtime?.originAssistantRawSha ?? originSha,
      trueOffViolation,
    },
  };
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！?]|다\.|요\.|까\.|죠\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx] ?? null;
}

function isDialogueParagraph(paragraph: string): boolean {
  return /["“”『』「」]/.test(paragraph);
}

/** QA-only metrics. Never inject these values into a model prompt. */
export function computeQaStyleTelemetry(text: string): QaStyleTelemetry {
  const paragraphs = splitParagraphs(text);
  const paragraphLens = paragraphs.map((p) => [...p].length).sort((a, b) => a - b);
  const sentences = splitSentences(text);
  const sentenceLens = sentences.map((s) => [...s].length).sort((a, b) => a - b);
  const dialogueParagraphs = paragraphs.filter(isDialogueParagraph);
  const oneSentenceParagraphs = paragraphs.filter(
    (p) => splitSentences(p).length <= 1
  );
  return {
    sentenceMedian: percentile(sentenceLens, 50),
    paragraphMedian: percentile(paragraphLens, 50),
    paragraphP75: percentile(paragraphLens, 75),
    dialogueShare:
      paragraphs.length > 0
        ? Math.round((dialogueParagraphs.length / paragraphs.length) * 1000) / 1000
        : 0,
    oneSentenceParagraphShare:
      paragraphs.length > 0
        ? Math.round((oneSentenceParagraphs.length / paragraphs.length) * 1000) / 1000
        : 0,
  };
}

export function qaStyleTelemetryMustNotEnterPrompt(
  prompt: string,
  telemetry: QaStyleTelemetry
): boolean {
  const needles = [
    `sentence median ${String(telemetry.sentenceMedian)}`,
    `paragraph median ${String(telemetry.paragraphMedian)}`,
    `paragraph p75 ${String(telemetry.paragraphP75)}`,
    `dialogue share ${String(telemetry.dialogueShare)}`,
    `one-sentence paragraph share ${String(telemetry.oneSentenceParagraphShare)}`,
  ];
  return needles.every((needle) => !prompt.includes(needle));
}
