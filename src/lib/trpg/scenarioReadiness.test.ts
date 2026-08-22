import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { catalogScenarioById } from "./catalogBrowse";
import { createTrpgCampaign } from "./engineCreate";
import { emptyTrpgScenarioPlan } from "./scenarioPlan";
import {
  isScenarioEditorDirty,
  optionalDepthFilled,
  scenarioEditorSavePayload,
  scenarioEditorSnapshot,
  shouldConfirmScenarioDraftApply,
} from "./scenarioEditorState";
import {
  parseScenarioHandoffId,
  resolveScenarioHandoff,
  scenarioPersistDecision,
  scenarioPlayCtaLabel,
  trpgPlayHref,
} from "./scenarioHandoff";
import {
  evaluateScenarioReadiness,
  FIRST_CREATE_VISIBLE_FIELDS,
} from "./scenarioReadiness";
import { insertScenarioTemplate, loadScenarioTemplate, rowToScenarioTemplate, updateScenarioTemplate } from "./scenarioTemplates";
import { DEFAULT_TRPG_STAT_KEYS } from "./stats";
import { ensureTrpgTables } from "./schema";
import type { TrpgCatalog } from "./catalog";
import type { TrpgScenarioTemplate } from "./scenarioTypes";

function playablePlan() {
  return {
    ...emptyTrpgScenarioPlan(),
    startingSituation: "폐도시에 들어간다",
    centralConflict: "코어와 인간 세력이 충돌한다",
    goal: "코어를 봉쇄한다",
    endingConditions: ["코어를 봉쇄한다"],
  };
}

function emptySnapshot() {
  return {
    title: "",
    summary: "",
    content: "",
    secretContent: "",
    worldId: "" as const,
    visibility: "private" as const,
    startLocation: "",
    inventoryText: "",
    statKeys: [...DEFAULT_TRPG_STAT_KEYS],
    npcs: [] as TrpgScenarioTemplate["npcs"],
    genres: [] as TrpgScenarioTemplate["genres"],
    assets: [] as TrpgScenarioTemplate["assets"],
    plan: emptyTrpgScenarioPlan(),
    characterIds: [] as number[],
  };
}

function catalogWith(scenarios: TrpgScenarioTemplate[]): TrpgCatalog {
  return {
    myWorlds: [],
    publicWorlds: [],
    myScenarios: scenarios.filter((row) => row.creatorId === 1),
    publicScenarios: scenarios.filter((row) => row.visibility === "public"),
    myCharacters: [],
  };
}

