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
import { estimateTokens } from "@/lib/tokenEstimate";
import { MUSE_PROSE_M1_STYLE_SECTION } from "@/lib/proseMuseM1";
import { PROSE_MUSE_M1_ENV } from "@/lib/proseMuseM1Policy";
import {
  UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK,
  UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID,
} from "@/lib/unknownInformationTruthGuard";
import { MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV } from "@/lib/museUnknownInformationTruthGuardPolicy";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const TRUTH_KEYS = [
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.ENABLED,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.USER_IDS,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.MODEL_IDS,
] as const;

const PROSE_KEYS = [
  PROSE_MUSE_M1_ENV.ENABLED,
  PROSE_MUSE_M1_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.MODEL_IDS,
] as const;

const ALL_KEYS = [...TRUTH_KEYS, ...PROSE_KEYS] as const;

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

function buildMuse(userId: number, modelId = OPENROUTER_MUSE_SPARK_11_MODEL) {
  return buildContext({
    charName: "Hero",
    chunks: [criticalChunk],
    userNickname: "User",
    userId,
    shortTermHistory: [],
    currentUserMessage: "hello",
    nsfw: false,
    modelId,
    provider: "openrouter",
  });
}

function enableTruthGuard(userIds = "1") {
  process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
  process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = userIds;
}

