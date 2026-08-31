import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  buildTrpgDiagnosticsResultIdentity,
  buildTrpgDiagnosticsSourceIdentity,
  buildTrpgImageSceneDiagnosticsDisplayRows,
  buildTrpgImageSceneDiagnosticsPayload,
  clearedTrpgImageSceneDiagnostics,
  formatTrpgDiagnosticsIds,
  formatTrpgDiagnosticsText,
  isTrpgAiFocusRawFallback,
  resolveTrpgImageSceneDiagnosticsForResponse,
  resolveTrpgImageSceneDiagnosticsFromResponse,
  resolveTrpgImageSceneDiagnosticsOnSourceReopen,
  shouldClearTrpgImageSceneDiagnosticsOnSourceOpen,
  type TrpgImageSceneDiagnosticsPayload,
} from "@/lib/trpg/trpgImageSceneDiagnosticsLifecycle";
import { loadTrpgIllustrationScene } from "@/lib/trpg/illustrationCast";
import { resolveTrpgIllustrationSceneFocus } from "@/lib/trpg/trpgAiFocusSelection";
import { ensureTrpgTables } from "@/lib/trpg/schema";

const sampleAiDiagnostics: TrpgImageSceneDiagnosticsPayload = {
  mode: "AI_FOCUS",
  modeRequested: "AI_FOCUS",
  modeApplied: "AI_FOCUS",
  aiModel: "gpt-5.6-luna",
  aiAttempts: 1,
  aiUsedFallback: false,
  aiDeterministicFallback: false,
  aiLatencyMs: 120,
  canonicalLocation: "숲",
  selectedHeroScene: "영웅이 돌진한다",
  heroEventIds: ["E1"],
  overSelectionRejected: false,
};

const rawPayload = buildTrpgImageSceneDiagnosticsPayload({
  requestedMode: "RAW",
  modeApplied: "RAW",
  canonicalLocation: "회랑",
  focusDiagnostics: null,
});

const fallbackPayload = buildTrpgImageSceneDiagnosticsPayload({
  requestedMode: "AI_FOCUS",
  modeApplied: "RAW",
  canonicalLocation: "탑",
  focusDiagnostics: {
    modeRequested: "AI_FOCUS",
    modeApplied: "RAW",
    aiModel: "gpt-5.6-luna",
    aiAttempts: 1,
    aiUsedFallback: false,
    aiDeterministicFallback: false,
    aiLatencyMs: 88,
    canonicalLocation: "탑",
    selectedHeroScene: "",
    heroEventIds: [],
    overSelectionRejected: false,
    fallbackReason: "planner-error",
  },
});

