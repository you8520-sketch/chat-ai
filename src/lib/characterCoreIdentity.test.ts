import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { CharacterChunk } from "@/types";

let resolveCoreIdentityCharBudget: typeof import("./characterCoreIdentity").resolveCoreIdentityCharBudget;
let resolveCoreIdentityTokenBudget: typeof import("./characterCoreIdentity").resolveCoreIdentityTokenBudget;
let estimateSettingTokens: typeof import("./characterCoreIdentity").estimateSettingTokens;
let buildCoreIdentityBlock: typeof import("./characterCoreIdentity").buildCoreIdentityBlock;
let selectRagSectionsFromSetting: typeof import("./characterCoreIdentity").selectRagSectionsFromSetting;
let filterCharacterChunksForRag: typeof import("./characterCoreIdentity").filterCharacterChunksForRag;
let CORE_IDENTITY_MIN_TOKENS: number;
let CORE_IDENTITY_MAX_TOKENS: number;

before(async () => {
  const mod = await import("./characterCoreIdentity");
  resolveCoreIdentityCharBudget = mod.resolveCoreIdentityCharBudget;
  resolveCoreIdentityTokenBudget = mod.resolveCoreIdentityTokenBudget;
  estimateSettingTokens = mod.estimateSettingTokens;
  buildCoreIdentityBlock = mod.buildCoreIdentityBlock;
  selectRagSectionsFromSetting = mod.selectRagSectionsFromSetting;
  filterCharacterChunksForRag = mod.filterCharacterChunksForRag;
  CORE_IDENTITY_MIN_TOKENS = mod.CORE_IDENTITY_MIN_TOKENS;
  CORE_IDENTITY_MAX_TOKENS = mod.CORE_IDENTITY_MAX_TOKENS;
});

describe("resolveCoreIdentityTokenBudget", () => {
  it("returns full setting tokens when setting is at or under 3000 tokens", () => {
    const text = "이름: 히어로\n성별: 남";
    assert.equal(resolveCoreIdentityTokenBudget(text), estimateSettingTokens(text));
  });

  it("returns 2000~3000 target only when setting exceeds 3000 tokens", () => {
    const under = "x".repeat(3000);
    assert.equal(resolveCoreIdentityTokenBudget(under), estimateSettingTokens(under));

    const over = "x".repeat(5000);
    const budget = resolveCoreIdentityTokenBudget(over);
    assert.ok(budget >= CORE_IDENTITY_MIN_TOKENS);
    assert.ok(budget <= CORE_IDENTITY_MAX_TOKENS);
    assert.ok(budget < estimateSettingTokens(over));
  });
});

describe("buildCoreIdentityBlock", () => {
  it("includes entire setting when under 3000 tokens", () => {
    const text = "이름: 히어로\n성별: 남\n[외형] 금발";
    const block = buildCoreIdentityBlock(text);
    assert.match(block, /^\[CORE IDENTITY\]/);
    assert.ok(block.includes("히어로"));
    assert.ok(block.includes("금발"));
  });

  it("drops infrequent plot/system sections to RAG when over 3000 tokens", () => {
    const identity = "이름: 레온\n성별: 남";
    const appearance = "[외형]\n192cm, 찬란한 금발, 푸른 눈";
    const speech = "[말투]\n해요체";
    const plot = `[시스템 명령]\n${"{{user}}는 소설 속으로 빙의했다. D-Day 루프. ".repeat(180)}`;
    const full = `${identity}\n\n${appearance}\n\n${speech}\n\n${plot}`;
    assert.ok(estimateSettingTokens(full) > CORE_IDENTITY_MAX_TOKENS);

    const block = buildCoreIdentityBlock(full);
    assert.ok(block.includes("금발"));
    assert.ok(block.includes("말투") || block.includes("해요"));
    assert.ok(!block.includes("D-Day"));

    const ragSections = selectRagSectionsFromSetting(full);
    assert.ok(ragSections.some((s) => s.includes("빙의") || s.includes("D-Day")));
  });
});

describe("filterCharacterChunksForRag", () => {
  it("excludes CRITICAL chunks from RAG pool", () => {
    const chunks: CharacterChunk[] = [
      {
        id: "a",
        characterId: "1",
        content: "identity",
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 1,
        keywords: [],
      },
      {
        id: "b",
        characterId: "1",
        content: "world lore",
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 1,
        keywords: [],
      },
    ];
    const filtered = filterCharacterChunksForRag(chunks);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "b");
  });

  it("includes high rag-score contextual chunks", () => {
    const chunks: CharacterChunk[] = [
      {
        id: "sys",
        characterId: "1",
        content: "[시스템 명령] D-Day 루프 배드엔딩",
        category: "other",
        importance: "CONTEXTUAL",
        tokenCount: 1,
        keywords: [],
      },
    ];
    const filtered = filterCharacterChunksForRag(chunks);
    assert.equal(filtered.length, 1);
  });
});
