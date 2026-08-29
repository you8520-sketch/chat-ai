import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { ACTION_STAT_PREFS, pickStatForAction } from "./actionTypes";
import { createTrpgCampaign, EVEN_STATS } from "./engineCreate";
import { normalizeScenarioTemplateInput } from "./scenarioTypes";
import { ensureTrpgTables } from "./schema";
import { loadScenarioTemplate, rowToScenarioTemplate, updateScenarioTemplate } from "./scenarioTemplates";
import {
  DEFAULT_TRPG_POINT_POOL,
  DEFAULT_TRPG_STAT_DEFS,
  DEFAULT_TRPG_STAT_KEYS,
  TRPG_CANONICAL_STAT_KEYS,
  TRPG_LEGACY_STAT_COMPAT_CATALOG,
  TRPG_LEGACY_STAT_KEYS,
  TRPG_STAT_CATALOG,
  TRPG_STAT_MAX,
  TRPG_STAT_MIN,
  TRPG_STAT_POOL_BONUS,
  catalogEntry,
  defsFromKeys,
  deriveMaxHpFromValues,
  isCanonicalStatKey,
  parseCanonicalStatKeys,
  parseStatKeys,
  preservedLegacyStatKeysFromStored,
  pointPoolFor,
  resolveCampaignStatDefs,
} from "./stats";

const CANONICAL = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
  "spd",
  "per",
  "wil",
  "lck",
  "tec",
  "ins",
  "res",
  "foc",
  "surv",
  "san",
  "mag",
  "fth",
] as const;

const LEGACY = [
  "app",
  "edu",
  "siz",
  "com",
  "pre",
  "hon",
  "emp",
  "inf",
  "occ",
  "acc",
  "grd",
  "rec",
] as const;