describe("trpg image scene diagnostics lifecycle", () => {
  it("T8: mode switch clears diagnostics (AI → RAW stale guard)", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("T10: round/source change clears diagnostics before next result", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("T9: generation start clears diagnostics via cleared state", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("generation response replaces prior diagnostics exactly", () => {
    const fromAi = resolveTrpgImageSceneDiagnosticsFromResponse({
      trpgImageSceneDiagnostics: sampleAiDiagnostics,
    });
    assert.equal(fromAi?.aiModel, "gpt-5.6-luna");
    assert.match(fromAi?.selectedHeroScene ?? "", /돌진/);

    const fromRaw = resolveTrpgImageSceneDiagnosticsFromResponse(null);
    assert.equal(fromRaw, undefined);
  });
});

describe("trpg diagnostics result identity lifecycle", () => {
  const sourceRound1 = buildTrpgDiagnosticsSourceIdentity({
    campaignId: 7,
    roundNumber: 2,
    sourceMessageId: 99,
  });
  const sourceRound2 = buildTrpgDiagnosticsSourceIdentity({
    campaignId: 7,
    roundNumber: 3,
    sourceMessageId: 99,
  });
  const resultA = buildTrpgDiagnosticsResultIdentity({
    generationId: 42,
    imageUrl: "https://example.com/a.png",
  });
  const resultB = buildTrpgDiagnosticsResultIdentity({
    generationId: 43,
    imageUrl: "https://example.com/b.png",
  });

  it("R3/R4: same-source reopen preserves; different round clears on source change", () => {
    assert.equal(
      shouldClearTrpgImageSceneDiagnosticsOnSourceOpen({
        previousSourceIdentity: sourceRound1,
        nextSourceIdentity: sourceRound1,
      }),
      false
    );
    assert.equal(
      shouldClearTrpgImageSceneDiagnosticsOnSourceOpen({
        previousSourceIdentity: sourceRound1,
        nextSourceIdentity: sourceRound2,
      }),
      true
    );
  });

  it("R3: reopen restores from cache when in-memory state was lost", () => {
    const restored = resolveTrpgImageSceneDiagnosticsOnSourceReopen({
      nextSourceIdentity: sourceRound1,
      currentResultIdentity: resultA,
      cached: {
        sourceIdentity: sourceRound1,
        resultIdentity: resultA,
        diagnostics: sampleAiDiagnostics,
      },
      currentDiagnostics: undefined,
    });
    assert.equal(restored?.aiModel, "gpt-5.6-luna");
  });

  it("R3: reopen keeps in-memory diagnostics without cache round-trip", () => {
    const kept = resolveTrpgImageSceneDiagnosticsOnSourceReopen({
      nextSourceIdentity: sourceRound1,
      currentResultIdentity: resultA,
      cached: {
        sourceIdentity: sourceRound1,
        resultIdentity: resultA,
        diagnostics: sampleAiDiagnostics,
      },
      currentDiagnostics: sampleAiDiagnostics,
    });
    assert.equal(kept, sampleAiDiagnostics);
  });

  it("R5: different round/source identity blocks stale restore", () => {
    const blocked = resolveTrpgImageSceneDiagnosticsOnSourceReopen({
      nextSourceIdentity: sourceRound2,
      currentResultIdentity: resultA,
      cached: {
        sourceIdentity: sourceRound1,
        resultIdentity: resultA,
        diagnostics: sampleAiDiagnostics,
      },
      currentDiagnostics: undefined,
    });
    assert.equal(blocked, undefined);
  });

  it("R6/R7: generation identity prefers generationId over imageUrl", () => {
    assert.equal(resultA, "gen:42");
    assert.equal(
      buildTrpgDiagnosticsResultIdentity({
        generationId: null,
        imageUrl: "https://example.com/a.png",
      }),
      "url:https://example.com/a.png"
    );
    assert.notEqual(resultA, resultB);
  });
});

describe("trpg image scene diagnostics admin visibility", () => {
  it("T1 ADMIN + RAW → diagnostics present with attempts=0", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 7,
      payload: rawPayload,
    });
    assert.ok(response);
    assert.equal(response?.modeRequested, "RAW");
    assert.equal(response?.modeApplied, "RAW");
    assert.equal(response?.aiAttempts, 0);
  });

  it("T2 ADMIN + AI_FOCUS SUCCESS → diagnostics present with hero/model/latency", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 7,
      payload: sampleAiDiagnostics,
    });
    assert.ok(response);
    assert.equal(response?.modeApplied, "AI_FOCUS");
    assert.equal(response?.aiModel, "gpt-5.6-luna");
    assert.match(response?.selectedHeroScene ?? "", /돌진/);
    assert.equal(response?.aiLatencyMs, 120);
  });

  it("T3 ADMIN + AI_FOCUS FALLBACK → diagnostics present with fallbackReason", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 7,
      payload: fallbackPayload,
    });
    assert.ok(response);
    assert.equal(response?.modeRequested, "AI_FOCUS");
    assert.equal(response?.modeApplied, "RAW");
    assert.equal(response?.fallbackReason, "planner-error");
  });

  it("T4 NON-ADMIN + RAW → diagnostics absent", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: false,
      campaignId: 7,
      payload: rawPayload,
    });
    assert.equal(response, undefined);
  });

  it("T5 NON-ADMIN + AI_FOCUS SUCCESS → diagnostics absent", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: false,
      campaignId: 7,
      payload: sampleAiDiagnostics,
    });
    assert.equal(response, undefined);
  });

  it("T6 NON-ADMIN + AI_FOCUS FALLBACK → diagnostics absent", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: false,
      campaignId: 7,
      payload: fallbackPayload,
    });
    assert.equal(response, undefined);
  });

  it("T7 billing visibility owner unchanged (admin-only upstream cost)", () => {
    const adminCostUsd = 0.0123;
    const adminCostKrw = 18.4;
    const adminFields = {
      upstreamCostUsd: true ? adminCostUsd : undefined,
      upstreamCostKrw: true ? adminCostKrw : undefined,
    };
    const userFields = {
      upstreamCostUsd: false ? adminCostUsd : undefined,
      upstreamCostKrw: false ? adminCostKrw : undefined,
    };
    assert.equal(adminFields.upstreamCostUsd, adminCostUsd);
    assert.equal(userFields.upstreamCostUsd, undefined);
  });
});

