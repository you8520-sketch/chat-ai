import {
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
} from "@/lib/chatModels";
import { applyCheaperInferenceModelReasoningPolicy } from "@/lib/cheaperInferenceConfig";

function stripTrpgTransportExtensions(body: Record<string, unknown>): Record<string, unknown> {
  const adapted = { ...body };
  delete adapted.session_id;
  delete adapted.frequency_penalty;
  delete adapted.presence_penalty;
  delete adapted.repetition_penalty;
  delete adapted.include_reasoning;
  return adapted;
}

/** Legacy DeepSeek TRPG paths still require explicit true-off beyond the generic adapter. */
function applyTrpgDeepSeekTrueOffOverlay(body: Record<string, unknown>): Record<string, unknown> {
  const model = String(body.model ?? "");
  if (!isCheaperInferenceDeepSeekV4ProModel(model) && !isCheaperInferenceDeepSeekV4FlashModel(model)) {
    return body;
  }
  const next = { ...body };
  delete next.reasoning;
  next.thinking = { type: "disabled" };
  next.reasoning_effort = "none";
  return next;
}

function adaptTrpgChatBody(body: Record<string, unknown>): Record<string, unknown> {
  const stripped = stripTrpgTransportExtensions(body);
  delete stripped.reasoning;
  const withPolicy = applyCheaperInferenceModelReasoningPolicy(stripped);
  return applyTrpgDeepSeekTrueOffOverlay(withPolicy);
}

/**
 * TRPG GM body adapter — isolated from RP `adaptCheaperInferenceChatBody`.
 * Model reasoning policy is owned by applyCheaperInferenceModelReasoningPolicy.
 */
export function adaptTrpgGmChatBody(body: Record<string, unknown>): Record<string, unknown> {
  return adaptTrpgChatBody(body);
}

/**
 * Bot-seat body adapter — Luna true-off via canonical policy.
 * DeepSeek legacy paths retain explicit true-off overlay.
 */
export function adaptTrpgBotChatBody(body: Record<string, unknown>): Record<string, unknown> {
  return adaptTrpgChatBody(body);
}

export type TrpgProviderRequestContract = {
  model: string;
  thinkingType: string;
  reasoningEffort: unknown;
  stream: boolean;
};

function reasoningEffortFromBody(body: Record<string, unknown>): unknown {
  if (body.reasoning_effort != null) return body.reasoning_effort;
  const reasoning = body.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    return (reasoning as { effort?: unknown }).effort;
  }
  return undefined;
}

/** Safe request fields only — never log prompts or keys. */
export function trpgProviderRequestContract(body: Record<string, unknown>): TrpgProviderRequestContract {
  const thinking = body.thinking;
  const thinkingType =
    thinking && typeof thinking === "object" && !Array.isArray(thinking)
      ? String((thinking as { type?: unknown }).type ?? "")
      : "";
  return {
    model: String(body.model ?? ""),
    thinkingType,
    reasoningEffort: reasoningEffortFromBody(body),
    stream: body.stream === true,
  };
}

export function isTrpgTrueOffRequest(contract: TrpgProviderRequestContract): boolean {
  return contract.reasoningEffort === "none" && contract.thinkingType !== "enabled";
}

export function isTrpgGeminiLowReasoningRequest(contract: TrpgProviderRequestContract): boolean {
  return contract.reasoningEffort === "low" && contract.thinkingType === "";
}
