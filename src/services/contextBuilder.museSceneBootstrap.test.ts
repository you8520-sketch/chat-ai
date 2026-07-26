import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "@/lib/chatModels";
import { MUSE_PROSE_M1_STYLE_SECTION } from "@/lib/proseMuseM1";
import { PROSE_MUSE_M1_ENV } from "@/lib/proseMuseM1Policy";
import { PROSE_MUSE_M11_ENV } from "@/lib/proseMuseM11Policy";
import { PROSE_MUSE_M12_ENV } from "@/lib/proseMuseM12Policy";
import {
  UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK,
  UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID,
} from "@/lib/unknownInformationTruthGuard";
import { MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV } from "@/lib/museUnknownInformationTruthGuardPolicy";
import {
  MUSE_COMPACT_SCENE_STATE_BLOCK,
  MUSE_COMPACT_SCENE_STATE_SECTION_ID,
} from "@/lib/museCompactSceneState";
import {
  MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK,
  MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID,
} from "@/lib/museStructuralLengthAnchor";
import { MUSE_SCENE_BOOTSTRAP_ENV } from "@/lib/museSceneBootstrapPolicy";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const BOOTSTRAP_KEYS = [
  MUSE_SCENE_BOOTSTRAP_ENV.SEMANTIC_ENABLED,
  MUSE_SCENE_BOOTSTRAP_ENV.ANCHOR_ENABLED,
  MUSE_SCENE_BOOTSTRAP_ENV.USER_IDS,
  MUSE_SCENE_BOOTSTRAP_ENV.MODEL_IDS,
  MUSE_SCENE_BOOTSTRAP_ENV.SEMANTIC_CHAT_IDS,
  MUSE_SCENE_BOOTSTRAP_ENV.ANCHOR_CHAT_IDS,
] as const;

const PROSE_KEYS = [
  PROSE_MUSE_M1_ENV.ENABLED,
  PROSE_MUSE_M1_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.MODEL_IDS,
  PROSE_MUSE_M11_ENV.ENABLED,
  PROSE_MUSE_M11_ENV.USER_IDS,
  PROSE_MUSE_M11_ENV.MODEL_IDS,
  PROSE_MUSE_M12_ENV.ENABLED,
  PROSE_MUSE_M12_ENV.USER_IDS,
  PROSE_MUSE_M12_ENV.MODEL_IDS,
] as const;

const TRUTH_KEYS = [
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.ENABLED,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.USER_IDS,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.MODEL_IDS,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.INTRA_WORLD_ENABLED,
] as const;

const ALL_KEYS = [...BOOTSTRAP_KEYS, ...PROSE_KEYS, ...TRUTH_KEYS] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ALL_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const criticalChunk: CharacterChunk = {
  id: "c-critical",
  characterId: "1",
  content: "[Identity]\nHero identity.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 10,
  keywords: ["hero"],
};

function buildMuse(
  userId: number,
  chatId?: number,
  modelId = OPENROUTER_MUSE_SPARK_11_MODEL
) {
  return buildContext({
    charName: "Hero",
    chunks: [criticalChunk],
    userNickname: "User",
    userId,
    chatId,
    shortTermHistory: [],
    currentUserMessage: "hello",
    nsfw: false,
    modelId,
    provider: "openrouter",
  });
}

function enableM1(userIds = "1") {
  process.env.PROSE_MUSE_M1_ENABLED = "1";
  process.env.PROSE_MUSE_M1_USER_IDS = userIds;
}

function enableTruth(userIds = "1") {
  process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
  process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = userIds;
}

function enableSemanticChats(chatIds: string, userIds = "1") {
  process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
  process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = userIds;
  process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = chatIds;
}

function enableAnchorChats(chatIds: string, userIds = "1") {
  process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
  process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = userIds;
  process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = chatIds;
}

function sectionIds(built: ReturnType<typeof buildMuse>): string[] {
  return (built.meta?.trackedSections ?? []).map((s) => s.id);
}

function countId(ids: string[], id: string): number {
  return ids.filter((x) => x === id).length;
}

function markers(built: ReturnType<typeof buildMuse>): [number, number] {
  const ids = sectionIds(built);
  return [
    countId(ids, MUSE_COMPACT_SCENE_STATE_SECTION_ID),
    countId(ids, MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID),
  ];
}

