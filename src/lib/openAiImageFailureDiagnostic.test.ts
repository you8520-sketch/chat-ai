import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatOpenAiImageFailureDiagnosticForAdmin,
  parseOpenAiImageFailureDiagnostic,
} from "@/lib/openAiImageFailureDiagnostic";

describe("openAiImageFailureDiagnostic parsing", () => {
  it("R2 preserves moderation stage when upstream returns it", () => {
    const diagnostic = parseOpenAiImageFailureDiagnostic({
      httpStatus: 400,
      responseHeaders: new Headers(),
      responseBody: {
        error: {
          message: "rejected by the safety system",
          type: "invalid_request_error",
          code: "content_policy_violation",
          moderation_stage: "output",
        },
      },
      attemptStartedAt: "2026-09-02T10:00:00.000Z",
      attemptFinishedAt: "2026-09-02T10:00:01.000Z",
      model: "gpt-image-2",
      size: "800x1200",
      quality: "medium",
      referenceCount: 3,
      prompt: "test prompt",
    });
    assert.equal(diagnostic.moderationStage, "output");
    assert.equal(diagnostic.providerChargeEvidence, "usage_absent");
    assert.equal(diagnostic.computedCostUsd, null);
  });

  it("R4 does not invent moderation stage when absent", () => {
    const diagnostic = parseOpenAiImageFailureDiagnostic({
      httpStatus: 400,
      responseHeaders: new Headers(),
      responseBody: {
        error: {
          message: "Unknown provider failure",
          type: "invalid_request_error",
        },
      },
      attemptStartedAt: "2026-09-02T10:00:00.000Z",
      attemptFinishedAt: "2026-09-02T10:00:01.000Z",
      model: "gpt-image-2",
      size: "800x1200",
      quality: "medium",
      referenceCount: 1,
      prompt: "x",
    });
    assert.equal(diagnostic.moderationStage, null);
  });

  it("R3 computes cost when error response includes usage", () => {
    const diagnostic = parseOpenAiImageFailureDiagnostic({
      httpStatus: 400,
      responseHeaders: new Headers(),
      responseBody: {
        error: { message: "rejected by the safety system" },
        usage: {
          input_tokens_details: { image_tokens: 100, text_tokens: 20 },
          output_tokens: 200,
        },
      },
      attemptStartedAt: "2026-09-02T10:00:00.000Z",
      attemptFinishedAt: "2026-09-02T10:00:01.000Z",
      model: "gpt-image-2",
      size: "800x1200",
      quality: "medium",
      referenceCount: 2,
      prompt: "prompt",
    });
    assert.equal(diagnostic.hasUsageEvidence, true);
    assert.equal(diagnostic.providerChargeEvidence, "usage_present");
    assert.ok(diagnostic.computedCostUsd != null && diagnostic.computedCostUsd > 0);
  });

  it("R7 stores provider request id from response header", () => {
    const headers = new Headers({ "x-request-id": "req_abc123" });
    const diagnostic = parseOpenAiImageFailureDiagnostic({
      httpStatus: 400,
      responseHeaders: headers,
      responseBody: { error: { message: "rejected by the safety system" } },
      attemptStartedAt: "2026-09-02T10:00:00.000Z",
      attemptFinishedAt: "2026-09-02T10:00:01.000Z",
      model: "gpt-image-2",
      size: "800x1200",
      quality: "medium",
      referenceCount: 1,
      prompt: "p",
    });
    assert.equal(diagnostic.providerRequestId, "req_abc123");
  });

  it("R8 leaves request id null when absent", () => {
    const diagnostic = parseOpenAiImageFailureDiagnostic({
      httpStatus: 400,
      responseHeaders: new Headers(),
      responseBody: { error: { message: "rejected by the safety system" } },
      attemptStartedAt: "2026-09-02T10:00:00.000Z",
      attemptFinishedAt: "2026-09-02T10:00:01.000Z",
      model: "gpt-image-2",
      size: "800x1200",
      quality: "medium",
      referenceCount: 1,
      prompt: "p",
    });
    assert.equal(diagnostic.providerRequestId, null);
  });

  it("admin formatter excludes raw prompt and keeps billing evidence enum", () => {
    const admin = formatOpenAiImageFailureDiagnosticForAdmin(
      parseOpenAiImageFailureDiagnostic({
        httpStatus: 400,
        responseHeaders: new Headers({ "x-request-id": "req_1" }),
        responseBody: {
          error: {
            message: "rejected by the safety system safety_violations=[self-harm]",
            code: "content_policy_violation",
          },
        },
        attemptStartedAt: "2026-09-02T10:00:00.000Z",
        attemptFinishedAt: "2026-09-02T10:00:01.000Z",
        model: "gpt-image-2",
        size: "800x1200",
        quality: "medium",
        referenceCount: 2,
        prompt: "secret explicit scene text",
      })
    );
    assert.equal(admin.billingEvidence, "usage_absent");
    assert.equal(admin.computedCostUsd, null);
    assert.equal(admin.usageReturned, false);
    assert.deepEqual(admin.safetyCategories, ["self-harm"]);
    assert.ok(!JSON.stringify(admin).includes("secret explicit scene text"));
    assert.equal(admin.promptHash != null, true);
  });
});
