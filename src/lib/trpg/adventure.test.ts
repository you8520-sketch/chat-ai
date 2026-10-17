import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adventureHasMap,
  adventureReachability,
  assertAuthoredAdventureValid,
  evaluateAdventure,
  parseAdventure,
} from "./adventure";
import { completeTrpgScenarioDraftJson, TrpgAuthoringAdventureInvalidError } from "./scenarioDraftCall";
import {
  buildSandboxDirectorSystemPrompt,
  buildScenarioDraftSystemPrompt,
  mergeScenarioDraft,
  parseScenarioDraftJson,
  previewDraftOverwrite,
  scenarioDraftRequestedFields,
  TRPG_SCENARIO_DRAFT_FIELDS,
} from "./scenarioDraft";
import { emptyTrpgScenarioPlan, parseTrpgScenarioPlan } from "./scenarioPlan";
import { normalizeScenarioTemplateInput } from "./scenarioTypes";

function valid() {
  return {
    start: "platform",
    places: [
      { key: "platform", name: "폐역 승강장", summary: "비에 젖은 승강장.", role: "start" },
      { key: "car3", name: "3호 객차", summary: "좌석마다 젖은 표가 놓여 있다.", role: "hub" },
      { key: "engine", name: "기관실", summary: "멈춘 계기판이 깜빡인다.", role: "goal" },
    ],
    links: [
      { from: "platform", to: "car3" },
      { from: "car3", to: "engine", opensBy: "ticket" },
    ],
    events: [{ key: "ticket", place: "car3", trigger: "search", kind: "clue", text: "표 뒷면에 기관실 암호가 적혀 있다." }],
  };
}

function issuesOf(mutate: (raw: ReturnType<typeof valid>) => unknown): string[] {
  const raw = valid();
  const next = mutate(raw) ?? raw;
  return evaluateAdventure(next).issues;
}

describe("adventure canon validator", () => {
  it("accepts a playable graph and reports what the gate opens", () => {
    const { adventure, issues } = evaluateAdventure(valid());
    assert.deepEqual(issues, []);
    assert.ok(adventure);
    assert.equal(adventureHasMap(adventure), true);
    assert.deepEqual([...adventureReachability(adventure).places].sort(), ["car3", "engine", "platform"]);
  });

  it("rejects bad references", () => {
    assert.match(issuesOf((raw) => void raw.links.push({ from: "car3", to: "ghost" })).join(" "), /없는 장소 "ghost"/);
    assert.match(issuesOf((raw) => void (raw.links[1]!.opensBy = "nope")).join(" "), /없는 사건 "nope"/);
    assert.match(issuesOf((raw) => void (raw.events[0]!.place = "attic")).join(" "), /없는 장소 "attic"/);
    assert.match(
      issuesOf((raw) => void raw.events.push({ key: "b", place: "car3", trigger: "search", kind: "clue", text: "x", requires: ["zzz"] } as never)).join(" "),
      /없는 선행 사건 "zzz"/
    );
  });

  it("rejects duplicate keys and names", () => {
    assert.match(
      issuesOf((raw) => void raw.places.push({ key: "car3", name: "다른 객차", summary: "", role: "site" })).join(" "),
      /key "car3"가 중복/
    );
    assert.match(
      issuesOf((raw) => void raw.places.push({ key: "car4", name: "3호 객차", summary: "", role: "site" })).join(" "),
      /이름 "3호 객차"이 다른 장소와 겹칩니다/
    );
    assert.match(
      issuesOf((raw) => void raw.events.push({ key: "ticket", place: "platform", trigger: "search", kind: "clue", text: "또" })).join(" "),
      /key "ticket"가 중복/
    );
    assert.match(issuesOf((raw) => void raw.links.push({ from: "car3", to: "platform" })).join(" "), /연결이 중복/);
  });

  it("rejects a missing or unknown start", () => {
    assert.match(issuesOf((raw) => ({ ...raw, start: "" })).join(" "), /시작 장소\(start\)가 없습니다/);
    assert.match(issuesOf((raw) => ({ ...raw, start: "roof" })).join(" "), /시작 장소 "roof"가 장소 목록에 없습니다/);
  });

  it("rejects an unreachable required place", () => {
    const issues = issuesOf((raw) => void raw.places.push({ key: "vault", name: "금고칸", summary: "", role: "site" }));
    assert.match(issues.join(" "), /장소 "금고칸"\(vault\)에 도달할 수 없습니다/);
  });

  it("rejects a self-blocking unlock whose event sits behind its own gate", () => {
    const issues = issuesOf((raw) => void (raw.events[0]!.place = "engine"));
    assert.match(issues.join(" "), /기관실.*도달할 수 없습니다/);
    assert.match(issues.join(" "), /사건 "ticket"은 조건이 풀리지 않아/);
  });

  it("rejects other unplayable shapes without guessing", () => {
    assert.match(issuesOf((raw) => void (raw.links[1] = { from: "car3", to: "engine", hidden: true } as never)).join(" "), /opensBy\)이 필요/);
    assert.match(issuesOf((raw) => void (raw.places[0]!.key = "r1")).join(" "), /key "r1"/);
    assert.match(issuesOf((raw) => void (raw.events[0]!.kind = "teleport")).join(" "), /kind는/);
    assert.match(issuesOf((raw) => void (raw.events[0]!.kind = "item")).join(" "), /아이템 이름/);
    assert.match(
      issuesOf((raw) => void raw.events.push({ key: "welcome", place: "platform", trigger: "enter", kind: "clue", text: "x" })).join(" "),
      /시작 장소의 enter 사건/
    );
    assert.match(issuesOf((raw) => ({ ...raw, events: [] })).join(" "), /없는 사건 "ticket"/);
  });

  it("keeps a single place without links as a no-map adventure", () => {
    const single = { start: "inn", places: [{ key: "inn", name: "여관", summary: "", role: "start" }], links: [], events: [] };
    const adventure = parseAdventure(single);
    assert.ok(adventure);
    assert.equal(adventureHasMap(adventure), false);
  });

  it("drops an invalid adventure in the lenient reader and throws at the save boundary", () => {
    const broken = { ...valid(), start: "roof" };
    const plan = parseTrpgScenarioPlan({ startingSituation: "역", goal: "기관실", adventure: broken });
    assert.equal(plan?.adventure, undefined);
    assert.throws(() => assertAuthoredAdventureValid({ adventure: broken }), /장소 구성\(adventure\) 오류/);
    assert.throws(
      () =>
        normalizeScenarioTemplateInput({
          title: "유령 기차",
          summary: "s",
          content: "c",
          visibility: "private",
          startLocation: "아무 곳",
          scenarioPlan: { startingSituation: "역", goal: "기관실", adventure: broken },
        }),
      /장소 구성\(adventure\) 오류/
    );
  });

  it("derives the saved start location from the adventure start place", () => {
    const normalized = normalizeScenarioTemplateInput({
      title: "유령 기차",
      summary: "s",
      content: "c",
      visibility: "private",
      startLocation: "모델이 다르게 쓴 곳",
      scenarioPlan: { startingSituation: "역", goal: "기관실", adventure: valid() },
    });
    assert.equal(normalized.startLocation, "폐역 승강장");
    assert.equal(normalized.scenarioPlan?.adventure?.places.length, 3);
  });
});

