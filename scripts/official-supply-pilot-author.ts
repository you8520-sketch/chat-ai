/**
 * Manual production pilot author for official romance-fantasy supply.
 *
 * MANUAL ONLY: requires OFFICIAL_PILOT_LIVE=1. Never imported by tests.
 * Text calls only — image generation, user billing/points, creator rewards,
 * staging, and publishing are all out of scope here and never imported below.
 *
 * Usage (node --conditions=react-server --import tsx scripts/official-supply-pilot-author.ts ...):
 *   --step=world | characters | character --slot=N | portfolio-qa | appearance
 *   --step=assetplan [--slot=N]   character-specific, portfolio-aware scene planning (sequential)
 *   --step=voice-fix              re-author only contract-failing voice fields
 *   --step=adult-fix              re-author only adultSection toward the manifest adult plan
 *   --step=styles
 *   --step=cost-reconcile         summarize the canonical ledger into cost.json
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
  createAuthorCostReport,
  generateOfficialAppearanceLock,
  generateOfficialAssetPlan,
  generateOfficialCharacterBible,
  generateOfficialStyleBoard,
  generateOfficialWorldBible,
  liveOfficialAuthorTransport,
  OFFICIAL_AUTHOR_REQUEST_KIND,
  provenanceFor,
  recordAuthorRun,
  recordWorkflowRetry,
  resolveOfficialAuthorModelId,
  reviseOfficialAdultProfile,
  reviseOfficialCharacterVoice,
  validatePilotAppearance,
  validatePilotAssetPlan,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
  withAuthorAccounting,
  OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  type OfficialAuthorCostReport,
  type OfficialAuthorProvenance,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
  type OfficialVoiceRevisionField,
} from "@/lib/officialSupply/author";
import type { AdultProfilePlan, OfficialAuthorTask, PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import {
  ADULT_DYNAMICS,
  compileOfficialDraftFromBible,
  evaluateAdultPortfolioDiversity,
  evaluateAuthorQualityContract,
  extractAdultDynamics,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import { clearQuarantine, writeQuarantine } from "@/lib/officialSupply/pilotArtifacts";
import { evaluatePortfolioBalance } from "@/lib/officialSupply/research";
import {
  buildSceneAvoidList,
  evaluateSceneCandidateAgainstPortfolio,
  evaluateScenePortfolioDiversity,
  resolveOfficialCharacterSceneContext,
  type OfficialCharacterSceneContext,
  type ScenePortfolioEntry,
} from "@/lib/officialSupply/scenePortfolio";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { officialSubstantiveCharCount } from "@/lib/officialSupply/characterText";
import { evaluateOriginality, evaluateWorldDiversity } from "@/lib/officialSupply/worldQa";
import type { OfficialAppearanceLock, OfficialAssetPlan, OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const CHAR_DIR = path.join(PILOT_DIR, "characters");
const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "docs/official-supply/market-research-snapshot-2026-09.json"
);

/**
 * Pilot-scoped adult direction (manifest config — not a global ratio).
 * Chosen per character fit from each committed bible.
 */
const ADULT_PLAN: Record<string, AdultProfilePlan> = {
  // Frail, formal heir who asks before acting; leans on the user yet hides it.
  "pilot-rf-01": {
    dialogueProfile: "suggestive",
    consentModes: ["standard"],
    direction: "의례처럼 허락을 구하는 친밀함, 병약함에서 오는 의존과 취약함을 드러내는 순간, 달빛·잎맥 비유의 속삭임",
  },
  // Command-and-report discipline already canon; power play fits when negotiated.
  "pilot-rf-02": {
    dialogueProfile: "explicit_rare",
    consentModes: ["standard", "power_play"],
    direction: "사전에 협상된 권력 교환(명령·보고 역할극), 규칙을 지킨 상대에 대한 짧고 무거운 인정, 끝난 뒤 체온·물·상처를 확인하는 사후 돌봄",
  },
  // Controlled inspector: tension comes from her own rules bending, not from dominance.
  "pilot-rf-06": {
    dialogueProfile: "suggestive",
    consentModes: ["standard"],
    direction: "규율을 스스로 깨는 순간의 긴장, 합의된 보호적 독점욕(질투를 감추지 않되 선택을 빼앗지 않음), 감찰관식 질문으로 쌓이는 언어적 긴장",
  },
  // Loud, sensual, competitive commander.
  "pilot-rf-07": {
    dialogueProfile: "explicit_frequent",
    consentModes: ["standard", "power_play"],
    direction: "결투처럼 주도권을 뺏고 빼앗기는 라이벌 긴장, 호탕한 도발과 장난, 상대의 실력을 대놓고 칭찬하는 인정",
  },
};

