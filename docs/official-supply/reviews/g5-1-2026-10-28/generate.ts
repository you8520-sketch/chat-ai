/**
 * G5-1 evidence author — two new NON-rofan characters through the canonical official
 * supply owners (world → brief gate → Part1/Voice/Bonds → voice repair → QA → compile).
 * No new runner path: only `generateOfficialWorldBible`, `generateOfficialPortfolioReplacement`,
 * `generateOfficialCharacterBible`, `reviseOfficialCharacterVoice` and the existing QA owners.
 * Writes nothing to pilot world files or the production DB. Text calls only with --run.
 *
 * node --conditions=react-server --import tsx docs/official-supply/reviews/g5-1-2026-10-28/generate.ts --estimate
 * node --conditions=react-server --import tsx .../generate.ts --dump-prompts   # offline prompt composition, no provider call
 * OFFICIAL_PILOT_LIVE=1 node --conditions=react-server --import tsx .../generate.ts --run [--max-krw=1000]
 *
 * Idempotent: every stage skips when its output already exists, so a rerun after a gate
 * failure never re-bills a finished stage. Every provider response (including responses
 * a later gate rejected, truncated ones and failures) is saved at the transport boundary
 * before anything parses it.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { loadEnvLocal } from "../../../../scripts/load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import type { CharacterGenre } from "@/lib/characterGenres";
import {
  createAuthorCostReport,
  generateOfficialCharacterBible,
  generateOfficialPortfolioReplacement,
  generateOfficialWorldBible,
  liveOfficialAuthorTransport,
  OfficialAuthorCallBudget,
  OfficialAuthorTruncatedError,
  resolveOfficialAuthorModelId,
  reviseOfficialCharacterVoice,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
  withAuthorAccounting,
  withOfficialAuthorCallBudget,
  type OfficialAuthorCostReport,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
  type OfficialVoiceRevisionField,
} from "@/lib/officialSupply/author";
import {
  buildCharacterBible1System,
  buildCharacterBible1User,
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
  buildCharacterVoiceSystem,
  buildCharacterVoiceUser,
  buildPortfolioReplacementUser,
  buildStyleBoardSystem,
  buildWorldAtlasUser,
  buildWorldBibleSystem,
  buildWorldCoreUser,
  buildWorldPortfolioUser,
  describeCastForPlanning,
  OFFICIAL_AUTHOR_MAX_TOKENS,
  type PortfolioBriefInput,
  type WorldBibleInput,
  type WorldMarketInput,
} from "@/lib/officialSupply/authorPrompts";
import {
  compileOfficialDraftFromBible,
  evaluateRelationBibleContract,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";
import {
  buildOfficialCharacterFormBody,
  composeOfficialSystemPrompt,
  computeTextLockHash,
} from "@/lib/officialSupply/characterText";
import {
  resolveOfficialAuthoringPlan,
  type OfficialAuthoringDirection,
  type OfficialAuthoringPlan,
} from "@/lib/officialSupply/genreProfile";
import {
  evaluateBriefCastFit,
  evaluateDiscoveryTags,
  formatMarketSignalLines,
  selectMarketSignals,
  type OfficialBatchMarketPolicy,
} from "@/lib/officialSupply/marketFit";
import { validateResearchSnapshot, type ResearchSnapshot } from "@/lib/officialSupply/research";
import { evaluateUserRelationPremise, officialUserRelationPremiseTexts } from "@/lib/officialSupply/userRelationStart";
import { evaluateInternalRegionConsistency, internalWorldRegions } from "@/lib/officialSupply/worldQa";
import { estimateTokens } from "@/lib/tokenEstimate";

const OUT_DIR = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
const ROOT = path.resolve(OUT_DIR, "../../../..");
const WORLD_PATH = path.join(ROOT, "src/lib/officialSupply/pilot/world-bible.json");
const MANIFEST_PATH = path.join(ROOT, "src/lib/officialSupply/pilot/manifest.json");
const SNAPSHOT_PATH = path.join(ROOT, "docs/official-supply/market-research-snapshot-2026-09.json");
const CAST_CONTEXT_DIR = path.join(OUT_DIR, "cast-context");
const RESPONSES_DIR = path.join(OUT_DIR, "provider-responses");

const KRW_PER_USD = 1500;
const UPPER_USD_PER_M_INPUT = 0.5;
const UPPER_USD_PER_M_OUTPUT = 1.0;
/** Issue budget: ideally ≤12 provider calls, hard cap 16 including voice repair. */
const CALL_CAP = 16;
const MAX_VOICE_REPAIRS = 2;
const DEFAULT_MAX_KRW = 1000;

