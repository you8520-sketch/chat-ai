import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildMatureMaleVisualAgePrompt,
  evaluateAppearanceLock,
  isMatureMaleRofanRomanceTarget,
  MATURE_MALE_VISUAL_AGE_RULE,
} from "@/lib/officialSupply/appearance";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import { DOMESTIC_ROFAN_STYLE_DIRECTION } from "@/lib/officialSupply/style";
import { testAppearance, testDraft, HWANG_VOCAB } from "@/lib/officialSupply/officialSupply.fixtures";
import type {
  OfficialAssetPlan,
  OfficialAppearanceLock,
  OfficialCharacterDraft,
  VisualStyleCandidate,
} from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

function matureDraft(overrides: Partial<OfficialCharacterDraft> = {}): OfficialCharacterDraft {
  return {
    ...testDraft({
      draftKey: "mature",
      name: "볼프강",
      vocabulary: HWANG_VOCAB,
      age: 34,
      gender: "male",
    }),
    ...overrides,
  };
}

describe("domestic rofan style owner", () => {
  it("keeps product direction abstract and domestic women-oriented", () => {
    assert.match(DOMESTIC_ROFAN_STYLE_DIRECTION, /국내 여성향/);
    assert.match(DOMESTIC_ROFAN_STYLE_DIRECTION, /얼굴 매력|미형/);
    assert.match(DOMESTIC_ROFAN_STYLE_DIRECTION, /체격|자세/);
    assert.doesNotMatch(DOMESTIC_ROFAN_STYLE_DIRECTION, /in the style of|작가\s*풍|artist:/i);
  });

  it("the committed rf-02 DNA prioritizes face readability and polished digital rendering", () => {
    const style = JSON.parse(
      fs.readFileSync(path.join(PILOT_DIR, "style-candidates.json"), "utf8")
    ) as { candidates: VisualStyleCandidate[] };
    const rf02 = style.candidates.find((candidate) => candidate.candidateId === "rf-02");
    assert.ok(rf02);
    const dna = Object.values(rf02.dna).join(" ");
    assert.match(dna, /여성향/);
    assert.match(dna, /얼굴|미형/);
    assert.match(dna, /polished digital rendering/);
    assert.match(dna, /체격|어깨|자세/);
  });
});

describe("mature male visual-age owner", () => {
  it("applies only to 30s male domestic rofan romance targets", () => {
    const base = matureDraft();
    assert.equal(isMatureMaleRofanRomanceTarget(base), true);
    assert.equal(isMatureMaleRofanRomanceTarget({ ...base, age: 28 }), false);
    assert.equal(isMatureMaleRofanRomanceTarget({ ...base, gender: "female" }), false);
    assert.equal(isMatureMaleRofanRomanceTarget({ ...base, audience: "male" }), false);
    assert.equal(
      isMatureMaleRofanRomanceTarget({ ...base, genres: ["판타지"] }),
      false
    );
  });

  it("rejects older-than-canon facial treatment but not fantasy silver hair by itself", () => {
    const draft = matureDraft();
    const good = testAppearance({
      apparentAgeBand: "30s",
      hairColor: "은회색",
      faceShape: "매끈한 광대선과 또렷한 턱선의 성숙한 미형 얼굴",
      skinTone: "깨끗한 창백 피부",
    });
    assert.equal(evaluateAppearanceLock(draft, good).ok, true);

    const oldBand = testAppearance({ apparentAgeBand: "40s" });
    assert.ok(
      evaluateAppearanceLock(draft, oldBand).errors.some(
        (issue) => issue.code === "appearance_mature_male_age_band"
      )
    );

    const aged = testAppearance({
      apparentAgeBand: "30s",
      faceShape: "깊은 주름과 꺼진 볼이 두드러지는 얼굴",
    });
    assert.ok(
      evaluateAppearanceLock(draft, aged).errors.some(
        (issue) => issue.code === "appearance_mature_male_aging_drift"
      )
    );
  });

  it("projects the canonical visual-age rule into both paid prompt paths", () => {
    const draft = matureDraft();
    const appearance = testAppearance({ apparentAgeBand: "30s" });
    const style = JSON.parse(
      fs.readFileSync(path.join(PILOT_DIR, "style-candidates.json"), "utf8")
    ) as { candidates: VisualStyleCandidate[] };
    const rf02 = style.candidates.find((candidate) => candidate.candidateId === "rf-02")!;
    const character = JSON.parse(
      fs.readFileSync(path.join(PILOT_DIR, "characters/pilot-rf-02.json"), "utf8")
    ) as { assetPlan: OfficialAssetPlan };
    const rep = character.assetPlan.slots.find((slot) => slot.slotKey === "rep")!;
    const prompts = buildOfficialAssetPrompts({
      draft,
      appearance,
      style: rf02.dna,
      slot: rep,
    });
    assert.ok(buildMatureMaleVisualAgePrompt(draft));
    assert.match(prompts.primaryPrompt, /MATURE MALE VISUAL AGE LOCK/);
    assert.match(prompts.strictFallbackPrompt, /MATURE MALE VISUAL AGE LOCK/);
    assert.ok(prompts.primaryPrompt.includes(MATURE_MALE_VISUAL_AGE_RULE));
  });
});

describe("committed Wolfgang correction", () => {
  it("removes the old aging stack while preserving age, role, and silhouette authority", () => {
    const file = JSON.parse(
      fs.readFileSync(path.join(PILOT_DIR, "characters/pilot-rf-02.json"), "utf8")
    ) as {
      bible: { identity: { age: number; occupation: string; apparentAge: string }; appearance: Record<string,string> };
      appearance: OfficialAppearanceLock;
      brief: { visualSilhouette: string };
    };

    assert.equal(file.bible.identity.age, 34);
    assert.match(file.bible.identity.occupation, /북부 방벽 수호사령관/);
    assert.match(file.brief.visualSilhouette, /188cm/);
    const visual = JSON.stringify({
      apparentAge: file.bible.identity.apparentAge,
      bibleAppearance: file.bible.appearance,
      lock: file.appearance,
    });
    assert.doesNotMatch(visual, /실제보다 몇 살 더 무겁게|잿빛이 섞인 은회색|넓은 광대|턱선을 가로지르는 굵은 흉터/);
    assert.match(visual, /흑회색/);
    assert.match(visual, /매끈한 광대선|미형/);
  });
});
