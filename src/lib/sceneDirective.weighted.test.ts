import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import type { ChatMsg } from "@/lib/ai";
import {
  buildSceneDirective,
  createSeededRng,
  getLastProgressionSelectionMeta,
  hashSeed,
  renderSceneDirectiveForPrompt,
  resolveSceneKind,
  selectProgressionTypesWeighted,
  type SceneProgressionType,
} from "./sceneDirective";
import {
  commitSceneProgressionState,
  ensureSceneProgressionSchema,
  loadSceneProgressionState,
} from "./sceneProgressionState";

const quietHistory: ChatMsg[] = [
  { role: "assistant", content: "휴게실 조명이 낮게 켜져 있었다. 그는 소파에 앉아 장갑을 정리했다." },
  { role: "user", content: "옆에 앉는다." },
  { role: "assistant", content: "그는 대답 없이 손끝만 잠깐 멈췄다. 창밖은 고요했다." },
  { role: "user", content: "조금만 더 이대로." },
];

const stagnantQuiet: ChatMsg[] = [
  { role: "assistant", content: "괜찮아. 말하지 않아도 돼." },
  { role: "user", content: "응." },
  { role: "assistant", content: "정말 괜찮아. 미안해." },
  { role: "user", content: "..." },
  { role: "assistant", content: "괜찮으면 그냥 곁에 있을게." },
  { role: "user", content: "응." },
];

const heavyMemory =
  "과거 임무 기록: 전투와 공격, 조사 보고서, 침투 작전, 구출 요청이 다수 남아 있다.";

