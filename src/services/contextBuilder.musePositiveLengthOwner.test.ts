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
import { MUSE_SCENE_BOOTSTRAP_ENV } from "@/lib/museSceneBootstrapPolicy";
import {
  MUSE_COMPACT_SCENE_STATE_SECTION_ID,
} from "@/lib/museCompactSceneState";
import {
  MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID,
} from "@/lib/museStructuralLengthAnchor";
import {
  MUSE_POSITIVE_LENGTH_OWNER_BLOCK,
  MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID,
  MUSE_POSITIVE_LENGTH_TERMINAL_BLOCK,
  MUSE_POSITIVE_LENGTH_TERMINAL_SECTION_ID,
} from "@/lib/musePositiveLengthOwner";
import { MUSE_POSITIVE_LENGTH_OWNER_ENV } from "@/lib/musePositiveLengthOwnerPolicy";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const POSITIVE_KEYS = [
  MUSE_POSITIVE_LENGTH_OWNER_ENV.ENABLED,
  MUSE_POSITIVE_LENGTH_OWNER_ENV.USER_IDS,
  MUSE_POSITIVE_LENGTH_OWNER_ENV.MODEL_IDS,
  MUSE_POSITIVE_LENGTH_OWNER_ENV.CHAT_IDS,
] as const;

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

const ALL_KEYS = [
  ...POSITIVE_KEYS,
  ...BOOTSTRAP_KEYS,
  ...PROSE_KEYS,
  ...TRUTH_KEYS,
] as const;

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

function enablePositive(chatIds: string, userIds = "1") {
  process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
  process.env.MUSE_POSITIVE_LENGTH_OWNER_USER_IDS = userIds;
  process.env.MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS = chatIds;
}

function sectionIds(built: ReturnType<typeof buildMuse>): string[] {
  return (built.meta?.trackedSections ?? []).map((s) => s.id);
}

function countId(ids: string[], id: string): number {
  return ids.filter((x) => x === id).length;
}

describe("buildContext — Muse Positive Length Owner replacement assembly", () => {
  let envSnapshot: Record<string, string | undefined>;
  let baselinePrompt: string;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ALL_KEYS) delete process.env[key];
    enableM1("1");
    enableTruth("1");
    baselinePrompt = buildMuse(1, 104).systemPrompt;
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("OFF byte-stable vs baseline", () => {
    const off = buildMuse(1, 104);
    assert.equal(off.systemPrompt, baselinePrompt);
    assert.equal(countId(sectionIds(off), "rule-length-control"), 1);
    assert.equal(countId(sectionIds(off), "rule-terminal-length-override"), 1);
    assert.equal(countId(sectionIds(off), MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID), 0);
    assert.equal(countId(sectionIds(off), MUSE_POSITIVE_LENGTH_TERMINAL_SECTION_ID), 0);
  });

  it("ON: existing LENGTH/Terminal marker 0; positive owner/terminal marker 1", () => {
    enablePositive("201");
    const built = buildMuse(1, 201);
    const ids = sectionIds(built);
    assert.equal(countId(ids, "rule-length-control"), 0);
    assert.equal(countId(ids, "rule-terminal-length-override"), 0);
    assert.equal(countId(ids, MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID), 1);
    assert.equal(countId(ids, MUSE_POSITIVE_LENGTH_TERMINAL_SECTION_ID), 1);
    assert.ok(built.systemPrompt.includes(MUSE_POSITIVE_LENGTH_OWNER_BLOCK));
    assert.ok(built.systemPrompt.includes(MUSE_POSITIVE_LENGTH_TERMINAL_BLOCK));
    assert.ok(!built.systemPrompt.includes("[LENGTH CONTROL & SCENE EXPANSION]"));
    assert.ok(!built.systemPrompt.includes("단일 응답 최대 전개·미달 조기 종료 금지"));
  });

  it("ON: M1 marker unchanged; M1.1/M1.2 0; Scene Bootstrap 0/0", () => {
    enablePositive("201");
    const built = buildMuse(1, 201);
    assert.equal((built.systemPrompt.match(/\[MUSE PROSE M1 /g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);
    assert.equal((built.systemPrompt.match(/\[MUSE PROSE M1\.2/g) ?? []).length, 0);
    assert.ok(built.systemPrompt.includes(MUSE_PROSE_M1_STYLE_SECTION));
    assert.equal(countId(sectionIds(built), MUSE_COMPACT_SCENE_STATE_SECTION_ID), 0);
    assert.equal(countId(sectionIds(built), MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID), 0);
  });

  it("ON: order prose → positive owner → layout → persona → positive terminal → Truth", () => {
    enablePositive("201");
    const built = buildMuse(1, 201);
    const ids = sectionIds(built);
    const order = (id: string) => {
      const idx = ids.indexOf(id);
      assert.ok(idx >= 0, `missing ${id}`);
      return idx;
    };
    assert.ok(order("prose-style-xml-bundle") < order(MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID));
    assert.ok(
      order(MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID) < order("rule-output-layout-recency")
    );
    assert.ok(
      order("rule-output-layout-recency") < order("user-persona-reference-owner")
    );
    assert.ok(
      order("user-persona-reference-owner") <
        order(MUSE_POSITIVE_LENGTH_TERMINAL_SECTION_ID)
    );
    assert.ok(
      order(MUSE_POSITIVE_LENGTH_TERMINAL_SECTION_ID) <
        order(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID)
    );
    assert.equal(ids[ids.length - 1], UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);
    assert.ok(built.systemPrompt.includes(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK));
  });

  it("Layout unchanged when positive ON", () => {
    enablePositive("201");
    const off = buildMuse(1, 104);
    const on = buildMuse(1, 201);
    const offLayout = (off.meta?.trackedSections ?? []).find(
      (s) => s.id === "rule-output-layout-recency"
    )?.text;
    const onLayout = (on.meta?.trackedSections ?? []).find(
      (s) => s.id === "rule-output-layout-recency"
    )?.text;
    assert.equal(onLayout, offLayout);
  });

  it("non-allowlisted chat stays OFF / byte-stable", () => {
    enablePositive("201");
    const built = buildMuse(1, 104);
    assert.equal(built.systemPrompt, baselinePrompt);
    assert.equal(countId(sectionIds(built), MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID), 0);
  });

  it("missing chatId → OFF", () => {
    enablePositive("201");
    const built = buildMuse(1);
    assert.equal(built.systemPrompt, baselinePrompt);
  });

  it("non-Muse byte-stable", () => {
    const off = buildMuse(1, 201, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    enablePositive("201");
    const on = buildMuse(1, 201, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(on.systemPrompt, off.systemPrompt);
    assert.equal(countId(sectionIds(on), MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID), 0);
  });

  it("never stacks positive owner with legacy LENGTH/Terminal", () => {
    enablePositive("201");
    const built = buildMuse(1, 201);
    const ids = sectionIds(built);
    const hasPositive = countId(ids, MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID) === 1;
    const hasLegacy =
      countId(ids, "rule-length-control") +
        countId(ids, "rule-terminal-length-override") >
      0;
    assert.equal(hasPositive && hasLegacy, false);
  });
});
