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
  stripTrpgAssetControlMarkers,
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

describe("TRPG malformed asset-marker data preservation", () => {
  const gmOpts = {
    aiParticipantIds: new Set([12]),
    characterTagsByParticipant: new Map([[12, new Set(["분노"])]]),
    scenarioTags: new Set(["대합실", "폐역"]),
  };

  it("A bot malformed scenario marker before ACTION_TYPE/INTENT preserves mechanics", () => {
    const raw = "행동 본문\n[태그: 폐역\n<<<ACTION_TYPE>>>\ninvestigate\n<<<INTENT>>>\n문을 조사한다";
    const body = prepareTrpgBotActionBody(raw, "fallback");
    assert.doesNotMatch(body, /\[태그:/);
    assert.match(body, /행동 본문/);
    assert.match(body, /<<<ACTION_TYPE>>>/);
    assert.match(body, /investigate/);
    assert.match(body, /<<<INTENT>>>/);
    assert.match(body, /문을 조사한다/);
  });

  it("B bot malformed character marker before ACTION_TYPE/INTENT preserves mechanics", () => {
    const raw = "행동 본문\n[캐릭터에셋: 12|분노\n<<<ACTION_TYPE>>>\ninvestigate\n<<<INTENT>>>\n문을 조사한다";
    const body = prepareTrpgBotActionBody(raw, "fallback");
    assert.doesNotMatch(body, /캐릭터에셋/);
    assert.match(body, /행동 본문/);
    assert.match(body, /<<<ACTION_TYPE>>>/);
    assert.match(body, /investigate/);
    assert.match(body, /<<<INTENT>>>/);
    assert.match(body, /문을 조사한다/);
  });

  it("C human action display preserves later prose after malformed scenario marker", () => {
    const stored = "line1\n[태그: broken\nline2";
    const display = sanitizeTrpgActionDisplayText(stored);
    assert.doesNotMatch(display, /\[태그:/);
    assert.match(display, /line1/);
    assert.match(display, /line2/);
    assert.equal(stored, "line1\n[태그: broken\nline2");
  });

  it("D historical action display preserves later prose after malformed character marker", () => {
    const historical = "line1\n[캐릭터에셋: broken\nline2";
    const display = sanitizeTrpgActionDisplayText(historical);
    assert.doesNotMatch(display, /캐릭터에셋/);
    assert.match(display, /line1/);
    assert.match(display, /line2/);
  });

  it("E GM narration preserves later prose after malformed scenario marker", () => {
    const out = enforceGmSceneAssetMarkers("before\n[태그: broken\nafter", gmOpts);
    assert.doesNotMatch(out.text, /\[태그: broken/);
    assert.match(out.text, /before/);
    assert.match(out.text, /after/);
  });

  it("F GM malformed character marker plus valid scenario marker preserves later prose", () => {
    const out = enforceGmSceneAssetMarkers(
      "앞 문장.\n[캐릭터에셋: 12|분노\n중간 문장.\n[태그: 폐역]\n마지막 문장.",
      gmOpts
    );
    assert.doesNotMatch(out.text, /\[캐릭터에셋: 12\|분노/);
    assert.match(out.text, /중간 문장/);
    assert.match(out.text, /\[태그: 폐역\]/);
    assert.match(out.text, /마지막 문장/);
    assert.equal(out.kept.some((item) => item.kind === "scenario" && item.tag === "폐역"), true);
  });

  it("G ordinary bracketed prose remains visible", () => {
    const display = sanitizeTrpgActionDisplayText("나는 문을 연다.\n[태그: 폐역\n그리고 안으로 들어간다.\n[내부메모: 유지]");
    assert.match(display, /나는 문을 연다/);
    assert.match(display, /그리고 안으로 들어간다/);
    assert.match(display, /\[내부메모: 유지\]/);
    assert.doesNotMatch(display, /\[태그:/);
  });

  it("H line-safe stripper never crosses newline to EOF", () => {
    const stripped = stripTrpgAssetControlMarkers("앞\n[태그: broken\n뒤");
    assert.match(stripped, /앞/);
    assert.match(stripped, /뒤/);
    assert.doesNotMatch(stripped, /\[태그:/);
  });

  it("I malformed scenario marker newline before ordinary bracket prose is line-local", () => {
    const input = "before\n[태그:\n[내부메모: 유지]\nafter";
    const display = sanitizeTrpgActionDisplayText(input);
    assert.doesNotMatch(display, /\[태그:/);
    assert.match(display, /\[내부메모: 유지\]/);
    assert.match(display, /before/);
    assert.match(display, /after/);
    const gm = enforceGmSceneAssetMarkers(input, gmOpts);
    assert.doesNotMatch(gm.text, /\[태그:/);
    assert.match(gm.text, /\[내부메모: 유지\]/);
    assert.match(gm.text, /after/);
  });

  it("J malformed character marker newline before ordinary bracket prose is line-local", () => {
    const input = "before\n[캐릭터에셋:\n[내부메모: 유지]\nafter";
    const display = sanitizeTrpgActionDisplayText(input);
    assert.doesNotMatch(display, /캐릭터에셋/);
    assert.match(display, /\[내부메모: 유지\]/);
    assert.match(display, /after/);
    const gm = enforceGmSceneAssetMarkers(input, gmOpts);
    assert.doesNotMatch(gm.text, /캐릭터에셋/);
    assert.match(gm.text, /\[내부메모: 유지\]/);
    assert.match(gm.text, /after/);
  });

  it("K same-line valid plus malformed scenario marker keeps valid and text", () => {
    const input = "[태그: 대합실] text [태그: broken";
    const gm = enforceGmSceneAssetMarkers(input, gmOpts);
    assert.match(gm.text, /\[태그: 대합실\]/);
    assert.match(gm.text, /text/);
    assert.doesNotMatch(gm.text, /broken/);
    assert.doesNotMatch(gm.text, /\[태그: broken/);
    assert.equal(gm.kept.some((item) => item.kind === "scenario" && item.tag === "대합실"), true);
  });

  it("L same-line valid plus malformed character marker keeps valid and text", () => {
    const input = "[캐릭터에셋: 12|분노] text [캐릭터에셋: broken";
    const gm = enforceGmSceneAssetMarkers(input, gmOpts);
    assert.match(gm.text, /\[캐릭터에셋: 12\|분노\]/);
    assert.match(gm.text, /text/);
    assert.doesNotMatch(gm.text, /broken/);
    assert.equal(gm.kept.some((item) => item.kind === "character" && item.tag === "분노"), true);
  });

  it("M splitTrpgGmProseForAssets does not parse asset markers across newline", () => {
    const parts = splitTrpgGmProseForAssets("before\n[태그:\n[내부메모: 유지]\nafter", {
      scenarioAssets: [hall],
      characterCatalog: catalog,
      campaignId: 9,
      roundNumber: 3,
    });
    assert.equal(parts.some((part) => part.kind === "scenario" || part.kind === "character"), false);
    const text = parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
    assert.match(text, /\[내부메모: 유지\]/);
    assert.match(text, /after/);
    assert.doesNotMatch(text, /\[태그:/);
  });

  it("N server enforce and client split agree on valid and malformed markers", () => {
    const cases = [
      "before\n[태그:\n[내부메모: 유지]\nafter",
      "[태그: 대합실] text [태그: broken",
      "[캐릭터에셋: 12|분노] text [캐릭터에셋: broken",
      "앞.\n[캐릭터에셋: 12|분노]\n[태그: 대합실]\n뒤.",
    ];
    for (const input of cases) {
      const enforced = enforceGmSceneAssetMarkers(input, gmOpts);
      const parts = splitTrpgGmProseForAssets(enforced.text, {
        scenarioAssets: [hall],
        characterCatalog: catalog,
        campaignId: 9,
        roundNumber: 3,
      });
      const scenarioTags = parts
        .filter((part) => part.kind === "scenario")
        .map((part) => (part.kind === "scenario" ? part.tag : ""));
      const characterTags = parts
        .filter((part) => part.kind === "character")
        .map((part) => (part.kind === "character" ? `${part.participantId}|${part.tag}` : ""));
      assert.deepEqual(
        scenarioTags,
        enforced.kept.filter((item) => item.kind === "scenario").map((item) => item.tag)
      );
      assert.deepEqual(
        characterTags,
        enforced.kept
          .filter((item) => item.kind === "character")
          .map((item) => `${item.participantId}|${item.tag}`)
      );
      const visible = parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
      assert.doesNotMatch(visible, /\[태그: broken/);
      assert.doesNotMatch(visible, /캐릭터에셋: broken/);
    }
  });
});
