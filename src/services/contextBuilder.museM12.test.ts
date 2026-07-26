import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";
import { MUSE_PROSE_M12_STYLE_SECTION } from "@/lib/proseMuseM12";
import { PROSE_MUSE_M12_ENV } from "@/lib/proseMuseM12Policy";
import { PROSE_MUSE_M11_ENV } from "@/lib/proseMuseM11Policy";
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

const M12_KEYS = [
  PROSE_MUSE_M12_ENV.ENABLED,
  PROSE_MUSE_M12_ENV.USER_IDS,
  PROSE_MUSE_M12_ENV.MODEL_IDS,
] as const;

const M11_KEYS = [
  PROSE_MUSE_M11_ENV.ENABLED,
  PROSE_MUSE_M11_ENV.USER_IDS,
  PROSE_MUSE_M11_ENV.MODEL_IDS,
] as const;

const M1_KEYS = [
  PROSE_MUSE_M1_ENV.ENABLED,
  PROSE_MUSE_M1_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.MODEL_IDS,
] as const;

const TG_KEYS = [
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.ENABLED,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.USER_IDS,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.MODEL_IDS,
] as const;

const ALL_KEYS = [...M12_KEYS, ...M11_KEYS, ...M1_KEYS, ...TG_KEYS] as const;

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

function buildMuse(userId: number) {
  return buildContext({
    charName: "Hero",
    chunks: [criticalChunk],
    userNickname: "User",
    userId,
    shortTermHistory: [],
    currentUserMessage: "hello",
    nsfw: false,
    modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
    provider: "openrouter",
  });
}

describe("buildContext — Muse M1.2 assembly order and markers", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ALL_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("M1.2 admin gate injects M1.2 prose section exactly once; M1.1/M1/VNext absent; LENGTH/Terminal unchanged", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";

    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(ids.includes("prose-style-xml-bundle"));

    const proseSection = (built.meta?.trackedSections ?? []).find(
      (s) => s.id === "prose-style-xml-bundle"
    );
    assert.ok(proseSection);
    assert.ok(proseSection!.text.includes(MUSE_PROSE_M12_STYLE_SECTION));
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1\.2/g) ?? []).length, 1);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[PROSE VNEXT/g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[IMMERSIVE PROSE\]/g) ?? []).length, 0);

    assert.equal(
      (built.systemPrompt.match(/\[LENGTH CONTROL & SCENE EXPANSION\]/g) ?? []).length,
      1
    );
    assert.equal((built.systemPrompt.match(/TARGET_LENGTH:/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/MINIMUM_FLOOR:/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/\[OUTPUT LAYOUT\]\n\[SEMANTIC/g) ?? []).length, 1);

    const terminalSection = (built.meta?.trackedSections ?? []).find(
      (s) => s.id === "rule-terminal-length-override"
    );
    assert.ok(terminalSection);
  });

  it("M1.2 ON + Truth Guard ON → Truth Guard remains final section after Terminal", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS = OPENROUTER_MUSE_SPARK_11_MODEL;

    const built = buildMuse(1);
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    const terminalIdx = ids.indexOf("rule-terminal-length-override");
    const truthIdx = ids.indexOf(UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);
    assert.ok(terminalIdx >= 0);
    assert.ok(truthIdx > terminalIdx, "Truth Guard must follow Terminal");
    assert.equal(ids[ids.length - 1], UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID);
    assert.ok(built.systemPrompt.includes(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK));
    assert.equal((built.systemPrompt.match(/미확인 정보 — 사실성 절대 우선/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/\[MUSE PROSE M1\.2/g) ?? []).length, 1);
  });

  it("M1.2 OFF → Muse Legacy prose section, no M1.2 marker; byte-stable across runs", () => {
    const built = buildMuse(1);
    const proseSection = (built.meta?.trackedSections ?? []).find(
      (s) => s.id === "prose-style-xml-bundle"
    );
    assert.ok(proseSection);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1\.2/g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[PROSE VNEXT/g) ?? []).length, 0);

    const built2 = buildMuse(1);
    assert.equal(built.systemPrompt, built2.systemPrompt);
  });
});
