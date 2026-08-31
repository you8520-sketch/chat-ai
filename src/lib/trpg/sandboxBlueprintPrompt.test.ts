import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSandboxDirectorSystemPrompt,
  buildSandboxDirectorUserPrompt,
  buildScenarioDraftSystemPrompt,
  parseScenarioDraftJson,
} from "./scenarioDraft";
import { completeTrpgAuthoringJson } from "./scenarioDraftCall";
import { evaluateSandboxBlueprint, parseTrpgScenarioPlan } from "./scenarioPlan";
import { ensureCampaignDirectorContext } from "./sandboxDirector";
import { ensureTrpgTables } from "./schema";
import Database from "better-sqlite3";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

describe("TRPG sandbox Blueprint prompt contract", () => {
  const sandboxSystem = buildSandboxDirectorSystemPrompt();
  const genericSystem = buildScenarioDraftSystemPrompt();
  const sandboxUser = buildSandboxDirectorUserPrompt({
    worldName: "회색 폐허",
    worldSummary: "종말 이후 생존자들의 폐허.",
    worldContent: "식량과 안전 거점이 부족하다.",
  });

  it("B1 — sandbox prompt requires startingSituation, centralConflict, goal, endingConditions", () => {
    for (const field of ["startingSituation", "centralConflict", "goal", "endingConditions"] as const) {
      assert.match(sandboxSystem, new RegExp(field));
    }
    assert.match(sandboxUser, /startingSituation|centralConflict|goal|endingConditions/);
  });

  it("B2 — sandbox prompt distinguishes endingConditions from endingCandidates", () => {
    assert.match(sandboxSystem, /endingConditions.*completion criteria|completion criteria.*endingConditions/is);
    assert.match(sandboxSystem, /endingCandidates.*cannot replace|cannot replace.*endingConditions/is);
    assert.doesNotMatch(genericSystem, /cannot replace endingConditions/i);
  });

  it("B3 — open_ended still requires endingConditions in sandbox prompt", () => {
    assert.match(sandboxSystem, /open_ended.*endingConditions|endingConditions.*open_ended/is);
    assert.match(sandboxSystem, /flexible campaign length|absent completion criteria/i);
  });

  it("B4 — generic creator draft prompt remains unchanged by sandbox-only contract", () => {
    assert.doesNotMatch(genericSystem, /Sandbox Blueprint contract/i);
    assert.doesNotMatch(genericSystem, /Never leave endingConditions empty/i);
    assert.doesNotMatch(genericSystem, /cannot replace endingConditions/i);
  });

  it("B5 — evaluateSandboxBlueprint still rejects empty endingConditions", () => {
    const rejected = evaluateSandboxBlueprint(
      parseTrpgScenarioPlan({
        startingSituation: "폐허에 들어선다",
        centralConflict: "생존과 확장이 충돌한다",
        goal: "안전 거점을 확보한다",
        endingConditions: [],
        endingCandidates: ["탈출", "정착"],
      })
    );
    assert.equal(rejected.ok, false);
  });

  it("schema audit — endingConditions and endingCandidates appear once in JSON keys block", () => {
    const keysBlock = genericSystem.slice(genericSystem.indexOf("JSON keys:"));
    assert.equal(countOccurrences(keysBlock, "endingConditions"), 1);
    assert.equal(countOccurrences(keysBlock, "endingCandidates"), 1);
    assert.equal(countOccurrences(sandboxSystem, "Sandbox Blueprint contract"), 1);
  });

  it("failure chain — valid JSON with empty endingConditions parses; repair not invoked; sandbox validator rejects", async () => {
    let repairCalls = 0;
    const validEmptyEndings = JSON.stringify({
      startingSituation: "균사가 번진 편의점에 갇혀 있다",
      centralConflict: "균사 확산과 생존이 충돌한다",
      goal: "안전한 탈출 경로를 확보한다",
      endingConditions: [],
      endingCandidates: ["터널 탈출", "옥상 대피"],
      playLength: "open_ended",
    });
    const parsed = await completeTrpgAuthoringJson({
      kind: "sandbox_blueprint",
      system: sandboxSystem,
      user: sandboxUser,
      complete: async ({ stage }) => {
        if (stage === "repair") repairCalls += 1;
        return {
          text: validEmptyEndings,
          latencyMs: 1,
          model: "mock",
        };
      },
    });
    assert.equal(repairCalls, 0);
    assert.equal(parseScenarioDraftJson(validEmptyEndings).plan.endingConditions.length, 0);
    assert.equal(evaluateSandboxBlueprint(parsed.plan).ok, false);
  });

  it("failure chain — ensureCampaignDirectorContext persists null plan without artifact", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE worlds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        shared_from_nickname TEXT NOT NULL DEFAULT '',
        trpg_enabled INTEGER NOT NULL DEFAULT 1,
        trpg_visibility TEXT NOT NULL DEFAULT 'public',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO worlds (creator_id, name, summary, content) VALUES (1, '개방 폐허', '탐험 중심', '끝없이 넓은 폐허.');
    `);
    ensureTrpgTables(db);
    db.prepare(
      `INSERT INTO trpg_campaigns (host_user_id, title, max_slots, billing_mode, status, invite_code, world_brief, source_world_id)
       VALUES (1, '샌드박스', 1, 'host_pays', 'ACTIVE', 'sb1', 'test', 1)`
    ).run();
    const campaignId = Number((db.prepare(`SELECT id FROM trpg_campaigns`).get() as { id: number }).id);
    const prev = process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "1";
    try {
      const ctx = await ensureCampaignDirectorContext(db, campaignId);
      assert.equal(ctx.directorPlan, null);
      assert.ok(!ctx.directorError);
    } finally {
      if (prev === undefined) delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
      else process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = prev;
      db.close();
    }
  });
});