describe("buildContext — Muse scene-bootstrap 2×2 assembly (chat allowlists)", () => {
  let envSnapshot: Record<string, string | undefined>;
  let baselinePrompt: string;
  let baselineLength: string | undefined;
  let baselineTerminal: string | undefined;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ALL_KEYS) delete process.env[key];
    enableM1("1");
    enableTruth("1");
    const baseline = buildMuse(1, 104);
    baselinePrompt = baseline.systemPrompt;
    baselineLength = (baseline.meta?.trackedSections ?? []).find(
      (s) => s.id === "rule-length-control"
    )?.text;
    baselineTerminal = (baseline.meta?.trackedSections ?? []).find(
      (s) => s.id === "rule-terminal-length-override"
    )?.text;
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("A Baseline chat 104: marker 0/0; M1=1; LENGTH/Terminal/Truth unchanged", () => {
    enableSemanticChats("101,103");
    enableAnchorChats("102,103");
    const built = buildMuse(1, 104);
    assert.deepEqual(markers(built), [0, 0]);
    assert.equal((built.systemPrompt.match(/\[MUSE PROSE M1 /g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);
    assert.equal((built.systemPrompt.match(/\[MUSE PROSE M1\.2/g) ?? []).length, 0);
    assert.equal((built.systemPrompt.match(/\[PROSE VNEXT/g) ?? []).length, 0);
    assert.ok(built.systemPrompt.includes(MUSE_PROSE_M1_STYLE_SECTION));
    assert.equal(countId(sectionIds(built), "rule-length-control"), 1);
    assert.equal(countId(sectionIds(built), "rule-terminal-length-override"), 1);
    assert.equal(
      countId(sectionIds(built), UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID),
      1
    );
    assert.equal(
      (built.meta?.trackedSections ?? []).find((s) => s.id === "rule-length-control")
        ?.text,
      baselineLength
    );
    assert.equal(
      (built.meta?.trackedSections ?? []).find(
        (s) => s.id === "rule-terminal-length-override"
      )?.text,
      baselineTerminal
    );
    assert.ok(built.systemPrompt.includes(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK));
    assert.ok(
      !built.history.some(
        (m) => m.role === "assistant" && m.content.includes("CURRENT SCENE STATE")
      )
    );
  });

  it("B Semantic only chat 101: marker 1/0", () => {
    enableSemanticChats("101,103");
    enableAnchorChats("102,103");
    const built = buildMuse(1, 101);
    assert.deepEqual(markers(built), [1, 0]);
    assert.ok(built.systemPrompt.includes(MUSE_COMPACT_SCENE_STATE_BLOCK));
    assert.ok(!built.systemPrompt.includes(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK));
  });

  it("C Anchor only chat 102: marker 0/1", () => {
    enableSemanticChats("101,103");
    enableAnchorChats("102,103");
    const built = buildMuse(1, 102);
    assert.deepEqual(markers(built), [0, 1]);
    assert.ok(built.systemPrompt.includes(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK));
    assert.ok(!built.systemPrompt.includes(MUSE_COMPACT_SCENE_STATE_BLOCK));
  });

  it("D Hybrid chat 103: marker 1/1", () => {
    enableSemanticChats("101,103");
    enableAnchorChats("102,103");
    const built = buildMuse(1, 103);
    assert.deepEqual(markers(built), [1, 1]);
    assert.ok(built.systemPrompt.includes(MUSE_COMPACT_SCENE_STATE_BLOCK));
    assert.ok(built.systemPrompt.includes(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK));
  });

  it("enabled gates but missing chatId → marker 0/0 (generic Hero fixture stays OFF)", () => {
    enableSemanticChats("101,103");
    enableAnchorChats("102,103");
    const built = buildMuse(1); // no chatId
    assert.deepEqual(markers(built), [0, 0]);
    assert.equal(built.systemPrompt, baselinePrompt);
  });

  it("non-allowlisted admin Muse chat → marker 0/0", () => {
    enableSemanticChats("101,103");
    enableAnchorChats("102,103");
    const built = buildMuse(1, 9999);
    assert.deepEqual(markers(built), [0, 0]);
  });

  it("order: prose → semantic → anchor → LENGTH → Terminal → Truth", () => {
    enableSemanticChats("103");
    enableAnchorChats("103");
    const built = buildMuse(1, 103);
    const ids = sectionIds(built);
    const order = (id: string) => {
      const idx = ids.indexOf(id);
      assert.ok(idx >= 0, `missing ${id}`);
      return idx;
    };
    assert.ok(order("prose-style-xml-bundle") < order(MUSE_COMPACT_SCENE_STATE_SECTION_ID));
    assert.ok(
      order(MUSE_COMPACT_SCENE_STATE_SECTION_ID) <
        order(MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID)
    );
    assert.ok(
      order(MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID) < order("rule-length-control")
    );
    assert.ok(order("rule-length-control") < order("rule-terminal-length-override"));
    assert.ok(
      order("rule-terminal-length-override") <
        order(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID)
    );
    assert.equal(ids[ids.length - 1], UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);
  });

  it("LENGTH / Terminal text unchanged when both gates ON for allowlisted chat", () => {
    enableSemanticChats("103");
    enableAnchorChats("103");
    const built = buildMuse(1, 103);
    assert.equal(
      (built.meta?.trackedSections ?? []).find((s) => s.id === "rule-length-control")
        ?.text,
      baselineLength
    );
    assert.equal(
      (built.meta?.trackedSections ?? []).find(
        (s) => s.id === "rule-terminal-length-override"
      )?.text,
      baselineTerminal
    );
  });

  it("no fake assistant messages introduced", () => {
    enableSemanticChats("103");
    enableAnchorChats("103");
    const built = buildMuse(1, 103);
    assert.equal(built.history.filter((m) => m.role === "assistant").length, 0);
    assert.ok(!built.history.some((m) => m.content.includes("[CURRENT SCENE STATE]")));
    assert.ok(!built.history.some((m) => m.content.includes("[장면 깊이]")));
  });

  it("non-Muse → no bootstrap markers; ENABLEDs do not change DeepSeek prompt", () => {
    const off = buildMuse(1, 103, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    enableSemanticChats("103");
    enableAnchorChats("103");
    const on = buildMuse(1, 103, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(on.systemPrompt, off.systemPrompt);
    assert.deepEqual(markers(on), [0, 0]);
  });

  it("gate OFF → assembled prompt byte-stable vs baseline", () => {
    const off = buildMuse(1, 104);
    assert.equal(off.systemPrompt, baselinePrompt);
  });

  it("status extraction path unchanged (no status extract sections)", () => {
    enableSemanticChats("103");
    enableAnchorChats("103");
    const built = buildMuse(1, 103);
    const ids = sectionIds(built);
    assert.ok(!ids.some((id) => /status[-_]?widget|status[-_]?extract/i.test(id)));
  });
});
