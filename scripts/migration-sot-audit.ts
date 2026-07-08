/**
 * Step 1.9 — post-migration SoT duplicate audit (craft responsibility).
 */
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";
import { buildOpenRouterKoreanProseTopBlock } from "@/lib/openRouterProsePolicy";
import { buildCoreMasterPrompt } from "@/lib/corePrompt";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";

const bundle = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
const top = buildOpenRouterKoreanProseTopBlock();
const length = buildLengthInstruction();
const core = buildCoreMasterPrompt({
  charName: "T",
  userName: "U",
  charGender: "female",
  userGender: "other",
  nsfwEnabled: false,
  impersonationOn: false,
  completedTurns: 5,
  hasMindReading: false,
  allowsBeard: false,
  allowsBodyHair: false,
});
const layout = buildWebnovelOutputLayoutRecencyBlock();
const handoff = buildTurnHandoffAndPacingBlock({ autoContinueTurn: false });
const genre = buildNarrativeStyleLayer({ genres: ["로맨스"] });

type Check = { id: string; responsibility: string; expectedSoT: string; dupes: string[] };

function findDupes(needle: RegExp, blocks: Record<string, string>, exclude: string[]): string[] {
  return Object.entries(blocks)
    .filter(([name, text]) => !exclude.includes(name) && needle.test(text))
    .map(([name]) => name);
}

const blocks: Record<string, string> = {
  TOP: top,
  BUNDLE: bundle,
  LENGTH: length,
  CORE: core,
  LAYOUT: layout,
  HANDOFF: handoff,
  GENRE: genre,
};

const checks: Check[] = [
  {
    id: "register-해체",
    responsibility: "해체 register",
    expectedSoT: "PROSE [REGISTER]",
    dupes: findDupes(/해체\(-다/, blocks, ["BUNDLE"]),
  },
  {
    id: "cross-turn-structure",
    responsibility: "turn 간 문장 구조 반복 금지",
    expectedSoT: "CROSS-TURN VARIATION",
    dupes: findDupes(/문장 구조/, blocks, ["BUNDLE"]),
  },
  {
    id: "cross-turn-repetition",
    responsibility: "행동·대사·감정 반복 금지",
    expectedSoT: "CROSS-TURN + PROSE EMOTION",
    dupes: findDupes(/반복하지/, blocks, ["BUNDLE"]),
  },
  {
    id: "no-generic-reactions",
    responsibility: "상투 반응 금지",
    expectedSoT: "PROSE [EMOTION]",
    dupes: findDupes(/상투|고개를 끄덕/, blocks, ["BUNDLE"]),
  },
  {
    id: "no-abstract-summary",
    responsibility: "순간 요약 금지",
    expectedSoT: "NO ABSTRACT SUMMARIES",
    dupes: findDupes(/요약하지 마라/, blocks, ["BUNDLE"]),
  },
  {
    id: "layout-vs-prose-priority",
    responsibility: "PROSE STYLE 우선 claim",
    expectedSoT: "(none — removed)",
    dupes: findDupes(/higher priority than \[PROSE STYLE\]/i, blocks, []),
  },
];

console.log("=== SoT Duplicate Audit ===\n");
let issues = 0;
for (const c of checks) {
  const ok = c.dupes.length === 0;
  if (!ok) issues++;
  console.log(`${ok ? "OK" : "DUP"}  ${c.id}`);
  console.log(`     SoT: ${c.expectedSoT}`);
  if (c.dupes.length) console.log(`     Still in: ${c.dupes.join(", ")}`);
  console.log("");
}

// Remaining craft in non-PROSE (informational — Needs Validation candidates)
const craftPatterns: [string, RegExp][] = [
  ["LENGTH 감각 전개", /각 대사 전·후에 행동·반응·감각·분위기/],
  ["NARRATIVE DENSITY craft", /감정 전환·신체 접촉·분위기/],
  ["HANDOFF body language", /body language|몸짓/],
  ["genre show-dont-tell", /설명하지 말고|시선·거리/],
  ["DeepSeek 해체", /지문은 -다/],
];

console.log("=== Remaining craft outside PROSE (Needs Validation queue) ===\n");
for (const [label, re] of craftPatterns) {
  const hits = Object.entries(blocks)
    .filter(([, t]) => re.test(t))
    .map(([n]) => n);
  if (hits.length) console.log(`${label}: ${hits.join(", ")}`);
}

process.exit(issues > 0 ? 1 : 0);
