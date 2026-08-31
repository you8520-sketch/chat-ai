import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  buildTrpgImageSceneDiagnosticsDisplayRows,
  buildTrpgImageSceneDiagnosticsPayload,
  formatTrpgDiagnosticsText,
  resolveTrpgImageSceneDiagnosticsForResponse,
} from "@/lib/trpg/trpgImageSceneDiagnosticsLifecycle";
import { loadTrpgIllustrationScene } from "@/lib/trpg/illustrationCast";
import { resolveTrpgIllustrationSceneFocus } from "@/lib/trpg/trpgAiFocusSelection";
import { ensureTrpgTables } from "@/lib/trpg/schema";

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
    assert.equal(row?.value, formatTrpgDiagnosticsText(""));
    assert.equal(row?.value, "—");
  });
});
