import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { isWideInlineAsset, withAssetSize } from "@/lib/characterAssets";
import { splitProseForInlineAssets } from "@/lib/inlineTaggedAssets";
import { buildCombinedCharacterSettingSource } from "@/utils/characterParser";
import { readCharacterRowFields } from "./aiCharacterContext";
import { buildTrpgBotActionUserBlock, prepareTrpgBotActionBody, TRPG_BOT_SYSTEM } from "./botActions";
import { applyScenarioAssetTagsToTurnText } from "./scenarioAssets";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "./gmPrompt";
import {
  buildAiCharacterImageTagCatalog,
  buildAiPartyIdentityBlock,
  uniqueCharacterAssetTags,
} from "./gmSceneAssets";

function botCtx(extra: Partial<Parameters<typeof buildTrpgBotActionUserBlock>[0]> = {}) {
  return buildTrpgBotActionUserBlock({
    characterName: "권태현",
    gender: "male",
    description: "과묵한 동료",
    greeting: "…따라와.",
    systemPrompt: "짧게 말한다.",
    exampleDialog: '"이쪽이다."',
    campaignWorld: "캠페인세계관CANARY 폐여관",
    previousGmNarration: "여관 문이 열린다.",
    campaignMemory: "[CAMPAIGN STATE]\nlocation=여관",
    humanActions: [{ playerName: "렌", text: "문을 민다." }],
    relationshipBrief: "렌과 태현은 전우",
    ...extra,
  });
}

describe("TRPG character context + GM asset integration", () => {
  it("A. loads existing characters.gender into the bot identity block", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, gender TEXT, assets TEXT)`);
    db.prepare(`INSERT INTO characters (id, name, gender, assets) VALUES (15, '권태현', 'male', '[]')`).run();
    const fields = readCharacterRowFields(db.prepare(`SELECT * FROM characters WHERE id=15`).get());
    assert.equal(fields.gender, "male");
    db.close();
    const block = botCtx();
    assert.match(block, /\[CHARACTER IDENTITY\]/);
    assert.match(block, /Name: 권태현/);
    assert.match(block, /Gender: 남성/);
    assert.match(TRPG_BOT_SYSTEM, /Character name and gender are character canon/);
    assert.equal((TRPG_BOT_SYSTEM.match(/절대 준수/g) ?? []).length, 0);
  });

  it("B. keeps campaign world and omits characters.world from the bot prompt", () => {
    const block = botCtx();
    assert.match(block, /\[CAMPAIGN WORLD/);
    assert.match(block, /캠페인세계관CANARY/);
    assert.doesNotMatch(block, /CHARACTER CARD WORLD \/ BACKGROUND/);
    assert.doesNotMatch(block, /카드세계관/);
  });

  it("C. preserves characters.world in normal character mode", () => {
    const src = buildCombinedCharacterSettingSource({
      characterId: "15",
      systemPrompt: "과묵하다.",
      world: "카드세계관CANARY",
      characterName: "권태현",
      gender: "male",
    });
    assert.match(src, /\[세계관\]/);
    assert.match(src, /카드세계관CANARY/);
  });

  it("D. still sends relationshipBrief on the bot path", () => {
    const block = botCtx();
    assert.match(block, /PARTY RELATIONSHIPS/);
    assert.match(block, /렌과 태현은 전우/);
  });

  it("E. omits scenario asset prompting from bot model input", () => {
    const block = botCtx();
    assert.doesNotMatch(block, /SCENARIO IMAGE TAGS/);
    assert.doesNotMatch(block, /\[태그:/);
    assert.doesNotMatch(block, /캐릭터에셋/);
  });

  it("F. does not insert scene-level assets into bot action prose", () => {
    const assets = [withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900)];
    const used = new Set<string>();
    const attached = applyScenarioAssetTagsToTurnText("대합실 안이 차갑다.", assets, used);
    assert.match(attached, /\[태그: 대합실\]/);
    const botBody = prepareTrpgBotActionBody("대합실 안이 차갑다.", "fallback");
    assert.equal(botBody.includes("[태그:"), false);
    const advance = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.match(advance, /prepareTrpgBotActionBody/);
    assert.doesNotMatch(advance, /applyScenarioAssetTagsToTurnText/);
  });

  it("G/H. GM catalog is tags only and never includes asset URLs", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, gender TEXT, assets TEXT)`);
    db.prepare(`INSERT INTO characters (id, name, gender, assets) VALUES (15, '권태현', 'male', ?)`).run(
      JSON.stringify([
        { url: "https://cdn.example/anger-a.webp", tag: "분노" },
        { url: "https://cdn.example/anger-b.webp", tag: "분노" },
        { url: "https://cdn.example/neutral.webp", tag: "무표정" },
        { url: "https://cdn.example/fight.webp", tag: "전투" },
      ])
    );
    const fields = readCharacterRowFields(db.prepare(`SELECT * FROM characters WHERE id=15`).get());
    db.close();
    assert.deepEqual(uniqueCharacterAssetTags(fields.assets), ["분노", "무표정", "전투"]);
    const catalog = buildAiCharacterImageTagCatalog([
      {
        participantId: 12,
        name: "권태현",
        tags: uniqueCharacterAssetTags(fields.assets),
      },
    ]);
    assert.match(catalog, /\[AI CHARACTER IMAGE TAGS\]/);
    assert.match(catalog, /participantId=12/);
    assert.match(catalog, /tags=분노 \| 무표정 \| 전투/);
    assert.doesNotMatch(catalog, /https?:\/\//);
    assert.doesNotMatch(catalog, /\.webp|\.png|\.jpg/);
    const identities = buildAiPartyIdentityBlock([
      { participantId: 12, name: "권태현", gender: "male" },
      { participantId: 13, name: "강이현", gender: "male" },
    ]);
    const gm = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      relationshipBrief: "렌과 태현은 전우",
      aiPartyIdentities: identities,
      characterAssetCatalog: catalog,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "문을 민다.",
          statKey: "str",
          d20: 10,
          finalScore: 12,
          dc: 12,
          tier: "SUCCESS",
        },
      ],
    });
    assert.match(gm, /AI PARTY IDENTITIES/);
    assert.match(gm, /participantId=12 \| 권태현 \| 남성/);
    assert.match(gm, /AI CHARACTER IMAGE TAGS/);
    assert.match(gm, /PARTY RELATIONSHIPS/);
    assert.doesNotMatch(gm, /\/uploads\/|https?:\/\//);
  });

  it("Y. allows supplied asset markers and still forbids unrelated internal markers", () => {
    assert.match(TRPG_GM_SYSTEM, /internal\/system markers except allowed asset markers/);
    assert.match(TRPG_GM_SYSTEM, /chain-of-thought/);
    assert.match(TRPG_BOT_SYSTEM, /current campaign world wins/);
  });

  it("V. keeps normal chat portrait\/landscape inline behavior unchanged", () => {
    const wide = withAssetSize({ url: "/wide.webp", tag: "폐역", chat: true }, 1600, 900);
    const tall = withAssetSize({ url: "/tall.webp", tag: "미소", chat: true }, 800, 1200);
    assert.equal(isWideInlineAsset(wide), true);
    assert.equal(isWideInlineAsset(tall), false);
    const parts = splitProseForInlineAssets("앞.\n[태그: 미소]\n[태그: 폐역]\n뒤", [wide, tall]);
    assert.equal(parts.some((part) => part.kind === "image" && part.asset.url === "/wide.webp"), true);
    assert.equal(parts.some((part) => part.kind === "image" && part.asset.url === "/tall.webp"), false);
  });
});
