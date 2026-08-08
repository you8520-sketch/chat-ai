/**
 * Phase B1-B live shadow — create dedicated admin test character + verify
 * numericState definition roundtrip. No production character mutation.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/rp-numeric-shadow-live-setup.ts
 */
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseStatusWidgetJson,
  serializeStatusWidget,
} from "../src/lib/statusWidget";
import { normalizeNumericStateDefinition } from "../src/lib/statusWidget/numericStateDefinition";
import { listShadowEligibleNumericFields } from "../src/lib/rpNumericState/shadowPolicy";

const DB_PATH = process.env.SMOKE_DB_PATH ?? "data/app.db";
const OUT =
  process.env.OUT_DIR ?? "docs/audits/rp-numeric-state-shadow-live";
const ADMIN_EMAIL =
  process.env.SHADOW_ADMIN_EMAIL ??
  `rp.numeric.shadow.admin@example.com`;
const ADMIN_PASSWORD =
  process.env.SHADOW_ADMIN_PASSWORD ?? "rp-numeric-shadow-admin-26";

const PILOT_WIDGET = {
  version: 1 as const,
  name: "B1-B Numeric Shadow Pilot",
  placement: "bottom" as const,
  htmlTemplate: `<div class="sw-pilot">
<div>호감도: {{호감도}}</div>
<div>신뢰: {{신뢰}}</div>
<div>오염도: {{오염도}}</div>
</div>`,
  fields: [
    {
      id: "affection",
      label: "호감도",
      instruction:
        "현재 호감도를 0~100 정수로만 출력. 설명/단위/% 금지. 예: 20",
      initialValue: "20",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 20,
        integer: true,
        maxIncreasePerTurn: 5,
        maxDecreasePerTurn: 5,
      },
    },
    {
      id: "trust",
      label: "신뢰",
      instruction:
        "현재 신뢰를 0~100 정수로만 출력. 설명/단위/% 금지. 예: 30",
      initialValue: "30",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 30,
        integer: true,
        maxIncreasePerTurn: 5,
        maxDecreasePerTurn: 5,
      },
    },
    {
      id: "corruption",
      label: "오염도",
      instruction:
        "현재 오염도를 0~100 정수로만 출력. 설명/단위/% 금지. 예: 0",
      initialValue: "0",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 0,
        integer: true,
        maxIncreasePerTurn: 10,
        maxDecreasePerTurn: 5,
      },
    },
  ],
};

function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function ensureAdminUser(db: Database.Database): { userId: number; email: string } {
  const existing = db
    .prepare("SELECT id, email FROM users WHERE email=?")
    .get(ADMIN_EMAIL) as { id: number; email: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE users SET is_admin=1, is_adult=1, points=CASE WHEN points < 20000 THEN 20000 ELSE points END WHERE id=?`
    ).run(existing.id);
    return { userId: existing.id, email: existing.email };
  }
  // Password hash via app signup preferred; here we only reserve row if missing.
  // Live harness will signup via API when needed.
  return { userId: 0, email: ADMIN_EMAIL };
}

function upsertTestCharacter(db: Database.Database, creatorId: number): number {
  const name = "B1B Numeric Shadow Pilot";
  const serialized = serializeStatusWidget(PILOT_WIDGET);
  const existing = db
    .prepare(
      `SELECT id FROM characters WHERE name=? AND creator_id=? AND visibility='private' LIMIT 1`
    )
    .get(name, creatorId) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE characters
       SET status_widget_json=?,
           status_widget_allow_user_override=0,
           greeting=?,
           system_prompt=?,
           tagline=?,
           description=?,
           moderation_status='approved',
           visibility='private',
           official=0
       WHERE id=?`
    ).run(
      serialized,
      "테스트 캐릭터가 조용히 고개를 끄덕였다. \"오늘은 무엇을 이야기할까.\"",
      "당신은 관찰용 테스트 NPC다. 짧고 명확한 한국어로 응답한다. 상태 수치 메타 언급 금지.",
      "B1-B numeric shadow 전용 (private)",
      "Admin-only numeric shadow pilot character. Not a production listing.",
      existing.id
    );
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO characters (
         name, tagline, description, greeting, system_prompt,
         genre, tags, nsfw, official, emoji, hue, creator_id, creator_name,
         visibility, moderation_status, status_widget_json,
         status_widget_allow_user_override, content_kind
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      name,
      "B1-B numeric shadow 전용 (private)",
      "Admin-only numeric shadow pilot character. Not a production listing.",
      "테스트 캐릭터가 조용히 고개를 끄덕였다. \"오늘은 무엇을 이야기할까.\"",
      "당신은 관찰용 테스트 NPC다. 짧고 명확한 한국어로 응답한다. 상태 수치 메타 언급 금지.",
      "일상",
      "[]",
      0,
      0,
      "🧪",
      200,
      creatorId,
      "shadow-pilot",
      "private",
      "approved",
      serialized,
      0,
      "character"
    );
  return Number(info.lastInsertRowid);
}