const MANIFEST = {
  batchKey: "pilot-romance-fantasy-01",
  worldKey: "pilot-rf-erendel",
  styleKey: "romance_fantasy_v1",
  genre: "로맨스 판타지",
  slots: 10,
  adultCandidates: 4,
  genderMix: "남성 5명, 여성 4명, 기타 1명",
  slotGenders: ["male", "male", "male", "male", "male", "female", "female", "female", "female", "other"] as (
    | "male"
    | "female"
    | "other"
  )[],
  templateVersion: OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  snapshotVersion: OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  portfolioPolicy: { adultShareMin: 0.3, adultShareMax: 0.5, maxGenreShare: 1, minDistinctGenres: 1 },
  adultPlan: ADULT_PLAN,
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

// ── Cost report (reporting artifact over the canonical ledger) ──────────────

type LegacyLedgerSummary = {
  source: string;
  ledgerCutoff: string;
  successfulCompletions: number;
  billedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  failedProviderAttempts: { tracked: false; lowerBoundFromSurvivingLogs: number };
  v1ReportedButIncomplete: { calls: number; costUsd: number };
};

type PilotCostFile = OfficialAuthorCostReport & {
  /** Everything before v2 physical-attempt accounting existed. */
  legacy?: LegacyLedgerSummary;
  ledgerCrossCheck?: { since: string; ledgerSuccessfulCompletions: number; ledgerBilledCostUsd: number };
};

const COST_FILE = path.join(PILOT_DIR, "cost.json");

function loadCost(): PilotCostFile {
  if (!fs.existsSync(COST_FILE)) return createAuthorCostReport();
  const raw = readJson<Partial<PilotCostFile> & { version?: number }>(COST_FILE);
  if (raw.version !== 2) {
    throw new Error("cost.json is v1 (per-success-line retries); run --step=cost-reconcile first");
  }
  return raw as PilotCostFile;
}

function saveCost(report: PilotCostFile): void {
  writeJson(COST_FILE, { ...report, imageCalls: 0 });
}

function ledgerTotals(sinceExclusive?: string): {
  count: number;
  cost: number;
  input: number;
  output: number;
  last: string;
} {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(actual_cost_usd), 0) AS cost,
              COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(MAX(created_at), '') AS last
       FROM api_cost_ledger
       WHERE request_kind = ? AND (? IS NULL OR created_at > ?)`
    )
    .get(OFFICIAL_AUTHOR_REQUEST_KIND, sinceExclusive ?? null, sinceExclusive ?? null) as {
    count: number;
    cost: number;
    input: number;
    output: number;
    last: string;
  };
  return row;
}

/**
 * Canonical ledger is the source of truth. v1 cost.json only kept the
 * final-attempt lines (QA-rejected but billed completions were missing), so
 * the pre-v2 period is summarized straight from `api_cost_ledger`.
 */
function stepCostReconcile(): void {
  const current = fs.existsSync(COST_FILE) ? readJson<Record<string, unknown>>(COST_FILE) : {};
  if (current.version === 2) {
    const report = current as unknown as PilotCostFile;
    if (!report.legacy) throw new Error("v2 cost.json without legacy cutoff");
    const since = ledgerTotals(report.legacy.ledgerCutoff);
    report.ledgerCrossCheck = {
      since: report.legacy.ledgerCutoff,
      ledgerSuccessfulCompletions: since.count,
      ledgerBilledCostUsd: Math.round(since.cost * 1e6) / 1e6,
    };
    saveCost(report);
    console.log(
      `[pilot] cross-check since ${report.legacy.ledgerCutoff}: ledger ${since.count} / $${since.cost.toFixed(6)}; ` +
        `report ${report.successfulCompletions} success / $${report.billedCostUsd.toFixed(6)}`
    );
    return;
  }
  const totals = ledgerTotals();
  const logDir = "/tmp";
  let failedLower = 0;
  for (const file of fs.existsSync(logDir) ? fs.readdirSync(logDir) : []) {
    if (!/^pilot-.+\.log$/.test(file)) continue;
    const text = fs.readFileSync(path.join(logDir, file), "utf8");
    failedLower += (text.match(/attempt \d+ failed: (CheaperInference 5\d\d|The operation was aborted|fetch failed)/g) ?? []).length;
  }
  const v1 = current as { calls?: number; costUsd?: number };
  const report: PilotCostFile = {
    ...createAuthorCostReport(),
    legacy: {
      source: `api_cost_ledger request_kind=${OFFICIAL_AUTHOR_REQUEST_KIND} (successful provider completions only)`,
      ledgerCutoff: totals.last,
      successfulCompletions: totals.count,
      billedCostUsd: Math.round(totals.cost * 1e6) / 1e6,
      inputTokens: totals.input,
      outputTokens: totals.output,
      failedProviderAttempts: { tracked: false, lowerBoundFromSurvivingLogs: failedLower },
      v1ReportedButIncomplete: { calls: Number(v1.calls ?? 0), costUsd: Math.round(Number(v1.costUsd ?? 0) * 1e6) / 1e6 },
    },
  };
  saveCost(report);
  console.log(`[pilot] legacy baseline from ledger: ${totals.count} completions / $${totals.cost.toFixed(6)} (cutoff ${totals.last})`);
}

function recordRun(draftKey: string, task: OfficialAuthorTask, provenance: OfficialAuthorProvenance): void {
  try {
    recordAuthorRun(getDb(), { draftKey, task, provenance });
  } catch (error) {
    console.warn(`[pilot] author-run ledger skipped for ${draftKey}/${task}:`, (error as Error).message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One workflow step with bounded retries. Each attempt gets its own
 * accounting transport, so a retry is counted once per step (not per line)
 * and every physical provider call is recorded exactly once.
 */
async function runWorkflowStep<T>(input: {
  report: PilotCostFile;
  draftKey: string | null;
  label: string;
  maxAttempts: number;
  quarantineKey: string;
  run: (transport: OfficialAuthorTransport, attempt: number, feedback: string | undefined) => Promise<T>;
}): Promise<T> {
  let feedback: string | undefined;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    if (attempt > 1) recordWorkflowRetry(input.report);
    const transport = withAuthorAccounting(liveOfficialAuthorTransport, input.report, {
      draftKey: input.draftKey,
      workflowAttempt: attempt,
    });
    try {
      const out = await input.run(transport, attempt, feedback);
      clearQuarantine(PILOT_DIR, input.quarantineKey);
      saveCost(input.report);
      return out;
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message ?? error);
      // Provider errors carry no content signal; QA rejections become next-attempt feedback.
      if (!/CheaperInference 5\d\d|aborted|fetch failed/.test(message)) feedback = message.slice(0, 800);
      console.warn(`[pilot] ${input.label} attempt ${attempt} failed:`, message.slice(0, 300));
      saveCost(input.report);
      if (attempt < input.maxAttempts) await sleep(8000 * attempt);
    }
  }
  writeQuarantine(PILOT_DIR, input.quarantineKey, lastError);
  throw lastError;
}

// ── World / characters (unchanged generation order) ──────────────────────────

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
  await runWorkflowStep({
    report,
    draftKey: "world",
    label: "world",
    maxAttempts,
    quarantineKey: "world",
    run: async (transport, attempt) => {
      const { bible, provenances } = await generateOfficialWorldBible({
        transport,
        world: {
          genre: MANIFEST.genre,
          worldKey: MANIFEST.worldKey,
          styleKey: MANIFEST.styleKey,
          inspirationTropes: INSPIRATION_TROPES,
          slots: MANIFEST.slots,
          adultCandidates: MANIFEST.adultCandidates,
          genderMix: MANIFEST.genderMix,
          slotGenders: MANIFEST.slotGenders,
        },
        modelId,
        attempt,
      });
      for (const provenance of provenances) recordRun("world", "world_bible", provenance);
      writeJson(path.join(PILOT_DIR, "world-bible.json"), { bible, provenances });
      console.log(`[pilot] world bible ok: ${bible.name} (attempt ${attempt})`);
    },
  });
}

type CharRevision = {
  step: "voice-fix" | "adult-fix" | "assetplan";
  fields: string[];
  reasons: string[];
  at: string;
  provenance: OfficialAuthorProvenance;
};

type CharFile = {
  slot: number;
  draftKey: string;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
  appearance?: OfficialAppearanceLock;
  assetPlan?: OfficialAssetPlan;
  sceneContext?: OfficialCharacterSceneContext;
  provenances: OfficialAuthorProvenance[];
  revisions?: CharRevision[];
  charCount: number;
  quarantined?: boolean;
};

function compileForBrief(bible: OfficialCharacterBible, brief: PortfolioBriefInput): OfficialCharacterDraft {
  return compileOfficialDraftFromBible(bible, {
    draftKey: draftKeyFor(brief.slot),
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
}

function assertBibleAndDraft(bible: OfficialCharacterBible, brief: PortfolioBriefInput): OfficialCharacterDraft {
  const bibleQa = validatePilotBible(bible, { adultExpected: brief.adultCandidate });
  if (!bibleQa.ok) {
    throw new OfficialSupplyGateError(
      "author_bible_rejected",
      `slot ${brief.slot} bible QA: ${bibleQa.errors.map((e) => `${e.code}(${e.message})`).join("; ")}`,
      bibleQa
    );
  }
  const draft = compileForBrief(bible, brief);
  const draftQa = validatePilotDraftForTextLock(draft, []);
  if (!draftQa.ok) {
    throw new OfficialSupplyGateError(
      "author_draft_rejected",
      `slot ${brief.slot} draft QA: ${draftQa.errors.map((e) => `${e.code}(${e.message})`).join("; ")}`,
      draftQa
    );
  }
  return draft;
}

async function generateOneCharacter(
  brief: PortfolioBriefInput,
  world: OfficialWorldBible,
  siblings: PortfolioBriefInput[],
  modelId: string,
  maxAttempts: number,
  report: PilotCostFile
): Promise<CharFile> {
  const draftKey = draftKeyFor(brief.slot);
  return runWorkflowStep({
    report,
    draftKey,
    label: `slot ${brief.slot}`,
    maxAttempts,
    quarantineKey: `character-${draftKey}`,
    run: async (transport, attempt, feedback) => {
      const { bible, completions } = await generateOfficialCharacterBible({
        transport,
        part1: {
          brief,
          worldName: world.name,
          worldContext: worldContextForBrief(world, brief),
          siblingSketches: siblingSketches(siblings, brief.slot),
          feedback,
        },
        voice: {
          name: brief.name,
          age: brief.age,
          adultCandidate: brief.adultCandidate,
          speechDirection: brief.speechDirection,
          npcDemand: "특별한 이유가 없으면 1~2명을 만든다. 0명은 기존 관계망만으로 충분할 때만 허용.",
          feedback,
        },
        bonds: {
          name: brief.name,
          age: brief.age,
          rpHook: brief.rpHook,
          adultCandidate: brief.adultCandidate,
          castList: castList(siblings),
          feedback,
        },
        modelId,
      });
      const draft = assertBibleAndDraft(bible, brief);
      const provenances = completions.map((completion, i) => provenanceFor(completion, attempt * 10 + i));
      const tasks: OfficialAuthorTask[] = ["character_bible_1", "character_bible_voice", "character_bible_bonds"];
      provenances.forEach((p, i) => recordRun(draftKey, tasks[i]!, p));
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
    },
  });
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
  const briefs = world.portfolio.filter((b) => (onlySlot ? b.slot === onlySlot : true));
  const pending = briefs.filter((brief) => {
    if (onlySlot) return true;
    try {
      const existing = readChar(brief.slot);
      if (existing && !existing.quarantined && existing.draft && existing.bible) {
        console.log(`[pilot] slot ${brief.slot} already complete — skipping`);
        return false;
      }
    } catch {
      // missing file → generate
    }
    return true;
  });
  // Per-slot isolation: one quarantine must not abort sibling slots.
  const results = await pool(pending, concurrency, async (brief) => {
    try {
      await generateOneCharacter(brief, world, world.portfolio, modelId, maxAttempts, report);
      return { slot: brief.slot, ok: true as const };
    } catch (error) {
      return { slot: brief.slot, ok: false as const, error: String((error as Error)?.message ?? error) };
    }
  });
  const failedSlots = results.filter((r) => !r.ok);
  if (failedSlots.length > 0) throw new Error(`quarantined slots: ${failedSlots.map((r) => r.slot).join(",")}`);
}

function sceneEntries(world: OfficialWorldBible, files: CharFile[]): ScenePortfolioEntry[] {
  return files
    .filter((f) => f.assetPlan)
    .map((f) => ({
      draftKey: f.draftKey,
      name: f.bible.identity.name,
      plan: f.assetPlan!,
      context: f.sceneContext ?? resolveOfficialCharacterSceneContext({ world, bible: f.bible, brief: f.brief }),
    }));
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
    if (!qa.ok) console.log(`[pilot] originality FAIL ${draft.draftKey}:`, qa.errors.map((e) => `${e.code} ${e.message}`));
  }
  const lorebook = validatePilotLorebook(world.lorebook, drafts);
  console.log("[pilot] lorebook ok:", lorebook.ok, lorebook.errors.map((e) => e.code));
  const balance = evaluatePortfolioBalance(
    drafts.map((d) => ({ draftKey: d.draftKey, primaryGenre: "로맨스 판타지" as const, nsfw: d.adult.nsfw })),
    MANIFEST.portfolioPolicy
  );
  console.log("[pilot] portfolio balance ok:", balance.ok, balance.errors.map((e) => e.code));
  for (const file of files) {
    const contract = evaluateAuthorQualityContract(file.bible);
    if (!contract.ok) console.log(`[pilot] contract FAIL ${file.draftKey}:`, contract.errors.map((e) => e.code));
  }
  const adult = evaluateAdultPortfolioDiversity(files.map((f) => f.bible));
  console.log("[pilot] adult portfolio ok:", adult.ok, adult.errors.map((e) => e.message), adult.warnings.map((w) => w.message));
  const scenes = evaluateScenePortfolioDiversity(sceneEntries(world, files), world.locations);
  console.log("[pilot] scene portfolio ok:", scenes.ok);
  for (const e of scenes.errors) console.log(`  - ${e.code}: ${e.message}`);
  for (const w of scenes.warnings) console.log(`  ~ ${w.code}: ${w.message}`);
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
    await runWorkflowStep({
      report,
      draftKey: file.draftKey,
      label: `appearance slot ${brief.slot}`,
      maxAttempts,
      quarantineKey: `appearance-${file.draftKey}`,
      run: async (transport, attempt) => {
        const { lock, completion } = await generateOfficialAppearanceLock({
          transport,
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
        recordRun(file.draftKey, "appearance", provenanceFor(completion, attempt));
        looks.push(
          `${file.bible.identity.name}: ${lock.identity.hairColor} ${lock.identity.hairLength}, ${lock.identity.eyeColor}, ${lock.identity.heightCm}cm`
        );
        writeJson(charPath(brief.slot), { ...file, appearance: lock });
        console.log(`[pilot] appearance slot ${brief.slot} ok (attempt ${attempt})`);
      },
    });
  }
}

// ── Scene planning (character-specific, portfolio-aware, sequential) ─────────

async function planOneCharacterScenes(input: {
  file: CharFile;
  world: OfficialWorldBible;
  planned: ScenePortfolioEntry[];
  modelId: string;
  maxAttempts: number;
  report: PilotCostFile;
  extraFeedback?: string;
}): Promise<CharFile> {
  const { file, world, planned } = input;
  const context = resolveOfficialCharacterSceneContext({ world, bible: file.bible, brief: file.brief });
  return runWorkflowStep({
    report: input.report,
    draftKey: file.draftKey,
    label: `assetplan slot ${file.slot}`,
    maxAttempts: input.maxAttempts,
    quarantineKey: `assetplan-${file.draftKey}`,
    run: async (transport, attempt, feedback) => {
      const avoid = buildSceneAvoidList(planned, world.locations);
      const { plan, completion } = await generateOfficialAssetPlan({
        transport,
        plan: {
          name: file.bible.identity.name,
          adult: file.draft.adult.nsfw,
          defaultOutfit: file.bible.appearance.defaultOutfit,
          scene: context,
          avoid,
          feedback: [input.extraFeedback, feedback].filter(Boolean).join("\n") || undefined,
        },
        modelId: input.modelId,
      });
      const qa = validatePilotAssetPlan(file.draft, plan);
      if (!qa.ok) throw new OfficialSupplyGateError("author_plan_rejected", qa.errors.map((e) => e.code).join(","), qa);
      const candidate: ScenePortfolioEntry = { draftKey: file.draftKey, name: file.bible.identity.name, plan, context };
      const portfolioQa = evaluateSceneCandidateAgainstPortfolio(candidate, planned, world.locations);
      if (!portfolioQa.ok) {
        throw new OfficialSupplyGateError(
          "author_scene_portfolio_rejected",
          portfolioQa.errors.map((e) => `${e.code}: ${e.message}`).join("; "),
          portfolioQa
        );
      }
      const provenance = provenanceFor(completion, attempt);
      recordRun(file.draftKey, "asset_plan", provenance);
      const next: CharFile = {
        ...file,
        assetPlan: plan,
        sceneContext: context,
        revisions: [
          ...(file.revisions ?? []),
          { step: "assetplan", fields: ["assetPlan"], reasons: ["scene planner collapse (portfolio)"], at: provenance.createdAt, provenance },
        ],
      };
      writeJson(charPath(file.slot), next);
      console.log(`[pilot] assetplan slot ${file.slot} ok (attempt ${attempt})`);
      return next;
    },
  });
}

async function stepAssetPlans(modelId: string, maxAttempts: number, onlySlot?: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  const slots = world.portfolio.map((b) => b.slot);
  const targets = onlySlot ? [onlySlot] : slots;
  // Sequential: each character is planned against the scenes already chosen by its siblings.
  let files = slots.map((slot) => readChar(slot));
  for (const slot of targets) {
    const others = files.filter((f) => f.slot !== slot && (onlySlot || f.slot < slot));
    const planned = sceneEntries(world, others);
    const updated = await planOneCharacterScenes({
      file: files.find((f) => f.slot === slot)!,
      world,
      planned,
      modelId,
      maxAttempts,
      report,
    });
    files = files.map((f) => (f.slot === slot ? updated : f));
  }
  const qa = evaluateScenePortfolioDiversity(sceneEntries(world, files), world.locations);
  console.log("[pilot] scene portfolio ok:", qa.ok, qa.errors.map((e) => e.message));
  if (!qa.ok) throw new Error("scene portfolio QA failed — re-plan the offending slots with --step=assetplan --slot=N");
}

// ── Voice / adult minimal corrections ────────────────────────────────────────

function voiceFieldsFor(codes: string[]): OfficialVoiceRevisionField[] {
  const fields = new Set<OfficialVoiceRevisionField>();
  for (const code of codes) {
    if (code.startsWith("bible_greeting")) fields.add("greeting");
    if (code.startsWith("bible_pitch")) fields.add("publicDescription");
    if (code.startsWith("bible_speech")) fields.add("speech");
  }
  return [...fields];
}

async function stepVoiceFix(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  for (const brief of world.portfolio) {
    const file = readChar(brief.slot);
    const contract = evaluateAuthorQualityContract(file.bible);
    if (contract.ok) continue;
    const reasons = contract.errors.map((e) => `${e.code}: ${e.message}`);
    const fields = voiceFieldsFor(contract.errors.map((e) => e.code));
    console.log(`[pilot] voice-fix slot ${brief.slot}: ${fields.join(",")} ← ${reasons.join(" | ")}`);
    await runWorkflowStep({
      report,
      draftKey: file.draftKey,
      label: `voice-fix slot ${brief.slot}`,
      maxAttempts,
      quarantineKey: `voice-${file.draftKey}`,
      run: async (transport, attempt, feedback) => {
        const { bible, completion } = await reviseOfficialCharacterVoice({
          transport,
          bible: file.bible,
          voice: {
            name: brief.name,
            age: brief.age,
            adultCandidate: brief.adultCandidate,
            speechDirection: brief.speechDirection,
            npcDemand: "기존 NPC를 유지한다(새로 만들지 않는다).",
          },
          fields,
          reasons: [...reasons, ...(feedback ? [feedback] : [])],
          modelId,
        });
        const still = evaluateAuthorQualityContract(bible);
        if (!still.ok) throw new OfficialSupplyGateError("author_contract_rejected", still.errors.map((e) => `${e.code}: ${e.message}`).join("; "), still);
        const draft = assertBibleAndDraft(bible, brief);
        const provenance = provenanceFor(completion, attempt);
        recordRun(file.draftKey, "character_bible_voice", provenance);
        writeJson(charPath(brief.slot), {
          ...file,
          bible,
          draft,
          charCount: officialSubstantiveCharCount(draft),
          revisions: [...(file.revisions ?? []), { step: "voice-fix", fields, reasons, at: provenance.createdAt, provenance }],
        });
        console.log(`[pilot] voice-fix slot ${brief.slot} ok (attempt ${attempt})`);
      },
    });
  }
}

async function stepAdultFix(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  for (const brief of world.portfolio) {
    const draftKey = draftKeyFor(brief.slot);
    const plan = ADULT_PLAN[draftKey];
    if (!plan) continue;
    const file = readChar(brief.slot);
    if (file.draft.adult.nsfw !== true) throw new Error(`${draftKey} has an adult plan but is not an adult sheet`);
    const participantMinAge = file.draft.adult.participantMinAge;
    const siblingDynamics = world.portfolio
      .filter((b) => b.slot !== brief.slot && ADULT_PLAN[draftKeyFor(b.slot)])
      .map((b) => readChar(b.slot).bible)
      .filter((b) => b.adultSection)
      .flatMap((b) => extractAdultDynamics(b.adultSection!).map((d) => ADULT_DYNAMICS[d].label));
    await runWorkflowStep({
      report,
      draftKey,
      label: `adult-fix slot ${brief.slot}`,
      maxAttempts,
      quarantineKey: `adult-${draftKey}`,
      run: async (transport, attempt, feedback) => {
        const { bible, completion } = await reviseOfficialAdultProfile({
          transport,
          bible: file.bible,
          participantMinAge,
          plan,
          siblingDynamics: [...new Set(siblingDynamics)],
          feedback,
          modelId,
        });
        const draft = assertBibleAndDraft(bible, brief);
        if (draft.adult.nsfw !== true || draft.adult.participantMinAge !== participantMinAge) {
          throw new OfficialSupplyGateError("adult_contract_drift", "participantMinAge must not change");
        }
        const provenance = provenanceFor(completion, attempt);
        recordRun(draftKey, "adult_profile", provenance);
        writeJson(charPath(brief.slot), {
          ...file,
          bible,
          draft,
          charCount: officialSubstantiveCharCount(draft),
          revisions: [
            ...(file.revisions ?? []),
            { step: "adult-fix", fields: ["adultSection"], reasons: ["adult portfolio convergence (느린 신뢰·절제, all suggestive)"], at: provenance.createdAt, provenance },
          ],
        });
        console.log(`[pilot] adult-fix slot ${brief.slot} ok (attempt ${attempt})`);
      },
    });
  }
  const files = world.portfolio.map((b) => readChar(b.slot));
  const qa = evaluateAdultPortfolioDiversity(files.map((f) => f.bible));
  console.log("[pilot] adult portfolio ok:", qa.ok, qa.errors.map((e) => e.message), qa.warnings.map((w) => w.message));
  if (!qa.ok) throw new Error("adult portfolio diversity failed");
}

async function stepStyles(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  await runWorkflowStep({
    report,
    draftKey: null,
    label: "styles",
    maxAttempts,
    quarantineKey: "styles",
    run: async (transport, attempt) => {
      const { candidates, completion } = await generateOfficialStyleBoard({
        transport,
        board: { genre: MANIFEST.genre, styleKey: MANIFEST.styleKey, allowedReferenceUrls: REFERENCE_URLS, candidateCount: 4 },
        modelId,
      });
      const provenance = provenanceFor(completion as OfficialAuthorRawCompletion, attempt);
      recordRun("style", "style_board", provenance);
      writeJson(path.join(PILOT_DIR, "style-candidates.json"), {
        styleKey: MANIFEST.styleKey,
        genre: MANIFEST.genre,
        stage: "candidates_proposed",
        candidates,
        provenance,
        note: "사용자 선택 전. candidate_approved/style_locked로 자동 진행하지 않는다.",
      });
      console.log(`[pilot] style board ok: ${candidates.length} candidates (attempt ${attempt})`);
    },
  });
}

function parseArgs(): { step: string; slot?: number; concurrency: number; maxAttempts: number } {
  const args = process.argv.slice(2);
  const get = (key: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit?.slice(key.length + 3);
  };
  return {
    step: get("step") ?? "portfolio-qa",
    slot: get("slot") ? Number(get("slot")) : undefined,
    concurrency: Number(get("concurrency") ?? 2),
    maxAttempts: Number(get("attempts") ?? 3),
  };
}

async function main(): Promise<void> {
  const { step, slot, concurrency, maxAttempts } = parseArgs();
  const offline = step === "portfolio-qa" || step === "cost-reconcile";
  if (!offline && process.env.OFFICIAL_PILOT_LIVE !== "1") {
    console.error("[pilot] refusing: set OFFICIAL_PILOT_LIVE=1 to run live provider generation.");
    process.exit(2);
  }
  ensureDirs();
  writeJson(path.join(PILOT_DIR, "manifest.json"), MANIFEST);
  const modelId = resolveOfficialAuthorModelId();
  console.log(`[pilot] step=${step} model=${modelId} concurrency=${concurrency} attempts=${maxAttempts}`);
  switch (step) {
    case "world":
      return stepWorld(modelId, maxAttempts);
    case "characters":
      return stepCharacters(modelId, maxAttempts, concurrency);
    case "character":
      if (!slot) throw new Error("--step=character requires --slot=N");
      return stepCharacters(modelId, maxAttempts, 1, slot);
    case "portfolio-qa":
      return stepPortfolioQa();
    case "appearance":
      return stepAppearance(modelId, maxAttempts);
    case "assetplan":
      return stepAssetPlans(modelId, maxAttempts, slot);
    case "voice-fix":
      return stepVoiceFix(modelId, maxAttempts);
    case "adult-fix":
      return stepAdultFix(modelId, maxAttempts);
    case "styles":
      return stepStyles(modelId, maxAttempts);
    case "cost-reconcile":
      return stepCostReconcile();
    default:
      throw new Error(`unknown step ${step}`);
  }
}

main()
  .then(() => console.log("[pilot] done."))
  .catch((error) => {
    console.error("[pilot] fatal:", (error as Error).stack ?? error);
    process.exit(1);
  });
