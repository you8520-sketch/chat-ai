/**
 * G4 evidence author — two new rofan characters via canonical official supply owners.
 * Does not write pilot world files or production DB. Text calls only when --run.
 *
 * node --conditions=react-server --import tsx docs/official-supply/reviews/g4-2026-10-28/generate.ts --estimate
 * OFFICIAL_PILOT_LIVE=1 node --conditions=react-server --import tsx .../generate.ts --run [--max-usd=0.67]
 * OFFICIAL_PILOT_LIVE=1 ... --run --replan-b-only   # keep candidates/g4-rofan-a/brief.json; replan slot 14 only
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadEnvLocal } from "../../../../scripts/load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import {
  createAuthorCostReport,
  generateOfficialCharacterBible,
  generateOfficialPortfolioReplacement,
  liveOfficialAuthorTransport,
  resolveOfficialAuthorModelId,
  reviseOfficialCharacterVoice,
  validatePilotBible,
  validatePilotDraftForTextLock,
  withAuthorAccounting,
  type OfficialAuthorCostReport,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
  type OfficialVoiceRevisionField,
} from "@/lib/officialSupply/author";
import {
  buildCharacterBible1System,
  buildCharacterBible1User,
  buildCharacterBondsSystem,
  buildCharacterVoiceSystem,
  OFFICIAL_AUTHOR_MAX_TOKENS,
  type PortfolioBriefInput,
  type WorldMarketInput,
} from "@/lib/officialSupply/authorPrompts";
import {
  compileOfficialDraftFromBible,
  evaluateRelationBibleContract,
  type OfficialCharacterBible,
  type OfficialCharacterDraft,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import {
  buildOfficialCharacterFormBody,
  composeOfficialSystemPrompt,
  computeTextLockHash,
} from "@/lib/officialSupply/characterText";
import {
  evaluateDiscoveryTags,
  formatMarketSignalLines,
  hasUserRelationshipCue,
  resolveNamingProfile,
  selectMarketSignals,
  validateMarketFitBrief,
  type OfficialBatchMarketPolicy,
} from "@/lib/officialSupply/marketFit";
import { validateResearchSnapshot, type ResearchSnapshot } from "@/lib/officialSupply/research";
import { evaluateUserRelationPremise, officialUserRelationPremiseTexts } from "@/lib/officialSupply/userRelationStart";
import { evaluateInternalRegionConsistency, internalWorldRegions } from "@/lib/officialSupply/worldQa";
import { estimateTokens } from "@/lib/tokenEstimate";

const G4_DIR = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
const ROOT = path.resolve(G4_DIR, "../../../..");
const G3_CANDIDATES_DIR = path.join(ROOT, "docs/official-supply/reviews/g3-2026-10-28/candidates");
const WORLD_PATH = path.join(ROOT, "src/lib/officialSupply/pilot/world-bible.json");
const MANIFEST_PATH = path.join(ROOT, "src/lib/officialSupply/pilot/manifest.json");
const SNAPSHOT_PATH = path.join(ROOT, "docs/official-supply/market-research-snapshot-2026-09.json");

const KRW_PER_USD = 1500;
const UPPER_USD_PER_M_INPUT = 0.5;
const UPPER_USD_PER_M_OUTPUT = 1.0;
const MAX_VOICE_REPAIRS = 2;

const G4_SLOTS = [
  {
    key: "g4-rofan-a",
    slot: 13,
    direction:
      "남성. G4-A 강한 로맨스 긴장형. 능동적·독자적 욕망(거리·집착·선택·유혹 등)이 첫 장면부터 행동·대사로 드러나는 인물. 행정·권한 집행만 말하는 실무형 금지. 매력·결핍·갈등이 구체적 행동으로 보여야 한다. userRelation.type은 free·role_bound·relationship_bound 중 기획에 맞게 하나 — 억지 FREE 금지.",
  },
  {
    key: "g4-rofan-b",
    slot: 14,
    direction:
      "남성. G4-B 비밀과 관계 역전형. 수수께끼만 던지는 수동형 금지 — 유저가 대답하지 않아도 본인 목적을 위해 사건을 움직인다. 비밀·역전 역학이 관계 갈등 촉매. A와 말투·행동·매력·직업·갈등 축이 겹치지 않게. userRelation.type은 기획에 맞게 하나.",
  },
] as const;

const FORBIDDEN_REUSE =
  "테오·루시안·볼프강·율리우스·카엘룸·바스티안·세라피나·이노센트·헬레나·로웨나·발레리아·로언·이든(G3)과 직업·트로프·갈등·도입 재탕 금지. 황실 재건 계약 집행관·꿈 증언 판독관 축 재사용 금지. 황자·북부대공·브로커·교수-only 학자 클리셰 금지.";

type Manifest = {
  worldKey: string;
  styleKey: string;
  genre: string;
  marketPolicy: OfficialBatchMarketPolicy;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function loadWorld(): OfficialWorldBible {
  return readJson<{ bible: OfficialWorldBible }>(WORLD_PATH).bible;
}

function loadManifest(): Manifest {
  return readJson<Manifest>(MANIFEST_PATH);
}

function loadSnapshot(): ResearchSnapshot {
  const snapshot = readJson<ResearchSnapshot>(SNAPSHOT_PATH);
  const qa = validateResearchSnapshot(snapshot);
  if (!qa.ok) throw new Error(`snapshot invalid: ${qa.errors.map((e) => e.code).join(",")}`);
  return snapshot;
}

function worldMarketInput(snapshot: ResearchSnapshot, manifest: Manifest): WorldMarketInput {
  const policy = manifest.marketPolicy;
  return {
    targetLocale: policy.targetLocale,
    marketPriority: policy.marketPriority,
    signalLines: formatMarketSignalLines(selectMarketSignals(snapshot, policy, manifest.genre)),
    namingProfile: resolveNamingProfile(manifest.genre),
    marketRoleMix: policy.marketRoleMix,
    maxPrimaryTropeRepeat: policy.maxPrimaryTropeRepeat,
    coreTags: policy.coreTags,
  };
}

function compileForBrief(
  bible: OfficialCharacterBible,
  brief: PortfolioBriefInput,
  spec: { key: string },
  world: OfficialWorldBible,
  manifest: Manifest,
): OfficialCharacterDraft {
  return compileOfficialDraftFromBible(bible, {
    draftKey: spec.key,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"],
    audience: brief.audience,
    worldName: world.name,
    worldBible: world,
    hook: {
      archetype: brief.archetype,
      relationshipTrope: brief.relationshipTrope,
      occupation: brief.occupation,
      rpHook: brief.rpHook,
    },
  });
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

function siblingSketches(portfolio: PortfolioBriefInput[], excludeSlot: number): string[] {
  return portfolio
    .filter((b) => b.slot !== excludeSlot)
    .map(
      (b) =>
        `${b.name}(${b.age}세 ${b.gender}, ${b.occupation}, ${b.archetype}, ${b.relationshipTrope}, 훅 ${b.rpHook.slice(0, 80)}…)`,
    );
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

function gateBriefs(briefs: PortfolioBriefInput[], world: OfficialWorldBible, snapshot: ResearchSnapshot, manifest: Manifest): string[] {
  const errors: string[] = [];
  const policy = manifest.marketPolicy;
  const expected = resolveNamingProfile(manifest.genre);
  for (const b of briefs) {
    if (b.age < 19) errors.push(`${b.slot}: age ${b.age}`);
    if (!b.marketFit) errors.push(`${b.slot}: marketFit missing`);
    else errors.push(...validateMarketFitBrief(b.marketFit, { snapshot, policy, adultCandidate: b.adultCandidate, expectedNamingProfile: expected }).errors.map((e) => `${b.slot}: ${e.code}`));
    if (!hasUserRelationshipCue(b.rpHook)) errors.push(`${b.slot}: rpHook missing user cue`);
    errors.push(...evaluateInternalRegionConsistency(JSON.stringify(b), internalWorldRegions(world.regions)).errors.map((e) => `${b.slot}: ${e.code}`));
    const relType = b.userRelation?.type ?? "free";
    const premise = evaluateUserRelationPremise(relType, officialUserRelationPremiseTexts(b));
    if (!premise.ok) errors.push(...premise.errors.map((e) => `${b.slot}: relation_premise: ${e.message}`));
  }
  return errors;
}

function g3OverlapSketches(): string[] {
  const keys = ["g3-rofan-a", "g3-rofan-b"] as const;
  const lines: string[] = [];
  for (const key of keys) {
    const briefPath = path.join(G3_CANDIDATES_DIR, key, "brief.json");
    if (!fs.existsSync(briefPath)) continue;
    const b = readJson<PortfolioBriefInput>(briefPath);
    lines.push(
      `[G3 금지 재사용] ${b.name} — ${b.occupation}, ${b.archetype}, ${b.relationshipTrope}, 훅 ${b.rpHook.slice(0, 100)}…`,
    );
  }
  return lines;
}

function captureRawTransport(
  inner: OfficialAuthorTransport,
  responsesDir: string,
  nameForAttempt: (attempt: number) => string,
  attempt: number,
): OfficialAuthorTransport {
  return {
    label: inner.label,
    async completeJson(input) {
      const completion = await inner.completeJson(input);
      saveRaw(responsesDir, nameForAttempt(attempt), completion);
      return completion;
    },
  };
}

function aggregateSavedProviderCosts(outRoot: string): Pick<
  OfficialAuthorCostReport,
  "physicalAttempts" | "billedCostUsd" | "inputTokens" | "outputTokens"
> {
  const skip = new Set([
    "brief.json",
    "bible.assembled.json",
    "draft.compiled.json",
    "preview-form.json",
    "validation.json",
    "cost-usage.json",
  ]);
  let physicalAttempts = 0;
  let billedCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".json") && !skip.has(ent.name)) {
        try {
          const row = JSON.parse(fs.readFileSync(p, "utf8")) as { costUsd?: number; inputTokens?: number; outputTokens?: number };
          if (typeof row.costUsd === "number") {
            physicalAttempts += 1;
            billedCostUsd += row.costUsd;
            inputTokens += row.inputTokens ?? 0;
            outputTokens += row.outputTokens ?? 0;
          }
        } catch {
          /* not a provider row */
        }
      }
    }
  };
  walk(outRoot);
  return { physicalAttempts, billedCostUsd, inputTokens, outputTokens };
}

