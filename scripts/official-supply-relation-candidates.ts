/**
 * Manual evidence author for the relation-start bible contract (issue #1593).
 *
 * Authors three candidate bibles (FREE / ROLE_BOUND / RELATIONSHIP_BOUND) from
 * `pilot/fixtures/relation-start-candidate-briefs.json` through the canonical
 * `generateOfficialCharacterBible` path, then compiles and QA-checks them with
 * the canonical compiler/validators. Text calls only. Nothing is staged,
 * locked, saved to the production DB or published.
 *
 *   --estimate   no network: prompt token counts and a cost bound (default)
 *   --run        paid text calls; requires OFFICIAL_PILOT_LIVE=1 and refuses to
 *                start when the worst-case bound exceeds --max-usd (default 0.60,
 *                about 900 KRW at 1,500 KRW/USD; the agreed approval line is 1,000 KRW)
 *
 * node --conditions=react-server --import tsx scripts/official-supply-relation-candidates.ts --estimate
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import {
  createAuthorCostReport,
  generateOfficialCharacterBible,
  liveOfficialAuthorTransport,
  resolveOfficialAuthorModelId,
  validatePilotBible,
  validatePilotDraftForTextLock,
  withAuthorAccounting,
  type OfficialAuthorCostReport,
} from "@/lib/officialSupply/author";
import {
  buildCharacterBible1System,
  buildCharacterBible1User,
  buildCharacterBondsSystem,
  buildCharacterVoiceSystem,
  OFFICIAL_AUTHOR_MAX_TOKENS,
  type PortfolioBriefInput,
} from "@/lib/officialSupply/authorPrompts";
import type { OfficialCharacterBible, OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  compileRelationStartDraft,
  loadRelationStartBriefs,
  loadRelationStartWorld,
  RELATION_START_CANDIDATES_FILE,
  type RelationStartCandidate,
  type RelationStartCandidateBrief,
} from "@/lib/officialSupply/relationStartCandidates";
import { estimateTokens } from "@/lib/tokenEstimate";

const OUT_FILE = RELATION_START_CANDIDATES_FILE;
const MAX_WORKFLOW_ATTEMPTS = 3;
const KRW_PER_USD = 1500;
const UPPER_USD_PER_M_INPUT = 0.5;
const UPPER_USD_PER_M_OUTPUT = 1.0;

type CandidateBrief = RelationStartCandidateBrief;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function loadInputs(): { worldKey: string; world: OfficialWorldBible; candidates: CandidateBrief[]; styleKey: string } {
  return { ...loadRelationStartWorld(), candidates: loadRelationStartBriefs() };
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

function siblingSketches(candidates: CandidateBrief[], key: string): string[] {
  return candidates
    .filter((c) => c.key !== key)
    .map(({ brief: b }) => `${b.name}(${b.age}세 ${b.gender}, ${b.occupation}, ${b.archetype}, ${b.relationshipTrope})`);
}

function estimate(): { expectedUsd: number; upperBoundUsd: number } {
  const { world, candidates } = loadInputs();
  let inputTokens = 0;
  let maxOutput = 0;
  for (const { brief } of candidates) {
    const part1User = buildCharacterBible1User({
      brief,
      worldName: world.name,
      worldContext: worldContextForBrief(world, brief),
      siblingSketches: siblingSketches(candidates, "none"),
    });
    const recapAllowance = 1200 + 600;
    inputTokens +=
      estimateTokens(buildCharacterBible1System() + part1User) +
      estimateTokens(buildCharacterVoiceSystem()) + recapAllowance +
      estimateTokens(buildCharacterBondsSystem()) + recapAllowance;
    maxOutput +=
      OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_1 +
      OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_voice +
      OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_bonds;
  }
  const meanOutputPerCharacter = 2894 + 2165 + 1783;
  const expectedUsd =
    (inputTokens * UPPER_USD_PER_M_INPUT + meanOutputPerCharacter * candidates.length * UPPER_USD_PER_M_OUTPUT) / 1e6;
  const upperBoundUsd =
    MAX_WORKFLOW_ATTEMPTS * ((inputTokens * UPPER_USD_PER_M_INPUT + maxOutput * UPPER_USD_PER_M_OUTPUT) / 1e6);
  console.log(
    JSON.stringify(
      {
        model: resolveOfficialAuthorModelId(),
        candidates: candidates.length,
        physicalCallsExpected: candidates.length * 3,
        physicalCallsMax: candidates.length * 3 * MAX_WORKFLOW_ATTEMPTS,
        inputTokensEstimated: inputTokens,
        expectedUsd: Number(expectedUsd.toFixed(4)),
        worstCaseUsd: Number(upperBoundUsd.toFixed(4)),
        expectedKrw: Math.round(expectedUsd * KRW_PER_USD),
        worstCaseKrw: Math.round(upperBoundUsd * KRW_PER_USD),
        pricingBasis: `conservative $${UPPER_USD_PER_M_INPUT}/M in, $${UPPER_USD_PER_M_OUTPUT}/M out (ledger fit: ~$0.07 / $0.36)`,
      },
      null,
      2
    )
  );
  return { expectedUsd, upperBoundUsd };
}

type GeneratedCandidate = RelationStartCandidate;

async function run(maxUsd: number, only: string[]): Promise<void> {
  if (process.env.OFFICIAL_PILOT_LIVE !== "1") {
    throw new Error("OFFICIAL_PILOT_LIVE=1 is required for paid text calls");
  }
  const { upperBoundUsd } = estimate();
  if (upperBoundUsd > maxUsd) {
    throw new Error(`worst-case bound $${upperBoundUsd.toFixed(3)} exceeds --max-usd ${maxUsd}; ask for approval first`);
  }
  const { world, candidates: allCandidates, worldKey, styleKey } = loadInputs();
  const candidates = only.length ? allCandidates.filter((c) => only.includes(c.key)) : allCandidates;
  const modelId = resolveOfficialAuthorModelId();
  const report: OfficialAuthorCostReport = createAuthorCostReport();
  const generated: GeneratedCandidate[] = [];
  const generationFailures: { key: string; attempt: number; message: string }[] = [];

  for (const { key, brief } of candidates) {
    let feedback: string | undefined;
    let accepted: GeneratedCandidate | null = null;
    for (let attempt = 1; attempt <= MAX_WORKFLOW_ATTEMPTS && !accepted; attempt += 1) {
      const transport = withAuthorAccounting(liveOfficialAuthorTransport, report, { draftKey: key, workflowAttempt: attempt });
      let bible: OfficialCharacterBible;
      try {
        ({ bible } = await generateOfficialCharacterBible({
          transport,
          part1: {
            brief,
            worldName: world.name,
            worldContext: worldContextForBrief(world, brief),
            siblingSketches: siblingSketches(allCandidates, key),
            feedback,
          },
          voice: {
            name: brief.name,
            age: brief.age,
            adultCandidate: false,
            speechDirection: brief.speechDirection,
            npcDemand: "이야기에 반복 역할이 실제로 필요할 때만 1~2명을 만든다. 필요 없으면 0명([])이 정상이다.",
            userRelation: brief.userRelation,
            feedback,
          },
          bonds: {
            name: brief.name,
            age: brief.age,
            rpHook: brief.rpHook,
            adultCandidate: false,
            castList: [],
            userRelation: brief.userRelation,
            feedback,
          },
          modelId,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[relation-candidates] ${key} attempt ${attempt}: generation failed: ${message.slice(0, 300)}`);
        generationFailures.push({ key, attempt, message: message.slice(0, 600) });
        feedback = message.slice(0, 600);
        continue;
      }
      const bibleQa = validatePilotBible(bible, { adultExpected: false });
      const draft = compileRelationStartDraft({ key, brief, bible });
      const draftQa = validatePilotDraftForTextLock(draft, []);
      const bibleQaErrors = bibleQa.errors.map((e) => `${e.code}: ${e.message}`);
      const draftQaErrors = draftQa.errors.map((e) => `${e.code}: ${e.message}`);
      const candidate: GeneratedCandidate = { key, brief, bible, attempts: attempt, bibleQaErrors, draftQaErrors };
      console.log(`[relation-candidates] ${key} attempt ${attempt}: bibleQa=${bibleQa.ok} draftQa=${draftQa.ok}`);
      for (const line of [...bibleQaErrors, ...draftQaErrors]) console.log(`[relation-candidates]   ${line.slice(0, 200)}`);
      if (bibleQa.ok && draftQa.ok) {
        accepted = candidate;
      } else if (attempt === MAX_WORKFLOW_ATTEMPTS) {
        accepted = candidate;
      } else {
        feedback = [...bibleQaErrors, ...draftQaErrors].join("\n");
      }
    }
    if (accepted) generated.push(accepted);
  }

  const previous = fs.existsSync(OUT_FILE)
    ? readJson<{ runs?: unknown[]; cost?: unknown; candidates?: GeneratedCandidate[] }>(OUT_FILE)
    : { runs: [], candidates: [] };
  const kept = (previous.candidates ?? []).filter((c) => !generated.some((g) => g.key === c.key));
  const merged = [...kept, ...generated].sort((a, b) => a.key.localeCompare(b.key));
  fs.writeFileSync(
    OUT_FILE,
    `${JSON.stringify(
      {
        version: 2,
        model: modelId,
        runs: [...(previous.runs ?? (previous.cost ? [{ cost: previous.cost }] : [])), { generatedAt: new Date().toISOString(), only, cost: report, generationFailures }],
        candidates: merged,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(
    JSON.stringify(
      {
        out: path.relative(process.cwd(), OUT_FILE),
        physicalAttempts: report.physicalAttempts,
        billedCostUsd: report.billedCostUsd,
        billedCostKrwApprox: Math.round(report.billedCostUsd * KRW_PER_USD),
        inputTokens: report.inputTokens,
        outputTokens: report.outputTokens,
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--run")) {
    const maxUsdArg = args.find((a) => a.startsWith("--max-usd="));
    const onlyArg = args.find((a) => a.startsWith("--only="));
    await run(maxUsdArg ? Number(maxUsdArg.split("=")[1]) : 0.6, onlyArg ? onlyArg.split("=")[1].split(",") : []);
    return;
  }
  estimate();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
