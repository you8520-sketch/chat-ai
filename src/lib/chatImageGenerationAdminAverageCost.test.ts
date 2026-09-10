import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  ensureChatImageGenerationsTable,
} from "@/lib/chatImageGenerationPersistence";
import {
  CHAT_IMAGE_GENERATION_DEFAULT_MODEL,
} from "@/lib/chatImageGeneration";
import {
  CHAT_COMIC_TEMPLATE_ID,
} from "@/lib/chatComicGeneration";
import {
  CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
} from "@/lib/chatLdIllustrationGeneration";

const USER_ID = 990_510_001;
const CHARACTER_ID = 7001;
const PERSONA_ID = 7002;
const CURRENT_MODEL = CHAT_IMAGE_GENERATION_DEFAULT_MODEL;
// Decommissioned template IDs retained only for legacy history classification.
const LEGACY_SD_TEMPLATE = "gift_box_duo";
const LEGACY_EMOTICON_TEMPLATE = "emoticon_grid_9";
const LEGACY_PERSONA_TEMPLATE = "persona_portrait_ld";
const OTHER_MODEL = "other-image-model";

function insertGeneration(opts: {
  templateId: string;
  model: string;
  upstreamCostUsd: number;
  optionsJson?: Record<string, unknown>;
}): void {
  const optionsJson = opts.optionsJson ?? {};
  getDb()
    .prepare(
      `INSERT INTO chat_image_generations (
         user_id, chat_id, character_id, persona_id, template_id, model,
         options_json, result_url, upstream_cost_usd, charged_points,
         exchange_rate_krw_per_usd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      USER_ID,
      null,
      CHARACTER_ID,
      PERSONA_ID,
      opts.templateId,
      opts.model,
      JSON.stringify(optionsJson),
      `/uploads/test-${opts.templateId}.webp`,
      opts.upstreamCostUsd,
      180,
      1400
    );
}

/**
 * Extract the admin average-cost statement + binding args straight from the
 * live route source. This is the canonical owner: it proves binding parity
 * against the exact SQL that canSeeCost=true executes at runtime.
 */
function extractAdminAverageCostQuery(): {
  sql: string;
  bindings: unknown[];
} {
  const route = readFileSync("src/app/api/chat/image-generation/route.ts", "utf8");
  // Locate the admin average-cost statement specifically (the one that
  // aggregates upstream_cost_usd). Do not match the latestResult SELECT.
  const avgIndex = route.indexOf("AVG(upstream_cost_usd)");
  assert.ok(avgIndex >= 0, "route contains the admin average-cost statement");
  const prepareIndex = route.lastIndexOf(".prepare(", avgIndex);
  assert.ok(prepareIndex >= 0, "average statement is prepared");
  const sqlStart = route.indexOf("`", prepareIndex);
  assert.ok(sqlStart >= 0, "prepare opens a template literal");
  const sqlEnd = route.indexOf("`", sqlStart + 1);
  const sql = route.slice(sqlStart + 1, sqlEnd);
  assert.match(sql, /SELECT template_id/);
  assert.match(sql, /AVG\(upstream_cost_usd\)/);
  assert.match(sql, /template_id IN/);
  const allIndex = route.indexOf(".all(", sqlEnd);
  assert.ok(allIndex >= 0, "route binds the statement with .all(");
  const argsStart = allIndex + ".all(".length;
  const argsEnd = route.indexOf(")", argsStart);
  const argsText = route.slice(argsStart, argsEnd);
  const rawArgs = argsText
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  // Resolve the canonical template identifier tokens to their constant values
  // exactly as the route resolves them (source of truth).
  const templateIdValues: Record<string, string> = {
    CHAT_COMIC_TEMPLATE_ID,
    CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
  };
  const bindings = rawArgs.map((token) => {
    const clean = token.replace(/;$/, "").trim();
    if (clean in templateIdValues) return templateIdValues[clean];
    if (clean === "currentImageModel") return CURRENT_MODEL;
    return clean;
  });
  assert.ok(bindings.length >= 5, "expected at least 5 bindings in the admin query");
  return { sql, bindings };
}

function placeholderCount(sql: string): number {
  // Count '?' placeholders; this statement has no string literal containing '?'.
  return (sql.match(/\?/g) ?? []).length;
}

describe("chat image admin average-cost query binding parity", () => {
  before(() => {
    ensureChatImageGenerationsTable();
    getDb().prepare("DELETE FROM chat_image_generations WHERE user_id = ?").run(USER_ID);
    insertGeneration({
      templateId: CHAT_COMIC_TEMPLATE_ID,
      model: CURRENT_MODEL,
      upstreamCostUsd: 0.0123,
      optionsJson: { mode: "comic", panelCount: 4, quality: "medium" },
    });
    insertGeneration({
      templateId: CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
      model: CURRENT_MODEL,
      upstreamCostUsd: 0.0089,
      optionsJson: { mode: "illustration", quality: "medium" },
    });
    insertGeneration({
      templateId: LEGACY_SD_TEMPLATE,
      model: CURRENT_MODEL,
      upstreamCostUsd: 0.0044,
      optionsJson: { mode: "sd", quality: "medium" },
    });
    insertGeneration({
      templateId: LEGACY_EMOTICON_TEMPLATE,
      model: CURRENT_MODEL,
      upstreamCostUsd: 0.0033,
      optionsJson: { mode: "emoticon", quality: "medium" },
    });
    insertGeneration({
      templateId: LEGACY_PERSONA_TEMPLATE,
      model: CURRENT_MODEL,
      upstreamCostUsd: 0.0055,
      optionsJson: { mode: "persona", quality: "medium" },
    });
    insertGeneration({
      templateId: CHAT_COMIC_TEMPLATE_ID,
      model: OTHER_MODEL,
      upstreamCostUsd: 0.0999,
      optionsJson: { mode: "comic", panelCount: 4, quality: "medium" },
    });
  });

  after(() => {
    getDb().prepare("DELETE FROM chat_image_generations WHERE user_id = ?").run(USER_ID);
  });

  it("placeholder count equals binding count (admin runtime never throws)", () => {
    const { sql, bindings } = extractAdminAverageCostQuery();
    assert.equal(
      placeholderCount(sql),
      bindings.length,
      `SQL placeholder count (${placeholderCount(sql)}) must equal binding count (${bindings.length})`
    );
    assert.doesNotMatch(sql, /template_id IN \(\?, \?, \?\)/);
    assert.match(sql, /template_id IN \(\?, \?\)/);
  });

  it("executes against a real SQLite DB without a binding error and aggregates only canonical production templates", () => {
    const { sql, bindings } = extractAdminAverageCostQuery();
    const rows = getDb().prepare(sql).all(...bindings) as Array<{
      template_id: string;
      panel_count: number | null;
      average_cost_usd: number;
      sample_count: number;
    }>;
    // No throw above = binding parity holds. Now verify the aggregate rows.
    const byTemplate = new Map(rows.map((row) => [row.template_id, row]));
    const comic = byTemplate.get(CHAT_COMIC_TEMPLATE_ID);
    const illustration = byTemplate.get(CHAT_LD_ILLUSTRATION_TEMPLATE_ID);
    assert.ok(comic, "current-model comic row aggregated");
    assert.equal(comic.sample_count, 1);
    assert.ok(Math.abs(comic.average_cost_usd - 0.0123) < 1e-9);
    assert.ok(illustration, "current-model illustration row aggregated");
    assert.equal(illustration.sample_count, 1);
    assert.ok(Math.abs(illustration.average_cost_usd - 0.0089) < 1e-9);
    // Decommissioned legacy templates must be excluded from current averages.
    assert.equal(byTemplate.has(LEGACY_SD_TEMPLATE), false);
    assert.equal(byTemplate.has(LEGACY_EMOTICON_TEMPLATE), false);
    assert.equal(byTemplate.has(LEGACY_PERSONA_TEMPLATE), false);
    // Unrelated model row excluded by the model filter.
    assert.equal(comic.sample_count, 1, "other-model comic row excluded");
  });

  it("canonical production templates are exactly comic + illustration", () => {
    const { bindings } = extractAdminAverageCostQuery();
    const inClauseArgs = bindings.slice(3);
    assert.deepEqual(inClauseArgs, [
      CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
      CHAT_COMIC_TEMPLATE_ID,
    ]);
    assert.equal(inClauseArgs.length, 2);
  });
});