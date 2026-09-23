#!/usr/bin/env npx tsx
/**
 * Frozen TRPG Bot model A/B — Luna vs DeepSeek V4 Pro.
 * Requires RUN_TRPG_BOT_VOICE_AB=1 and CHEAPER_INFERENCE_API_KEY.
 * Does NOT change production routing.
 */
import Module from "module";
import fs from "node:fs";
import path from "node:path";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import {
  aggregateAbResults,
  callFrozenBotSample,
  DEEPSEEK_MODEL,
  LUNA_MODEL,
  type AbSampleResult,
  type FrozenFixture,
} from "./lib/trpgBotVoiceCollapseAbHarness";

const OUT_DIR = path.join(process.cwd(), "docs/audits/trpg-bot-voice-collapse-audit");
const FIXTURES_PATH = path.join(OUT_DIR, "fixtures.json");

function voiceSeparationScore(samples: AbSampleResult[]): number {
  const pairs: Array<[AbSampleResult, AbSampleResult]> = [];
  const byId = new Map(samples.map((s) => [s.fixtureId, s]));
  for (const id of ["F01", "F02", "F03", "F04", "F05", "F06"]) {
    const tae = byId.get(id);
    const hyun = byId.get(`F0${Number(id.slice(1)) + 6}`);
    if (tae && hyun) pairs.push([tae, hyun]);
  }
  if (pairs.length === 0) return 3;
  let scoreSum = 0;
  for (const [a, b] of pairs) {
    let pairScore = 5;
    const aQuotes = [...a.outputRaw.matchAll(/"([^"]{4,60})"/g)].map((m) => m[1]!);
    const bQuotes = [...b.outputRaw.matchAll(/"([^"]{4,60})"/g)].map((m) => m[1]!);
    for (const q of aQuotes) {
      if (bQuotes.some((bq) => bq === q)) pairScore -= 2;
    }
    const sharedNear = a.nearDistinctiveHits.filter((h) => b.nearDistinctiveHits.includes(h));
    pairScore -= sharedNear.length;
    scoreSum += Math.max(1, pairScore);
  }
  return Math.round((scoreSum / pairs.length) * 10) / 10;
}

function contextResponsiveness(samples: AbSampleResult[], fixtures: FrozenFixture[]): number {
  let hits = 0;
  let total = 0;
  const fixtureById = new Map(fixtures.map((f) => [f.id, f]));
  for (const s of samples) {
    const f = fixtureById.get(s.fixtureId);
    if (!f) continue;
    total += 1;
    const sceneTokens = f.previousGmScene.split(/\s+/).slice(0, 8);
    const actionTokens = f.humanAction.split(/\s+/).slice(0, 6);
    const prose = s.parsedProse + s.parsedIntent;
    const sceneHit = sceneTokens.some((t) => t.length > 2 && prose.includes(t.replace(/[.,]/g, "")));
    const actionHit = actionTokens.some((t) => t.length > 2 && prose.includes(t.replace(/[.,]/g, "")));
    if (sceneHit || actionHit) hits += 1;
  }
  return total === 0 ? 0 : Math.round((hits / total) * 100) / 100;
}

async function main() {
  if (process.env.RUN_TRPG_BOT_VOICE_AB !== "1") {
    console.error("Set RUN_TRPG_BOT_VOICE_AB=1 to run provider calls.");
    process.exit(2);
  }
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8")) as FrozenFixture[];
  const samples: AbSampleResult[] = [];
  for (const fixture of fixtures) {
    for (const model of [LUNA_MODEL, DEEPSEEK_MODEL]) {
      console.info(`[AB] ${fixture.id} ${fixture.character} ${model}`);
      const sample = await callFrozenBotSample({ fixture, model });
      samples.push(sample);
      console.info(`  latency=${sample.latencyMs}ms parse=${sample.parseSuccess} contract=${sample.contractPass}`);
      if (sample.exactDistinctiveHits.length) {
        console.info(`  EXACT_HITS=${sample.exactDistinctiveHits.join(",")}`);
      }
    }
  }
  const agg = aggregateAbResults(samples);
  const lunaSamples = agg.luna;
  const deepseekSamples = agg.deepseek;
  const report = {
    frozenFixtureCount: fixtures.length,
    models: [LUNA_MODEL, DEEPSEEK_MODEL],
    totalCalls: samples.length,
    lunaExactDistinctiveRepeatCount: agg.lunaExactDistinctiveRepeatCount,
    deepseekExactDistinctiveRepeatCount: agg.deepseekExactDistinctiveRepeatCount,
    lunaNearRepeatCount: agg.lunaNearRepeatCount,
    deepseekNearRepeatCount: agg.deepseekNearRepeatCount,
    lunaCrossCharacterCollisionCount: agg.lunaCrossCharacterCollision,
    deepseekCrossCharacterCollisionCount: agg.deepseekCrossCharacterCollision,
    lunaSemanticTemplateRepeatCount: agg.lunaSemanticTemplateRepeatCount,
    deepseekSemanticTemplateRepeatCount: agg.deepseekSemanticTemplateRepeatCount,
    lunaVoiceSeparationScore: voiceSeparationScore(lunaSamples),
    deepseekVoiceSeparationScore: voiceSeparationScore(deepseekSamples),
    lunaContextResponsiveness: contextResponsiveness(lunaSamples, fixtures),
    deepseekContextResponsiveness: contextResponsiveness(deepseekSamples, fixtures),
    lunaContractPass: agg.lunaContractPass,
    deepseekContractPass: agg.deepseekContractPass,
    lunaParsePass: agg.lunaParsePass,
    deepseekParsePass: agg.deepseekParsePass,
    lunaMedianLatency: agg.lunaMedianLatency,
    deepseekMedianLatency: agg.deepseekMedianLatency,
    lunaMedianCost: agg.lunaMedianCost,
    deepseekMedianCost: agg.deepseekMedianCost,
    lunaModelSpecificCollapse:
      agg.lunaExactDistinctiveRepeatCount + agg.lunaNearRepeatCount >
      agg.deepseekExactDistinctiveRepeatCount + agg.deepseekNearRepeatCount,
    promptOrContextArchitectureProblem:
      agg.lunaNearRepeatCount > 0 && agg.deepseekNearRepeatCount > 0,
    samples: samples.map((s) => ({
      fixtureId: s.fixtureId,
      character: s.character,
      model: s.model,
      promptSha256: s.promptSha256,
      outputRaw: s.outputRaw,
      parsedProse: s.parsedProse,
      parsedActionType: s.parsedActionType,
      parsedIntent: s.parsedIntent,
      latencyMs: s.latencyMs,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      providerCostUsd: s.providerCostUsd,
      parseSuccess: s.parseSuccess,
      contractPass: s.contractPass,
      exactDistinctiveHits: s.exactDistinctiveHits,
      nearDistinctiveHits: s.nearDistinctiveHits,
      semanticTemplateHits: s.semanticTemplateHits,
    })),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "ab-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
