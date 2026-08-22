import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { catalogScenarioById } from "./catalogBrowse";
import { createTrpgCampaign } from "./engineCreate";
import { emptyTrpgScenarioPlan } from "./scenarioPlan";
import {
  confirmLeaveEditor,
  isScenarioEditorDirty,
  optionalDepthFilled,
  SCENARIO_STORY_FIELD_COPY,
  scenarioEditorPersistedSnapshot,
  scenarioEditorSavePayload,
  scenarioEditorSnapshot,
  scenarioHasAiDraftOrigin,
  shouldConfirmScenarioDraftApply,
  shouldOfferScenarioAiEditingTools,
} from "./scenarioEditorState";
import {
  parseScenarioHandoffId,
  resolveScenarioHandoff,
  scenarioPersistDecision,
  scenarioPlayCtaLabel,
  trpgPlayHref,
} from "./scenarioHandoff";
import {
  countFirstCreateFilledFields,
  evaluateScenarioReadiness,
  FIRST_CREATE_VISIBLE_FIELDS,
  scenarioReadinessHeadline,
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

function runtimeImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    if (named) {
      const parts = named[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 0 && parts.every((part) => part.startsWith("type "))) continue;
    }
    specs.push(match[2]);
  }
  return specs;
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of [".ts", ".tsx"]) {
    const index = join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return null;
}

