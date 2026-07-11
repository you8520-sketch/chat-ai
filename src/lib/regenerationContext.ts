export type RegenerationMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  user_message_id?: number | null;
};

export type RegenerationContextBoundary = {
  targetAssistant: RegenerationMessageRow;
  parentUser: RegenerationMessageRow;
  historyRows: RegenerationMessageRow[];
};

export type RegenerationContextReasonCode =
  | "OK"
  | "PARENT_USER_NOT_FOUND"
  | "USED_LATEST_USER_INSTEAD_OF_PARENT"
  | "PREVIOUS_USER_INCLUDED_AS_CURRENT"
  | "DRAFT_INPUT_INCLUDED"
  | "MESSAGES_AFTER_TARGET_INCLUDED"
  | "PARENT_USER_DUPLICATED"
  | "PREVIOUS_ASSISTANT_INCLUDED"
  | "CLIENT_SENT_MIXED_CONTEXT"
  | "UNKNOWN";

export type RegenerationContextTrace = {
  requestId?: string | null;
  targetAssistantMessageId: number | null;
  parentUserMessageId: number | null;
  conversationId: number | null;
  mode: "regeneration";
  historyMessageIdsBeforeTarget: string[];
  historyUserMessageIdsBeforeTarget: string[];
  excludedMessageIdsAfterTarget: string[];
  excludedDraftPresent: boolean;
  excludedPreviousAssistantVariantIds: string[];
  currentUserInputMessageId: number | null;
  currentUserInputHash: string | null;
  currentUserInputLength: number;
  parentUserContentHash: string | null;
  parentUserContentLength: number;
  previousUserMessageId: number | null;
  previousUserContentHash: string | null;
  previousUserIncludedAsCurrent: boolean;
  currentInputWrapperHash: string | null;
  currentInputWrapperSource:
    | "parent_user_message"
    | "latest_user_message"
    | "client_payload"
    | "draft_input"
    | "unknown";
  duplicateParentInHistory: boolean;
  messagesAfterTargetIncluded: boolean;
  draftInputIncluded: boolean;
  previousFailedAssistantIncluded: boolean;
  reasonCode: RegenerationContextReasonCode;
};

function hashText(text: string | null | undefined): string | null {
  if (text == null) return null;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function resolveRegenerationContextBoundary(
  rows: RegenerationMessageRow[],
  targetAssistantId?: number | null
): RegenerationContextBoundary | null {
  const targetIndex =
    targetAssistantId != null
      ? rows.findIndex(
          (row) =>
            row.id === targetAssistantId &&
            row.role === "assistant" &&
            row.model !== "greeting"
        )
      : (() => {
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i]!;
            if (row.role === "assistant" && row.model !== "greeting") return i;
          }
          return -1;
        })();

  if (targetIndex < 0) return null;
  const targetAssistant = rows[targetIndex]!;

  let parentIndex = -1;
  if (targetAssistant.user_message_id != null) {
    parentIndex = rows.findIndex(
      (row, index) =>
        index < targetIndex &&
        row.id === targetAssistant.user_message_id &&
        row.role === "user"
    );
  }
  if (parentIndex < 0) {
    for (let i = targetIndex - 1; i >= 0; i--) {
      if (rows[i]!.role === "user") {
        parentIndex = i;
        break;
      }
    }
  }
  if (parentIndex < 0) return null;

  return {
    targetAssistant,
    parentUser: rows[parentIndex]!,
    historyRows: rows.slice(0, parentIndex),
  };
}

