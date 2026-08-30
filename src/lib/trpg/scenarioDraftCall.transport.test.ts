import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKGROUND_BACKUP_COMPLETION_MS,
  BACKGROUND_PRIMARY_COMPLETION_MS,
  resolveBackgroundFlashProviderDeadlines,
} from "@/lib/deepseekProviderFailover";
import {
  resolveTrpgAuthoringTransportRequestKind,
  TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND,
  TRPG_SCENARIO_DRAFT_REQUEST_KIND,
} from "./scenarioDraftCall";

describe("TRPG authoring transport requestKind resolver", () => {
  it("T1 sandbox primary → dedicated kind", () => {
    assert.equal(
      resolveTrpgAuthoringTransportRequestKind({
        kind: "sandbox_blueprint",
        stage: "primary",
      }),
      TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND
    );
  });

  it("T2 sandbox repair → scenario-draft kind", () => {
    assert.equal(
      resolveTrpgAuthoringTransportRequestKind({
        kind: "sandbox_blueprint",
        stage: "repair",
      }),
      TRPG_SCENARIO_DRAFT_REQUEST_KIND
    );
  });

  it("T3 creator primary → scenario-draft kind", () => {
    assert.equal(
      resolveTrpgAuthoringTransportRequestKind({
        kind: "scenario_draft",
        stage: "primary",
      }),
      TRPG_SCENARIO_DRAFT_REQUEST_KIND
    );
  });

  it("T4 creator repair → scenario-draft kind", () => {
    assert.equal(
      resolveTrpgAuthoringTransportRequestKind({
        kind: "scenario_draft",
        stage: "repair",
      }),
      TRPG_SCENARIO_DRAFT_REQUEST_KIND
    );
  });
});

describe("background deadline profiles", () => {
  it("D1 sandbox kind + outer 90s → 75/60 deadlines", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND,
        existingTimeoutMs: 90_000,
      }),
      {
        primaryCompletionMs: 75_000,
        backupCompletionMs: 60_000,
      }
    );
  });

  it("D2 sandbox + smaller outer cap → both deadlines respect cap", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND,
        existingTimeoutMs: 50_000,
      }),
      { primaryCompletionMs: 50_000, backupCompletionMs: 50_000 }
    );
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND,
        existingTimeoutMs: 40_000,
      }),
      { primaryCompletionMs: 40_000, backupCompletionMs: 40_000 }
    );
  });

  it("D3 scenario-draft → unchanged 45/45", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: TRPG_SCENARIO_DRAFT_REQUEST_KIND,
        existingTimeoutMs: 120_000,
      }),
      {
        primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.longForm,
        backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.longForm,
      }
    );
  });

  it("D4 memory → unchanged longForm 45/45", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-memory-extract",
      }),
      {
        primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.longForm,
        backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.longForm,
      }
    );
  });

  it("D5 HTML → unchanged longForm 45/45", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-html-visual-card",
        existingTimeoutMs: 240_000,
      }),
      {
        primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.longForm,
        backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.longForm,
      }
    );
  });

  it("D6 TRPG reply → unchanged trpgReply profile", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "trpg-reply-suggestions",
        existingTimeoutMs: 45_000,
      }),
      {
        primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.trpgReply,
        backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.trpgReply,
      }
    );
  });

  it("D7 unknown/short → unchanged short profile", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-chat-image-scene-brief",
      }),
      {
        primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.short,
        backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.short,
      }
    );
  });

  it("raising outer timeout alone does not raise sandbox body above policy cap", () => {
    const at90 = resolveBackgroundFlashProviderDeadlines({
      requestKind: TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND,
      existingTimeoutMs: 90_000,
    });
    const at240 = resolveBackgroundFlashProviderDeadlines({
      requestKind: TRPG_SANDBOX_BLUEPRINT_REQUEST_KIND,
      existingTimeoutMs: 240_000,
    });
    assert.equal(at90.primaryCompletionMs, BACKGROUND_PRIMARY_COMPLETION_MS.sandboxBlueprint);
    assert.equal(at240.primaryCompletionMs, BACKGROUND_PRIMARY_COMPLETION_MS.sandboxBlueprint);
    assert.equal(at90.primaryCompletionMs, at240.primaryCompletionMs);
  });
});