type Spec = {
  key: string;
  genre: CharacterGenre;
  worldKey: string;
  styleKey: string;
  direction: OfficialAuthoringDirection;
  gender: "male" | "female" | "other";
  audience: PortfolioBriefInput["audience"];
  /** Plain-words planning intent for the portfolio call (batch of one). */
  castIntent: string;
  /** Slot direction used only if the first plan is rejected and re-planned once. */
  replanDirection: string;
};

const SPECS: readonly Spec[] = [
  {
    key: "g5-modern-comedy",
    genre: "현대/일상",
    worldKey: "g5-modern-daily-v1",
    styleKey: "modern_daily_v1",
    direction: { genre: "현대/일상", tone: "light", humor: "central", pacing: "dialogue", nameWordplay: "nickname" },
    gender: "female",
    audience: "all",
    castIntent:
      "전체 이용자 대상 현대 한국 일상 코미디 캐릭터 1명. 연애 구도 없이 이웃·동료·룸메이트처럼 일상에서 엮이는 관계. 별명이 붙은 인물.",
    replanDirection:
      "여성. 연애 구도 없는 가벼운 일상 코미디. 별명(괄호 별칭)에 행동으로 생긴 이유가 있다. 유지 캐릭터와 목표·첫 사건·말투·유저 역학·유머 방식이 겹치지 않게.",
  },
  {
    key: "g5-horror-dry",
    genre: "공포/추리",
    worldKey: "g5-horror-mystery-v1",
    styleKey: "horror_mystery_v1",
    direction: { genre: "공포/추리", tone: "dry", humor: "light", pacing: "narration" },
    gender: "male",
    audience: "all",
    castIntent:
      "전체 이용자 대상 건조한 블랙코미디 공포·추리 캐릭터 1명. 연애 구도 없이 의뢰인·목격자·동료로 엮이는 관계. 사건은 실제로 있고 유머는 건조하게.",
    replanDirection:
      "남성. 연애 구도 없는 건조한 블랙코미디 공포·추리. 사건을 스스로 움직이는 인물. 유지 캐릭터와 목표·첫 사건·말투·유저 역학·유머 방식이 겹치지 않게.",
  },
];

type Manifest = { marketPolicy: OfficialBatchMarketPolicy };

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function loadSnapshot(): ResearchSnapshot {
  const snapshot = readJson<ResearchSnapshot>(SNAPSHOT_PATH);
  const qa = validateResearchSnapshot(snapshot);
  if (!qa.ok) throw new Error(`snapshot invalid: ${qa.errors.map((e) => e.code).join(",")}`);
  return snapshot;
}

function policyFor(manifest: Manifest): OfficialBatchMarketPolicy {
  return {
    ...manifest.marketPolicy,
    marketRoleMix: { proven: { min: 0, max: 1 }, proven_twist: { min: 0, max: 1 }, experimental: { min: 0, max: 1 } },
  };
}

function marketInput(snapshot: ResearchSnapshot, policy: OfficialBatchMarketPolicy, plan: OfficialAuthoringPlan): WorldMarketInput {
  const selection = selectMarketSignals(snapshot, policy, plan.genre ?? "", { excludeRomanceLed: plan.profile.excludeRomanceLedSignals });
  return {
    targetLocale: policy.targetLocale,
    marketPriority: policy.marketPriority,
    signalLines: formatMarketSignalLines(selection),
    namingProfile: plan.namingProfile,
    marketRoleMix: policy.marketRoleMix,
    maxPrimaryTropeRepeat: policy.maxPrimaryTropeRepeat,
    coreTags: policy.coreTags,
  };
}

function worldInput(spec: Spec, market: WorldMarketInput, plan: OfficialAuthoringPlan): WorldBibleInput {
  return {
    genre: spec.genre,
    worldKey: spec.worldKey,
    styleKey: spec.styleKey,
    market,
    slots: 1,
    adultCandidates: 0,
    genderMix: spec.gender === "female" ? "여성 1명" : spec.gender === "male" ? "남성 1명" : "기타 1명",
    slotGenders: [spec.gender],
    castIntent: spec.castIntent,
    authoring: plan,
  };
}

