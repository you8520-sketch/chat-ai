import {
  isInFlightGenerationStatus,
  isTerminalGenerationStatus,
  type ChatStreamDraft,
} from "@/lib/streamingPersistenceShared";

export type ChatStreamDraftRecoveryMessage = {
  role: "user" | "assistant" | "system";
  content?: string;
  requestId?: string | null;
  generationStatus?: string | null;
  id?: number | null;
  ephemeral?: boolean;
};

export type ChatStreamDraftRecoveryAction =
  | "noop"
  | "clear-terminal"
  | "hydrate-partial"
  | "clear-orphan";

export type ChatStreamDraftRecoveryResult = {
  messages: ChatStreamDraftRecoveryMessage[];
  clearedDraft: boolean;
  action: ChatStreamDraftRecoveryAction;
};

/**
 * Room-load recovery for sessionStorage stream drafts.
 * DB generation state is authoritative; sessionStorage may only hydrate
 * ahead-of-DB partial content for a matching in-flight requestId.
 */
export function applyChatStreamDraftRecoveryOnLoad(
  messages: readonly ChatStreamDraftRecoveryMessage[],
  draft: ChatStreamDraft | null
): ChatStreamDraftRecoveryResult {
  if (!draft?.requestId) {
    return { messages: [...messages], clearedDraft: false, action: "noop" };
  }

  const matchAssistant = messages.find(
    (m) => m.role === "assistant" && m.requestId === draft.requestId
  );
  const matchUser = messages.find((m) => m.role === "user" && m.requestId === draft.requestId);

  if (matchAssistant && isTerminalGenerationStatus(matchAssistant.generationStatus)) {
    return { messages: [...messages], clearedDraft: true, action: "clear-terminal" };
  }

  if (
    matchAssistant &&
    isInFlightGenerationStatus(matchAssistant.generationStatus) &&
    draft.assistantPartial.length > (matchAssistant.content?.length ?? 0)
  ) {
    return {
      messages: messages.map((m) =>
        m.role === "assistant" && m.requestId === draft.requestId
          ? {
              ...m,
              content: draft.assistantPartial,
              generationStatus: m.generationStatus ?? "generating",
            }
          : m
      ),
      clearedDraft: false,
      action: "hydrate-partial",
    };
  }

  if (!matchAssistant && !matchUser) {
    return { messages: [...messages], clearedDraft: true, action: "clear-orphan" };
  }

  return { messages: [...messages], clearedDraft: false, action: "noop" };
}

export function findLastAssistantIndex(
  messages: readonly ChatStreamDraftRecoveryMessage[]
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}

export function deriveLastTurnInFlight(
  messages: readonly ChatStreamDraftRecoveryMessage[]
): boolean {
  const lastAssistantIdx = findLastAssistantIndex(messages);
  if (lastAssistantIdx < 0) return false;
  const m = messages[lastAssistantIdx];
  return m?.role === "assistant" && isInFlightGenerationStatus(m.generationStatus);
}

export function deriveShowGeneratingPlaceholder(opts: {
  message: ChatStreamDraftRecoveryMessage;
  messageIndex: number;
  messagesLength: number;
  loading: boolean;
}): boolean {
  const genStatus = (opts.message.generationStatus ?? "").toLowerCase();
  return (
    (opts.message.content === "" && opts.loading && opts.messageIndex === opts.messagesLength - 1) ||
    (opts.message.content === "" && genStatus === "generating" && !opts.loading)
  );
}

/** Pre-fix sessionStorage-only branch — documents Case A failure mode for regression tests. */
export function applyLegacySessionStorageOnlyRecovery(
  messages: readonly ChatStreamDraftRecoveryMessage[],
  draft: ChatStreamDraft | null
): ChatStreamDraftRecoveryMessage[] {
  if (!draft?.requestId) return [...messages];

  const matchAssistant = messages.find(
    (m) => m.role === "assistant" && m.requestId === draft.requestId
  );
  const matchUser = messages.find((m) => m.role === "user" && m.requestId === draft.requestId);

  if (matchAssistant && isTerminalGenerationStatus(matchAssistant.generationStatus)) {
    return [...messages];
  }

  if (
    matchAssistant &&
    isInFlightGenerationStatus(matchAssistant.generationStatus) &&
    draft.assistantPartial.length > (matchAssistant.content?.length ?? 0)
  ) {
    return messages.map((m) =>
      m.role === "assistant" && m.requestId === draft.requestId
        ? {
            ...m,
            content: draft.assistantPartial,
            generationStatus: m.generationStatus ?? "generating",
          }
        : m
    );
  }

  if (!matchAssistant && !matchUser && draft.userText) {
    return [
      ...messages,
      {
        role: "user" as const,
        content: draft.userText,
        requestId: draft.requestId,
        generationStatus: "submitted",
      },
      {
        role: "assistant" as const,
        content: draft.assistantPartial || "",
        requestId: draft.requestId,
        generationStatus: "generating",
      },
    ];
  }

  return [...messages];
}
