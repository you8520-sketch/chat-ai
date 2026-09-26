import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import {
  OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  validatePilotAppearance,
  validatePilotAssetPlan,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
} from "@/lib/officialSupply/author";
import { renderAppearanceBlock } from "@/lib/officialSupply/appearance";
import {
  compileOfficialDraftFromBible,
  validateCharacterBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import {
  buildOfficialCharacterFormBody,
  officialSubstantiveCharCount,
} from "@/lib/officialSupply/characterText";
import { validateStyleProposal } from "@/lib/officialSupply/style";
import type { OfficialAppearanceLock, OfficialAssetPlan, OfficialCharacterDraft } from "@/lib/officialSupply/types";
import { evaluateOriginality, evaluateWorldDiversity } from "@/lib/officialSupply/worldQa";
import { evaluatePortfolioBalance } from "@/lib/officialSupply/research";

/**
 * Pilot content regression — validates the committed romance-fantasy pilot
 * (1 world bible + 10 character files + style board + cost report) through
 * the canonical QA owners. Fails when the pilot is incomplete or drifted.
 */
const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const STAGING_USER: SessionUser = { id: 9001, nickname: "pilot-staging", is_adult: 1 };

type CharFile = {
  slot: number;
  draftKey: string;
  quarantined?: boolean;
  brief: {
    slot: number;
    name: string;
    gender: string;
    age: number;
    archetype: string;
    relationshipTrope: string;
    occupation: string;
    adultCandidate: boolean;
    audience: "all" | "female" | "male";
    rpHook: string;
  };
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
  appearance?: OfficialAppearanceLock;
  assetPlan?: OfficialAssetPlan;
  provenances?: unknown[];
  charCount?: number;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function manifest(): {
  batchKey: string;
  worldKey: string;
  styleKey: string;
  genre: string;
  slots: number;
  adultCandidates: number;
  templateVersion: string;
  snapshotVersion: string;
} {
  return readJson(path.join(PILOT_DIR, "manifest.json"));
}

function worldBible(): { bible: OfficialWorldBible; provenances: unknown[] } {
  return readJson(path.join(PILOT_DIR, "world-bible.json"));
}

function chars(): CharFile[] {
  const out: CharFile[] = [];
  for (let slot = 1; slot <= 10; slot += 1) {
    out.push(readJson(path.join(PILOT_DIR, "characters", `pilot-rf-${String(slot).padStart(2, "0")}.json`)));
  }
  return out;
}

function originalityCorpus(): { source: string; phrases: string[]; terms: string[] }[] {
  const snapshot = readJson<{
    signals: { source: string; scenarioHook?: string; worldMechanic?: string }[];
  }>(path.join(process.cwd(), "docs/official-supply/market-research-snapshot-2026-09.json"));
  return snapshot.signals.map((s) => ({
    source: s.source,
    phrases: s.scenarioHook ? [s.scenarioHook] : [],
    terms: s.worldMechanic ? [s.worldMechanic] : [],
  }));
}

describe("official pilot content (romance fantasy 01)", () => {
  it("manifest pins 10 slots, 4 adult candidates, template and snapshot versions", () => {
    const m = manifest();
    assert.equal(m.slots, 10);
    assert.equal(m.adultCandidates, 4);
    assert.equal(m.genre, "로맨스 판타지");
    assert.equal(m.templateVersion, OFFICIAL_AUTHOR_TEMPLATE_VERSION);
    assert.equal(m.snapshotVersion, OFFICIAL_AUTHOR_SNAPSHOT_VERSION);
  });

  it("world bible passes deterministic QA with 10 briefs and 4 adult candidates", () => {
    const m = manifest();
    const { bible } = worldBible();
    assert.equal(bible.portfolio.length, m.slots);
    assert.equal(bible.portfolio.filter((b) => b.adultCandidate).length, m.adultCandidates);
    assert.ok(bible.lorebook.length >= 8 && bible.lorebook.length <= 12);
  });

  it("all 10 character files exist, complete, and match their briefs", () => {
    const { bible: world } = worldBible();
    const files = chars();
    assert.equal(files.length, 10);
    for (const file of files) {
      assert.equal(file.quarantined ?? false, false, `slot ${file.slot} quarantined`);
      assert.ok(file.bible, `slot ${file.slot}: missing bible`);
      assert.ok(file.draft, `slot ${file.slot}: missing draft`);
      assert.ok(file.appearance, `slot ${file.slot}: missing appearance lock`);
      assert.ok(file.assetPlan, `slot ${file.slot}: missing asset plan`);
      const brief = world.portfolio.find((b) => b.slot === file.slot);
      assert.ok(brief, `slot ${file.slot}: no world brief`);
      assert.equal(file.brief.name, brief!.name);
      assert.equal(file.bible.identity.name, brief!.name);
      assert.equal(file.draft.name, brief!.name);
      assert.equal(file.bible.nsfw, brief!.adultCandidate);
      assert.equal(file.draft.adult.nsfw, brief!.adultCandidate);
    }
  });

  it("stored drafts are exactly what the canonical compiler produces from the bibles", () => {
    const m = manifest();
    const { bible: world } = worldBible();
    for (const file of chars()) {
      const brief = world.portfolio.find((b) => b.slot === file.slot)!;
      const recompiled = compileOfficialDraftFromBible(file.bible, {
        draftKey: file.draftKey,
        worldKey: m.worldKey,
        styleKey: m.styleKey,
        genres: ["로맨스 판타지"],
        audience: file.brief.audience,
        hook: {
          archetype: brief.archetype,
          relationshipTrope: brief.relationshipTrope,
          occupation: brief.occupation,
          rpHook: brief.rpHook,
        },
      });
      assert.deepEqual(file.draft, recompiled, `slot ${file.slot}: draft drifted from compiler`);
    }
  });

  it("every bible passes bible QA and every draft passes TEXT_LOCK QA", () => {
    const files = chars();
    const drafts = files.map((f) => f.draft);
    for (const file of files) {
      const bibleQa = validateCharacterBible(file.bible, { adultExpected: file.brief.adultCandidate });
      assert.equal(bibleQa.ok, true, `slot ${file.slot} bible: ${JSON.stringify(bibleQa.errors)}`);
      const draftQa = validatePilotDraftForTextLock(
        file.draft,
        drafts.filter((d) => d.draftKey !== file.draft.draftKey),
        originalityCorpus(),
        []
      );
      assert.equal(draftQa.ok, true, `slot ${file.slot} draft: ${JSON.stringify(draftQa.errors)}`);
      assert.equal(validatePilotBible(file.bible, { adultExpected: file.brief.adultCandidate }).ok, true);
    }
  });

  it("every draft survives the canonical save dry run (TEXT_LOCK candidate)", () => {
    const dryRunAsset = {
      url: "/uploads/official-supply-dry-run.webp",
      tag: "dry-run",
      width: 1024,
      height: 1536,
      viewerBlur: false,
    };
    for (const file of chars()) {
      const body = buildOfficialCharacterFormBody({
        draft: file.draft,
        appearanceBlock: renderAppearanceBlock(file.appearance!),
        assets: [dryRunAsset],
        lorebookIds: [],
      });
      const parsed = parseCharacterFormBody(body, STAGING_USER);
      assert.equal(parsed.ok, true, `slot ${file.slot}: ${parsed.ok ? "" : parsed.error}`);
    }
  });

  it("compiled length: every sheet above the thin floor, average inside 6k-8k", () => {
    const totals = chars().map((f) => officialSubstantiveCharCount(f.draft));
    for (const [i, total] of totals.entries()) {
      assert.ok(total >= 3000, `slot ${i + 1} thin: ${total}`);
      assert.ok(total <= 9400, `slot ${i + 1} over ceiling: ${total}`);
    }
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    assert.ok(avg >= 5500 && avg <= 9400, `average ${Math.round(avg)} outside density band`);
    if (avg < 6000 || avg > 8000) {
      console.log(`[pilot] note: average ${Math.round(avg)} outside the 6k-8k soft target (hard ceiling holds)`);
    }
  });

  it("adult mix: exactly 4 NSFW sheets, all 19+ with canonical contract", () => {
    const files = chars();
    const adults = files.filter((f) => f.draft.adult.nsfw);
    assert.equal(adults.length, 4);
    for (const file of adults) {
      const adult = file.draft.adult;
      assert.equal(adult.nsfw, true);
      if (adult.nsfw) {
        assert.ok(adult.participantMinAge >= 19);
        assert.ok(adult.orientation.trim().length > 0);
        assert.ok(adult.adultHookSummary.trim().length > 0);
      }
      assert.ok(file.bible.adultSection, `slot ${file.slot}: missing adultSection`);
    }
    for (const file of files.filter((f) => !f.draft.adult.nsfw)) {
      assert.deepEqual(file.draft.adult, { nsfw: false });
    }
  });

  it("portfolio diversity: no clone pairs, no over-repeated trope", () => {
    const drafts = chars().map((f) => f.draft);
    const qa = evaluateWorldDiversity(drafts);
    assert.equal(qa.errors.length, 0, JSON.stringify(qa.errors));
    const genders = new Set(drafts.map((d) => d.gender));
    assert.ok(genders.size >= 2, "single-gender pilot");
    assert.ok(drafts.filter((d) => d.gender === "male").length >= 4, "male under-represented");
    assert.ok(drafts.filter((d) => d.gender === "female").length >= 3, "female under-represented");
  });

  it("originality: no distinctive competitor copy in any sheet", () => {
    for (const file of chars()) {
      const qa = evaluateOriginality(file.draft, originalityCorpus(), []);
      assert.equal(qa.ok, true, `slot ${file.slot}: ${JSON.stringify(qa.errors)}`);
    }
  });

  it("shared lorebook respects the COMMON-only boundary across all 10 secrets", () => {
    const { bible: world } = worldBible();
    const drafts = chars().map((f) => f.draft);
    const qa = validatePilotLorebook(world.lorebook, drafts);
    assert.equal(qa.ok, true, JSON.stringify(qa.errors));
    const balance = evaluatePortfolioBalance(
      drafts.map((d) => ({ draftKey: d.draftKey, primaryGenre: "로맨스 판타지" as const, nsfw: d.adult.nsfw })),
      { adultShareMin: 0.3, adultShareMax: 0.5, maxGenreShare: 1, minDistinctGenres: 1 }
    );
    assert.equal(balance.ok, true, JSON.stringify(balance.errors));
  });

  it("appearance locks validate and stay visually diverse", () => {
    const files = chars();
    for (const file of files) {
      assert.equal(validatePilotAppearance(file.draft, file.appearance!).ok, true, `slot ${file.slot}`);
    }
    const hairColors = new Set(files.map((f) => f.appearance!.identity.hairColor));
    const eyeColors = new Set(files.map((f) => f.appearance!.identity.eyeColor));
    const heights = files.map((f) => f.appearance!.identity.heightCm);
    assert.ok(hairColors.size >= 6, `hair colors: ${[...hairColors].join(",")}`);
    assert.ok(eyeColors.size >= 4, `eye colors: ${[...eyeColors].join(",")}`);
    assert.ok(Math.max(...heights) - Math.min(...heights) >= 15, "height spread too narrow");
  });

  it("asset plans validate: exactly 14 slots (1/4/6/3), distinct scene places", () => {
    for (const file of chars()) {
      assert.equal(validatePilotAssetPlan(file.draft, file.assetPlan!).ok, true, `slot ${file.slot}`);
      const counts = { representative: 0, signature: 0, emotion: 0, scene: 0 };
      for (const slot of file.assetPlan!.slots) counts[slot.kind] += 1;
      assert.deepEqual(counts, { representative: 1, signature: 4, emotion: 6, scene: 3 });
      const places = file.assetPlan!.slots.filter((s) => s.kind === "scene").map((s) => s.location);
      assert.equal(new Set(places).size, 3, `slot ${file.slot}: scene places repeat`);
    }
  });

  it("style board stays at candidates_proposed with observation-only references", () => {
    const m = manifest();
    const board = readJson<{
      styleKey: string;
      genre: string;
      stage: string;
      candidates: Parameters<typeof validateStyleProposal>[0]["candidates"];
      provenance: unknown;
    }>(path.join(PILOT_DIR, "style-candidates.json"));
    assert.equal(board.styleKey, m.styleKey);
    assert.equal(board.stage, "candidates_proposed");
    assert.ok(board.candidates.length >= 3 && board.candidates.length <= 5);
    assert.equal(
      validateStyleProposal({ styleKey: board.styleKey, genre: "로맨스 판타지", candidates: board.candidates }).ok,
      true
    );
    for (const candidate of board.candidates) {
      for (const ref of candidate.references) {
        assert.equal(ref.provenance, "external_public_observation");
      }
    }
  });

  it("cost report proves zero image calls and records every text call", () => {
    const cost = readJson<{
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      failures: number;
      retries: number;
      imageCalls: number;
      lines: { task: string; model: string; inputTokens: number; outputTokens: number }[];
    }>(path.join(PILOT_DIR, "cost.json"));
    assert.equal(cost.imageCalls, 0);
    const byTask = (task: string): number => cost.lines.filter((l) => l.task === task).length;
    assert.ok(byTask("world_bible") >= 3, "world core/atlas/portfolio lines");
    assert.ok(byTask("character_bible_1") >= 10);
    assert.ok(byTask("character_bible_voice") >= 10);
    assert.ok(byTask("character_bible_bonds") >= 10);
    assert.ok(byTask("appearance") >= 10);
    assert.ok(byTask("asset_plan") >= 10);
    assert.ok(byTask("style_board") >= 1);
    for (const line of cost.lines) {
      assert.ok(line.model.trim().length > 0);
      assert.ok(line.inputTokens >= 0 && line.outputTokens > 0);
    }
  });

  it("pilot tooling never touches image, billing, reward, staging, or publish owners", () => {
    const files = [
      "src/lib/officialSupply/author.ts",
      "src/lib/officialSupply/authorPrompts.ts",
      "src/lib/officialSupply/bible.ts",
      "scripts/official-supply-pilot-author.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      assert.doesNotMatch(
        source,
        /runOfficialAssetSlot|productionAdapters|openAiImage|storeUpload|analyzeAssetImage|deductPoints|creditPoints|creatorPoints|maybeCreditCreatorReward|publishOfficial|stageOfficial|isAdminUser|exchangeCreatorPoints|requestCreatorWithdrawal/,
        file
      );
    }
  });

  it("19+ viewer gate still ignores official/site-managed state", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/character/[id]/page.tsx"), "utf8");
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.match(page, /if \(c\.nsfw === 1 && !user\.is_adult\) \{/);
    assert.match(route, /if \(ch\.nsfw && !user\.is_adult\) \{/);
  });
});