describe("TRPG canonical 18-stat vocabulary", () => {
  it("exposes exactly the canonical 18 in deterministic order", () => {
    assert.deepEqual(TRPG_CANONICAL_STAT_KEYS, CANONICAL);
    assert.deepEqual(
      TRPG_STAT_CATALOG.map((row) => row.key),
      [...CANONICAL]
    );
    assert.equal(TRPG_STAT_CATALOG.length, 18);
    assert.deepEqual(TRPG_LEGACY_STAT_KEYS, LEGACY);
    assert.deepEqual(
      TRPG_LEGACY_STAT_COMPAT_CATALOG.map((row) => row.key),
      [...LEGACY]
    );
    for (const key of LEGACY) {
      assert.equal(isCanonicalStatKey(key), false);
      assert.equal(
        TRPG_STAT_CATALOG.some((row) => row.key === key),
        false
      );
      assert.ok(catalogEntry(key), `legacy ${key} must remain readable`);
    }
    for (const key of CANONICAL) {
      assert.equal(isCanonicalStatKey(key), true);
    }
  });

  it("keeps ACTION_STAT_PREFS on canonical keys only", () => {
    const used = Object.values(ACTION_STAT_PREFS).flat();
    for (const key of used) {
      assert.ok(isCanonicalStatKey(key), `${key} is not canonical`);
    }
    assert.deepEqual(ACTION_STAT_PREFS.attack, ["str", "mag", "spd", "dex", "foc"]);
    assert.deepEqual(ACTION_STAT_PREFS.defend, ["con", "res", "wil", "dex"]);
    assert.deepEqual(ACTION_STAT_PREFS.investigate, ["int", "per", "ins", "tec", "wis"]);
    assert.deepEqual(ACTION_STAT_PREFS.persuade, ["cha", "wis", "wil"]);
    assert.deepEqual(ACTION_STAT_PREFS.stealth, ["dex", "spd", "surv", "tec", "lck"]);
    assert.deepEqual(ACTION_STAT_PREFS.support, ["str", "dex", "tec", "wis", "int", "fth", "wil", "foc"]);
    assert.deepEqual(ACTION_STAT_PREFS.use_item, ["int", "tec", "foc", "mag", "dex"]);
    assert.deepEqual(ACTION_STAT_PREFS.free, ["dex", "foc", "ins", "int", "str"]);
  });

  it("A. new scenario input drops legacy keys instead of storing them", () => {
    const created = normalizeScenarioTemplateInput({
      title: "신규",
      content: "새 시나리오",
      statKeys: ["str", "acc", "siz", "mag"],
    });
    assert.deepEqual(created.statKeys, ["str", "mag"]);
    assert.equal(created.statKeys.some((key) => (LEGACY as readonly string[]).includes(key)), false);
    assert.deepEqual(parseCanonicalStatKeys(["acc", "grd", "siz"]), [...DEFAULT_TRPG_STAT_KEYS]);
    assert.deepEqual(parseCanonicalStatKeys(["acc", "grd", "siz"], { fallbackToDefault: false }), []);
    assert.deepEqual(preservedLegacyStatKeysFromStored(["str", "acc", "siz"]), ["siz", "acc"]);
  });

  it("B. stored mixed canonical+legacy keys survive load", () => {
    const loaded = parseStatKeys(["str", "acc", "siz"]);
    assert.deepEqual(loaded, ["str", "siz", "acc"]);
    const defs = resolveCampaignStatDefs([
      { key: "str", min: 1, max: 10 },
      { key: "acc", min: 1, max: 10 },
      { key: "siz", min: 1, max: 10 },
    ]);
    assert.deepEqual(
      defs.map((d) => d.key),
      ["str", "siz", "acc"]
    );
    assert.ok(defs.every((d) => d.min === TRPG_STAT_MIN && d.max === TRPG_STAT_MAX));
  });

  it("C. legacy-only stored scenario does not silently become the default 6", () => {
    const loaded = parseStatKeys(["acc", "grd", "siz"]);
    assert.deepEqual(loaded, ["siz", "acc", "grd"]);
    assert.notDeepEqual(loaded, [...DEFAULT_TRPG_STAT_KEYS]);
    const defs = defsFromKeys(loaded);
    assert.deepEqual(
      defs.map((d) => d.key),
      ["siz", "acc", "grd"]
    );
  });

  it("D. legacy siz HP fallback stays", () => {
    assert.equal(deriveMaxHpFromValues({ siz: 9 }), 45);
    assert.equal(deriveMaxHpFromValues({ con: 8, siz: 9 }), 40);
    assert.ok(catalogEntry("siz")?.hpSource);
  });

  it("E. a new default sheet does not invent legacy keys", () => {
    assert.deepEqual(
      DEFAULT_TRPG_STAT_DEFS.map((d) => d.key),
      ["str", "dex", "con", "int", "wis", "cha"]
    );
    for (const key of LEGACY) {
      assert.equal(
        DEFAULT_TRPG_STAT_DEFS.some((d) => d.key === key),
        false
      );
    }
    assert.equal(DEFAULT_TRPG_POINT_POOL, 6 * TRPG_STAT_MIN + TRPG_STAT_POOL_BONUS);
    assert.equal(TRPG_STAT_MIN, 5);
    assert.equal(TRPG_STAT_MAX, 15);
    assert.equal(pointPoolFor(DEFAULT_TRPG_STAT_DEFS), DEFAULT_TRPG_POINT_POOL);
  });

  it("loads a persisted legacy-only template row without rewriting it", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(
      `INSERT INTO trpg_scenario_templates
        (creator_id, title, summary, content, visibility, start_location, start_inventory_json,
         default_pc_stats_json, stat_keys_json, npcs_json, character_ids_json, genres, updated_at)
       VALUES (1, '유산', '', '본문', 'private', '', '[]', '', ?, '[]', '[]', '[]', datetime('now'))`
    ).run(JSON.stringify(["acc", "grd", "siz"]));
    const row = db.prepare(`SELECT * FROM trpg_scenario_templates WHERE id=1`).get() as Parameters<
      typeof rowToScenarioTemplate
    >[0];
    const template = rowToScenarioTemplate(row);
    assert.deepEqual(template.statKeys, ["siz", "acc", "grd"]);
    const raw = db.prepare(`SELECT stat_keys_json FROM trpg_scenario_templates WHERE id=1`).get() as {
      stat_keys_json: string;
    };
    assert.deepEqual(JSON.parse(raw.stat_keys_json), ["acc", "grd", "siz"]);
    db.close();
  });

  it("keeps creator UI and draft prompt off the legacy catalog", () => {
    const editor = fs.readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /TRPG_STAT_CATALOG\.map/);
    assert.doesNotMatch(editor, /TRPG_LEGACY_STAT_COMPAT_CATALOG/);
    const draft = fs.readFileSync("src/lib/trpg/scenarioDraft.ts", "utf8");
    assert.doesNotMatch(draft, /TRPG_LEGACY_STAT_COMPAT_CATALOG/);
    assert.doesNotMatch(draft, /TRPG_STAT_CATALOG/);
  });

  it("does not change pickStatForAction fallbacks on a default 6-stat sheet", () => {
    assert.equal(
      pickStatForAction({ actionType: "attack", selectedStat: null, body: "", defs: DEFAULT_TRPG_STAT_DEFS }),
      "str"
    );
    assert.equal(
      pickStatForAction({ actionType: "defend", selectedStat: null, body: "", defs: DEFAULT_TRPG_STAT_DEFS }),
      "con"
    );
    assert.equal(
      pickStatForAction({ actionType: "investigate", selectedStat: null, body: "", defs: DEFAULT_TRPG_STAT_DEFS }),
      "int"
    );
    assert.equal(
      pickStatForAction({ actionType: "persuade", selectedStat: null, body: "", defs: DEFAULT_TRPG_STAT_DEFS }),
      "cha"
    );
    assert.equal(
      pickStatForAction({ actionType: "support", selectedStat: null, body: "", defs: DEFAULT_TRPG_STAT_DEFS }),
      "str"
    );
  });

  it("can still create a default-sheet campaign after the catalog split", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    const scenario = db
      .prepare(`SELECT stat_definitions_json FROM trpg_scenarios WHERE campaign_id=?`)
      .get(campaignId) as { stat_definitions_json: string };
    const keys = (JSON.parse(scenario.stat_definitions_json) as { key: string }[]).map((row) => row.key);
    assert.deepEqual(keys, ["str", "dex", "con", "int", "wis", "cha"]);
    assert.ok(EVEN_STATS.str);
    db.close();
  });

  it("TEST 1: title-only update preserves mixed stored str/acc/siz", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const id = insertStoredScenario(db, { statKeys: ["str", "acc", "siz"] });
    updateScenarioTemplate(db, id, 1, {
      title: "제목만 수정",
      content: "본문",
      statKeys: ["str", "acc", "siz"],
      defaultPcStats: null,
    });
    const template = loadUpdated(db, id);
    assert.ok(template.statKeys.includes("str"));
    assert.ok(template.statKeys.includes("acc"));
    assert.ok(template.statKeys.includes("siz"));
    assert.equal(template.title, "제목만 수정");
    db.close();
  });

  it("TEST 2: legacy-only edit/save does not invent the default 6", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const id = insertStoredScenario(db, { statKeys: ["acc", "grd", "siz"] });
    updateScenarioTemplate(db, id, 1, {
      title: "무관한 수정",
      content: "본문",
      statKeys: ["acc", "grd", "siz"],
      defaultPcStats: null,
    });
    const template = loadUpdated(db, id);
    assert.deepEqual(template.statKeys, ["siz", "acc", "grd"]);
    for (const key of DEFAULT_TRPG_STAT_KEYS) {
      assert.equal(template.statKeys.includes(key), false);
    }
    db.close();
  });

  it("TEST 3: unrelated save keeps stored legacy NPC stats", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const npc = {
      name: "경비",
      description: "문 앞",
      greeting: "멈춰",
      systemPrompt: "경계한다",
      stats: { acc: 11, siz: 9 },
    };
    const id = insertStoredScenario(db, {
      statKeys: ["acc", "siz"],
      npcs: [npc],
    });
    updateScenarioTemplate(db, id, 1, {
      title: "제목만",
      content: "본문",
      statKeys: ["acc", "siz"],
      npcs: [npc],
      defaultPcStats: null,
    });
    const template = loadUpdated(db, id);
    assert.equal(template.npcs[0]?.stats?.acc, 11);
    assert.equal(template.npcs[0]?.stats?.siz, 9);
    db.close();
  });

  it("TEST 4: editor null defaultPcStats still keeps stored legacy values", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const id = insertStoredScenario(db, {
      statKeys: ["acc", "siz"],
      defaultPcStats: { acc: 10, siz: 8 },
    });
    updateScenarioTemplate(db, id, 1, {
      title: "제목만",
      content: "본문",
      statKeys: ["acc", "siz"],
      defaultPcStats: null,
    });
    const template = loadUpdated(db, id);
    assert.equal(template.defaultPcStats?.acc, 10);
    assert.equal(template.defaultPcStats?.siz, 8);
    db.close();
  });

  it("TEST 5: PATCH cannot inject a new legacy key into a canonical-only row", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const id = insertStoredScenario(db, { statKeys: ["str"] });
    updateScenarioTemplate(db, id, 1, {
      title: "주입 시도",
      content: "본문",
      statKeys: ["str", "acc"],
      defaultPcStats: null,
    });
    const template = loadUpdated(db, id);
    assert.ok(template.statKeys.includes("str"));
    assert.equal(template.statKeys.includes("acc"), false);
    db.close();
  });

  it("TEST 6: turning off a canonical key still keeps preserved legacy keys", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const id = insertStoredScenario(db, { statKeys: ["str", "acc", "siz"] });
    updateScenarioTemplate(db, id, 1, {
      title: "힘 해제",
      content: "본문",
      statKeys: [],
      defaultPcStats: null,
    });
    const template = loadUpdated(db, id);
    assert.equal(template.statKeys.includes("str"), false);
    assert.ok(template.statKeys.includes("acc"));
    assert.ok(template.statKeys.includes("siz"));
    db.close();
  });
});

function insertStoredScenario(
  db: Database.Database,
  opts: {
    statKeys: string[];
    title?: string;
    defaultPcStats?: Record<string, number> | null;
    npcs?: unknown;
  }
): number {
  const info = db
    .prepare(
      `INSERT INTO trpg_scenario_templates
        (creator_id, title, summary, content, visibility, start_location, start_inventory_json,
         default_pc_stats_json, stat_keys_json, npcs_json, character_ids_json, genres, updated_at)
       VALUES (1, ?, '', '본문', 'private', '', '[]', ?, ?, ?, '[]', '[]', datetime('now'))`
    )
    .run(
      opts.title ?? "유산",
      opts.defaultPcStats ? JSON.stringify(opts.defaultPcStats) : "",
      JSON.stringify(opts.statKeys),
      JSON.stringify(opts.npcs ?? [])
    );
  return Number(info.lastInsertRowid);
}

function loadUpdated(db: Database.Database, id: number) {
  const row = loadScenarioTemplate(db, id);
  assert.ok(row);
  return rowToScenarioTemplate(row);
}