export function buildRegenerationContextTrace(input: {
  requestId?: string | null;
  chatId?: number | null;
  rows: RegenerationMessageRow[];
  targetAssistantId?: number | null;
  boundary: RegenerationContextBoundary | null;
  currentInputWrapperSource?: RegenerationContextTrace["currentInputWrapperSource"];
  clientDraftPresent?: boolean;
}): RegenerationContextTrace {
  const targetIndex =
    input.boundary != null
      ? input.rows.findIndex((row) => row.id === input.boundary!.targetAssistant.id)
      : input.targetAssistantId != null
        ? input.rows.findIndex((row) => row.id === input.targetAssistantId)
        : -1;
  const parentIndex =
    input.boundary != null
      ? input.rows.findIndex((row) => row.id === input.boundary!.parentUser.id)
      : -1;
  const historyRows = input.boundary?.historyRows ?? [];
  const afterTargetRows = targetIndex >= 0 ? input.rows.slice(targetIndex + 1) : [];
  const previousUser =
    parentIndex > 0
      ? [...input.rows.slice(0, parentIndex)].reverse().find((row) => row.role === "user") ?? null
      : null;
  const parentUser = input.boundary?.parentUser ?? null;
  const duplicateParentInHistory =
    parentUser != null && historyRows.some((row) => row.id === parentUser.id);
  const messagesAfterTargetIncluded =
    targetIndex >= 0 && historyRows.some((row) => input.rows.indexOf(row) > targetIndex);
  const previousFailedAssistantIncluded = historyRows.some(
    (row) =>
      row.role === "assistant" &&
      (row.content.trim().length === 0 || row.id === input.boundary?.targetAssistant.id)
  );
  const previousUserIncludedAsCurrent =
    previousUser != null && parentUser != null && previousUser.id === parentUser.id;
  const draftInputIncluded = input.clientDraftPresent === true;

  let reasonCode: RegenerationContextReasonCode = "OK";
  if (!parentUser) reasonCode = "PARENT_USER_NOT_FOUND";
  else if (draftInputIncluded) reasonCode = "DRAFT_INPUT_INCLUDED";
  else if (messagesAfterTargetIncluded) reasonCode = "MESSAGES_AFTER_TARGET_INCLUDED";
  else if (duplicateParentInHistory) reasonCode = "PARENT_USER_DUPLICATED";
  else if (previousUserIncludedAsCurrent) reasonCode = "PREVIOUS_USER_INCLUDED_AS_CURRENT";
  else if (previousFailedAssistantIncluded) reasonCode = "PREVIOUS_ASSISTANT_INCLUDED";

  return {
    requestId: input.requestId ?? null,
    targetAssistantMessageId: input.boundary?.targetAssistant.id ?? input.targetAssistantId ?? null,
    parentUserMessageId: parentUser?.id ?? null,
    conversationId: input.chatId ?? null,
    mode: "regeneration",
    historyMessageIdsBeforeTarget: historyRows.map((row) => String(row.id)),
    historyUserMessageIdsBeforeTarget: historyRows
      .filter((row) => row.role === "user")
      .map((row) => String(row.id)),
    excludedMessageIdsAfterTarget: afterTargetRows.map((row) => String(row.id)),
    excludedDraftPresent: input.clientDraftPresent === true,
    excludedPreviousAssistantVariantIds:
      input.boundary?.targetAssistant.id != null ? [String(input.boundary.targetAssistant.id)] : [],
    currentUserInputMessageId: parentUser?.id ?? null,
    currentUserInputHash: hashText(parentUser?.content),
    currentUserInputLength: parentUser?.content.length ?? 0,
    parentUserContentHash: hashText(parentUser?.content),
    parentUserContentLength: parentUser?.content.length ?? 0,
    previousUserMessageId: previousUser?.id ?? null,
    previousUserContentHash: hashText(previousUser?.content),
    previousUserIncludedAsCurrent,
    currentInputWrapperHash: hashText(parentUser?.content),
    currentInputWrapperSource: input.currentInputWrapperSource ?? "unknown",
    duplicateParentInHistory,
    messagesAfterTargetIncluded,
    draftInputIncluded,
    previousFailedAssistantIncluded,
    reasonCode,
  };
}

function traceList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((x) => x.trim().replace(/^msg-/i, ""))
      .filter(Boolean)
  );
}

export function shouldTraceRegenerationContext(input: {
  requestId?: string | null;
  targetAssistantMessageId?: number | null;
}): boolean {
  if (process.env.REGEN_CONTEXT_TRACE_ENABLED !== "1") return false;
  const requestIds = traceList(process.env.REGEN_CONTEXT_TRACE_REQUEST_IDS);
  const messageIds = traceList(process.env.REGEN_CONTEXT_TRACE_MESSAGE_IDS);
  const requestAllowed =
    requestIds.size === 0 || (input.requestId != null && requestIds.has(input.requestId));
  const messageAllowed =
    messageIds.size === 0 ||
    (input.targetAssistantMessageId != null && messageIds.has(String(input.targetAssistantMessageId)));
  return requestAllowed && messageAllowed;
}

export function logRegenerationContextTrace(trace: RegenerationContextTrace): void {
  if (
    !shouldTraceRegenerationContext({
      requestId: trace.requestId,
      targetAssistantMessageId: trace.targetAssistantMessageId,
    })
  ) {
    return;
  }
  console.info("[RegenContextTrace]", JSON.stringify(trace));
}
