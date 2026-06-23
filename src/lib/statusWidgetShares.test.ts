import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { serializeStatusWidget } from "@/lib/statusWidget";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import {
  createStatusWidgetShareFromJson,
  getStatusWidgetShareBySlug,
  importStatusWidgetShareToUserPresets,
  statusWidgetShareApplyPath,
} from "@/lib/statusWidgetShares";

function seedUser(id: number, nickname: string) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,0)"
    )
    .run(id, `user${id}@test.local`, nickname, "hash");
}

describe("statusWidgetShares", () => {
  it("creates share slug and imports to another user presets", () => {
    seedUser(901, "sharer");
    seedUser(902, "importer");
    const widgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const created = createStatusWidgetShareFromJson(901, "공유 테스트", widgetJson);
    assert.ok(!("error" in created));
    if ("error" in created) return;

    assert.equal(created.applyPath, statusWidgetShareApplyPath(created.share.share_slug));
    const pub = getStatusWidgetShareBySlug(created.share.share_slug);
    assert.ok(pub);
    assert.equal(pub!.authorNickname, "sharer");
    assert.equal(pub!.title, "공유 테스트");

    const imported = importStatusWidgetShareToUserPresets(902, created.share.share_slug, "내 복사본");
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const row = getDb()
      .prepare("SELECT title, widget_json FROM user_status_widget_presets WHERE id=?")
      .get(imported.presetId) as { title: string; widget_json: string };
    assert.equal(row.title, "내 복사본");
    assert.deepEqual(JSON.parse(row.widget_json), JSON.parse(widgetJson));
  });
});