function saveRaw(dir: string, name: string, completion: OfficialAuthorRawCompletion): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify(
      {
        model: completion.model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        costUsd: completion.costUsd,
        providerRequestId: completion.providerRequestId,
        text: completion.text,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function estimate(): { expectedUsd: number; worstUsd: number } {
  const world = loadWorld();
  let inputTokens = estimateTokens(buildCharacterBible1System()); // portfolio uses world prompt size proxy
  inputTokens += 8000;
  for (const { slot } of G4_SLOTS) {
    const brief = world.portfolio[0]!;
    const part1User = buildCharacterBible1User({
      brief,
      worldName: world.name,
      worldContext: worldContextForBrief(world, brief),
      siblingSketches: siblingSketches(world.portfolio, slot),
    });
    inputTokens +=
      estimateTokens(buildCharacterBible1System() + part1User) +
      estimateTokens(buildCharacterVoiceSystem()) +
      1800 +
      estimateTokens(buildCharacterBondsSystem()) +
      1800;
  }
  const meanOut = (2894 + 2165 + 1783) * G4_SLOTS.length + 4000;
  const maxOut =
    OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_1 +
    OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_voice +
    OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_bonds;
  const expectedUsd = (inputTokens * UPPER_USD_PER_M_INPUT + meanOut * UPPER_USD_PER_M_OUTPUT) / 1e6;
  const worstUsd =
    ((inputTokens + 4000) * UPPER_USD_PER_M_INPUT +
      (maxOut * G4_SLOTS.length + OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_voice * MAX_VOICE_REPAIRS * G4_SLOTS.length) *
        UPPER_USD_PER_M_OUTPUT) /
    1e6;
  const payload = {
    model: resolveOfficialAuthorModelId(),
    gitSha: gitSha(),
    physicalCallsExpectedMin: 1 + G4_SLOTS.length * 3,
    physicalCallsMax: 2 + G4_SLOTS.length * (3 + MAX_VOICE_REPAIRS),
    expectedUsd: Number(expectedUsd.toFixed(4)),
    worstCaseUsd: Number(worstUsd.toFixed(4)),
    expectedKrw: Math.round(expectedUsd * KRW_PER_USD),
    worstCaseKrw: Math.round(worstUsd * KRW_PER_USD),
  };
  console.log(JSON.stringify(payload, null, 2));
  return { expectedUsd, worstUsd };
}

type CandidateBundle = {
  key: string;
  slot: number;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  draft: ReturnType<typeof compileOfficialDraftFromBible>;
  completions: OfficialAuthorRawCompletion[];
  voiceRepairs: { fields: string[]; before: OfficialCharacterBible; after: OfficialCharacterBible; completion: OfficialAuthorRawCompletion }[];
  bibleQa: string[];
  draftQa: string[];
  relationQa: string[];
};

async function run(maxUsd: number): Promise<void> {
  if (process.env.OFFICIAL_PILOT_LIVE !== "1") throw new Error("OFFICIAL_PILOT_LIVE=1 required");
  const { worstUsd } = estimate();
  if (worstUsd > maxUsd) throw new Error(`worst-case $${worstUsd.toFixed(3)} > --max-usd ${maxUsd}`);

  const manifest = loadManifest();
  const snapshot = loadSnapshot();
  const world = loadWorld();
  const modelId = resolveOfficialAuthorModelId();
  const report: OfficialAuthorCostReport = createAuthorCostReport();
  const outRoot = G4_DIR;
  fs.mkdirSync(outRoot, { recursive: true });
  const responsesDir = path.join(outRoot, "provider-responses");
  fs.mkdirSync(responsesDir, { recursive: true });

  const briefResponsePath = path.join(responsesDir, "00-portfolio-replacement.json");
  const replanBOnly = process.argv.includes("--replan-b-only");
  const pinnedAPath = path.join(outRoot, "candidates/g4-rofan-a/brief.json");
  const pinnedA = fs.existsSync(pinnedAPath) ? readJson<PortfolioBriefInput>(pinnedAPath) : null;
  if (replanBOnly && pinnedA) {
    fs.rmSync(briefResponsePath, { force: true });
    fs.rmSync(path.join(outRoot, "candidates/g4-rofan-b/brief.json"), { force: true });
  }
  let briefs: PortfolioBriefInput[];
  if (fs.existsSync(briefResponsePath)) {
    const saved = JSON.parse(fs.readFileSync(briefResponsePath, "utf8")) as { text: string };
    const data = JSON.parse(saved.text) as { portfolio: PortfolioBriefInput[] };
    briefs = data.portfolio.filter((b) => G4_SLOTS.some((s) => s.slot === b.slot));
    if (pinnedA) {
      briefs = [pinnedA, ...briefs.filter((b) => b.slot !== pinnedA.slot)].sort((a, z) => a.slot - z.slot);
    }
    console.log(`[g4] reusing saved portfolio replacement (${briefs.map((b) => b.name).join(", ")})`);
  } else {
    const keptSiblings = [
      ...world.portfolio.map(
        (b) => `${b.name} — ${b.gender}, ${b.occupation}, ${b.archetype}, ${b.relationshipTrope}`,
      ),
      ...g3OverlapSketches(),
    ];
    const slotsToPlan =
      replanBOnly && pinnedA ? G4_SLOTS.filter((s) => s.slot !== pinnedA.slot) : [...G4_SLOTS];
    let feedback: string | undefined;
    if (replanBOnly && pinnedA) {
      feedback =
        "slot 14 only: prior B attempts failed author gates (public intro completeness, hobbies/dailyLife lists, or official_player_gender_locked in publicDescription/creatorComment). New B must use gender-neutral player address; detailed public intro must cover occupation, looks (3–5 features), personality, role. Distinct from A(레온) and G3 로언·이든.";
    }
    briefs = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const rawName = attempt === 1 ? "00-portfolio-replacement.json" : "00-portfolio-replacement-attempt-2.json";
      const baseTransport = withAuthorAccounting(liveOfficialAuthorTransport, report, {
        draftKey: "g4-briefs",
        workflowAttempt: attempt,
      });
      const transportBrief = captureRawTransport(baseTransport, responsesDir, () => rawName, attempt);
      try {
        const { briefs: planned } = await generateOfficialPortfolioReplacement({
          transport: transportBrief,
          modelId,
          replacement: {
            worldName: world.name,
            centralPremise: world.centralPremise,
            factionNames: world.factions.map((f) => f.name),
            locationNames: world.locations.map((l) => l.name),
            market: worldMarketInput(snapshot, manifest),
            castIntent:
              "한국 여성향 로판 G4: 남성 2명 — A 강한 로맨스 긴장(능동적 욕망·행동), B 비밀·관계 역전(사건을 스스로 움직임). audience female.",
            keptSiblings,
            feedback,
            slots: slotsToPlan.map((s) => ({
              slot: s.slot,
              gender: "male" as const,
              adultCandidate: false,
              direction: `${s.direction} ${FORBIDDEN_REUSE}`,
            })),
          },
        });
        let merged = planned;
        if (pinnedA && replanBOnly) merged = [pinnedA, ...planned].sort((a, z) => a.slot - z.slot);
        const briefErrors = gateBriefs(merged, world, snapshot, manifest);
        if (briefErrors.length) {
          const msg = briefErrors.join("; ");
          if (attempt === 2) throw new Error(`brief gate after 2 attempts: ${msg}`);
          if (attempt === 1 && fs.existsSync(briefResponsePath)) {
            fs.renameSync(
              briefResponsePath,
              path.join(responsesDir, "00-portfolio-replacement-attempt-1-rejected.json"),
            );
          }
          feedback = msg;
          console.log(`[g4] brief gate attempt ${attempt} rejected: ${msg}`);
          continue;
        }
        if (attempt === 2 && fs.existsSync(path.join(responsesDir, "00-portfolio-replacement-attempt-2.json"))) {
          fs.copyFileSync(path.join(responsesDir, "00-portfolio-replacement-attempt-2.json"), briefResponsePath);
        }
        briefs = merged;
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt === 2) throw error;
        feedback = msg;
        console.log(`[g4] portfolio attempt ${attempt} failed: ${msg}`);
      }
    }
    if (briefs.length === 0) throw new Error("portfolio planning produced no briefs");
  }
  const briefErrorsFinal = gateBriefs(briefs, world, snapshot, manifest);
  if (briefErrorsFinal.length) throw new Error(`brief gate: ${briefErrorsFinal.join("; ")}`);

  const briefBySlot = new Map(briefs.map((b) => [b.slot, b]));
  const candidates: CandidateBundle[] = [];

  for (const spec of G4_SLOTS) {
    const brief = briefBySlot.get(spec.slot);
    if (!brief) throw new Error(`missing brief slot ${spec.slot}`);
    const candDir = path.join(outRoot, "candidates", spec.key);
    fs.mkdirSync(candDir, { recursive: true });
    fs.writeFileSync(path.join(candDir, "brief.json"), JSON.stringify(brief, null, 2) + "\n", "utf8");

    const assembledPath = path.join(candDir, "bible.assembled.json");
    const manuscriptPath = path.join(candDir, "first-manuscript.md");
    let bible: OfficialCharacterBible;
    let completions: OfficialAuthorRawCompletion[] = [];
    const voiceRepairs: CandidateBundle["voiceRepairs"] = [];

    if (fs.existsSync(assembledPath) && fs.existsSync(manuscriptPath)) {
      console.log(`[g4] skip ${spec.key}: outputs already present`);
      bible = JSON.parse(fs.readFileSync(assembledPath, "utf8")) as OfficialCharacterBible;
      const draft = JSON.parse(fs.readFileSync(path.join(candDir, "draft.compiled.json"), "utf8"));
      candidates.push({
        key: spec.key,
        slot: spec.slot,
        brief,
        bible,
        draft,
        voiceRepairs,
        bibleQa: validatePilotBible(bible, { adultExpected: brief.adultCandidate }).errors.map((e) => `${e.code}: ${e.message}`),
        draftQa: validatePilotDraftForTextLock(draft, []).errors.map((e) => `${e.code}: ${e.message}`),
        relationQa: evaluateRelationBibleContract(bible).errors.map((e) => `${e.code}: ${e.message}`),
      });
      continue;
    }

    const transport = withAuthorAccounting(liveOfficialAuthorTransport, report, { draftKey: spec.key, workflowAttempt: 1 });
    if (fs.existsSync(assembledPath)) {
      console.log(`[g4] resume ${spec.key}: compile/pack only (bible saved)`);
      bible = JSON.parse(fs.readFileSync(assembledPath, "utf8")) as OfficialCharacterBible;
    } else {
    let generated = await generateOfficialCharacterBible({
      transport,
      modelId,
      part1: {
        brief,
        worldName: world.name,
        worldContext: worldContextForBrief(world, brief),
        siblingSketches: siblingSketches([...world.portfolio, ...briefs], spec.slot),
      },
      voice: {
        name: brief.name,
        age: brief.age,
        adultCandidate: brief.adultCandidate,
        speechDirection: brief.speechDirection,
        npcDemand: "이야기에 반복 역할이 실제로 필요할 때만 1~2명. 필요 없으면 0명([]).",
        marketFit: brief.marketFit,
        userRelation: brief.userRelation,
      },
      bonds: {
        name: brief.name,
        age: brief.age,
        rpHook: brief.rpHook,
        adultCandidate: brief.adultCandidate,
        castList: [],
        userRelation: brief.userRelation,
      },
    });
    bible = generated.bible;
    completions = generated.completions;
    saveRaw(candDir, "01-part1.json", completions[0]!);
    saveRaw(candDir, "02-voice.json", completions[1]!);
    saveRaw(candDir, "03-bonds.json", completions[2]!);

    for (let repair = 0; repair < MAX_VOICE_REPAIRS; repair += 1) {
      const bibleQa = validatePilotBible(bible, { adultExpected: brief.adultCandidate });
      const tagQa = evaluateDiscoveryTags({ tags: bible.publicProfile.tags, bible, hook: brief }, manifest.marketPolicy);
      const issues = [...bibleQa.errors, ...tagQa.errors];
      if (issues.length === 0) break;
      const fields = voiceFieldsFor(issues.map((e) => e.code));
      if (fields.length === 0) break;
      const before = bible;
      const revised = await reviseOfficialCharacterVoice({
        transport,
        bible,
        voice: {
          name: brief.name,
          age: brief.age,
          adultCandidate: brief.adultCandidate,
          speechDirection: brief.speechDirection,
          npcDemand: "없음",
          marketFit: brief.marketFit,
          userRelation: brief.userRelation,
        },
        fields,
        reasons: issues.map((e) => `${e.code}: ${e.message}`),
        modelId,
      });
      bible = revised.bible;
      saveRaw(candDir, `02-voice-repair-${repair + 1}.json`, revised.completion);
      voiceRepairs.push({ fields, before, after: bible, completion: revised.completion });
    }

    fs.writeFileSync(path.join(candDir, "bible.assembled.json"), JSON.stringify(bible, null, 2) + "\n", "utf8");
    }
    const draft = compileForBrief(bible, brief, spec, world, manifest);
    const draftQa = validatePilotDraftForTextLock(draft, []);
    const relationQa = evaluateRelationBibleContract(bible);
    const previewForm = buildOfficialCharacterFormBody({ draft, appearanceBlock: "", assets: [] });
    fs.writeFileSync(path.join(candDir, "draft.compiled.json"), JSON.stringify(draft, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(candDir, "preview-form.json"), JSON.stringify(previewForm, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(candDir, "system-prompt.txt"), composeOfficialSystemPrompt(draft) + "\n", "utf8");
    fs.writeFileSync(
      path.join(candDir, "first-manuscript.md"),
      [
        `# ${brief.name} (${spec.key})`,
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
      "utf8",
    );

    candidates.push({
      key: spec.key,
      slot: spec.slot,
      brief,
      bible,
      draft,
      completions: [...completions],
      voiceRepairs,
      bibleQa: validatePilotBible(bible, { adultExpected: brief.adultCandidate }).errors.map((e) => `${e.code}: ${e.message}`),
      draftQa: draftQa.errors.map((e) => `${e.code}: ${e.message}`),
      relationQa: relationQa.errors.map((e) => `${e.code}: ${e.message}`),
    });
  }

  const savedCosts = aggregateSavedProviderCosts(outRoot);
  const billedCostUsd = report.billedCostUsd > 0 ? report.billedCostUsd : savedCosts.billedCostUsd;
  const cost = {
    gitSha: gitSha(),
    model: modelId,
    provider: "cheaper-inference-background",
    physicalAttempts: Math.max(report.physicalAttempts, savedCosts.physicalAttempts),
    billedCostUsd,
    billedCostKrwApprox: Math.round(billedCostUsd * KRW_PER_USD),
    inputTokens: Math.max(report.inputTokens, savedCosts.inputTokens),
    outputTokens: Math.max(report.outputTokens, savedCosts.outputTokens),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outRoot, "cost-usage.json"), JSON.stringify(cost, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(outRoot, "validation.json"),
    JSON.stringify(
      {
        candidates: candidates.map((c) => ({
          key: c.key,
          name: c.brief.name,
          bibleQaOk: c.bibleQa.length === 0,
          draftQaOk: c.draftQa.length === 0,
          relationQaOk: c.relationQa.length === 0,
          bibleQa: c.bibleQa,
          draftQa: c.draftQa,
          relationQa: c.relationQa,
          voiceRepairs:
            c.voiceRepairs.length ||
            fs.readdirSync(path.join(outRoot, "candidates", c.key)).filter((n) => n.startsWith("02-voice-repair-")).length,
          textLock: computeTextLockHash(c.draft),
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(outRoot, "PACKAGE.md"),
    [
      "# G4 — 신규 로판 2종 자동 생성 (GPT 검수용)",
      "",
      `실행 SHA: \`${cost.gitSha}\``,
      `모델: \`${cost.model}\``,
      `유료 호출: ${cost.physicalAttempts}회, 약 ${cost.billedCostKrwApprox} KRW ($${cost.billedCostUsd?.toFixed(4) ?? "?"})`,
      "",
      "## 후보",
      ...candidates.map(
        (c) =>
          `- **${c.key}** ${c.brief.name}: [first-manuscript](candidates/${c.key}/first-manuscript.md), [brief](candidates/${c.key}/brief.json), bible QA ${c.bibleQa.length === 0 ? "OK" : "FAIL"}`,
      ),
      "",
      "운영 DB 등록·공개·이미지 없음. Cursor는 문학 점수 없음.",
    ].join("\n") + "\n",
    "utf8",
  );
  console.log(JSON.stringify({ out: path.relative(ROOT, outRoot), cost }, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--run")) {
    const maxArg = args.find((a) => a.startsWith("--max-usd="));
    const replan = args.includes("--replan-b-only");
    await run(maxArg ? Number(maxArg.split("=")[1]) : replan ? 0.25 : 0.67);
    return;
  }
  estimate();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
