import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRegenerationContextBoundary } from "./regenerationContext";

describe("resolveRegenerationContextBoundary", () => {
  it("uses only the target assistant parent user as the regeneration current input", () => {
    const rows = [
      { id: 1, role: "assistant" as const, model: "greeting", content: "hello" },
      { id: 2, role: "user" as const, content: "previous user" },
      { id: 3, role: "assistant" as const, content: "previous assistant" },
      { id: 4, role: "user" as const, content: "target user" },
      { id: 5, role: "assistant" as const, content: "target assistant" },
      { id: 6, role: "user" as const, content: "future draft-like user" },
    ];

    const boundary = resolveRegenerationContextBoundary(rows, 5);

    assert.equal(boundary?.targetAssistant.id, 5);
    assert.equal(boundary?.parentUser.id, 4);
    assert.equal(boundary?.parentUser.content, "target user");
    assert.deepEqual(
      boundary?.historyRows.map((row) => row.id),
      [1, 2, 3]
    );
  });

  it("excludes the previous assistant response and every message after it", () => {
    const rows = [
      { id: 10, role: "user" as const, content: "u1" },
      { id: 11, role: "assistant" as const, content: "a1" },
      { id: 12, role: "user" as const, content: "u2" },
      { id: 13, role: "assistant" as const, content: "old answer" },
      { id: 14, role: "user" as const, content: "u3" },
      { id: 15, role: "assistant" as const, content: "a3" },
    ];

    const boundary = resolveRegenerationContextBoundary(rows, 13);

    assert.equal(boundary?.parentUser.content, "u2");
    assert.deepEqual(
      boundary?.historyRows.map((row) => row.content),
      ["u1", "a1"]
    );
  });

  it("defaults to the latest non-greeting assistant when no explicit target is provided", () => {
    const rows = [
      { id: 1, role: "user" as const, content: "u1" },
      { id: 2, role: "assistant" as const, content: "a1" },
      { id: 3, role: "user" as const, content: "u2" },
      { id: 4, role: "assistant" as const, content: "a2" },
    ];

    const boundary = resolveRegenerationContextBoundary(rows);

    assert.equal(boundary?.targetAssistant.id, 4);
    assert.equal(boundary?.parentUser.id, 3);
    assert.deepEqual(
      boundary?.historyRows.map((row) => row.id),
      [1, 2]
    );
  });
});
