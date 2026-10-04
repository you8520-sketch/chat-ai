import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { compileOfficialDraftFromBible } from "@/lib/officialSupply/bible";
import { buildOfficialCharacterFormBody } from "@/lib/officialSupply/characterText";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import {
  HWANG_VOCAB,
  testAppearance,
  testAssetPlan,
  testDraft,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
import {
  composeOfficialCreatorComment,
  composeOfficialPublicDescription,
  evaluateOfficialCreatorComment,
  evaluateOfficialPlayerGenderNeutral,
  evaluateOfficialPublicDescription,
  officialPlayStartChoices,
  OFFICIAL_PUBLIC_INTRO_SECTIONS,
  publicAppearanceFacts,
} from "@/lib/officialSupply/publicProfileText";
import {
  evaluateOfficialShotPlan,
  officialShotComboKey,
  officialShotSeed,
  OFFICIAL_SLOT_SHOT_PLAN,
  resolveOfficialSlotShot,
} from "@/lib/officialSupply/shotPlan";
import type { OfficialCharacterBible } from "@/lib/officialSupply/bible";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

type PilotChar = {
  draftKey: string;
  slot: number;
  brief: OfficialCharacterDraft["hook"] & { audience: OfficialCharacterDraft["audience"]; name: string };
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function sampleChars(): PilotChar[] {
  return ["01", "03", "05"].map((slot) =>
    readJson<PilotChar>(path.join(PILOT_DIR, "characters", `pilot-rf-${slot}.json`))
  );
}

function compileKeys(file: PilotChar) {
  const world = readJson<{ bible: { name: string } }>(path.join(PILOT_DIR, "world-bible.json"));
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(PILOT_DIR, "manifest.json"));
  return {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"] as OfficialCharacterDraft["genres"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  };
}

describe("official slot shot responsibilities", () => {
  it("assigns a distinct face+distance+expression combo to each canonical slot", () => {
    const combos = Object.values(OFFICIAL_SLOT_SHOT_PLAN).map(officialShotComboKey);
    assert.equal(new Set(combos).size, combos.length);
    const qa = evaluateOfficialShotPlan(testAssetPlan().slots);
    assert.deepEqual(qa.errors, []);
  });

  it("keeps representative as the only required bust card and never consecutive busts", () => {
    const shots = testAssetPlan().slots.map((slot) => resolveOfficialSlotShot(slot, "pilot-rf-01"));
    const busts = shots.filter((shot) => shot.distance === "bust");
    assert.equal(busts.length, 1);
    assert.equal(busts[0]?.slotKey, "rep");
    assert.ok(shots.filter((shot) => shot.kind === "scene").every((shot) => shot.background === "scene"));
  });

  it("rotates non-rep families by draftKey so two characters do not share the same storyboard", () => {
    const slots = testAssetPlan().slots;
    const a = slots.map((slot) => officialShotComboKey(resolveOfficialSlotShot(slot, "pilot-rf-01")));
    const b = slots.map((slot) => officialShotComboKey(resolveOfficialSlotShot(slot, "pilot-rf-03")));
    assert.notDeepEqual(a, b);
    assert.equal(officialShotSeed("pilot-rf-01"), officialShotSeed("pilot-rf-01"));
    const sig1a = resolveOfficialSlotShot({ slotKey: "sig1", kind: "signature" }, "pilot-rf-01");
    const sig1b = resolveOfficialSlotShot({ slotKey: "sig1", kind: "signature" }, "pilot-rf-03");
    assert.notEqual(officialShotComboKey(sig1a), officialShotComboKey(sig1b));
    assert.equal(evaluateOfficialShotPlan(slots, "pilot-rf-01").errors.length, 0);
    assert.equal(evaluateOfficialShotPlan(slots, "pilot-rf-03").errors.length, 0);
  });

  it("builds prompts with different shot responsibilities; scene is not a portrait", () => {
    const draft = testDraft({ draftKey: "hwang", name: "레온하르트", vocabulary: HWANG_VOCAB });
    const appearance = testAppearance();
    const style = testStyleCandidate("c1").dna;
    const prompts = testAssetPlan().slots.map((slot) => ({
      slotKey: slot.slotKey,
      kind: slot.kind,
      text: buildOfficialAssetPrompts({ draft, appearance, style, slot }).primaryPrompt,
    }));
    const shotLines = prompts.map((row) => {
      const match = row.text.match(/SHOT RESPONSIBILITY \([^)]+\):[^]+?IDENTITY LOCK/);
      return match?.[0] ?? row.text;
    });
    assert.equal(new Set(shotLines).size, shotLines.length);
    for (const row of prompts) {
      if (row.kind === "representative") {
        assert.match(row.text, /character card portrait/);
        continue;
      }
      assert.match(row.text, /SHOT RESPONSIBILITY/);
      assert.match(row.text, /ART STYLE describes rendering language, color, and illustration grammar only/);
      assert.doesNotMatch(row.text, /face and upper body readable/);
      if (row.kind === "scene") {
        assert.match(row.text, /SCENE illustration/);
        assert.match(row.text, /not a portrait substitute/);
        assert.doesNotMatch(row.text, /supporting background only/);
      }
    }
  });
});

describe("official detailed intro + creator comment", () => {
  it("compiled public intro has world/character/play/entry facts and no HTML", () => {
    for (const file of sampleChars()) {
      const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
      const qa = evaluateOfficialPublicDescription(draft.description, draft.name);
      assert.deepEqual(qa.errors, [], `${file.draftKey}: ${JSON.stringify(qa.errors)}`);
      assert.match(draft.description, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.world}`));
      assert.match(draft.description, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.character}\\]`));
      assert.match(draft.description, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.intro}\\]`));
      assert.match(draft.description, new RegExp(`${file.bible.identity.age}세`));
      assert.match(draft.description, new RegExp(`${file.bible.identity.heightCm}cm`));
      assert.doesNotMatch(draft.description, /<\/?[a-z][\s\S]*>/i);
      assert.notEqual(draft.description, file.bible.publicProfile.description);
      const facts = publicAppearanceFacts(file.bible.appearance);
      assert.ok(facts.length >= 3 && facts.length <= 5, `${file.draftKey} look facts ${facts.length}`);
      assert.ok(facts.every((fact) => /^(머리|눈|피부|체형|특징|복식|소품|인상): /.test(fact)));
      assert.doesNotMatch(draft.description, /[가-힣](?:보다|하며|하고)\s*\//);
      assert.match(draft.description, new RegExp(facts[0]!.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const lucian = sampleChars().find((file) => file.draftKey === "pilot-rf-03")!;
    const lucianDraft = compileOfficialDraftFromBible(lucian.bible, compileKeys(lucian));
    assert.match(lucianDraft.description, /머리:.*갈색/);
    assert.match(lucianDraft.description, /눈:.*호박/);
    assert.match(lucianDraft.description, /피부:.*구리빛/);
    assert.match(lucianDraft.description, /특징:.*모노클/);
    assert.doesNotMatch(lucianDraft.description, /표정보다\s*\//);
    assert.match(lucianDraft.description, /에테르 잔향 감응 — [^\n]*읽는다/);
  });

  it("creator comment is a play guide and not a copy of the detailed intro", () => {
    const starts = new Set<string>();
    for (const file of sampleChars()) {
      const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
      const comment = composeOfficialCreatorComment(draft);
      const qa = evaluateOfficialCreatorComment(comment, draft.description);
      assert.deepEqual(qa.errors, [], `${file.draftKey}: ${JSON.stringify(qa.errors)}`);
      assert.match(comment, /지금 상황/);
      assert.match(comment, /추천 플레이 방향/);
      assert.match(comment, /이런 식으로 시작해 보세요/);
      assert.match(comment, /가능한 관계/);
      assert.match(comment, /하나의 도입 상황에서 시작/);
      assert.doesNotMatch(comment, /\[캐릭터 설정\]/);
      assert.doesNotMatch(comment, /(신뢰|호감|경계).{0,8}(낮음|높음|미정)/);
      assert.doesNotMatch(comment, /첫 장면에서는 목적 한 가지만|반응을 보세요|따라 누구와/);
      assert.doesNotMatch(comment, /고르세요|중에서 먼저|첫 수를 정해|선택지|에피소드/);
      const choices = officialPlayStartChoices(draft);
      assert.ok(choices.length >= 2 && choices.length <= 3, `${file.draftKey} choices ${JSON.stringify(choices)}`);
      assert.ok(
        choices.every((choice) => /(?:하기|할지|둘지|받을지|지킬지|풀지|좇을지|따를지|움직이기)$/.test(choice)),
        `${file.draftKey} non-action ${JSON.stringify(choices)}`
      );
      assert.ok(!choices.some((choice) => file.brief.rpHook.includes(choice) && choice.length > 20));
      starts.add(comment.match(/추천 플레이 방향<\/b><br>([^<]+)/)?.[1] ?? "");
      assert.ok(!draft.description.includes(comment.replace(/<[^>]+>/g, "").trim()));
    }
    const lucian = sampleChars().find((file) => file.draftKey === "pilot-rf-03")!;
    assert.deepEqual(
      officialPlayStartChoices(compileOfficialDraftFromBible(lucian.bible, compileKeys(lucian))),
      ["도주에 협력할지", "거리를 둘지"]
    );
    assert.equal(starts.size, 3);
  });

  it("compiled greeting, public intro, and creator comment stay player-gender neutral", () => {
    const files = fs
      .readdirSync(path.join(PILOT_DIR, "characters"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<PilotChar>(path.join(PILOT_DIR, "characters", name)));
    for (const file of files) {
      const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
      const comment = composeOfficialCreatorComment(draft);
      const qa = evaluateOfficialPlayerGenderNeutral({
        greeting: draft.greeting,
        description: draft.description,
        comment,
      });
      assert.deepEqual(qa.errors, [], `${file.draftKey}: ${JSON.stringify(qa.errors)}`);
      assert.match(draft.greeting, /당신/);
    }
    assert.ok(
      evaluateOfficialPlayerGenderNeutral({
        greeting: "문가에 선 왕자비를 향해 손을 내밀었다.",
      }).errors.some((issue) => issue.code === "official_player_gender_locked")
    );
    assert.ok(
      evaluateOfficialPlayerGenderNeutral({
        description: "당신은 그 남자 플레이어로 시작한다.",
      }).errors.some((issue) => issue.code === "official_player_gender_locked")
    );
    const prompt = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/authorPrompts.ts"), "utf8");
    assert.match(prompt, /오프닝은 하나다/);
    assert.match(prompt, /아가씨\/도련님\/왕자비\/신부/);
    assert.doesNotMatch(prompt, /에피소드를 만들|N개의 에피소드|episode picker/);
  });

  it("form body keeps the compiled intro and adds creator_comment without changing publish owner", () => {
    const file = sampleChars()[0]!;
    const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
    const body = buildOfficialCharacterFormBody({
      draft,
      appearanceBlock: "외형",
      assets: [{ url: "/uploads/rep.webp", tag: "대표", width: 1024, height: 1536, viewerBlur: false }],
    });
    assert.equal(body.description, draft.description);
    assert.equal(typeof body.creator_comment, "string");
    assert.match(String(body.creator_comment), /<p><b>지금 상황<\/b>/);
    const publishSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/publish.ts"), "utf8");
    const stagingSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/staging.ts"), "utf8");
    assert.match(publishSource, /function publishOfficialSupplyCharacter/);
    assert.match(stagingSource, /buildOfficialCharacterFormBody/);
    assert.doesNotMatch(publishSource, /composeOfficialPublicDescription|composeOfficialCreatorComment/);
    const startChat = fs.readFileSync(path.join(process.cwd(), "src/components/StartChatButton.tsx"), "utf8");
    assert.doesNotMatch(
      `${publishSource}\n${stagingSource}\n${startChat}`,
      /introVariant|selectedIntro|scenarioSnapshot|intro_id/
    );
  });

  it("public intro evaluator rejects a one-paragraph pitch", () => {
    const pitch = composeOfficialPublicDescription;
    assert.ok(evaluateOfficialPublicDescription("황자가 온실에서 당신을 기다린다. 거래가 시작된다.").errors.length > 0);
    assert.equal(typeof pitch, "function");
  });
});

describe("official shot QA path stays non-persistent", () => {
  it("QA script uses prompt/image owners and never writes production rows", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/official-supply-quality-shot-qa.ts"), "utf8");
    const lib = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/qualityShotQa.ts"), "utf8");
    assert.match(source, /buildOfficialAssetPrompts/);
    assert.match(source, /callOpenAiImageEditWithSafetyFallback/);
    assert.match(source, /prepareLucianSig4Trial/);
    assert.match(source, /buildClusterBRofanStyleSeed/);
    assert.match(source, /resolveLucianSig4TrialStyle/);
    assert.match(source, /resolveLucianSig4ProofImageModel/);
    assert.match(lib, /OFFICIAL_QUALITY_SHOT_QA_ARTIFACT_DIR/);
    assert.match(lib, /OFFICIAL_QUALITY_SHOT_QA_REFERENCE_PATH/);
    assert.match(source, /OFFICIAL_QUALITY_SHOT_QA_CONTACT_SHEET_PATH/);
    assert.match(lib, /\/opt\/cursor\/artifacts\/official-shot-qa/);
    assert.match(lib, /lucian-sig4/);
    assert.match(lib, /ROFAN_CLUSTER_B_VISUAL_STYLE_DNA/);
    assert.match(lib, /isLucianSig4ProofSupportedImageModel/);
    assert.match(lib, /planningCeilingIsProviderHardCap/);
    assert.doesNotMatch(source, /runOfficialAssetSlot|OfficialSupplyStore|publishOfficialSupplyCharacter|stageOfficialCharacterPrivately|storeUpload/);
    assert.doesNotMatch(lib, /runOfficialAssetSlot|OfficialSupplyStore|publishOfficialSupplyCharacter|stageOfficialCharacterPrivately|storeUpload/);
    assert.doesNotMatch(source, /resolveOfficialStyleGenerationReferences/);
  });
});
