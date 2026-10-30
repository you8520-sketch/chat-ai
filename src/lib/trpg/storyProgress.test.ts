import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  applyCampaignStoryProgress,
  emptyCampaignContext,
  loadCampaignContext,
  persistCampaignContext,
} from "./campaignContext";
import { parseTrpgGmOutput } from "./gmPrompt";
import { parseTrpgScenarioPlan, serializeTrpgScenarioPlanForGm } from "./scenarioPlan";
import { ensureTrpgTables } from "./schema";
import {
  emptyStoryProgress,
  mergeStoryProgress,
  parseStoryProgress,
  parseStoryProgressDeltaIndices,
} from "./storyProgress";

const P35B_PLAN = {
  version: 1 as const,
  startingSituation: "항구 도시 마레노",
  centralConflict: "실종과 장부",
  goal: "진실을 밝힌다",
  secret: "서랍 속 장부",
  endingConditions: ["장부의 가명을 확인한다"],
  majorEvents: ["야간 등대에서 실종 신고가 터진다", "창고에서 장부를 발견한다"],
  clues: ["인수자 기록이 적힌 푸른 장부", "장부 마지막 줄의 가명", "서랍 속 장부 문장"],
  forbiddenEvents: [],
  boss: "",
  specialRules: [],
  difficulty: "normal" as const,
  climax: "등대",
  endingCandidates: [],
  factionChanges: [],
  gmDirection: "",
  playLength: "medium" as const,
};