function verifyRoundtrip(db: Database.Database, characterId: number) {
  const row = db
    .prepare(`SELECT status_widget_json FROM characters WHERE id=?`)
    .get(characterId) as { status_widget_json: string };
  const parsed = parseStatusWidgetJson(row.status_widget_json);
  if (!parsed) throw new Error("parseStatusWidgetJson failed after store");
  const reserialized = serializeStatusWidget(parsed);
  const parsed2 = parseStatusWidgetJson(reserialized);
  if (!parsed2) throw new Error("reparse after serialize failed");

  const byId = Object.fromEntries(parsed2.fields.map((f) => [f.id, f]));
  const report: Record<string, unknown> = {};
  for (const key of ["affection", "trust", "corruption"] as const) {
    const field = byId[key];
    if (!field?.numericState) {
      throw new Error(`missing numericState for ${key}`);
    }
    const norm = normalizeNumericStateDefinition(field.numericState);
    if (!norm) throw new Error(`normalize failed for ${key}`);
    const original = PILOT_WIDGET.fields.find((f) => f.id === key)!.numericState;
    const origNorm = normalizeNumericStateDefinition(original)!;
    if (JSON.stringify(norm) !== JSON.stringify(origNorm)) {
      throw new Error(`numericState drift for ${key}`);
    }
    report[key] = { exists: true, definition: norm };
  }

  const eligible = listShadowEligibleNumericFields(parsed2);
  if (eligible.length !== 3) {
    throw new Error(`expected 3 eligible fields, got ${eligible.length}`);
  }
  return report;
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  let admin = ensureAdminUser(db);
  if (!admin.userId) {
    // Prefer an existing admin (id=5) as creator if signup not yet done.
    const fallback = db
      .prepare(`SELECT id, email FROM users WHERE is_admin=1 ORDER BY id ASC LIMIT 1`)
      .get() as { id: number; email: string } | undefined;
    if (!fallback) {
      db.close();
      throw new Error(
        "No admin user yet — run live harness signup first, then re-run setup"
      );
    }
    admin = { userId: fallback.id, email: fallback.email };
  }

  const characterId = upsertTestCharacter(db, admin.userId);
  const definitions = verifyRoundtrip(db, characterId);

  // Ensure no numeric tables were touched (read-only check).
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rp_numeric_state%'`
    )
    .all() as Array<{ name: string }>;
  let eventCount = 0;
  let currentCount = 0;
  for (const t of tables) {
    if (t.name === "rp_numeric_state_events") {
      eventCount = (
        db.prepare(`SELECT COUNT(*) AS c FROM rp_numeric_state_events`).get() as {
          c: number;
        }
      ).c;
    }
    if (t.name === "rp_numeric_state_current") {
      currentCount = (
        db.prepare(`SELECT COUNT(*) AS c FROM rp_numeric_state_current`).get() as {
          c: number;
        }
      ).c;
    }
  }

  const setup = {
    admin_user_id: admin.userId,
    admin_email: admin.email,
    character_id: characterId,
    character_name: "B1B Numeric Shadow Pilot",
    visibility: "private",
    production_character_modified: false,
    definitions,
    eligible_pilot_keys: ["affection", "trust", "corruption"],
    numeric_db_rows_at_setup: { current: currentCount, events: eventCount },
    env_recommended: {
      RP_NUMERIC_STATE_SHADOW_ENABLED: "1",
      RP_NUMERIC_STATE_SHADOW_USER_IDS: String(admin.userId),
      RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS: String(characterId),
    },
  };
  save("LIVE_SHADOW_SETUP.md", [
    "# LIVE_SHADOW_SETUP",
    "",
    "```text",
    `admin_user_id = ${setup.admin_user_id}`,
    `character_id = ${setup.character_id}`,
    "visibility = private",
    "production_character_modified = false",
    "definition_roundtrip = PASS",
    "```",
    "",
    "## Env (local pilot only)",
    "",
    "```text",
    `RP_NUMERIC_STATE_SHADOW_ENABLED=1`,
    `RP_NUMERIC_STATE_SHADOW_USER_IDS=${setup.admin_user_id}`,
    `RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS=${setup.character_id}`,
    "```",
    "",
    "## Definitions",
    "",
    "```json",
    JSON.stringify(definitions, null, 2),
    "```",
    "",
  ].join("\n"));
  save("SETUP.json", setup);
  db.close();
  console.log(JSON.stringify(setup, null, 2));
}

main();