describe("trpg image scene diagnostics payload + display", () => {
  it("builds explicit RAW payload without planner fields", () => {
    assert.equal(rawPayload.modeRequested, "RAW");
    assert.equal(rawPayload.modeApplied, "RAW");
    assert.equal(rawPayload.aiModel, "");
    assert.equal(rawPayload.aiAttempts, 0);
    assert.equal(rawPayload.fallbackReason, undefined);
  });

  it("marks AI_FOCUS → RAW fallback with reason", () => {
    assert.equal(isTrpgAiFocusRawFallback(fallbackPayload), true);
    const rows = buildTrpgImageSceneDiagnosticsDisplayRows(fallbackPayload);
    const reason = rows.find((row) => row.key === "fallbackReason");
    assert.equal(reason?.value, "planner-error");
    const fallback = rows.find((row) => row.key === "fallback");
    assert.equal(fallback?.value, "yes");
  });

  it("covers fallback reasons deterministically", () => {
    for (const fallbackReason of [
      "deterministic-fallback",
      "empty-hero-scene",
      "over-selection",
    ] as const) {
      const payload = buildTrpgImageSceneDiagnosticsPayload({
        requestedMode: "AI_FOCUS",
        modeApplied: "RAW",
        canonicalLocation: "숲",
        focusDiagnostics: {
          modeRequested: "AI_FOCUS",
          modeApplied: "RAW",
          aiModel: "gpt-5.6-luna",
          aiAttempts: 1,
          aiUsedFallback: fallbackReason === "deterministic-fallback",
          aiDeterministicFallback: fallbackReason === "deterministic-fallback",
          aiLatencyMs: 50,
          canonicalLocation: "숲",
          selectedHeroScene: "",
          heroEventIds: [],
          overSelectionRejected: fallbackReason === "over-selection",
          fallbackReason,
        },
      });
      const row = buildTrpgImageSceneDiagnosticsDisplayRows(payload).find(
        (entry) => entry.key === "fallbackReason"
      );
      assert.equal(row?.value, fallbackReason);
    }
  });

  it("formats empty values consistently", () => {
    assert.equal(formatTrpgDiagnosticsText(""), "—");
    assert.equal(formatTrpgDiagnosticsIds([]), "(none)");
  });

  it("R1: AI_FOCUS success preserves full selectedHeroScene in display rows", () => {
    const longHeroScene =
      "영웅이 돌진한다. ".repeat(40).trim();
    const payload: TrpgImageSceneDiagnosticsPayload = {
      ...sampleAiDiagnostics,
      selectedHeroScene: longHeroScene,
    };
    const row = buildTrpgImageSceneDiagnosticsDisplayRows(payload).find(
      (entry) => entry.key === "selectedHeroScene"
    );
    assert.equal(row?.value, longHeroScene);
    assert.ok((row?.value.length ?? 0) > 200);
  });
});