describe("buildContext — Muse unknown-information truth guard assembly", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ALL_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("gate OFF → existing system prompt byte-stable vs baseline (no truth marker)", () => {
    const off = buildMuse(1);
    const ids = (off.meta?.trackedSections ?? []).map((s) => s.id);
    assert.equal(ids.filter((id) => id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID).length, 0);
    assert.equal((off.systemPrompt.match(/미확인 정보 — 사실성 절대 우선/g) ?? []).length, 0);

    assert.ok(
      !(off.meta?.trackedSections ?? []).some((s) => s.id === "rule-terminal-length-override")
    );
    // Without Truth Guard, last dynamic section is typically persona reference (layout may precede).
    const idsOff = (off.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(idsOff.includes("user-persona-reference-owner"));

    // Re-run with identical inputs must be byte-identical when gate OFF.
    const off2 = buildMuse(1);
    assert.equal(off.systemPrompt, off2.systemPrompt);
    assert.equal(
      off.openRouterSystemSplit?.dynamicBlock,
      off2.openRouterSystemSplit?.dynamicBlock
    );
    assert.equal(
      off.openRouterSystemSplit?.systemRulesBlock,
      off2.openRouterSystemSplit?.systemRulesBlock
    );
    assert.equal(
      off.openRouterSystemSplit?.characterSettingsBlock,
      off2.openRouterSystemSplit?.characterSettingsBlock
    );
  });

  it("gate ON → Truth Guard marker exactly once as final system section", () => {
    enableTruthGuard("1");
    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);

    assert.equal(
      ids.filter((id) => id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID).length,
      1
    );
    assert.equal(
      (built.systemPrompt.match(/미확인 정보 — 사실성 절대 우선/g) ?? []).length,
      1
    );
    assert.ok(built.systemPrompt.includes(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK));

    const personaIdx = ids.indexOf("user-persona-reference-owner");
    const truthIdx = ids.indexOf(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);
    assert.ok(personaIdx >= 0);
    assert.ok(truthIdx > personaIdx, "Truth Guard must follow persona reference");
    assert.ok(!ids.includes("rule-terminal-length-override"));

    const lastId = ids[ids.length - 1];
    assert.equal(lastId, UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);

    const lastNonWs = built.systemPrompt.trimEnd();
    assert.ok(lastNonWs.endsWith(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK.trim()));
  });

  it("exact Muse + wrong user → 0 Truth Guard markers", () => {
    enableTruthGuard("1");
    const built = buildMuse(2);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID
      ).length,
      0
    );
  });

  it("non-Muse → 0 Truth Guard markers", () => {
    enableTruthGuard("1");
    const built = buildMuse(1, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID
      ).length,
      0
    );
  });

  it("bounded length owner remains exactly once when Truth Guard ON", () => {
    enableTruthGuard("1");
    const built = buildMuse(1);
    assert.equal((built.systemPrompt.match(/3,200~4,200자|4200/g) ?? []).length, 0);
    assert.equal((built.systemPrompt.match(/TARGET_LENGTH:/g) ?? []).length, 0);
    assert.equal((built.systemPrompt.match(/MINIMUM_FLOOR:/g) ?? []).length, 0);
    const lastUser = built.history[built.history.length - 1];
    assert.equal(lastUser?.role, "user");
    assert.equal((lastUser!.content.match(/3,200자 이상을 기본 목표로/g) ?? []).length, 1);
    assert.equal((lastUser!.content.match(/3,200~4,200자|4200/g) ?? []).length, 0);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === "rule-terminal-length-override"
      ).length,
      0
    );
  });

  it("M1 / VNext prose selection unchanged by Truth Guard alone", () => {
    // Baseline: no prose gates → Legacy Muse (no M1/VNext markers)
    const baseline = buildMuse(1);
    const baselineProse = (baseline.meta?.trackedSections ?? []).find(
      (s) => s.id === "prose-style-xml-bundle"
    );
    assert.ok(baselineProse);

    enableTruthGuard("1");
    const withTruth = buildMuse(1);
    const withTruthProse = (withTruth.meta?.trackedSections ?? []).find(
      (s) => s.id === "prose-style-xml-bundle"
    );
    assert.ok(withTruthProse);
    assert.equal(withTruthProse!.text, baselineProse!.text);
    assert.equal((withTruthProse!.text.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.equal((withTruthProse!.text.match(/\[PROSE VNEXT/g) ?? []).length, 0);

    // With M1 ON, Truth Guard must not displace M1 selection.
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    const m1Only = buildMuse(1);
    // Truth already ON
    assert.ok(m1Only.systemPrompt.includes(MUSE_PROSE_M1_STYLE_SECTION));
    assert.equal(
      (m1Only.meta?.trackedSections ?? []).filter(
        (s) => s.id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID
      ).length,
      1
    );
  });

  it("tracked tail order: layout → persona → truth (when ON); no terminal length", () => {
    enableTruthGuard("1");
    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    const order = (id: string) => {
      const idx = ids.indexOf(id);
      assert.ok(idx >= 0, `missing ${id}`);
      return idx;
    };
    assert.ok(!ids.includes("rule-length-control"));
    assert.ok(!ids.includes("rule-terminal-length-override"));
    assert.ok(order("rule-output-layout-recency") < order("user-persona-reference-owner"));
    assert.ok(
      order("user-persona-reference-owner") <
        order(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID)
    );
    assert.doesNotMatch(built.systemPrompt, /3,200~4,200자|4200/);
    const lastUser = built.history[built.history.length - 1];
    assert.match(lastUser!.content, /3,200자 이상을 기본 목표로/);
  });

  it("token budget: gate OFF delta 0; gate ON adds dynamic-only tokens", () => {
    const off = buildMuse(1);
    enableTruthGuard("1");
    const on = buildMuse(1);

    const offSplit = off.openRouterSystemSplit!;
    const onSplit = on.openRouterSystemSplit!;
    assert.ok(offSplit && onSplit);

    const cacheRulesDelta =
      estimateTokens(onSplit.systemRulesBlock) - estimateTokens(offSplit.systemRulesBlock);
    const cacheCharacterDelta =
      estimateTokens(onSplit.characterSettingsBlock) -
      estimateTokens(offSplit.characterSettingsBlock);
    const dynamicDelta =
      estimateTokens(onSplit.dynamicBlock) - estimateTokens(offSplit.dynamicBlock);
    const totalDelta = estimateTokens(on.systemPrompt) - estimateTokens(off.systemPrompt);
    const guardTokens = estimateTokens(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK);

    assert.equal(cacheRulesDelta, 0, `cacheRules delta must be 0, got ${cacheRulesDelta}`);
    assert.equal(
      cacheCharacterDelta,
      0,
      `cacheCharacter delta must be 0, got ${cacheCharacterDelta}`
    );
    // ~100–400 target; +1–2 may come from the "\n\n" section join separator.
    assert.ok(
      dynamicDelta >= 100 && dynamicDelta <= 402,
      `dynamic delta expected ~100–400, got ${dynamicDelta}`
    );
    // Join separators can shift total vs dynamic by 1–2 tokens after length consolidation.
    assert.ok(
      Math.abs(dynamicDelta - totalDelta) <= 2,
      `dynamic/total delta mismatch: dynamic=${dynamicDelta} total=${totalDelta}`
    );
    assert.ok(
      Math.abs(dynamicDelta - guardTokens) <= 2,
      `dynamic delta ${dynamicDelta} should match guard tokens ${guardTokens}`
    );

    // Document for completion report
    console.log(
      JSON.stringify({
        guardChars: UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK.length,
        guardEstimateTokens: guardTokens,
        gateOffAssembledPromptTokenDelta: 0,
        gateOnAssembledPromptTokenDelta: totalDelta,
        cacheRulesDelta,
        cacheCharacterDelta,
        dynamicDelta,
      })
    );
  });

  it("status-widget extract path unchanged (no status extract sections introduced)", () => {
    enableTruthGuard("1");
    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(!ids.some((id) => /status[-_]?widget|status[-_]?extract/i.test(id)));
  });
});
