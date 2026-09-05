import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  auxPromptFingerprint,
  buildAuxProviderCallLogInput,
  logAuxProviderCall,
  resolveAuxProviderOwner,
} from "@/lib/auxProviderProvenance";
import { MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS } from "@/lib/deepseekProviderFailover";

describe("auxiliary provider-call provenance owner map", () => {
  it("F — maps every known background requestKind family to its owner", () => {
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
      "background-lorebook-compact-retry",
    ]) {
      assert.equal(resolveAuxProviderOwner({ requestKind: kind }), "ROLLING_SUMMARY", kind);
    }
  });

  it("F — known OTHER_ASYNC requestKinds map to OTHER_ASYNC (explicit allow-list)", () => {
    for (const kind of [
      "background-html-visual-card",
      "background-chat-image-scene-brief",
      "background-prompt-translation",
      "background-appearance-compile",
      "trpg-mechanics-referee",
      "trpg-scenario-draft",
      "trpg-sandbox-blueprint",
    ]) {
      assert.equal(resolveAuxProviderOwner({ requestKind: kind }), "OTHER_ASYNC", kind);
    }
  });

  it("UNKNOWN — an unrecognized requestKind surfaces as UNKNOWN, never OTHER_ASYNC", () => {
    assert.equal(
      resolveAuxProviderOwner({ requestKind: "brand-new-request-kind" }),
      "UNKNOWN"
    );
    assert.equal(resolveAuxProviderOwner({ requestKind: "some-unmapped-kind" }), "UNKNOWN");
  });

  it("UNKNOWN — missing/null requestKind without a ledger owner surfaces as UNKNOWN", () => {
    assert.equal(resolveAuxProviderOwner({ requestKind: null }), "UNKNOWN");
    assert.equal(resolveAuxProviderOwner({ requestKind: undefined }), "UNKNOWN");
    assert.equal(resolveAuxProviderOwner({ requestKind: "   " }), "UNKNOWN");
    assert.equal(resolveAuxProviderOwner({}), "UNKNOWN");
  });

  it("UNKNOWN_OWNER_CAN_SURFACE=true — ledger family does not mask an unknown kind", () => {
    assert.equal(
      resolveAuxProviderOwner({ requestKind: "brand-new", ledgerFamily: "brand-new-family" }),
      "UNKNOWN"
    );
    assert.equal(
      resolveAuxProviderOwner({ requestKind: null, ledgerFamily: "brand-new-family" }),
      "UNKNOWN"
    );
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
});

describe("P0-3 — job id provenance and retry discrimination", () => {
  const messages = [
    { role: "system", content: "STATIC_SYSTEM" },
    { role: "user", content: "USER_TEXT" },
  ];

  it("jobId — explicit durable queue job id is preserved (derived-cache translation)", () => {
    const input = buildAuxProviderCallLogInput({
      model: "gpt-5.6-luna",
      messages,
      requestKind: "background-prompt-translation",
      jobId: "42",
    });
    assert.equal(input.auxOwner, "OTHER_ASYNC");
    assert.equal(input.jobId, "42");
    assert.equal(input.attempt, 1);
    assert.equal(input.isRetry, false);
  });

  it("jobId — same job retried N times keeps jobId, increments attempt, isRetry=true", () => {
    const retries = [1, 2, 3, 4, 5];
    const logs = retries.map((attempt) =>
      buildAuxProviderCallLogInput({
        model: "gpt-5.6-luna",
        messages,
        requestKind: "background-prompt-translation",
        jobId: "42",
        ledgerContext: {
          family: null,
          executionPhase: "async_post_turn",
          chatId: 1,
          assistantMessageId: 2,
          generationRequestId: "gen-1",
          jobAttemptOrdinal: attempt,
        },
      })
    );
    assert.equal(new Set(logs.map((l) => l.jobId)).size, 1);
    assert.deepEqual(logs.map((l) => l.attempt), [1, 2, 3, 4, 5]);
    assert.deepEqual(logs.map((l) => l.isRetry), [false, true, true, true, true]);
  });

  it("jobId — N distinct jobs each called once have distinct jobIds", () => {
    const logs = [10, 11, 12].map((jobId) =>
      buildAuxProviderCallLogInput({
        model: "gpt-5.6-luna",
        messages,
        requestKind: "background-prompt-translation",
        jobId: String(jobId),
        ledgerContext: {
          family: null,
          executionPhase: "async_post_turn",
          chatId: 1,
          assistantMessageId: 2,
          generationRequestId: `gen-${jobId}`,
          jobAttemptOrdinal: 1,
        },
      })
    );
    assert.equal(new Set(logs.map((l) => l.jobId)).size, 3);
    assert.deepEqual(logs.map((l) => l.attempt), [1, 1, 1]);
    assert.deepEqual(logs.map((l) => l.isRetry), [false, false, false]);
  });

  it("jobId — ledger generationRequestId is the fallback stable job discriminator", () => {
    const input = buildAuxProviderCallLogInput({
      model: "gpt-5.6-luna",
      messages,
      requestKind: "background-status-meta-extract",
      ledgerContext: {
        family: "status_meta",
        executionPhase: "async_post_turn",
        chatId: 7,
        assistantMessageId: 8,
        generationRequestId: "req-9",
        jobAttemptOrdinal: 1,
      },
    });
    assert.equal(input.auxOwner, "STATUS_META");
    assert.equal(input.requestId, "req-9");
    assert.equal(input.jobId, "req-9");
    assert.equal(input.chatId, 7);
    assert.equal(input.messageId, 8);
  });

  it("jobId — requestKind retry suffix marks isRetry even with attempt 1", () => {
    const input = buildAuxProviderCallLogInput({
      model: "deepseek-v4-flash",
      messages,
      requestKind: "background-memory-extract-retry",
      ledgerContext: {
        family: null,
        executionPhase: "async_post_turn",
        chatId: 1,
        assistantMessageId: 2,
        generationRequestId: null,
        jobAttemptOrdinal: 1,
      },
    });
    assert.equal(input.auxOwner, "ROLLING_SUMMARY");
    assert.equal(input.isRetry, true);
  });

  it("jobId — absent everywhere stays null", () => {
    const input = buildAuxProviderCallLogInput({
      model: "gpt-5.6-luna",
      messages,
      requestKind: null,
      ledgerContext: null,
    });
    assert.equal(input.auxOwner, "UNKNOWN");
    assert.equal(input.jobId, null);
    assert.equal(input.requestId, null);
  });
});

describe("P0-6 — provenance safety", () => {
  it("fingerprint is stable per (model, messages) and never contains prompt text", () => {
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

  it("log payload carries provenance fields only (no API key, no raw prompt)", () => {
    const input = buildAuxProviderCallLogInput({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "raw user prompt must not be logged" }],
      requestKind: "background-status-widget-extract-volatile-echo-fix",
      ledgerContext: {
        family: "status_widget_extract",
        executionPhase: "sync_post_turn",
        chatId: 1,
        assistantMessageId: 2,
        generationRequestId: "req-3",
        jobAttemptOrdinal: 2,
      },
    });
    assert.equal(input.auxOwner, "STATUS_WIDGET");
    assert.equal(input.attempt, 2);
    assert.equal(input.isRetry, true);
    const serialized = JSON.stringify(input);
    assert.equal(serialized.includes("raw user prompt"), false);
    assert.equal(serialized.includes("Bearer"), false);
    assert.equal(serialized.includes("apiKey"), false);
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
    assert.equal(/shouldRetryEmptyStream/.test(source), false);
    assert.match(source, /fetchOpenRouterChatCompletion/);
  });
});