describe("TRPG scenario readiness and creator-to-play handoff", () => {
  it("TEST 15: required-to-play spine is playable without optional depth", () => {
    const readiness = evaluateScenarioReadiness({
      title: "폐역",
      content: "",
      scenarioPlan: playablePlan(),
      npcs: [],
    });
    assert.equal(readiness.status, "playable");
    assert.equal(readiness.canPlay, true);
    assert.equal(readiness.blockers.length, 0);
    assert.deepEqual([...FIRST_CREATE_VISIBLE_FIELDS], [
      "title",
      "startingSituation",
      "centralConflict",
      "goal",
      "endingConditions",
    ]);
    assert.equal(FIRST_CREATE_VISIBLE_FIELDS.length, 5);
  });

  it("TEST 6: blocked scenario cannot play and names the first missing field", () => {
    const readiness = evaluateScenarioReadiness({
      title: "",
      content: "",
      scenarioPlan: emptyTrpgScenarioPlan(),
    });
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.canPlay, false);
    assert.ok(readiness.blockers.some((item) => item.id === "missing_title"));
    assert.ok(readiness.blockers.some((item) => item.field === "startingSituation"));
    assert.equal(scenarioPersistDecision({ dirty: true, canPlay: false, savedId: null }), "blocked");
  });

  it("TEST 7: recommended-only quality lint does not block play", () => {
    const readiness = evaluateScenarioReadiness({
      title: "폐역",
      content: "",
      summary: "유령 기차",
      scenarioPlan: {
        ...playablePlan(),
        secret: "지휘관은 이미 대체되었다",
      },
    });
    assert.equal(readiness.canPlay, true);
    assert.equal(readiness.status, "recommended");
    assert.ok(readiness.recommendations.some((item) => item.id === "secret_without_clues"));
  });

  it("legacy content-only scenarios stay playable without a structured plan", () => {
    const readiness = evaluateScenarioReadiness({
      title: "레거시",
      content: "한밤의 역에서 유령 기차를 기다린다.",
      scenarioPlan: emptyTrpgScenarioPlan(),
    });
    assert.equal(readiness.canSave, true);
    assert.equal(readiness.canPlay, true);
  });

  it("TEST 1/2: CREATE returns authoritative id and play href uses that id once", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const payload = scenarioEditorSavePayload({
      ...emptySnapshot(),
      title: "신규",
      plan: playablePlan(),
    });
    const id = insertScenarioTemplate(db, 1, payload);
    assert.ok(id > 0);
    const row = loadScenarioTemplate(db, id);
    assert.ok(row);
    const scenario = rowToScenarioTemplate(row);
    const catalog = catalogWith([{ ...scenario, creatorId: 1 }]);
    const handoff = resolveScenarioHandoff(catalog, id);
    assert.equal(handoff.ok, true);
    if (handoff.ok) {
      assert.equal(handoff.scenario.id, id);
      assert.equal(handoff.scenario.title, "신규");
      assert.equal(handoff.pick.id, id);
    }
    assert.equal(trpgPlayHref(id), `/trpg?scenarioId=${id}`);
    assert.equal(parseScenarioHandoffId(String(id)), id);
    assert.equal(scenarioPersistDecision({ dirty: true, canPlay: true, savedId: null }), "save_then_play");
    assert.equal(scenarioPersistDecision({ dirty: false, canPlay: true, savedId: id }), "navigate");
    db.close();
  });

  it("TEST 3: unchanged saved scenario plays without another persist", () => {
    const decision = scenarioPersistDecision({ dirty: false, canPlay: true, savedId: 44 });
    assert.equal(decision, "navigate");
    assert.equal(scenarioPlayCtaLabel(decision), "이 시나리오로 플레이");
  });

  it("TEST 4: unsaved valid edit requires save-then-play and keeps the payload", () => {
    const before = emptySnapshot();
    const after = { ...before, title: "수정됨", plan: playablePlan() };
    assert.equal(isScenarioEditorDirty(after, scenarioEditorSnapshot(before)), true);
    assert.equal(scenarioPersistDecision({ dirty: true, canPlay: true, savedId: 8 }), "save_then_play");
    const payload = scenarioEditorSavePayload(after);
    assert.equal(payload.title, "수정됨");
    assert.equal(payload.defaultPcStats, null);
    assert.deepEqual(payload.characterIds, []);
  });

  it("TEST 5: save failure stays on editor because persist never navigates itself", () => {
    const decision = scenarioPersistDecision({ dirty: true, canPlay: true, savedId: 3 });
    assert.equal(decision, "save_then_play");
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /if \(!res\.ok\) throw new Error/);
    assert.match(editor, /setError\(/);
    assert.match(editor, /return null;/);
    assert.match(editor, /router\.push\(trpgPlayHref\(id\)\)/);
    assert.doesNotMatch(editor, /router\.push\(returnHref\);\s*\n\s*router\.refresh/);
  });

  it("TEST 8: deep-link id is parsed from the persistent query param", () => {
    assert.equal(parseScenarioHandoffId("18"), 18);
    assert.equal(parseScenarioHandoffId("0"), null);
    assert.equal(parseScenarioHandoffId("nope"), null);
    assert.equal(trpgPlayHref(18), "/trpg?scenarioId=18");
  });

  it("TEST 9: invalid or inaccessible scenarioId does not start a wrong scenario", () => {
    const catalog = catalogWith([]);
    const missing = resolveScenarioHandoff(catalog, 99);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.match(missing.error, /찾을 수 없거나 접근할 수 없습니다/);
      assert.equal(missing.scenarioId, 99);
    }
    assert.equal(catalogScenarioById(catalog, 99), null);
  });

  it("TEST 10: regenerate after manual edits requires confirmation", () => {
    const existing = {
      title: "직접 수정",
      plan: playablePlan(),
    };
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "regenerate_all",
        existing,
        hasManualEdits: true,
      }),
      true
    );
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "regenerate_selected",
        existing,
        selectedFields: ["goal"],
        hasManualEdits: true,
      }),
      true
    );
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "fill_empty",
        existing,
        hasManualEdits: true,
      }),
      false
    );
  });

  it("TEST 11: edit/save/play handoff keeps #550 legacy stats", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const info = db
      .prepare(
        `INSERT INTO trpg_scenario_templates
          (creator_id, title, summary, content, visibility, start_location, start_inventory_json,
           default_pc_stats_json, stat_keys_json, npcs_json, character_ids_json, genres, updated_at)
         VALUES (1, '유산', '', '본문', 'private', '', '[]', ?, ?, ?, '[]', '[]', datetime('now'))`
      )
      .run(
        JSON.stringify({ acc: 10, siz: 8 }),
        JSON.stringify(["str", "acc", "siz"]),
        JSON.stringify([{ name: "경비", description: "", greeting: "", systemPrompt: "", stats: { acc: 11, siz: 9 } }])
      );
    const id = Number(info.lastInsertRowid);
    updateScenarioTemplate(db, id, 1, {
      title: "유산 수정",
      content: "본문",
      statKeys: ["str", "acc", "siz"],
      defaultPcStats: null,
      npcs: [{ name: "경비", description: "", greeting: "", systemPrompt: "", stats: { acc: 11, siz: 9 } }],
    });
    const template = rowToScenarioTemplate(loadScenarioTemplate(db, id)!);
    assert.ok(template.statKeys.includes("str"));
    assert.ok(template.statKeys.includes("acc"));
    assert.ok(template.statKeys.includes("siz"));
    assert.equal(template.defaultPcStats?.acc, 10);
    assert.equal(template.npcs[0]?.stats?.acc, 11);
    assert.equal(scenarioPersistDecision({ dirty: false, canPlay: true, savedId: id }), "navigate");
    db.close();
  });

  it("TEST 12: mobile save/play CTAs stay on the sticky bar for create and edit", () => {
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /data-scenario-play-cta/);
    assert.match(editor, /data-scenario-save-cta/);
    assert.match(editor, /StudioSaveBar/);
    assert.match(editor, /pb-24/);
    assert.equal(editor.includes("fixed inset-x-0 bottom-0"), false);
  });

  it("TEST 13: play handoff is a local navigation with no provider call", () => {
    assert.equal(trpgPlayHref(7), "/trpg?scenarioId=7");
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /router\.push\(trpgPlayHref\(id\)\)/);
    assert.doesNotMatch(editor, /\/api\/trpg\/campaigns\/\[id\]\/start/);
    const handoff = readFileSync("src/lib/trpg/scenarioHandoff.ts", "utf8");
    assert.doesNotMatch(handoff, /openrouter|completeGm|TRPG_GM_MODEL|TRPG_BOT_MODEL/);
  });

  it("TEST 14: campaign create still starts from the selected template id", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const templateId = insertScenarioTemplate(db, 1, {
      title: "오프닝",
      content: "문을 연다.",
    });
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    const campaign = db.prepare(`SELECT template_id, title FROM trpg_campaigns WHERE id=?`).get(campaignId) as {
      template_id: number;
      title: string;
    };
    assert.equal(campaign.template_id, templateId);
    assert.equal(campaign.title, "오프닝");
    db.close();
  });

  it("TEST 16/18/19: collapsing optional depth does not drop save payload fields", () => {
    const fields = {
      ...emptySnapshot(),
      title: "깊이",
      summary: "한 줄",
      secretContent: "GM 비밀",
      plan: {
        ...playablePlan(),
        secret: "진짜 비밀",
        majorEvents: ["보급대가 실종된다"],
      },
      npcs: [{ name: "역무원", description: "야간 근무", greeting: "", systemPrompt: "", stats: { acc: 11 } }],
      characterIds: [9],
    };
    assert.equal(optionalDepthFilled(fields), true);
    const payload = scenarioEditorSavePayload(fields);
    assert.equal(payload.summary, "한 줄");
    assert.equal(payload.secretContent, "GM 비밀");
    assert.deepEqual(payload.characterIds, [9]);
    assert.equal((payload.scenarioPlan as { secret: string }).secret, "진짜 비밀");
    assert.equal((payload.npcs as { stats: { acc: number } }[])[0]?.stats.acc, 11);
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /scenarioEditorSavePayload/);
    assert.doesNotMatch(editor, /characterIds: \[\]/);
  });

  it("TEST 17: a details-section blocker exposes a focusable field id", () => {
    const readiness = evaluateScenarioReadiness({
      title: "묶음",
      content: "본문",
      scenarioPlan: playablePlan(),
      bundleChars: 10001,
    });
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.blockers[0]?.field, "bundle");
    assert.equal(readiness.blockers[0]?.section, "details");
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /scrollToScenarioField/);
    assert.match(editor, /setDetailsOpen\(true\)/);
  });
});
