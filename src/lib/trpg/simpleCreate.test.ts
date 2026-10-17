import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { emptyTrpgScenarioPlan } from "./scenarioPlan";
import {
  advanceSimpleCreate,
  buildSimpleDraftRequest,
  composeSimpleScenario,
  createSingleFlight,
  newSimpleCreateSession,
  parseSimpleCreatedId,
  parseSimpleCreateSession,
  SIMPLE_CREATE_DRAFT_TIMEOUT_MESSAGE,
  SIMPLE_CREATE_EMPTY_MESSAGE,
  SIMPLE_CREATE_SAVE_FAILED_MESSAGE,
  SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE,
  serializeSimpleCreateSession,
  simpleCreatedHref,
  simpleCreateInputProblem,
  type SimpleCreateDraft,
  type SimpleCreateInput,
} from "./simpleCreate";
import { TRPG_SCENARIO_BUNDLE_LIMIT } from "./scenarioTypes";

function draftFixture(generatedAt = "2026-10-17T00:00:00.000Z"): SimpleCreateDraft {
  return {
    title: "폐역의 유령 기차",
    summary: "밤마다 돌아오는 유령 기차의 비밀을 파헤친다.",
    startLocation: "폐역 승강장",
    startInventory: ["손전등"],
    npcs: [],
    plan: {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "비 오는 밤, 폐역 승강장에 닿은 기차가 멈춰 선다.",
      centralConflict: "기차는 사라진 승객을 되찾으려 한다.",
      goal: "기차의 정체를 밝히고 봉인한다.",
      endingConditions: ["기차를 봉인한다"],
      provenance: { generatedAt, generatorModel: "test-model" } as never,
    },
  };
}

type Call = { url: string; method: string; body: unknown };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(handlers: {
  draft?: (n: number) => Response | Promise<Response>;
  post?: (n: number, body: Record<string, unknown>) => Response | Promise<Response>;
  list?: () => Response | Promise<Response>;
}) {
  const calls: Call[] = [];
  let draftN = 0;
  let postN = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === "/api/trpg/scenarios/ai-draft") {
      draftN += 1;
      return handlers.draft!(draftN);
    }
    if (url === "/api/trpg/scenarios" && method === "POST") {
      postN += 1;
      return handlers.post!(postN, body);
    }
    if (url === "/api/trpg/scenarios" && method === "GET") {
      return handlers.list ? handlers.list() : jsonResponse(200, { mine: [], public: [] });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return {
    impl,
    calls,
    count: (url: string, method: string) => calls.filter((c) => c.url === url && c.method === method).length,
  };
}

const okDraft = () => jsonResponse(200, { ok: true, saved: false, draft: draftFixture() });
const okPost = (n: number, body: Record<string, unknown>) =>
  jsonResponse(200, { scenario: { id: 40 + n, title: body.title, scenarioPlan: body.scenarioPlan } });

const DESC: SimpleCreateInput = { description: "  비 오는 밤 폐역에서 유령 기차를 쫓는 이야기  ", worldId: null };

