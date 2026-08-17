import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { loadTrpgCatalog } from "./catalog";
import { insertScenarioTemplate } from "./scenarioTemplates";
import {
  applyStoryPhaseTransition,
  countScenarioPlanChars,
  hasPlayableScenarioPlan,
  lintTrpgScenarioPlan,
  parseTrpgScenarioPlan,
  serializeTrpgScenarioPlanForGm,
} from "./scenarioPlan";
import { countScenarioBundleChars, normalizeScenarioTemplateInput } from "./scenarioTypes";
import { ensureTrpgTables } from "./schema";

const playablePlan = {
  version: 1 as const,
  startingSituation: "폐도시에 들어간다",
  centralConflict: "코어와 인간 세력이 충돌한다",
  goal: "통신 두절의 원인을 밝힌다",
  secret: "지휘관은 이미 대체되었다SECRETPLAN",
  endingConditions: ["코어를 봉쇄한다"],
  majorEvents: ["보급대가 실종된다"],
  clues: ["끊긴 통신 기록"],
  forbiddenEvents: ["현대 국가가 등장하지 않는다"],
  boss: "",
  specialRules: [],
  difficulty: "normal" as const,
  climax: "지하에서 코어가 드러난다",
  endingCandidates: ["봉쇄", "공존"],
  factionChanges: [],
  gmDirection: "탐험 비중",
  playLength: "medium" as const,
};

describe("TRPG scenario plan", () => {
  it("treats null/empty plans as playable legacy content and accepts plan-only scenarios", () => {
    assert.equal(parseTrpgScenarioPlan(null), null);
    assert.equal(parseTrpgScenarioPlan(""), null);
    assert.equal(hasPlayableScenarioPlan(null), false);
    const legacy = normalizeScenarioTemplateInput({
      title: "레거시",
      content: "한밤의 역에서 유령 기차를 기다린다.",
    });
    assert.equal(legacy.scenarioPlan, null);
    assert.match(legacy.content, /유령 기차/);
    const planned = normalizeScenarioTemplateInput({
      title: "설계만",
      content: "",
      scenarioPlan: playablePlan,
    });
    assert.equal(hasPlayableScenarioPlan(planned.scenarioPlan), true);
    assert.equal(planned.content, "");
    assert.throws(
      () => normalizeScenarioTemplateInput({ title: "빈것", content: "" }),
      /이야기 설계/
    );
  });

  it("serializes compact GM text and omits empty fields and raw JSON braces noise", () => {
    const text = serializeTrpgScenarioPlanForGm(parseTrpgScenarioPlan(playablePlan));
    assert.match(text, /\[SCENARIO PLAN\]/);
    assert.match(text, /시작 상황:/);
    assert.match(text, /GM만 아는 비밀:/);
    assert.match(text, /SECRETPLAN/);
    assert.doesNotMatch(text, /"version"/);
    assert.doesNotMatch(text, /보스:/);
  });

  it("counts plan text inside the existing scenario bundle budget", () => {
    const plan = parseTrpgScenarioPlan(playablePlan);
    const planChars = countScenarioPlanChars(plan);
    assert.ok(planChars > 0);
    assert.equal(
      countScenarioBundleChars({ content: "본문", scenarioPlan: plan }),
      "본문".length + planChars
    );
  });

  it("lints missing clues and unrelated endings without blocking on warnings", () => {
    const issues = lintTrpgScenarioPlan({
      plan: parseTrpgScenarioPlan({
        ...playablePlan,
        clues: [],
        endingConditions: ["전혀다른과일바구니"],
      }),
    });
    assert.ok(issues.some((issue) => issue.code === "secret_without_clues"));
    assert.ok(issues.some((issue) => issue.code === "goal_ending_unrelated"));
    assert.equal(issues.some((issue) => issue.level === "error" && issue.code === "missing_start"), false);
  });

  it("keeps story phase adjacent and independent from round phases", () => {
    assert.equal(applyStoryPhaseTransition("INTRO", "DEVELOPMENT"), "DEVELOPMENT");
    assert.equal(applyStoryPhaseTransition("INTRO", "FINISHED"), "INTRO");
    assert.equal(applyStoryPhaseTransition("INTRO", "FINISHED", { campaignFinished: true }), "FINISHED");
    assert.equal(applyStoryPhaseTransition("INTRO", "ESCALATION"), "INTRO");
  });

  it("redacts scenario plans from public catalog payloads", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE worlds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        trpg_enabled INTEGER NOT NULL DEFAULT 0,
        trpg_visibility TEXT NOT NULL DEFAULT 'private',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureTrpgTables(db);
    insertScenarioTemplate(db, 2, {
      title: "공개 계획",
      content: "공개 본문",
      visibility: "public",
      scenarioPlan: playablePlan,
    });
    const catalog = loadTrpgCatalog(db, 1);
    const pub = catalog.publicScenarios.find((row) => row.title === "공개 계획");
    assert.ok(pub);
    assert.equal(pub?.scenarioPlan, null);
    assert.equal(JSON.stringify(catalog.publicScenarios).includes("SECRETPLAN"), false);
    const owner = loadTrpgCatalog(db, 2);
    assert.match(owner.myScenarios.find((row) => row.title === "공개 계획")?.scenarioPlan?.secret ?? "", /SECRETPLAN/);
    db.close();
  });
});
