/**
 * One-off audit for GM length compliance investigation.
 * Run: node --conditions=react-server --import tsx scripts/trpg-gm-length-audit.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  computeTrpgGmNarrationBudget,
  countTrpgNarrationChars,
  TRPG_GM_RICH_MIN_CHARS,
} from "../src/lib/trpg/gmNarrationBudget";
import { TRPG_GM_SYSTEM, buildTrpgGmUserBlock } from "../src/lib/trpg/gmPrompt";
import { TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "../src/lib/trpg/types";

function countNeg(text: string) {
  const do_not = (text.match(/\bdo not\b/gi) ?? []).length;
  const never = (text.match(/\bnever\b/gi) ?? []).length;
  const must_not = (text.match(/\bmust not\b/gi) ?? []).length;
  const cannot = (text.match(/\bcannot\b/gi) ?? []).length;
  const ignore = (text.match(/\bignore\b/gi) ?? []).length;
  return { do_not, never, must_not, cannot, ignore, total: do_not + never + must_not + cannot + ignore };
}

function padRich(seed: string): string {
  let out = seed.trim();
  while (countTrpgNarrationChars(out) < TRPG_GM_RICH_MIN_CHARS) out += " 먼지가 인다.";
  return out;
}

type Action = Parameters<typeof buildTrpgGmUserBlock>[0]["actions"][number];

function baseActions(): Action[] {
  return [
    {
      participantId: 1,
      name: "렌",
      body: "문을 연다.",
      participantKind: "human",
      statKey: "str",
      d20: 14,
      finalScore: 16,
      dc: 12,
      tier: "SUCCESS",
    },
    {
      participantId: 2,
      name: "유나",
      body: "창가를 본다.",
      participantKind: "ai_character",
      statKey: "wis",
      d20: 12,
      finalScore: 13,
      dc: 12,
      tier: "SUCCESS",
    },
    {
      participantId: 3,
      name: "솔",
      body: "뒤를 돌본다.",
      participantKind: "ai_character",
      statKey: "dex",
      d20: 10,
      finalScore: 11,
      dc: 12,
      tier: "FAILURE",
    },
  ];
}

function fixtureBlock(actions: Action[]) {
  return buildTrpgGmUserBlock({
    worldBrief: "폐역 지하 — 포자층과 금속 통로",
    memoryBlock: "[TRPG STRUCTURED STATE]\nlocation=복도",
    opening: false,
    gmSecret: "환풍구 뒤에 숨겨진 우회로",
    sheetCanon: "[PARTY SHEETS — canon]\n렌 · 유나 · 솔",
    resolutionOrderBlock: "[RESOLUTION ORDER]\n1. 렌\n2. 유나\n3. 솔",
    mechanicsPacket: "[AUTHORITATIVE MECHANICS]\n(no HP changes this round)",
    actions,
  });
}

function staticInstructionChars(userBlock: string): number {
  const dataMarkers = [
    "[WORLD]",
    "[TRPG STRUCTURED STATE]",
    "[PARTY SHEETS",
    "[GM SECRET",
    "[RESOLUTION ORDER]",
    "[ACTION participantId",
    "[AUTHORITATIVE MECHANICS]",
    "[AUTHORITATIVE HUMAN PC ACTION",
    "[AUTHORITATIVE AI PC ATTEMPT",
  ];
  let instructionOnly = TRPG_GM_SYSTEM + userBlock;
  for (const m of dataMarkers) {
    const idx = instructionOnly.indexOf(m);
    if (idx >= 0) {
      // rough: keep pre-data instruction sections only for upper bound tracking
    }
  }
  const userInstructionParts = [
    "[REGOLVE THIS ROUND]",
    "[OPENING SCENE",
    "[REGENERATE",
    "[SCENE CRAFT]",
    "[ROUND NARRATION BUDGET]",
    "[TONE CONTEXT]",
  ];
  let userInstr = 0;
  for (const p of userInstructionParts) {
    if (userBlock.includes(p)) userInstr += p.length;
  }
  const sceneCraft = userBlock.match(/\[SCENE CRAFT\][^\n]*/)?.[0] ?? "";
  const budget = userBlock.match(/\[ROUND NARRATION BUDGET\][\s\S]*?(?=\n\n\[|$)/)?.[0] ?? "";
  userInstr += sceneCraft.length + budget.length;
  return TRPG_GM_SYSTEM.length + sceneCraft.length + budget.length + 200;
}

const sparse = baseActions();
const mixed = baseActions().map((a, i) =>
  i === 0
    ? a
    : {
        ...a,
        body: i === 1 ? padRich("방패를 들고 전진한다.") : padRich("검을 역수로 쥐고 측면을 노린다."),
      }
);
const rich = mixed.map((a) => ({ ...a, body: padRich(a.body) }));

const report = {
  LATEST_MAIN_SHA: "00fb86330ec78696407e8db6743e816a8fe839d8",
  CURRENT_LENGTH_ACCEPTANCE_GAP: true,
  LENGTH_FIRST_DIVERGENCE: "C (+ D likely)",
  LENGTH_FIRST_DIVERGENCE_DETAIL:
    "Budget computed correctly in gmNarrationBudget.ts and injected via [ROUND NARRATION BUDGET], but user block places budget BEFORE actions/memory/mechanics (~60% of user tail follows budget). Completion integrity accepts any non-empty narration without minChars check.",
  PROVIDER_MODEL: TRPG_GM_MODEL,
  MAX_TOKENS: TRPG_GM_MAX_TOKENS,
  BEFORE: {
    GM_SYSTEM_CHARS: TRPG_GM_SYSTEM.length,
    NEGATIVE: countNeg(TRPG_GM_SYSTEM),
    STATIC_INSTRUCTION_APPROX: staticInstructionChars(fixtureBlock(mixed)),
  },
  FIXTURES: {} as Record<string, unknown>,
};

for (const [name, actions] of [
  ["SPARSE", sparse],
  ["MIXED", mixed],
  ["RICH", rich],
] as const) {
  const user = fixtureBlock(actions);
  const budget = computeTrpgGmNarrationBudget(actions.map((a) => a.body));
  const budgetIdx = user.indexOf("[ROUND NARRATION BUDGET]");
  const actionIdx = user.indexOf("[ACTION participantId");
  report.FIXTURES[name] = {
    density: budget.density,
    minChars: budget.minChars,
    targetMinChars: budget.targetMinChars,
    targetMaxChars: budget.targetMaxChars,
    userBlockChars: user.length,
    budgetIndex: budgetIdx,
    actionIndex: actionIdx,
    budgetBeforeActions: budgetIdx >= 0 && actionIdx >= 0 && budgetIdx < actionIdx,
    charsAfterBudget: user.length - budgetIdx,
  };
}

const outDir = "/opt/cursor/artifacts/trpg-gm-length-audit";
mkdirSync(outDir, { recursive: true });
const afterLabel = process.env.AUDIT_PHASE === "after" ? "after" : "before";
writeFileSync(join(outDir, `${afterLabel}-audit.json`), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, `${afterLabel}-system.txt`), TRPG_GM_SYSTEM);
writeFileSync(join(outDir, `${afterLabel}-user-mixed.txt`), fixtureBlock(mixed));

console.log(JSON.stringify(report, null, 2));
