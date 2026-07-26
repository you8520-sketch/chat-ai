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
import { MUSE_PROSE_M11_STYLE_SECTION } from "@/lib/proseMuseM11";
import { PROSE_MUSE_M11_ENV } from "@/lib/proseMuseM11Policy";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const M11_KEYS = [
  PROSE_MUSE_M11_ENV.ENABLED,
  PROSE_MUSE_M11_ENV.USER_IDS,
  PROSE_MUSE_M11_ENV.MODEL_IDS,
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(M11_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of M11_KEYS) {
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

describe("buildContext — Muse M1.1 assembly order and markers", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of M11_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("M1.1 admin gate injects M1.1 prose section exactly once, M1/VNext absent, LENGTH/Terminal unchanged", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";

    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      userId: 1,
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      provider: "openrouter",
    });

    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(ids.includes("prose-style-xml-bundle"));

    const proseSection = (built.meta?.trackedSections ?? []).find(
      (s) => s.id === "prose-style-xml-bundle"
    );
    assert.ok(proseSection);
    assert.ok(proseSection!.text.includes(MUSE_PROSE_M11_STYLE_SECTION));
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 1);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[PROSE VNEXT/g) ?? []).length, 0);

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
    assert.ok(built.systemPrompt.trimEnd().endsWith(terminalSection!.text.trim()));
  });

  it("M1.1 OFF → Muse uses Legacy prose section, no M1.1 marker", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      userId: 1,
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      provider: "openrouter",
    });

    const proseSection = (built.meta?.trackedSections ?? []).find(
      (s) => s.id === "prose-style-xml-bundle"
    );
    assert.ok(proseSection);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.equal((proseSection!.text.match(/\[PROSE VNEXT/g) ?? []).length, 0);
  });
});
