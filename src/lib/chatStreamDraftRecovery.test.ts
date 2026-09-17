import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyChatStreamDraftRecoveryOnLoad,
  type ChatStreamDraftRecoveryMessage,
} from "./chatStreamDraftRecovery";
import {
  isInFlightGenerationStatus,
  isTerminalGenerationStatus,
  type ChatStreamDraft,
} from "./streamingPersistenceShared";

const TERMINAL_HISTORY: ChatStreamDraftRecoveryMessage[] = [
  { id: 1, role: "user", content: "안녕", generationStatus: "completed" },
  {
    id: 2,
    role: "assistant",
    content: "반가워요.",
    generationStatus: "completed",
    requestId: "cr_old_turn",
  },
];

const ORPHAN_DRAFT: ChatStreamDraft = {
  requestId: "cr_orphan_12345678",
  chatId: 42,
  userText: "이전 탭에서 입력만 하고 떠남",
  assistantPartial: "",
  updatedAt: Date.now(),
};

/** Pre-fix sessionStorage-only branch — Case A BEFORE proof (test-only). */
function applyLegacySessionStorageOnlyRecovery(
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

function lastAssistantInFlight(messages: readonly ChatStreamDraftRecoveryMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant") {
      return isInFlightGenerationStatus(m.generationStatus);
    }
  }
  return false;
}

function wouldShowGeneratingPlaceholder(
  message: ChatStreamDraftRecoveryMessage,
  messageIndex: number,
  messagesLength: number,
  loading: boolean
): boolean {
  const genStatus = (message.generationStatus ?? "").toLowerCase();
  return (
    (message.content === "" && loading && messageIndex === messagesLength - 1) ||
    (message.content === "" && genStatus === "generating" && !loading)
  );
}

describe("chat stream draft room-load recovery", () => {
  it("Case A BEFORE: legacy sessionStorage-only branch creates fake in-flight turn", () => {
    const recovered = applyLegacySessionStorageOnlyRecovery(TERMINAL_HISTORY, ORPHAN_DRAFT);
    assert.equal(recovered.length, TERMINAL_HISTORY.length + 2);
    assert.equal(lastAssistantInFlight(recovered), true);
    const last = recovered[recovered.length - 1];
    assert.equal(last?.role, "assistant");
    assert.equal(last?.generationStatus, "generating");
    assert.equal(last?.content, "");
    assert.equal(
      wouldShowGeneratingPlaceholder(last!, recovered.length - 1, recovered.length, false),
      true
    );
  });

  it("Case A AFTER: orphan draft clears without synthetic rows or UI lock", () => {
    const result = applyChatStreamDraftRecoveryOnLoad(TERMINAL_HISTORY, ORPHAN_DRAFT);
    assert.equal(result.action, "clear-orphan");
    assert.equal(result.clearedDraft, true);
    assert.deepEqual(result.messages, TERMINAL_HISTORY);
    assert.equal(lastAssistantInFlight(result.messages), false);
  });

  it("matching terminal assistant clears stale draft", () => {
    const draft: ChatStreamDraft = {
      ...ORPHAN_DRAFT,
      requestId: "cr_old_turn",
      userText: "ignored",
      assistantPartial: "partial",
    };
    const result = applyChatStreamDraftRecoveryOnLoad(TERMINAL_HISTORY, draft);
    assert.equal(result.action, "clear-terminal");
    assert.equal(result.clearedDraft, true);
    assert.deepEqual(result.messages, TERMINAL_HISTORY);
  });

  it("matching real DB in-flight assistant hydrates longer local partial only", () => {
    const messages: ChatStreamDraftRecoveryMessage[] = [
      ...TERMINAL_HISTORY,
      {
        id: 3,
        role: "user",
        content: "다음 질문",
        requestId: "cr_live",
        generationStatus: "submitted",
      },
      {
        id: 4,
        role: "assistant",
        content: "부",
        requestId: "cr_live",
        generationStatus: "generating",
      },
    ];
    const draft: ChatStreamDraft = {
      requestId: "cr_live",
      chatId: 42,
      userText: "다음 질문",
      assistantPartial: "부분 출력이 더 김",
      updatedAt: Date.now(),
    };
    const result = applyChatStreamDraftRecoveryOnLoad(messages, draft);
    assert.equal(result.action, "hydrate-partial");
    assert.equal(result.clearedDraft, false);
    const assistant = result.messages.find(
      (m) => m.role === "assistant" && m.requestId === "cr_live"
    );
    assert.equal(assistant?.content, "부분 출력이 더 김");
    assert.equal(assistant?.generationStatus, "generating");
    assert.equal(lastAssistantInFlight(result.messages), true);
  });

  it("DB in-flight assistant keeps DB content when local partial is not ahead", () => {
    const messages: ChatStreamDraftRecoveryMessage[] = [
      {
        id: 4,
        role: "assistant",
        content: "already longer from db",
        requestId: "cr_live",
        generationStatus: "generating",
      },
    ];
    const draft: ChatStreamDraft = {
      requestId: "cr_live",
      chatId: 42,
      userText: "x",
      assistantPartial: "short",
      updatedAt: Date.now(),
    };
    const result = applyChatStreamDraftRecoveryOnLoad(messages, draft);
    assert.equal(result.action, "noop");
    assert.equal(result.messages[0]?.content, "already longer from db");
  });

  it("matching DB user without assistant does not synthesize generating assistant", () => {
    const messages: ChatStreamDraftRecoveryMessage[] = [
      ...TERMINAL_HISTORY,
      {
        id: 3,
        role: "user",
        content: "서버에 user만 있음",
        requestId: "cr_user_only",
        generationStatus: "submitted",
      },
    ];
    const draft: ChatStreamDraft = {
      requestId: "cr_user_only",
      chatId: 42,
      userText: "서버에 user만 있음",
      assistantPartial: "",
      updatedAt: Date.now(),
    };
    const result = applyChatStreamDraftRecoveryOnLoad(messages, draft);
    assert.equal(result.action, "noop");
    assert.equal(result.messages.length, messages.length);
    assert.equal(lastAssistantInFlight(result.messages), false);
  });

  it("room/chat scope isolation — draft requestId must match message rows", () => {
    const otherChatDraft: ChatStreamDraft = {
      requestId: "cr_other_room",
      chatId: 99,
      userText: "다른 방",
      assistantPartial: "",
      updatedAt: Date.now(),
    };
    const result = applyChatStreamDraftRecoveryOnLoad(TERMINAL_HISTORY, otherChatDraft);
    assert.equal(result.action, "clear-orphan");
    assert.equal(result.clearedDraft, true);
  });

  it("regen failed prior alternate: terminal history stays unlocked without orphan synthesis", () => {
    const messages: ChatStreamDraftRecoveryMessage[] = [
      { id: 1, role: "user", content: "u", generationStatus: "completed" },
      {
        id: 2,
        role: "assistant",
        content: "good alternate",
        generationStatus: "completed",
        requestId: "cr_done",
      },
    ];
    const draft: ChatStreamDraft = {
      requestId: "cr_failed_regen",
      chatId: 42,
      userText: "u",
      assistantPartial: "",
      updatedAt: Date.now(),
    };
    const result = applyChatStreamDraftRecoveryOnLoad(messages, draft);
    assert.equal(result.action, "clear-orphan");
    assert.equal(result.messages[1]?.content, "good alternate");
    assert.equal(lastAssistantInFlight(result.messages), false);
  });
});
