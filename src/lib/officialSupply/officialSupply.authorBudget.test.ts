import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { AI_LEARNING_LIMIT, aiLearningLimitExceededMessage } from "@/lib/characterFormLimits";
import { parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import { validatePilotDraftForTextLock } from "@/lib/officialSupply/author";
import { renderAppearanceBlock } from "@/lib/officialSupply/appearance";
import {
  buildCharacterBible1System,
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
  buildCharacterVoiceSystem,
  OFFICIAL_AUTHOR_MAX_TOKENS,
} from "@/lib/officialSupply/authorPrompts";
import { compileOfficialDraftFromBible, type OfficialCharacterBible, type OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  buildOfficialCharacterFormBody,
  OFFICIAL_APPEARANCE_BLOCK_RESERVE,
  OFFICIAL_COMPILED_CHAR_CEILING,
  OFFICIAL_TEXT_THIN_FLOOR,
  evaluateOfficialStagedSaveLength,
  evaluateOfficialTextLength,
  officialSubstantiveCharCount,
} from "@/lib/officialSupply/characterText";
import type { OfficialAppearanceLock, OfficialCharacterDraft } from "@/lib/officialSupply/types";

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
    assert.equal(AI_LEARNING_LIMIT, 12000);
    assert.equal(OFFICIAL_APPEARANCE_BLOCK_RESERVE, 600);
    assert.equal(OFFICIAL_COMPILED_CHAR_CEILING, AI_LEARNING_LIMIT - OFFICIAL_APPEARANCE_BLOCK_RESERVE);
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

  it("a compiled body over the shared compiled ceiling fails closed, and under 3000 on the floor", () => {
    const { draft } = compileCanonical();
    const ceiling = OFFICIAL_COMPILED_CHAR_CEILING;
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

const STAGING_USER: SessionUser = { id: 9001, nickname: "pilot-staging", is_adult: 1 };
const DRY_RUN_ASSET = {
  url: "/uploads/official-supply-dry-run.webp",
  tag: "dry-run",
  width: 1024,
  height: 1536,
  viewerBlur: false,
  representativeRank: 1,
};

type PilotFile = {
  slot: number;
  draftKey: string;
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
};

function loadPilot(slot: number): PilotFile {
  return readJson(path.join(PILOT_DIR, "characters", `pilot-rf-${String(slot).padStart(2, "0")}.json`));
}

function saveDryRun(file: PilotFile) {
  const appearanceBlock = renderAppearanceBlock(file.appearance);
  const body = buildOfficialCharacterFormBody({
    draft: file.draft,
    appearanceBlock,
    assets: [DRY_RUN_ASSET],
    lorebookIds: [],
  });
  return {
    appearanceBlock,
    parsed: parseCharacterFormBody(body, STAGING_USER),
    staged: evaluateOfficialStagedSaveLength(file.draft, appearanceBlock),
    compiled: evaluateOfficialTextLength(file.draft),
  };
}

function limitFormBody(total: number) {
  const speechPersonality = "말투";
  const speechTraits = "특징";
  const world = "세계관";
  const systemPrompt = "가".repeat(total - world.length - speechPersonality.length - speechTraits.length);
  return {
    content_kind: "character",
    name: "한도",
    tagline: "한도",
    description: "공개",
    greeting: "인사합니다.",
    system_prompt: systemPrompt,
    world,
    speech_personality: speechPersonality,
    speech_traits: speechTraits,
    speech_examples: "예시",
    speech_forbidden: "금지",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
  };
}

describe("canonical 12k save owner", () => {
  it("accepts 12000 and rejects 12001 with the shared error", () => {
    const accepted = parseCharacterFormBody(limitFormBody(12_000), STAGING_USER);
    const rejected = parseCharacterFormBody(limitFormBody(12_001), STAGING_USER);
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.error, aiLearningLimitExceededMessage());
      assert.equal(rejected.status, 400);
    }
  });

  it("Wolfgang and Bastian pass compiled QA and actual-appearance save dry-run", () => {
    for (const slot of [2, 5]) {
      const file = loadPilot(slot);
      const result = saveDryRun(file);
      assert.equal(result.compiled.ok, true, JSON.stringify(result.compiled.errors));
      assert.equal(result.staged.ok, true, JSON.stringify(result.staged.errors));
      assert.equal(result.parsed.ok, true, result.parsed.ok ? "" : result.parsed.error);
      assert.ok(officialSubstantiveCharCount(file.draft) <= OFFICIAL_COMPILED_CHAR_CEILING);
      assert.ok(officialSubstantiveCharCount(file.draft, result.appearanceBlock) <= AI_LEARNING_LIMIT);
    }
  });

  it("detects a staged-save overflow before image generation", () => {
    const file = loadPilot(2);
    const overAppearance = `${renderAppearanceBlock(file.appearance)}\n${"가".repeat(2_000)}`;
    const staged = evaluateOfficialStagedSaveLength(file.draft, overAppearance);
    assert.equal(staged.ok, false);
    assert.ok(staged.errors.some((error) => error.code === "text_exceeds_canonical_ceiling"));
    assert.equal(evaluateOfficialTextLength(file.draft).ok, true);
  });
});