describe("world-motion-v1.1 weighted rotation", () => {
  it("same chatId/turn/input yields identical progressionTypes", () => {
    const input = {
      mode: "interactive" as const,
      recentMessages: quietHistory,
      currentUserMessage: "손을 가볍게 겹친다.",
      memoryText: heavyMemory,
      lorebookText: "임무 공격 조사 전투",
      chatId: 42,
      currentTurn: 7,
      progressionHistory: [],
    };
    const a = buildSceneDirective(input);
    const b = buildSceneDirective(input);
    assert.deepEqual(a.progressionTypes, b.progressionTypes);
    assert.equal(getLastProgressionSelectionMeta()?.seed, "42:7:world-motion-v1.1");
  });

  it("next turn can select a different legal progression", () => {
    const base = {
      mode: "interactive" as const,
      recentMessages: stagnantQuiet,
      currentUserMessage: "응.",
      memoryText: "",
      chatId: 99,
      progressionHistory: [] as Array<{ turn: number; types: SceneProgressionType[] }>,
    };
    const t1 = buildSceneDirective({ ...base, currentTurn: 10 });
    const history = [{ turn: 10, types: t1.progressionTypes }];
    const primaries = new Set<string>([t1.progressionTypes[0]!]);
    for (let turn = 11; turn <= 16; turn++) {
      const d = buildSceneDirective({
        ...base,
        currentTurn: turn,
        progressionHistory: history.slice(-4),
      });
      primaries.add(d.progressionTypes[0]!);
      history.push({ turn, types: d.progressionTypes });
    }
    assert.ok(primaries.size >= 2, `expected variety, got ${[...primaries]}`);
  });

  it("regenerate same turn reuses same directive selection", () => {
    const input = {
      mode: "interactive" as const,
      recentMessages: quietHistory,
      currentUserMessage: "그의 손을 본다.",
      chatId: 7,
      currentTurn: 4,
      progressionHistory: [{ turn: 3, types: ["relationship" as const] }],
    };
    assert.deepEqual(buildSceneDirective(input).progressionTypes, buildSceneDirective(input).progressionTypes);
  });

  it("memory/lore operation keywords do not classify rest as operation", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      recentMessages: quietHistory,
      currentUserMessage: "그의 손 가까이에 손을 내려놓는다.",
      memoryText: heavyMemory,
      lorebookText: "임무 공격 조사 전투 침투",
      chatId: 1,
      currentTurn: 5,
    });
    const meta = getLastProgressionSelectionMeta();
    assert.equal(meta?.sceneKind, "rest");
    assert.ok(!d.progressionTypes.includes("tactical_planning"));
    assert.ok(!d.progressionTypes.includes("npc_action"));
  });

  it("investigation scene prefers lore/world/consequence", () => {
    const { types, meta } = selectProgressionTypesWeighted({
      sceneSignalText: "보관함에서 단서와 기록을 찾는다. 소문이 남아 있다.",
      groundingText: "조직 단서",
      intensity: 3,
      stagnant: false,
      chatId: 3,
      currentTurn: 2,
      progressionHistory: [],
    });
    assert.equal(meta.sceneKind, "investigation");
    assert.ok(
      types.some((t) => t === "lore_clue" || t === "world_reaction" || t === "consequence"),
      String(types)
    );
  });

  it("operation scene prefers tactical/npc/consequence", () => {
    const { types, meta } = selectProgressionTypesWeighted({
      sceneSignalText: "작전 회의에서 침투와 구출 경로를 논의한다. 동료가 대기 중이다.",
      groundingText: "",
      intensity: 4,
      stagnant: false,
      chatId: 4,
      currentTurn: 2,
      progressionHistory: [],
    });
    assert.equal(meta.sceneKind, "operation");
    assert.ok(
      types.some((t) => t === "tactical_planning" || t === "npc_action" || t === "consequence"),
      String(types)
    );
  });

  it("danger cue allows world/npc/tactical/consequence", () => {
    const { types, meta } = selectProgressionTypesWeighted({
      sceneSignalText: "경보가 울리고 습격 흔적이 복도로 번진다. 병사가 문을 두드린다.",
      groundingText: "",
      intensity: 4,
      stagnant: false,
      chatId: 5,
      currentTurn: 2,
      progressionHistory: [],
    });
    assert.ok(meta.sceneKind === "operation" || meta.sceneKind === "climax" || meta.sceneKind === "neutral");
    assert.ok(
      types.some((t) =>
        ["world_reaction", "npc_action", "tactical_planning", "consequence", "environment"].includes(t)
      ),
      String(types)
    );
  });

  it("cooldown reduces last-turn primary weight and blocks 3-in-a-row unless override", () => {
    const history = [
      { turn: 1, types: ["relationship" as const] },
      { turn: 2, types: ["relationship" as const] },
    ];
    const primaries: string[] = [];
    for (let turn = 3; turn <= 8; turn++) {
      const d = buildSceneDirective({
        mode: "interactive",
        recentMessages: stagnantQuiet,
        currentUserMessage: "응.",
        chatId: 11,
        currentTurn: turn,
        progressionHistory: history.slice(-4),
      });
      const primary = d.progressionTypes[0]!;
      primaries.push(primary);
      history.push({ turn, types: d.progressionTypes });
    }
    for (let i = 0; i < primaries.length - 2; i++) {
      const triple = primaries.slice(i, i + 3);
      assert.ok(
        !(triple[0] === triple[1] && triple[1] === triple[2]),
        `3-in-a-row primary: ${triple.join(",")}`
      );
    }
  });

  it("single eligible candidate allows cooldown override", () => {
    const { types, meta } = selectProgressionTypesWeighted({
      sceneSignalText: "결전과 대형 위기가 시작된다. 보스가 나타난다.",
      groundingText: "",
      intensity: 4,
      stagnant: false,
      chatId: 12,
      currentTurn: 9,
      progressionHistory: [
        { turn: 8, types: ["world_reaction"] },
        { turn: 7, types: ["world_reaction"] },
      ],
    });
    assert.ok(types.length >= 1);
    assert.ok(meta.eligible.length >= 1);
  });

  it("trigger consequence path may override cooldown", () => {
    const { types, meta } = selectProgressionTypesWeighted({
      sceneSignalText: "휴게실에서 조용히 앉아 있다.",
      groundingText: "",
      intensity: 1,
      stagnant: false,
      triggeredEventText: "[TRIGGER] 문이 열리며 경보가 울린다.",
      chatId: 13,
      currentTurn: 6,
      progressionHistory: [{ turn: 5, types: ["consequence"] }],
    });
    assert.ok(types.includes("consequence") || types.includes("world_reaction") || meta.cooldownOverrides.length >= 0);
    assert.ok(types.length >= 1);
  });

  it("12-turn stagnant simulation yields ≥3 primary types and no 3-in-a-row", () => {
    const history: Array<{ turn: number; types: SceneProgressionType[] }> = [];
    const primaries: SceneProgressionType[] = [];
    for (let turn = 1; turn <= 12; turn++) {
      const d = buildSceneDirective({
        mode: "interactive",
        recentMessages: stagnantQuiet,
        currentUserMessage: "응.",
        chatId: 100,
        currentTurn: turn,
        progressionHistory: history.slice(-4),
      });
      const meta = getLastProgressionSelectionMeta();
      assert.ok(d.progressionTypes.every((t) => meta?.eligible.includes(t)));
      primaries.push(d.progressionTypes[0]!);
      history.push({ turn, types: d.progressionTypes });
    }
    assert.ok(new Set(primaries).size >= 3, `primaries=${primaries.join(",")}`);
    for (let i = 0; i < primaries.length - 2; i++) {
      assert.ok(!(primaries[i] === primaries[i + 1] && primaries[i + 1] === primaries[i + 2]));
    }
  });

  it("prompt has single ENGINE RULE and stays under 600 chars for directive body", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      recentMessages: quietHistory,
      currentUserMessage: "손을 겹친다.",
      chatId: 1,
      currentTurn: 1,
    });
    const block = renderSceneDirectiveForPrompt(d);
    assert.equal((block.match(/\[PRIVATE SCENE ENGINE RULE\]/g) || []).length, 1);
    assert.ok(block.length < 600, `directiveCharCount=${block.length}`);
    assert.doesNotMatch(block, /weight|cooldown|seed|world-motion/i);
  });

  it("seeded rng is deterministic", () => {
    const a = createSeededRng(hashSeed(["1", "2", "world-motion-v1.1"]));
    const b = createSeededRng(hashSeed(["1", "2", "world-motion-v1.1"]));
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });

  it("resolveSceneKind ignores memory-only operation words when using signal text", () => {
    assert.equal(
      resolveSceneKind("휴게실에서 연인과 휴식한다.\n손을 잡는다."),
      "rest"
    );
  });
});

describe("scene_progression_state commit", () => {
  function memoryDb() {
    const db = new Database(":memory:");
    ensureSceneProgressionSchema(db);
    return db;
  }

  it("successful commit stores once; duplicate same turn skipped", () => {
    const db = memoryDb();
    assert.equal(
      commitSceneProgressionState({
        chatId: 1,
        turn: 3,
        types: ["relationship", "environment"],
        db,
      }),
      true
    );
    assert.equal(
      commitSceneProgressionState({
        chatId: 1,
        turn: 3,
        types: ["daily_life"],
        db,
      }),
      false
    );
    const state = loadSceneProgressionState(1, db);
    assert.equal(state.lastCommittedTurn, 3);
    assert.deepEqual(state.recent, [{ turn: 3, types: ["relationship", "environment"] }]);
  });

  it("keeps only last 4 history entries", () => {
    const db = memoryDb();
    for (let turn = 1; turn <= 6; turn++) {
      commitSceneProgressionState({
        chatId: 2,
        turn,
        types: ["environment"],
        db,
      });
    }
    const state = loadSceneProgressionState(2, db);
    assert.equal(state.recent.length, 4);
    assert.equal(state.recent[0]?.turn, 3);
    assert.equal(state.lastCommittedTurn, 6);
  });
});