describe("TRPG story progress (P3-5C)", () => {
  it("reproduces before: full plan lists stay without progress", () => {
    const plan = parseTrpgScenarioPlan(P35B_PLAN);
    const text = serializeTrpgScenarioPlanForGm(plan);
    assert.match(text, /현재 사용 가능한 주요 사건/);
    assert.match(text, /창고에서 장부를 발견한다/);
    assert.match(text, /인수자 기록이 적힌 푸른 장부/);
  });

  it("after commit: consumed indices drop from pending lists only", () => {
    const plan = parseTrpgScenarioPlan(P35B_PLAN);
    const progress = mergeStoryProgress(
      emptyStoryProgress(),
      { occurredMajorEventIndices: [1], revealedClueIndices: [0] },
      plan
    );
    const text = serializeTrpgScenarioPlanForGm(plan, { storyProgress: progress });
    assert.match(text, /\[0\] 야간 등대에서 실종 신고가 터진다/);
    assert.doesNotMatch(text, /창고에서 장부를 발견한다/);
    assert.doesNotMatch(text, /인수자 기록이 적힌 푸른 장부/);
    assert.match(text, /\[1\] 장부 마지막 줄의 가명/);
  });

  it("omits delta fields: no automatic consumption", () => {
    const plan = parseTrpgScenarioPlan(P35B_PLAN);
    let ctx = emptyCampaignContext(1);
    ctx = { ...ctx, directorPlan: plan };
    ctx = applyCampaignStoryProgress(ctx, { storyPhase: "INTRO" });
    assert.deepEqual(ctx.storyProgress, emptyStoryProgress());
  });

  it("rejects invalid indices on merge", () => {
    const plan = parseTrpgScenarioPlan(P35B_PLAN);
    const merged = mergeStoryProgress(
      emptyStoryProgress(),
      {
        occurredMajorEventIndices: [-1, 1.5, 99, "x" as unknown as number, 1],
        revealedClueIndices: [3, 0],
      },
      plan
    );
    assert.deepEqual(merged.occurredMajorEventIndices, [1]);
    assert.deepEqual(merged.revealedClueIndices, [0]);
  });

  it("dedupes duplicate plan lines by index", () => {
    const plan = parseTrpgScenarioPlan({
      ...P35B_PLAN,
      majorEvents: ["동일 문장", "동일 문장"],
    });
    const progress = mergeStoryProgress(emptyStoryProgress(), { occurredMajorEventIndices: [0] }, plan);
    const text = serializeTrpgScenarioPlanForGm(plan, { storyProgress: progress });
    assert.match(text, /\[1\] 동일 문장/);
    assert.doesNotMatch(text, /\[0\] 동일 문장/);
  });

  it("persists null legacy column as empty progress", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(
      `INSERT INTO trpg_campaign_context (campaign_id, source_mode, story_phase, active_threads_json, resolved_threads_json, ending_status_json)
       VALUES (1, 'scenario', 'INTRO', '[]', '[]', '{}')`
    ).run();
    const loaded = loadCampaignContext(db, 1);
    assert.ok(loaded);
    assert.deepEqual(loaded.storyProgress, emptyStoryProgress());
  });

  it("round-trip persist and reload keeps progress", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const plan = parseTrpgScenarioPlan(P35B_PLAN);
    let ctx = emptyCampaignContext(42);
    ctx = { ...ctx, directorPlan: plan };
    ctx = applyCampaignStoryProgress(ctx, {
      occurredMajorEventIndices: [0],
      revealedClueIndices: [2],
    });
    persistCampaignContext(db, ctx);
    const again = loadCampaignContext(db, 42);
    assert.deepEqual(again?.storyProgress, { occurredMajorEventIndices: [0], revealedClueIndices: [2] });
  });

  it("idempotent merge on duplicate commit indices", () => {
    const plan = parseTrpgScenarioPlan(P35B_PLAN);
    let progress = mergeStoryProgress(emptyStoryProgress(), { occurredMajorEventIndices: [0] }, plan);
    progress = mergeStoryProgress(progress, { occurredMajorEventIndices: [0, 0] }, plan);
    assert.deepEqual(progress.occurredMajorEventIndices, [0]);
  });

  it("parseTrpgGmOutput wires delta indices", () => {
    const parsed = parseTrpgGmOutput(
      JSON.stringify({
        narration: "장면",
        delta: {
          players: [],
          occurredMajorEventIndices: [0, 0],
          revealedClueIndices: [1],
        },
      })
    );
    assert.deepEqual(parsed.delta.occurredMajorEventIndices, [0]);
    assert.deepEqual(parsed.delta.revealedClueIndices, [1]);
  });

  it("Adventure plans omit free clue list; clue indices do not apply", () => {
    const adventure = {
      start: "platform",
      places: [
        { key: "platform", name: "승강장", summary: "비.", role: "start" as const },
        { key: "car3", name: "객차", summary: "좌석.", role: "hub" as const },
        { key: "engine", name: "기관실", summary: "계기.", role: "goal" as const },
      ],
      links: [
        { from: "platform", to: "car3" },
        { from: "car3", to: "engine", opensBy: "ticket" },
      ],
      events: [{ key: "ticket", place: "car3", trigger: "search" as const, kind: "clue" as const, text: "암호." }],
    };
    const plan = parseTrpgScenarioPlan({ ...P35B_PLAN, adventure });
    assert.ok(plan?.adventure?.events.length);
    const progress = mergeStoryProgress(emptyStoryProgress(), { revealedClueIndices: [0] }, plan);
    const text = serializeTrpgScenarioPlanForGm(plan, { storyProgress: progress });
    assert.doesNotMatch(text, /단서:/);
    assert.deepEqual(progress.revealedClueIndices, [], "free-clue indices are ignored when adventure owns discoveries");
  });

  it("OLD/NEW assembly: progress shrinks scenario plan block", () => {
    const plan = parseTrpgScenarioPlan(P35B_PLAN);
    const oldText = serializeTrpgScenarioPlanForGm(plan);
    const progress = mergeStoryProgress(
      emptyStoryProgress(),
      { occurredMajorEventIndices: [0, 1], revealedClueIndices: [0, 1, 2] },
      plan
    );
    const newText = serializeTrpgScenarioPlanForGm(plan, { storyProgress: progress });
    assert.ok(oldText.length > newText.length);
    assert.match(oldText, /주요 사건/);
    assert.doesNotMatch(newText, /현재 사용 가능한 주요 사건 \(강제 순서가 아님\):/);
    assert.doesNotMatch(newText, /단서:/);
  });

  it("parseStoryProgress handles corrupt stored JSON", () => {
    assert.deepEqual(parseStoryProgress(null), emptyStoryProgress());
    assert.deepEqual(parseStoryProgress({ occurredMajorEventIndices: "nope" }), emptyStoryProgress());
    assert.deepEqual(
      parseStoryProgress({ occurredMajorEventIndices: [1, 1, 2], revealedClueIndices: [-1, 0] }),
      { occurredMajorEventIndices: [1, 2], revealedClueIndices: [0] }
    );
  });

  it("parseStoryProgressDeltaIndices enforces bounds", () => {
    assert.deepEqual(parseStoryProgressDeltaIndices([0, 2], 2), [0]);
  });
});