/** Existing cast the new character must not play like: pilot portfolio + G3/G4 briefs (unmodified copies). */
function existingCast(): PortfolioBriefInput[] {
  const pilot = readJson<{ bible: OfficialWorldBible }>(WORLD_PATH).bible.portfolio;
  const extra = fs.existsSync(CAST_CONTEXT_DIR)
    ? fs
        .readdirSync(CAST_CONTEXT_DIR)
        .filter((f) => f.endsWith(".brief.json"))
        .sort()
        .map((f) => readJson<PortfolioBriefInput>(path.join(CAST_CONTEXT_DIR, f)))
    : [];
  return [...pilot, ...extra];
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
    brief.faction && faction ? `소속 세력 ${faction.name}: ${faction.purpose} / 일반 시선: ${faction.publicView}` : "",
    `능력 규칙(한계·대가·금기): ${world.powerSystem.limits} / ${world.powerSystem.costs} / ${world.powerSystem.taboos}`,
    `주요 장소: ${locations}`,
    `유저 진입: ${world.userEntry.allowedRoles.join("·")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function voiceFieldsFor(codes: string[]): OfficialVoiceRevisionField[] {
  const fields = new Set<OfficialVoiceRevisionField>();
  for (const code of codes) {
    if (code.startsWith("bible_greeting")) fields.add("greeting");
    if (code.startsWith("bible_pitch")) fields.add("publicDescription");
    if (code.startsWith("bible_speech")) fields.add("speech");
    if (code === "tag_bible_mismatch" || code === "bible_tags" || code === "tags_keyword_stuffing") fields.add("tags");
  }
  return [...fields];
}

// ── Transport boundary: save every provider response before anything parses it ──

type CallLedger = { next: number };

function existingCallCount(): number {
  if (!fs.existsSync(RESPONSES_DIR)) return 0;
  return fs.readdirSync(RESPONSES_DIR).filter((f) => /^\d+-.*\.json$/.test(f) && !f.endsWith(".prompt.json")).length;
}

function rawTapTransport(inner: OfficialAuthorTransport, ledger: CallLedger, specKey: string): OfficialAuthorTransport {
  return {
    label: inner.label,
    async completeJson(input) {
      const n = String(ledger.next++).padStart(2, "0");
      const stem = `${n}-${specKey}-${input.task}`;
      fs.mkdirSync(RESPONSES_DIR, { recursive: true });
      writeJson(path.join(RESPONSES_DIR, `${stem}.prompt.json`), { task: input.task, system: input.system, user: input.user });
      const save = (outcome: "ok" | "truncated" | "provider_failed", c: OfficialAuthorRawCompletion | null, error?: string) =>
        writeJson(path.join(RESPONSES_DIR, `${stem}.json`), {
          call: Number(n),
          specKey,
          task: input.task,
          outcome,
          model: c?.model ?? null,
          inputTokens: c?.inputTokens ?? null,
          outputTokens: c?.outputTokens ?? null,
          costUsd: c?.costUsd ?? null,
          providerRequestId: c?.providerRequestId ?? null,
          ...(error ? { error } : {}),
          text: c?.text ?? null,
        });
      try {
        const completion = await inner.completeJson(input);
        save("ok", completion);
        return completion;
      } catch (error) {
        if (error instanceof OfficialAuthorTruncatedError) save("truncated", error.completion, error.message);
        else save("provider_failed", null, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
}

type SavedCall = {
  call: number;
  specKey: string;
  task: string;
  outcome: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

function savedCalls(): SavedCall[] {
  if (!fs.existsSync(RESPONSES_DIR)) return [];
  return fs
    .readdirSync(RESPONSES_DIR)
    .filter((f) => /^\d+-.*\.json$/.test(f) && !f.endsWith(".prompt.json"))
    .sort()
    .map((f) => readJson<SavedCall>(path.join(RESPONSES_DIR, f)));
}

// ── Estimate ─────────────────────────────────────────────────────────────────

function estimate(): { expectedKrw: number; worstKrw: number } {
  const manifest = readJson<Manifest>(MANIFEST_PATH);
  const snapshot = loadSnapshot();
  const policy = policyFor(manifest);
  const cast = existingCast();
  let inputTokens = 0;
  let expectedOut = 0;
  let worstOut = 0;
  for (const spec of SPECS) {
    const plan = resolveOfficialAuthoringPlan(spec.direction);
    const market = marketInput(snapshot, policy, plan);
    const world = worldInput(spec, market, plan);
    const system = buildWorldBibleSystem(plan);
    const placeholderFactions = ["세력A", "세력B", "세력C", "세력D"];
    const placeholderLocations = ["장소A", "장소B", "장소C", "장소D", "장소E", "장소F"];
    inputTokens += estimateTokens(system + buildWorldCoreUser(world));
    inputTokens += estimateTokens(system + buildWorldAtlasUser({ worldName: "W", centralPremise: "P".repeat(60), factionNames: placeholderFactions }));
    inputTokens += estimateTokens(
      system +
        buildWorldPortfolioUser({
          worldName: "W",
          centralPremise: "P".repeat(60),
          factionNames: placeholderFactions,
          locationNames: placeholderLocations,
          slots: 1,
          adultCandidates: 0,
          genderMix: world.genderMix,
          slotGenders: world.slotGenders,
          market,
          castIntent: spec.castIntent,
          authoring: plan,
        })
    );
    expectedOut += 6500 + 4500 + 2500;
    worstOut += OFFICIAL_AUTHOR_MAX_TOKENS.world_bible * 3;
    const sketch = cast.slice(0, 14).map(describeCastForPlanning);
    inputTokens += estimateTokens(
      buildWorldBibleSystem(plan) +
        buildPortfolioReplacementUser({
          worldName: "W",
          centralPremise: "P".repeat(60),
          factionNames: placeholderFactions,
          locationNames: placeholderLocations,
          market,
          castIntent: spec.castIntent,
          keptSiblings: sketch,
          slots: [{ slot: 1, gender: spec.gender, adultCandidate: false, direction: spec.replanDirection }],
          feedback: "x".repeat(400),
          authoring: plan,
        })
    );
    worstOut += OFFICIAL_AUTHOR_MAX_TOKENS.world_bible;
    const brief = cast[0]!;
    const part1User = buildCharacterBible1User({ brief, worldName: "W", worldContext: "c".repeat(900), siblingSketches: [], authoring: plan });
    const recap = "r".repeat(3200);
    inputTokens += estimateTokens(buildCharacterBible1System(plan) + part1User);
    inputTokens += estimateTokens(
      buildCharacterVoiceSystem(true, plan) +
        buildCharacterVoiceUser({ name: "n", age: 30, adultCandidate: false, speechDirection: "s", part1Recap: recap, npcDemand: "0", publicContext: "c".repeat(1500), authoring: plan })
    );
    inputTokens += estimateTokens(
      buildCharacterBondsSystem() + buildCharacterBondsUser({ name: "n", age: 30, rpHook: "h", adultCandidate: false, castList: [], part1Recap: recap, authoring: plan })
    );
    expectedOut += 2894 + 2165 + 1783;
    worstOut +=
      OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_1 +
      OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_voice +
      OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_bonds +
      OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_voice * MAX_VOICE_REPAIRS;
    inputTokens += estimateTokens("x".repeat(9000)) * MAX_VOICE_REPAIRS;
  }
  const usd = (out: number, inMult: number) => ((inputTokens * inMult * UPPER_USD_PER_M_INPUT) + out * UPPER_USD_PER_M_OUTPUT) / 1e6;
  const expectedUsd = usd(expectedOut, 1);
  const worstUsd = usd(worstOut, 1.3);
  const payload = {
    model: resolveOfficialAuthorModelId(),
    gitSha: git("rev-parse HEAD"),
    priceAssumption: { usdPerMInput: UPPER_USD_PER_M_INPUT, usdPerMOutput: UPPER_USD_PER_M_OUTPUT, krwPerUsd: KRW_PER_USD, note: "conservative upper bound, not the billed rate" },
    callsExpected: SPECS.length * 6,
    callCap: CALL_CAP,
    inputTokensEstimated: inputTokens,
    expectedOutputTokens: expectedOut,
    worstOutputTokens: worstOut,
    expectedKrw: Math.round(expectedUsd * KRW_PER_USD),
    worstCaseKrw: Math.round(worstUsd * KRW_PER_USD),
  };
  console.log(JSON.stringify(payload, null, 2));
  return { expectedKrw: payload.expectedKrw, worstKrw: payload.worstCaseKrw };
}


// ── Offline prompt composition (no provider call) ────────────────────────────

const OFFLINE_PROFILES: readonly { name: string; genre: CharacterGenre; direction: OfficialAuthoringDirection }[] = [
  { name: "rofan-serious", genre: "로맨스 판타지", direction: { genre: "로맨스 판타지", tone: "serious", humor: "none" } },
  ...SPECS.map((s) => ({ name: s.key, genre: s.genre, direction: s.direction })),
];

function dumpPrompts(): void {
  const manifest = readJson<Manifest>(MANIFEST_PATH);
  const snapshot = loadSnapshot();
  const policy = policyFor(manifest);
  const cast = existingCast();
  const brief = cast[0]!;
  const dir = path.join(OUT_DIR, "offline-prompts");
  fs.mkdirSync(dir, { recursive: true });
  for (const profile of OFFLINE_PROFILES) {
    const plan = resolveOfficialAuthoringPlan(profile.direction);
    const market = marketInput(snapshot, policy, plan);
    const base = SPECS.find((s) => s.genre === profile.genre);
    const spec: Spec = base ?? {
      ...SPECS[0]!,
      genre: profile.genre,
      gender: "male",
      castIntent: "전체 이용자 대상 로맨스 판타지 캐릭터 1명. 진지한 관계 서사.",
      replanDirection: "남성. 진지한 로맨스 판타지 관계 서사.",
    };
    const world = worldInput(spec, market, plan);
    const sections: [string, string][] = [
      ["world_bible system", buildWorldBibleSystem(plan)],
      ["world core user", buildWorldCoreUser(world)],
      [
        "world portfolio user",
        buildWorldPortfolioUser({ worldName: "(세계명)", centralPremise: "(핵심 전제)", factionNames: ["(세력)"], locationNames: ["(장소)"], slots: 1, adultCandidates: 0, genderMix: world.genderMix, slotGenders: world.slotGenders, market, castIntent: spec.castIntent, authoring: plan }),
      ],
      [
        "portfolio replacement user",
        buildPortfolioReplacementUser({ worldName: "(세계명)", centralPremise: "(핵심 전제)", factionNames: ["(세력)"], locationNames: ["(장소)"], market, castIntent: spec.castIntent, keptSiblings: cast.slice(0, 2).map(describeCastForPlanning), slots: [{ slot: 1, gender: spec.gender, adultCandidate: false, direction: spec.replanDirection }], authoring: plan }),
      ],
      ["character_bible_1 system", buildCharacterBible1System(plan)],
      ["character_bible_1 user", buildCharacterBible1User({ brief, worldName: "(세계명)", worldContext: "(세계 맥락)", siblingSketches: [], authoring: plan })],
      ["character_bible_voice system", buildCharacterVoiceSystem(true, plan)],
      ["character_bible_voice user", buildCharacterVoiceUser({ name: brief.name, age: brief.age, adultCandidate: false, speechDirection: brief.speechDirection, part1Recap: "(Part1 요약)", npcDemand: "0명", authoring: plan })],
      ["character_bible_bonds user", buildCharacterBondsUser({ name: brief.name, age: brief.age, rpHook: brief.rpHook, adultCandidate: false, castList: [], part1Recap: "(Part1 요약)", authoring: plan })],
      ["style_board system", buildStyleBoardSystem(plan)],
    ];
    fs.writeFileSync(
      path.join(dir, `${profile.name}.md`),
      [`# ${profile.name} — 오프라인 프롬프트 조립 (provider 호출 없음)`, "", "```json", JSON.stringify({ direction: profile.direction, profile: plan.profile.key, namingProfile: plan.namingProfile }, null, 2), "```", "", ...sections.flatMap(([title, text]) => [`## ${title}`, "", "```text", text, "```", ""])].join("\n"),
      "utf8"
    );
  }
  console.log(`[g5-1] wrote ${OFFLINE_PROFILES.length} offline prompt files to ${path.relative(ROOT, dir)}`);
}