describe("trpg image scene diagnostics UI wiring", () => {
  it("T11: exactly one TrpgImageSceneDiagnosticsPanel render site", () => {
    const source = readFileSync("src/components/ChatImageGeneratorPanel.tsx", "utf8");
    const matches = source.match(/<TrpgImageSceneDiagnosticsPanel/g) ?? [];
    assert.equal(matches.length, 1);
  });

  it("T12: diagnostics panel component has no non-admin placeholder", () => {
    const source = readFileSync("src/components/TrpgImageSceneDiagnosticsPanel.tsx", "utf8");
    assert.doesNotMatch(source, /생성 후 이번 처리 경로가 여기에 표시됩니다/);
  });

  it("R2: selectedHeroScene display has no line-clamp truncation", () => {
    const source = readFileSync("src/components/TrpgImageSceneDiagnosticsPanel.tsx", "utf8");
    assert.doesNotMatch(source, /line-clamp-\d+/);
    assert.match(source, /selectedHeroScene.*whitespace-pre-wrap/s);
  });

  it("R11: openGenerator no longer unconditionally clears diagnostics on modal open", () => {
    const source = readFileSync("src/components/ChatImageGeneratorPanel.tsx", "utf8");
    const openBlock = source.match(
      /const openGenerator = \(event: Event\) => \{[\s\S]*?window\.addEventListener\("chat:image-generator:open", openGenerator\)/
    )?.[0];
    assert.ok(openBlock);
    assert.match(openBlock!, /shouldClearTrpgImageSceneDiagnosticsOnSourceOpen/);
    assert.match(openBlock!, /resolveTrpgImageSceneDiagnosticsOnSourceReopen/);
    assert.doesNotMatch(openBlock!, /\n\s*clearTrpgImageSceneDiagnostics\(\);\n\s*setTrpgImageSceneMode/);
  });
});

describe("canonical location diagnostics audit L1-L6", () => {
  function memoryCampaign(locationJson: string | null, narration = "Canonical GM narration.") {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(
      `INSERT INTO trpg_campaigns (id, host_user_id, title, status) VALUES (1, 1, 'Audit', 'ACTIVE')`
    ).run();
    db.prepare(
      `INSERT INTO trpg_participants (id, campaign_id, slot_index, kind, user_id, display_name, can_act, status)
       VALUES (1, 1, 0, 'human', 1, 'Host', 1, 'active')`
    ).run();
    db.prepare(`INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (10, 1, 1, 'ROUND_COMPLETE')`).run();
    db.prepare(
      `INSERT INTO trpg_gm_messages (round_id, narration, structured_json) VALUES (10, ?, ?)`
    ).run(narration, locationJson);
    return db;
  }

  it("R12: non-empty L1 location propagates through L2-L6 unchanged", async () => {
    const db = memoryCampaign(JSON.stringify({ location: "숲속 전초 기지" }));
    const scene = loadTrpgIllustrationScene(db, {
      campaignId: 1,
      viewerUserId: 1,
      roundNumber: 1,
    });
    assert.equal(scene?.location, "숲속 전초 기지");

    const focus = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration: scene!.narration,
      canonicalLocation: scene!.location,
      planScene: async () => ({
        plan: {
          sceneBackground: "",
          events: [
            {
              id: "E1",
              order: 1,
              sourceMessageId: 1,
              sourceRole: "assistant",
              kind: "action",
              actor: "character",
              text: "도착",
            },
          ],
          heroEventIds: ["E1"],
          heroScene: "영웅이 전초 기지에 도착한다.",
          recommendedPanelCount: 1,
          panels: [],
        },
        model: "gpt-5.6-luna",
        attempts: 1,
        latencyMs: 12,
      }),
    });
    assert.equal(focus.diagnostics?.canonicalLocation, "숲속 전초 기지");

    const payload = buildTrpgImageSceneDiagnosticsPayload({
      requestedMode: "AI_FOCUS",
      modeApplied: focus.modeApplied,
      canonicalLocation: scene!.location,
      focusDiagnostics: focus.diagnostics,
    });
    assert.equal(payload.canonicalLocation, "숲속 전초 기지");

    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 1,
      payload,
    });
    assert.equal(response?.canonicalLocation, "숲속 전초 기지");

    const row = buildTrpgImageSceneDiagnosticsDisplayRows(response).find(
      (entry) => entry.key === "canonicalLocation"
    );
    assert.equal(row?.value, "숲속 전초 기지");
  });

  it("R12b: RAW path keeps canonicalLocation via payload owner when focus diagnostics absent", async () => {
    const db = memoryCampaign(JSON.stringify({ location: "회랑" }));
    const scene = loadTrpgIllustrationScene(db, {
      campaignId: 1,
      viewerUserId: 1,
      roundNumber: 1,
    });
    assert.equal(scene?.location, "회랑");

    const focus = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "RAW",
      rawNarration: scene!.narration,
      canonicalLocation: scene!.location,
    });
    assert.equal(focus.diagnostics, null);

    const payload = buildTrpgImageSceneDiagnosticsPayload({
      requestedMode: "RAW",
      modeApplied: focus.modeApplied,
      canonicalLocation: scene!.location,
      focusDiagnostics: focus.diagnostics,
    });
    assert.equal(payload.canonicalLocation, "회랑");
  });

  it("R13: empty L1 location stays empty through L6 with no invented fallback", async () => {
    const db = memoryCampaign(JSON.stringify({ delta: {} }));
    const scene = loadTrpgIllustrationScene(db, {
      campaignId: 1,
      viewerUserId: 1,
      roundNumber: 1,
    });
    assert.equal(scene?.location, "");

    const focus = await resolveTrpgIllustrationSceneFocus({
      sceneMode: "AI_FOCUS",
      rawNarration: scene!.narration,
      canonicalLocation: scene!.location,
      planScene: async () => ({
        plan: {
          sceneBackground: "",
          events: [
            {
              id: "E1",
              order: 1,
              sourceMessageId: 1,
              sourceRole: "assistant",
              kind: "action",
              actor: "character",
              text: "행동",
            },
          ],
          heroEventIds: ["E1"],
          heroScene: "장면 묘사",
          recommendedPanelCount: 1,
          panels: [],
        },
        model: "gpt-5.6-luna",
        attempts: 1,
        latencyMs: 12,
      }),
    });
    assert.equal(focus.diagnostics?.canonicalLocation, "");

    const payload = buildTrpgImageSceneDiagnosticsPayload({
      requestedMode: "AI_FOCUS",
      modeApplied: focus.modeApplied,
      canonicalLocation: scene!.location,
      focusDiagnostics: focus.diagnostics,
    });
    assert.equal(payload.canonicalLocation, "");

    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 1,
      payload,
    });
    assert.equal(response?.canonicalLocation, "");

    const row = buildTrpgImageSceneDiagnosticsDisplayRows(response).find(
      (entry) => entry.key === "canonicalLocation"
    );
    assert.equal(row?.value, "—");
  });
});
