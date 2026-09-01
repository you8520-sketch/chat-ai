import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("persona canonical status-widget selection", () => {
  it("resolves the current preset definition instead of copying it into a chat", () => {
    const source = readFileSync(new URL("./userPersonas.ts", import.meta.url), "utf8");
    assert.match(source, /active_status_widget_preset_id/);
    assert.match(source, /preset\.widget_json/);
    assert.match(source, /preset\.id=user_personas\.active_status_widget_preset_id/);
    assert.match(source, /AS active_status_widget_json/);
  });

  it("enforces ownership on selection and clears references when a preset is deleted", () => {
    const source = readFileSync(
      new URL("./statusWidgetPresets.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /SELECT id FROM user_personas WHERE id=\? AND user_id=\?/);
    assert.match(source, /getStatusWidgetPresetById\(userId, presetId\)/);
    assert.match(source, /SET active_status_widget_preset_id=NULL/);
    assert.match(source, /WHERE user_id=\? AND active_status_widget_preset_id=\?/);
  });

  it("offers one canonical selection per persona, including none", () => {
    const source = readFileSync(
      new URL("../app/persona/PersonaClient.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /사용할 상태창/);
    assert.match(source, /<option value="">사용 안 함<\/option>/);
    assert.match(source, /active_status_widget_preset_id/);
    assert.match(source, /\/status-widget`/);
  });

  it("chat generation derives the next turn from the selected persona definition", () => {
    const source = readFileSync(
      new URL("../app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /selectedPersona\?\.active_status_widget_json/);
    assert.match(source, /statusWidgetModeForDefinitions/);
    assert.doesNotMatch(source, /status_widget_mode|user_status_widget_json/);
  });
});