function collectClientRuntimeFiles(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const specs = runtimeImportSpecifiers(readFileSync(file, "utf8"));
    for (const spec of specs) {
      const next = resolveLocalImport(file, spec);
      if (next) queue.push(next);
    }
  }
  return [...seen];
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
    assert.equal(scenarioReadinessHeadline(readiness), "아직 2개 항목이 필요합니다");
    assert.equal(countFirstCreateFilledFields({ title: "", scenarioPlan: emptyTrpgScenarioPlan() }), 0);
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
    assert.equal(scenarioReadinessHeadline(readiness), `플레이 가능 · 보완 ${readiness.recommendations.length}`);
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /data-scenario-quality-lint/);
    assert.match(editor, /<details className="mt-2 text-xs opacity-80" data-scenario-quality-lint>/);
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

  it("TEST 10: draft apply confirmation is client-safe mode/lock logic", () => {
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "regenerate_all",
        hasManualEdits: false,
      }),
      true
    );
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "fill_empty",
        selectedFields: ["goal"],
        hasManualEdits: true,
      }),
      false
    );
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "regenerate_selected",
        selectedFields: ["goal"],
        lockedFields: ["title"],
        hasManualEdits: true,
      }),
      true
    );
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "regenerate_selected",
        selectedFields: ["goal"],
        lockedFields: ["goal"],
        hasManualEdits: true,
      }),
      false
    );
    assert.equal(
      shouldConfirmScenarioDraftApply({
        mode: "regenerate_selected",
        selectedFields: ["goal"],
        hasManualEdits: false,
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

  it("A: dirty 나가기 cancel keeps the editor and does not navigate", () => {
    const before = { ...emptySnapshot(), title: "작성 중", plan: playablePlan() };
    let confirmCalls = 0;
    const leave = confirmLeaveEditor({
      dirty: isScenarioEditorDirty(before, scenarioEditorSnapshot(emptySnapshot())),
      confirm: () => {
        confirmCalls += 1;
        return false;
      },
    });
    assert.equal(leave, false);
    assert.equal(confirmCalls, 1);
    assert.equal(before.title, "작성 중");
    assert.deepEqual(before.plan.goal, playablePlan().goal);
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /function leaveEditor/);
    assert.match(editor, /confirmLeaveEditor/);
    assert.match(editor, /저장하지 않은 변경이 있습니다/);
  });

  it("B: clean 나가기 navigates without confirm", () => {
    let confirmCalls = 0;
    const leave = confirmLeaveEditor({
      dirty: false,
      confirm: () => {
        confirmCalls += 1;
        return false;
      },
    });
    assert.equal(leave, true);
    assert.equal(confirmCalls, 0);
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /if \(\s*!confirmLeaveEditor\([\s\S]*?\)\s*\) \{\s*return;/);
    assert.match(editor, /router\.push\(returnHref\)/);
  });

  it("C: AI draft optional values stay collapsed with 설정됨 only", () => {
    const drafted = {
      ...emptySnapshot(),
      title: "초안",
      plan: {
        ...playablePlan(),
        majorEvents: ["보급대가 실종된다"],
      },
      npcs: [{ name: "역무원", description: "야간 근무", greeting: "", systemPrompt: "", stats: null }],
    };
    assert.equal(optionalDepthFilled(drafted), true);
    const payload = scenarioEditorSavePayload(drafted);
    assert.deepEqual((payload.scenarioPlan as { majorEvents: string[] }).majorEvents, ["보급대가 실종된다"]);
    assert.equal((payload.npcs as { name: string }[])[0]?.name, "역무원");
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.doesNotMatch(editor, /data\.draft\.plan\.majorEvents\.length \|\| data\.draft\.npcs\.length/);
    assert.match(editor, /설정됨/);
    assert.match(editor, /optionalDepthFilled/);
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
    assert.match(editor, /function revealReadinessField[\s\S]*setDetailsOpen\(true\)[\s\S]*scrollToScenarioField/);
    const autoOpenAfterDraft = /setLintMessages\([\s\S]{0,200}setDetailsOpen\(true\)/;
    assert.equal(autoOpenAfterDraft.test(editor), false);
  });

  it("P0: scenarioEditorState has no runtime scenarioDraft/node:crypto/db/server-only import", () => {
    const source = readFileSync("src/lib/trpg/scenarioEditorState.ts", "utf8");
    const runtime = runtimeImportSpecifiers(source);
    assert.equal(runtime.includes("./scenarioDraft"), false);
    assert.equal(runtime.includes("node:crypto"), false);
    assert.equal(runtime.includes("server-only"), false);
    assert.equal(runtime.some((spec) => spec === "./db" || spec.endsWith("/db")), false);
    assert.match(source, /import type \{[\s\S]*from "\.\/scenarioDraft"/);
    const clientFiles = collectClientRuntimeFiles("src/app/trpg/TrpgScenarioEditor.tsx");
    assert.ok(clientFiles.includes("src/lib/trpg/scenarioEditorState.ts"));
    for (const file of clientFiles) {
      const specs = runtimeImportSpecifiers(readFileSync(file, "utf8"));
      assert.equal(specs.includes("node:crypto"), false, file);
      assert.equal(specs.includes("./scenarioDraft"), false, file);
      assert.equal(specs.includes("@/lib/trpg/scenarioDraft"), false, file);
    }
  });

  it("P0: save snapshot stays on the submitted fields when the editor changes in flight", () => {
    const submitted = { ...emptySnapshot(), title: "A", plan: playablePlan() };
    const currentDuringRequest = { ...submitted, title: "B" };
    const body = scenarioEditorSavePayload(submitted);
    assert.equal(body.title, "A");
    assert.notEqual(body.title, currentDuringRequest.title);
    const savedSnapshot = scenarioEditorPersistedSnapshot(submitted, submitted.characterIds);
    assert.equal(JSON.parse(savedSnapshot).title, "A");
    assert.equal(isScenarioEditorDirty(currentDuringRequest, savedSnapshot), true);
    assert.equal(isScenarioEditorDirty(submitted, savedSnapshot), false);
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /const submittedFields = currentFields\(\)/);
    assert.match(editor, /scenarioEditorSavePayload\(submittedFields\)/);
    assert.match(editor, /scenarioEditorPersistedSnapshot\(submittedFields/);
    assert.doesNotMatch(
      editor,
      /setSavedSnapshot\(\s*scenarioEditorSnapshot\(\{\s*\.\.\.currentFields\(\)/
    );
  });

  it("P0: normal save without mid-request edit leaves dirty=false", () => {
    const submitted = { ...emptySnapshot(), title: "A", plan: playablePlan() };
    const savedSnapshot = scenarioEditorPersistedSnapshot(submitted, submitted.characterIds);
    assert.equal(isScenarioEditorDirty(submitted, savedSnapshot), false);
  });

  it("Phase 2: first-create labels, helpers, and AI chrome stay collapsed", () => {
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.equal(FIRST_CREATE_VISIBLE_FIELDS.length, 5);
    assert.equal(SCENARIO_STORY_FIELD_COPY.startingSituation.label, "시작 장면");
    assert.equal(SCENARIO_STORY_FIELD_COPY.centralConflict.label, "핵심 문제");
    assert.equal(SCENARIO_STORY_FIELD_COPY.goal.label, "플레이어 목표");
    assert.equal(SCENARIO_STORY_FIELD_COPY.endingConditions.label, "마무리 기준");
    assert.ok(SCENARIO_STORY_FIELD_COPY.startingSituation.helper);
    assert.ok(SCENARIO_STORY_FIELD_COPY.centralConflict.helper);
    assert.ok(SCENARIO_STORY_FIELD_COPY.goal.helper);
    assert.ok(SCENARIO_STORY_FIELD_COPY.endingConditions.helper);
    assert.match(editor, /data-scenario-ai-primary-cta/);
    assert.match(editor, /직접 작성하려면 아래 5가지만 입력하면 됩니다/);
    assert.match(editor, /data-scenario-field-helper="startingSituation"/);
    assert.match(editor, /data-scenario-field-helper="centralConflict"/);
    assert.match(editor, /data-scenario-field-helper="goal"/);
    assert.match(editor, /data-scenario-field-helper="endingConditions"/);
    assert.match(editor, /data-scenario-ai-tools/);
    assert.match(editor, /useState\(false\)/);
    assert.match(editor, /showAiFieldChrome/);
    assert.doesNotMatch(editor, /data-scenario-field="endingConditions"[\s\S]{0,180}종료 조건/);
    const storyStart = editor.indexOf('AppSectionCard title="이야기"');
    const detailsStart = editor.indexOf("더 자세히 설정");
    const story = editor.slice(storyStart, detailsStart);
    assert.equal(story.includes("종료 조건"), false);
    assert.match(story, /SCENARIO_STORY_FIELD_COPY\.endingConditions\.label/);
    assert.match(story, /SCENARIO_STORY_FIELD_COPY\.startingSituation\.label/);
    assert.match(story, /SCENARIO_STORY_FIELD_COPY\.centralConflict\.label/);
    assert.match(story, /SCENARIO_STORY_FIELD_COPY\.goal\.label/);
    assert.match(story, /data-scenario-ai-primary-cta/);
    assert.equal(/data-scenario-ai-regen-all/.test(story), true);
    assert.match(editor, /if \(!showAiFieldChrome\) return null;/);
  });

  it("Phase 2: AI editing tools stay collapsed until opened and use persisted origin", () => {
    assert.equal(scenarioHasAiDraftOrigin({ provenance: null }), false);
    assert.equal(
      scenarioHasAiDraftOrigin({ provenance: { generatorModel: "deepseek-v4-flash-0731" } }),
      true
    );
    assert.equal(
      shouldOfferScenarioAiEditingTools({
        hasSessionDraft: false,
        hasPersistedAiOrigin: false,
        isEditingSaved: false,
      }),
      false
    );
    assert.equal(
      shouldOfferScenarioAiEditingTools({
        hasSessionDraft: true,
        hasPersistedAiOrigin: false,
        isEditingSaved: false,
      }),
      true
    );
    assert.equal(
      shouldOfferScenarioAiEditingTools({
        hasSessionDraft: false,
        hasPersistedAiOrigin: true,
        isEditingSaved: false,
      }),
      true
    );
    assert.equal(
      shouldOfferScenarioAiEditingTools({
        hasSessionDraft: false,
        hasPersistedAiOrigin: false,
        isEditingSaved: true,
      }),
      true
    );
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /const \[aiToolsOpen, setAiToolsOpen\] = useState\(false\)/);
    assert.match(editor, /const \[detailsOpen, setDetailsOpen\] = useState\(false\)/);
    assert.doesNotMatch(editor, /setAiToolsOpen\(true\)/);
    assert.doesNotMatch(editor, /setDetailsOpen\(true\)[\s\S]{0,80}setLastDraftSnapshot/);
  });

  it("Phase 2: manual 5-field author is playable without AI chrome", () => {
    const readiness = evaluateScenarioReadiness({
      title: "[SMOKE] 최소 시나리오",
      content: "",
      scenarioPlan: playablePlan(),
    });
    assert.equal(readiness.canPlay, true);
    assert.equal(readiness.canSave, true);
    assert.equal(
      countFirstCreateFilledFields({
        title: "[SMOKE] 최소 시나리오",
        scenarioPlan: playablePlan(),
      }),
      5
    );
    assert.equal(scenarioReadinessHeadline(readiness), "플레이 가능");
    const payload = scenarioEditorSavePayload({
      ...emptySnapshot(),
      title: "[SMOKE] 최소 시나리오",
      plan: playablePlan(),
    });
    assert.equal(payload.title, "[SMOKE] 최소 시나리오");
    assert.deepEqual((payload.scenarioPlan as { endingConditions: string[] }).endingConditions, playablePlan().endingConditions);
  });
});