// ── Run ──────────────────────────────────────────────────────────────────────

type SpecResult = {
  spec: Spec;
  plan: OfficialAuthoringPlan;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
  briefAttempts: { source: string; errors: string[] }[];
  bibleQa: string[];
  tagQa: string[];
  draftQa: string[];
  relationQa: string[];
  lorebookQa: string[];
  voiceRepairs: number;
};

type RunContext = {
  snapshot: ResearchSnapshot;
  policy: OfficialBatchMarketPolicy;
  modelId: string;
  report: OfficialAuthorCostReport;
  budget: OfficialAuthorCallBudget;
  ledger: CallLedger;
};

function transportFor(ctx: RunContext, specKey: string): OfficialAuthorTransport {
  const tapped = rawTapTransport(liveOfficialAuthorTransport, ctx.ledger, specKey);
  const accounted = withAuthorAccounting(tapped, ctx.report, { draftKey: specKey, workflowAttempt: 1 });
  return withOfficialAuthorCallBudget(accounted, ctx.budget);
}

function gateBrief(
  brief: PortfolioBriefInput,
  world: OfficialWorldBible,
  cast: PortfolioBriefInput[],
  plan: OfficialAuthoringPlan,
  ctx: RunContext
): string[] {
  const errors = evaluateBriefCastFit({
    fresh: [brief],
    kept: cast,
    snapshot: ctx.snapshot,
    policy: ctx.policy,
    namingProfile: plan.namingProfile,
  }).errors;
  if (brief.age < 19) errors.push(`age ${brief.age} < 19`);
  errors.push(
    ...evaluateInternalRegionConsistency(JSON.stringify(brief), internalWorldRegions(world.regions)).errors.map((e) => `region ${e.code}`)
  );
  const premise = evaluateUserRelationPremise(brief.userRelation?.type ?? "free", officialUserRelationPremiseTexts(brief));
  if (!premise.ok) errors.push(...premise.errors.map((e) => `relation_premise: ${e.message}`));
  return errors;
}

