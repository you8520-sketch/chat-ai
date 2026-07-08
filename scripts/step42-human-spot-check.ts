/**
 * Step 4.2 — Select 10 pairs for human spot check from Step 4.1 results.
 * Usage: npx tsx scripts/step42-human-spot-check.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Quality = {
  humanProxyOverall: number;
  webnovelLikeness: number;
  immersion: number;
  sentenceRhythm: number;
};

type Pair = {
  sceneId: string;
  sceneLabel: string;
  runIndex: number;
  before: { text: string; quality: Quality; charCount: number };
  blueprint: { text: string; quality: Quality; charCount: number };
};

type RankedPair = Pair & {
  id: string;
  deltaHuman: number;
  deltaImmersion: number;
  deltaRhythm: number;
  deltaWebnovel: number;
  category?: "win" | "loss" | "close";
};

function rankPairs(pairs: Pair[]): RankedPair[] {
  return pairs.map((p) => ({
    ...p,
    id: `${p.sceneId}#${p.runIndex}`,
    deltaHuman:
      p.blueprint.quality.humanProxyOverall - p.before.quality.humanProxyOverall,
    deltaImmersion: p.blueprint.quality.immersion - p.before.quality.immersion,
    deltaRhythm:
      p.blueprint.quality.sentenceRhythm - p.before.quality.sentenceRhythm,
    deltaWebnovel:
      p.blueprint.quality.webnovelLikeness - p.before.quality.webnovelLikeness,
  }));
}

function selectSpotCheckPairs(ranked: RankedPair[]): RankedPair[] {
  const byHuman = [...ranked].sort((a, b) => b.deltaHuman - a.deltaHuman);
  const used = new Set<string>();

  const wins = byHuman
    .filter((p) => p.deltaHuman > 0.05)
    .slice(0, 5)
    .map((p) => ({ ...p, category: "win" as const }));
  wins.forEach((p) => used.add(p.id));

  const losses = [...ranked]
    .sort((a, b) => a.deltaHuman - b.deltaHuman)
    .filter((p) => !used.has(p.id))
    .slice(0, 3)
    .map((p) => ({ ...p, category: "loss" as const }));
  losses.forEach((p) => used.add(p.id));

  const close = [...ranked]
    .filter((p) => !used.has(p.id))
    .sort((a, b) => Math.abs(a.deltaHuman) - Math.abs(b.deltaHuman))
    .slice(0, 2)
    .map((p) => ({ ...p, category: "close" as const }));

  return [...wins, ...losses, ...close].slice(0, 10);
}

function excerpt(text: string, max = 900): string {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n\n…";
}

function main() {
  const inPath = join(process.cwd(), "output", "step41-blueprint-ab.json");
  const data = JSON.parse(readFileSync(inPath, "utf8")) as { pairs: Pair[] };
  const ranked = rankPairs(data.pairs);
  const selected = selectSpotCheckPairs(ranked);

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "step41-blueprint-ab.json",
    selection: {
      wins: 5,
      losses: 3,
      close: 2,
    },
    pairs: selected.map((p) => ({
      id: p.id,
      category: p.category,
      sceneId: p.sceneId,
      sceneLabel: p.sceneLabel,
      runIndex: p.runIndex,
      deltaHuman: p.deltaHuman,
      deltaImmersion: p.deltaImmersion,
      deltaRhythm: p.deltaRhythm,
      deltaWebnovel: p.deltaWebnovel,
      before: {
        charCount: p.before.charCount,
        quality: p.before.quality,
        text: p.before.text,
      },
      blueprint: {
        charCount: p.blueprint.charCount,
        quality: p.blueprint.quality,
        text: p.blueprint.text,
      },
    })),
    allPairDeltas: ranked.map((p) => ({
      id: p.id,
      deltaHuman: p.deltaHuman,
      deltaImmersion: p.deltaImmersion,
    })),
  };

  writeFileSync(
    join(outDir, "step42-spot-check-selection.json"),
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  console.log("Selected 10 pairs for spot check:\n");
  for (const p of selected) {
    console.log(
      `[${p.category}] ${p.id} | Δhuman=${p.deltaHuman.toFixed(2)} Δimm=${p.deltaImmersion.toFixed(2)} | ${p.sceneLabel}`
    );
  }
  console.log(`\nWrote output/step42-spot-check-selection.json`);
}

main();
