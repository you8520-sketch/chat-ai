/**
 * Build local offline ownership detector v2 corpus from existing smoke outputs.
 * Does not call any model/API.
 */
import fs from "node:fs";
import path from "node:path";
import { detectOwnershipShadowV2 } from "../src/lib/ownershipShadowDetectorV2";
import {
  OWNERSHIP_SHADOW_ALL_FIXTURES,
  type OwnershipFixtureLabel,
} from "../src/lib/ownershipShadowDetectorV2.fixture";

const ROOT = path.resolve(import.meta.dirname, "..");
const SMOKE_FILES = [
  "data/_tmp-vnext-clean-call1-full.txt",
  "data/_tmp-vnext-clean-call2-full.txt",
  "data/_tmp-vnext-clean-call3-full.txt",
  "data/_tmp-vnext-clean-call4-full.txt",
  "data/_tmp-vnext-consolidated-call1-full.txt",
  "data/_tmp-vnext-consolidated-call2-full.txt",
  "data/_tmp-vnext-consolidated-call3-full.txt",
  "data/_tmp-vnext-consolidated-call4-full.txt",
];

const ACTOR_BY_FILE: Record<string, string> = {
  call1: "이준서",
  call2: "에녹",
  call3: "이준서",
  call4: "카일",
};

type CorpusEntry = {
  id: string;
  sourceFile: string;
  text: string;
  userAlias: string;
  actorName: string;
  detectorCategory: string | null;
  detectorSeverity: string | null;
  expectedCategory?: OwnershipFixtureLabel;
  expectedSeverity?: "HARD" | "SOFT" | "NONE";
};

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inferCallActor(filePath: string): string {
  const match = filePath.match(/call(\d)/);
  if (!match) return "캐릭터";
  return ACTOR_BY_FILE[`call${match[1]}`] ?? "캐릭터";
}

function main() {
  const entries: CorpusEntry[] = [];
  let idx = 0;

  for (const rel of SMOKE_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.warn("[corpus] missing", rel);
      continue;
    }
    const prose = fs.readFileSync(abs, "utf8");
    const actorName = inferCallActor(rel);
    for (const sentence of splitSentences(prose)) {
      if (!/렌|\[B\]|\{\{user\}\}/i.test(sentence)) continue;
      const result = detectOwnershipShadowV2(sentence, {
        mode: "interactive",
        userAliases: ["렌", "[B]", "{{user}}"],
        actorNames: [actorName],
      });
      const top = result.findings.find((f) => f.severity === "HARD") ?? result.findings[0] ?? null;
      entries.push({
        id: `smoke-${++idx}`,
        sourceFile: rel,
        text: sentence,
        userAlias: "렌",
        actorName,
        detectorCategory: top?.category ?? null,
        detectorSeverity: top?.severity ?? null,
      });
    }
  }

  for (const fixture of OWNERSHIP_SHADOW_ALL_FIXTURES) {
    const result = detectOwnershipShadowV2(fixture.text, {
      mode: "interactive",
      userAliases: [fixture.userAlias ?? "렌", "[B]", "{{user}}"],
      actorNames: fixture.actorNames ?? ["에녹", "이준서", "카일"],
      currentUserInput: fixture.currentUserInput,
      userAuthoredHistory: fixture.userAuthoredHistory,
    });
    const top = result.findings.find((f) => f.severity === "HARD") ?? result.findings[0] ?? null;
    entries.push({
      id: fixture.id,
      sourceFile: "fixture",
      text: fixture.text,
      userAlias: fixture.userAlias ?? "렌",
      actorName: (fixture.actorNames ?? ["캐릭터"])[0] ?? "캐릭터",
      detectorCategory: top?.category ?? null,
      detectorSeverity: top?.severity ?? null,
      expectedCategory: fixture.expectedCategory,
      expectedSeverity: fixture.expectedSeverity,
    });
  }

  const outPath = path.join(ROOT, "data/_tmp-ownership-detector-v2-corpus.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        version: "v2.0.0",
        generatedAt: new Date().toISOString(),
        sampleCount: entries.length,
        entries,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log("[corpus] wrote", outPath, "samples=", entries.length);
}

main();
