import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { compileJsxComponentSource } from "@/lib/jsxComponent/compile";
import { parseStatusWidgetJson, serializeStatusWidget } from "@/lib/statusWidget";
import { renderStatusWidgetsForTurn } from "@/lib/statusWidget/render";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import {
  createStatusWidgetPreset,
  validateStatusWidgetPresetInput,
} from "@/lib/statusWidgetPresets";
import {
  createStatusWidgetShareFromJson,
  getStatusWidgetShareBySlug,
  importStatusWidgetShareToUserPresets,
  listPublicStatusWidgetShares,
  setStatusWidgetShareVisibility,
  statusWidgetShareApplyPath,
} from "@/lib/statusWidgetShares";
import type { StatusWidget } from "@/lib/statusWidget/types";

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
    assert.equal(created.share.visibility, "unlisted");
    assert.equal(pub!.visibility, "unlisted");
    assert.equal(
      listPublicStatusWidgetShares("newest").some((item) => item.shareSlug === created.share.share_slug),
      false
    );

    const imported = importStatusWidgetShareToUserPresets(902, created.share.share_slug, "내 복사본");
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const row = getDb()
      .prepare("SELECT title, widget_json FROM user_status_widget_presets WHERE id=?")
      .get(imported.presetId) as { title: string; widget_json: string };
    assert.equal(row.title, "내 복사본");
    assert.deepEqual(JSON.parse(row.widget_json), JSON.parse(widgetJson));
    const rendered = renderStatusWidgetsForTurn([
      {
        source: "character",
        widget: parseStatusWidgetJson(row.widget_json)!,
        values: { 시간: "09:00", 장소: "집", 현재상황: "아침" },
      },
    ]);
    assert.match(rendered[0]?.html ?? "", /09:00/);
    assert.equal(rendered[0]?.jsxCompiled, undefined);
  });
});

const JSX_SOURCE = `export default function Board(props) {
  return <div>{props["시간"]}</div>;
}`;

function jsxOnlyWidget(): StatusWidget {
  return {
    version: 1,
    name: "jsx 상태창",
    htmlTemplate: "",
    jsxSource: JSX_SOURCE,
    fields: [{ id: "시간", label: "시간", instruction: "현재 장면의 시각을 짧게 작성한다." }],
    placement: "bottom",
  };
}

function ledgerSnapshot() {
  const db = getDb();
  const logs = db.prepare("SELECT COUNT(*) AS n FROM point_logs").get() as { n: number };
  const tx = db.prepare("SELECT COUNT(*) AS n FROM point_transactions").get() as { n: number };
  return { logs: Number(logs.n), tx: Number(tx.n) };
}

function relativeOrder(sort: "popular" | "newest", slugs: string[]) {
  const wanted = new Set(slugs);
  return listPublicStatusWidgetShares(sort)
    .map((item) => item.shareSlug)
    .filter((slug) => wanted.has(slug));
}

