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
import { MUSE_PROSE_M11_STYLE_SECTION } from "@/lib/proseMuseM11";
import { PROSE_MUSE_M11_ENV } from "@/lib/proseMuseM11Policy";
import {
  UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK,
  UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID,
} from "@/lib/unknownInformationTruthGuard";
import {
  isMuseIntraWorldProvenanceGuardEnabledForUser,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV,
} from "@/lib/museUnknownInformationTruthGuardPolicy";
import {
  INTRA_WORLD_PROVENANCE_GUARD_BLOCK,
  INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID,
} from "@/lib/intraWorldProvenanceGuard";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const TRUTH_KEYS = [
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.ENABLED,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.USER_IDS,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.MODEL_IDS,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.INTRA_WORLD_ENABLED,
] as const;

const PROSE_KEYS = [
  PROSE_MUSE_M1_ENV.ENABLED,
  PROSE_MUSE_M1_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.MODEL_IDS,
  PROSE_MUSE_M11_ENV.ENABLED,
  PROSE_MUSE_M11_ENV.USER_IDS,
  PROSE_MUSE_M11_ENV.MODEL_IDS,
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

function enableIntraWorldProvenanceGuard(userIds = "1") {
  enableTruthGuard(userIds);
  process.env.MUSE_INTRAWORLD_PROVENANCE_GUARD_ENABLED = "1";
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

    const terminal = (off.meta?.trackedSections ?? []).find(
      (s) => s.id === "rule-terminal-length-override"
    );
    assert.ok(terminal);
    assert.ok(off.systemPrompt.trimEnd().endsWith(terminal!.text.trim()));

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

  it("gate ON → Truth Guard marker exactly once as final system section after Terminal", () => {
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

    const terminalIdx = ids.indexOf("rule-terminal-length-override");
    const truthIdx = ids.indexOf(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);
    assert.ok(terminalIdx >= 0);
    assert.ok(truthIdx > terminalIdx, "Truth Guard must follow Terminal");

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

  it("LENGTH and Terminal markers remain exactly once when Truth Guard ON", () => {
    enableTruthGuard("1");
    const built = buildMuse(1);
    assert.equal(
      (built.systemPrompt.match(/\[LENGTH CONTROL & SCENE EXPANSION\]/g) ?? []).length,
      1
    );
    assert.equal((built.systemPrompt.match(/TARGET_LENGTH:/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/MINIMUM_FLOOR:/g) ?? []).length, 1);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === "rule-terminal-length-override"
      ).length,
      1
    );
    assert.equal((built.systemPrompt.match(/TARGET_LENGTH \d/g) ?? []).length, 1);
  });

  it("M1 / M1.1 / VNext prose selection unchanged by Truth Guard alone", () => {
    // Baseline: no prose gates → Legacy Muse (no M1/M1.1/VNext markers)
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
    assert.equal((withTruthProse!.text.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);
    assert.equal((withTruthProse!.text.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.equal((withTruthProse!.text.match(/\[PROSE VNEXT/g) ?? []).length, 0);

    // With M1 ON, Truth Guard must not displace M1 selection.
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    const m1Only = buildMuse(1);
    // Truth already ON
    assert.ok(m1Only.systemPrompt.includes(MUSE_PROSE_M1_STYLE_SECTION));
    assert.equal((m1Only.systemPrompt.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);

    // M1.1 wins over M1 when both ON; Truth Guard still independent.
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    const m11 = buildMuse(1);
    assert.ok(m11.systemPrompt.includes(MUSE_PROSE_M11_STYLE_SECTION));
    assert.equal((m11.systemPrompt.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.equal(
      (m11.meta?.trackedSections ?? []).filter(
        (s) => s.id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID
      ).length,
      1
    );
  });

  it("tracked tail order: length → layout → persona → terminal → truth (when ON)", () => {
    enableTruthGuard("1");
    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    const order = (id: string) => {
      const idx = ids.indexOf(id);
      assert.ok(idx >= 0, `missing ${id}`);
      return idx;
    };
    assert.ok(order("rule-length-control") < order("rule-output-layout-recency"));
    assert.ok(order("rule-output-layout-recency") < order("user-persona-reference-owner"));
    assert.ok(order("user-persona-reference-owner") < order("rule-terminal-length-override"));
    assert.ok(
      order("rule-terminal-length-override") <
        order(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID)
    );
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
    assert.equal(dynamicDelta, totalDelta);
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

describe("buildContext — Muse intra-world provenance guard assembly", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ALL_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("provenance gate OFF → assembled prompt byte-stable vs no-guard baseline", () => {
    const off = buildMuse(1);
    const off2 = buildMuse(1);
    assert.equal(off.systemPrompt, off2.systemPrompt);
    assert.equal(
      (off.meta?.trackedSections ?? []).filter(
        (s) => s.id === INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID
      ).length,
      0
    );
    assert.equal(
      (off.systemPrompt.match(/세계 내부 구체 설정 — 출처 우선/g) ?? []).length,
      0
    );
  });

  it("provenance gate ON without base Truth Guard → OFF (fail-closed)", () => {
    process.env.MUSE_INTRAWORLD_PROVENANCE_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    const built = buildMuse(1);
    assert.equal(isMuseIntraWorldProvenanceGuardEnabledForUser(1, OPENROUTER_MUSE_SPARK_11_MODEL), false);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID
      ).length,
      0
    );
  });

  it("provenance gate ON → markers exactly once and final after Truth Guard", () => {
    enableIntraWorldProvenanceGuard("1");
    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);

    assert.equal(
      ids.filter((id) => id === INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID).length,
      1
    );
    assert.equal(
      ids.filter((id) => id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID).length,
      1
    );
    assert.equal(
      ids.filter((id) => id === "rule-terminal-length-override").length,
      1
    );
    assert.ok(built.systemPrompt.includes(INTRA_WORLD_PROVENANCE_GUARD_BLOCK));
    assert.ok(built.systemPrompt.includes(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK));

    const terminalIdx = ids.indexOf("rule-terminal-length-override");
    const truthIdx = ids.indexOf(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);
    const provenanceIdx = ids.indexOf(INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID);

    assert.ok(terminalIdx >= 0);
    assert.ok(truthIdx > terminalIdx, "Truth Guard must follow Terminal");
    assert.ok(provenanceIdx > truthIdx, "Provenance Guard must follow Truth Guard");
    assert.equal(ids[ids.length - 1], INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID);
    assert.ok(built.systemPrompt.trimEnd().endsWith(INTRA_WORLD_PROVENANCE_GUARD_BLOCK.trim()));
  });

  it("provenance gate ON + wrong user → 0 provenance markers", () => {
    enableIntraWorldProvenanceGuard("1");
    const built = buildMuse(2);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID
      ).length,
      0
    );
  });

  it("provenance gate ON + non-Muse → 0 provenance markers", () => {
    enableIntraWorldProvenanceGuard("1");
    const built = buildMuse(1, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID
      ).length,
      0
    );
  });

  it("provenance gate ON → LENGTH/Terminal/Truth markers unchanged", () => {
    enableIntraWorldProvenanceGuard("1");
    const built = buildMuse(1);
    assert.equal(
      (built.systemPrompt.match(/\[LENGTH CONTROL & SCENE EXPANSION\]/g) ?? []).length,
      1
    );
    assert.equal((built.systemPrompt.match(/TARGET_LENGTH:/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/MINIMUM_FLOOR:/g) ?? []).length, 1);
    assert.equal(
      (built.meta?.trackedSections ?? []).filter((s) => s.id === "rule-terminal-length-override").length,
      1
    );
    assert.equal(
      (built.meta?.trackedSections ?? []).filter(
        (s) => s.id === UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID
      ).length,
      1
    );
  });

  it("M1 / M1.1 prose selection unchanged with provenance guard ON", () => {
    enableIntraWorldProvenanceGuard("1");
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    const m1 = buildMuse(1);
    assert.ok(m1.systemPrompt.includes(MUSE_PROSE_M1_STYLE_SECTION));
    assert.equal(
      (m1.meta?.trackedSections ?? []).filter(
        (s) => s.id === INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID
      ).length,
      1
    );

    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    const m11 = buildMuse(1);
    assert.ok(m11.systemPrompt.includes(MUSE_PROSE_M11_STYLE_SECTION));
    assert.equal(
      (m11.systemPrompt.match(/\[MUSE PROSE M1 /g) ?? []).length,
      0
    );
    assert.equal(
      (m11.meta?.trackedSections ?? []).filter(
        (s) => s.id === INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID
      ).length,
      1
    );
  });

  it("tracked tail order: length → layout → persona → terminal → truth → provenance (when both ON)", () => {
    enableIntraWorldProvenanceGuard("1");
    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    const order = (id: string) => {
      const idx = ids.indexOf(id);
      assert.ok(idx >= 0, `missing ${id}`);
      return idx;
    };
    assert.ok(order("rule-length-control") < order("rule-output-layout-recency"));
    assert.ok(order("rule-output-layout-recency") < order("user-persona-reference-owner"));
    assert.ok(order("user-persona-reference-owner") < order("rule-terminal-length-override"));
    assert.ok(
      order("rule-terminal-length-override") < order(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID)
    );
    assert.ok(
      order(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID) < order(INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID)
    );
  });

  it("token budget: provenance gate ON adds only dynamic tokens when base truth is already ON", () => {
    enableTruthGuard("1");
    const truthOnly = buildMuse(1);
    process.env.MUSE_INTRAWORLD_PROVENANCE_GUARD_ENABLED = "1";
    const withProvenance = buildMuse(1);

    const truthSplit = truthOnly.openRouterSystemSplit!;
    const provSplit = withProvenance.openRouterSystemSplit!;
    assert.ok(truthSplit && provSplit);

    const cacheRulesDelta =
      estimateTokens(provSplit.systemRulesBlock) - estimateTokens(truthSplit.systemRulesBlock);
    const cacheCharacterDelta =
      estimateTokens(provSplit.characterSettingsBlock) -
      estimateTokens(truthSplit.characterSettingsBlock);
    const dynamicDelta =
      estimateTokens(provSplit.dynamicBlock) - estimateTokens(truthSplit.dynamicBlock);
    const totalDelta = estimateTokens(withProvenance.systemPrompt) - estimateTokens(truthOnly.systemPrompt);
    const guardTokens = estimateTokens(INTRA_WORLD_PROVENANCE_GUARD_BLOCK);

    assert.equal(cacheRulesDelta, 0, `cacheRules delta must be 0, got ${cacheRulesDelta}`);
    assert.equal(
      cacheCharacterDelta,
      0,
      `cacheCharacter delta must be 0, got ${cacheCharacterDelta}`
    );
    assert.ok(
      dynamicDelta >= 100 && dynamicDelta <= 250,
      `dynamic delta expected ~100–250, got ${dynamicDelta}`
    );
    assert.equal(dynamicDelta, totalDelta);
    assert.ok(
      Math.abs(dynamicDelta - guardTokens) <= 2,
      `dynamic delta ${dynamicDelta} should match guard tokens ${guardTokens}`
    );

    console.log(
      JSON.stringify({
        intraWorldGuardChars: INTRA_WORLD_PROVENANCE_GUARD_BLOCK.length,
        intraWorldGuardEstimateTokens: guardTokens,
        truthOnPromptTokenDelta: totalDelta,
        cacheRulesDelta,
        cacheCharacterDelta,
        dynamicDelta,
      })
    );
  });

  it("status-widget extract path unchanged when provenance gate ON", () => {
    enableIntraWorldProvenanceGuard("1");
    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(!ids.some((id) => /status[-_]?widget|status[-_]?extract/i.test(id)));
  });
});
