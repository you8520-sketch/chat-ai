import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import { validatePilotDraftForTextLock } from "@/lib/officialSupply/author";
import {
  buildCharacterBible1System,
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
  buildCharacterVoiceSystem,
  OFFICIAL_AUTHOR_MAX_TOKENS,
} from "@/lib/officialSupply/authorPrompts";
import { compileOfficialDraftFromBible, type OfficialCharacterBible, type OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  OFFICIAL_APPEARANCE_BLOCK_RESERVE,
  OFFICIAL_TEXT_THIN_FLOOR,
  evaluateOfficialTextLength,
  officialSubstantiveCharCount,
} from "@/lib/officialSupply/characterText";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const PART1_KEYS = [
  "identity",
  "appearance",
  "personality",
  "contradiction",
  "values",
  "backstory",
  "abilities",
  "habits",
  "dailyLife",
  "situation",
] as const;

type PilotChar = {
  draftKey: string;
  brief: { archetype: string; relationshipTrope: string; occupation: string; rpHook: string; audience: OfficialCharacterDraft["audience"] };
  bible: OfficialCharacterBible;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** The committed compact sheet, compiled the same way production compiles it. */
function compileCanonical(): { bible: OfficialCharacterBible; draft: OfficialCharacterDraft } {
  const file = readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-03.json"));
  const world = readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json"));
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(PILOT_DIR, "manifest.json"));
  const draft = compileOfficialDraftFromBible(file.bible, {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    worldBible: world.bible,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  });
  return { bible: file.bible, draft };
}

function codes(draft: OfficialCharacterDraft): string[] {
  return evaluateOfficialTextLength(draft).errors.map((e) => e.code);
}

describe("Part1 / Bonds false total caps removed", () => {
  it("neither prompt states a total character cap or a false rejection", () => {
    const part1 = buildCharacterBible1System();
    const bonds = buildCharacterBondsSystem();
    assert.equal(/5000자|2200자|초과하면 반려|전체 분량은 반드시/.test(part1), false);
    assert.equal(/5000자|2200자|초과하면 반려|전체 분량은 반드시/.test(bonds), false);
    assert.equal(/2800자|초과하면 반려|전체 분량은 반드시/.test(buildCharacterVoiceSystem()), false);
  });

  it("field bands, adult branching and technical token caps stay", () => {
    const part1 = buildCharacterBible1System();
    assert.match(part1, /personality\.behavioral 450~700자/);
    assert.match(part1, /dailyLife 120~250자/);
    assert.match(part1, /filler 금지·밀도 우선/);
    const bonds = buildCharacterBondsSystem();
    assert.match(bonds, /200자 이상 300자 이하/);
    assert.match(bonds, /consentModes는 standard·power_play·cnc_opt_in/);
    const adult = buildCharacterBondsUser({ name: "카엘", age: 30, rpHook: "순찰", adultCandidate: true, castList: [], part1Recap: "r" });
    const regular = buildCharacterBondsUser({ name: "카엘", age: 30, rpHook: "순찰", adultCandidate: false, castList: [], part1Recap: "r" });
    const adultSkeleton = JSON.parse(adult.split("\n").find((l) => l.startsWith('{"userRelationship"')) ?? "{}") as {
      nsfw?: boolean;
      adultSection?: Record<string, unknown> | null;
    };
    const regularSkeleton = JSON.parse(regular.split("\n").find((l) => l.startsWith('{"userRelationship"')) ?? "{}") as {
      nsfw?: boolean;
      adultSection?: unknown;
    };
    assert.equal(adultSkeleton.nsfw, true);
    assert.ok(adultSkeleton.adultSection && typeof adultSkeleton.adultSection === "object");
    assert.equal(regularSkeleton.nsfw, false);
    assert.equal(regularSkeleton.adultSection, null);
    assert.equal(OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_1, 10000);
    assert.equal(OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_voice, 8000);
    assert.equal(OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_bonds, 8000);
    assert.equal(AI_LEARNING_LIMIT, 10000);
    assert.equal(OFFICIAL_APPEARANCE_BLOCK_RESERVE, 600);
    assert.equal(OFFICIAL_TEXT_THIN_FLOOR, 3000);
  });

  it("stage JSON length and the compiled body are different contracts", () => {
    const { bible, draft } = compileCanonical();
    const stage = Object.fromEntries(PART1_KEYS.map((key) => [key, bible[key]]));
    const stageChars = JSON.stringify(stage).length;
    const compiledChars = officialSubstantiveCharCount(draft);
    assert.notEqual(stageChars, compiledChars);
    assert.ok(compiledChars >= OFFICIAL_TEXT_THIN_FLOOR);
    assert.ok(compiledChars + OFFICIAL_APPEARANCE_BLOCK_RESERVE <= AI_LEARNING_LIMIT);
    assert.equal(codes(draft).includes("text_exceeds_canonical_ceiling"), false);
    assert.equal(codes(draft).includes("text_too_thin"), false);
  });

  it("a compiled body over 9400 chars fails closed on the canonical ceiling, and under 3000 on the floor", () => {
    const { draft } = compileCanonical();
    const ceiling = AI_LEARNING_LIMIT - OFFICIAL_APPEARANCE_BLOCK_RESERVE;
    const over = structuredClone(draft);
    over.sections.worldAndSituation += "가".repeat(ceiling - officialSubstantiveCharCount(draft) + 1);
    const overChars = officialSubstantiveCharCount(over);
    assert.ok(overChars > ceiling, `${overChars} must exceed ${ceiling}`);
    assert.ok(codes(over).includes("text_exceeds_canonical_ceiling"));
    assert.equal(validatePilotDraftForTextLock(over, []).ok, false);

    const thin = structuredClone(draft);
    thin.sections.worldAndSituation = "세계";
    thin.sections.characterCore = "본체";
    thin.sections.currentSituation = "";
    thin.sections.relationshipsAndDrives = "관계";
    thin.sections.extraCanon = "";
    thin.secrets = [];
    thin.supportingNpcs = [];
    thin.speech = { personality: "말투", traits: "특징", examples: "", forbidden: "" };
    thin.adult = { nsfw: false };
    const thinChars = officialSubstantiveCharCount(thin);
    assert.ok(thinChars < OFFICIAL_TEXT_THIN_FLOOR, `${thinChars}`);
    assert.ok(codes(thin).includes("text_too_thin"));
    assert.equal(validatePilotDraftForTextLock(thin, []).ok, false);
  });
});
