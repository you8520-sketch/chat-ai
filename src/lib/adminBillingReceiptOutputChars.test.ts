import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import { resolveAdminReceiptPersistedFinalText } from "@/lib/adminBillingReceiptV3Server";

function row(input: {
  content: string;
  alternates?: unknown[];
  activeVariant?: number;
  requestId?: string | null;
}) {
  return {
    id: 101,
    content: input.content,
    model: "deepseek-v4-pro-0813",
    usage: null,
    alternates: JSON.stringify(input.alternates ?? []),
    active_variant: input.activeVariant ?? 0,
    request_id: input.requestId ?? null,
  };
}

function scope(generationSequence: number, generationRequestId: string | null) {
  return {
    assistantMessageId: 101,
    generationSequence,
    generationRequestId,
  };
}

describe("Admin Receipt Main RP persisted visible output chars", () => {
  it("A — completed normal resolves the persisted final text", () => {
    const content = "가".repeat(3214);
    const text = resolveAdminReceiptPersistedFinalText(
      row({ content, requestId: "request-a" }),
      scope(0, "request-a")
    );
    assert.equal(text, content);
    assert.equal(visibleAssistantDisplayCharCount(text ?? ""), 3214);
  });

  it("B — completed regen resolves generation B, never generation A", () => {
    const contentA = "가".repeat(3214);
    const contentB = "나".repeat(3480);
    const text = resolveAdminReceiptPersistedFinalText(
      row({
        content: contentB,
        activeVariant: 1,
        requestId: "request-b",
        alternates: [
          {
            content: contentA,
            model: "deepseek-v4-pro-0813",
            usage: null,
            created_at: "",
            generationSequence: 0,
            requestId: "request-a",
          },
          {
            content: contentB,
            model: "deepseek-v4-pro-0813",
            usage: null,
            created_at: "",
            generationSequence: 1,
            requestId: "request-b",
          },
        ],
      }),
      scope(1, "request-b")
    );
    assert.equal(text, contentB);
    assert.equal(visibleAssistantDisplayCharCount(text ?? ""), 3480);
    assert.notEqual(text, contentA);
  });

  it("C — failed regen B with only A persisted fails closed instead of inheriting A", () => {
    const contentA = "가".repeat(3214);
    const text = resolveAdminReceiptPersistedFinalText(
      row({
        content: contentA,
        activeVariant: 0,
        requestId: "request-a",
        alternates: [
          {
            content: contentA,
            model: "deepseek-v4-pro-0813",
            usage: null,
            created_at: "",
            generationSequence: 0,
            requestId: "request-a",
          },
        ],
      }),
      scope(1, "request-b")
    );
    assert.equal(text, null);
  });

  it("D — missing persisted text evidence is null", () => {
    assert.equal(
      resolveAdminReceiptPersistedFinalText(
        row({ content: "", requestId: null }),
        scope(0, null)
      ),
      null
    );
  });
});