async function runSpec(
  spec: Spec,
  ctx: RunContext,
  cast: PortfolioBriefInput[],
  siblings: PortfolioBriefInput[]
): Promise<SpecResult> {
  const dir = path.join(OUT_DIR, "candidates", spec.key);
  fs.mkdirSync(dir, { recursive: true });
  const plan = resolveOfficialAuthoringPlan(spec.direction);
  const transport = transportFor(ctx, spec.key);
  const market = marketInput(ctx.snapshot, ctx.policy, plan);
  writeJson(path.join(dir, "authoring-plan.json"), {
    direction: spec.direction,
    profileKey: plan.profile.key,
    namingProfile: plan.namingProfile,
    castIntent: spec.castIntent,
    excludeRomanceLedSignals: plan.profile.excludeRomanceLedSignals,
  });

  const worldPath = path.join(dir, "world-bible.json");
  if (!fs.existsSync(worldPath)) {
    const generated = await generateOfficialWorldBible({ transport, modelId: ctx.modelId, world: worldInput(spec, market, plan) });
    writeJson(worldPath, generated.bible);
  }
  const world = readJson<OfficialWorldBible>(worldPath);

  const briefPath = path.join(dir, "brief.json");
  const gatePath = path.join(dir, "brief-gate.json");
  if (!fs.existsSync(briefPath)) {
    const attempts: { source: string; errors: string[] }[] = [];
    let brief = world.portfolio[0]!;
    let errors = gateBrief(brief, world, cast, plan, ctx);
    attempts.push({ source: "world_portfolio", errors });
    if (errors.length) {
      writeJson(path.join(dir, "brief.first-plan.json"), brief);
      const replanned = await generateOfficialPortfolioReplacement({
        transport,
        modelId: ctx.modelId,
        replacement: {
          worldName: world.name,
          centralPremise: world.centralPremise,
          factionNames: world.factions.map((f) => f.name),
          locationNames: world.locations.map((l) => l.name),
          market,
          castIntent: spec.castIntent,
          keptSiblings: cast.map(describeCastForPlanning),
          slots: [{ slot: 1, gender: spec.gender, adultCandidate: false, direction: spec.replanDirection }],
          feedback: errors.join("; "),
          authoring: plan,
        },
      });
      brief = replanned.briefs[0]!;
      errors = gateBrief(brief, world, cast, plan, ctx);
      attempts.push({ source: "replacement", errors });
      writeJson(gatePath, attempts);
      if (errors.length) throw new Error(`${spec.key}: brief gate failed after the single replan: ${errors.join("; ")}`);
    }
    writeJson(gatePath, attempts);
    writeJson(briefPath, brief);
  }
  const brief = readJson<PortfolioBriefInput>(briefPath);
  const briefAttempts = readJson<{ source: string; errors: string[] }[]>(gatePath);

  const biblePath = path.join(dir, "bible.assembled.json");
  let bible: OfficialCharacterBible;
  let voiceRepairs = 0;
  if (fs.existsSync(biblePath)) {
    bible = readJson<OfficialCharacterBible>(biblePath);
    voiceRepairs = fs.readdirSync(RESPONSES_DIR).filter((f) => f.includes(`-${spec.key}-`) && f.endsWith("character_bible_voice.json")).length - 1;
  } else {
    const generated = await generateOfficialCharacterBible({
      transport,
      modelId: ctx.modelId,
      authoring: plan,
      part1: {
        brief,
        worldName: world.name,
        worldContext: worldContextForBrief(world, brief),
        siblingSketches: siblings.map(describeCastForPlanning),
      },
      voice: {
        name: brief.name,
        age: brief.age,
        adultCandidate: false,
        speechDirection: brief.speechDirection,
        npcDemand: "이야기에 반복 역할이 실제로 필요할 때만 1~2명. 필요 없으면 0명([]).",
        marketFit: brief.marketFit,
        userRelation: brief.userRelation,
      },
      bonds: {
        name: brief.name,
        age: brief.age,
        rpHook: brief.rpHook,
        adultCandidate: false,
        castList: [],
        userRelation: brief.userRelation,
      },
    });
    bible = generated.bible;
    for (let repair = 0; repair < MAX_VOICE_REPAIRS; repair += 1) {
      const bibleQa = validatePilotBible(bible, { adultExpected: false });
      const tagQa = evaluateDiscoveryTags({ tags: bible.publicProfile.tags, bible, hook: brief }, ctx.policy);
      const issues = [...bibleQa.errors, ...tagQa.errors];
      const fields = voiceFieldsFor(issues.map((e) => e.code));
      if (issues.length === 0 || fields.length === 0) break;
      const revised = await reviseOfficialCharacterVoice({
        transport,
        modelId: ctx.modelId,
        authoring: plan,
        bible,
        voice: {
          name: brief.name,
          age: brief.age,
          adultCandidate: false,
          speechDirection: brief.speechDirection,
          npcDemand: "없음",
          marketFit: brief.marketFit,
          userRelation: brief.userRelation,
        },
        fields,
        reasons: issues.map((e) => `${e.code}: ${e.message}`),
      });
      bible = revised.bible;
      voiceRepairs += 1;
    }
    writeJson(biblePath, bible);
  }

  const draft = compileOfficialDraftFromBible(bible, {
    draftKey: spec.key,
    worldKey: spec.worldKey,
    styleKey: spec.styleKey,
    genres: [spec.genre],
    audience: brief.audience,
    worldName: world.name,
    worldBible: world,
    hook: { archetype: brief.archetype, relationshipTrope: brief.relationshipTrope, occupation: brief.occupation, rpHook: brief.rpHook },
  });
  const fmt = (e: { code: string; message: string }) => `${e.code}: ${e.message}`;
  const result: SpecResult = {
    spec,
    plan,
    brief,
    bible,
    draft,
    briefAttempts,
    bibleQa: validatePilotBible(bible, { adultExpected: false }).errors.map(fmt),
    tagQa: evaluateDiscoveryTags({ tags: bible.publicProfile.tags, bible, hook: brief }, ctx.policy).errors.map(fmt),
    draftQa: validatePilotDraftForTextLock(draft, []).errors.map(fmt),
    relationQa: evaluateRelationBibleContract(bible).errors.map(fmt),
    lorebookQa: validatePilotLorebook(world.lorebook, [draft]).errors.map(fmt),
    voiceRepairs,
  };
  writeJson(path.join(dir, "draft.compiled.json"), draft);
  writeJson(path.join(dir, "preview-form.json"), buildOfficialCharacterFormBody({ draft, appearanceBlock: "", assets: [] }));
  fs.writeFileSync(path.join(dir, "system-prompt.txt"), composeOfficialSystemPrompt(draft) + "\n", "utf8");
  fs.writeFileSync(
    path.join(dir, "first-manuscript.md"),
    [
      `# ${brief.name} (${spec.key})`,
      "",
      `장르: ${spec.genre} · 문체 ${spec.direction.tone ?? "-"} · 유머 ${spec.direction.humor ?? "-"} · 전개 ${spec.direction.pacing ?? "-"} · 이름 ${spec.direction.nameWordplay ?? "-"} · 작명 ${plan.namingProfile}`,
      "",
      "## Greeting",
      bible.greeting,
      "",
      "## Public description (detailed)",
      bible.publicProfile.detailedDescription ?? bible.publicProfile.description,
      "",
      "## Creator comment",
      bible.publicProfile.creatorComment ?? draft.creatorComment ?? "",
      "",
      "## Speech examples",
      bible.speech.examples,
      "",
      `Text lock: ${computeTextLockHash(draft)}`,
    ].join("\n"),
    "utf8"
  );
  return result;
}

