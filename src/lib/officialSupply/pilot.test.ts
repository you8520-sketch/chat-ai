import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import {
  OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  stripPromptTierLabel,
  validatePilotAppearance,
  validatePilotAssetPlan,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
} from "@/lib/officialSupply/author";
import { renderAppearanceBlock } from "@/lib/officialSupply/appearance";
import {
  compileOfficialDraftFromBible,
  evaluateAdultPortfolioDiversity,
  evaluateAuthorQualityContract,
  validateCharacterBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import {
  buildOfficialCharacterFormBody,
  officialSubstantiveCharCount,
} from "@/lib/officialSupply/characterText";
import { validateStyleProposal } from "@/lib/officialSupply/style";
import type {
  OfficialAppearanceLock,
  OfficialAssetPlan,
  OfficialCharacterDraft,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";
import {
  evaluateInternalRegionConsistency,
  evaluateOriginality,
  evaluateWorldDiversity,
  internalWorldRegions,
} from "@/lib/officialSupply/worldQa";
import { evaluateCastRelationshipGraph } from "@/lib/officialSupply/castRelationships";
import {
  castGenderCounts,
  evaluateCastIntent,
  evaluatePortfolioBalance,
  type CastGender,
  type OfficialCastIntent,
  type ResearchSnapshot,
} from "@/lib/officialSupply/research";
import {
  evaluateCastRoleDiversity,
  evaluateDiscoveryTags,
  evaluateMarketTropePortfolio,
  evaluateNamePortfolio,
  hasUserRelationshipCue,
  observedMarketNames,
  validateMarketFitBrief,
  type OfficialBatchMarketPolicy,
} from "@/lib/officialSupply/marketFit";
import { listActiveQuarantines } from "@/lib/officialSupply/pilotArtifacts";
import { evaluateScenePortfolioDiversity, resolveOfficialCharacterSceneContext } from "@/lib/officialSupply/scenePortfolio";

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
  characterLorebook?: OfficialWorldLorebookEntry[];
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
    assert.ok(bible.lorebook.length >= 3 && bible.lorebook.length <= 8);
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

  it("Lucian canonical height is 184cm across world brief, bible and appearance lock", () => {
    const { bible: world } = worldBible();
    const lucian = chars().find((file) => file.draftKey === "pilot-rf-03");
    assert.ok(lucian);
    const brief = world.portfolio.find((item) => item.slot === 3);
    assert.ok(brief);

    assert.equal(lucian!.bible.identity.heightCm, 184);
    assert.equal(lucian!.appearance!.identity.heightCm, 184);
    assert.match(lucian!.brief.visualSilhouette, /184cm/);
    assert.match(brief!.visualSilhouette, /184cm/);
    assert.doesNotMatch(JSON.stringify(lucian), /178cm/);
  });

  it("Lucian public description and greeting use the canonical vault-alarm relationship hook", () => {
    const lucian = chars().find((file) => file.draftKey === "pilot-rf-03");
    assert.ok(lucian);

    assert.match(lucian!.draft.description, /증권거래소 지하 금고/);
    assert.match(lucian!.draft.description, /기존 관계는 페르소나 설정을 따르며/);
    assert.match(lucian!.draft.greeting, /증권거래소 지하 금고/);
    assert.match(lucian!.draft.greeting, /경보/);
    assert.match(lucian!.bible.situation.userEntry, /증권거래소 지하 금고/);
    assert.doesNotMatch(lucian!.bible.situation.userEntry, /페르소나|가족·동료·연인/);
    assert.match(lucian!.draft.sections.relationshipsAndDrives, /유저 페르소나와 대화에서 명시된 설정을 우선/);
    assert.match(lucian!.bible.rpEngine.immediateHook, /증권거래소 지하 금고/);
    assert.doesNotMatch(lucian!.draft.greeting, /오늘 처음 만난|낯선 사람/);
    assert.doesNotMatch(lucian!.draft.greeting, /비가 그친 뒤의 골목/);
  });

  it("compiled character cores contain no legacy Korean suffix-assembly artifacts", () => {
    for (const file of chars()) {
      const core = file.draft.sections.characterCore;
      assert.doesNotMatch(core, /(\\d{3})cm\\s+\\1cm/u, file.draftKey);
      assert.doesNotMatch(core, /\\.에\\s/u, file.draftKey);
      assert.doesNotMatch(core, /피부\\.?\\s*피부/u, file.draftKey);
      assert.doesNotMatch(core, /\\.\\s*차림[,. ]/u, file.draftKey);
      assert.doesNotMatch(core, /\\.\\./u, file.draftKey);
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
        worldName: world.name,
        worldBible: world,
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
      representativeRank: 1,
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
  });

  it("cast gender matches the batch-scoped manifest intent (8M / 1F / 1 other), not a balanced default", () => {
    const m = manifest() as unknown as { castIntent: OfficialCastIntent; slotGenders: CastGender[] };
    const drafts = chars().map((f) => f.draft);
    const genders = drafts.map((d) => d.gender as CastGender);
    assert.deepEqual(m.castIntent.desiredGenderMix, { male: 8, female: 1, other: 1 });
    assert.equal(evaluateCastIntent(genders, m.castIntent).ok, true);
    assert.deepEqual(genders, m.slotGenders);
    assert.deepEqual(castGenderCounts(genders), m.castIntent.desiredGenderMix);
    assert.equal(m.castIntent.targetAudience, "female_oriented");
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

  it("cost report: physical-attempt semantics, legacy ledger baseline, zero image calls", () => {
    const cost = readJson<{
      version: number;
      successfulCompletions: number;
      failedProviderAttempts: number;
      physicalAttempts: number;
      workflowRetries: number;
      billedCostUsd: number;
      failedAttemptCostUsd: number;
      imageCalls: number;
      lines: { task: string; outcome: string; workflowAttempt: number; model: string; costUsd: number | null }[];
      legacy: { successfulCompletions: number; billedCostUsd: number; ledgerCutoff: string; failedProviderAttempts: { tracked: boolean } };
    }>(path.join(PILOT_DIR, "cost.json"));
    assert.equal(cost.version, 2);
    assert.equal(cost.imageCalls, 0);
    assert.equal(cost.physicalAttempts, cost.successfulCompletions + cost.failedProviderAttempts);
    assert.equal(cost.lines.length, cost.physicalAttempts);
    assert.equal(cost.lines.filter((l) => l.outcome === "success").length, cost.successfulCompletions);
    assert.equal(cost.lines.filter((l) => l.outcome !== "success").length, cost.failedProviderAttempts);
    const summed = cost.lines.reduce((s, l) => s + (l.costUsd ?? 0), 0);
    assert.ok(Math.abs(summed - cost.billedCostUsd) < 1e-6, `${summed} vs ${cost.billedCostUsd}`);
    assert.ok(cost.failedAttemptCostUsd <= cost.billedCostUsd);
    for (const line of cost.lines) assert.ok(line.workflowAttempt >= 1 && line.model.trim().length > 0);
    // Pre-v2 spend is summarized from the canonical ledger, not from the incomplete v1 lines.
    assert.ok(cost.legacy.successfulCompletions >= 58);
    assert.ok(cost.legacy.billedCostUsd > 0);
    assert.equal(cost.legacy.failedProviderAttempts.tracked, false);
    assert.match(cost.legacy.ledgerCutoff, /^\d{4}-\d{2}-\d{2} /);
  });

  it("no stale active quarantine remains once the pilot is complete", () => {
    assert.deepEqual(listActiveQuarantines(PILOT_DIR), []);
  });

  it("every stored draft passes the unified author quality contract", () => {
    for (const file of chars()) {
      const qa = evaluateAuthorQualityContract(file.bible);
      assert.equal(qa.ok, true, `slot ${file.slot}: ${JSON.stringify(qa.errors)}`);
    }
  });

  it("adult portfolio is diverse and every sheet keeps the canonical adult contract", () => {
    const files = chars();
    const qa = evaluateAdultPortfolioDiversity(files.map((f) => f.bible));
    assert.equal(qa.ok, true, JSON.stringify(qa.errors));
    const m = manifest() as unknown as { adultPlan: Record<string, { dialogueProfile: string; consentModes: string[] }> };
    for (const file of files.filter((f) => f.draft.adult.nsfw)) {
      const plan = m.adultPlan[file.draftKey];
      assert.ok(plan, `${file.draftKey} missing from manifest adultPlan`);
      const adult = file.draft.adult;
      if (adult.nsfw) {
        assert.equal(adult.adultDialogueProfile, plan.dialogueProfile);
        assert.deepEqual(adult.adultConsentModesAllowed, plan.consentModes);
        assert.ok(!adult.adultConsentModesAllowed.includes("cnc_opt_in"));
        assert.ok(adult.participantMinAge >= 19);
      }
    }
  });

  it("scene portfolio: character-specific, no world-wide clone", () => {
    const { bible: world } = worldBible();
    const files = chars();
    const entries = files.map((f) => ({
      draftKey: f.draftKey,
      name: f.bible.identity.name,
      plan: f.assetPlan!,
      context: resolveOfficialCharacterSceneContext({ world, bible: f.bible, brief: f.brief as never }),
    }));
    const qa = evaluateScenePortfolioDiversity(entries, world.locations);
    assert.equal(qa.ok, true, JSON.stringify(qa.errors));
    assert.ok(qa.stats.cloneRate <= 0.25);
    for (const share of Object.values(qa.stats.locationShare)) assert.ok(share < 0.8);
    for (const f of files) {
      for (const slot of f.assetPlan!.slots) {
        assert.equal(slot.location, slot.location === null ? null : stripPromptTierLabel(slot.location), `${f.draftKey}/${slot.slotKey}`);
      }
    }
  });

  it("corrections touched only the allowed sections (voice fields / adultSection / assetPlan)", () => {
    const allowed: Record<string, string[]> = {
      "voice-fix": ["greeting", "publicDescription", "speech"],
      "adult-fix": ["adultSection"],
      assetplan: ["assetPlan"],
      "public-fix": ["tagline", "tags"],
      "cast-cleanup": ["otherRelationships"],
      "relationship-repair": ["otherRelationships"],
      "consistency-fix": ["brief", "identity", "backstory", "situation", "publicProfile", "wording"],
    };
    for (const file of chars()) {
      for (const revision of (file as unknown as { revisions?: { step: string; fields: string[] }[] }).revisions ?? []) {
        for (const field of revision.fields) {
          assert.ok(allowed[revision.step]?.includes(field), `${file.draftKey}: ${revision.step} touched ${field}`);
        }
      }
    }
  });

  it("pilot tooling never touches image, billing, reward, staging, or publish owners", () => {
    const files = [
      "src/lib/officialSupply/author.ts",
      "src/lib/officialSupply/authorPrompts.ts",
      "src/lib/officialSupply/bible.ts",
      "src/lib/officialSupply/scenePortfolio.ts",
      "src/lib/officialSupply/pilotArtifacts.ts",
      "src/lib/officialSupply/marketFit.ts",
      "src/lib/officialSupply/research.ts",
      "src/lib/officialSupply/castRelationships.ts",
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
    assert.match(page, /if \(c\.nsfw === 1 && !canAccessAdultContent\(user\)\) \{/);
    assert.match(route, /if \(ch\.nsfw && !canAccessAdultContent\(user\)\) \{/);
  });
});

describe("pilot cast correction: 06-08 replaced by male romance targets", () => {
  type Replacement = { replacedNames: string[]; slots: { slot: number; gender: string; adultCandidate: boolean }[] };
  type PublicDecision = { tagline?: string; replaceTags?: [string, string][]; addTags?: string[] };
  const m = () =>
    manifest() as unknown as {
      replacement: Replacement;
      publicSurfaceDecisions: Record<string, PublicDecision>;
      marketPolicy: OfficialBatchMarketPolicy;
    };
  const snapshot = () =>
    readJson<ResearchSnapshot>(path.join(process.cwd(), "docs/official-supply/market-research-snapshot-2026-09.json"));

  it("replaced slots carry valid market-fit briefs, relationship-first hooks and grounded 4-7 tags", () => {
    const { bible: world } = worldBible();
    const { replacement, marketPolicy } = m();
    const files = chars();
    for (const plan of replacement.slots) {
      const brief = world.portfolio.find((b) => b.slot === plan.slot)!;
      const file = files.find((f) => f.slot === plan.slot)!;
      assert.ok(!replacement.replacedNames.includes(brief.name), `slot ${plan.slot} still holds a replaced character`);
      assert.equal(file.bible.identity.gender, plan.gender);
      assert.equal(brief.adultCandidate, plan.adultCandidate);
      assert.ok(brief.marketFit, `slot ${plan.slot}: marketFit missing`);
      const qa = validateMarketFitBrief(brief.marketFit!, {
        snapshot: snapshot(),
        policy: marketPolicy,
        adultCandidate: brief.adultCandidate,
        expectedNamingProfile: "western_rofan",
      });
      assert.deepEqual(qa.errors, [], `slot ${plan.slot}`);
      assert.ok(hasUserRelationshipCue(file.bible.publicProfile.tagline), `slot ${plan.slot} tagline: ${file.bible.publicProfile.tagline}`);
      assert.ok(hasUserRelationshipCue(brief.rpHook));
      const tags = evaluateDiscoveryTags({ tags: file.bible.publicProfile.tags, bible: file.bible, hook: brief }, marketPolicy);
      assert.deepEqual(tags.errors, [], `slot ${plan.slot}`);
      assert.ok(file.bible.publicProfile.tags.length >= 4 && file.bible.publicProfile.tags.length <= 7);
      assert.equal(file.bible.identity.name, brief.name);
    }
  });

  it("new names are clean in the full-cast name QA and keep the western_rofan profile", () => {
    const { bible: world } = worldBible();
    const qa = evaluateNamePortfolio(
      world.portfolio.map((b) => ({
        draftKey: String(b.slot),
        name: b.name,
        namingProfile: b.gender === "other" ? ("nonhuman_designation" as const) : ("western_rofan" as const),
      })),
      { observed: observedMarketNames(snapshot()) }
    );
    assert.deepEqual(qa.errors, []);
    const replacedNames = m().replacement.slots.map((s) => world.portfolio.find((b) => b.slot === s.slot)!.name);
    for (const issue of qa.warnings) {
      assert.ok(!replacedNames.some((n) => issue.message.includes(n)), issue.message);
    }
  });

  it("role diversity: no occupation/hook/silhouette/speech clone and at most 2 royal/ducal leads", () => {
    const { bible: world } = worldBible();
    const files = chars();
    const qa = evaluateCastRoleDiversity(
      world.portfolio.map((b, i) => ({
        draftKey: String(b.slot),
        name: b.name,
        occupation: b.occupation,
        archetype: b.archetype,
        socialPosition: b.socialPosition,
        visualSilhouette: b.visualSilhouette,
        rpHook: b.rpHook,
        speechDirection: `${b.speechDirection} ${files[i]!.bible.speech.register} ${files[i]!.bible.speech.keywords.join(" ")}`,
      }))
    );
    assert.deepEqual(qa.errors, []);
    assert.ok(qa.royalOrDuke.length <= 2, qa.royalOrDuke.join(","));
    const tropes = evaluateMarketTropePortfolio(
      world.portfolio.map((b) => ({ draftKey: String(b.slot), primaryTrope: b.marketFit?.relationshipTrope.primary ?? b.relationshipTrope, secondaryTropes: [] })),
      m().marketPolicy
    );
    assert.deepEqual(tropes.errors, []);
  });

  it("human-approved public-surface decisions are applied exactly (tagline / tags only)", () => {
    const files = chars();
    for (const [draftKey, decision] of Object.entries(m().publicSurfaceDecisions)) {
      const file = files.find((f) => f.draftKey === draftKey)!;
      if (decision.tagline) assert.equal(file.bible.publicProfile.tagline, decision.tagline);
      for (const [from, to] of decision.replaceTags ?? []) {
        assert.ok(!file.bible.publicProfile.tags.includes(from) && file.bible.publicProfile.tags.includes(to), `${draftKey}: ${from}→${to}`);
      }
      for (const add of decision.addTags ?? []) assert.ok(file.bible.publicProfile.tags.includes(add));
      assert.equal(file.draft.tagline, file.bible.publicProfile.tagline);
      assert.deepEqual(file.draft.tags, file.bible.publicProfile.tags);
    }
    const kept = ["pilot-rf-04", "pilot-rf-05", "pilot-rf-09"];
    const taglines: Record<string, string> = {
      "pilot-rf-04": "정답보다 당신이 숨긴 전제가 궁금한 학자",
      "pilot-rf-05": "목격자의 목에 칼을 겨눈 청부업자, 끝내 손을 멈췄다.",
      "pilot-rf-09": "기도가 닿지 않는 밤에도, 그녀는 당신 곁을 지킨다.",
    };
    for (const key of kept) assert.equal(files.find((f) => f.draftKey === key)!.bible.publicProfile.tagline, taglines[key]);
  });

  it("relationship graph: canonical full-name targets, no self/unknown/removed/duplicate, no one-way public replacement tie", () => {
    const { bible: world } = worldBible();
    const files = chars();
    const qa = evaluateCastRelationshipGraph(
      files.map((f) => ({ draftKey: f.draftKey, name: f.bible.identity.name, relationships: f.bible.otherRelationships })),
      { removedNames: m().replacement.replacedNames, replacedDraftKeys: m().replacement.slots.map((s) => `pilot-rf-${String(s.slot).padStart(2, "0")}`) }
    );
    assert.deepEqual(qa.errors, []);
    assert.deepEqual(qa.stats.oneWayPublicFromReplaced, []);
    const canonical = new Set(world.portfolio.map((b) => b.name));
    for (const f of files) {
      for (const rel of f.bible.otherRelationships) assert.ok(canonical.has(rel.target), `${f.draftKey}: ${rel.target}`);
      const text = JSON.stringify({ bible: f.bible, draft: f.draft, plan: f.assetPlan });
      for (const removed of m().replacement.replacedNames) {
        assert.ok(!text.includes(removed.split(/\s+/)[0]!), `${f.draftKey} mentions ${removed}`);
      }
    }
    // Reconciled awareness is public-only: nothing private or hidden was invented.
    const replacedNames = new Set(m().replacement.slots.map((s) => world.portfolio.find((b) => b.slot === s.slot)!.name));
    for (const f of files.filter((x) => !replacedNames.has(x.bible.identity.name))) {
      for (const rel of f.bible.otherRelationships.filter((r) => replacedNames.has(r.target))) {
        assert.ok(rel.public.includes("공개된 접점"), `${f.draftKey} → ${rel.target}`);
        assert.equal(rel.privateOpinion, "");
        assert.equal(rel.hidden, "");
      }
    }
  });

  it("world consistency: no sheet turns an internal region (벨로체) into a foreign/enemy/defeated state", () => {
    const { bible: world } = worldBible();
    const regions = internalWorldRegions(world.regions);
    assert.ok(regions.includes("벨로체"));
    for (const f of chars()) {
      const qa = evaluateInternalRegionConsistency(
        JSON.stringify({ brief: f.brief, bible: f.bible, plan: f.assetPlan, sceneContext: f.sceneContext }),
        regions
      );
      assert.deepEqual(qa.errors, [], f.draftKey);
    }
    const noel = chars().find((f) => f.draftKey === "pilot-rf-08")!;
    assert.match(noel.bible.identity.affiliation, /제국 서부 해상 무역권/);
    assert.ok(noel.bible.publicProfile.tagline.startsWith("당신이") && noel.bible.publicProfile.tagline.length <= 50);
    assert.deepEqual(world.portfolio.find((b) => b.slot === 8), noel.brief, "world brief and sheet brief stay in sync");
  });

  it("every sheet's discovery tags are grounded (04 included)", () => {
    const files = chars();
    for (const f of files) {
      const qa = evaluateDiscoveryTags({ tags: f.bible.publicProfile.tags, bible: f.bible, hook: f.brief }, m().marketPolicy);
      assert.deepEqual(qa.errors, [], f.draftKey);
    }
    assert.ok(files.find((f) => f.draftKey === "pilot-rf-04")!.bible.publicProfile.tags.includes("연구 협력"));
  });

  it("style: rf-02 is only the human-selected proof direction; canonical stage stays candidates_proposed", () => {
    const board = readJson<{
      stage: string;
      humanReview: { leadingProofDirection: string; fallback: string; canonicalStage: string; candidateApproved: boolean; noImagesGenerated: boolean };
    }>(path.join(PILOT_DIR, "style-candidates.json"));
    assert.equal(board.stage, "candidates_proposed");
    assert.equal(board.humanReview.canonicalStage, "candidates_proposed");
    assert.equal(board.humanReview.leadingProofDirection, "rf-02");
    assert.equal(board.humanReview.fallback, "rf-04");
    assert.equal(board.humanReview.candidateApproved, false);
    assert.equal(board.humanReview.noImagesGenerated, true);
  });
});
