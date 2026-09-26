/**
 * Manual production pilot author for official romance-fantasy supply.
 *
 * MANUAL ONLY: requires OFFICIAL_PILOT_LIVE=1. Never imported by tests.
 * Text calls only — this script never touches the image owner
 * (no runOfficialAssetSlot/productionAdapters import anywhere below),
 * user billing/points, creator rewards, staging, or publishing.
 *
 * Usage:
 *   OFFICIAL_PILOT_LIVE=1 node --conditions=react-server --import tsx \
 *     scripts/official-supply-pilot-author.ts --step world
 *   ... --step characters --concurrency 3
 *   ... --step portfolio-qa
 *   ... --step appearance
 *   ... --step assetplan --concurrency 3
 *   ... --step styles
 *   ... --step all --concurrency 3
 *   ... --step character --slot 4   (single-slot retry)
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import { getDb } from "@/lib/db";
import {
  addCostLine,
  emptyCostReport,
  generateOfficialAppearanceLock,
  generateOfficialAssetPlan,
  generateOfficialCharacterBible,
  generateOfficialStyleBoard,
  generateOfficialWorldBible,
  liveOfficialAuthorTransport,
  provenanceFor,
  recordAuthorRun,
  resolveOfficialAuthorModelId,
  validatePilotAppearance,
  validatePilotAssetPlan,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
  OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  type OfficialAuthorProvenance,
  type OfficialAuthorRawCompletion,
} from "@/lib/officialSupply/author";
import type { PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import {
  compileOfficialDraftFromBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import { evaluatePortfolioBalance } from "@/lib/officialSupply/research";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { officialSubstantiveCharCount } from "@/lib/officialSupply/characterText";
import { evaluateOriginality, evaluateWorldDiversity } from "@/lib/officialSupply/worldQa";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const CHAR_DIR = path.join(PILOT_DIR, "characters");
const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "docs/official-supply/market-research-snapshot-2026-09.json"
);

const MANIFEST = {
  batchKey: "pilot-romance-fantasy-01",
  worldKey: "pilot-rf-erendel",
  styleKey: "romance_fantasy_v1",
  genre: "로맨스 판타지",
  slots: 10,
  adultCandidates: 4,
  templateVersion: OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  snapshotVersion: OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  portfolioPolicy: { adultShareMin: 0.3, adultShareMax: 0.5, maxGenreShare: 1, minDistinctGenres: 1 },
};

/** Trope-level inspiration only — short directions, never competitor prose. */
const INSPIRATION_TROPES = [
  "정략결혼 후 후회하는 남편",
  "적대 관계에서 연인으로",
  "철벽 직업인의 경계 해제",
  "잠입 임무와 금지된 사랑",
  "동거에서 시작되는 관계",
  "궁정 음모 속 약혼",
  "마법과 로맨스의 결합",
  "복수를 위한 계약 결혼",
  "차가운 남편이 서서히 녹음",
  "조사 파트너의 비밀",
  "길드/아카데미 세계관",
  "비극 속 집착과 애정",
  "오래된 친구의 연애 전환",
  "신분 차를 넘는 신뢰",
];

/** Public trend URLs from the committed snapshot (observation only). */
const REFERENCE_URLS = [
  "https://www.aitimes.com/news/articleView.html?idxno=167810",
  "https://chatjanitor.com/",
  "https://qanispot.com/janitor-ai/",
  "https://savedelete.com/article/janitor-ai-romantic-chatbot-15m-users-women-majority/",
  "https://zeta-ai.io/ko/plots/f3ca37b2-0334-4d7d-8e71-26764ba2d671/profile",
  "https://zeta-ai.io/ko/plots/b03d0348-e2cf-4c31-b5f9-bae997ce2e5c/profile",
  "https://rofan.ai/",
  "https://navercorp.com/media/pressReleasesDetail?seq=34351",
];

function ensureDirs(): void {
  fs.mkdirSync(CHAR_DIR, { recursive: true });
}

function draftKeyFor(slot: number): string {
  return `pilot-rf-${String(slot).padStart(2, "0")}`;
}

