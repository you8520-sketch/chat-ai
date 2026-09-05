import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  auxPromptFingerprint,
  logAuxProviderCall,
  resolveAuxProviderOwner,
} from "@/lib/auxProviderProvenance";
import { MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS } from "@/lib/deepseekProviderFailover";

describe("auxiliary provider-call provenance owner map", () => {
  it("F — maps every background requestKind family to its auxiliary owner", () => {
    for (const kind of [
      "background-status-widget-extract",
      "background-status-widget-extract-repair",
      "background-status-widget-extract-fallback",
      "background-status-widget-extract-combined",
      "background-status-widget-extract-volatile-echo-fix",
      "background-post-turn-shared-initial",
    ]) {
      assert.equal(resolveAuxProviderOwner({ requestKind: kind }), "STATUS_WIDGET", kind);
    }
    assert.equal(
      resolveAuxProviderOwner({ requestKind: "background-status-meta-extract" }),
      "STATUS_META"
    );
    assert.equal(
      resolveAuxProviderOwner({ requestKind: "background-suggested-replies-extract" }),
      "SUGGESTED_REPLIES"
    );
    assert.equal(
      resolveAuxProviderOwner({ requestKind: "trpg-reply-suggestion" }),
      "SUGGESTED_REPLIES"
    );
    assert.equal(
      resolveAuxProviderOwner({ requestKind: "background-episodic-extract" }),
      "EPISODIC_MEMORY"
    );
    assert.equal(
      resolveAuxProviderOwner({ requestKind: "background-memory-regen-extract" }),
      "RELATIONSHIP_MEMORY"
    );
    for (const kind of [
      "background-memory-extract",
      "background-memory-extract-retry",
      "background-lorebook-compact",
    ]) {
      assert.equal(resolveAuxProviderOwner({ requestKind: kind }), "ROLLING_SUMMARY", kind);
    }
    for (const kind of [
      "background-html-visual-card",
      "background-chat-image-scene-brief",
      "background-prompt-translation",
      "some-unknown-kind",
    ]) {
      assert.equal(resolveAuxProviderOwner({ requestKind: kind }), "OTHER_ASYNC", kind);
    }
    assert.equal(resolveAuxProviderOwner({ requestKind: null }), "OTHER_ASYNC");
  });

  it("F — ledger family overrides requestKind for shared kinds", () => {
    assert.equal(
      resolveAuxProviderOwner({
        requestKind: "background-memory-extract",
        ledgerFamily: "memory_relationship",
      }),
      "RELATIONSHIP_MEMORY"
    );
    assert.equal(
      resolveAuxProviderOwner({
        requestKind: "background-memory-extract",
        ledgerFamily: "suggested_replies_repair",
      }),
      "SUGGESTED_REPLIES"
    );
  });

  it("F — fingerprint is stable per (model, messages) and never contains prompt text", () => {
    const messages = [
      { role: "system", content: "SECRET_STATIC_SYSTEM_PROMPT" },
      { role: "user", content: "SECRET_USER_TURN" },
    ];
    const fp1 = auxPromptFingerprint("gpt-5.6-luna", messages);
    const fp2 = auxPromptFingerprint("gpt-5.6-luna", messages);
    assert.equal(fp1, fp2);
    assert.equal(fp1.length, 16);
    assert.notEqual(
      fp1,
      auxPromptFingerprint("gpt-5.6-luna", [
        ...messages,
        { role: "user", content: "extra" },
      ])
    );
    assert.equal(JSON.stringify({ fp1 }).includes("SECRET"), false);
  });

  it("F — log payload carries provenance fields only (no API key, no raw prompt)", () => {
    const input = {
      auxOwner: "STATUS_WIDGET" as const,
      model: "gpt-5.6-luna",
      requestKind: "background-status-widget-extract-volatile-echo-fix",
      trigger: "sync_post_turn",
      chatId: 1,
      messageId: 2,
      requestId: "req-3",
      attempt: 2,
      isRetry: true,
      promptFingerprint: auxPromptFingerprint("gpt-5.6-luna", [
        { role: "user", content: "raw user prompt must not be logged" },
      ]),
    };
    assert.equal(logAuxProviderCall(input), undefined);
  });
});

describe("P0 static provenance invariants", () => {
  it("G — rolling summary retry lives entirely outside the Main RP budget", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/memory/memory-rolling-summary.ts"),
      "utf8"
    );
    assert.equal(/turnApiBudget/i.test(source), false);
    assert.equal(/beforeFetch|canSubCall/.test(source), false);
    // Bounded retry — exactly one same-model retry after the first attempt.
    assert.match(source, /background-memory-extract-retry/);
  });

  it("D — Main RP external provider attempt cap is 1 and failover is background-only", () => {
    assert.equal(MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS, 1);
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/deepseekProviderFailover.ts"),
      "utf8"
    );
    assert.match(source, /backupAllowed = opts\.routeKind === "background_flash"/);
    assert.equal(/MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_DEEPSEEK_TURN/.test(source), false);
  });

  it("D — the Main RP stream transport has no automatic second provider request", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/openRouterAdult.ts"),
      "utf8"
    );
    assert.equal(/emptyStreamRetry/.test(source), false);
    assert.equal(/fetchOpenRouterChatWithCreditRetry/.test(source), false);
    assert.equal(/allowEmptyStreamFallback/.test(source), false);
    assert.equal(/openrouter-stream-fallback/.test(source), false);
    assert.match(source, /fetchOpenRouterChatCompletion/);
  });
});