function promptComposition(): unknown[] {
  if (!fs.existsSync(RESPONSES_DIR)) return [];
  return fs
    .readdirSync(RESPONSES_DIR)
    .filter((f) => f.endsWith(".prompt.json"))
    .sort()
    .map((f) => {
      const p = readJson<{ task: string; system: string; user: string }>(path.join(RESPONSES_DIR, f));
      const userLines = p.user.split("\n");
      const at = userLines.findIndex((l) => l.startsWith("창작 방향("));
      const direction: string[] = [];
      if (at >= 0) for (let i = at + 1; i < userLines.length && userLines[i]!.startsWith("- "); i += 1) direction.push(userLines[i]!.slice(2));
      const openRelation = p.user.includes("유저와의 관계는 연애로 한정하지 않는다");
      return {
        file: f.replace(".prompt.json", ".json"),
        task: p.task,
        systemFirstLine: p.system.split("\n")[0],
        systemSha256: createHash("sha256").update(p.system).digest("hex").slice(0, 16),
        systemChars: p.system.length,
        userChars: p.user.length,
        directionLines: direction,
        openRelationLine: openRelation,
        mentionsRofanOnlyVocabulary: /황태자|기사단장|마탑주|북부 대공|냉미남|집착남|DOMESTIC ROFAN/.test(
          [p.system, ...userLines.filter((l) => !l.startsWith("- ["))].join("\n")
        ),
      };
    });
}