function charPath(slot: number): string {
  return path.join(CHAR_DIR, `${draftKeyFor(slot)}.json`);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

type CostReport = ReturnType<typeof emptyCostReport>;

function loadCost(): CostReport {
  const file = path.join(PILOT_DIR, "cost.json");
  if (!fs.existsSync(file)) return emptyCostReport();
  return readJson<CostReport>(file);
}

function saveCost(report: CostReport): void {
  writeJson(path.join(PILOT_DIR, "cost.json"), { ...report, imageCalls: 0 });
}

function recordRun(
  draftKey: string,
  task: "world_bible" | "character_bible_1" | "character_bible_2" | "appearance" | "asset_plan" | "style_board",
  provenance: OfficialAuthorProvenance
): void {
  try {
    recordAuthorRun(getDb(), { draftKey, task, provenance });
  } catch (error) {
    console.warn(`[pilot] author-run ledger skipped for ${draftKey}/${task}:`, (error as Error).message);
  }
}

function track(
  report: CostReport,
  completion: OfficialAuthorRawCompletion,
  task: CostReport["lines"][number]["task"],
  draftKey: string | null,
  attempts: number,
  failedAttempts: number
): void {
  addCostLine(report, completion, { task, draftKey, attempts, failedAttempts });
}

function worldContextForBrief(world: OfficialWorldBible, brief: PortfolioBriefInput): string {
  const faction = world.factions.find((f) => f.name === brief.faction);
  const locations = world.locations
    .slice(0, 4)
    .map((location) => `${location.name}(${location.purpose})`)
    .join(" / ");
  return [
    `세계: ${world.name} — ${world.centralPremise}`,
    `현재: ${world.situation.biggestEvent}`,
    brief.faction && faction
      ? `소속 세력 ${faction.name}: ${faction.purpose} / 일반 시선: ${faction.publicView}`
      : "",
    `능력 규칙(한계·대가·금기): ${world.powerSystem.limits} / ${world.powerSystem.costs} / ${world.powerSystem.taboos}`,
    `주요 장소: ${locations}`,
    `유저 진입: ${world.userEntry.allowedRoles.join("·")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function siblingSketches(briefs: PortfolioBriefInput[], excludeSlot: number): string[] {
  return briefs
    .filter((b) => b.slot !== excludeSlot)
    .map((b) => `${b.name}(${b.age}세 ${b.gender}, ${b.occupation}, ${b.archetype}, ${b.relationshipTrope})`);
}

function castList(briefs: PortfolioBriefInput[]): string[] {
  return briefs.map((b) => `${b.name} — ${b.occupation}(${b.faction})`);
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function stepWorld(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  let failed = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { bible, provenance, completion } = await generateOfficialWorldBible({
        transport: liveOfficialAuthorTransport,
        world: {
          genre: MANIFEST.genre,
          worldKey: MANIFEST.worldKey,
          styleKey: MANIFEST.styleKey,
          inspirationTropes: INSPIRATION_TROPES,
          slots: MANIFEST.slots,
          adultCandidates: MANIFEST.adultCandidates,
        },
        modelId,
        attempt,
      });
      track(report, completion, "world_bible", "world", attempt, failed);
      recordRun("world", "world_bible", provenance);
      writeJson(path.join(PILOT_DIR, "world-bible.json"), { bible, provenance });
      saveCost(report);
      console.log(`[pilot] world bible ok: ${bible.name} (attempt ${attempt})`);
      return;
    } catch (error) {
      failed += 1;
      console.warn(`[pilot] world attempt ${attempt} failed:`, (error as Error).message);
      if (attempt === maxAttempts) throw error;
    }
  }
}

type CharFile = {
  slot: number;
  draftKey: string;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
  appearance?: unknown;
  assetPlan?: unknown;
  provenances: OfficialAuthorProvenance[];
  charCount: number;
};

async function generateOneCharacter(
  brief: PortfolioBriefInput,
  world: OfficialWorldBible,
  siblings: PortfolioBriefInput[],
  modelId: string,
  maxAttempts: number,
  report: CostReport
): Promise<CharFile> {
  const draftKey = draftKeyFor(brief.slot);
  let failed = 0;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { bible, completions } = await generateOfficialCharacterBible({
        transport: liveOfficialAuthorTransport,
        part1: {
          brief,
          worldName: world.name,
          worldContext: worldContextForBrief(world, brief),
          siblingSketches: siblingSketches(siblings, brief.slot),
        },
        part2: {
          name: brief.name,
          age: brief.age,
          rpHook: brief.rpHook,
          adultCandidate: brief.adultCandidate,
          speechDirection: brief.speechDirection,
          castList: castList(siblings),
          npcDemand: "브리프 지정 없음. 필요한 경우만 1~2명.",
        },
        modelId,
      });
      const bibleQa = validatePilotBible(bible, { adultExpected: brief.adultCandidate });
      if (!bibleQa.ok) {
        throw new OfficialSupplyGateError(
          "author_bible_rejected",
          `slot ${brief.slot} bible QA: ${bibleQa.errors.map((e) => e.code).join(",")}`,
          bibleQa
        );
      }
      const draft = compileOfficialDraftFromBible(bible, {
        draftKey,
        worldKey: MANIFEST.worldKey,
        styleKey: MANIFEST.styleKey,
        genres: ["로맨스 판타지"],
        audience: brief.audience,
        hook: {
          archetype: brief.archetype,
          relationshipTrope: brief.relationshipTrope,
          occupation: brief.occupation,
          rpHook: brief.rpHook,
        },
      });
      const draftQa = validatePilotDraftForTextLock(draft, []);
      if (!draftQa.ok) {
        throw new OfficialSupplyGateError(
          "author_draft_rejected",
          `slot ${brief.slot} draft QA: ${draftQa.errors.map((e) => e.code).join(",")}`,
          draftQa
        );
      }
      const provenances = completions.map((completion, i) =>
        provenanceFor(completion, attempt * 10 + i)
      );
      track(report, completions[0]!, "character_bible_1", draftKey, attempt, failed);
      track(report, completions[1]!, "character_bible_2", draftKey, attempt, 0);
      recordRun(draftKey, "character_bible_1", provenances[0]!);
      recordRun(draftKey, "character_bible_2", provenances[1]!);
      const file: CharFile = {
        slot: brief.slot,
        draftKey,
        brief,
        bible,
        draft,
        provenances,
        charCount: officialSubstantiveCharCount(draft),
      };
      writeJson(charPath(brief.slot), file);
      console.log(`[pilot] slot ${brief.slot} ${brief.name} ok (${file.charCount} chars, attempt ${attempt})`);
      return file;
    } catch (error) {
      failed += 1;
      lastError = error;
      console.warn(`[pilot] slot ${brief.slot} attempt ${attempt} failed:`, (error as Error).message);
    }
  }
  writeJson(charPath(brief.slot), {
    slot: brief.slot,
    draftKey,
    brief,
    quarantined: true,
    error: String((lastError as Error)?.message ?? lastError).slice(0, 500),
  });
  throw lastError;
}

function readWorld(): OfficialWorldBible {
  return readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json")).bible;
}

function readChar(slot: number): CharFile {
  return readJson<CharFile>(charPath(slot));
}

async function stepCharacters(
  modelId: string,
  maxAttempts: number,
  concurrency: number,
  onlySlot?: number
): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  const slots = onlySlot ? [onlySlot] : world.portfolio.map((b) => b.slot);
  const briefs = world.portfolio.filter((b) => slots.includes(b.slot));
  await pool(briefs, concurrency, (brief) =>
    generateOneCharacter(brief, world, world.portfolio, modelId, maxAttempts, report)
  );
  saveCost(report);
}

function stepPortfolioQa(): void {
  const world = readWorld();
  const files = world.portfolio.map((b) => readChar(b.slot));
  const drafts = files.map((f) => {
    if (!f.draft) throw new Error(`slot ${f.slot} has no draft (quarantined?)`);
    return f.draft;
  });
  const diversity = evaluateWorldDiversity(drafts);
  console.log("[pilot] world-diversity errors:", diversity.errors.length);
  for (const e of diversity.errors) console.log(`  - ${e.code}: ${e.message}`);
  console.log("[pilot] world-diversity warnings:", diversity.warnings.length);
  for (const w of diversity.warnings) console.log(`  ~ ${w.code}: ${w.message}`);
  const snapshot = readJson<{ signals: { source: string; scenarioHook?: string; worldMechanic?: string }[] }>(
    SNAPSHOT_PATH
  );
  const corpus = snapshot.signals.map((s) => ({
    source: s.source,
    phrases: s.scenarioHook ? [s.scenarioHook] : [],
    terms: s.worldMechanic ? [s.worldMechanic] : [],
  }));
  for (const draft of drafts) {
    const qa = evaluateOriginality(draft, corpus, []);
    if (!qa.ok) {
      console.log(`[pilot] originality FAIL ${draft.draftKey}:`, qa.errors.map((e) => `${e.code} ${e.message}`));
    }
  }
  const lorebook = validatePilotLorebook(world.lorebook, drafts);
  console.log("[pilot] lorebook ok:", lorebook.ok, lorebook.errors.map((e) => e.code));
  const balance = evaluatePortfolioBalance(
    drafts.map((d) => ({
      draftKey: d.draftKey,
      primaryGenre: "로맨스 판타지" as const,
      nsfw: d.adult.nsfw,
    })),
    MANIFEST.portfolioPolicy
  );
  console.log("[pilot] portfolio balance ok:", balance.ok, balance.errors.map((e) => e.code));
  console.log("[pilot] lengths:", drafts.map((d) => `${d.draftKey}=${officialSubstantiveCharCount(d)}`).join(" "));
}

async function stepAppearance(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  const looks: string[] = [];
  for (const brief of world.portfolio) {
    const file = readChar(brief.slot);
    if (!file.bible) throw new Error(`slot ${brief.slot} has no bible`);
    const appearanceSource = [
      `얼굴: ${file.bible.appearance.faceShape}, ${file.bible.appearance.eyes}(${file.bible.appearance.eyeColor})`,
      `머리: ${file.bible.appearance.hairColor} ${file.bible.appearance.hairstyle}(${file.bible.appearance.hairLength})`,
      `키/체형: ${file.bible.identity.heightCm}cm ${file.bible.appearance.build}, ${file.bible.appearance.skin}`,
      `특징: ${file.bible.appearance.distinguishingFeatures}`,
      `의상: ${file.bible.appearance.defaultOutfit}, ${file.bible.appearance.accessories}`,
      `인상: ${file.bible.appearance.impression}`,
    ].join("\n");
    let failed = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { lock, completion } = await generateOfficialAppearanceLock({
          transport: liveOfficialAuthorTransport,
          appearance: {
            name: file.bible.identity.name,
            age: file.bible.identity.age,
            gender: file.bible.identity.gender,
            appearanceSource,
            siblingLooks: [...looks],
          },
          modelId,
        });
        const qa = validatePilotAppearance(file.draft, lock);
        if (!qa.ok) throw new OfficialSupplyGateError("author_appearance_rejected", qa.errors.map((e) => e.code).join(","), qa);
        track(report, completion, "appearance", file.draftKey, attempt, failed);
        recordRun(file.draftKey, "appearance", provenanceFor(completion, attempt));
        looks.push(
          `${file.bible.identity.name}: ${lock.identity.hairColor} ${lock.identity.hairLength}, ${lock.identity.eyeColor}, ${lock.identity.heightCm}cm`
        );
        writeJson(charPath(brief.slot), { ...file, appearance: lock });
        console.log(`[pilot] appearance slot ${brief.slot} ok (attempt ${attempt})`);
        break;
      } catch (error) {
        failed += 1;
        console.warn(`[pilot] appearance slot ${brief.slot} attempt ${attempt} failed:`, (error as Error).message);
        if (attempt === maxAttempts) throw error;
      }
    }
  }
  saveCost(report);
}

async function stepAssetPlans(modelId: string, maxAttempts: number, concurrency: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  await pool(world.portfolio, concurrency, async (brief) => {
    const file = readChar(brief.slot);
    if (!file.bible || !file.draft) throw new Error(`slot ${brief.slot} has no bible/draft`);
    const meaningfulPlaces = world.locations.slice(0, 6).map((l) => `${l.name}: ${l.rpEvents}`);
    let failed = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { plan, completion } = await generateOfficialAssetPlan({
          transport: liveOfficialAuthorTransport,
          plan: {
            name: file.bible.identity.name,
            adult: file.draft.adult.nsfw,
            meaningfulPlaces,
            defaultOutfit: file.bible.appearance.defaultOutfit,
          },
          modelId,
        });
        const qa = validatePilotAssetPlan(file.draft, plan);
        if (!qa.ok) throw new OfficialSupplyGateError("author_plan_rejected", qa.errors.map((e) => e.code).join(","), qa);
        track(report, completion, "asset_plan", file.draftKey, attempt, failed);
        recordRun(file.draftKey, "asset_plan", provenanceFor(completion, attempt));
        writeJson(charPath(brief.slot), { ...file, assetPlan: plan });
        console.log(`[pilot] assetplan slot ${brief.slot} ok (attempt ${attempt})`);
        return;
      } catch (error) {
        failed += 1;
        console.warn(`[pilot] assetplan slot ${brief.slot} attempt ${attempt} failed:`, (error as Error).message);
        if (attempt === maxAttempts) throw error;
      }
    }
  });
  saveCost(report);
}

async function stepStyles(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  let failed = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { candidates, completion } = await generateOfficialStyleBoard({
        transport: liveOfficialAuthorTransport,
        board: { genre: MANIFEST.genre, allowedReferenceUrls: REFERENCE_URLS, candidateCount: 4 },
        modelId,
      });
      track(report, completion, "style_board", null, attempt, failed);
      recordRun("style", "style_board", provenanceFor(completion, attempt));
      writeJson(path.join(PILOT_DIR, "style-candidates.json"), {
        styleKey: MANIFEST.styleKey,
        genre: MANIFEST.genre,
        stage: "candidates_proposed",
        candidates,
        provenance: provenanceFor(completion, attempt),
        note: "사용자 선택 전. candidate_approved/style_locked로 자동 진행하지 않는다.",
      });
      saveCost(report);
      console.log(`[pilot] style board ok: ${candidates.length} candidates (attempt ${attempt})`);
      return;
    } catch (error) {
      failed += 1;
      console.warn(`[pilot] styles attempt ${attempt} failed:`, (error as Error).message);
      if (attempt === maxAttempts) throw error;
    }
  }
}

function parseArgs(): { step: string; slot?: number; concurrency: number; maxAttempts: number } {
  const args = process.argv.slice(2);
  const get = (key: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit?.slice(key.length + 3);
  };
  return {
    step: get("step") ?? "all",
    slot: get("slot") ? Number(get("slot")) : undefined,
    concurrency: Number(get("concurrency") ?? 3),
    maxAttempts: Number(get("attempts") ?? 3),
  };
}

async function main(): Promise<void> {
  if (process.env.OFFICIAL_PILOT_LIVE !== "1") {
    console.error("[pilot] refusing: set OFFICIAL_PILOT_LIVE=1 to run live provider generation.");
    process.exit(2);
  }
  ensureDirs();
  writeJson(path.join(PILOT_DIR, "manifest.json"), MANIFEST);
  const { step, slot, concurrency, maxAttempts } = parseArgs();
  const modelId = resolveOfficialAuthorModelId();
  console.log(`[pilot] step=${step} model=${modelId} concurrency=${concurrency} attempts=${maxAttempts}`);
  if (step === "world" || step === "all") await stepWorld(modelId, maxAttempts);
  if (step === "characters" || step === "all") await stepCharacters(modelId, maxAttempts, concurrency);
  if (step === "character") {
    if (!slot) throw new Error("--step character requires --slot=N");
    await stepCharacters(modelId, maxAttempts, 1, slot);
  }
  if (step === "portfolio-qa" || step === "all") stepPortfolioQa();
  if (step === "appearance" || step === "all") await stepAppearance(modelId, maxAttempts);
  if (step === "assetplan" || step === "all") await stepAssetPlans(modelId, maxAttempts, concurrency);
  if (step === "styles" || step === "all") await stepStyles(modelId, maxAttempts);
  console.log("[pilot] done.");
}

main().catch((error) => {
  console.error("[pilot] fatal:", (error as Error).stack ?? error);
  process.exit(1);
});