describe("status widget community shares", () => {
  it("round-trips a JSX-only widget through preset, share, apply import, and chat render", () => {
    seedUser(88011, "jsx-sharer");
    seedUser(88012, "jsx-importer");
    const before = ledgerSnapshot();
    const beforePoints = (
      getDb().prepare("SELECT points FROM users WHERE id=?").get(88012) as { points: number }
    ).points;
    const widgetJson = serializeStatusWidget(jsxOnlyWidget());
    assert.equal(validateStatusWidgetPresetInput("JSX 프리셋", widgetJson).ok, true);
    assert.doesNotMatch(widgetJson, /jsxCompiled/);
    const preset = createStatusWidgetPreset(88011, "JSX 프리셋", widgetJson);
    assert.ok(preset);
    const loaded = parseStatusWidgetJson(preset!.widget_json);
    assert.equal(loaded?.htmlTemplate, "");
    assert.equal(loaded?.jsxSource, JSX_SOURCE);
    assert.ok(loaded?.jsxCompiled);
    assert.doesNotMatch(loaded?.jsxCompiled ?? "", /jsxCompiled/);

    const forged = widgetJson.replace(
      `"jsxSource":`,
      `"jsxCompiled":"return function Forged(){ fetch('/api/chat'); }","jsxSource":`
    );
    const created = createStatusWidgetShareFromJson(88011, "JSX 공유", forged, "public");
    assert.ok(!("error" in created));
    if ("error" in created) return;
    assert.equal(created.share.visibility, "public");
    assert.doesNotMatch(created.share.widget_json, /Forged/);
    assert.doesNotMatch(created.share.widget_json, /jsxCompiled/);

    const pub = getStatusWidgetShareBySlug(created.share.share_slug);
    assert.equal(pub?.visibility, "public");
    const imported = importStatusWidgetShareToUserPresets(88012, created.share.share_slug);
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const again = importStatusWidgetShareToUserPresets(88012, created.share.share_slug, "두번째");
    assert.equal(again.ok, true);
    const imports = getDb()
      .prepare("SELECT COUNT(*) AS n FROM status_widget_share_imports WHERE share_id=?")
      .get(created.share.id) as { n: number };
    assert.equal(Number(imports.n), 1);

    const stored = getDb()
      .prepare("SELECT widget_json FROM user_status_widget_presets WHERE id=?")
      .get(imported.presetId) as { widget_json: string };
    const parsed = parseStatusWidgetJson(stored.widget_json);
    assert.ok(parsed?.jsxCompiled);
    assert.doesNotMatch(parsed?.jsxCompiled ?? "", /Forged/);
    const rendered = renderStatusWidgetsForTurn([
      { source: "user", widget: parsed!, values: { 시간: "11:00" } },
    ]);
    assert.equal(rendered.length, 1);
    assert.ok(rendered[0]?.jsxCompiled);
    assert.equal(rendered[0]?.html, "");
    const compiled = compileJsxComponentSource(JSX_SOURCE);
    assert.equal(compiled.ok, true);

    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("unexpected network");
    }) as typeof fetch;
    try {
      listPublicStatusWidgetShares("popular");
      listPublicStatusWidgetShares("newest");
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(ledgerSnapshot(), before);
    const afterPoints = (
      getDb().prepare("SELECT points FROM users WHERE id=?").get(88012) as { points: number }
    ).points;
    assert.equal(afterPoints, beforePoints);

    const listed = listPublicStatusWidgetShares("popular").find(
      (item) => item.shareSlug === created.share.share_slug
    );
    assert.equal(listed?.renderer, "jsx");
    assert.equal(listed?.uniqueImportCount, 1);
    assert.equal(listed?.widget.jsxCompiled, undefined);
  });

  it("rejects widgets with neither HTML nor JSX and keeps HTML-only widgets valid", () => {
    const html = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    assert.equal(validateStatusWidgetPresetInput("HTML", html).ok, true);
    const empty = JSON.stringify({
      version: 1,
      name: "빈 위젯",
      htmlTemplate: "",
      fields: [{ id: "시간", label: "시간", instruction: "시각" }],
      placement: "bottom",
    });
    const rejected = validateStatusWidgetPresetInput("빈 위젯", empty);
    assert.equal(rejected.ok, false);
  });

  it("lists only public shares, orders by unique imports and recency, and drops unpublished rows", () => {
    const owner = 88021;
    const importers = [88022, 88023, 88024];
    seedUser(owner, "gallery-owner");
    for (const id of importers) seedUser(id, `gallery-${id}`);
    const widgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const older = createStatusWidgetShareFromJson(owner, "오래된 인기", widgetJson, "public");
    const newer = createStatusWidgetShareFromJson(owner, "최근 인기", widgetJson, "public");
    const fresh = createStatusWidgetShareFromJson(owner, "최신 한 명", widgetJson, "public");
    const hidden = createStatusWidgetShareFromJson(owner, "링크만", widgetJson);
    assert.ok(!("error" in older) && !("error" in newer) && !("error" in fresh) && !("error" in hidden));
    if ("error" in older || "error" in newer || "error" in fresh || "error" in hidden) return;

    getDb().prepare("UPDATE status_widget_shares SET created_at=? WHERE id=?").run("2020-01-01 00:00:00", older.share.id);
    getDb().prepare("UPDATE status_widget_shares SET created_at=? WHERE id=?").run("2020-01-02 00:00:00", newer.share.id);
    getDb().prepare("UPDATE status_widget_shares SET created_at=? WHERE id=?").run("2020-01-03 00:00:00", fresh.share.id);

    assert.equal(importStatusWidgetShareToUserPresets(importers[0]!, older.share.share_slug).ok, true);
    assert.equal(importStatusWidgetShareToUserPresets(importers[1]!, older.share.share_slug).ok, true);
    assert.equal(importStatusWidgetShareToUserPresets(importers[0]!, older.share.share_slug).ok, true);
    assert.equal(importStatusWidgetShareToUserPresets(importers[0]!, newer.share.share_slug).ok, true);
    assert.equal(importStatusWidgetShareToUserPresets(importers[1]!, newer.share.share_slug).ok, true);
    assert.equal(importStatusWidgetShareToUserPresets(importers[2]!, fresh.share.share_slug).ok, true);

    const slugs = [older.share.share_slug, newer.share.share_slug, fresh.share.share_slug];
    assert.deepEqual(relativeOrder("popular", slugs), [
      newer.share.share_slug,
      older.share.share_slug,
      fresh.share.share_slug,
    ]);
    assert.deepEqual(relativeOrder("newest", slugs), [
      fresh.share.share_slug,
      newer.share.share_slug,
      older.share.share_slug,
    ]);
    assert.equal(
      listPublicStatusWidgetShares("newest").some((item) => item.shareSlug === hidden.share.share_slug),
      false
    );
    assert.ok(getStatusWidgetShareBySlug(hidden.share.share_slug));

    const removed = setStatusWidgetShareVisibility(owner, newer.share.share_slug, "unlisted");
    assert.equal(removed.ok, true);
    assert.deepEqual(relativeOrder("popular", slugs), [older.share.share_slug, fresh.share.share_slug]);
    assert.ok(getStatusWidgetShareBySlug(newer.share.share_slug));
    const stranger = setStatusWidgetShareVisibility(importers[0]!, older.share.share_slug, "unlisted");
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.status, 403);
  });
});