describe("simple TRPG create", () => {
  it("input problem: empty input is the only blocker before the paid call", () => {
    assert.equal(simpleCreateInputProblem({ description: "  ", worldId: null }), SIMPLE_CREATE_EMPTY_MESSAGE);
    assert.equal(simpleCreateInputProblem(DESC), null);
    assert.equal(simpleCreateInputProblem({ description: "", worldId: 3 }), null);
    const huge = { description: "가".repeat(TRPG_SCENARIO_BUNDLE_LIMIT + 1), worldId: null };
    assert.match(simpleCreateInputProblem(huge) ?? "", /\d/);
    const worldHeavy = simpleCreateInputProblem(
      { description: "가".repeat(100), worldId: 3 },
      { id: 3, summary: "", content: "나".repeat(TRPG_SCENARIO_BUNDLE_LIMIT) }
    );
    assert.ok(worldHeavy);
  });

  it("draft request: description travels as content, world as worldId, nothing else is required", () => {
    const onlyDescription = buildSimpleDraftRequest(DESC);
    assert.equal(onlyDescription.worldId, null);
    assert.equal(onlyDescription.mode, "fill_empty");
    assert.equal(onlyDescription.existingDraft.content, "비 오는 밤 폐역에서 유령 기차를 쫓는 이야기");
    assert.equal(onlyDescription.existingDraft.title, "");
    assert.deepEqual(onlyDescription.lockedFields, []);

    const onlyWorld = buildSimpleDraftRequest({ description: "", worldId: 7 });
    assert.equal(onlyWorld.worldId, 7);
    assert.equal(onlyWorld.existingDraft.content, "");

    const both = buildSimpleDraftRequest({ description: "추가 설정", worldId: 7 });
    assert.equal(both.worldId, 7);
    assert.equal(both.existingDraft.content, "추가 설정");
  });

  it("compose: private save payload with the AI title/plan, default rules, and the original world kept", () => {
    const result = composeSimpleScenario({ description: "추가 설정", worldId: 7 }, draftFixture());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const { payload, preview } = result.composed;
    assert.equal(payload.visibility, "private");
    assert.equal(payload.worldId, 7);
    assert.equal(payload.title, "폐역의 유령 기차");
    assert.equal(payload.content, "추가 설정");
    assert.equal(payload.startLocation, "폐역 승강장");
    assert.equal(preview.startingSituation, "비 오는 밤, 폐역 승강장에 닿은 기차가 멈춰 선다.");
    assert.equal(result.composed.generatedAt, "2026-10-17T00:00:00.000Z");
  });

  it("compose: an unplayable AI result is rejected instead of saved", () => {
    const empty: SimpleCreateDraft = { ...draftFixture(), title: "", plan: emptyTrpgScenarioPlan() };
    const result = composeSimpleScenario(DESC, empty);
    assert.deepEqual(result, { ok: false, message: SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE });
  });

  it("compose: start and goal without any ending possibility is rejected, optional fields stay optional", () => {
    const base = draftFixture();
    const noEnding: SimpleCreateDraft = { ...base, plan: { ...base.plan, endingConditions: [], endingCandidates: [] } };
    assert.deepEqual(composeSimpleScenario(DESC, noEnding), { ok: false, message: SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE });

    const candidatesOnly: SimpleCreateDraft = {
      ...base,
      plan: { ...base.plan, endingConditions: [], endingCandidates: ["진실을 밝히고 떠난다"] },
    };
    assert.equal(composeSimpleScenario(DESC, candidatesOnly).ok, true);

    const minimal: SimpleCreateDraft = {
      ...base,
      summary: "",
      startLocation: "",
      startInventory: [],
      plan: { ...emptyTrpgScenarioPlan(), startingSituation: "역에 선다", goal: "기차를 막는다", endingConditions: ["기차가 멈춘다"] },
    };
    assert.equal(composeSimpleScenario(DESC, minimal).ok, true);
  });

  it("description only: one draft call, one private POST, saved id returned", async () => {
    const net = fakeFetch({ draft: okDraft, post: okPost });
    const steps: string[] = [];
    const outcome = await advanceSimpleCreate({
      session: newSimpleCreateSession(DESC),
      fetchImpl: net.impl,
      onStep: (step) => steps.push(step),
    });
    assert.equal(outcome.status, "saved");
    assert.equal(outcome.session.savedId, 41);
    assert.deepEqual(steps, ["draft", "save"]);
    assert.equal(net.count("/api/trpg/scenarios/ai-draft", "POST"), 1);
    assert.equal(net.count("/api/trpg/scenarios", "POST"), 1);
    const draftBody = net.calls[0]!.body as { worldId: number | null; existingDraft: { content: string } };
    assert.equal(draftBody.worldId, null);
    assert.equal(draftBody.existingDraft.content, "비 오는 밤 폐역에서 유령 기차를 쫓는 이야기");
    const saveBody = net.calls[1]!.body as Record<string, unknown>;
    assert.equal(saveBody.visibility, "private");
    assert.equal(saveBody.title, "폐역의 유령 기차");
    assert.equal(saveBody.worldId ?? null, null);
  });

  it("world only and world plus description keep the original world and never write it", async () => {
    for (const input of [
      { description: "", worldId: 7 },
      { description: "분위기는 어둡게", worldId: 7 },
    ]) {
      const net = fakeFetch({ draft: okDraft, post: okPost });
      const outcome = await advanceSimpleCreate({
        session: newSimpleCreateSession(input),
        world: { id: 7, summary: "세계 요약", content: "세계 본문" },
        fetchImpl: net.impl,
      });
      assert.equal(outcome.status, "saved");
      assert.equal((net.calls[0]!.body as { worldId: number }).worldId, 7);
      assert.equal((net.calls[1]!.body as { worldId: number }).worldId, 7);
      assert.ok(net.calls.every((c) => !c.url.includes("/worlds")));
    }
  });

  it("draft failure and timeout keep the input and save nothing", async () => {
    const failures: Array<[() => Response | Promise<Response>, string | RegExp]> = [
      [() => jsonResponse(504, { error: "x", code: "SCENARIO_DRAFT_TIMEOUT" }), SIMPLE_CREATE_DRAFT_TIMEOUT_MESSAGE],
      [() => jsonResponse(422, { error: "초안이 잘렸습니다." }), "초안이 잘렸습니다."],
      [() => jsonResponse(429, { error: "잠시 후 다시 시도해 주세요." }), "잠시 후 다시 시도해 주세요."],
      [
        () => {
          const err = new Error("The operation was aborted due to timeout");
          err.name = "TimeoutError";
          throw err;
        },
        SIMPLE_CREATE_DRAFT_TIMEOUT_MESSAGE,
      ],
      [() => jsonResponse(200, { ok: true, draft: { title: "" } }), SIMPLE_CREATE_UNUSABLE_DRAFT_MESSAGE],
    ];
    for (const [draft, message] of failures) {
      const net = fakeFetch({ draft, post: okPost });
      const session = newSimpleCreateSession(DESC);
      const outcome = await advanceSimpleCreate({ session, fetchImpl: net.impl });
      assert.equal(outcome.status, "draft_failed");
      if (outcome.status !== "draft_failed") return;
      assert.equal(outcome.message, message);
      assert.deepEqual(outcome.session.input, DESC);
      assert.equal(outcome.session.composed, null);
      assert.equal(net.count("/api/trpg/scenarios", "POST"), 0);
    }
  });

  it("save failure keeps the generated result and the retry never calls the draft again", async () => {
    const net = fakeFetch({
      draft: okDraft,
      post: (n, body) => (n === 1 ? jsonResponse(500, { error: "" }) : okPost(n, body)),
      list: () => jsonResponse(200, { mine: [], public: [] }),
    });
    const first = await advanceSimpleCreate({ session: newSimpleCreateSession(DESC), fetchImpl: net.impl });
    assert.equal(first.status, "save_failed");
    if (first.status !== "save_failed") return;
    assert.equal(first.message, SIMPLE_CREATE_SAVE_FAILED_MESSAGE);
    assert.ok(first.session.composed);
    assert.equal(first.session.savedId, null);

    const retry = await advanceSimpleCreate({ session: first.session, fetchImpl: net.impl });
    assert.equal(retry.status, "saved");
    assert.equal(net.count("/api/trpg/scenarios/ai-draft", "POST"), 1);
    assert.equal(net.count("/api/trpg/scenarios", "POST"), 2);
  });

  it("a network error during save is a save failure, not a draft failure", async () => {
    const net = fakeFetch({
      draft: okDraft,
      post: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const outcome = await advanceSimpleCreate({ session: newSimpleCreateSession(DESC), fetchImpl: net.impl });
    assert.equal(outcome.status, "save_failed");
    assert.ok(outcome.session.composed);
  });

  it("ambiguous save: a retry adopts the row that already committed instead of saving twice", async () => {
    const generatedAt = "2026-10-17T00:00:00.000Z";
    const net = fakeFetch({
      draft: okDraft,
      post: () => {
        throw new TypeError("Failed to fetch");
      },
      list: () =>
        jsonResponse(200, {
          mine: [
            { id: 99, title: "다른 모험", scenarioPlan: { provenance: { generatedAt: "other" } } },
            { id: 55, title: "폐역의 유령 기차", scenarioPlan: { provenance: { generatedAt } } },
          ],
          public: [],
        }),
    });
    const first = await advanceSimpleCreate({ session: newSimpleCreateSession(DESC), fetchImpl: net.impl });
    assert.equal(first.status, "save_failed");
    const retry = await advanceSimpleCreate({ session: first.session, fetchImpl: net.impl });
    assert.equal(retry.status, "saved");
    assert.equal(retry.session.savedId, 55);
    assert.equal(net.count("/api/trpg/scenarios", "POST"), 1);
    assert.equal(net.count("/api/trpg/scenarios/ai-draft", "POST"), 1);
  });

  it("an already saved session is never saved again", async () => {
    const net = fakeFetch({ draft: okDraft, post: okPost });
    const outcome = await advanceSimpleCreate({
      session: { ...newSimpleCreateSession(DESC), savedId: 12 },
      fetchImpl: net.impl,
    });
    assert.equal(outcome.status, "saved");
    assert.equal(net.calls.length, 0);
  });

  it("single flight: a double click joins the running job, so one draft and one save happen", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const net = fakeFetch({
      draft: async () => {
        await gate;
        return okDraft();
      },
      post: okPost,
    });
    const flight = createSingleFlight();
    const run = () =>
      flight.run(() => advanceSimpleCreate({ session: newSimpleCreateSession(DESC), fetchImpl: net.impl }));
    const a = run();
    assert.equal(flight.busy, true);
    const b = run();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, rb);
    assert.equal(flight.busy, false);
    assert.equal(net.count("/api/trpg/scenarios/ai-draft", "POST"), 1);
    assert.equal(net.count("/api/trpg/scenarios", "POST"), 1);
  });

  it("session storage: input and generated result survive a refresh; foreign worlds are dropped", async () => {
    const net = fakeFetch({ draft: okDraft, post: () => jsonResponse(500, { error: "" }) });
    const failed = await advanceSimpleCreate({
      session: newSimpleCreateSession({ description: "설명", worldId: 7 }),
      fetchImpl: net.impl,
    });
    const raw = serializeSimpleCreateSession(failed.session);

    const restored = parseSimpleCreateSession(raw, [7]);
    assert.ok(restored);
    assert.equal(restored.input.worldId, 7);
    assert.equal(restored.input.description, "설명");
    assert.ok(restored.composed);
    assert.equal(restored.saveAttempted, true);

    const foreign = parseSimpleCreateSession(raw, [8]);
    assert.ok(foreign);
    assert.equal(foreign.input.worldId, null);
    assert.equal(foreign.input.description, "설명");
    assert.equal(foreign.composed, null);

    assert.equal(parseSimpleCreateSession("not json", [7]), null);
    assert.equal(parseSimpleCreateSession(null, [7]), null);
    assert.equal(parseSimpleCreateSession(JSON.stringify({ input: "x" }), [7]), null);
  });

  it("result url round-trips the saved scenario id", () => {
    assert.equal(simpleCreatedHref(12), "/world/create?tab=scenario&created=12");
    assert.equal(parseSimpleCreatedId("12"), 12);
    assert.equal(parseSimpleCreatedId("abc"), null);
    assert.equal(parseSimpleCreatedId("-3"), null);
    assert.equal(parseSimpleCreatedId(null), null);
  });

  it("wiring: the create tab renders the simple flow and reuses the play handoff and editor routes", () => {
    const createWorld = readFileSync("src/components/CreateWorld.tsx", "utf8");
    assert.match(createWorld, /<TrpgSimpleCreate/);
    assert.doesNotMatch(createWorld, /<TrpgScenarioEditor/);
    const ui = readFileSync("src/app/trpg/TrpgSimpleCreate.tsx", "utf8");
    assert.match(ui, /trpgPlayHref\(/);
    assert.match(ui, /\/trpg\/scenarios\/\$\{/);
    assert.match(ui, /advanceSimpleCreate/);
    assert.match(ui, /createSingleFlight/);
    assert.match(ui, /모험 만들기/);
    assert.match(ui, /이 모험 시작/);
    assert.match(ui, /내용 보기·수정/);
    assert.doesNotMatch(ui, /필수 이야기/);
  });
});
