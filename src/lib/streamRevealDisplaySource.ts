import { resolveActiveVariantContent, type MessageVariant } from "@/lib/messageAlternates";
import { isTerminalGenerationStatus } from "@/lib/streamingPersistence";

/**
 * Owner map (documentation):
 * - GENERATION_STREAMING_OWNER: network/generation UI + in-flight generationStatus
 * - VISUAL_REVEAL_PENDING_OWNER: requestId-scoped pending reveal set in ChatClient
 * - ASSISTANT_DISPLAY_SOURCE_OWNER: resolveAssistantDisplayBody
 * - ACTIVE_VARIANT_OWNER: resolveActiveVariantContent after visual reveal idle
 * - REVEAL_REQUEST_IDENTITY_OWNER: streamRevealIdentity.isRevealRowWritable
 */

export function isGenerationStreamingMessage(input: {
  messageIndex: number;
  lastAssistantIndex: number;
  generationStatus: string | null | undefined;
  loading: boolean;
  messagesLength: number;
}): boolean {
  const { messageIndex, lastAssistantIndex, generationStatus, loading, messagesLength } = input;
  if (messageIndex !== lastAssistantIndex) return false;
  if (isTerminalGenerationStatus(generationStatus)) return false;
  return (loading && messageIndex === messagesLength - 1) || generationStatus === "generating";
}

export function isVisualRevealPendingForMessage(
  requestId: string | null | undefined,
  pendingRequestIds: ReadonlySet<string>
): boolean {
  return requestId != null && pendingRequestIds.has(requestId);
}

export function shouldUseLiveDisplayedContent(
  isGenerationStreaming: boolean,
  isVisualRevealPending: boolean
): boolean {
  return isGenerationStreaming || isVisualRevealPending;
}

export function resolveAssistantDisplayBody(
  message: {
    content: string;
    variants?: MessageVariant[];
    activeVariant?: number | null;
  },
  input: { useLiveDisplayedContent: boolean }
): string {
  return input.useLiveDisplayedContent
    ? message.content
    : resolveActiveVariantContent(message);
}

/** Live display body owner at server done — do not snap partial to full while reveal pending. */
export function resolveApplyStreamDoneDisplayContent(input: {
  streamingContent: string;
  canonicalDoneContent: string;
  preserveStreamingContent: boolean;
}): string {
  if (input.preserveStreamingContent) {
    return input.streamingContent;
  }
  return input.canonicalDoneContent;
}
