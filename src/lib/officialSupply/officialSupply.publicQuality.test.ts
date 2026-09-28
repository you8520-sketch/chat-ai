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
  evaluateOfficialPublicDescription,
  OFFICIAL_PUBLIC_INTRO_SECTIONS,
} from "@/lib/officialSupply/publicProfileText";
import {
  evaluateOfficialShotPlan,
  officialShotComboKey,
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
    const shots = testAssetPlan().slots.map(resolveOfficialSlotShot);
    const busts = shots.filter((shot) => shot.distance === "bust");
    assert.equal(busts.length, 1);
    assert.equal(busts[0]?.slotKey, "rep");
    assert.ok(shots.filter((shot) => shot.kind === "scene").every((shot) => shot.background === "scene"));
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
      assert.match(row.text, /ART STYLE framing and backgroundDensity above describe the representative card language only/);
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
    }
  });

  it("creator comment is a play guide and not a copy of the detailed intro", () => {
    for (const file of sampleChars()) {
      const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
      const comment = composeOfficialCreatorComment(draft);
      const qa = evaluateOfficialCreatorComment(comment, draft.description);
      assert.deepEqual(qa.errors, [], `${file.draftKey}: ${JSON.stringify(qa.errors)}`);
      assert.match(comment, /지금 상황/);
      assert.match(comment, /이렇게 시작해 보세요/);
      assert.match(comment, /가능한 관계/);
      assert.doesNotMatch(comment, /\[캐릭터 설정\]/);
      assert.ok(!draft.description.includes(comment.replace(/<[^>]+>/g, "").trim()));
    }
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
  });

  it("public intro evaluator rejects a one-paragraph pitch", () => {
    const pitch = composeOfficialPublicDescription;
    assert.ok(evaluateOfficialPublicDescription("황자가 온실에서 당신을 기다린다. 거래가 시작된다.").errors.length > 0);
    assert.equal(typeof pitch, "function");
  });
});