async function run(maxKrw: number): Promise<void> {
  if (process.env.OFFICIAL_PILOT_LIVE !== "1") throw new Error("OFFICIAL_PILOT_LIVE=1 required");
  const sourceDirty = git("status --porcelain -- src scripts").length > 0;
  if (sourceDirty) throw new Error("src/ or scripts/ has uncommitted changes; commit code before the live run so the SHA is exact");
  const { expectedKrw, worstKrw } = estimate();
  if (expectedKrw >= maxKrw) throw new Error(`expected ₩${expectedKrw} ≥ ₩${maxKrw}: STOP`);
  if (worstKrw >= maxKrw) throw new Error(`worst-case ₩${worstKrw} ≥ ₩${maxKrw}: STOP`);

  const already = existingCallCount();
  if (already >= CALL_CAP) throw new Error(`call cap ${CALL_CAP} already used (${already})`);
  const manifest = readJson<Manifest>(MANIFEST_PATH);
  const ctx: RunContext = {
    snapshot: loadSnapshot(),
    policy: policyFor(manifest),
    modelId: resolveOfficialAuthorModelId(),
    report: createAuthorCostReport(),
    budget: new OfficialAuthorCallBudget(CALL_CAP - already),
    ledger: { next: already + 1 },
  };
  const cast = existingCast();
  const results: SpecResult[] = [];
  let failure: string | null = null;
  for (const spec of SPECS) {
    try {
      const earlier = results.map((r) => r.brief);
      const result = await runSpec(spec, ctx, [...cast, ...earlier], earlier);
      results.push(result);
    } catch (error) {
      failure = `${spec.key}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[g5-1] ${failure}`);
      break;
    }
  }

  const calls = savedCalls();
  const sum = (pick: (c: SavedCall) => number | null) => calls.reduce((acc, c) => acc + (pick(c) ?? 0), 0);
  const billedCostUsd = sum((c) => c.costUsd);
  const cost = {
    gitSha: git("rev-parse HEAD"),
    model: ctx.modelId,
    provider: "cheaper-inference-background",
    physicalCalls: calls.length,
    callCap: CALL_CAP,
    billedCostUsd: Number(billedCostUsd.toFixed(6)),
    billedCostKrwApprox: Math.round(billedCostUsd * KRW_PER_USD),
    krwPerUsd: KRW_PER_USD,
    inputTokens: sum((c) => c.inputTokens),
    outputTokens: sum((c) => c.outputTokens),
    outcomes: calls.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.outcome]: (acc[c.outcome] ?? 0) + 1 }), {}),
    byTask: calls.map((c) => ({ call: c.call, specKey: c.specKey, task: c.task, outcome: c.outcome, inputTokens: c.inputTokens, outputTokens: c.outputTokens, costUsd: c.costUsd })),
    thisProcessAccounting: { physicalAttempts: ctx.report.physicalAttempts, billedCostUsd: ctx.report.billedCostUsd, failedAttempts: ctx.report.failedProviderAttempts },
    runFailure: failure,
    generatedAt: new Date().toISOString(),
  };
  writeJson(path.join(OUT_DIR, "cost-usage.json"), cost);
  writeJson(path.join(OUT_DIR, "prompt-composition.json"), promptComposition());
  writeJson(path.join(OUT_DIR, "validation.json"), {
    gitSha: cost.gitSha,
    candidates: results.map((r) => ({
      key: r.spec.key,
      name: r.brief.name,
      genre: r.spec.genre,
      direction: r.spec.direction,
      briefGate: r.briefAttempts,
      bibleQaOk: r.bibleQa.length === 0,
      tagQaOk: r.tagQa.length === 0,
      draftQaOk: r.draftQa.length === 0,
      relationQaOk: r.relationQa.length === 0,
      lorebookQaOk: r.lorebookQa.length === 0,
      bibleQa: r.bibleQa,
      tagQa: r.tagQa,
      draftQa: r.draftQa,
      relationQa: r.relationQa,
      lorebookQa: r.lorebookQa,
      voiceRepairs: r.voiceRepairs,
      userRelationType: r.brief.userRelation?.type ?? "free",
      textLock: computeTextLockHash(r.draft),
    })),
    runFailure: failure,
  });
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT_DIR), cost: { ...cost, byTask: undefined } }, null, 2));
  if (failure) process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--dump-prompts")) {
    dumpPrompts();
    return;
  }
  if (args.includes("--run")) {
    const maxArg = args.find((a) => a.startsWith("--max-krw="));
    await run(maxArg ? Number(maxArg.split("=")[1]) : DEFAULT_MAX_KRW);
    return;
  }
  estimate();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
