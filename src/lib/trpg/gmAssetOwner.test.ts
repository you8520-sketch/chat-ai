import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { withAssetSize } from "@/lib/characterAssets";
import { prepareTrpgBotActionBody } from "./botActions";
import {
  CHARACTER_TAG_PAIR_MAX,
  MAX_IMAGES_PER_GM_SCENE,
  MAX_SCENARIO_IMAGES_WITH_AI,
  MAX_SCENARIO_IMAGES_WITHOUT_AI,
  enforceGmSceneAssetMarkers,
  sanitizeTrpgActionDisplayText,
} from "./gmSceneAssets";
import { splitTrpgGmProseForAssets } from "./trpgTaggedProse";

const hall = withAssetSize({ url: "/hall.webp", tag: "대합실", chat: true }, 1600, 900);
const anger = withAssetSize({ url: "/anger.webp", tag: "분노", chat: true }, 800, 1200);
const catalog = [{ participantId: 12, characterId: 15, name: "권태현", assets: [anger] }];

function actionCardParts(raw: string) {
  const display = sanitizeTrpgActionDisplayText(raw);
  return {
    display,
    parts: splitTrpgGmProseForAssets(display, {
      scenarioAssets: [hall],
      characterCatalog: catalog,
      campaignId: 9,
      roundNumber: 3,
    }),
  };
}

describe("TRPG GM-only scene asset ownership", () => {
  it("AI_ACTION_SCENARIO_MARKER_PERSISTED=false", () => {
    const body = prepareTrpgBotActionBody(
      "대합실 문을 민다.\n[태그: 대합실]\n\n<<<INTENT>>>\n태현은 대합실 문을 밀려 했다.",
      "fallback"
    );
    assert.doesNotMatch(body, /\[태그:/);
    assert.match(body, /대합실 문을 민다/);
    assert.match(body, /INTENT/);
  });

  it("AI_ACTION_CHARACTER_MARKER_PERSISTED=false", () => {
    const body = prepareTrpgBotActionBody(
      "태현이 이를 악문다.\n[캐릭터에셋: 12|분노]\n[캐릭터에셋: 화남]",
      "fallback"
    );
    assert.doesNotMatch(body, /캐릭터에셋/);
    assert.match(body, /이를 악문다/);
  });

  it("AI_ACTION_SCENARIO_IMAGE_RENDERED=false and hides raw markers", () => {
    const { display, parts } = actionCardParts("대합실이 흔들린다.\n[태그: 대합실]");
    assert.equal(parts.some((part) => part.kind !== "text"), false);
    assert.doesNotMatch(display, /\[태그:/);
    assert.match(display, /대합실이 흔들린다/);
  });

  it("AI_ACTION_CHARACTER_IMAGE_RENDERED=false", () => {
    const { display, parts } = actionCardParts("분노가 인다.\n[캐릭터에셋: 12|분노]");
    assert.equal(parts.some((part) => part.kind === "character" || part.kind === "scenario"), false);
    assert.doesNotMatch(display, /캐릭터에셋/);
  });

  it("HUMAN_ACTION_SCENARIO_MARKER_RENDERED=false and HUMAN_ACTION_RAW_ASSET_MARKER_VISIBLE=false", () => {
    const stored = "나는 대합실을 가리킨다.\n[태그: 대합실]\n[내부메모: 유지]";
    const { display, parts } = actionCardParts(stored);
    assert.equal(parts.some((part) => part.kind !== "text"), false);
    assert.doesNotMatch(display, /\[태그:/);
    assert.doesNotMatch(display, /캐릭터에셋/);
    assert.match(display, /\[내부메모: 유지\]/);
    assert.equal(stored.includes("[태그: 대합실]"), true);
  });

  it("HISTORICAL_ACTION_ASSET_IMAGE_RENDERED=false and HISTORICAL_ACTION_RAW_MARKER_VISIBLE=false", () => {
    const historical = "예전 라운드 행동.\n[태그: 대합실]\n[캐릭터에셋: 12|분노]\n[태그:";
    const { display, parts } = actionCardParts(historical);
    assert.equal(parts.some((part) => part.kind !== "text"), false);
    assert.doesNotMatch(display, /\[태그:/);
    assert.doesNotMatch(display, /캐릭터에셋/);
    assert.match(display, /예전 라운드 행동/);
  });

  it("GM_SCENARIO_MARKER_STILL_RENDERED=true and GM_CHARACTER_MARKER_STILL_RENDERED=true", () => {
    const parts = splitTrpgGmProseForAssets(
      "태현이 이를 악문다.\n[캐릭터에셋: 12|분노]\n대합실이 흔들린다.\n[태그: 대합실]",
      {
        scenarioAssets: [hall],
        characterCatalog: catalog,
        campaignId: 9,
        roundNumber: 3,
      }
    );
    assert.equal(parts.some((part) => part.kind === "character" && part.asset.url === "/anger.webp"), true);
    assert.equal(parts.some((part) => part.kind === "scenario" && part.asset.url === "/hall.webp"), true);
  });

  it("GM_ASSET_BUDGET_UNCHANGED=true", () => {
    assert.equal(MAX_IMAGES_PER_GM_SCENE, 2);
    assert.equal(MAX_SCENARIO_IMAGES_WITH_AI, 1);
    assert.equal(MAX_SCENARIO_IMAGES_WITHOUT_AI, 2);
    assert.equal(CHARACTER_TAG_PAIR_MAX, 1);
    const out = enforceGmSceneAssetMarkers("[태그: 대합실]\n[태그: 폐역]\n[캐릭터에셋: 12|분노]", {
      aiParticipantIds: new Set([12]),
      characterTagsByParticipant: new Map([[12, new Set(["분노"])]]),
      scenarioTags: new Set(["대합실", "폐역"]),
    });
    assert.deepEqual(
      out.kept.map((item) => item.kind),
      ["scenario", "character"]
    );
  });

  it("action cards never receive scene assets or resolve markers", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const named = readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");
    assert.match(room, /resolveSceneAssets=\{false\}/);
    assert.match(room, /sanitizeTrpgActionDisplayText\(parsed\.prose \|\| action\.body\)/);
    assert.match(named, /resolveSceneAssets \? shown : sanitizeTrpgActionDisplayText\(shown\)/);
    const actionSlice = room.slice(room.indexOf("text={sanitizeTrpgActionDisplayText"), room.indexOf("onRevealChange="));
    assert.doesNotMatch(actionSlice, /assets=\{scenarioAssets\}/);
    assert.doesNotMatch(actionSlice, /characterCatalog=/);
    assert.match(room, /<TrpgGmTalk[\s\S]*assets=\{scenarioAssets\}[\s\S]*characterCatalog=\{characterCatalog\}/);
  });
});
