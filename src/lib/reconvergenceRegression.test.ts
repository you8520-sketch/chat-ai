/**
 * RC1–RC9: V2 reconvergence transition regression (offline, no provider).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  advanceV2ReconvergenceForBenchmark,
  buildScenePolicyInputFromFixture,
} from "@/lib/scenePolicyBenchmarkHarness";
import { SCENE_POLICY_BENCHMARK_FIXTURES } from "@/lib/scenePolicyBenchmarkDataset";
import {
  advanceReconvergenceState as advanceProduction,
  defaultReconvergenceState,
  detectNoContactKind,
  detectPartingIntent,
  extractReconvergenceHooks,
  prepareReconvergenceTransition,
} from "@/lib/reconvergenceState";
import { ensureReconvergenceSchema } from "@/lib/reconvergenceSchema";
import Database from "better-sqlite3";

function loadR1PilotAssistantT1(): string {
  const pilot = JSON.parse(
    fs.readFileSync("data/scene-policy-pilot/pilot-result.json", "utf8")
  );
  const r1t1 = pilot.captures.find(
    (c: { logical_id: string }) => c.logical_id === "R1_T1_v2"
  );
  assert.ok(r1t1?.raw_output);
  return r1t1.raw_output as string;
}

describe("reconvergence regression RC1–RC9", () => {
  const r1UserT1 = "오늘은 여기까지. 들어가.";
  let pilotAssistantT1: string;

  it("RC0 pilot fixture loads", () => {
    pilotAssistantT1 = loadR1PilotAssistantT1();
    assert.ok(pilotAssistantT1.length > 100);
  });

  it("RC1 R1 T1 user parting → separated-compatible state", () => {
    pilotAssistantT1 ||= loadR1PilotAssistantT1();
    const adv = advanceProduction({
      previous: defaultReconvergenceState(0, 0),
      currentTurn: 1,
      currentUserMessage: r1UserT1,
      recentMessages: [{ role: "user", content: r1UserT1 }],
    });
    assert.equal(adv.state.state, "separated");
    assert.ok(adv.reasonCodes.includes("SEPARATED_CONFIRMED"));
  });

  it("RC2 R1 T1 → shared_item false (assistant speculation ignored)", () => {
    pilotAssistantT1 ||= loadR1PilotAssistantT1();
    const hooks = extractReconvergenceHooks({
      recentMessages: [
        { role: "user", content: r1UserT1 },
        { role: "assistant", content: pilotAssistantT1 },
      ],
      currentUserMessage: r1UserT1,
      currentTurn: 1,
    });
    assert.equal(hooks.some((h) => h.type === "shared_item"), false);
  });

  it("RC3 R1 T1 → confirmed_schedule false", () => {
    pilotAssistantT1 ||= loadR1PilotAssistantT1();
    const hooks = extractReconvergenceHooks({
      recentMessages: [
        { role: "user", content: r1UserT1 },
        { role: "assistant", content: pilotAssistantT1 },
      ],
      currentUserMessage: r1UserT1,
      currentTurn: 1,
    });
    assert.equal(hooks.some((h) => h.type === "confirmed_schedule"), false);
  });

  it("RC4 assistant schedule question does not create confirmed_schedule", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [{ role: "assistant", content: "내일 일정은 어떻게 돼요?" }],
      currentUserMessage: "응.",
      currentTurn: 2,
    });
    assert.equal(hooks.some((h) => h.type === "confirmed_schedule"), false);
  });

  it("RC5 assistant generic luggage mention does not create shared_item", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [{ role: "assistant", content: "짐을 정리하며 고개를 끄덕인다." }],
      currentUserMessage: "고마워.",
      currentTurn: 2,
    });
    assert.equal(hooks.some((h) => h.type === "shared_item"), false);
  });

  it("RC6 user-confirmed schedule fixture preserves confirmed_schedule", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [],
      currentUserMessage: "그럼 내일 점심 회의 일정 확정이야.",
      currentTurn: 1,
    });
    assert.ok(hooks.some((h) => h.type === "confirmed_schedule"));
  });

  it("RC7 B13/R2 user shared item preserved", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [{ role: "user", content: "코트 맡아줘. 다음에 받을게." }],
      currentUserMessage: "먼저 갈게.",
      currentTurn: 1,
    });
    assert.ok(hooks.some((h) => h.type === "shared_item"));
  });

  it("RC8 R5 explicit no-contact preserved", () => {
    assert.equal(detectNoContactKind("오늘은 그만. 찾아오지 마."), "temporary_quiet");
    const adv = advanceProduction({
      previous: defaultReconvergenceState(0, 0),
      currentTurn: 1,
      currentUserMessage: "오늘은 그만. 찾아오지 마.",
      recentMessages: [{ role: "user", content: "오늘은 그만. 찾아오지 마." }],
    });
    assert.equal(adv.state.state, "temporary_quiet");
    assert.equal(adv.state.unresolvedHooks.length, 0);
  });

  it("RC9 production transition and benchmark adapter parity", () => {
    pilotAssistantT1 ||= loadR1PilotAssistantT1();
    const productionInput = {
      previous: defaultReconvergenceState(0, 0),
      currentTurn: 1,
      currentUserMessage: r1UserT1,
      recentMessages: [{ role: "user", content: r1UserT1 }] as const,
    };
    const productionNext = advanceProduction(productionInput).state;

    const fixture = {
      id: "R1_T1_v2",
      family: "B14_LONG_SEPARATION" as const,
      kind: "reconvergence_trajectory" as const,
      label: "R1 T1",
      history: [] as { role: "user" | "assistant"; content: string }[],
      currentUserMessage: r1UserT1,
      currentTurn: 1,
    };
    const policyInput = buildScenePolicyInputFromFixture(fixture);
    const { nextState: benchmarkNext } = advanceV2ReconvergenceForBenchmark({
      policyInput: {
        ...policyInput,
        recentMessages: [{ role: "user", content: r1UserT1 }],
      },
    });

    assert.deepEqual(
      {
        state: benchmarkNext.state,
        hooks: benchmarkNext.unresolvedHooks.map((h) => h.type),
      },
      {
        state: productionNext.state,
        hooks: productionNext.unresolvedHooks.map((h) => h.type),
      }
    );

    // Assistant in recentMessages must not change committed transition outcome.
    const withAssistant = advanceProduction({
      ...productionInput,
      recentMessages: [
        { role: "user", content: r1UserT1 },
        { role: "assistant", content: pilotAssistantT1 },
      ],
    }).state;
    assert.equal(withAssistant.state, productionNext.state);
    assert.deepEqual(
      withAssistant.unresolvedHooks.map((h) => h.type),
      productionNext.unresolvedHooks.map((h) => h.type)
    );
  });

  it("parting detects session-end phrasing", () => {
    assert.equal(detectPartingIntent("오늘은 여기까지. 들어가."), true);
  });
});

describe("prepareReconvergenceTransition passes authoritative pools", () => {
  it("trigger text can ground hooks", () => {
    const db = new Database(":memory:");
    ensureReconvergenceSchema(db);
    const pending = prepareReconvergenceTransition({
      namespace: "production",
      chatId: 1,
      characterId: 1,
      currentTurn: 2,
      currentUserMessage: "잠깐 쉰다.",
      recentMessages: [{ role: "user", content: "잠깐 쉰다." }],
      triggeredEventText: "내일 오전 회의 일정이 확정되었다.",
      requestId: "rc-trigger",
      db,
    });
    assert.ok(
      pending.next.unresolvedHooks.some((h) => h.type === "confirmed_schedule")
    );
    db.close();
  });
});
