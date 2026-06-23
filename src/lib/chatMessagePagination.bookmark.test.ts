import { describe, expect, it } from "vitest";

import { takeRecentTurnsIncludingMessage } from "./chatMessagePagination";

function turn(userId: number, assistantId: number) {
  return {
    user: { id: userId, role: "user" as const, content: `u${userId}` },
    assistant: { id: assistantId, role: "assistant" as const, content: `a${assistantId}` },
  };
}

describe("takeRecentTurnsIncludingMessage", () => {
  it("loads a window around the target turn, not the entire tail", () => {
    const rows: { id: number; role: "user" | "assistant"; content: string }[] = [];
    for (let i = 0; i < 40; i++) {
      const userId = i * 2 + 1;
      const assistantId = i * 2 + 2;
      rows.push({ id: userId, role: "user", content: `u${userId}` });
      rows.push({ id: assistantId, role: "assistant", content: `a${assistantId}` });
    }

    const targetAssistantId = 22; // turn index 10
    const result = takeRecentTurnsIncludingMessage(rows, targetAssistantId, {
      turnsBefore: 3,
      turnsAfter: 5,
    });

    const ids = result.messages.map((m) => m.id);
    expect(ids).toContain(targetAssistantId);
    expect(ids).toContain(21); // paired user
    expect(ids).not.toContain(80); // latest assistant should not be forced in
    expect(result.hasMoreOlder).toBe(true);
    expect(result.hiddenTurnCount).toBe(7);
  });
});