describe("adventure in the scenario draft", () => {
  const draftJson = (adventure: unknown) =>
    JSON.stringify({ title: "유령 기차", startingSituation: "역", goal: "기관실", startLocation: "폐역 승강장", adventure });

  it("is a core simple-create field and the sandbox prompt is unchanged", () => {
    assert.ok(TRPG_SCENARIO_DRAFT_FIELDS.includes("adventure"));
    const existing = { title: "", summary: "", content: "역 이야기", secretContent: "", startLocation: "", startInventory: [], npcs: [] };
    const changing = previewDraftOverwrite({ mode: "fill_empty", existing });
    assert.ok(scenarioDraftRequestedFields({ mode: "fill_empty", changingFields: changing }).includes("adventure"));
    assert.match(buildScenarioDraftSystemPrompt(), /adventure: object \{start, places, links, events\}/);
    assert.doesNotMatch(buildSandboxDirectorSystemPrompt(), /adventure:/);
  });

  it("merges a generated adventure, keeps it under lock and other-field regeneration, and replaces it only when chosen", () => {
    const generated = parseScenarioDraftJson(draftJson(valid()));
    assert.ok(generated.plan.adventure);
    const filled = mergeScenarioDraft({
      mode: "fill_empty",
      existing: { title: "", summary: "", content: "", secretContent: "", startLocation: "", startInventory: [], npcs: [] },
      generated,
    });
    assert.deepEqual(filled.plan.adventure, generated.plan.adventure);
    const other = valid();
    other.places[1]!.name = "식당칸";
    const regenerated = parseScenarioDraftJson(draftJson(other));
    const existing = {
      title: "유령 기차",
      summary: "",
      content: "",
      secretContent: "",
      startLocation: "폐역 승강장",
      startInventory: [],
      npcs: [],
      plan: filled.plan,
    };
    const goalOnly = mergeScenarioDraft({ mode: "regenerate_selected", selectedFields: ["goal"], existing, generated: regenerated });
    assert.equal(goalOnly.plan.adventure?.places[1]?.name, "3호 객차");
    const locked = mergeScenarioDraft({ mode: "regenerate_all", lockedFields: ["adventure"], existing, generated: regenerated });
    assert.equal(locked.plan.adventure?.places[1]?.name, "3호 객차");
    const chosen = mergeScenarioDraft({ mode: "regenerate_selected", selectedFields: ["adventure"], existing, generated: regenerated });
    assert.equal(chosen.plan.adventure?.places[1]?.name, "식당칸");
    const empty = { ...emptyTrpgScenarioPlan(), startingSituation: "역", goal: "기관실" };
    const kept = mergeScenarioDraft({ mode: "regenerate_selected", selectedFields: ["adventure"], existing: { ...existing, plan: empty }, generated: parseScenarioDraftJson(draftJson(undefined)) });
    assert.equal(kept.plan.adventure, undefined);
  });

  it("fails a requested adventure the server cannot play, once, without retry", async () => {
    let calls = 0;
    await assert.rejects(
      completeTrpgScenarioDraftJson({
        kind: "scenario_draft",
        system: "sys",
        user: "user",
        expectedFields: ["title", "startingSituation", "goal", "adventure"],
        complete: async () => {
          calls += 1;
          return { text: draftJson({ ...valid(), start: "roof" }), latencyMs: 1, model: "m" };
        },
      }),
      (error: unknown) => error instanceof TrpgAuthoringAdventureInvalidError && error.issues.some((issue) => issue.includes("roof"))
    );
    assert.equal(calls, 1);
    const otherField = await completeTrpgScenarioDraftJson({
      kind: "scenario_draft",
      system: "sys",
      user: "user",
      expectedFields: ["goal"],
      complete: async () => ({ text: draftJson({ ...valid(), start: "roof" }), latencyMs: 1, model: "m" }),
    });
    assert.equal(otherField.plan.adventure, undefined);
  });
});
